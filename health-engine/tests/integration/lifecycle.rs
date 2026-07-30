use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use health_engine::application::commands::{CreateDietEntry, DailyMetricInput, MediaUpload};
use health_engine::application::error::{HealthError, HealthResult};
use health_engine::application::media::{MediaStore, StoredMedia};
use health_engine::application::ports::Page;
use health_engine::application::service::HealthService;
use health_engine::domain::{HealthEventDetails, MealType, WeightAttributes};
use health_engine::infrastructure::media::{LocalMediaStore, LocalStagedMedia};
use health_engine::infrastructure::sqlite::SqliteHealthRepository;
use rusqlite::Connection;
use time::macros::datetime;

const PNG: &[u8] = &[
    0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, b'I', b'H', b'D', b'R', 0, 0, 0,
    1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0x1f, 0x15, 0xc4, 0x89, 0, 0, 0, 10, b'I', b'D', b'A', b'T',
    0x78, 0x9c, 0x63, 0, 1, 0, 0, 5, 0, 1, 0x0d, 0x0a, 0x2d, 0xb4, 0, 0, 0, 0, b'I', b'E', b'N',
    b'D', 0xae, 0x42, 0x60, 0x82,
];

#[test]
fn lifecycle_rejects_invalid_transitions_and_restore_daily_conflicts() {
    let fixture = Fixture::new();
    let mut service = fixture.service();
    let input = || DailyMetricInput {
        occurred_at: datetime!(2026-07-30 09:00:00 +09:00),
        details: HealthEventDetails::Weight(
            WeightAttributes::body_weight("Weight", 68.0, "kg").unwrap(),
        ),
        note: None,
        actor: "test".to_string(),
    };
    let first = service
        .upsert_daily_metrics(vec![input()])
        .unwrap()
        .remove(0);
    assert!(matches!(
        service.archive_event_if_current(
            first.id().as_str(),
            Some(first.updated_at() - time::Duration::nanoseconds(1))
        ),
        Err(HealthError::Conflict(_))
    ));
    assert!(matches!(
        service.restore_event(first.id().as_str()),
        Err(HealthError::Conflict(_))
    ));
    let archived = service.archive_event(first.id().as_str()).unwrap();
    assert!(archived.is_deleted());
    assert!(service.get_event(first.id().as_str()).is_err());
    assert!(matches!(
        service.archive_event(first.id().as_str()),
        Err(HealthError::Conflict(_))
    ));

    service.upsert_daily_metrics(vec![input()]).unwrap();
    assert!(matches!(
        service.restore_event(first.id().as_str()),
        Err(HealthError::Conflict(_))
    ));
    assert!(
        service
            .get_event_including_archived(first.id().as_str())
            .unwrap()
            .is_deleted()
    );
}

#[test]
fn purge_requires_exact_id_keeps_audit_and_removes_media_after_commit() {
    let fixture = Fixture::new();
    let mut service = fixture.service();
    let diet = service.create_diet(diet_with_media()).unwrap();
    let media = service
        .get_media(diet.media_id().unwrap().as_str())
        .unwrap();
    let path = fixture.media.join(media.relative_path());
    let archived = service.archive_diet(diet.id().as_str()).unwrap();
    assert!(archived.is_deleted());
    let restored = service.restore_diet(diet.id().as_str()).unwrap();
    assert!(!restored.is_deleted());
    service.archive_diet(diet.id().as_str()).unwrap();
    assert_eq!(
        service.purge_diet(diet.id().as_str(), "wrong"),
        Err(HealthError::ConfirmationMismatch)
    );
    service
        .purge_diet(diet.id().as_str(), diet.id().as_str())
        .unwrap();

    assert!(!path.exists());
    assert!(matches!(
        service.get_diet_including_archived(diet.id().as_str()),
        Err(HealthError::NotFound(_))
    ));
    let audit = service
        .audit_for("diet_entry", diet.id().as_str(), Page::default())
        .unwrap();
    assert!(audit.iter().any(|event| event.action() == "purge"));
    let media_audit = service
        .audit_for("media_file", media.id(), Page::default())
        .unwrap();
    assert!(media_audit.iter().any(|event| event.action() == "cleanup"));
}

#[test]
fn purged_event_is_gone_but_its_audit_history_remains() {
    let fixture = Fixture::new();
    let mut service = fixture.service();
    let event = service
        .upsert_daily_metrics(vec![DailyMetricInput {
            occurred_at: datetime!(2026-07-30 09:00:00 UTC),
            details: HealthEventDetails::Weight(
                WeightAttributes::body_weight("Weight", 68.0, "kg").unwrap(),
            ),
            note: None,
            actor: "test".to_string(),
        }])
        .unwrap()
        .remove(0);
    service.archive_event(event.id().as_str()).unwrap();
    service
        .purge_event(event.id().as_str(), event.id().as_str())
        .unwrap();
    assert!(matches!(
        service.get_event_including_archived(event.id().as_str()),
        Err(HealthError::NotFound(_))
    ));
    assert!(
        service
            .audit_for("health_event", event.id().as_str(), Page::default())
            .unwrap()
            .iter()
            .any(|audit| audit.action() == "purge")
    );
}

#[test]
fn restore_diet_rejects_a_tombstoned_media_reference() {
    let fixture = Fixture::new();
    let mut service = fixture.service();
    let diet = service.create_diet(diet_with_media()).unwrap();
    let media_id = diet.media_id().unwrap().as_str().to_string();
    let archived = service.archive_diet(diet.id().as_str()).unwrap();
    let deleted_at = archived
        .updated_at()
        .format(
            &time::format_description::parse(
                "[year]-[month]-[day]T[hour]:[minute]:[second].[subsecond digits:9]Z",
            )
            .unwrap(),
        )
        .unwrap();
    Connection::open(&fixture.database)
        .unwrap()
        .execute(
            "UPDATE media_files
             SET cleanup_pending = 1, deleted_at = ?2, updated_at = ?2
             WHERE id = ?1",
            rusqlite::params![media_id, deleted_at],
        )
        .unwrap();

    assert!(matches!(
        service.restore_diet(diet.id().as_str()),
        Err(HealthError::Conflict(_))
    ));
}

#[test]
fn failed_media_cleanup_stays_retryable_and_startup_retries_it() {
    let fixture = Fixture::new();
    let fail = Arc::new(AtomicBool::new(true));
    let mut service = fixture.toggle_service(fail.clone());
    let diet = service.create_diet(diet_with_media()).unwrap();
    let media = service
        .get_media(diet.media_id().unwrap().as_str())
        .unwrap();
    let path = fixture.media.join(media.relative_path());
    service.archive_diet(diet.id().as_str()).unwrap();
    assert!(matches!(
        service.purge_diet(diet.id().as_str(), diet.id().as_str()),
        Err(HealthError::CleanupPending { .. })
    ));
    assert!(path.exists());
    assert_eq!(
        Connection::open(&fixture.database)
            .unwrap()
            .query_row(
                "SELECT cleanup_pending FROM media_files WHERE id = ?1",
                [media.id()],
                |row| row.get::<_, i64>(0),
            )
            .unwrap(),
        1
    );

    fail.store(false, Ordering::SeqCst);
    std::fs::remove_file(&path).unwrap();
    let _started = HealthService::start(
        SqliteHealthRepository::open(&fixture.database).unwrap(),
        ToggleStore {
            inner: LocalMediaStore::new(&fixture.media).unwrap(),
            fail,
        },
    )
    .unwrap();
    assert!(!path.exists());
    assert_eq!(
        Connection::open(&fixture.database)
            .unwrap()
            .query_row(
                "SELECT COUNT(*) FROM media_files WHERE id = ?1",
                [media.id()],
                |row| row.get::<_, i64>(0),
            )
            .unwrap(),
        0
    );
}

fn diet_with_media() -> CreateDietEntry {
    CreateDietEntry {
        occurred_at: datetime!(2026-07-30 12:00:00 UTC),
        meal_type: MealType::Lunch,
        food_name: "Rice".to_string(),
        note: None,
        tags: vec!["rice".to_string()],
        media: Some(MediaUpload::new("image/png", PNG)),
        actor: "test".to_string(),
    }
}

struct Fixture {
    _directory: tempfile::TempDir,
    database: std::path::PathBuf,
    media: std::path::PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let directory = tempfile::tempdir().unwrap();
        Self {
            database: directory.path().join("health.sqlite"),
            media: directory.path().join("media"),
            _directory: directory,
        }
    }

    fn service(&self) -> HealthService<SqliteHealthRepository, LocalMediaStore> {
        HealthService::new(
            SqliteHealthRepository::open(&self.database).unwrap(),
            LocalMediaStore::new(&self.media).unwrap(),
        )
    }

    fn toggle_service(
        &self,
        fail: Arc<AtomicBool>,
    ) -> HealthService<SqliteHealthRepository, ToggleStore> {
        HealthService::new(
            SqliteHealthRepository::open(&self.database).unwrap(),
            ToggleStore {
                inner: LocalMediaStore::new(&self.media).unwrap(),
                fail,
            },
        )
    }
}

struct ToggleStore {
    inner: LocalMediaStore,
    fail: Arc<AtomicBool>,
}

impl MediaStore for ToggleStore {
    type Staged = LocalStagedMedia;

    fn stage(&self, content_type: &str, bytes: &[u8]) -> HealthResult<Self::Staged> {
        self.inner.stage(content_type, bytes)
    }

    fn finalize(&self, staged: Self::Staged) -> HealthResult<StoredMedia> {
        self.inner.finalize(staged)
    }

    fn abort(&self, staged: Self::Staged) -> HealthResult<()> {
        self.inner.abort(staged)
    }

    fn confirm(&self, stored: &StoredMedia) -> HealthResult<()> {
        self.inner.confirm(stored)
    }

    fn remove(&self, relative_path: &std::path::Path) -> HealthResult<()> {
        if self.fail.load(Ordering::SeqCst) {
            Err(HealthError::Storage("injected remove failure".to_string()))
        } else {
            self.inner.remove(relative_path)
        }
    }
}
