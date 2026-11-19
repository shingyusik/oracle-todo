use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};
use std::time::Duration as StdDuration;

use rusqlite::Connection;
use time::{Duration, OffsetDateTime, UtcOffset};

use super::*;

#[path = "../../tests/support/retention_fixture.rs"]
mod fixture;

use fixture::FixtureHome;

fn paths(fixture: &FixtureHome) -> RetentionPaths {
    RetentionPaths {
        home: fixture.home.clone(),
        todo_db: fixture.todo_db(),
        ledger_db: fixture.ledger_db(),
        health_db: fixture.health_db(),
        health_media_dir: fixture.media_dir(),
    }
}

fn builder(fixture: &FixtureHome) -> RetentionBuilder {
    Retention::builder(paths(fixture), UtcOffset::UTC)
        .env_disabled(false)
        .free_space(Arc::new(|_| Ok(u64::MAX)))
}

fn retention(fixture: &FixtureHome) -> Retention {
    builder(fixture).build()
}

fn fixed_clock(at: OffsetDateTime) -> Clock {
    Arc::new(move || at)
}

fn counts(pairs: &[(&str, u64)]) -> BTreeMap<String, u64> {
    pairs.iter().map(|(k, v)| ((*k).to_owned(), *v)).collect()
}

fn run(retention: &Retention) -> LastRun {
    let report = retention.run(Trigger::Cli).unwrap();
    assert_eq!(report.skipped, None);
    report.last_run.unwrap()
}

fn files_under(dir: &std::path::Path) -> Vec<String> {
    let mut found = Vec::new();
    let mut stack = vec![dir.to_path_buf()];
    while let Some(next) = stack.pop() {
        for entry in std::fs::read_dir(&next).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                stack.push(path.clone());
            }
            found.push(path.strip_prefix(dir).unwrap().display().to_string());
        }
    }
    found.sort();
    found
}

#[cfg(unix)]
fn mode(path: &std::path::Path) -> u32 {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(path).unwrap().permissions().mode() & 0o777
}

#[test]
fn missing_settings_yield_defaults_without_creating_files() {
    let fixture = FixtureHome::empty();
    let retention = retention(&fixture);
    assert_eq!(
        retention.settings().unwrap(),
        RetentionSettings {
            enabled: true,
            retention_days: 30,
            backup_keep: 3
        }
    );
    let status = retention.status().unwrap();
    assert_eq!(status.env_override, None);
    assert!(status.last_run.is_none());
    assert!(!status.schedule.scheduler_active);
    assert!(files_under(&fixture.home).is_empty());
}

#[test]
fn settings_updates_are_validated_and_written_privately() {
    let fixture = FixtureHome::empty();
    let retention = retention(&fixture);
    for (update, field) in [
        (
            SettingsUpdate {
                retention_days: Some(6),
                ..Default::default()
            },
            "retention_days",
        ),
        (
            SettingsUpdate {
                retention_days: Some(3651),
                ..Default::default()
            },
            "retention_days",
        ),
        (
            SettingsUpdate {
                backup_keep: Some(0),
                ..Default::default()
            },
            "backup_keep",
        ),
        (
            SettingsUpdate {
                backup_keep: Some(31),
                ..Default::default()
            },
            "backup_keep",
        ),
    ] {
        match retention.update_settings(update) {
            Err(RetentionError::Validation { field: actual }) => assert_eq!(actual, field),
            other => panic!("expected validation error, got {other:?}"),
        }
    }
    assert!(
        files_under(&fixture.home).is_empty(),
        "invalid updates write nothing"
    );

    let saved = retention
        .update_settings(SettingsUpdate {
            enabled: Some(false),
            retention_days: Some(7),
            backup_keep: None,
        })
        .unwrap();
    assert_eq!(
        saved,
        RetentionSettings {
            enabled: false,
            retention_days: 7,
            backup_keep: 3
        }
    );
    assert_eq!(retention.settings().unwrap(), saved);
    let file = fixture.home.join("maintenance/retention.json");
    let json: serde_json::Value = serde_json::from_slice(&std::fs::read(&file).unwrap()).unwrap();
    assert_eq!(
        json,
        serde_json::json!({"version":1,"enabled":false,"retention_days":7,"backup_keep":3})
    );
    #[cfg(unix)]
    {
        assert_eq!(mode(&file), 0o600);
        assert_eq!(mode(&fixture.home.join("maintenance")), 0o700);
    }
    assert_eq!(
        files_under(&fixture.home),
        ["maintenance", "maintenance/retention.json"]
    );
}

#[test]
fn env_kill_switch_disables_scheduler_but_reports_override() {
    let fixture = FixtureHome::initialized();
    fixture::seed(&fixture);
    let retention = builder(&fixture).env_disabled(true).build();
    let status = retention.status().unwrap();
    assert_eq!(status.env_override, Some("disabled"));
    assert_eq!(status.schedule.next_run_at, None);
    assert!(retention.scheduled_check().is_none());
    assert!(retention.last_run().unwrap().is_none());
    assert!(!fixture.backups_dir().exists());
}

#[test]
fn a_held_lock_skips_the_run_as_locked() {
    let fixture = FixtureHome::initialized();
    fixture::seed(&fixture);
    let retention = retention(&fixture);
    let held = lock::try_acquire(retention.paths()).unwrap().unwrap();
    let report = retention.run(Trigger::Api).unwrap();
    assert_eq!(report.skipped, Some("locked"));
    assert!(report.last_run.is_none());
    assert!(retention.last_run().unwrap().is_none());
    assert!(!fixture.backups_dir().exists());
    drop(held);
    assert_eq!(run(&retention).outcome, "ok");
}

#[test]
fn nothing_due_records_the_run_without_a_backup() {
    let fixture = FixtureHome::initialized();
    let retention = retention(&fixture);
    let last = run(&retention);
    assert_eq!(last.outcome, "nothing_due");
    assert!(last.backup.is_none());
    for domain in ["todo", "ledger", "health"] {
        assert_eq!(last.domains[domain].status, "nothing_due");
    }
    assert!(!fixture.home.join("backups").exists());
    assert_eq!(retention.last_run().unwrap(), Some(last));
}

#[test]
fn missing_stores_are_nothing_due_and_never_created() {
    let fixture = FixtureHome::empty();
    let retention = retention(&fixture);
    let last = run(&retention);
    assert_eq!(last.outcome, "nothing_due");
    assert!(!fixture.todo_db().exists());
    assert!(!fixture.ledger_db().exists());
    assert!(!fixture.health_db().exists());
}

#[test]
fn backup_is_verified_versioned_private_and_includes_media() {
    let fixture = FixtureHome::initialized();
    let seeded = fixture::seed(&fixture);
    let media_bytes =
        std::fs::read(fixture.media_dir().join(&seeded.health_old_media_path)).unwrap();
    let versions = ["todo", "ledger", "health"].map(|domain| {
        Connection::open(fixture.home.join(format!("{domain}.sqlite")))
            .unwrap()
            .pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
            .unwrap()
    });
    let retention = retention(&fixture);
    let last = run(&retention);
    let name = last.backup.clone().unwrap().name;
    assert!(backup::is_backup_name(&name), "{name}");
    assert_eq!(fixture.backup_names(), std::slice::from_ref(&name));
    let folder = fixture.backups_dir().join(&name);
    for (domain, version) in ["todo", "ledger", "health"].iter().zip(versions) {
        let copy = Connection::open(folder.join(format!("{domain}.sqlite"))).unwrap();
        let check: String = copy
            .query_row("PRAGMA quick_check", [], |row| row.get(0))
            .unwrap();
        assert_eq!(check, "ok");
        let copied: i64 = copy
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap();
        assert_eq!(copied, version, "{domain}");
    }
    let todo_copy = Connection::open(folder.join("todo.sqlite")).unwrap();
    let old_in_backup: i64 = todo_copy
        .query_row(
            "SELECT COUNT(*) FROM items WHERE id = ?1",
            [&seeded.todo_old[0]],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(old_in_backup, 1, "backup precedes the purge");
    assert_eq!(
        std::fs::read(folder.join("media").join(&seeded.health_old_media_path)).unwrap(),
        media_bytes
    );
    let manifest = std::fs::read_to_string(folder.join("manifest.json")).unwrap();
    for secret in fixture::SECRET_TITLES.iter().copied().chain([
        seeded.todo_old[0].as_str(),
        seeded.health_old_media.as_str(),
    ]) {
        assert!(!manifest.contains(secret), "manifest leaks {secret}");
    }
    assert!(!manifest.contains(fixture.home.to_str().unwrap()));
    let manifest: serde_json::Value = serde_json::from_str(&manifest).unwrap();
    assert_eq!(manifest["media"]["files"], 1);
    assert_eq!(manifest["domains"]["todo"]["candidates"]["todo_item"], 2);
    #[cfg(unix)]
    {
        assert_eq!(mode(&folder), 0o700);
        assert_eq!(mode(&fixture.backups_dir()), 0o700);
        assert_eq!(mode(&folder.join("todo.sqlite")), 0o600);
        assert_eq!(mode(&folder.join("manifest.json")), 0o600);
    }
    assert!(
        !files_under(&fixture.backups_dir())
            .iter()
            .any(|name| name.starts_with(".tmp-")),
        "temporary folder is renamed away"
    );
}

#[test]
fn rotation_keeps_the_newest_matching_folders_only() {
    let fixture = FixtureHome::initialized();
    fixture::seed(&fixture);
    let root = fixture.backups_dir();
    let old = [
        "20200101T000000Z",
        "20200102T000000Z",
        "20200103T000000Z",
        "20200104T000000Z",
    ];
    for name in old
        .iter()
        .chain(&["notes", "2020-01-05", ".tmp-stale", "20200105T000000"])
    {
        std::fs::create_dir_all(root.join(name)).unwrap();
    }
    std::fs::write(root.join("19990101T000000Z"), b"a file is not a backup").unwrap();
    let last = run(&retention(&fixture));
    let new = last.backup.unwrap().name;
    let mut remaining = files_under(&root);
    remaining.retain(|name| !name.contains('/'));
    let mut expected = vec![
        ".tmp-stale".to_owned(),
        "19990101T000000Z".to_owned(),
        "2020-01-05".to_owned(),
        "20200103T000000Z".to_owned(),
        "20200104T000000Z".to_owned(),
        "20200105T000000".to_owned(),
        new,
        "notes".to_owned(),
    ];
    expected.sort();
    assert_eq!(remaining, expected);
}

#[test]
fn low_disk_skips_the_whole_run_without_purging() {
    let fixture = FixtureHome::initialized();
    let seeded = fixture::seed(&fixture);
    let retention = builder(&fixture)
        .free_space(Arc::new(|_| Ok(1024 * 1024)))
        .build();
    let last = run(&retention);
    assert_eq!(last.outcome, "insufficient_disk");
    assert!(last.backup.is_none());
    assert!(!fixture.home.join("backups").exists());
    assert_eq!(
        fixture::count(
            &fixture.todo_db(),
            "SELECT COUNT(*) FROM items WHERE id = ?1",
            &seeded.todo_old[0]
        ),
        1
    );
    assert!(last.domains.values().all(|domain| domain.purged.is_empty()));
}

#[test]
fn a_failing_domain_leaves_others_purged_as_partial() {
    let fixture = FixtureHome::initialized();
    let seeded = fixture::seed(&fixture);
    let retention = retention(&fixture);
    retention.fail_apply_for(Domain::Ledger);
    let last = run(&retention);
    assert_eq!(last.outcome, "partial");
    assert_eq!(last.domains["ledger"].status, "failed");
    assert!(last.domains["ledger"].purged.is_empty());
    assert_eq!(last.domains["todo"].status, "ok");
    assert_eq!(last.domains["health"].status, "ok");
    assert!(last.backup.is_some());
    assert_eq!(
        fixture::count(
            &fixture.ledger_db(),
            "SELECT COUNT(*) FROM ledger_entries WHERE id = ?1",
            &seeded.ledger_old_entry
        ),
        1
    );
    assert_eq!(
        fixture::count(
            &fixture.todo_db(),
            "SELECT COUNT(*) FROM items WHERE id = ?1",
            &seeded.todo_old[0]
        ),
        0
    );
}

#[test]
fn a_regressed_clock_skips_without_recording() {
    let fixture = FixtureHome::initialized();
    let now = OffsetDateTime::now_utc();
    let first = builder(&fixture).clock(fixed_clock(now)).build();
    let recorded = run(&first);
    let earlier = builder(&fixture)
        .clock(fixed_clock(now - Duration::hours(1)))
        .build();
    let report = earlier.run(Trigger::Cli).unwrap();
    assert_eq!(report.skipped, Some("clock_regressed"));
    assert_eq!(report.last_run, Some(recorded.clone()));
    assert_eq!(earlier.last_run().unwrap(), Some(recorded));
}

#[test]
fn skipped_counts_merge_plan_and_apply_skips_once_per_domain() {
    let fixture = FixtureHome::initialized();
    fixture::seed(&fixture);
    // One unparseable ToDo clock and one unparseable Health clock: plan-time skips.
    Connection::open(fixture.todo_db())
        .unwrap()
        .execute(
            "INSERT INTO items (id, type, title, status, materialization_policy,
                future_occurrences, proposed_by, archived_at, metadata, created_at, updated_at)
             VALUES ('00000000-0000-4000-8000-0000000000ff', 'task', 'synthetic-bad', 'archived',
                'per_occurrence', 3, 'user', 'not-a-time', '{}', 'not-a-time', 'not-a-time')",
            [],
        )
        .unwrap();
    // A live diet sharing the old photo keeps it: a plan-time `media_shared` skip.
    let health = Connection::open(fixture.health_db()).unwrap();
    health
        .execute(
            "INSERT INTO diet_entries (
                id, occurred_at, local_date, meal_type, food_name, note, media_id,
                created_at, updated_at, deleted_at
             ) SELECT '00000000-0000-4000-8000-0000000000fe', occurred_at, local_date,
                meal_type, 'synthetic-sharer', NULL, media_id, created_at, updated_at, NULL
               FROM diet_entries WHERE food_name = 'synthetic-old-toast'",
            [],
        )
        .unwrap();
    drop(health);

    let retention = retention(&fixture);
    let preview = retention.preview(50).unwrap();
    assert_eq!(
        preview.domains["todo"].skipped,
        counts(&[("unparseable_timestamp", 1)])
    );
    assert_eq!(
        preview.domains["health"].skipped,
        counts(&[("media_shared", 1)])
    );
    let last = run(&retention);
    assert_eq!(
        last.domains["todo"].skipped,
        counts(&[("unparseable_timestamp", 1)])
    );
    assert_eq!(
        last.domains["health"].skipped,
        counts(&[("media_shared", 1)])
    );
    assert_eq!(
        last.domains["health"].purged,
        counts(&[("health_bowel", 1), ("health_diet", 1)])
    );
    assert!(last.domains["ledger"].skipped.is_empty());
}

#[test]
fn health_normalization_adds_plan_skips_that_the_engine_omits() {
    use health_engine::application::retention::{RetentionOutcome, RetentionPlan, RetentionWindow};
    let now = OffsetDateTime::now_utc();
    let window = RetentionWindow {
        now,
        cutoff: now,
        local_today: now.date(),
    };
    let mut plan = RetentionPlan::empty(window);
    plan.skipped.insert("media_shared", 2);
    let fixture = FixtureHome::initialized();
    let retention = retention(&fixture);
    // An empty-candidate apply returns only apply-time skips (none).
    let engine = health_engine::application::service::HealthService::new(
        health_engine::infrastructure::sqlite::SqliteHealthRepository::open(fixture.health_db())
            .unwrap(),
        health_engine::infrastructure::media::LocalMediaStore::new(fixture.media_dir()).unwrap(),
    )
    .retention_apply(&plan)
    .unwrap();
    assert_eq!(engine, RetentionOutcome::default());
    let applied = run::apply(&retention, &plan::EnginePlan::Health(plan)).unwrap();
    assert_eq!(applied.skipped, BTreeMap::from([("media_shared", 2)]));
}

#[test]
fn todo_and_ledger_outcomes_already_include_plan_skips() {
    let now = OffsetDateTime::now_utc();
    let fixture = FixtureHome::initialized();
    let retention = retention(&fixture);
    let mut todo =
        todo_engine::retention::RetentionPlan::empty(todo_engine::retention::RetentionWindow {
            now,
            cutoff: now,
            local_today: now.date(),
        });
    todo.skipped.insert("referenced", 3);
    let applied = run::apply(&retention, &plan::EnginePlan::Todo(todo)).unwrap();
    assert_eq!(applied.skipped, BTreeMap::from([("referenced", 3)]));

    let mut ledger = ledger_engine::application::retention::RetentionPlan::empty(
        ledger_engine::application::retention::RetentionWindow {
            now,
            cutoff: now,
            local_today: now.date(),
        },
    );
    ledger.skipped.insert("invalid_transfer_pair", 1);
    let applied = run::apply(&retention, &plan::EnginePlan::Ledger(ledger)).unwrap();
    assert_eq!(
        applied.skipped,
        BTreeMap::from([("invalid_transfer_pair", 1)])
    );
}

#[test]
fn preview_is_read_only_and_bounded() {
    let empty = FixtureHome::empty();
    let preview = retention(&empty).preview(50).unwrap();
    assert_eq!(preview.retention_days, 30);
    for domain in ["todo", "ledger", "health"] {
        assert_eq!(preview.domains[domain].status, "not_initialized");
    }
    assert!(
        files_under(&empty.home).is_empty(),
        "preview creates nothing"
    );

    let fixture = FixtureHome::initialized();
    let seeded = fixture::seed(&fixture);
    let before = files_under(&fixture.home);
    let retention = retention(&fixture);
    let preview = retention.preview(1).unwrap();
    let todo = &preview.domains["todo"];
    assert_eq!(todo.status, "ok");
    assert_eq!(todo.counts, counts(&[("todo_item", 2)]));
    assert_eq!(todo.items.len(), 1);
    assert!(todo.truncated);
    assert!(seeded.todo_old.contains(&todo.items[0].id));
    assert_eq!(
        preview.domains["ledger"].counts,
        counts(&[("ledger_entry", 1), ("ledger_transfer", 1)])
    );
    assert_eq!(
        preview.domains["health"].counts,
        counts(&[("health_bowel", 1), ("health_diet", 1), ("health_media", 1)])
    );
    assert_eq!(files_under(&fixture.home), before, "preview writes nothing");
    assert!(retention.last_run().unwrap().is_none());
}

#[test]
fn end_to_end_run_purges_due_records_leaves_tombstones_and_a_healthy_ledger() {
    let fixture = FixtureHome::initialized();
    let seeded = fixture::seed(&fixture);
    let retention = retention(&fixture);
    let preview = retention.preview(200).unwrap();
    let last = run(&retention);
    assert_eq!(last.outcome, "ok");
    assert_eq!(last.trigger, "cli");
    assert_eq!(last.media_cleanup_pending, 0);
    for domain in ["todo", "ledger", "health"] {
        assert_eq!(last.domains[domain].status, "ok");
        assert_eq!(
            last.domains[domain].purged, preview.domains[domain].counts,
            "{domain}: purge counts match the preview"
        );
    }
    assert_eq!(last.domains["todo"].purged, counts(&[("todo_item", 2)]));

    let todo = fixture.todo_db();
    for id in &seeded.todo_old {
        assert_eq!(
            fixture::count(&todo, "SELECT COUNT(*) FROM items WHERE id = ?1", id),
            0
        );
        assert_eq!(
            fixture::count(
                &todo,
                "SELECT COUNT(*) FROM events WHERE object_id = ?1 AND action = 'purge'
                 AND reason = 'retention' AND before IS NULL AND after IS NULL",
                id
            ),
            1
        );
        assert_eq!(
            fixture::count(
                &todo,
                "SELECT COUNT(*) FROM events WHERE object_id = ?1",
                id
            ),
            1
        );
    }
    for id in &seeded.todo_young {
        assert_eq!(
            fixture::count(&todo, "SELECT COUNT(*) FROM items WHERE id = ?1", id),
            1
        );
    }

    let ledger = fixture.ledger_db();
    let entry_count = |id: &str| {
        fixture::count(
            &ledger,
            "SELECT COUNT(*) FROM ledger_entries WHERE id = ?1",
            id,
        )
    };
    assert_eq!(entry_count(&seeded.ledger_old_entry), 0);
    assert_eq!(entry_count(&seeded.ledger_young_entry), 1);
    assert_eq!(
        fixture::count(
            &ledger,
            "SELECT COUNT(*) FROM ledger_entries WHERE transfer_group_id = ?1",
            &seeded.ledger_old_transfer
        ),
        0
    );
    let report = ledger_engine::application::service::LedgerService::new(
        ledger_engine::infrastructure::sqlite::SqliteLedgerRepository::open_read_only(&ledger)
            .unwrap(),
    )
    .doctor()
    .unwrap();
    assert!(report.healthy, "{:?}", report.issues);

    let health = fixture.health_db();
    assert_eq!(
        fixture::count(
            &health,
            "SELECT COUNT(*) FROM diet_entries WHERE id = ?1",
            &seeded.health_old_diet
        ),
        0
    );
    assert_eq!(
        fixture::count(
            &health,
            "SELECT COUNT(*) FROM diet_entries WHERE id = ?1",
            &seeded.health_young_diet
        ),
        1
    );
    assert_eq!(
        fixture::count(
            &health,
            "SELECT COUNT(*) FROM health_events WHERE id = ?1",
            &seeded.health_old_bowel
        ),
        0
    );
    assert!(
        !fixture
            .media_dir()
            .join(&seeded.health_old_media_path)
            .exists()
    );
    assert_eq!(
        fixture::count(
            &health,
            "SELECT COUNT(*) FROM audit_events WHERE record_id = ?1 AND action = 'purge'",
            &seeded.health_old_diet
        ),
        1
    );

    // A second run right away is nothing-due and adds no backup.
    let again = run(&retention);
    assert_eq!(again.outcome, "nothing_due");
    assert_eq!(fixture.backup_names().len(), 1);
}

#[test]
fn due_logic_follows_enabled_env_and_the_daily_interval() {
    let now = OffsetDateTime::now_utc();
    let enabled = RetentionSettings::default();
    let disabled = RetentionSettings {
        enabled: false,
        ..enabled
    };
    assert!(is_due(&enabled, false, None, now));
    assert!(!is_due(&disabled, false, None, now));
    assert!(!is_due(&enabled, true, None, now));
    assert!(!is_due(
        &enabled,
        false,
        Some(now - Duration::hours(23)),
        now
    ));
    assert!(is_due(
        &enabled,
        false,
        Some(now - Duration::hours(24)),
        now
    ));

    let status = SchedulerStatus {
        active: true,
        next_check_at: Some(now + Duration::minutes(5)),
        interval: StdDuration::from_secs(3600),
    };
    assert_eq!(
        scheduler::next_run_at(&enabled, false, status, None),
        Some(now + Duration::minutes(5))
    );
    assert_eq!(
        scheduler::next_run_at(&enabled, false, status, Some(now - Duration::hours(2))),
        Some(now + Duration::hours(22) + Duration::minutes(5))
    );
    assert_eq!(scheduler::next_run_at(&disabled, false, status, None), None);
    assert_eq!(scheduler::next_run_at(&enabled, true, status, None), None);
    assert_eq!(
        scheduler::next_run_at(
            &enabled,
            false,
            SchedulerStatus {
                active: false,
                ..status
            },
            None
        ),
        None
    );
}

#[test]
fn scheduled_check_runs_once_per_day_with_an_injected_clock() {
    let fixture = FixtureHome::initialized();
    let now = Arc::new(Mutex::new(OffsetDateTime::now_utc()));
    let clock_now = now.clone();
    let retention = builder(&fixture)
        .clock(Arc::new(move || *clock_now.lock().unwrap()))
        .build();
    assert!(retention.scheduled_check().is_some(), "never ran => due");
    assert!(retention.scheduled_check().is_none(), "just ran => not due");
    *now.lock().unwrap() += Duration::hours(23);
    assert!(retention.scheduled_check().is_none());
    *now.lock().unwrap() += Duration::hours(1);
    let report = retention.scheduled_check().unwrap();
    assert_eq!(report.last_run.unwrap().trigger, "scheduled");

    retention
        .update_settings(SettingsUpdate {
            enabled: Some(false),
            ..Default::default()
        })
        .unwrap();
    *now.lock().unwrap() += Duration::hours(48);
    assert!(
        retention.scheduled_check().is_none(),
        "disabled => never due"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn scheduler_task_waits_then_runs_and_reports_activity() {
    let fixture = FixtureHome::initialized();
    let retention = retention(&fixture);
    let handle = retention.spawn_scheduler(SchedulerTiming {
        initial_delay: StdDuration::from_millis(200),
        interval: StdDuration::from_secs(3600),
    });
    tokio::time::sleep(StdDuration::from_millis(50)).await;
    let status = retention.status().unwrap();
    assert!(status.schedule.scheduler_active);
    assert!(status.schedule.next_run_at.is_some());
    assert!(
        retention.last_run().unwrap().is_none(),
        "first check is delayed"
    );
    let deadline = std::time::Instant::now() + StdDuration::from_secs(30);
    while retention.last_run().unwrap().is_none() {
        assert!(std::time::Instant::now() < deadline, "scheduler never ran");
        tokio::time::sleep(StdDuration::from_millis(50)).await;
    }
    assert_eq!(retention.last_run().unwrap().unwrap().trigger, "scheduled");
    handle.abort();
    assert!(handle.await.unwrap_err().is_cancelled());

    let disabled = builder(&fixture).env_disabled(true).build();
    let handle = disabled.spawn_scheduler(SchedulerTiming {
        initial_delay: StdDuration::from_millis(1),
        interval: StdDuration::from_millis(1),
    });
    handle.await.unwrap();
    assert!(!disabled.status().unwrap().schedule.scheduler_active);
}

#[derive(Clone, Default)]
struct Captured(Arc<Mutex<Vec<u8>>>);

impl std::io::Write for Captured {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(bytes);
        Ok(bytes.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

#[test]
fn logs_carry_counts_and_events_but_no_ids_titles_or_paths() {
    let fixture = FixtureHome::initialized();
    let seeded = fixture::seed(&fixture);
    let retention = retention(&fixture);
    retention.fail_apply_for(Domain::Health);
    let captured = Captured::default();
    let writer = captured.clone();
    let subscriber = tracing_subscriber::fmt()
        .json()
        .with_max_level(tracing::Level::TRACE)
        .with_writer(move || writer.clone())
        .finish();
    tracing::subscriber::with_default(subscriber, || {
        run(&retention);
        let _ = retention.run(Trigger::Cli);
    });
    let logs = String::from_utf8(captured.0.lock().unwrap().clone()).unwrap();
    for event in [
        "retention_run_started",
        "retention_backup_created",
        "retention_domain_purged",
        "retention_domain_failed",
        "retention_backup_pruned",
        "retention_run_completed",
    ] {
        assert!(logs.contains(event), "missing {event}: {logs}");
    }
    let mut secrets = fixture::SECRET_TITLES.map(str::to_owned).to_vec();
    secrets.extend(seeded.todo_old.iter().cloned());
    secrets.extend([
        seeded.ledger_old_entry.clone(),
        seeded.ledger_old_transfer.clone(),
        seeded.health_old_diet.clone(),
        seeded.health_old_media.clone(),
        seeded.health_old_bowel.clone(),
        fixture.home.display().to_string(),
        "SELECT".to_owned(),
    ]);
    for secret in secrets {
        assert!(!logs.contains(&secret), "log leaks {secret}");
    }
    for line in logs.lines() {
        let value: serde_json::Value = serde_json::from_str(line).unwrap();
        assert_eq!(value["target"], "raven_api", "{line}");
    }
}
