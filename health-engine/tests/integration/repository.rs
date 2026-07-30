use health_engine::application::error::HealthError;
use health_engine::application::ports::{MAX_PAGE_LIMIT, Page};
use health_engine::infrastructure::sqlite::SqliteHealthRepository;
use rusqlite::{Connection, ErrorCode, params};

const EVENT_ID: &str = "10000000-0000-4000-8000-000000000001";
const EVENT_ID_2: &str = "10000000-0000-4000-8000-000000000002";

#[test]
fn page_limits_are_bounded_at_construction() {
    assert_eq!(Page::default().limit(), 100);
    assert_eq!(Page::new(7, MAX_PAGE_LIMIT).unwrap().offset(), 7);
    assert!(matches!(
        Page::new(0, 0),
        Err(HealthError::Validation { field: "limit", .. })
    ));
    assert!(matches!(
        Page::new(0, MAX_PAGE_LIMIT + 1),
        Err(HealthError::Validation { field: "limit", .. })
    ));
}

#[test]
fn daily_metric_partial_index_allows_archived_rows_but_rejects_active_duplicates() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("health.sqlite");
    drop(SqliteHealthRepository::open(&database).unwrap());
    let connection = Connection::open(&database).unwrap();
    connection
        .execute_batch("PRAGMA foreign_keys = ON;")
        .unwrap();

    insert_event(
        &connection,
        EVENT_ID,
        "2026-07-30",
        true,
        None,
        r#"{"metric_key":"body_weight","name":"Weight","value":68.2,"unit":"kg"}"#,
    )
    .unwrap();
    let duplicate = insert_event(
        &connection,
        EVENT_ID_2,
        "2026-07-30",
        true,
        None,
        r#"{"metric_key":"body_weight","name":"Weight","value":67.9,"unit":"kg"}"#,
    )
    .unwrap_err();
    assert_eq!(
        duplicate.sqlite_error_code(),
        Some(ErrorCode::ConstraintViolation)
    );

    connection
        .execute(
            "UPDATE health_events SET deleted_at = updated_at WHERE id = ?1",
            [EVENT_ID],
        )
        .unwrap();
    insert_event(
        &connection,
        EVENT_ID_2,
        "2026-07-30",
        true,
        None,
        r#"{"metric_key":"body_weight","name":"Weight","value":67.9,"unit":"kg"}"#,
    )
    .unwrap();
}

#[test]
fn concurrent_daily_writers_are_serialized_then_unique_index_wins() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("health.sqlite");
    drop(SqliteHealthRepository::open(&database).unwrap());
    let first = Connection::open(&database).unwrap();
    let second = Connection::open(&database).unwrap();
    first
        .execute_batch("PRAGMA foreign_keys = ON; BEGIN IMMEDIATE;")
        .unwrap();
    insert_event(
        &first,
        EVENT_ID,
        "2026-07-30",
        true,
        None,
        r#"{"metric_key":"body_weight","name":"Weight","value":68.2,"unit":"kg"}"#,
    )
    .unwrap();

    let busy = second.execute(
        "INSERT INTO health_events (
            id, occurred_at, local_date, category, metric_key, name, value_num,
            unit, attributes_json, daily_upsert, created_at, updated_at
         ) VALUES (
            ?1, '2026-07-30T00:00:00Z', '2026-07-30', 'weight',
            'body_weight', 'Weight', 67.9, 'kg',
            '{\"metric_key\":\"body_weight\",\"name\":\"Weight\",\"value\":67.9,\"unit\":\"kg\"}',
            1, '2026-07-30T00:00:00Z', '2026-07-30T00:00:00Z'
         )",
        [EVENT_ID_2],
    );
    assert!(
        busy.is_err(),
        "second writer unexpectedly bypassed the lock"
    );
    first.execute_batch("COMMIT;").unwrap();

    let duplicate = insert_event(
        &second,
        EVENT_ID_2,
        "2026-07-30",
        true,
        None,
        r#"{"metric_key":"body_weight","name":"Weight","value":67.9,"unit":"kg"}"#,
    )
    .unwrap_err();
    assert_eq!(
        duplicate.sqlite_error_code(),
        Some(ErrorCode::ConstraintViolation)
    );
}

#[test]
fn current_schema_rejects_corrupt_json_without_rewriting_it() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("health.sqlite");
    drop(SqliteHealthRepository::open(&database).unwrap());
    let connection = Connection::open(&database).unwrap();
    insert_event(&connection, EVENT_ID, "2026-07-30", false, None, "not-json").unwrap();
    drop(connection);

    let error = SqliteHealthRepository::open(&database).unwrap_err();

    assert!(matches!(error, HealthError::Migration(_)));
    assert_eq!(
        Connection::open(&database)
            .unwrap()
            .query_row(
                "SELECT attributes_json FROM health_events WHERE id = ?1",
                [EVENT_ID],
                |row| row.get::<_, String>(0),
            )
            .unwrap(),
        "not-json"
    );
}

#[test]
fn current_schema_rejects_invalid_persisted_local_dates() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("health.sqlite");
    drop(SqliteHealthRepository::open(&database).unwrap());
    let connection = Connection::open(&database).unwrap();
    insert_event(
        &connection,
        EVENT_ID,
        "2026-02-30",
        false,
        None,
        r#"{"bristol_scale":4,"blood_visible":false}"#,
    )
    .unwrap();
    drop(connection);

    assert!(matches!(
        SqliteHealthRepository::open(&database),
        Err(HealthError::Migration(_))
    ));
}

#[test]
fn current_schema_rejects_category_attribute_mismatches() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("health.sqlite");
    drop(SqliteHealthRepository::open(&database).unwrap());
    let connection = Connection::open(&database).unwrap();
    insert_event(
        &connection,
        EVENT_ID,
        "2026-07-30",
        false,
        None,
        r#"{"bristol_scale":4,"blood_visible":false}"#,
    )
    .unwrap();
    drop(connection);

    assert!(matches!(
        SqliteHealthRepository::open(&database),
        Err(HealthError::Migration(_))
    ));
}

#[test]
fn current_schema_rejects_unsafe_persisted_media_paths() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("health.sqlite");
    drop(SqliteHealthRepository::open(&database).unwrap());
    let connection = Connection::open(&database).unwrap();
    connection
        .execute(
            "INSERT INTO media_files (
                id, relative_path, mime_type, byte_size, checksum_sha256,
                cleanup_pending, created_at, updated_at
             ) VALUES (
                '30000000-0000-4000-8000-000000000001',
                '../outside.webp', 'image/webp', 42, ?1, 0,
                '2026-07-30T00:00:00Z', '2026-07-30T00:00:00Z'
             )",
            ["a".repeat(64)],
        )
        .unwrap();
    drop(connection);

    assert!(matches!(
        SqliteHealthRepository::open(&database),
        Err(HealthError::Migration(_))
    ));
}

#[test]
fn current_schema_rejects_noncanonical_event_metric_keys() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("health.sqlite");
    drop(SqliteHealthRepository::open(&database).unwrap());
    let connection = Connection::open(&database).unwrap();
    connection
        .execute(
            "INSERT INTO health_events (
                id, occurred_at, local_date, category, metric_key, name, value_num,
                unit, attributes_json, daily_upsert, created_at, updated_at
             ) VALUES (
                ?1, '2026-07-30T00:00:00Z', '2026-07-30', 'weight',
                'BODY_WEIGHT', 'Weight', 68.2, 'kg',
                '{\"metric_key\":\"BODY_WEIGHT\",\"name\":\"Weight\",\"value\":68.2,\"unit\":\"kg\"}',
                0, '2026-07-30T00:00:00Z', '2026-07-30T00:00:00Z'
             )",
            [EVENT_ID],
        )
        .unwrap();
    drop(connection);

    assert!(matches!(
        SqliteHealthRepository::open(&database),
        Err(HealthError::Migration(_))
    ));
}

#[test]
fn current_schema_rejects_noncanonical_persisted_diet_tags() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("health.sqlite");
    drop(SqliteHealthRepository::open(&database).unwrap());
    let connection = Connection::open(&database).unwrap();
    connection
        .execute_batch(
            "PRAGMA foreign_keys = ON;
             INSERT INTO diet_entries (
                id, occurred_at, local_date, meal_type, food_name, created_at, updated_at
             ) VALUES (
                '20000000-0000-4000-8000-000000000001',
                '2026-07-30T03:00:00Z', '2026-07-30', 'lunch', 'Bibimbap',
                '2026-07-30T03:00:00Z', '2026-07-30T03:00:00Z'
             );
             INSERT INTO diet_tags (
                id, name
             ) VALUES (
                '60000000-0000-4000-8000-000000000001', ' Coffee '
             );
             INSERT INTO diet_entry_tags (
                diet_entry_id, tag_id
             ) VALUES (
                '20000000-0000-4000-8000-000000000001',
                '60000000-0000-4000-8000-000000000001'
             );",
        )
        .unwrap();
    drop(connection);

    assert!(matches!(
        SqliteHealthRepository::open(&database),
        Err(HealthError::Migration(_))
    ));
}

#[test]
fn current_schema_rejects_non_uuid_audit_identifiers() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("health.sqlite");
    drop(SqliteHealthRepository::open(&database).unwrap());
    let connection = Connection::open(&database).unwrap();
    connection
        .execute(
            "INSERT INTO audit_events (
                id, request_id, occurred_at, actor, action, record_type, record_id
             ) VALUES (
                'not-a-uuid',
                '50000000-0000-4000-8000-000000000001',
                '2026-07-30T00:00:00Z',
                'test', 'create', 'health_event', ?1
             )",
            [EVENT_ID],
        )
        .unwrap();
    drop(connection);

    assert!(matches!(
        SqliteHealthRepository::open(&database),
        Err(HealthError::Migration(_))
    ));
}

#[test]
fn readability_checks_include_negative_rowids() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("health.sqlite");
    drop(SqliteHealthRepository::open(&database).unwrap());
    let connection = Connection::open(&database).unwrap();
    connection
        .execute(
            "INSERT INTO health_events (
                rowid, id, occurred_at, local_date, category, metric_key, name,
                value_num, unit, attributes_json, daily_upsert, created_at, updated_at
             ) VALUES (
                -1, ?1, '2026-07-30T00:00:00Z', '2026-07-30', 'weight',
                'body_weight', 'Weight', 68.2, 'kg', 'not-json', 0,
                '2026-07-30T00:00:00Z', '2026-07-30T00:00:00Z'
             )",
            [EVENT_ID],
        )
        .unwrap();
    drop(connection);

    assert!(matches!(
        SqliteHealthRepository::open(&database),
        Err(HealthError::Migration(_))
    ));
}

#[test]
fn foreign_keys_prevent_dangling_diet_media_links() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("health.sqlite");
    drop(SqliteHealthRepository::open(&database).unwrap());
    let connection = Connection::open(&database).unwrap();
    connection
        .execute_batch("PRAGMA foreign_keys = ON;")
        .unwrap();
    let error = connection
        .execute(
            "INSERT INTO diet_entries (
                id, occurred_at, local_date, meal_type, food_name, media_id,
                created_at, updated_at
             ) VALUES (
                '20000000-0000-4000-8000-000000000001',
                '2026-07-30T03:00:00Z', '2026-07-30', 'lunch', 'Bibimbap',
                '30000000-0000-4000-8000-000000000001',
                '2026-07-30T03:00:00Z', '2026-07-30T03:00:00Z'
             )",
            [],
        )
        .unwrap_err();
    assert_eq!(
        error.sqlite_error_code(),
        Some(ErrorCode::ConstraintViolation)
    );
}

fn insert_event(
    connection: &Connection,
    id: &str,
    local_date: &str,
    daily_upsert: bool,
    deleted_at: Option<&str>,
    attributes_json: &str,
) -> rusqlite::Result<usize> {
    connection.execute(
        "INSERT INTO health_events (
            id, occurred_at, local_date, category, metric_key, name, value_num,
            unit, attributes_json, daily_upsert, created_at, updated_at, deleted_at
         ) VALUES (
            ?1, '2026-07-30T00:00:00Z', ?2, 'weight', 'body_weight',
            'Weight', 68.2, 'kg', ?3, ?4,
            '2026-07-30T00:00:00Z', '2026-07-30T00:00:00Z', ?5
         )",
        params![id, local_date, attributes_json, daily_upsert, deleted_at],
    )
}
