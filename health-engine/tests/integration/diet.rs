use std::fs;

use health_engine::application::commands::{
    CreateDietEntry, DietMediaUpdate, MediaUpload, UpdateDietEntry,
};
use health_engine::application::error::HealthError;
use health_engine::application::media::StoredMedia;
use health_engine::application::ports::Page;
use health_engine::application::service::HealthService;
use health_engine::domain::MealType;
use health_engine::infrastructure::media::LocalMediaStore;
use health_engine::infrastructure::sqlite::SqliteHealthRepository;
use rusqlite::Connection;
use time::OffsetDateTime;
use time::UtcOffset;
use time::format_description::well_known::Rfc3339;
use time::macros::datetime;

const PNG: &[u8] = &[
    0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, b'I', b'H', b'D', b'R', 0, 0, 0,
    1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0x1f, 0x15, 0xc4, 0x89, 0, 0, 0, 10, b'I', b'D', b'A', b'T',
    0x78, 0x9c, 0x63, 0, 1, 0, 0, 5, 0, 1, 0x0d, 0x0a, 0x2d, 0xb4, 0, 0, 0, 0, b'I', b'E', b'N',
    b'D', 0xae, 0x42, 0x60, 0x82,
];

#[test]
fn create_diet_normalizes_tags_and_commits_media_links_and_audits_atomically() {
    let fixture = Fixture::new();
    let mut service = fixture.service();

    let entry = service
        .create_diet(CreateDietEntry {
            occurred_at: datetime!(2026-07-30 23:30:00 +09:00),
            meal_type: MealType::LateNight,
            food_name: "Toast".to_string(),
            note: Some("after exercise".to_string()),
            tags: vec![
                " Wheat ".to_string(),
                "coffee".to_string(),
                "COFFEE".to_string(),
            ],
            media: Some(MediaUpload::new("image/png", PNG)),
            actor: "integration-test".to_string(),
        })
        .unwrap();

    assert_eq!(entry.tags(), &["coffee".to_string(), "wheat".to_string()]);
    assert_eq!(
        service.get_diet(entry.id().as_str()).unwrap().id(),
        entry.id()
    );
    assert_eq!(
        service.list_diet(Page::default()).unwrap(),
        vec![entry.clone()]
    );
    let diet_audits = service
        .audit_for("diet_entry", entry.id().as_str(), Page::default())
        .unwrap();
    assert_eq!(diet_audits.len(), 1);
    assert_eq!(diet_audits[0].action(), "create");
    assert_eq!(
        diet_audits[0].after().unwrap()["tags"],
        serde_json::json!(["coffee", "wheat"])
    );

    let media = service
        .get_media(entry.media_id().unwrap().as_str())
        .unwrap();
    assert_media_file(&fixture, &media);
    let media_audits = service
        .audit_for("media_file", media.id(), Page::default())
        .unwrap();
    assert_eq!(media_audits.len(), 1);
    assert_eq!(media_audits[0].request_id(), diet_audits[0].request_id());
    let media_snapshot = media_audits[0].after().unwrap();
    assert!(media_snapshot.get("bytes").is_none());
    assert!(media_snapshot.get("relative_path").is_none());

    let connection = Connection::open(&fixture.database).unwrap();
    assert_eq!(
        connection
            .query_row(
                "SELECT local_date FROM diet_entries WHERE id = ?1",
                [entry.id().as_str()],
                |row| row.get::<_, String>(0),
            )
            .unwrap(),
        "2026-07-30"
    );
    assert_eq!(
        connection
            .query_row(
                "SELECT COUNT(*) FROM diet_entry_tags WHERE diet_entry_id = ?1",
                [entry.id().as_str()],
                |row| row.get::<_, i64>(0),
            )
            .unwrap(),
        2
    );
}

#[test]
fn update_diet_preserves_creation_time_replaces_tags_and_rejects_stale_writes() {
    let fixture = Fixture::new();
    let mut service = fixture.service();
    let before = service
        .create_diet(create_without_media(vec!["wheat", "coffee"]))
        .unwrap();

    let after = service
        .update_diet(
            before.id().as_str(),
            UpdateDietEntry {
                occurred_at: Some(datetime!(2026-07-31 08:00:00 +09:00)),
                meal_type: Some(MealType::Breakfast),
                food_name: Some("Rice porridge".to_string()),
                note: Some(Some("warm".to_string())),
                tags: Some(vec![
                    " Rice ".to_string(),
                    "rice".to_string(),
                    "SOY".to_string(),
                ]),
                media: DietMediaUpdate::Preserve,
                expected_updated_at: Some(before.updated_at()),
                actor: "integration-test".to_string(),
                reason: Some("correct meal".to_string()),
            },
        )
        .unwrap();

    assert_eq!(after.created_at(), before.created_at());
    assert!(after.updated_at() >= before.updated_at());
    assert_eq!(after.tags(), &["rice".to_string(), "soy".to_string()]);
    assert_eq!(after.note(), Some("warm"));
    assert_eq!(
        service
            .audit_for("diet_entry", after.id().as_str(), Page::default())
            .unwrap()
            .len(),
        2
    );

    let stale = service.update_diet(
        after.id().as_str(),
        UpdateDietEntry {
            food_name: Some("stale".to_string()),
            expected_updated_at: Some(before.updated_at()),
            actor: "integration-test".to_string(),
            ..UpdateDietEntry::default()
        },
    );
    assert!(matches!(stale, Err(HealthError::Conflict(_))));
    assert_eq!(
        service.get_diet(after.id().as_str()).unwrap().food_name(),
        "Rice porridge"
    );
    assert_eq!(
        service
            .audit_for("diet_entry", after.id().as_str(), Page::default())
            .unwrap()
            .len(),
        2
    );
}

#[test]
fn failed_diet_audit_rolls_back_database_and_removes_finalized_media() {
    let fixture = Fixture::new();
    let mut service = fixture.service();
    Connection::open(&fixture.database)
        .unwrap()
        .execute_batch(
            "CREATE TRIGGER reject_diet_audit
             BEFORE INSERT ON audit_events
             WHEN NEW.record_type = 'diet_entry'
             BEGIN
                 SELECT RAISE(ABORT, 'audit failure');
             END;",
        )
        .unwrap();

    let error = service
        .create_diet(CreateDietEntry {
            media: Some(MediaUpload::new("image/png", PNG)),
            ..create_without_media(vec!["wheat"])
        })
        .unwrap_err();

    assert!(matches!(error, HealthError::Storage(_)));
    let connection = Connection::open(&fixture.database).unwrap();
    for table in [
        "diet_entries",
        "diet_entry_tags",
        "media_files",
        "audit_events",
    ] {
        assert_eq!(
            connection
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                    row.get::<_, i64>(0)
                })
                .unwrap(),
            0,
            "{table} was not rolled back"
        );
    }
    assert_directory_empty(&fixture.media);
}

#[test]
fn failed_tag_link_rolls_back_diet_and_audit() {
    let fixture = Fixture::new();
    let mut service = fixture.service();
    Connection::open(&fixture.database)
        .unwrap()
        .execute_batch(
            "CREATE TRIGGER reject_tag_link
             BEFORE INSERT ON diet_entry_tags
             BEGIN
                 SELECT RAISE(ABORT, 'tag failure');
             END;",
        )
        .unwrap();

    assert!(matches!(
        service.create_diet(create_without_media(vec!["wheat"])),
        Err(HealthError::Storage(_))
    ));
    let connection = Connection::open(&fixture.database).unwrap();
    assert_eq!(
        connection
            .query_row("SELECT COUNT(*) FROM diet_entries", [], |row| row
                .get::<_, i64>(0))
            .unwrap(),
        0
    );
    assert_eq!(
        connection
            .query_row("SELECT COUNT(*) FROM audit_events", [], |row| row
                .get::<_, i64>(0))
            .unwrap(),
        0
    );
}

#[test]
fn media_replacement_removes_old_bytes_only_after_the_diet_commit() {
    let fixture = Fixture::new();
    let mut service = fixture.service();
    let before = service
        .create_diet(CreateDietEntry {
            media: Some(MediaUpload::new("image/png", PNG)),
            ..create_without_media(vec!["wheat"])
        })
        .unwrap();
    let old_media = service
        .get_media(before.media_id().unwrap().as_str())
        .unwrap();
    let old_path = fixture.media.join(old_media.relative_path());
    assert!(old_path.is_file());

    let after = service
        .update_diet(
            before.id().as_str(),
            UpdateDietEntry {
                media: DietMediaUpdate::Replace(MediaUpload::new("image/png", PNG)),
                expected_updated_at: Some(before.updated_at()),
                actor: "integration-test".to_string(),
                ..UpdateDietEntry::default()
            },
        )
        .unwrap();
    let new_media = service
        .get_media(after.media_id().unwrap().as_str())
        .unwrap();

    assert_ne!(old_media.id(), new_media.id());
    assert!(!old_path.exists());
    assert!(fixture.media.join(new_media.relative_path()).is_file());
    let connection = Connection::open(&fixture.database).unwrap();
    let old_state = connection
        .query_row(
            "SELECT cleanup_pending, deleted_at IS NOT NULL
             FROM media_files WHERE id = ?1",
            [old_media.id()],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
        )
        .unwrap();
    assert_eq!(old_state, (0, 1));
}

#[test]
fn media_remove_accepts_task_two_nested_canonical_paths_from_sqlite() {
    let fixture = Fixture::new();
    let mut service = fixture.service();
    let before = service
        .create_diet(CreateDietEntry {
            media: Some(MediaUpload::new("image/png", PNG)),
            ..create_without_media(vec!["wheat"])
        })
        .unwrap();
    let media = service
        .get_media(before.media_id().unwrap().as_str())
        .unwrap();
    let nested_relative = format!("2026/07/{}", media.relative_path().display());
    let nested_file = fixture.media.join(&nested_relative);
    fs::create_dir_all(nested_file.parent().unwrap()).unwrap();
    fs::rename(fixture.media.join(media.relative_path()), &nested_file).unwrap();
    Connection::open(&fixture.database)
        .unwrap()
        .execute(
            "UPDATE media_files SET relative_path = ?2 WHERE id = ?1",
            rusqlite::params![media.id(), nested_relative],
        )
        .unwrap();

    let after = service
        .update_diet(
            before.id().as_str(),
            UpdateDietEntry {
                media: DietMediaUpdate::Remove,
                expected_updated_at: Some(before.updated_at()),
                actor: "integration-test".to_string(),
                ..UpdateDietEntry::default()
            },
        )
        .unwrap();

    assert!(after.media_id().is_none());
    assert!(!nested_file.exists());
    let connection = Connection::open(&fixture.database).unwrap();
    assert_eq!(
        connection
            .query_row(
                "SELECT cleanup_pending, deleted_at IS NOT NULL
                 FROM media_files WHERE id = ?1",
                [media.id()],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
            )
            .unwrap(),
        (0, 1)
    );
}

#[test]
fn failed_replacement_commit_removes_new_bytes_and_keeps_old_media_and_diet() {
    let fixture = Fixture::new();
    let mut service = fixture.service();
    let before = service
        .create_diet(CreateDietEntry {
            media: Some(MediaUpload::new("image/png", PNG)),
            ..create_without_media(vec!["wheat"])
        })
        .unwrap();
    let old_media = service
        .get_media(before.media_id().unwrap().as_str())
        .unwrap();
    Connection::open(&fixture.database)
        .unwrap()
        .execute_batch(
            "CREATE TRIGGER reject_diet_update_audit
             BEFORE INSERT ON audit_events
             WHEN NEW.record_type = 'diet_entry' AND NEW.action = 'update'
             BEGIN
                 SELECT RAISE(ABORT, 'update audit failure');
             END;",
        )
        .unwrap();

    assert!(matches!(
        service.update_diet(
            before.id().as_str(),
            UpdateDietEntry {
                media: DietMediaUpdate::Replace(MediaUpload::new("image/png", PNG)),
                expected_updated_at: Some(before.updated_at()),
                actor: "integration-test".to_string(),
                ..UpdateDietEntry::default()
            }
        ),
        Err(HealthError::Storage(_))
    ));

    assert_eq!(
        service
            .get_diet(before.id().as_str())
            .unwrap()
            .media_id()
            .unwrap()
            .as_str(),
        old_media.id()
    );
    let paths = fs::read_dir(&fixture.media)
        .unwrap()
        .map(|entry| entry.unwrap().file_name())
        .collect::<Vec<_>>();
    assert_eq!(paths, vec![old_media.relative_path().as_os_str()]);
}

#[test]
fn deferred_foreign_key_commit_failure_removes_new_media_and_preserves_old_state() {
    let fixture = Fixture::new();
    let mut service = fixture.service();
    let before = service
        .create_diet(CreateDietEntry {
            media: Some(MediaUpload::new("image/png", PNG)),
            ..create_without_media(vec!["wheat"])
        })
        .unwrap();
    let old_media = service
        .get_media(before.media_id().unwrap().as_str())
        .unwrap();
    let connection = Connection::open(&fixture.database).unwrap();
    install_deferred_audit_commit_failure(
        &connection,
        "fail_diet_update_commit",
        "NEW.record_type = 'diet_entry' AND NEW.action = 'update'",
    );

    let result = service.update_diet(
        before.id().as_str(),
        UpdateDietEntry {
            media: DietMediaUpdate::Replace(MediaUpload::new("image/png", PNG)),
            expected_updated_at: Some(before.updated_at()),
            actor: "integration-test".to_string(),
            ..UpdateDietEntry::default()
        },
    );

    assert!(matches!(result, Err(HealthError::Storage(_))));
    assert_eq!(service.get_diet(before.id().as_str()).unwrap(), before);
    let paths = visible_media_files(&fixture.media);
    assert_eq!(paths, vec![old_media.relative_path().to_path_buf()]);
    assert_eq!(
        connection
            .query_row("SELECT COUNT(*) FROM media_files", [], |row| row
                .get::<_, i64>(0))
            .unwrap(),
        1
    );
    assert_eq!(
        connection
            .query_row("SELECT COUNT(*) FROM audit_events", [], |row| row
                .get::<_, i64>(0))
            .unwrap(),
        2
    );
}

#[cfg(unix)]
#[test]
fn actual_remove_failure_returns_committed_cleanup_pending_state() {
    use std::os::unix::fs::PermissionsExt;

    let fixture = Fixture::new();
    let mut service = fixture.service();
    let before = service
        .create_diet(CreateDietEntry {
            media: Some(MediaUpload::new("image/png", PNG)),
            ..create_without_media(vec!["wheat"])
        })
        .unwrap();
    let old_media = service
        .get_media(before.media_id().unwrap().as_str())
        .unwrap();
    fs::set_permissions(&fixture.media, fs::Permissions::from_mode(0o500)).unwrap();

    let result = service.update_diet(
        before.id().as_str(),
        UpdateDietEntry {
            media: DietMediaUpdate::Remove,
            expected_updated_at: Some(before.updated_at()),
            actor: "integration-test".to_string(),
            ..UpdateDietEntry::default()
        },
    );

    fs::set_permissions(&fixture.media, fs::Permissions::from_mode(0o700)).unwrap();
    assert!(matches!(
        result,
        Err(HealthError::CleanupPending { ref record_id, .. })
            if record_id == before.id().as_str()
    ));
    assert!(
        service
            .get_diet(before.id().as_str())
            .unwrap()
            .media_id()
            .is_none()
    );
    assert!(fixture.media.join(old_media.relative_path()).is_file());
    let connection = Connection::open(&fixture.database).unwrap();
    assert_eq!(media_cleanup_state(&connection, old_media.id()), (1, 1));
    assert_latest_detach_and_diet_update_share_request(&connection, &before, old_media.id());
}

#[test]
fn post_remove_cleanup_commit_failure_preserves_retryable_tombstone() {
    let fixture = Fixture::new();
    let mut service = fixture.service();
    let before = service
        .create_diet(CreateDietEntry {
            media: Some(MediaUpload::new("image/png", PNG)),
            ..create_without_media(vec!["wheat"])
        })
        .unwrap();
    let old_media = service
        .get_media(before.media_id().unwrap().as_str())
        .unwrap();
    let connection = Connection::open(&fixture.database).unwrap();
    install_deferred_audit_commit_failure(
        &connection,
        "fail_cleanup_commit",
        "NEW.record_type = 'media_file' AND NEW.action = 'cleanup'",
    );

    let result = service.update_diet(
        before.id().as_str(),
        UpdateDietEntry {
            media: DietMediaUpdate::Remove,
            expected_updated_at: Some(before.updated_at()),
            actor: "integration-test".to_string(),
            ..UpdateDietEntry::default()
        },
    );

    assert!(matches!(result, Err(HealthError::CleanupPending { .. })));
    assert!(!fixture.media.join(old_media.relative_path()).exists());
    assert!(
        service
            .get_diet(before.id().as_str())
            .unwrap()
            .media_id()
            .is_none()
    );
    assert_eq!(media_cleanup_state(&connection, old_media.id()), (1, 1));
    assert_eq!(
        connection
            .query_row(
                "SELECT COUNT(*) FROM audit_events
                 WHERE record_type = 'media_file' AND record_id = ?1 AND action = 'cleanup'",
                [old_media.id()],
                |row| row.get::<_, i64>(0),
            )
            .unwrap(),
        0
    );
    assert_latest_detach_and_diet_update_share_request(&connection, &before, old_media.id());
}

#[test]
fn standalone_media_keeps_duplicate_hashes_under_unique_generated_names_and_audits_each() {
    let fixture = Fixture::new();
    let mut service = fixture.service();

    let first = service.store_media("image/png", PNG).unwrap();
    let second = service.store_media("image/png", PNG).unwrap();

    assert_ne!(first.id(), second.id());
    assert_ne!(first.relative_path(), second.relative_path());
    assert_eq!(first.checksum_sha256(), second.checksum_sha256());
    assert!(fixture.media.join(first.relative_path()).is_file());
    assert!(fixture.media.join(second.relative_path()).is_file());
    for media in [&first, &second] {
        assert_eq!(
            service
                .audit_for("media_file", media.id(), Page::default())
                .unwrap()
                .len(),
            1
        );
    }
}

#[test]
fn standalone_media_database_failure_removes_the_finalized_file() {
    let fixture = Fixture::new();
    let mut service = fixture.service();
    Connection::open(&fixture.database)
        .unwrap()
        .execute_batch(
            "CREATE TRIGGER reject_media_audit
             BEFORE INSERT ON audit_events
             WHEN NEW.record_type = 'media_file'
             BEGIN
                 SELECT RAISE(ABORT, 'media audit failure');
             END;",
        )
        .unwrap();

    assert!(matches!(
        service.store_media("image/png", PNG),
        Err(HealthError::Storage(_))
    ));
    let connection = Connection::open(&fixture.database).unwrap();
    assert_eq!(
        connection
            .query_row("SELECT COUNT(*) FROM media_files", [], |row| row
                .get::<_, i64>(0))
            .unwrap(),
        0
    );
    assert_directory_empty(&fixture.media);
}

#[cfg(unix)]
#[test]
fn database_and_compensation_remove_failure_keeps_durable_recovery_identity() {
    use std::os::unix::fs::PermissionsExt;
    use std::sync::mpsc;
    use std::time::Duration as StdDuration;

    let fixture = Fixture::new();
    let mut service = fixture.service();
    let lock = Connection::open(&fixture.database).unwrap();
    lock.execute_batch("BEGIN IMMEDIATE;").unwrap();
    let media_directory = fixture.media.clone();
    let (ready_tx, ready_rx) = mpsc::sync_channel(1);
    let watcher = std::thread::spawn(move || {
        for _ in 0..100 {
            let published = fs::read_dir(&media_directory)
                .unwrap()
                .filter_map(Result::ok)
                .any(|entry| {
                    entry
                        .path()
                        .extension()
                        .is_some_and(|extension| extension == "png")
                });
            if published {
                fs::set_permissions(&media_directory, fs::Permissions::from_mode(0o500)).unwrap();
                ready_tx.send(()).unwrap();
                return media_directory;
            }
            std::thread::sleep(StdDuration::from_millis(5));
        }
        panic!("media was not published before the database lock timed out");
    });

    let result = service.store_media("image/png", PNG);
    ready_rx.recv_timeout(StdDuration::from_secs(2)).unwrap();
    let media_directory = watcher.join().unwrap();
    lock.execute_batch("ROLLBACK;").unwrap();
    fs::set_permissions(&media_directory, fs::Permissions::from_mode(0o700)).unwrap();

    let recovery = match result.unwrap_err() {
        HealthError::Cleanup {
            primary,
            recovery: Some(recovery),
            ..
        } => {
            assert!(matches!(*primary, HealthError::Busy(_)));
            *recovery
        }
        error => panic!("expected recoverable cleanup failure, got {error:?}"),
    };
    assert!(!recovery.relative_path().is_absolute());
    assert!(!recovery.journal_name().is_absolute());
    let store = LocalMediaStore::new(&fixture.media).unwrap();
    assert_eq!(store.list_recoveries().unwrap(), vec![recovery]);
}

#[test]
fn rejects_unbounded_audit_text_without_writing_diet_or_media() {
    let fixture = Fixture::new();
    let mut service = fixture.service();
    let command = CreateDietEntry {
        actor: "a".repeat(129),
        media: Some(MediaUpload::new("image/png", PNG)),
        ..create_without_media(vec!["wheat"])
    };

    assert!(matches!(
        service.create_diet(command),
        Err(HealthError::Validation { field: "actor", .. })
    ));
    let connection = Connection::open(&fixture.database).unwrap();
    assert_eq!(
        connection
            .query_row("SELECT COUNT(*) FROM diet_entries", [], |row| row
                .get::<_, i64>(0))
            .unwrap(),
        0
    );
    assert_directory_empty(&fixture.media);
}

#[test]
fn rejects_positive_offset_overflow_before_finalizing_create_media() {
    let fixture = Fixture::new();
    let mut service = fixture.service();
    let occurred_at = OffsetDateTime::parse("9999-12-31T20:00:00Z", &Rfc3339).unwrap();

    let result = service.create_diet(CreateDietEntry {
        occurred_at,
        media: Some(MediaUpload::new("image/png", PNG.to_vec())),
        ..create_without_media(vec!["wheat"])
    });

    assert!(matches!(
        result,
        Err(HealthError::Validation {
            field: "occurred_at",
            ..
        })
    ));
    assert_database_and_media_empty(&fixture);
}

#[test]
fn rejects_negative_offset_underflow_before_finalizing_update_media() {
    let fixture = Fixture::new();
    let mut service = fixture
        .service()
        .with_local_offset(UtcOffset::from_hms(-9, 0, 0).unwrap());
    let before = service
        .create_diet(create_without_media(vec!["wheat"]))
        .unwrap();
    let occurred_at = OffsetDateTime::parse("0000-01-01T04:00:00Z", &Rfc3339).unwrap();

    let result = service.update_diet(
        before.id().as_str(),
        UpdateDietEntry {
            occurred_at: Some(occurred_at),
            media: DietMediaUpdate::Replace(MediaUpload::new("image/png", PNG.to_vec())),
            expected_updated_at: Some(before.updated_at()),
            actor: "integration-test".to_string(),
            ..UpdateDietEntry::default()
        },
    );

    assert!(matches!(
        result,
        Err(HealthError::Validation {
            field: "occurred_at",
            ..
        })
    ));
    assert_eq!(service.get_diet(before.id().as_str()).unwrap(), before);
    assert_directory_empty(&fixture.media);
}

#[test]
fn rejects_unadvanceable_update_clock_before_finalizing_replacement_media() {
    let fixture = Fixture::new();
    let mut service = fixture.service();
    let before = service
        .create_diet(create_without_media(vec!["wheat"]))
        .unwrap();
    Connection::open(&fixture.database)
        .unwrap()
        .execute(
            "UPDATE diet_entries
             SET updated_at = '9999-12-31T23:59:59.999999999Z'
             WHERE id = ?1",
            [before.id().as_str()],
        )
        .unwrap();
    let before = service.get_diet(before.id().as_str()).unwrap();

    let result = service.update_diet(
        before.id().as_str(),
        UpdateDietEntry {
            media: DietMediaUpdate::Replace(MediaUpload::new("image/png", PNG)),
            expected_updated_at: Some(before.updated_at()),
            actor: "integration-test".to_string(),
            ..UpdateDietEntry::default()
        },
    );

    assert!(matches!(
        result,
        Err(HealthError::Conflict(_) | HealthError::Validation { .. })
    ));
    assert!(visible_media_files(&fixture.media).is_empty());
    assert!(
        LocalMediaStore::new(&fixture.media)
            .unwrap()
            .list_recoveries()
            .unwrap()
            .is_empty()
    );
}

#[test]
fn diet_read_and_update_reject_noncanonical_identifiers_before_querying() {
    let fixture = Fixture::new();
    let mut service = fixture.service();

    assert!(matches!(
        service.get_diet("not-a-uuid"),
        Err(HealthError::Validation { .. })
    ));
    assert!(matches!(
        service.update_diet(
            "abcdef00-0000-4000-8000-000000000001"
                .to_uppercase()
                .as_str(),
            UpdateDietEntry {
                actor: "integration-test".to_string(),
                ..UpdateDietEntry::default()
            }
        ),
        Err(HealthError::Validation { .. })
    ));
}

#[test]
fn media_upload_owned_constructor_preserves_the_allocation() {
    let bytes = PNG.to_vec();
    let allocation = bytes.as_ptr();

    let upload = MediaUpload::new("image/png", bytes);

    assert_eq!(upload.bytes.as_ptr(), allocation);
}

fn create_without_media(tags: Vec<&str>) -> CreateDietEntry {
    CreateDietEntry {
        occurred_at: datetime!(2026-07-30 12:00:00 +09:00),
        meal_type: MealType::Lunch,
        food_name: "Toast".to_string(),
        note: None,
        tags: tags.into_iter().map(str::to_string).collect(),
        media: None,
        actor: "integration-test".to_string(),
    }
}

fn assert_media_file(fixture: &Fixture, media: &StoredMedia) {
    assert_eq!(media.mime_type(), "image/png");
    assert_eq!(media.byte_size(), PNG.len() as u64);
    assert_eq!(
        media.checksum_sha256(),
        "ebf4f635a17d10d6eb46ba680b70142419aa3220f228001a036d311a22ee9d2a"
    );
    assert_eq!(
        fs::read(fixture.media.join(media.relative_path())).unwrap(),
        PNG
    );
}

fn assert_directory_empty(path: &std::path::Path) {
    assert_eq!(fs::read_dir(path).unwrap().count(), 0);
}

fn assert_database_and_media_empty(fixture: &Fixture) {
    let connection = Connection::open(&fixture.database).unwrap();
    assert_eq!(
        connection
            .query_row("SELECT COUNT(*) FROM diet_entries", [], |row| row
                .get::<_, i64>(0))
            .unwrap(),
        0
    );
    assert_eq!(
        connection
            .query_row("SELECT COUNT(*) FROM media_files", [], |row| row
                .get::<_, i64>(0))
            .unwrap(),
        0
    );
    assert_directory_empty(&fixture.media);
}

fn install_deferred_audit_commit_failure(
    connection: &Connection,
    trigger_name: &str,
    condition: &str,
) {
    connection
        .execute_batch(&format!(
            "CREATE TABLE IF NOT EXISTS test_commit_parent (id INTEGER PRIMARY KEY);
             CREATE TABLE IF NOT EXISTS test_commit_guard (
                 id INTEGER PRIMARY KEY,
                 parent_id INTEGER REFERENCES test_commit_parent(id)
                     DEFERRABLE INITIALLY DEFERRED
             );
             CREATE TRIGGER {trigger_name}
             AFTER INSERT ON audit_events
             WHEN {condition}
             BEGIN
                 INSERT INTO test_commit_guard (parent_id) VALUES (999);
             END;"
        ))
        .unwrap();
}

fn visible_media_files(root: &std::path::Path) -> Vec<std::path::PathBuf> {
    let mut paths = fs::read_dir(root)
        .unwrap()
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.extension()
                .is_some_and(|extension| matches!(extension.to_str(), Some("jpg" | "png" | "webp")))
        })
        .map(|path| path.strip_prefix(root).unwrap().to_path_buf())
        .collect::<Vec<_>>();
    paths.sort();
    paths
}

fn media_cleanup_state(connection: &Connection, media_id: &str) -> (i64, i64) {
    connection
        .query_row(
            "SELECT cleanup_pending, deleted_at IS NOT NULL
             FROM media_files WHERE id = ?1",
            [media_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap()
}

fn assert_latest_detach_and_diet_update_share_request(
    connection: &Connection,
    diet: &health_engine::domain::DietEntry,
    media_id: &str,
) {
    let diet_request = connection
        .query_row(
            "SELECT request_id FROM audit_events
             WHERE record_type = 'diet_entry' AND record_id = ?1 AND action = 'update'",
            [diet.id().as_str()],
            |row| row.get::<_, String>(0),
        )
        .unwrap();
    let media_request = connection
        .query_row(
            "SELECT request_id FROM audit_events
             WHERE record_type = 'media_file' AND record_id = ?1 AND action = 'detach'",
            [media_id],
            |row| row.get::<_, String>(0),
        )
        .unwrap();
    assert_eq!(diet_request, media_request);
}

struct Fixture {
    _directory: tempfile::TempDir,
    database: std::path::PathBuf,
    media: std::path::PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let directory = tempfile::tempdir().unwrap();
        let database = directory.path().join("health.sqlite");
        let media = directory.path().join("media");
        Self {
            _directory: directory,
            database,
            media,
        }
    }

    fn service(&self) -> HealthService<SqliteHealthRepository, LocalMediaStore> {
        let repository = SqliteHealthRepository::open(&self.database).unwrap();
        let media = LocalMediaStore::new(&self.media).unwrap();
        HealthService::new(repository, media)
    }
}
