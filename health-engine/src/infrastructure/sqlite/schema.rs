use rusqlite::{Connection, OptionalExtension, params};
use time::format_description::FormatItem;
use time::format_description::well_known::Iso8601;
use time::macros::format_description;
use time::{Date, OffsetDateTime, PrimitiveDateTime, UtcOffset};

use super::mapping::{
    AUDIT_COLUMNS as AUDIT_SELECT_COLUMNS, DIET_COLUMNS as DIET_SELECT_COLUMNS,
    EVENT_COLUMNS as EVENT_SELECT_COLUMNS, MEDIA_COLUMNS as MEDIA_SELECT_COLUMNS,
    row_to_audit_event, row_to_diet, row_to_event, row_to_media,
};
use crate::application::error::{HealthError, HealthResult};
use crate::domain::{HealthRecordId, normalize_tags};

pub const SCHEMA_VERSION: i64 = 1;
const VALIDATION_BATCH_SIZE: i64 = 256;
const UTC_TIMESTAMP_FORMAT: &[FormatItem<'static>] =
    format_description!("[year]-[month]-[day]T[hour]:[minute]:[second].[subsecond digits:9]Z");

pub(super) fn init_schema(connection: &Connection) -> HealthResult<()> {
    connection
        .execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(migration_error)?;
    let version = user_version(connection)?;
    if version > SCHEMA_VERSION {
        return Err(newer_schema(version));
    }
    if version == SCHEMA_VERSION {
        let guards_present = TRIGGERS.iter().try_fold(true, |present, trigger| {
            Ok::<bool, HealthError>(
                present && trigger_definition(connection, trigger.name)?.is_some(),
            )
        })?;
        if guards_present {
            return check_schema(connection);
        }
        connection
            .execute_batch("BEGIN IMMEDIATE;")
            .map_err(migration_error)?;
        let result = (|| {
            create_missing_triggers(connection)?;
            validate_current_schema(connection)
        })();
        return finish_transaction(connection, result);
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
        create_missing_triggers(connection)?;
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

fn create_missing_triggers(connection: &Connection) -> HealthResult<()> {
    for trigger in TRIGGERS {
        if trigger_definition(connection, trigger.name)?.is_none() {
            connection
                .execute_batch(trigger.create_sql)
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
    for trigger in TRIGGERS {
        validate_trigger(connection, trigger)?;
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

fn trigger_definition(connection: &Connection, name: &str) -> HealthResult<Option<String>> {
    connection
        .query_row(
            "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?1",
            [name],
            |row| row.get(0),
        )
        .optional()
        .map_err(migration_error)
}

fn validate_trigger(connection: &Connection, expected: &TriggerSpec) -> HealthResult<()> {
    let actual = trigger_definition(connection, expected.name)?.ok_or_else(|| {
        HealthError::Migration(format!("required trigger {} is missing", expected.name))
    })?;
    if sql_tokens(&actual)? != sql_tokens(expected.create_sql)? {
        return Err(HealthError::Migration(format!(
            "trigger {} has an incompatible definition",
            expected.name
        )));
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
    let strict = connection
        .query_row(
            "SELECT strict
             FROM pragma_table_list
             WHERE schema = 'main' AND name = ?1",
            [expected.name],
            |row| row.get::<_, i64>(0),
        )
        .optional()
        .map_err(migration_error)?;
    if strict != Some(1) {
        return Err(HealthError::Migration(format!(
            "table {} must use SQLite STRICT storage",
            expected.name
        )));
    }
    let mut actual_checks = check_expression_tokens(&create_sql)?;
    actual_checks.sort();
    let mut required_checks = expected
        .checks
        .iter()
        .map(|required_check| sql_tokens(required_check).map(canonical_expression_tokens))
        .collect::<HealthResult<Vec<_>>>()?;
    required_checks.sort();
    if actual_checks != required_checks {
        return Err(HealthError::Migration(format!(
            "table {} has incompatible check constraints",
            expected.name
        )));
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
    validate_unique_indexes(connection, expected)?;
    validate_foreign_keys(connection, expected)
}

fn validate_unique_indexes(connection: &Connection, expected: &TableSpec) -> HealthResult<()> {
    let mut statement = connection
        .prepare(
            "SELECT name, origin
             FROM pragma_index_list(?1)
             WHERE \"unique\" = 1",
        )
        .map_err(migration_error)?;
    let unique_indexes = statement
        .query_map([expected.name], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(migration_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(migration_error)?;
    let mut actual_table_constraints = Vec::new();
    for (name, origin) in unique_indexes {
        let declared_named_index = origin == "c"
            && INDEXES
                .iter()
                .any(|index| index.table == expected.name && index.name == name && index.unique);
        match origin.as_str() {
            "pk" => {}
            "u" => actual_table_constraints.push(index_columns(connection, &name)?),
            "c" if declared_named_index => {}
            _ => {
                return Err(HealthError::Migration(format!(
                    "table {} has unexpected unique index {name}",
                    expected.name
                )));
            }
        }
    }
    actual_table_constraints.sort();
    let mut required_table_constraints = expected
        .unique_constraints
        .iter()
        .map(|constraint| {
            constraint
                .columns
                .iter()
                .map(|column| IndexColumn {
                    name: Some((*column).to_string()),
                    descending: false,
                    collation: "binary".to_string(),
                })
                .collect::<Vec<_>>()
        })
        .collect::<Vec<_>>();
    required_table_constraints.sort();
    if actual_table_constraints != required_table_constraints {
        return Err(HealthError::Migration(format!(
            "table {} has incompatible unique constraints",
            expected.name
        )));
    }
    Ok(())
}

fn validate_foreign_keys(connection: &Connection, expected: &TableSpec) -> HealthResult<()> {
    let mut statement = connection
        .prepare(
            "SELECT \"from\", \"table\", \"to\", on_update, on_delete, match
             FROM pragma_foreign_key_list(?1)",
        )
        .map_err(migration_error)?;
    let mut actual = statement
        .query_map([expected.name], |row| {
            Ok(ForeignKeyDefinition {
                from: row.get(0)?,
                table: row.get(1)?,
                to: row.get(2)?,
                on_update: row.get(3)?,
                on_delete: row.get(4)?,
                match_clause: row.get(5)?,
            })
        })
        .map_err(migration_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(migration_error)?;
    actual.sort();
    let mut required = expected
        .foreign_keys
        .iter()
        .map(|foreign_key| ForeignKeyDefinition {
            from: foreign_key.from.to_string(),
            table: foreign_key.table.to_string(),
            to: foreign_key.to.to_string(),
            on_update: foreign_key.on_update.to_string(),
            on_delete: foreign_key.on_delete.to_string(),
            match_clause: "NONE".to_string(),
        })
        .collect::<Vec<_>>();
    required.sort();
    if actual != required {
        return Err(HealthError::Migration(format!(
            "table {} has incompatible foreign-key constraints",
            expected.name
        )));
    }
    Ok(())
}

fn validate_index(connection: &Connection, expected: &IndexSpec) -> HealthResult<()> {
    let (table, sql) = index_definition(connection, expected.name)?.ok_or_else(|| {
        HealthError::Migration(format!("required index {} is missing", expected.name))
    })?;
    let metadata = connection
        .query_row(
            "SELECT \"unique\", origin, partial
             FROM pragma_index_list(?1)
             WHERE name = ?2",
            params![expected.table, expected.name],
            |row| {
                Ok(IndexMetadata {
                    unique: row.get::<_, i64>(0)? != 0,
                    origin: row.get(1)?,
                    partial: row.get::<_, i64>(2)? != 0,
                })
            },
        )
        .optional()
        .map_err(migration_error)?;
    let columns = index_columns(connection, expected.name)?;
    let predicate = index_predicate_tokens(&sql)?;
    let expected_predicate = expected
        .predicate
        .map(sql_tokens)
        .transpose()?
        .map(canonical_expression_tokens)
        .unwrap_or_default();
    let columns_match = columns.len() == expected.columns.len()
        && columns
            .iter()
            .zip(expected.columns)
            .all(|(actual, expected_name)| {
                actual.name.as_deref() == Some(*expected_name)
                    && !actual.descending
                    && actual.collation.eq_ignore_ascii_case("BINARY")
            });
    let metadata_matches = metadata.is_some_and(|metadata| {
        metadata.unique == expected.unique
            && metadata.origin == "c"
            && metadata.partial == expected.predicate.is_some()
    });
    if table != expected.table
        || !metadata_matches
        || !columns_match
        || predicate != expected_predicate
    {
        return Err(HealthError::Migration(format!(
            "index {} has an incompatible definition",
            expected.name
        )));
    }
    Ok(())
}

fn index_columns(connection: &Connection, index: &str) -> HealthResult<Vec<IndexColumn>> {
    let mut statement = connection
        .prepare(
            "SELECT name, \"desc\", coll
             FROM pragma_index_xinfo(?1)
             WHERE key = 1
             ORDER BY seqno",
        )
        .map_err(migration_error)?;
    statement
        .query_map([index], |row| {
            Ok(IndexColumn {
                name: row.get(0)?,
                descending: row.get::<_, i64>(1)? != 0,
                collation: row.get::<_, String>(2)?.to_ascii_lowercase(),
            })
        })
        .map_err(migration_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(migration_error)
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
    validate_diet_tags(connection)?;
    validate_diet_records(connection)?;
    validate_health_json(connection)?;
    validate_media_records(connection)?;
    validate_audit_json(connection)
}

fn validate_diet_tags(connection: &Connection) -> HealthResult<()> {
    let mut after_rowid = None::<i64>;
    loop {
        let mut statement = connection
            .prepare(
                "SELECT rowid, id, name
                 FROM diet_tags
                 WHERE (?1 IS NULL OR rowid > ?1)
                 ORDER BY rowid
                 LIMIT ?2",
            )
            .map_err(migration_error)?;
        let rows = statement
            .query_map(params![after_rowid, VALIDATION_BATCH_SIZE], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(migration_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(migration_error)?;
        if rows.is_empty() {
            break;
        }
        for (rowid, id, name) in &rows {
            HealthRecordId::parse(id).map_err(|error| {
                HealthError::Migration(format!(
                    "diet tag row {rowid} has an invalid identifier: {error}"
                ))
            })?;
            let normalized = normalize_tags([name.as_str()]);
            if normalized.len() != 1 || normalized[0] != *name {
                return Err(HealthError::Migration(format!(
                    "diet tag row {rowid} has a noncanonical name"
                )));
            }
        }
        after_rowid = rows.last().map(|row| row.0);
    }
    Ok(())
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
    let date = Date::parse(value, &Iso8601::DATE)
        .map_err(|error| HealthError::Storage(format!("invalid persisted local date: {error}")))?;
    if date.to_string() != value {
        return Err(HealthError::Storage(
            "persisted local dates must use canonical YYYY-MM-DD notation".to_string(),
        ));
    }
    Ok(date)
}

pub(super) fn parse_utc_time(value: &str) -> HealthResult<OffsetDateTime> {
    let timestamp = PrimitiveDateTime::parse(value, UTC_TIMESTAMP_FORMAT)
        .map_err(|error| HealthError::Storage(format!("invalid persisted timestamp: {error}")))?;
    let timestamp = timestamp.assume_utc();
    if format_utc_time(timestamp)? != value {
        return Err(HealthError::Storage(
            "persisted timestamps must use fixed-width UTC notation".to_string(),
        ));
    }
    Ok(timestamp)
}

pub(super) fn format_utc_time(value: OffsetDateTime) -> HealthResult<String> {
    value
        .to_offset(UtcOffset::UTC)
        .format(UTC_TIMESTAMP_FORMAT)
        .map_err(|error| HealthError::Storage(error.to_string()))
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

fn index_predicate_tokens(sql: &str) -> HealthResult<Vec<String>> {
    let tokens = sql_tokens(sql)?;
    Ok(tokens
        .iter()
        .position(|token| token == "where")
        .map_or_else(Vec::new, |index| {
            canonical_expression_tokens(tokens[index + 1..].to_vec())
        }))
}

fn check_expression_tokens(sql: &str) -> HealthResult<Vec<Vec<String>>> {
    let tokens = sql_tokens(sql)?;
    let mut checks = Vec::new();
    let mut index = 0;
    while index < tokens.len() {
        if tokens[index] != "check" {
            index += 1;
            continue;
        }
        if tokens.get(index + 1).map(String::as_str) != Some("(") {
            return Err(HealthError::Migration(
                "CHECK constraint is missing its expression".to_string(),
            ));
        }
        let mut depth = 1_u32;
        let start = index + 2;
        index = start;
        while index < tokens.len() && depth > 0 {
            match tokens[index].as_str() {
                "(" => depth += 1,
                ")" => depth -= 1,
                _ => {}
            }
            index += 1;
        }
        if depth != 0 {
            return Err(HealthError::Migration(
                "unterminated CHECK constraint".to_string(),
            ));
        }
        checks.push(canonical_expression_tokens(
            tokens[start..index - 1].to_vec(),
        ));
    }
    Ok(checks)
}

fn canonical_expression_tokens(mut tokens: Vec<String>) -> Vec<String> {
    while tokens.first().is_some_and(|token| token == "(")
        && tokens.last().is_some_and(|token| token == ")")
        && outer_parentheses_enclose_all(&tokens)
    {
        tokens.remove(0);
        tokens.pop();
    }
    tokens
}

fn outer_parentheses_enclose_all(tokens: &[String]) -> bool {
    let mut depth = 0_u32;
    for (index, token) in tokens.iter().enumerate() {
        match token.as_str() {
            "(" => depth += 1,
            ")" => {
                let Some(next_depth) = depth.checked_sub(1) else {
                    return false;
                };
                depth = next_depth;
                if depth == 0 && index + 1 != tokens.len() {
                    return false;
                }
            }
            _ => {}
        }
    }
    depth == 0
}

fn sql_tokens(sql: &str) -> HealthResult<Vec<String>> {
    let characters = sql.as_bytes();
    let mut tokens = Vec::new();
    let mut index = 0;
    while index < characters.len() {
        let byte = characters[index];
        if byte.is_ascii_whitespace() || byte == b';' {
            index += 1;
            continue;
        }
        if byte == b'-' && characters.get(index + 1) == Some(&b'-') {
            index += 2;
            while index < characters.len() && characters[index] != b'\n' {
                index += 1;
            }
            continue;
        }
        if byte == b'/' && characters.get(index + 1) == Some(&b'*') {
            index += 2;
            while index + 1 < characters.len()
                && !(characters[index] == b'*' && characters[index + 1] == b'/')
            {
                index += 1;
            }
            if index + 1 >= characters.len() {
                return Err(HealthError::Migration(
                    "unterminated SQL block comment".to_string(),
                ));
            }
            index += 2;
            continue;
        }
        if byte.is_ascii_alphanumeric() || byte == b'_' {
            let start = index;
            index += 1;
            while index < characters.len()
                && (characters[index].is_ascii_alphanumeric() || characters[index] == b'_')
            {
                index += 1;
            }
            tokens.push(sql[start..index].to_ascii_lowercase());
            continue;
        }
        if matches!(byte, b'"' | b'`' | b'[') {
            let closing = if byte == b'[' { b']' } else { byte };
            index += 1;
            let mut identifier = String::new();
            loop {
                let Some(&current) = characters.get(index) else {
                    return Err(HealthError::Migration(
                        "unterminated quoted SQL identifier".to_string(),
                    ));
                };
                if current == closing {
                    if characters.get(index + 1) == Some(&closing) && closing != b']' {
                        identifier.push(char::from(closing));
                        index += 2;
                        continue;
                    }
                    index += 1;
                    break;
                }
                identifier.push(char::from(current));
                index += 1;
            }
            tokens.push(identifier.to_ascii_lowercase());
            continue;
        }
        if byte == b'\'' {
            index += 1;
            let mut literal = String::new();
            loop {
                let Some(&current) = characters.get(index) else {
                    return Err(HealthError::Migration(
                        "unterminated SQL string literal".to_string(),
                    ));
                };
                if current == b'\'' {
                    if characters.get(index + 1) == Some(&b'\'') {
                        literal.push('\'');
                        index += 2;
                        continue;
                    }
                    index += 1;
                    break;
                }
                literal.push(char::from(current));
                index += 1;
            }
            tokens.push(format!("'{literal}'"));
            continue;
        }
        if let Some(next) = characters.get(index + 1) {
            let pair = [byte, *next];
            if matches!(
                pair,
                [b'<', b'='] | [b'>', b'='] | [b'<', b'>'] | [b'!', b'='] | [b'=', b'=']
            ) {
                tokens.push(if pair == [b'=', b'='] {
                    "=".to_string()
                } else {
                    String::from_utf8_lossy(&pair).to_string()
                });
                index += 2;
                continue;
            }
        }
        tokens.push(char::from(byte).to_string());
        index += 1;
    }
    Ok(tokens)
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
    checks: &'static [&'static str],
    foreign_keys: &'static [ForeignKeySpec],
    unique_constraints: &'static [UniqueConstraintSpec],
}

struct IndexSpec {
    name: &'static str,
    table: &'static str,
    create_sql: &'static str,
    unique: bool,
    columns: &'static [&'static str],
    predicate: Option<&'static str>,
}

struct TriggerSpec {
    name: &'static str,
    create_sql: &'static str,
}

struct IndexMetadata {
    unique: bool,
    origin: String,
    partial: bool,
}

#[derive(Debug, PartialEq, Eq, PartialOrd, Ord)]
struct IndexColumn {
    name: Option<String>,
    descending: bool,
    collation: String,
}

struct UniqueConstraintSpec {
    columns: &'static [&'static str],
}

struct ForeignKeySpec {
    from: &'static str,
    table: &'static str,
    to: &'static str,
    on_update: &'static str,
    on_delete: &'static str,
}

#[derive(Debug, PartialEq, Eq, PartialOrd, Ord)]
struct ForeignKeyDefinition {
    from: String,
    table: String,
    to: String,
    on_update: String,
    on_delete: String,
    match_clause: String,
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
        checks: &[
            "mime_type IN ('image/jpeg', 'image/png', 'image/webp')",
            "typeof(byte_size) = 'integer' AND byte_size >= 0",
            "typeof(cleanup_pending) = 'integer' AND cleanup_pending IN (0, 1)",
        ],
        foreign_keys: &[],
        unique_constraints: &[unique(&["relative_path"])],
    },
    TableSpec {
        name: "diet_entries",
        columns: DIET_COLUMNS,
        checks: &["meal_type IN ('breakfast', 'lunch', 'dinner', 'snack', 'late_night')"],
        foreign_keys: &[foreign_key(
            "media_id",
            "media_files",
            "id",
            "NO ACTION",
            "NO ACTION",
        )],
        unique_constraints: &[],
    },
    TableSpec {
        name: "diet_tags",
        columns: TAG_COLUMNS,
        checks: &[],
        foreign_keys: &[],
        unique_constraints: &[],
    },
    TableSpec {
        name: "diet_entry_tags",
        columns: DIET_TAG_COLUMNS,
        checks: &[],
        foreign_keys: &[
            foreign_key(
                "diet_entry_id",
                "diet_entries",
                "id",
                "NO ACTION",
                "CASCADE",
            ),
            foreign_key("tag_id", "diet_tags", "id", "NO ACTION", "NO ACTION"),
        ],
        unique_constraints: &[],
    },
    TableSpec {
        name: "health_events",
        columns: EVENT_COLUMNS,
        checks: &[
            "category IN ('weight', 'bowel', 'sleep', 'lab', 'symptom', 'medication')",
            "typeof(daily_upsert) = 'integer' AND daily_upsert IN (0, 1)",
        ],
        foreign_keys: &[],
        unique_constraints: &[],
    },
    TableSpec {
        name: "audit_events",
        columns: AUDIT_COLUMNS,
        checks: &[],
        foreign_keys: &[],
        unique_constraints: &[],
    },
];

const TRIGGERS: &[TriggerSpec] = &[
    TriggerSpec {
        name: "health_media_lifecycle_insert",
        create_sql: "
            CREATE TRIGGER health_media_lifecycle_insert
            BEFORE INSERT ON media_files
            WHEN NEW.cleanup_pending = 1 AND NEW.deleted_at IS NULL
            BEGIN
                SELECT RAISE(ABORT, 'cleanup pending media must be tombstoned');
            END;",
    },
    TriggerSpec {
        name: "health_media_lifecycle_update",
        create_sql: "
            CREATE TRIGGER health_media_lifecycle_update
            BEFORE UPDATE OF cleanup_pending, deleted_at ON media_files
            WHEN NEW.cleanup_pending = 1 AND NEW.deleted_at IS NULL
            BEGIN
                SELECT RAISE(ABORT, 'cleanup pending media must be tombstoned');
            END;",
    },
    TriggerSpec {
        name: "health_diet_active_media_insert",
        create_sql: "
            CREATE TRIGGER health_diet_active_media_insert
            BEFORE INSERT ON diet_entries
            WHEN NEW.deleted_at IS NULL AND NEW.media_id IS NOT NULL
                 AND NOT EXISTS (
                    SELECT 1 FROM media_files
                    WHERE id = NEW.media_id
                      AND deleted_at IS NULL
                      AND cleanup_pending = 0
                 )
            BEGIN
                SELECT RAISE(ABORT, 'active diet must reference active media');
            END;",
    },
    TriggerSpec {
        name: "health_diet_active_media_update",
        create_sql: "
            CREATE TRIGGER health_diet_active_media_update
            BEFORE UPDATE OF media_id, deleted_at ON diet_entries
            WHEN NEW.deleted_at IS NULL AND NEW.media_id IS NOT NULL
                 AND NOT EXISTS (
                    SELECT 1 FROM media_files
                    WHERE id = NEW.media_id
                      AND deleted_at IS NULL
                      AND cleanup_pending = 0
                 )
            BEGIN
                SELECT RAISE(ABORT, 'active diet must reference active media');
            END;",
    },
    TriggerSpec {
        name: "health_media_tombstone_unreferenced",
        create_sql: "
            CREATE TRIGGER health_media_tombstone_unreferenced
            BEFORE UPDATE OF cleanup_pending, deleted_at ON media_files
            WHEN (NEW.deleted_at IS NOT NULL OR NEW.cleanup_pending = 1)
                 AND EXISTS (
                    SELECT 1 FROM diet_entries
                    WHERE media_id = NEW.id AND deleted_at IS NULL
                 )
            BEGIN
                SELECT RAISE(ABORT, 'referenced media cannot be tombstoned');
            END;",
    },
];

const INDEXES: &[IndexSpec] = &[
    index(
        "idx_diet_entries_occurred_at",
        "diet_entries",
        "CREATE INDEX IF NOT EXISTS idx_diet_entries_occurred_at
         ON diet_entries(occurred_at, id);",
        false,
        &["occurred_at", "id"],
        None,
    ),
    index(
        "idx_diet_entries_deleted_at",
        "diet_entries",
        "CREATE INDEX IF NOT EXISTS idx_diet_entries_deleted_at
         ON diet_entries(deleted_at, occurred_at);",
        false,
        &["deleted_at", "occurred_at"],
        None,
    ),
    index(
        "uq_diet_tags_name",
        "diet_tags",
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_diet_tags_name ON diet_tags(name);",
        true,
        &["name"],
        None,
    ),
    index(
        "idx_diet_entry_tags_tag",
        "diet_entry_tags",
        "CREATE INDEX IF NOT EXISTS idx_diet_entry_tags_tag
         ON diet_entry_tags(tag_id, diet_entry_id);",
        false,
        &["tag_id", "diet_entry_id"],
        None,
    ),
    index(
        "idx_health_events_occurred_at",
        "health_events",
        "CREATE INDEX IF NOT EXISTS idx_health_events_occurred_at
         ON health_events(occurred_at, id);",
        false,
        &["occurred_at", "id"],
        None,
    ),
    index(
        "idx_health_events_category",
        "health_events",
        "CREATE INDEX IF NOT EXISTS idx_health_events_category
         ON health_events(category, occurred_at);",
        false,
        &["category", "occurred_at"],
        None,
    ),
    index(
        "idx_health_events_metric_key",
        "health_events",
        "CREATE INDEX IF NOT EXISTS idx_health_events_metric_key
         ON health_events(metric_key, occurred_at);",
        false,
        &["metric_key", "occurred_at"],
        None,
    ),
    index(
        "idx_health_events_deleted_at",
        "health_events",
        "CREATE INDEX IF NOT EXISTS idx_health_events_deleted_at
         ON health_events(deleted_at, occurred_at);",
        false,
        &["deleted_at", "occurred_at"],
        None,
    ),
    index(
        "uq_health_daily_metric",
        "health_events",
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_health_daily_metric
         ON health_events(local_date, category, metric_key)
         WHERE deleted_at IS NULL AND daily_upsert = 1;",
        true,
        &["local_date", "category", "metric_key"],
        Some("deleted_at IS NULL AND daily_upsert = 1"),
    ),
    index(
        "idx_media_files_checksum",
        "media_files",
        "CREATE INDEX IF NOT EXISTS idx_media_files_checksum
         ON media_files(checksum_sha256);",
        false,
        &["checksum_sha256"],
        None,
    ),
    index(
        "idx_media_files_cleanup_pending",
        "media_files",
        "CREATE INDEX IF NOT EXISTS idx_media_files_cleanup_pending
         ON media_files(cleanup_pending, id);",
        false,
        &["cleanup_pending", "id"],
        None,
    ),
    index(
        "idx_audit_events_record",
        "audit_events",
        "CREATE INDEX IF NOT EXISTS idx_audit_events_record
         ON audit_events(record_type, record_id, occurred_at);",
        false,
        &["record_type", "record_id", "occurred_at"],
        None,
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
            OR (cleanup_pending = 1 AND deleted_at IS NULL)
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

const fn foreign_key(
    from: &'static str,
    table: &'static str,
    to: &'static str,
    on_update: &'static str,
    on_delete: &'static str,
) -> ForeignKeySpec {
    ForeignKeySpec {
        from,
        table,
        to,
        on_update,
        on_delete,
    }
}

const fn unique(columns: &'static [&'static str]) -> UniqueConstraintSpec {
    UniqueConstraintSpec { columns }
}

const fn index(
    name: &'static str,
    table: &'static str,
    create_sql: &'static str,
    unique: bool,
    columns: &'static [&'static str],
    predicate: Option<&'static str>,
) -> IndexSpec {
    IndexSpec {
        name,
        table,
        create_sql,
        unique,
        columns,
        predicate,
    }
}
