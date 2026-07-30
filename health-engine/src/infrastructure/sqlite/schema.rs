use rusqlite::{Connection, OptionalExtension, params};
use time::format_description::well_known::{Iso8601, Rfc3339};
use time::{Date, OffsetDateTime, UtcOffset};

use super::mapping::{
    AUDIT_COLUMNS as AUDIT_SELECT_COLUMNS, DIET_COLUMNS as DIET_SELECT_COLUMNS,
    EVENT_COLUMNS as EVENT_SELECT_COLUMNS, MEDIA_COLUMNS as MEDIA_SELECT_COLUMNS,
    row_to_audit_event, row_to_diet, row_to_event, row_to_media,
};
use crate::application::error::{HealthError, HealthResult};

pub const SCHEMA_VERSION: i64 = 1;
const VALIDATION_BATCH_SIZE: i64 = 256;

pub(super) fn init_schema(connection: &Connection) -> HealthResult<()> {
    connection
        .execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(migration_error)?;
    let version = user_version(connection)?;
    if version > SCHEMA_VERSION {
        return Err(newer_schema(version));
    }
    if version == SCHEMA_VERSION {
        return check_schema(connection);
    }

    connection
        .execute_batch("BEGIN IMMEDIATE;")
        .map_err(migration_error)?;
    let result = (|| {
        let version = user_version(connection)?;
        if version > SCHEMA_VERSION {
            return Err(newer_schema(version));
        }
        if version == SCHEMA_VERSION {
            return validate_current_schema(connection);
        }
        create_missing_tables(connection)?;
        create_missing_indexes(connection)?;
        validate_schema_objects(connection)?;
        validate_persisted_rows(connection)?;
        connection
            .pragma_update(None, "user_version", SCHEMA_VERSION)
            .map_err(migration_error)?;
        Ok(())
    })();
    finish_transaction(connection, result)
}

pub(super) fn check_schema(connection: &Connection) -> HealthResult<()> {
    connection
        .execute_batch("BEGIN DEFERRED;")
        .map_err(migration_error)?;
    let result = validate_current_schema(connection);
    finish_transaction(connection, result)
}

pub(super) fn user_version(connection: &Connection) -> HealthResult<i64> {
    connection
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(migration_error)
}

fn validate_current_schema(connection: &Connection) -> HealthResult<()> {
    let version = user_version(connection)?;
    if version != SCHEMA_VERSION {
        return Err(HealthError::Migration(format!(
            "health schema version {version} does not match supported version {SCHEMA_VERSION}"
        )));
    }
    validate_schema_objects(connection)?;
    validate_persisted_rows(connection)
}

fn create_missing_tables(connection: &Connection) -> HealthResult<()> {
    connection
        .execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS media_files (
                id TEXT NOT NULL PRIMARY KEY,
                relative_path TEXT NOT NULL UNIQUE,
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

            CREATE TABLE IF NOT EXISTS diet_entries (
                id TEXT NOT NULL PRIMARY KEY,
                occurred_at TEXT NOT NULL,
                local_date TEXT NOT NULL,
                meal_type TEXT NOT NULL CHECK (
                    meal_type IN (
                        'breakfast', 'lunch', 'dinner', 'snack', 'late_night'
                    )
                ),
                food_name TEXT NOT NULL,
                note TEXT,
                media_id TEXT REFERENCES media_files(id),
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                deleted_at TEXT
            ) STRICT;

            CREATE TABLE IF NOT EXISTS diet_tags (
                id TEXT NOT NULL PRIMARY KEY,
                name TEXT NOT NULL
            ) STRICT;

            CREATE TABLE IF NOT EXISTS diet_entry_tags (
                diet_entry_id TEXT NOT NULL
                    REFERENCES diet_entries(id) ON DELETE CASCADE,
                tag_id TEXT NOT NULL REFERENCES diet_tags(id),
                PRIMARY KEY (diet_entry_id, tag_id)
            ) STRICT;

            CREATE TABLE IF NOT EXISTS health_events (
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
                    typeof(daily_upsert) = 'integer' AND daily_upsert IN (0, 1)
                ),
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                deleted_at TEXT
            ) STRICT;

            CREATE TABLE IF NOT EXISTS audit_events (
                id TEXT NOT NULL PRIMARY KEY,
                request_id TEXT NOT NULL,
                occurred_at TEXT NOT NULL,
                actor TEXT NOT NULL,
                action TEXT NOT NULL,
                record_type TEXT NOT NULL,
                record_id TEXT NOT NULL,
                before_json TEXT,
                after_json TEXT,
                reason TEXT
            ) STRICT;
            "#,
        )
        .map_err(migration_error)
}

fn create_missing_indexes(connection: &Connection) -> HealthResult<()> {
    for index in INDEXES {
        if index_definition(connection, index.name)?.is_none() {
            connection
                .execute_batch(index.create_sql)
                .map_err(migration_error)?;
        }
    }
    Ok(())
}

fn validate_schema_objects(connection: &Connection) -> HealthResult<()> {
    for table in TABLES {
        validate_table(connection, table)?;
    }
    for index in INDEXES {
        validate_index(connection, index)?;
    }
    let foreign_key_violation: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM pragma_foreign_key_check)",
            [],
            |row| row.get(0),
        )
        .map_err(migration_error)?;
    if foreign_key_violation {
        return Err(HealthError::Migration(
            "health database contains broken foreign-key references".to_string(),
        ));
    }
    Ok(())
}

fn validate_table(connection: &Connection, expected: &TableSpec) -> HealthResult<()> {
    let create_sql = connection
        .query_row(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?1",
            [expected.name],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(migration_error)?
        .ok_or_else(|| {
            HealthError::Migration(format!("required table {} is missing", expected.name))
        })?;
    let normalized = normalize_sql(&create_sql);
    if !normalized.ends_with("strict") {
        return Err(HealthError::Migration(format!(
            "table {} must use SQLite STRICT storage",
            expected.name
        )));
    }
    for fragment in expected.required_sql {
        if !normalized.contains(fragment) {
            return Err(HealthError::Migration(format!(
                "table {} is missing required constraint {fragment}",
                expected.name
            )));
        }
    }

    let mut statement = connection
        .prepare("SELECT name, type, \"notnull\", pk FROM pragma_table_info(?1)")
        .map_err(migration_error)?;
    let actual = statement
        .query_map([expected.name], |row| {
            Ok(Column {
                name: row.get(0)?,
                column_type: row.get(1)?,
                not_null: row.get::<_, i64>(2)? != 0,
                primary_key: row.get::<_, i64>(3)? != 0,
            })
        })
        .map_err(migration_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(migration_error)?;
    for expected_column in expected.columns {
        let Some(actual_column) = actual
            .iter()
            .find(|column| column.name == expected_column.name)
        else {
            return Err(HealthError::Migration(format!(
                "table {} is missing required column {}",
                expected.name, expected_column.name
            )));
        };
        if !actual_column
            .column_type
            .eq_ignore_ascii_case(expected_column.column_type)
            || actual_column.not_null != expected_column.not_null
            || actual_column.primary_key != expected_column.primary_key
        {
            return Err(HealthError::Migration(format!(
                "column {}.{} has incompatible type or constraints",
                expected.name, expected_column.name
            )));
        }
    }
    Ok(())
}

fn validate_index(connection: &Connection, expected: &IndexSpec) -> HealthResult<()> {
    let (table, sql) = index_definition(connection, expected.name)?.ok_or_else(|| {
        HealthError::Migration(format!("required index {} is missing", expected.name))
    })?;
    let normalized = normalize_sql(&sql);
    if table != expected.table
        || expected
            .required_sql
            .iter()
            .any(|fragment| !normalized.contains(fragment))
    {
        return Err(HealthError::Migration(format!(
            "index {} has an incompatible definition",
            expected.name
        )));
    }
    Ok(())
}

fn index_definition(connection: &Connection, name: &str) -> HealthResult<Option<(String, String)>> {
    connection
        .query_row(
            "SELECT tbl_name, sql
             FROM sqlite_master
             WHERE type = 'index' AND name = ?1",
            [name],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(migration_error)
}

fn validate_persisted_rows(connection: &Connection) -> HealthResult<()> {
    for check in SCALAR_CHECKS {
        let corrupt: bool = connection
            .query_row(
                &format!(
                    "SELECT EXISTS(
                        SELECT 1 FROM {} WHERE {} LIMIT 1
                     )",
                    check.table, check.invalid_sql
                ),
                [],
                |row| row.get(0),
            )
            .map_err(migration_error)?;
        if corrupt {
            return Err(HealthError::Migration(format!(
                "table {} contains persisted scalar values that cannot be read safely",
                check.table
            )));
        }
    }
    validate_dates_and_timestamps(connection)?;
    validate_diet_records(connection)?;
    validate_health_json(connection)?;
    validate_media_records(connection)?;
    validate_audit_json(connection)
}

fn validate_diet_records(connection: &Connection) -> HealthResult<()> {
    let mut after_rowid = None::<i64>;
    loop {
        let sql = format!(
            "SELECT {DIET_SELECT_COLUMNS}, rowid
             FROM diet_entries
             WHERE (?1 IS NULL OR rowid > ?1)
             ORDER BY rowid
             LIMIT ?2"
        );
        let mut statement = connection.prepare(&sql).map_err(migration_error)?;
        let mut rows = statement
            .query(params![after_rowid, VALIDATION_BATCH_SIZE])
            .map_err(migration_error)?;
        let mut last_rowid = None;
        while let Some(row) = rows.next().map_err(migration_error)? {
            let id = row.get::<_, String>(0).map_err(migration_error)?;
            let rowid = row.get::<_, i64>(10).map_err(migration_error)?;
            let tags = diet_tags_for_validation(connection, &id)?;
            row_to_diet(row, tags).map_err(|error| {
                HealthError::Migration(format!(
                    "diet row {rowid} cannot be decoded safely: {error}"
                ))
            })?;
            last_rowid = Some(rowid);
        }
        let Some(last_rowid) = last_rowid else {
            break;
        };
        after_rowid = Some(last_rowid);
    }
    Ok(())
}

fn diet_tags_for_validation(connection: &Connection, id: &str) -> HealthResult<Vec<String>> {
    let mut statement = connection
        .prepare(
            "SELECT tags.name
             FROM diet_tags AS tags
             JOIN diet_entry_tags AS links ON links.tag_id = tags.id
             WHERE links.diet_entry_id = ?1
             ORDER BY tags.name",
        )
        .map_err(migration_error)?;
    statement
        .query_map([id], |row| row.get(0))
        .map_err(migration_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(migration_error)
}

fn validate_dates_and_timestamps(connection: &Connection) -> HealthResult<()> {
    for source in DATE_TIME_SOURCES {
        let mut after_rowid = None::<i64>;
        loop {
            let sql = format!(
                "SELECT rowid, {} FROM {}
                 WHERE (?1 IS NULL OR rowid > ?1)
                 ORDER BY rowid LIMIT ?2",
                source.columns.join(", "),
                source.table
            );
            let mut statement = connection.prepare(&sql).map_err(migration_error)?;
            let rows = statement
                .query_map(params![after_rowid, VALIDATION_BATCH_SIZE], |row| {
                    let rowid = row.get(0)?;
                    let values = (1..=source.columns.len())
                        .map(|index| row.get::<_, Option<String>>(index))
                        .collect::<Result<Vec<_>, _>>()?;
                    Ok((rowid, values))
                })
                .map_err(migration_error)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(migration_error)?;
            if rows.is_empty() {
                break;
            }
            for (rowid, values) in &rows {
                for (index, value) in values.iter().enumerate() {
                    let Some(value) = value else {
                        continue;
                    };
                    let column = source.columns[index];
                    let valid = if column == "local_date" {
                        parse_local_date(value).is_ok()
                    } else {
                        parse_utc_time(value).is_ok()
                    };
                    if !valid {
                        return Err(HealthError::Migration(format!(
                            "table {} row {rowid} has invalid persisted {column}",
                            source.table
                        )));
                    }
                }
            }
            after_rowid = rows.last().map(|row| row.0);
        }
    }
    Ok(())
}

fn validate_health_json(connection: &Connection) -> HealthResult<()> {
    let mut after_rowid = None::<i64>;
    loop {
        let sql = format!(
            "SELECT {EVENT_SELECT_COLUMNS}, rowid
             FROM health_events
             WHERE (?1 IS NULL OR rowid > ?1)
             ORDER BY rowid
             LIMIT ?2"
        );
        let mut statement = connection.prepare(&sql).map_err(migration_error)?;
        let mut rows = statement
            .query(params![after_rowid, VALIDATION_BATCH_SIZE])
            .map_err(migration_error)?;
        let mut last_rowid = None;
        while let Some(row) = rows.next().map_err(migration_error)? {
            let rowid = row.get::<_, i64>(14).map_err(migration_error)?;
            row_to_event(row).map_err(|error| {
                HealthError::Migration(format!(
                    "health event row {rowid} cannot be decoded safely: {error}"
                ))
            })?;
            last_rowid = Some(rowid);
        }
        let Some(last_rowid) = last_rowid else {
            break;
        };
        after_rowid = Some(last_rowid);
    }
    Ok(())
}

fn validate_media_records(connection: &Connection) -> HealthResult<()> {
    let mut after_rowid = None::<i64>;
    loop {
        let sql = format!(
            "SELECT {MEDIA_SELECT_COLUMNS}, rowid
             FROM media_files
             WHERE (?1 IS NULL OR rowid > ?1)
             ORDER BY rowid
             LIMIT ?2"
        );
        let mut statement = connection.prepare(&sql).map_err(migration_error)?;
        let mut rows = statement
            .query(params![after_rowid, VALIDATION_BATCH_SIZE])
            .map_err(migration_error)?;
        let mut last_rowid = None;
        while let Some(row) = rows.next().map_err(migration_error)? {
            let rowid = row.get::<_, i64>(9).map_err(migration_error)?;
            row_to_media(row).map_err(|error| {
                HealthError::Migration(format!(
                    "media row {rowid} cannot be decoded safely: {error}"
                ))
            })?;
            last_rowid = Some(rowid);
        }
        let Some(last_rowid) = last_rowid else {
            break;
        };
        after_rowid = Some(last_rowid);
    }
    Ok(())
}

fn validate_audit_json(connection: &Connection) -> HealthResult<()> {
    let mut after_rowid = None::<i64>;
    loop {
        let sql = format!(
            "SELECT {AUDIT_SELECT_COLUMNS}, rowid
             FROM audit_events
             WHERE (?1 IS NULL OR rowid > ?1)
             ORDER BY rowid
             LIMIT ?2"
        );
        let mut statement = connection.prepare(&sql).map_err(migration_error)?;
        let mut rows = statement
            .query(params![after_rowid, VALIDATION_BATCH_SIZE])
            .map_err(migration_error)?;
        let mut last_rowid = None;
        while let Some(row) = rows.next().map_err(migration_error)? {
            let rowid = row.get::<_, i64>(10).map_err(migration_error)?;
            row_to_audit_event(row).map_err(|error| {
                HealthError::Migration(format!(
                    "audit row {rowid} cannot be decoded safely: {error}"
                ))
            })?;
            last_rowid = Some(rowid);
        }
        let Some(last_rowid) = last_rowid else {
            break;
        };
        after_rowid = Some(last_rowid);
    }
    Ok(())
}

pub(super) fn parse_local_date(value: &str) -> HealthResult<Date> {
    Date::parse(value, &Iso8601::DATE)
        .map_err(|error| HealthError::Storage(format!("invalid persisted local date: {error}")))
}

pub(super) fn parse_utc_time(value: &str) -> HealthResult<OffsetDateTime> {
    let timestamp = OffsetDateTime::parse(value, &Rfc3339)
        .map_err(|error| HealthError::Storage(format!("invalid persisted timestamp: {error}")))?;
    if timestamp.offset() != UtcOffset::UTC || !value.ends_with('Z') {
        return Err(HealthError::Storage(
            "persisted timestamps must use UTC Z notation".to_string(),
        ));
    }
    Ok(timestamp)
}

fn finish_transaction(connection: &Connection, result: HealthResult<()>) -> HealthResult<()> {
    match result {
        Ok(()) => match connection.execute_batch("COMMIT;") {
            Ok(()) => Ok(()),
            Err(error) => {
                let error = migration_error(error);
                let _ = connection.execute_batch("ROLLBACK;");
                Err(error)
            }
        },
        Err(error) => {
            let _ = connection.execute_batch("ROLLBACK;");
            Err(error)
        }
    }
}

fn newer_schema(version: i64) -> HealthError {
    HealthError::Migration(format!(
        "health schema version {version} is newer than supported version {SCHEMA_VERSION}"
    ))
}

fn migration_error(error: rusqlite::Error) -> HealthError {
    HealthError::Migration(error.to_string())
}

fn normalize_sql(sql: &str) -> String {
    sql.chars()
        .filter(|character| !character.is_whitespace() && *character != ';')
        .flat_map(char::to_lowercase)
        .collect()
}

#[derive(Debug)]
struct Column {
    name: String,
    column_type: String,
    not_null: bool,
    primary_key: bool,
}

struct ColumnSpec {
    name: &'static str,
    column_type: &'static str,
    not_null: bool,
    primary_key: bool,
}

struct TableSpec {
    name: &'static str,
    columns: &'static [ColumnSpec],
    required_sql: &'static [&'static str],
}

struct IndexSpec {
    name: &'static str,
    table: &'static str,
    create_sql: &'static str,
    required_sql: &'static [&'static str],
}

struct ScalarCheck {
    table: &'static str,
    invalid_sql: &'static str,
}

struct DateTimeSource {
    table: &'static str,
    columns: &'static [&'static str],
}

const MEDIA_COLUMNS: &[ColumnSpec] = &[
    column("id", "TEXT", true, true),
    column("relative_path", "TEXT", true, false),
    column("mime_type", "TEXT", true, false),
    column("byte_size", "INTEGER", true, false),
    column("checksum_sha256", "TEXT", true, false),
    column("cleanup_pending", "INTEGER", true, false),
    column("created_at", "TEXT", true, false),
    column("updated_at", "TEXT", true, false),
    column("deleted_at", "TEXT", false, false),
];
const DIET_COLUMNS: &[ColumnSpec] = &[
    column("id", "TEXT", true, true),
    column("occurred_at", "TEXT", true, false),
    column("local_date", "TEXT", true, false),
    column("meal_type", "TEXT", true, false),
    column("food_name", "TEXT", true, false),
    column("note", "TEXT", false, false),
    column("media_id", "TEXT", false, false),
    column("created_at", "TEXT", true, false),
    column("updated_at", "TEXT", true, false),
    column("deleted_at", "TEXT", false, false),
];
const TAG_COLUMNS: &[ColumnSpec] = &[
    column("id", "TEXT", true, true),
    column("name", "TEXT", true, false),
];
const DIET_TAG_COLUMNS: &[ColumnSpec] = &[
    column("diet_entry_id", "TEXT", true, true),
    column("tag_id", "TEXT", true, true),
];
const EVENT_COLUMNS: &[ColumnSpec] = &[
    column("id", "TEXT", true, true),
    column("occurred_at", "TEXT", true, false),
    column("local_date", "TEXT", true, false),
    column("category", "TEXT", true, false),
    column("metric_key", "TEXT", true, false),
    column("name", "TEXT", true, false),
    column("value_num", "REAL", false, false),
    column("unit", "TEXT", false, false),
    column("note", "TEXT", false, false),
    column("attributes_json", "TEXT", true, false),
    column("daily_upsert", "INTEGER", true, false),
    column("created_at", "TEXT", true, false),
    column("updated_at", "TEXT", true, false),
    column("deleted_at", "TEXT", false, false),
];
const AUDIT_COLUMNS: &[ColumnSpec] = &[
    column("id", "TEXT", true, true),
    column("request_id", "TEXT", true, false),
    column("occurred_at", "TEXT", true, false),
    column("actor", "TEXT", true, false),
    column("action", "TEXT", true, false),
    column("record_type", "TEXT", true, false),
    column("record_id", "TEXT", true, false),
    column("before_json", "TEXT", false, false),
    column("after_json", "TEXT", false, false),
    column("reason", "TEXT", false, false),
];

const TABLES: &[TableSpec] = &[
    TableSpec {
        name: "media_files",
        columns: MEDIA_COLUMNS,
        required_sql: &["cleanup_pendingin(0,1)"],
    },
    TableSpec {
        name: "diet_entries",
        columns: DIET_COLUMNS,
        required_sql: &["media_idtextreferencesmedia_files(id)"],
    },
    TableSpec {
        name: "diet_tags",
        columns: TAG_COLUMNS,
        required_sql: &[],
    },
    TableSpec {
        name: "diet_entry_tags",
        columns: DIET_TAG_COLUMNS,
        required_sql: &[
            "referencesdiet_entries(id)ondeletecascade",
            "referencesdiet_tags(id)",
        ],
    },
    TableSpec {
        name: "health_events",
        columns: EVENT_COLUMNS,
        required_sql: &["daily_upsertin(0,1)"],
    },
    TableSpec {
        name: "audit_events",
        columns: AUDIT_COLUMNS,
        required_sql: &[],
    },
];

const INDEXES: &[IndexSpec] = &[
    index(
        "idx_diet_entries_occurred_at",
        "diet_entries",
        "CREATE INDEX IF NOT EXISTS idx_diet_entries_occurred_at
         ON diet_entries(occurred_at, id);",
        &["ondiet_entries(occurred_at,id)"],
    ),
    index(
        "idx_diet_entries_deleted_at",
        "diet_entries",
        "CREATE INDEX IF NOT EXISTS idx_diet_entries_deleted_at
         ON diet_entries(deleted_at, occurred_at);",
        &["ondiet_entries(deleted_at,occurred_at)"],
    ),
    index(
        "uq_diet_tags_name",
        "diet_tags",
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_diet_tags_name ON diet_tags(name);",
        &["createuniqueindex", "ondiet_tags(name)"],
    ),
    index(
        "idx_diet_entry_tags_tag",
        "diet_entry_tags",
        "CREATE INDEX IF NOT EXISTS idx_diet_entry_tags_tag
         ON diet_entry_tags(tag_id, diet_entry_id);",
        &["ondiet_entry_tags(tag_id,diet_entry_id)"],
    ),
    index(
        "idx_health_events_occurred_at",
        "health_events",
        "CREATE INDEX IF NOT EXISTS idx_health_events_occurred_at
         ON health_events(occurred_at, id);",
        &["onhealth_events(occurred_at,id)"],
    ),
    index(
        "idx_health_events_category",
        "health_events",
        "CREATE INDEX IF NOT EXISTS idx_health_events_category
         ON health_events(category, occurred_at);",
        &["onhealth_events(category,occurred_at)"],
    ),
    index(
        "idx_health_events_metric_key",
        "health_events",
        "CREATE INDEX IF NOT EXISTS idx_health_events_metric_key
         ON health_events(metric_key, occurred_at);",
        &["onhealth_events(metric_key,occurred_at)"],
    ),
    index(
        "idx_health_events_deleted_at",
        "health_events",
        "CREATE INDEX IF NOT EXISTS idx_health_events_deleted_at
         ON health_events(deleted_at, occurred_at);",
        &["onhealth_events(deleted_at,occurred_at)"],
    ),
    index(
        "uq_health_daily_metric",
        "health_events",
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_health_daily_metric
         ON health_events(local_date, category, metric_key)
         WHERE deleted_at IS NULL AND daily_upsert = 1;",
        &[
            "createuniqueindex",
            "onhealth_events(local_date,category,metric_key)",
            "wheredeleted_atisnullanddaily_upsert=1",
        ],
    ),
    index(
        "idx_media_files_checksum",
        "media_files",
        "CREATE INDEX IF NOT EXISTS idx_media_files_checksum
         ON media_files(checksum_sha256);",
        &["onmedia_files(checksum_sha256)"],
    ),
    index(
        "idx_media_files_cleanup_pending",
        "media_files",
        "CREATE INDEX IF NOT EXISTS idx_media_files_cleanup_pending
         ON media_files(cleanup_pending, id);",
        &["onmedia_files(cleanup_pending,id)"],
    ),
    index(
        "idx_audit_events_record",
        "audit_events",
        "CREATE INDEX IF NOT EXISTS idx_audit_events_record
         ON audit_events(record_type, record_id, occurred_at);",
        &["onaudit_events(record_type,record_id,occurred_at)"],
    ),
];

const SCALAR_CHECKS: &[ScalarCheck] = &[
    ScalarCheck {
        table: "media_files",
        invalid_sql: "
            typeof(id) <> 'text' OR length(trim(id)) = 0
            OR typeof(relative_path) <> 'text' OR length(trim(relative_path)) = 0
            OR typeof(mime_type) <> 'text'
            OR typeof(byte_size) <> 'integer' OR byte_size < 0
            OR typeof(checksum_sha256) <> 'text' OR length(checksum_sha256) <> 64
            OR typeof(cleanup_pending) <> 'integer' OR cleanup_pending NOT IN (0, 1)
            OR typeof(created_at) <> 'text' OR typeof(updated_at) <> 'text'
            OR (deleted_at IS NOT NULL AND typeof(deleted_at) <> 'text')
        ",
    },
    ScalarCheck {
        table: "diet_entries",
        invalid_sql: "
            typeof(id) <> 'text' OR length(trim(id)) = 0
            OR typeof(occurred_at) <> 'text' OR typeof(local_date) <> 'text'
            OR typeof(meal_type) <> 'text'
            OR typeof(food_name) <> 'text' OR length(trim(food_name)) = 0
            OR (note IS NOT NULL AND (typeof(note) <> 'text' OR length(trim(note)) = 0))
            OR (media_id IS NOT NULL AND typeof(media_id) <> 'text')
            OR typeof(created_at) <> 'text' OR typeof(updated_at) <> 'text'
            OR (deleted_at IS NOT NULL AND typeof(deleted_at) <> 'text')
        ",
    },
    ScalarCheck {
        table: "diet_tags",
        invalid_sql: "
            typeof(id) <> 'text' OR length(trim(id)) = 0
            OR typeof(name) <> 'text' OR length(trim(name)) = 0
        ",
    },
    ScalarCheck {
        table: "diet_entry_tags",
        invalid_sql: "
            typeof(diet_entry_id) <> 'text' OR typeof(tag_id) <> 'text'
        ",
    },
    ScalarCheck {
        table: "health_events",
        invalid_sql: "
            typeof(id) <> 'text' OR length(trim(id)) = 0
            OR typeof(occurred_at) <> 'text' OR typeof(local_date) <> 'text'
            OR typeof(category) <> 'text'
            OR typeof(metric_key) <> 'text' OR length(trim(metric_key)) = 0
            OR typeof(name) <> 'text' OR length(trim(name)) = 0
            OR (value_num IS NOT NULL AND typeof(value_num) <> 'real')
            OR (unit IS NOT NULL AND (typeof(unit) <> 'text' OR length(trim(unit)) = 0))
            OR (note IS NOT NULL AND (typeof(note) <> 'text' OR length(trim(note)) = 0))
            OR typeof(attributes_json) <> 'text'
            OR typeof(daily_upsert) <> 'integer' OR daily_upsert NOT IN (0, 1)
            OR typeof(created_at) <> 'text' OR typeof(updated_at) <> 'text'
            OR (deleted_at IS NOT NULL AND typeof(deleted_at) <> 'text')
        ",
    },
    ScalarCheck {
        table: "audit_events",
        invalid_sql: "
            typeof(id) <> 'text' OR length(trim(id)) = 0
            OR typeof(request_id) <> 'text' OR length(trim(request_id)) = 0
            OR typeof(occurred_at) <> 'text'
            OR typeof(actor) <> 'text' OR length(trim(actor)) = 0
            OR typeof(action) <> 'text' OR length(trim(action)) = 0
            OR typeof(record_type) <> 'text' OR length(trim(record_type)) = 0
            OR typeof(record_id) <> 'text' OR length(trim(record_id)) = 0
            OR (before_json IS NOT NULL AND typeof(before_json) <> 'text')
            OR (after_json IS NOT NULL AND typeof(after_json) <> 'text')
            OR (reason IS NOT NULL AND (typeof(reason) <> 'text' OR length(trim(reason)) = 0))
        ",
    },
];

const DATE_TIME_SOURCES: &[DateTimeSource] = &[
    DateTimeSource {
        table: "media_files",
        columns: &["created_at", "updated_at", "deleted_at"],
    },
    DateTimeSource {
        table: "diet_entries",
        columns: &[
            "occurred_at",
            "local_date",
            "created_at",
            "updated_at",
            "deleted_at",
        ],
    },
    DateTimeSource {
        table: "health_events",
        columns: &[
            "occurred_at",
            "local_date",
            "created_at",
            "updated_at",
            "deleted_at",
        ],
    },
    DateTimeSource {
        table: "audit_events",
        columns: &["occurred_at"],
    },
];

const fn column(
    name: &'static str,
    column_type: &'static str,
    not_null: bool,
    primary_key: bool,
) -> ColumnSpec {
    ColumnSpec {
        name,
        column_type,
        not_null,
        primary_key,
    }
}

const fn index(
    name: &'static str,
    table: &'static str,
    create_sql: &'static str,
    required_sql: &'static [&'static str],
) -> IndexSpec {
    IndexSpec {
        name,
        table,
        create_sql,
        required_sql,
    }
}
