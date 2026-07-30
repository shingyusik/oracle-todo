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
fn sqlite_rejects_cleanup_pending_media_without_a_tombstone() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("health.sqlite");
    SqliteHealthRepository::open(&database).unwrap();
    let connection = Connection::open(&database).unwrap();

    let result = connection.execute(
        "INSERT INTO media_files (
            id, relative_path, mime_type, byte_size, checksum_sha256,
            cleanup_pending, created_at, updated_at, deleted_at
         ) VALUES (
            '30000000-0000-4000-8000-000000000001',
            '2026/07/30000000-0000-4000-8000-000000000001.webp',
            'image/webp', 42, ?1, 1,
            '2026-07-30T00:00:00.000000000Z',
            '2026-07-30T00:00:00.000000000Z',
            NULL
         )",
        ["a".repeat(64)],
    );

    assert!(result.is_err());
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
            '2026-07-30T03:00:00.000000000Z', '2026-07-30', 'lunch', 'Bibimbap',
            '2026-07-30T03:00:00.000000000Z',
            '2026-07-30T03:00:00.000000000Z', 'import-v0'
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
fn migration_rejects_extended_daily_index_predicates_without_advancing_version() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("health.sqlite");
    drop(SqliteHealthRepository::open(&database).unwrap());
    execute(
        &database,
        "PRAGMA user_version = 0;
         DROP INDEX uq_health_daily_metric;
         CREATE UNIQUE INDEX uq_health_daily_metric
         ON health_events(local_date, category, metric_key)
         WHERE deleted_at IS NULL AND daily_upsert = 1 OR 1 = 1;",
    );

    assert!(matches!(
        SqliteHealthRepository::open(&database),
        Err(HealthError::Migration(_))
    ));
    assert_eq!(user_version(&database), 0);
}

#[test]
fn migration_accepts_equivalent_daily_index_sql_variations() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("health.sqlite");
    drop(SqliteHealthRepository::open(&database).unwrap());
    execute(
        &database,
        "PRAGMA user_version = 0;
         DROP INDEX uq_health_daily_metric;
         CREATE UNIQUE INDEX \"uq_health_daily_metric\"
         ON \"health_events\" (
             \"local_date\" COLLATE BINARY ASC,
             \"category\" COLLATE BINARY ASC,
             \"metric_key\" COLLATE BINARY ASC
         )
         WHERE (
             \"deleted_at\" IS NULL
             AND \"daily_upsert\" == 1
         );",
    );

    drop(SqliteHealthRepository::open(&database).unwrap());
    assert_eq!(user_version(&database), SCHEMA_VERSION);
}

#[test]
fn migration_rejects_textually_faked_foreign_keys_without_advancing_version() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("health.sqlite");
    drop(SqliteHealthRepository::open(&database).unwrap());
    execute(
        &database,
        "PRAGMA foreign_keys = OFF;
         DROP TABLE diet_entry_tags;
         DROP TABLE diet_entries;
         CREATE TABLE diet_entries (
             id TEXT NOT NULL PRIMARY KEY,
             occurred_at TEXT NOT NULL,
             local_date TEXT NOT NULL,
             meal_type TEXT NOT NULL CHECK (
                 meal_type IN ('breakfast', 'lunch', 'dinner', 'snack', 'late_night')
             ),
             food_name TEXT NOT NULL,
             note TEXT,
             media_id TEXT CHECK (
                 'media_id TEXT REFERENCES media_files(id)' <> ''
             ),
             created_at TEXT NOT NULL,
             updated_at TEXT NOT NULL,
             deleted_at TEXT
         ) STRICT;
         CREATE TABLE diet_entry_tags (
             diet_entry_id TEXT NOT NULL
                 REFERENCES diet_entries(id) ON DELETE CASCADE,
             tag_id TEXT NOT NULL REFERENCES diet_tags(id),
             PRIMARY KEY (diet_entry_id, tag_id)
         ) STRICT;
         PRAGMA user_version = 0;",
    );

    assert!(matches!(
        SqliteHealthRepository::open(&database),
        Err(HealthError::Migration(_))
    ));
    assert_eq!(user_version(&database), 0);
}

#[test]
fn migration_rejects_extended_check_constraints_without_advancing_version() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("health.sqlite");
    drop(SqliteHealthRepository::open(&database).unwrap());
    execute(
        &database,
        "PRAGMA foreign_keys = OFF;
         DROP TABLE health_events;
         CREATE TABLE health_events (
             id TEXT NOT NULL PRIMARY KEY,
             occurred_at TEXT NOT NULL,
             local_date TEXT NOT NULL,
             category TEXT NOT NULL CHECK (
                 category IN (
                     'weight', 'bowel', 'sleep', 'lab', 'symptom', 'medication'
                 )
             ),
             metric_key TEXT NOT NULL,
             name TEXT NOT NULL,
             value_num REAL,
             unit TEXT,
             note TEXT,
             attributes_json TEXT NOT NULL,
             daily_upsert INTEGER NOT NULL DEFAULT 0 CHECK (
                 typeof(daily_upsert) = 'integer'
                 AND daily_upsert IN (0, 1) OR 1 = 1
             ),
             created_at TEXT NOT NULL,
             updated_at TEXT NOT NULL,
             deleted_at TEXT
         ) STRICT;
         PRAGMA user_version = 0;",
    );

    assert!(matches!(
        SqliteHealthRepository::open(&database),
        Err(HealthError::Migration(_))
    ));
    assert_eq!(user_version(&database), 0);
}

#[test]
fn migration_rejects_additional_restricting_checks_without_advancing_version() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("health.sqlite");
    drop(SqliteHealthRepository::open(&database).unwrap());
    execute(
        &database,
        "ALTER TABLE diet_entries
             ADD COLUMN legacy_guard INTEGER CHECK(food_name = 'only');
         PRAGMA user_version = 0;",
    );

    assert!(matches!(
        SqliteHealthRepository::open(&database),
        Err(HealthError::Migration(_))
    ));
    assert_eq!(user_version(&database), 0);
}

#[test]
fn migration_rejects_unexpected_unique_indexes_without_advancing_version() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("health.sqlite");
    drop(SqliteHealthRepository::open(&database).unwrap());
    execute(
        &database,
        "CREATE UNIQUE INDEX legacy_unique_food ON diet_entries(food_name);
         PRAGMA user_version = 0;",
    );

    assert!(matches!(
        SqliteHealthRepository::open(&database),
        Err(HealthError::Migration(_))
    ));
    assert_eq!(user_version(&database), 0);
}

#[test]
fn migration_rejects_unexpected_unique_table_constraints_without_advancing_version() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("health.sqlite");
    drop(SqliteHealthRepository::open(&database).unwrap());
    execute(
        &database,
        "PRAGMA foreign_keys = OFF;
         DROP TABLE diet_entry_tags;
         DROP TABLE diet_entries;
         CREATE TABLE diet_entries (
             id TEXT NOT NULL PRIMARY KEY,
             occurred_at TEXT NOT NULL,
             local_date TEXT NOT NULL,
             meal_type TEXT NOT NULL CHECK (
                 meal_type IN ('breakfast', 'lunch', 'dinner', 'snack', 'late_night')
             ),
             food_name TEXT NOT NULL UNIQUE,
             note TEXT,
             media_id TEXT REFERENCES media_files(id),
             created_at TEXT NOT NULL,
             updated_at TEXT NOT NULL,
             deleted_at TEXT
         ) STRICT;
         CREATE TABLE diet_entry_tags (
             diet_entry_id TEXT NOT NULL
                 REFERENCES diet_entries(id) ON DELETE CASCADE,
             tag_id TEXT NOT NULL REFERENCES diet_tags(id),
             PRIMARY KEY (diet_entry_id, tag_id)
         ) STRICT;
         PRAGMA user_version = 0;",
    );

    assert!(matches!(
        SqliteHealthRepository::open(&database),
        Err(HealthError::Migration(_))
    ));
    assert_eq!(user_version(&database), 0);
}

#[test]
fn migration_rejects_missing_media_path_uniqueness_without_advancing_version() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("health.sqlite");
    drop(SqliteHealthRepository::open(&database).unwrap());
    execute(
        &database,
        "PRAGMA foreign_keys = OFF;
         DROP TABLE media_files;
         CREATE TABLE media_files (
             id TEXT NOT NULL PRIMARY KEY,
             relative_path TEXT NOT NULL,
             mime_type TEXT NOT NULL CHECK (
                 mime_type IN ('image/jpeg', 'image/png', 'image/webp')
             ),
             byte_size INTEGER NOT NULL CHECK (
                 typeof(byte_size) = 'integer' AND byte_size >= 0
             ),
             checksum_sha256 TEXT NOT NULL,
             cleanup_pending INTEGER NOT NULL DEFAULT 0 CHECK (
                 typeof(cleanup_pending) = 'integer'
                 AND cleanup_pending IN (0, 1)
             ),
             created_at TEXT NOT NULL,
             updated_at TEXT NOT NULL,
             deleted_at TEXT
         ) STRICT;
         PRAGMA user_version = 0;",
    );

    assert!(matches!(
        SqliteHealthRepository::open(&database),
        Err(HealthError::Migration(_))
    ));
    assert_eq!(user_version(&database), 0);
}

#[test]
fn migration_accepts_equivalent_table_constraint_sql_variations() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("health.sqlite");
    drop(SqliteHealthRepository::open(&database).unwrap());
    execute(
        &database,
        "PRAGMA foreign_keys = OFF;
         DROP TABLE media_files;
         CREATE TABLE \"media_files\" (
             \"id\" TEXT NOT NULL PRIMARY KEY,
             \"relative_path\" TEXT NOT NULL UNIQUE,
             \"mime_type\" TEXT NOT NULL CHECK ((
                 \"mime_type\" IN ('image/jpeg', 'image/png', 'image/webp')
             )),
             \"byte_size\" INTEGER NOT NULL CHECK (
                 typeof(\"byte_size\") == 'integer' AND \"byte_size\" >= 0
             ),
             \"checksum_sha256\" TEXT NOT NULL,
             \"cleanup_pending\" INTEGER NOT NULL DEFAULT 0 CHECK ((
                 typeof(\"cleanup_pending\") == 'integer'
                 AND \"cleanup_pending\" IN (0, 1)
             )),
             \"created_at\" TEXT NOT NULL,
             \"updated_at\" TEXT NOT NULL,
             \"deleted_at\" TEXT
         ) STRICT;
         PRAGMA user_version = 0;",
    );

    drop(SqliteHealthRepository::open(&database).unwrap());
    assert_eq!(user_version(&database), SCHEMA_VERSION);
}

#[test]
fn migration_preserves_additional_nonunique_performance_indexes() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("health.sqlite");
    drop(SqliteHealthRepository::open(&database).unwrap());
    execute(
        &database,
        "CREATE INDEX legacy_diet_food_lookup ON diet_entries(food_name);
         PRAGMA user_version = 0;",
    );

    drop(SqliteHealthRepository::open(&database).unwrap());
    assert_eq!(user_version(&database), SCHEMA_VERSION);
    assert!(index_exists(&database, "legacy_diet_food_lookup"));
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

fn index_exists(path: &Path, index: &str) -> bool {
    Connection::open(path)
        .unwrap()
        .query_row(
            "SELECT EXISTS(
                SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?1
             )",
            [index],
            |row| row.get(0),
        )
        .unwrap()
}
