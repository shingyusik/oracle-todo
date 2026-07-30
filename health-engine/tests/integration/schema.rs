use std::path::Path;

use health_engine::application::error::HealthError;
use health_engine::infrastructure::sqlite::{
    HealthStorageHealth, SCHEMA_VERSION, SqliteHealthRepository,
};
use rusqlite::Connection;

#[test]
fn creates_health_tables_indexes_and_foreign_keys() {
    let repository = SqliteHealthRepository::open_in_memory().unwrap();

    for table in [
        "diet_entries",
        "diet_tags",
        "diet_entry_tags",
        "health_events",
        "media_files",
        "audit_events",
    ] {
        assert!(
            repository.table_exists_for_test(table).unwrap(),
            "missing table {table}"
        );
    }
    for index in [
        "idx_diet_entries_occurred_at",
        "idx_diet_entries_deleted_at",
        "uq_diet_tags_name",
        "idx_diet_entry_tags_tag",
        "idx_health_events_occurred_at",
        "idx_health_events_category",
        "idx_health_events_metric_key",
        "idx_health_events_deleted_at",
        "uq_health_daily_metric",
        "idx_media_files_checksum",
        "idx_media_files_cleanup_pending",
        "idx_audit_events_record",
    ] {
        assert!(
            repository.index_exists_for_test(index).unwrap(),
            "missing index {index}"
        );
    }
    assert!(repository.foreign_keys_enabled_for_test().unwrap());
    assert_eq!(repository.schema_version().unwrap(), SCHEMA_VERSION);
    assert_eq!(
        repository
            .column_type_for_test("health_events", "value_num")
            .unwrap(),
        "REAL"
    );
    assert_eq!(
        repository
            .column_type_for_test("media_files", "byte_size")
            .unwrap(),
        "INTEGER"
    );
}

#[test]
fn schema_initialization_is_additive_and_idempotent() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("health.sqlite");
    execute(
        &database,
        "CREATE TABLE preserved_data (
            id TEXT PRIMARY KEY,
            value TEXT NOT NULL
         );
         INSERT INTO preserved_data (id, value) VALUES ('legacy-1', 'keep-me');",
    );

    let repository = SqliteHealthRepository::open(&database).unwrap();
    repository.init_schema().unwrap();
    repository.init_schema().unwrap();
    repository.check_schema().unwrap();
    drop(repository);

    let connection = Connection::open(database).unwrap();
    assert_eq!(
        connection
            .query_row(
                "SELECT value FROM preserved_data WHERE id = 'legacy-1'",
                [],
                |row| row.get::<_, String>(0),
            )
            .unwrap(),
        "keep-me"
    );
}

#[test]
fn compatible_extra_columns_and_values_are_preserved() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("health.sqlite");
    drop(SqliteHealthRepository::open(&database).unwrap());
    execute(
        &database,
        "ALTER TABLE diet_entries ADD COLUMN legacy_source TEXT;
         INSERT INTO diet_entries (
            id, occurred_at, local_date, meal_type, food_name,
            created_at, updated_at, legacy_source
         ) VALUES (
            '20000000-0000-4000-8000-000000000001',
            '2026-07-30T03:00:00Z', '2026-07-30', 'lunch', 'Bibimbap',
            '2026-07-30T03:00:00Z', '2026-07-30T03:00:00Z', 'import-v0'
         );",
    );

    drop(SqliteHealthRepository::open(&database).unwrap());

    assert_eq!(
        Connection::open(&database)
            .unwrap()
            .query_row(
                "SELECT legacy_source FROM diet_entries
                 WHERE id = '20000000-0000-4000-8000-000000000001'",
                [],
                |row| row.get::<_, String>(0),
            )
            .unwrap(),
        "import-v0"
    );
}

#[test]
fn current_schema_open_does_not_request_a_writer_lock() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("health.sqlite");
    drop(SqliteHealthRepository::open(&database).unwrap());

    let writer = Connection::open(&database).unwrap();
    writer.execute_batch("BEGIN IMMEDIATE;").unwrap();
    let reopened = SqliteHealthRepository::open(&database);
    writer.execute_batch("ROLLBACK;").unwrap();

    assert!(
        reopened.is_ok(),
        "current schema readability check unexpectedly requested a writer lock: {:?}",
        reopened.err()
    );
}

#[test]
fn unsupported_newer_schema_is_rejected_without_changes() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("health.sqlite");
    execute(
        &database,
        &format!(
            "CREATE TABLE future_marker (value TEXT NOT NULL);
             INSERT INTO future_marker (value) VALUES ('keep');
             PRAGMA user_version = {};",
            SCHEMA_VERSION + 1
        ),
    );

    let error = SqliteHealthRepository::open(&database).unwrap_err();

    assert!(matches!(error, HealthError::Migration(_)));
    assert_eq!(user_version(&database), SCHEMA_VERSION + 1);
    assert!(!table_exists(&database, "health_events"));
    assert_eq!(
        Connection::open(&database)
            .unwrap()
            .query_row("SELECT value FROM future_marker", [], |row| {
                row.get::<_, String>(0)
            })
            .unwrap(),
        "keep"
    );
}

#[test]
fn failed_migration_rolls_back_all_schema_changes() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("health.sqlite");
    execute(
        &database,
        "CREATE TABLE preserved_data (value TEXT NOT NULL);
         INSERT INTO preserved_data (value) VALUES ('keep');
         CREATE INDEX uq_health_daily_metric ON preserved_data(value);",
    );

    let error = SqliteHealthRepository::open(&database).unwrap_err();

    assert!(matches!(error, HealthError::Migration(_)));
    assert_eq!(user_version(&database), 0);
    assert!(!table_exists(&database, "health_events"));
    assert_eq!(
        Connection::open(&database)
            .unwrap()
            .query_row("SELECT value FROM preserved_data", [], |row| {
                row.get::<_, String>(0)
            })
            .unwrap(),
        "keep"
    );
}

#[test]
fn health_probe_is_read_only_and_does_not_initialize_missing_paths() {
    let directory = tempfile::tempdir().unwrap();
    let missing = directory.path().join("missing.sqlite");

    assert_eq!(
        SqliteHealthRepository::health_at(&missing),
        HealthStorageHealth::NotInitialized
    );
    assert!(!missing.exists());

    let empty = directory.path().join("empty.sqlite");
    drop(Connection::open(&empty).unwrap());
    assert_eq!(
        SqliteHealthRepository::health_at(&empty),
        HealthStorageHealth::NotInitialized
    );
    assert_eq!(user_version(&empty), 0);
    assert!(!table_exists(&empty, "health_events"));
}

fn execute(path: &Path, sql: &str) {
    Connection::open(path).unwrap().execute_batch(sql).unwrap();
}

fn user_version(path: &Path) -> i64 {
    Connection::open(path)
        .unwrap()
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .unwrap()
}

fn table_exists(path: &Path, table: &str) -> bool {
    Connection::open(path)
        .unwrap()
        .query_row(
            "SELECT EXISTS(
                SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1
             )",
            [table],
            |row| row.get(0),
        )
        .unwrap()
}
