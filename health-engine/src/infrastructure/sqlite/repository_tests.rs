use std::time::Duration;

use rusqlite::Connection;
use serde_json::json;
use time::macros::{date, datetime};
use time::{Duration as TimeDuration, OffsetDateTime};

use super::mapping::row_to_event;
use super::{SqliteHealthRepository, audit_json};
use crate::application::ports::{
    AuditEvent, HealthMutationRepository, HealthReadRepository, MediaFileRecord,
};
use crate::domain::{
    DietEntry, DietEntryRehydration, HealthCategory, HealthEvent, HealthEventRehydration, MealType,
};

#[test]
fn explicit_rollback_removes_the_record_and_its_tags() {
    let mut repository = SqliteHealthRepository::open_in_memory().unwrap();
    let entry = diet_entry();
    let mut transaction = repository.begin_transaction().unwrap();
    transaction
        .insert_diet(&entry, date!(2026 - 07 - 30))
        .unwrap();
    transaction.replace_diet_tags(&entry).unwrap();
    transaction.rollback().unwrap();

    assert!(
        HealthReadRepository::get_diet(&repository, entry.id().as_str(), true)
            .unwrap()
            .is_none()
    );
}

#[test]
fn failed_audit_insert_can_roll_back_its_record_atomically() {
    let mut repository = SqliteHealthRepository::open_in_memory().unwrap();
    let event = health_event();
    let audit = audit_event();
    let mut transaction = repository.begin_transaction().unwrap();
    transaction
        .insert_event(&event, date!(2026 - 07 - 30), true)
        .unwrap();
    transaction.insert_audit_event(&audit).unwrap();
    assert!(transaction.insert_audit_event(&audit).is_err());
    transaction.rollback().unwrap();

    assert!(
        HealthReadRepository::get_event(&repository, event.id().as_str(), true)
            .unwrap()
            .is_none()
    );
    assert!(
        repository
            .list_audit_events("health_event", event.id().as_str(), Default::default())
            .unwrap()
            .is_empty()
    );
}

#[test]
fn begin_transaction_acquires_an_immediate_writer_lock() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("health.sqlite");
    let mut repository = SqliteHealthRepository::open(&database).unwrap();
    let transaction = repository.begin_transaction().unwrap();
    let contender = Connection::open(&database).unwrap();
    contender.busy_timeout(Duration::ZERO).unwrap();

    assert!(contender.execute_batch("BEGIN IMMEDIATE;").is_err());
    transaction.rollback().unwrap();
}

#[test]
fn media_insert_persists_checksum_and_cleanup_state() {
    let mut repository = SqliteHealthRepository::open_in_memory().unwrap();
    let media = media_file();
    let mut transaction = repository.begin_transaction().unwrap();
    transaction.insert_media(&media).unwrap();
    transaction.commit().unwrap();

    let pending = repository.list_pending_media(Default::default()).unwrap();
    assert_eq!(pending, vec![media]);
}

#[test]
fn media_write_rejects_unsafe_relative_paths() {
    for relative_path in [
        "../outside.webp",
        "2026//07/image.webp",
        "2026/./07/image.webp",
        "2026/07/\0image.webp",
    ] {
        let mut repository = SqliteHealthRepository::open_in_memory().unwrap();
        let mut media = media_file();
        media.relative_path = relative_path.to_string();
        let mut transaction = repository.begin_transaction().unwrap();

        assert!(
            transaction.insert_media(&media).is_err(),
            "accepted unsafe media path {relative_path:?}"
        );
        transaction.rollback().unwrap();
    }
}

#[test]
fn event_mapping_rejects_integer_storage_for_real_values() {
    let connection = Connection::open_in_memory().unwrap();
    let error = connection
        .query_row(
            "SELECT
                '10000000-0000-4000-8000-000000000001',
                '2026-07-30T00:00:00.000000000Z',
                '2026-07-30',
                'bowel',
                'bowel',
                'Bowel',
                4,
                NULL,
                NULL,
                '{\"bristol_scale\":4,\"blood_visible\":false}',
                0,
                '2026-07-30T00:00:00.000000000Z',
                '2026-07-30T00:00:00.000000000Z',
                NULL",
            [],
            |row| Ok(row_to_event(row)),
        )
        .unwrap()
        .unwrap_err();

    assert!(error.to_string().contains("expected null or real storage"));
}

#[test]
fn event_mapping_rejects_real_storage_for_boolean_values() {
    let connection = Connection::open_in_memory().unwrap();
    let error = connection
        .query_row(
            "SELECT
                '10000000-0000-4000-8000-000000000001',
                '2026-07-30T00:00:00.000000000Z',
                '2026-07-30',
                'bowel',
                'bowel',
                'Bowel',
                CAST(4 AS REAL),
                NULL,
                NULL,
                '{\"bristol_scale\":4,\"blood_visible\":false}',
                CAST(1 AS REAL),
                '2026-07-30T00:00:00.000000000Z',
                '2026-07-30T00:00:00.000000000Z',
                NULL",
            [],
            |row| Ok(row_to_event(row)),
        )
        .unwrap()
        .unwrap_err();

    assert!(error.to_string().contains("expected integer storage"));
}

#[test]
fn audit_codec_rejects_non_object_and_malformed_payloads() {
    assert!(audit_json::decode("[]").is_err());
    assert!(audit_json::decode("{").is_err());
    assert!(audit_json::encode_optional(Some(&json!("raw"))).is_err());
}

#[test]
fn same_second_timestamps_keep_list_and_audit_chronology() {
    let mut repository = SqliteHealthRepository::open_in_memory().unwrap();
    let exact_time = datetime!(2026-07-30 00:00:00 UTC);
    let later_time = exact_time + TimeDuration::milliseconds(500);
    let exact_event = health_event_at("10000000-0000-4000-8000-000000000001", exact_time);
    let later_event = health_event_at("10000000-0000-4000-8000-000000000002", later_time);
    let exact_audit = audit_event_at("40000000-0000-4000-8000-000000000001", exact_time);
    let later_audit = audit_event_at("40000000-0000-4000-8000-000000000002", later_time);
    let mut transaction = repository.begin_transaction().unwrap();
    transaction
        .insert_event(&exact_event, date!(2026 - 07 - 30), false)
        .unwrap();
    transaction
        .insert_event(&later_event, date!(2026 - 07 - 30), false)
        .unwrap();
    transaction.insert_audit_event(&exact_audit).unwrap();
    transaction.insert_audit_event(&later_audit).unwrap();
    transaction.commit().unwrap();

    let event_ids = repository
        .list_events(Default::default(), true)
        .unwrap()
        .into_iter()
        .map(|event| event.id().as_str().to_string())
        .collect::<Vec<_>>();
    assert_eq!(
        event_ids,
        vec![
            "10000000-0000-4000-8000-000000000002",
            "10000000-0000-4000-8000-000000000001",
        ]
    );

    let audit_ids = repository
        .list_audit_events(
            "health_event",
            "10000000-0000-4000-8000-000000000001",
            Default::default(),
        )
        .unwrap()
        .into_iter()
        .map(|event| event.id)
        .collect::<Vec<_>>();
    assert_eq!(
        audit_ids,
        vec![
            "40000000-0000-4000-8000-000000000001",
            "40000000-0000-4000-8000-000000000002",
        ]
    );
}

fn diet_entry() -> DietEntry {
    DietEntry::rehydrate(DietEntryRehydration {
        id: "20000000-0000-4000-8000-000000000001".to_string(),
        occurred_at: datetime!(2026-07-30 03:00:00 UTC),
        meal_type: MealType::Lunch,
        food_name: "Bibimbap".to_string(),
        note: None,
        tags: vec!["spicy".to_string(), "wheat".to_string()],
        media_id: None,
        created_at: datetime!(2026-07-30 03:00:00 UTC),
        updated_at: datetime!(2026-07-30 03:00:00 UTC),
        deleted_at: None,
    })
    .unwrap()
}

fn health_event() -> HealthEvent {
    health_event_at(
        "10000000-0000-4000-8000-000000000001",
        datetime!(2026-07-30 00:00:00 UTC),
    )
}

fn health_event_at(id: &str, occurred_at: OffsetDateTime) -> HealthEvent {
    HealthEvent::rehydrate(HealthEventRehydration {
        id: id.to_string(),
        occurred_at,
        category: HealthCategory::Weight,
        metric_key: "body_weight".to_string(),
        name: "Weight".to_string(),
        value_num: Some(68.2),
        unit: Some("kg".to_string()),
        note: None,
        attributes: json!({
            "metric_key": "body_weight",
            "name": "Weight",
            "value": 68.2,
            "unit": "kg"
        }),
        created_at: occurred_at,
        updated_at: occurred_at,
        deleted_at: None,
    })
    .unwrap()
}

fn audit_event() -> AuditEvent {
    audit_event_at(
        "40000000-0000-4000-8000-000000000001",
        datetime!(2026-07-30 00:00:00 UTC),
    )
}

fn audit_event_at(id: &str, occurred_at: OffsetDateTime) -> AuditEvent {
    AuditEvent {
        id: id.to_string(),
        request_id: "50000000-0000-4000-8000-000000000001".to_string(),
        occurred_at,
        actor: "test".to_string(),
        action: "create".to_string(),
        record_type: "health_event".to_string(),
        record_id: "10000000-0000-4000-8000-000000000001".to_string(),
        before: None,
        after: Some(json!({"id": "10000000-0000-4000-8000-000000000001"})),
        reason: None,
    }
}

fn media_file() -> MediaFileRecord {
    MediaFileRecord {
        id: "30000000-0000-4000-8000-000000000001".to_string(),
        relative_path: "2026/07/30000000-0000-4000-8000-000000000001.webp".to_string(),
        mime_type: "image/webp".to_string(),
        byte_size: 42,
        checksum_sha256: "a".repeat(64),
        cleanup_pending: true,
        created_at: datetime!(2026-07-30 00:00:00 UTC),
        updated_at: datetime!(2026-07-30 00:00:00 UTC),
        deleted_at: None,
    }
}
