use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use health_engine::application::commands::{
    CreateDietEntry, CreateHealthEvent, DailyMetricInput, MediaUpload,
};
use health_engine::application::error::{HealthError, HealthResult};
use health_engine::application::media::{MediaStore, StoredMedia};
use health_engine::application::retention::{RetentionPlan, RetentionWindow};
use health_engine::application::service::HealthService;
use health_engine::domain::{
    BowelAttributes, HealthEventDetails, MealType, MedicationAttributes, MedicationUnit,
    WeightAttributes,
};
use health_engine::infrastructure::media::LocalMediaStore;
use health_engine::infrastructure::sqlite::SqliteHealthRepository;
use rusqlite::Connection;
use time::macros::datetime;
use time::{Duration, OffsetDateTime};

const PNG: &[u8] = &[
    0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, b'I', b'H', b'D', b'R', 0, 0, 0,
    1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0x1f, 0x15, 0xc4, 0x89, 0, 0, 0, 10, b'I', b'D', b'A', b'T',
    0x78, 0x9c, 0x63, 0, 1, 0, 0, 5, 0, 1, 0x0d, 0x0a, 0x2d, 0xb4, 0, 0, 0, 0, b'I', b'E', b'N',
    b'D', 0xae, 0x42, 0x60, 0x82,
];

/// A window evaluated `days_later` days from now with a 30-day retention.
fn window(days_later: i64) -> RetentionWindow {
    let now = OffsetDateTime::now_utc() + Duration::days(days_later);
    RetentionWindow {
        now,
        cutoff: now - Duration::days(30),
        local_today: now.date(),
    }
}

fn counts(pairs: &[(&'static str, u64)]) -> BTreeMap<&'static str, u64> {
    pairs.iter().copied().collect()
}

fn kinds(plan: &RetentionPlan) -> BTreeMap<&'static str, u64> {
    let mut kinds = BTreeMap::new();
    for candidate in &plan.candidates {
        *kinds.entry(candidate.kind).or_insert(0) += 1;
    }
    kinds
}

#[test]
fn archived_diet_with_photo_is_purged_with_tags_history_media_and_file() {
    let fixture = Fixture::new();
    let mut service = fixture.service();
    let purged = service
        .create_diet(diet("Toast", vec!["wheat", "coffee"], true))
        .unwrap();
    let kept = service
        .create_diet(diet("Latte", vec!["coffee"], false))
        .unwrap();
    service.archive_diet(purged.id().as_str()).unwrap();
    let media_id = purged.media_id().unwrap().as_str().to_string();
    let relative = service
        .get_media(&media_id)
        .unwrap()
        .relative_path()
        .to_path_buf();
    assert!(fixture.media.join(&relative).is_file());

    let plan = service.retention_plan(&window(31)).unwrap();
    assert_eq!(
        kinds(&plan),
        counts(&[("health_diet", 1), ("health_media", 1)])
    );
    assert!(plan.skipped.is_empty());
    let diet_candidate = plan
        .candidates
        .iter()
        .find(|candidate| candidate.kind == "health_diet")
        .unwrap();
    assert_eq!(diet_candidate.id, purged.id().as_str());
    assert_eq!(diet_candidate.label, "Toast");
    assert_eq!(service.retention_media_paths(&plan), vec![relative.clone()]);

    let outcome = service.retention_apply(&plan).unwrap();
    assert_eq!(
        outcome.purged,
        counts(&[("health_diet", 1), ("health_media", 1)])
    );
    assert!(outcome.skipped.is_empty());
    assert_eq!(outcome.media_cleanup_pending, 0);

    let connection = fixture.connection();
    let id = purged.id().as_str();
    assert_eq!(count(&connection, "diet_entries WHERE id = ?1", id), 0);
    assert_eq!(
        count(&connection, "diet_entry_tags WHERE diet_entry_id = ?1", id),
        0
    );
    assert_eq!(count(&connection, "diet_tags WHERE name = ?1", "wheat"), 0);
    assert_eq!(count(&connection, "diet_tags WHERE name = ?1", "coffee"), 1);
    assert_eq!(
        count(&connection, "media_files WHERE id = ?1", &media_id),
        0
    );
    assert!(!fixture.media.join(&relative).exists());
    assert_tombstone_only(&connection, "diet_entry", id);
    assert_eq!(
        media_actions(&connection, &media_id),
        vec!["create", "detach", "cleanup"]
    );
    assert_eq!(
        service.get_diet(kept.id().as_str()).unwrap().tags(),
        &["coffee"]
    );

    let repository = SqliteHealthRepository::open_read_only(&fixture.database).unwrap();
    let activity = repository.recent_audit_activity(50).unwrap();
    assert!(activity.iter().all(|item| item.action != "purge"));
    assert!(
        activity
            .iter()
            .any(|item| item.record_id == kept.id().as_str())
    );
}

#[test]
fn media_still_referenced_by_a_remaining_diet_is_kept() {
    let fixture = Fixture::new();
    let mut service = fixture.service();
    let purged = service
        .create_diet(diet("Toast", vec!["wheat"], true))
        .unwrap();
    service.archive_diet(purged.id().as_str()).unwrap();
    let media_id = purged.media_id().unwrap().as_str().to_string();
    let relative = service
        .get_media(&media_id)
        .unwrap()
        .relative_path()
        .to_path_buf();
    let sharer = uuid::Uuid::new_v4().to_string();
    fixture
        .connection()
        .execute(
            "INSERT INTO diet_entries (
                id, occurred_at, local_date, meal_type, food_name, note, media_id,
                created_at, updated_at, deleted_at
             ) VALUES (?1, '2026-07-30T03:00:00.000000000Z', '2026-07-30', 'lunch', 'Shared',
                       NULL, ?2, '2026-07-30T03:00:00.000000000Z', '2026-07-30T03:00:00.000000000Z', NULL)",
            [&sharer, &media_id],
        )
        .unwrap();

    let plan = service.retention_plan(&window(31)).unwrap();
    assert_eq!(kinds(&plan), counts(&[("health_diet", 1)]));
    assert_eq!(plan.skipped, counts(&[("media_shared", 1)]));
    assert!(service.retention_media_paths(&plan).is_empty());

    let outcome = service.retention_apply(&plan).unwrap();
    assert_eq!(outcome.purged, counts(&[("health_diet", 1)]));
    assert_eq!(outcome.media_cleanup_pending, 0);
    let connection = fixture.connection();
    assert_eq!(
        count(
            &connection,
            "media_files WHERE id = ?1 AND deleted_at IS NULL AND cleanup_pending = 0",
            &media_id
        ),
        1
    );
    assert!(fixture.media.join(&relative).is_file());
    service.get_diet(&sharer).unwrap();
    SqliteHealthRepository::open_read_only(&fixture.database).unwrap();
}

#[test]
fn archived_metric_bowel_and_medication_events_are_each_purged() {
    let fixture = Fixture::new();
    let mut service = fixture.service();
    let mut ids = Vec::new();
    let metric = service
        .upsert_daily_metrics(vec![DailyMetricInput {
            occurred_at: datetime!(2026-07-30 09:00:00 +09:00),
            details: HealthEventDetails::Weight(
                WeightAttributes::body_weight("Body weight", 68.0, "kg").unwrap(),
            ),
            note: None,
            actor: "integration-test".to_string(),
            expected_updated_at: None,
        }])
        .unwrap()
        .remove(0);
    service.archive_event(metric.id().as_str()).unwrap();
    ids.push(metric.id().as_str().to_string());
    for details in [
        HealthEventDetails::Bowel(BowelAttributes::new(4, false).unwrap()),
        HealthEventDetails::Medication(
            MedicationAttributes::new("Vitamin D", 1.0, MedicationUnit::Tablet).unwrap(),
        ),
    ] {
        let event = service.create_event(event(details)).unwrap();
        service.archive_event(event.id().as_str()).unwrap();
        ids.push(event.id().as_str().to_string());
    }
    let active = service
        .create_event(event(HealthEventDetails::Bowel(
            BowelAttributes::new(3, false).unwrap(),
        )))
        .unwrap();

    let plan = service.retention_plan(&window(31)).unwrap();
    let expected = counts(&[
        ("health_bowel", 1),
        ("health_medication", 1),
        ("health_metric", 1),
    ]);
    assert_eq!(kinds(&plan), expected);
    let outcome = service.retention_apply(&plan).unwrap();
    assert_eq!(outcome.purged, expected);

    let connection = fixture.connection();
    for id in &ids {
        assert_eq!(count(&connection, "health_events WHERE id = ?1", id), 0);
        assert_tombstone_only(&connection, "health_event", id);
    }
    assert!(service.get_event(active.id().as_str()).is_ok());
    SqliteHealthRepository::open_read_only(&fixture.database).unwrap();
}

#[test]
fn records_archived_less_than_thirty_days_ago_are_kept() {
    let fixture = Fixture::new();
    let mut service = fixture.service();
    let entry = service
        .create_diet(diet("Toast", vec!["wheat"], true))
        .unwrap();
    service.archive_diet(entry.id().as_str()).unwrap();
    let event = service
        .create_event(event(HealthEventDetails::Bowel(
            BowelAttributes::new(4, false).unwrap(),
        )))
        .unwrap();
    service.archive_event(event.id().as_str()).unwrap();

    let plan = service.retention_plan(&window(29)).unwrap();
    assert!(plan.candidates.is_empty());
    let outcome = service.retention_apply(&plan).unwrap();
    assert!(outcome.purged.is_empty());
    assert!(
        service
            .get_diet_including_archived(entry.id().as_str())
            .is_ok()
    );
    assert!(
        service
            .get_event_including_archived(event.id().as_str())
            .is_ok()
    );
}

#[test]
fn apply_skips_records_changed_since_the_plan() {
    let fixture = Fixture::new();
    let mut service = fixture.service();
    let entry = service
        .create_diet(diet("Toast", vec!["wheat"], true))
        .unwrap();
    service.archive_diet(entry.id().as_str()).unwrap();
    let plan = service.retention_plan(&window(31)).unwrap();
    service.restore_diet(entry.id().as_str()).unwrap();

    let outcome = service.retention_apply(&plan).unwrap();
    assert!(outcome.purged.is_empty());
    assert_eq!(
        outcome.skipped,
        counts(&[("changed_since_plan", 1), ("media_shared", 1)])
    );
    let restored = service.get_diet(entry.id().as_str()).unwrap();
    assert!(service.diet_photo(restored.id().as_str()).is_ok());
    SqliteHealthRepository::open_read_only(&fixture.database).unwrap();
}

#[test]
fn apply_purges_more_than_one_transaction_batch() {
    let fixture = Fixture::new();
    let mut service = fixture.service();
    for scale in 0..205_u32 {
        let event = service
            .create_event(event(HealthEventDetails::Bowel(
                BowelAttributes::new(u8::try_from(scale % 7 + 1).unwrap(), false).unwrap(),
            )))
            .unwrap();
        service.archive_event(event.id().as_str()).unwrap();
    }
    let plan = service.retention_plan(&window(31)).unwrap();
    let outcome = service.retention_apply(&plan).unwrap();
    assert_eq!(outcome.purged, counts(&[("health_bowel", 205)]));
    assert_eq!(
        count(&fixture.connection(), "health_events WHERE 1 = ?1", "1"),
        0
    );
}

#[test]
fn failed_file_removal_leaves_media_cleanup_pending_and_is_reported() {
    let fixture = Fixture::new();
    let mut service = fixture.service();
    let entry = service
        .create_diet(diet("Toast", vec!["wheat"], true))
        .unwrap();
    service.archive_diet(entry.id().as_str()).unwrap();
    let media_id = entry.media_id().unwrap().as_str().to_string();
    let relative = service
        .get_media(&media_id)
        .unwrap()
        .relative_path()
        .to_path_buf();
    drop(service);

    let mut failing = HealthService::new(
        SqliteHealthRepository::open(&fixture.database).unwrap(),
        FailingRemove(LocalMediaStore::new(&fixture.media).unwrap()),
    );
    let plan = failing.retention_plan(&window(31)).unwrap();
    let outcome = failing.retention_apply(&plan).unwrap();
    assert_eq!(outcome.purged, counts(&[("health_diet", 1)]));
    assert_eq!(outcome.media_cleanup_pending, 1);
    drop(failing);

    let connection = fixture.connection();
    assert_eq!(
        count(
            &connection,
            "media_files WHERE id = ?1 AND cleanup_pending = 1 AND deleted_at IS NOT NULL",
            &media_id
        ),
        1
    );
    assert!(fixture.media.join(&relative).is_file());
    SqliteHealthRepository::open_read_only(&fixture.database).unwrap();

    // The normal startup recovery finishes the cleanup once removal works again.
    HealthService::start(
        SqliteHealthRepository::open(&fixture.database).unwrap(),
        LocalMediaStore::new(&fixture.media).unwrap(),
    )
    .unwrap();
    assert_eq!(
        count(&connection, "media_files WHERE id = ?1", &media_id),
        0
    );
    assert!(!fixture.media.join(&relative).exists());
}

#[test]
fn plan_for_a_missing_store_is_empty_and_creates_nothing() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("health.sqlite");
    let plan = SqliteHealthRepository::retention_plan_at(&database, &window(31)).unwrap();
    assert!(plan.candidates.is_empty());
    assert!(plan.skipped.is_empty());
    assert!(!database.exists());
}

#[test]
fn copy_media_for_backup_copies_a_stored_photo() {
    let fixture = Fixture::new();
    let mut service = fixture.service();
    let entry = service.create_diet(diet("Toast", vec![], true)).unwrap();
    let relative = service
        .get_media(entry.media_id().unwrap().as_str())
        .unwrap()
        .relative_path()
        .to_path_buf();
    let store = LocalMediaStore::open_existing(&fixture.media).unwrap();
    let backup = fixture.directory.path().join("backup");
    fs::create_dir(&backup).unwrap();

    assert_eq!(
        store.copy_media_for_backup(&relative, &backup).unwrap(),
        Some(PNG.len() as u64)
    );
    assert_eq!(fs::read(backup.join(&relative)).unwrap(), PNG);
    let missing = PathBuf::from(format!("{}.png", uuid::Uuid::new_v4()));
    assert_eq!(
        store.copy_media_for_backup(&missing, &backup).unwrap(),
        None
    );
    assert!(
        store
            .copy_media_for_backup(Path::new("../escape.png"), &backup)
            .is_err()
    );
}

#[cfg(unix)]
#[test]
fn copy_media_for_backup_rejects_symlink_escapes() {
    use std::os::unix::fs::symlink;

    let fixture = Fixture::new();
    let store = LocalMediaStore::new(&fixture.media).unwrap();
    let outside = fixture.directory.path().join("outside");
    fs::create_dir(&outside).unwrap();
    let secret_name = format!("{}.png", uuid::Uuid::new_v4());
    fs::write(outside.join(&secret_name), PNG).unwrap();
    let backup = fixture.directory.path().join("backup");
    fs::create_dir(&backup).unwrap();

    // Source file is a symlink to a file outside the media root.
    let linked_file = format!("{}.png", uuid::Uuid::new_v4());
    symlink(outside.join(&secret_name), fixture.media.join(&linked_file)).unwrap();
    assert!(
        store
            .copy_media_for_backup(Path::new(&linked_file), &backup)
            .is_err()
    );

    // Source directory component is a symlink leaving the media root.
    symlink(&outside, fixture.media.join("escape")).unwrap();
    let through_directory = PathBuf::from("escape").join(&secret_name);
    assert!(
        store
            .copy_media_for_backup(&through_directory, &backup)
            .is_err()
    );
    assert!(fs::read_dir(&backup).unwrap().next().is_none());

    // Destination directory component is a symlink leaving the backup root.
    fs::create_dir(fixture.media.join("nested")).unwrap();
    let nested_name = format!("{}.png", uuid::Uuid::new_v4());
    fs::write(fixture.media.join("nested").join(&nested_name), PNG).unwrap();
    let target = fixture.directory.path().join("target");
    fs::create_dir(&target).unwrap();
    symlink(&target, backup.join("nested")).unwrap();
    assert!(
        store
            .copy_media_for_backup(&PathBuf::from("nested").join(&nested_name), &backup)
            .is_err()
    );
    assert!(fs::read_dir(&target).unwrap().next().is_none());
}

struct FailingRemove(LocalMediaStore);

impl MediaStore for FailingRemove {
    type Staged = <LocalMediaStore as MediaStore>::Staged;

    fn stage(&self, content_type: &str, bytes: &[u8]) -> HealthResult<Self::Staged> {
        self.0.stage(content_type, bytes)
    }

    fn finalize(&self, staged: Self::Staged) -> HealthResult<StoredMedia> {
        self.0.finalize(staged)
    }

    fn abort(&self, staged: Self::Staged) -> HealthResult<()> {
        self.0.abort(staged)
    }

    fn confirm(&self, stored: &StoredMedia) -> HealthResult<()> {
        self.0.confirm(stored)
    }

    fn remove(&self, _relative_path: &Path) -> HealthResult<()> {
        Err(HealthError::Storage(
            "synthetic removal failure".to_string(),
        ))
    }
}

fn diet(food: &str, tags: Vec<&str>, photo: bool) -> CreateDietEntry {
    CreateDietEntry {
        occurred_at: datetime!(2026-07-30 12:00:00 +09:00),
        meal_type: MealType::Lunch,
        food_name: food.to_string(),
        note: None,
        tags: tags.into_iter().map(str::to_string).collect(),
        media: photo.then(|| MediaUpload::new("image/png", PNG)),
        actor: "integration-test".to_string(),
    }
}

fn event(details: HealthEventDetails) -> CreateHealthEvent {
    CreateHealthEvent {
        occurred_at: datetime!(2026-07-30 09:00:00 +09:00),
        details,
        note: None,
        actor: "integration-test".to_string(),
    }
}

fn count(connection: &Connection, from_where: &str, value: &str) -> i64 {
    connection
        .query_row(
            &format!("SELECT COUNT(*) FROM {from_where}"),
            [value],
            |row| row.get(0),
        )
        .unwrap()
}

fn assert_tombstone_only(connection: &Connection, record_type: &str, id: &str) {
    let rows = connection
        .prepare(
            "SELECT actor, action, reason, before_json IS NULL, after_json IS NULL
             FROM audit_events WHERE record_type = ?1 AND record_id = ?2",
        )
        .unwrap()
        .query_map([record_type, id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, bool>(3)?,
                row.get::<_, bool>(4)?,
            ))
        })
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    assert_eq!(
        rows,
        vec![(
            "retention".to_string(),
            "purge".to_string(),
            Some("retention".to_string()),
            true,
            true
        )]
    );
}

fn media_actions(connection: &Connection, media_id: &str) -> Vec<String> {
    connection
        .prepare(
            "SELECT action FROM audit_events
             WHERE record_type = 'media_file' AND record_id = ?1
             ORDER BY occurred_at, rowid",
        )
        .unwrap()
        .query_map([media_id], |row| row.get(0))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap()
}

struct Fixture {
    directory: tempfile::TempDir,
    database: PathBuf,
    media: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let directory = tempfile::tempdir().unwrap();
        Self {
            database: directory.path().join("health.sqlite"),
            media: directory.path().join("media"),
            directory,
        }
    }

    fn service(&self) -> HealthService<SqliteHealthRepository, LocalMediaStore> {
        HealthService::new(
            SqliteHealthRepository::open(&self.database).unwrap(),
            LocalMediaStore::new(&self.media).unwrap(),
        )
    }

    fn connection(&self) -> Connection {
        Connection::open(&self.database).unwrap()
    }
}
