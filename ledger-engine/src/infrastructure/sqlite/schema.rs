use std::collections::BTreeSet;

use rusqlite::{Connection, OptionalExtension, params};
use time::format_description::well_known::Rfc3339;
use time::{OffsetDateTime, UtcOffset};

use super::audit_json::{self, AUDIT_JSON_MAX_BYTES};
use super::is_busy_error;
use crate::application::error::{LedgerError, LedgerResult};

pub(super) const SCHEMA_VERSION: i64 = 2;
const LEGACY_UNKNOWN_TIMESTAMP: &str = "1970-01-01T00:00:00Z";
const TIMESTAMP_MIGRATION_BATCH_SIZE: i64 = 256;
const AUDIT_JSON_VALIDATION_BATCH_SIZE: i64 = 256;

pub(super) fn init_schema(connection: &Connection) -> LedgerResult<()> {
    connection
        .execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(migration_error)?;

    if user_version(connection)? == SCHEMA_VERSION {
        return check_schema(connection);
    }

    connection
        .execute_batch("BEGIN IMMEDIATE;")
        .map_err(migration_error)?;
    let result = (|| {
        let version = user_version(connection)?;
        if version > SCHEMA_VERSION {
            return Err(LedgerError::Migration(format!(
                "ledger schema version {version} is newer than supported version {SCHEMA_VERSION}"
            )));
        }
        if version == SCHEMA_VERSION {
            return validate_current_schema(connection);
        }
        create_missing_tables(connection)?;
        reconcile_tables(connection)?;
        backfill_migration_timestamps(connection)?;
        ensure_timestamp_guards(connection)?;
        ensure_indexes(connection)?;
        validate_schema_objects(connection)?;
        normalize_persisted_timestamps(connection)?;
        validate_persisted_integrity(connection)?;
        connection
            .pragma_update(None, "user_version", SCHEMA_VERSION)
            .map_err(migration_error)?;
        Ok(())
    })();

    finish_transaction(connection, result)
}

fn finish_transaction(connection: &Connection, result: LedgerResult<()>) -> LedgerResult<()> {
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

pub(super) fn check_schema(connection: &Connection) -> LedgerResult<()> {
    connection
        .execute_batch("BEGIN DEFERRED;")
        .map_err(migration_error)?;
    let result = validate_current_schema(connection);
    finish_transaction(connection, result)
}

fn validate_current_schema(connection: &Connection) -> LedgerResult<()> {
    let version = user_version(connection)?;
    if version != SCHEMA_VERSION {
        return Err(LedgerError::Migration(format!(
            "ledger schema version {version} does not match supported version {SCHEMA_VERSION}"
        )));
    }
    validate_schema_objects(connection)?;
    validate_persisted_integrity(connection)
}

pub(super) fn user_version(connection: &Connection) -> LedgerResult<i64> {
    connection
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(migration_error)
}

fn create_missing_tables(connection: &Connection) -> LedgerResult<()> {
    connection
        .execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS currencies (
                id TEXT NOT NULL PRIMARY KEY,
                code TEXT NOT NULL,
                name TEXT NOT NULL,
                symbol TEXT NOT NULL,
                decimal_places INTEGER NOT NULL CHECK (
                    decimal_places >= 0 AND decimal_places <= 18
                ),
                active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                deleted_at TEXT
            ) STRICT;

            CREATE TABLE IF NOT EXISTS account_categories (
                id TEXT NOT NULL PRIMARY KEY,
                name TEXT NOT NULL,
                parent_id TEXT REFERENCES account_categories(id),
                liability INTEGER NOT NULL DEFAULT 0 CHECK (liability IN (0, 1)),
                active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                deleted_at TEXT
            ) STRICT;

            CREATE TABLE IF NOT EXISTS accounts (
                id TEXT NOT NULL PRIMARY KEY,
                name TEXT NOT NULL,
                account_category_id TEXT NOT NULL REFERENCES account_categories(id),
                currency_id TEXT NOT NULL REFERENCES currencies(id),
                opening_balance_minor INTEGER NOT NULL DEFAULT 0 CHECK (
                    typeof(opening_balance_minor) = 'integer'
                ),
                active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                deleted_at TEXT
            ) STRICT;

            CREATE TABLE IF NOT EXISTS transaction_categories (
                id TEXT NOT NULL PRIMARY KEY,
                name TEXT NOT NULL,
                parent_id TEXT REFERENCES transaction_categories(id),
                kind TEXT NOT NULL CHECK (kind IN ('expense', 'income')),
                active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                deleted_at TEXT
            ) STRICT;

            CREATE TABLE IF NOT EXISTS ledger_entries (
                id TEXT NOT NULL PRIMARY KEY,
                date TEXT NOT NULL,
                written_at TEXT NOT NULL,
                content TEXT NOT NULL,
                transaction_category_id TEXT REFERENCES transaction_categories(id),
                account_id TEXT NOT NULL REFERENCES accounts(id),
                entry_type TEXT NOT NULL CHECK (
                    entry_type IN (
                        'expense',
                        'income',
                        'transfer_out',
                        'transfer_in',
                        'adjustment_out',
                        'adjustment_in'
                    )
                ),
                amount_minor INTEGER NOT NULL CHECK (
                    typeof(amount_minor) = 'integer' AND amount_minor > 0
                ),
                currency_id TEXT NOT NULL REFERENCES currencies(id),
                transfer_group_id TEXT,
                source TEXT NOT NULL,
                notes TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                deleted_at TEXT
            ) STRICT;

            CREATE TABLE IF NOT EXISTS audit_events (
                id TEXT NOT NULL PRIMARY KEY,
                occurred_at TEXT NOT NULL,
                actor TEXT NOT NULL,
                action TEXT NOT NULL,
                record_type TEXT NOT NULL,
                record_id TEXT NOT NULL,
                before_json TEXT,
                after_json TEXT,
                reason TEXT
            ) STRICT;

            CREATE TABLE IF NOT EXISTS transfer_operations (
                operation_key TEXT NOT NULL PRIMARY KEY,
                payload_json TEXT NOT NULL,
                result_json TEXT NOT NULL,
                created_at TEXT NOT NULL
            ) STRICT;
            "#,
        )
        .map_err(migration_error)
}

fn reconcile_tables(connection: &Connection) -> LedgerResult<()> {
    for table in TABLES {
        let existing = table_columns(connection, table.name)?;
        for column in table.columns {
            if !existing.iter().any(|present| present.name == column.name) {
                let addition = column.addition.ok_or_else(|| {
                    LedgerError::Migration(format!(
                        "table {} is missing required column {} that cannot be added safely",
                        table.name, column.name
                    ))
                })?;
                connection
                    .execute_batch(&format!(
                        "ALTER TABLE {} ADD COLUMN {};",
                        table.name, addition
                    ))
                    .map_err(migration_error)?;
            }
        }
    }
    Ok(())
}

fn backfill_migration_timestamps(connection: &Connection) -> LedgerResult<()> {
    for (table, created_at, updated_at) in TIMESTAMP_PAIRS {
        connection
            .execute(
                &format!(
                    "UPDATE {table}
                     SET {created_at} = CASE
                             WHEN {created_at} = '' AND {updated_at} <> ''
                                 THEN {updated_at}
                             WHEN {created_at} = ''
                                 THEN ?1
                             ELSE {created_at}
                         END,
                         {updated_at} = CASE
                             WHEN {updated_at} = '' AND {created_at} <> ''
                                 THEN {created_at}
                             WHEN {updated_at} = ''
                                 THEN ?1
                             ELSE {updated_at}
                         END
                     WHERE {created_at} = '' OR {updated_at} = ''"
                ),
                [LEGACY_UNKNOWN_TIMESTAMP],
            )
            .map_err(migration_error)?;
    }
    Ok(())
}

fn ensure_timestamp_guards(connection: &Connection) -> LedgerResult<()> {
    for table in PERSISTED_TABLES {
        let columns = table_columns(connection, table.name)?;
        for timestamp in table
            .timestamps
            .iter()
            .filter(|timestamp| !timestamp.nullable)
        {
            let column = columns
                .iter()
                .find(|column| column.name == timestamp.column)
                .ok_or_else(|| {
                    LedgerError::Migration(format!(
                        "table {} is missing required timestamp {}",
                        table.name, timestamp.column
                    ))
                })?;
            match column.default_value.as_deref() {
                None => {}
                Some("''") => ensure_timestamp_guard(connection, timestamp)?,
                Some(default) => {
                    return Err(LedgerError::Migration(format!(
                        "table {} timestamp {} has unsupported permissive default {default}",
                        table.name, timestamp.column
                    )));
                }
            }
        }
    }
    Ok(())
}

fn ensure_timestamp_guard(
    connection: &Connection,
    timestamp: &TimestampColumn,
) -> LedgerResult<()> {
    let name = timestamp_guard_name(timestamp);
    let expected_sql = timestamp_guard_sql(timestamp);
    match connection
        .query_row(
            "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?1",
            [&name],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(migration_error)?
    {
        Some(actual_sql) if normalize_sql(&actual_sql) != normalize_sql(&expected_sql) => Err(
            LedgerError::Migration(format!("trigger {name} has an incompatible definition")),
        ),
        Some(_) => Ok(()),
        None => connection
            .execute_batch(&expected_sql)
            .map_err(migration_error),
    }
}

fn validate_timestamp_guards(connection: &Connection) -> LedgerResult<()> {
    for table in PERSISTED_TABLES {
        let columns = table_columns(connection, table.name)?;
        for timestamp in table
            .timestamps
            .iter()
            .filter(|timestamp| !timestamp.nullable)
        {
            let column = columns
                .iter()
                .find(|column| column.name == timestamp.column)
                .ok_or_else(|| {
                    LedgerError::Migration(format!(
                        "table {} is missing required timestamp {}",
                        table.name, timestamp.column
                    ))
                })?;
            match column.default_value.as_deref() {
                None => {}
                Some("''") => {
                    let name = timestamp_guard_name(timestamp);
                    let actual_sql = connection
                        .query_row(
                            "SELECT sql FROM sqlite_master
                             WHERE type = 'trigger' AND name = ?1",
                            [&name],
                            |row| row.get::<_, String>(0),
                        )
                        .optional()
                        .map_err(migration_error)?
                        .ok_or_else(|| {
                            LedgerError::Migration(format!(
                                "required timestamp guard {name} is missing"
                            ))
                        })?;
                    if normalize_sql(&actual_sql) != normalize_sql(&timestamp_guard_sql(timestamp))
                    {
                        return Err(LedgerError::Migration(format!(
                            "trigger {name} has an incompatible definition"
                        )));
                    }
                }
                Some(default) => {
                    return Err(LedgerError::Migration(format!(
                        "table {} timestamp {} has unsupported permissive default {default}",
                        table.name, timestamp.column
                    )));
                }
            }
        }
    }
    Ok(())
}

fn timestamp_guard_name(timestamp: &TimestampColumn) -> String {
    format!("ledger_require_{}_{}", timestamp.table, timestamp.column)
}

fn timestamp_guard_sql(timestamp: &TimestampColumn) -> String {
    format!(
        "CREATE TRIGGER {}
         BEFORE INSERT ON {}
         WHEN NEW.{} = ''
         BEGIN
             SELECT RAISE(ABORT, 'explicit {} is required');
         END;",
        timestamp_guard_name(timestamp),
        timestamp.table,
        timestamp.column,
        timestamp.column
    )
}

fn ensure_indexes(connection: &Connection) -> LedgerResult<()> {
    for index in INDEXES {
        match index_definition(connection, index.name)? {
            Some(actual) => validate_index(index, &actual)?,
            None => {
                connection
                    .execute_batch(index.create_sql)
                    .map_err(migration_error)?;
            }
        }
    }
    Ok(())
}

fn validate_schema_objects(connection: &Connection) -> LedgerResult<()> {
    for table in TABLES {
        validate_table(connection, table)?;
    }
    validate_timestamp_guards(connection)?;
    for index in INDEXES {
        let actual = index_definition(connection, index.name)?.ok_or_else(|| {
            LedgerError::Migration(format!("required index {} is missing", index.name))
        })?;
        validate_index(index, &actual)?;
    }
    Ok(())
}

fn validate_table(connection: &Connection, expected: &TableSpec) -> LedgerResult<()> {
    let actual = table_columns(connection, expected.name)?;
    if actual.is_empty() {
        return Err(LedgerError::Migration(format!(
            "required table {} is missing",
            expected.name
        )));
    }

    for column in expected.columns {
        let actual = actual
            .iter()
            .find(|present| present.name == column.name)
            .ok_or_else(|| {
                LedgerError::Migration(format!(
                    "table {} is missing required column {}",
                    expected.name, column.name
                ))
            })?;
        if !actual.column_type.eq_ignore_ascii_case(column.column_type)
            || actual.not_null != column.not_null
            || actual.primary_key != column.primary_key
        {
            return Err(LedgerError::Migration(format!(
                "column {}.{} has incompatible type or constraints",
                expected.name, column.name
            )));
        }
    }

    let create_sql = connection
        .query_row(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?1",
            [expected.name],
            |row| row.get::<_, String>(0),
        )
        .map_err(migration_error)?;
    let normalized = normalize_sql(&create_sql);
    for required in expected.required_sql {
        if !normalized.contains(required) {
            return Err(LedgerError::Migration(format!(
                "table {} is missing required constraint {required}",
                expected.name
            )));
        }
    }

    let actual_foreign_keys = foreign_keys(connection, expected.name)?;
    let expected_foreign_keys = expected
        .foreign_keys
        .iter()
        .map(|foreign_key| {
            (
                foreign_key.from.to_string(),
                foreign_key.table.to_string(),
                foreign_key.to.to_string(),
                "NO ACTION".to_string(),
                "NO ACTION".to_string(),
            )
        })
        .collect::<BTreeSet<_>>();
    if actual_foreign_keys != expected_foreign_keys {
        return Err(LedgerError::Migration(format!(
            "table {} has incompatible foreign keys",
            expected.name
        )));
    }
    Ok(())
}

fn validate_persisted_integrity(connection: &Connection) -> LedgerResult<()> {
    for table in PERSISTED_TABLES {
        validate_persisted_table(connection, table)?;
    }
    validate_audit_json_integrity(connection)?;

    let broken_foreign_key: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM pragma_foreign_key_check)",
            [],
            |row| row.get(0),
        )
        .map_err(migration_error)?;
    if broken_foreign_key {
        return Err(LedgerError::Migration(
            "ledger database contains broken foreign-key references".to_string(),
        ));
    }
    Ok(())
}

fn validate_audit_json_integrity(connection: &Connection) -> LedgerResult<()> {
    let oversized: bool = connection
        .query_row(
            "SELECT EXISTS(
                SELECT 1
                FROM audit_events
                WHERE (
                    before_json IS NOT NULL
                    AND length(CAST(before_json AS BLOB)) > ?1
                ) OR (
                    after_json IS NOT NULL
                    AND length(CAST(after_json AS BLOB)) > ?1
                )
                LIMIT 1
            )",
            [AUDIT_JSON_MAX_BYTES as i64],
            |row| row.get(0),
        )
        .map_err(migration_error)?;
    if oversized {
        return Err(LedgerError::Migration(format!(
            "audit JSON exceeds the maximum size of {AUDIT_JSON_MAX_BYTES} bytes"
        )));
    }

    let mut after_id = None;
    loop {
        let Some(next_after_id) = validate_audit_json_batch(connection, after_id.as_deref())?
        else {
            break;
        };
        after_id = Some(next_after_id);
    }
    Ok(())
}

fn validate_audit_json_batch(
    connection: &Connection,
    after_id: Option<&str>,
) -> LedgerResult<Option<String>> {
    let mut statement = connection
        .prepare(
            "SELECT id, before_json, after_json
             FROM audit_events
             WHERE ?1 IS NULL OR id > ?1
             ORDER BY id
             LIMIT ?2",
        )
        .map_err(migration_error)?;
    let mut rows = statement
        .query(params![after_id, AUDIT_JSON_VALIDATION_BATCH_SIZE])
        .map_err(migration_error)?;
    let mut last_id = None;
    while let Some(row) = rows.next().map_err(migration_error)? {
        let id: String = row.get(0).map_err(migration_error)?;
        let before: Option<String> = row.get(1).map_err(migration_error)?;
        let after: Option<String> = row.get(2).map_err(migration_error)?;
        validate_audit_json_value(&id, "before_json", before.as_deref())?;
        validate_audit_json_value(&id, "after_json", after.as_deref())?;
        last_id = Some(id);
    }
    Ok(last_id)
}

fn validate_audit_json_value(id: &str, column: &str, value: Option<&str>) -> LedgerResult<()> {
    audit_json::decode_optional(value).map_err(|error| {
        LedgerError::Migration(format!(
            "audit JSON in audit_events.{column} for record {id} cannot be decoded safely: {error}"
        ))
    })?;
    Ok(())
}

fn validate_persisted_table(
    connection: &Connection,
    table: &PersistedTableSpec,
) -> LedgerResult<()> {
    let mut invalid = Vec::new();
    invalid.extend(
        table
            .required_nonblank_text
            .iter()
            .map(|column| invalid_required_text_sql(column)),
    );
    invalid.extend(
        table
            .optional_nonblank_text
            .iter()
            .map(|column| invalid_optional_text_sql(column, true)),
    );
    invalid.extend(
        table
            .required_text
            .iter()
            .map(|column| format!("typeof({column}) <> 'text'")),
    );
    invalid.extend(
        table
            .optional_text
            .iter()
            .map(|column| invalid_optional_text_sql(column, false)),
    );
    invalid.extend(
        table
            .booleans
            .iter()
            .map(|column| format!("typeof({column}) <> 'integer' OR {column} NOT IN (0, 1)")),
    );
    invalid.extend(table.timestamps.iter().map(invalid_timestamp_sql));
    invalid.extend(table.extra_invalid.iter().map(ToString::to_string));

    let corrupt: bool = connection
        .query_row(
            &format!(
                "SELECT EXISTS(
                    SELECT 1 FROM {} WHERE {} LIMIT 1
                )",
                table.name,
                invalid
                    .iter()
                    .map(|predicate| format!("({predicate})"))
                    .collect::<Vec<_>>()
                    .join(" OR ")
            ),
            [],
            |row| row.get(0),
        )
        .map_err(migration_error)?;
    if corrupt {
        return Err(LedgerError::Migration(format!(
            "table {} contains persisted scalar values that cannot be read safely",
            table.name
        )));
    }
    Ok(())
}

fn invalid_required_text_sql(column: &str) -> String {
    format!(
        "typeof({column}) <> 'text' OR \
         length(trim({column}, {})) = 0",
        unicode_whitespace_sql()
    )
}

fn invalid_optional_text_sql(column: &str, reject_blank: bool) -> String {
    let blank = if reject_blank {
        format!(
            " OR length(trim({column}, {})) = 0",
            unicode_whitespace_sql()
        )
    } else {
        String::new()
    };
    format!("{column} IS NOT NULL AND (typeof({column}) <> 'text'{blank})")
}

fn unicode_whitespace_sql() -> &'static str {
    "char(
        9, 10, 11, 12, 13, 32, 133, 160, 5760,
        8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200, 8201, 8202,
        8232, 8233, 8239, 8287, 12288
    )"
}

fn invalid_timestamp_sql(timestamp: &TimestampColumn) -> String {
    let column = timestamp.column;
    let invalid_value = format!(
        "typeof({column}) <> 'text'
         OR length({column}) < 20
         OR substr({column}, 5, 1) <> '-'
         OR substr({column}, 8, 1) <> '-'
         OR substr({column}, 11, 1) <> 'T'
         OR substr({column}, 14, 1) <> ':'
         OR substr({column}, 17, 1) <> ':'
         OR substr({column}, -1, 1) <> 'Z'
         OR substr({column}, 1, 19)
            NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]'
         OR strftime('%Y-%m-%dT%H:%M:%S', {column}) IS NULL
         OR strftime('%Y-%m-%dT%H:%M:%S', {column}) <> substr({column}, 1, 19)
         OR (
             length({column}) > 20
             AND (
                 substr({column}, 20, 1) <> '.'
                 OR length(substr({column}, 21, length({column}) - 21)) = 0
                 OR substr({column}, 21, length({column}) - 21) GLOB '*[^0-9]*'
             )
         )"
    );
    if timestamp.nullable {
        format!("{column} IS NOT NULL AND ({invalid_value})")
    } else {
        invalid_value
    }
}

fn normalize_persisted_timestamps(connection: &Connection) -> LedgerResult<()> {
    for table in PERSISTED_TABLES {
        for timestamp in table.timestamps {
            let mut after_id = None;
            loop {
                let rows = timestamp_batch(connection, timestamp, after_id.as_deref())?;
                let Some((last_id, _)) = rows.last() else {
                    break;
                };
                let next_after_id = last_id.clone();
                for (id, value) in rows {
                    let normalized = normalize_timestamp(timestamp, &id, &value)?;
                    if normalized != value {
                        let identity_column = timestamp_identity_column(timestamp);
                        connection
                            .execute(
                                &format!(
                                    "UPDATE {} SET {} = ?1 WHERE {} = ?2",
                                    timestamp.table, timestamp.column, identity_column
                                ),
                                params![normalized, id],
                            )
                            .map_err(migration_error)?;
                    }
                }
                after_id = Some(next_after_id);
            }
        }
    }
    Ok(())
}

fn timestamp_batch(
    connection: &Connection,
    timestamp: &TimestampColumn,
    after_id: Option<&str>,
) -> LedgerResult<Vec<(String, String)>> {
    let identity_column = timestamp_identity_column(timestamp);
    let mut statement = connection
        .prepare(&format!(
            "SELECT {2}, {0}
             FROM {1}
             WHERE {0} IS NOT NULL AND (?1 IS NULL OR {2} > ?1)
             ORDER BY {2}
             LIMIT ?2",
            timestamp.column, timestamp.table, identity_column
        ))
        .map_err(migration_error)?;
    statement
        .query_map(params![after_id, TIMESTAMP_MIGRATION_BATCH_SIZE], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })
        .map_err(migration_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(migration_error)
}

fn timestamp_identity_column(timestamp: &TimestampColumn) -> &'static str {
    if timestamp.table == "transfer_operations" {
        "operation_key"
    } else {
        "id"
    }
}

fn normalize_timestamp(timestamp: &TimestampColumn, id: &str, value: &str) -> LedgerResult<String> {
    let parsed = OffsetDateTime::parse(value, &Rfc3339).map_err(|error| {
        LedgerError::Migration(format!(
            "invalid timestamp in {}.{} for record {}: {}",
            timestamp.table, timestamp.column, id, error
        ))
    })?;
    parsed
        .to_offset(UtcOffset::UTC)
        .format(&Rfc3339)
        .map_err(|error| {
            LedgerError::Migration(format!(
                "invalid timestamp in {}.{} for record {}: {}",
                timestamp.table, timestamp.column, id, error
            ))
        })
}

fn table_columns(connection: &Connection, table: &str) -> LedgerResult<Vec<ActualColumn>> {
    let mut statement = connection
        .prepare(
            "SELECT name, type, [notnull], dflt_value, pk
             FROM pragma_table_info(?1)
             ORDER BY cid",
        )
        .map_err(migration_error)?;
    statement
        .query_map([table], |row| {
            Ok(ActualColumn {
                name: row.get(0)?,
                column_type: row.get(1)?,
                not_null: row.get::<_, i64>(2)? == 1,
                default_value: row.get(3)?,
                primary_key: row.get::<_, i64>(4)? == 1,
            })
        })
        .map_err(migration_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(migration_error)
}

fn foreign_keys(
    connection: &Connection,
    table: &str,
) -> LedgerResult<BTreeSet<ForeignKeyDefinition>> {
    let mut statement = connection
        .prepare(
            "SELECT [from], [table], [to], on_update, on_delete
             FROM pragma_foreign_key_list(?1)",
        )
        .map_err(migration_error)?;
    statement
        .query_map([table], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
            ))
        })
        .map_err(migration_error)?
        .collect::<Result<BTreeSet<_>, _>>()
        .map_err(migration_error)
}

fn index_definition(connection: &Connection, name: &str) -> LedgerResult<Option<ActualIndex>> {
    let table = connection
        .query_row(
            "SELECT tbl_name FROM sqlite_master WHERE type = 'index' AND name = ?1",
            [name],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(migration_error)?;
    let Some(table) = table else {
        return Ok(None);
    };

    let (unique, partial) = connection
        .query_row(
            "SELECT [unique], partial
             FROM pragma_index_list(?1)
             WHERE name = ?2",
            params![table, name],
            |row| Ok((row.get::<_, i64>(0)? == 1, row.get::<_, i64>(1)? == 1)),
        )
        .map_err(migration_error)?;
    let mut statement = connection
        .prepare(
            "SELECT name
             FROM pragma_index_info(?1)
             ORDER BY seqno",
        )
        .map_err(migration_error)?;
    let columns = statement
        .query_map([name], |row| row.get(0))
        .map_err(migration_error)?
        .collect::<Result<Vec<String>, _>>()
        .map_err(migration_error)?;

    Ok(Some(ActualIndex {
        table,
        unique,
        partial,
        columns,
    }))
}

fn validate_index(expected: &IndexSpec, actual: &ActualIndex) -> LedgerResult<()> {
    if actual.table != expected.table
        || actual.unique != expected.unique
        || actual.partial
        || actual.columns.len() != expected.columns.len()
        || actual
            .columns
            .iter()
            .zip(expected.columns)
            .any(|(actual, expected)| actual != expected)
    {
        return Err(LedgerError::Migration(format!(
            "index {} has an incompatible definition",
            expected.name
        )));
    }
    Ok(())
}

fn normalize_sql(sql: &str) -> String {
    sql.chars()
        .filter(|character| !character.is_whitespace() && *character != '"' && *character != ';')
        .flat_map(char::to_lowercase)
        .collect()
}

fn migration_error(error: rusqlite::Error) -> LedgerError {
    if is_busy_error(&error) {
        LedgerError::Busy(error.to_string())
    } else {
        LedgerError::Migration(error.to_string())
    }
}

struct TableSpec {
    name: &'static str,
    columns: &'static [ColumnSpec],
    foreign_keys: &'static [ForeignKeySpec],
    required_sql: &'static [&'static str],
}

struct ColumnSpec {
    name: &'static str,
    column_type: &'static str,
    not_null: bool,
    primary_key: bool,
    addition: Option<&'static str>,
}

struct ForeignKeySpec {
    from: &'static str,
    table: &'static str,
    to: &'static str,
}

struct IndexSpec {
    name: &'static str,
    table: &'static str,
    unique: bool,
    columns: &'static [&'static str],
    create_sql: &'static str,
}

struct ActualColumn {
    name: String,
    column_type: String,
    not_null: bool,
    default_value: Option<String>,
    primary_key: bool,
}

struct ActualIndex {
    table: String,
    unique: bool,
    partial: bool,
    columns: Vec<String>,
}

type ForeignKeyDefinition = (String, String, String, String, String);

struct TimestampColumn {
    table: &'static str,
    column: &'static str,
    nullable: bool,
}

struct PersistedTableSpec {
    name: &'static str,
    required_nonblank_text: &'static [&'static str],
    optional_nonblank_text: &'static [&'static str],
    required_text: &'static [&'static str],
    optional_text: &'static [&'static str],
    booleans: &'static [&'static str],
    timestamps: &'static [TimestampColumn],
    extra_invalid: &'static [&'static str],
}

const fn column(
    name: &'static str,
    column_type: &'static str,
    not_null: bool,
    primary_key: bool,
    addition: Option<&'static str>,
) -> ColumnSpec {
    ColumnSpec {
        name,
        column_type,
        not_null,
        primary_key,
        addition,
    }
}

const CURRENCIES_COLUMNS: &[ColumnSpec] = &[
    column("id", "TEXT", true, true, None),
    column("code", "TEXT", true, false, None),
    column("name", "TEXT", true, false, None),
    column("symbol", "TEXT", true, false, None),
    column("decimal_places", "INTEGER", true, false, None),
    column(
        "active",
        "INTEGER",
        true,
        false,
        Some("active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))"),
    ),
    column(
        "created_at",
        "TEXT",
        true,
        false,
        Some("created_at TEXT NOT NULL DEFAULT ''"),
    ),
    column(
        "updated_at",
        "TEXT",
        true,
        false,
        Some("updated_at TEXT NOT NULL DEFAULT ''"),
    ),
    column("deleted_at", "TEXT", false, false, Some("deleted_at TEXT")),
];

const ACCOUNT_CATEGORY_COLUMNS: &[ColumnSpec] = &[
    column("id", "TEXT", true, true, None),
    column("name", "TEXT", true, false, None),
    column(
        "parent_id",
        "TEXT",
        false,
        false,
        Some("parent_id TEXT REFERENCES account_categories(id)"),
    ),
    column(
        "liability",
        "INTEGER",
        true,
        false,
        Some("liability INTEGER NOT NULL DEFAULT 0 CHECK (liability IN (0, 1))"),
    ),
    column(
        "active",
        "INTEGER",
        true,
        false,
        Some("active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))"),
    ),
    column(
        "created_at",
        "TEXT",
        true,
        false,
        Some("created_at TEXT NOT NULL DEFAULT ''"),
    ),
    column(
        "updated_at",
        "TEXT",
        true,
        false,
        Some("updated_at TEXT NOT NULL DEFAULT ''"),
    ),
    column("deleted_at", "TEXT", false, false, Some("deleted_at TEXT")),
];

const ACCOUNT_COLUMNS: &[ColumnSpec] = &[
    column("id", "TEXT", true, true, None),
    column("name", "TEXT", true, false, None),
    column("account_category_id", "TEXT", true, false, None),
    column("currency_id", "TEXT", true, false, None),
    column(
        "opening_balance_minor",
        "INTEGER",
        true,
        false,
        Some(
            "opening_balance_minor INTEGER NOT NULL DEFAULT 0 \
             CHECK (typeof(opening_balance_minor) = 'integer')",
        ),
    ),
    column(
        "active",
        "INTEGER",
        true,
        false,
        Some("active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))"),
    ),
    column(
        "created_at",
        "TEXT",
        true,
        false,
        Some("created_at TEXT NOT NULL DEFAULT ''"),
    ),
    column(
        "updated_at",
        "TEXT",
        true,
        false,
        Some("updated_at TEXT NOT NULL DEFAULT ''"),
    ),
    column("deleted_at", "TEXT", false, false, Some("deleted_at TEXT")),
];

const TRANSACTION_CATEGORY_COLUMNS: &[ColumnSpec] = &[
    column("id", "TEXT", true, true, None),
    column("name", "TEXT", true, false, None),
    column(
        "parent_id",
        "TEXT",
        false,
        false,
        Some("parent_id TEXT REFERENCES transaction_categories(id)"),
    ),
    column("kind", "TEXT", true, false, None),
    column(
        "active",
        "INTEGER",
        true,
        false,
        Some("active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))"),
    ),
    column(
        "created_at",
        "TEXT",
        true,
        false,
        Some("created_at TEXT NOT NULL DEFAULT ''"),
    ),
    column(
        "updated_at",
        "TEXT",
        true,
        false,
        Some("updated_at TEXT NOT NULL DEFAULT ''"),
    ),
    column("deleted_at", "TEXT", false, false, Some("deleted_at TEXT")),
];

const LEDGER_ENTRY_COLUMNS: &[ColumnSpec] = &[
    column("id", "TEXT", true, true, None),
    column("date", "TEXT", true, false, None),
    column("written_at", "TEXT", true, false, None),
    column("content", "TEXT", true, false, None),
    column(
        "transaction_category_id",
        "TEXT",
        false,
        false,
        Some("transaction_category_id TEXT REFERENCES transaction_categories(id)"),
    ),
    column("account_id", "TEXT", true, false, None),
    column("entry_type", "TEXT", true, false, None),
    column("amount_minor", "INTEGER", true, false, None),
    column("currency_id", "TEXT", true, false, None),
    column(
        "transfer_group_id",
        "TEXT",
        false,
        false,
        Some("transfer_group_id TEXT"),
    ),
    column("source", "TEXT", true, false, None),
    column("notes", "TEXT", false, false, Some("notes TEXT")),
    column(
        "created_at",
        "TEXT",
        true,
        false,
        Some("created_at TEXT NOT NULL DEFAULT ''"),
    ),
    column(
        "updated_at",
        "TEXT",
        true,
        false,
        Some("updated_at TEXT NOT NULL DEFAULT ''"),
    ),
    column("deleted_at", "TEXT", false, false, Some("deleted_at TEXT")),
];

const AUDIT_COLUMNS: &[ColumnSpec] = &[
    column("id", "TEXT", true, true, None),
    column("occurred_at", "TEXT", true, false, None),
    column("actor", "TEXT", true, false, None),
    column("action", "TEXT", true, false, None),
    column("record_type", "TEXT", true, false, None),
    column("record_id", "TEXT", true, false, None),
    column(
        "before_json",
        "TEXT",
        false,
        false,
        Some("before_json TEXT"),
    ),
    column("after_json", "TEXT", false, false, Some("after_json TEXT")),
    column("reason", "TEXT", false, false, Some("reason TEXT")),
];

const TRANSFER_OPERATION_COLUMNS: &[ColumnSpec] = &[
    column("operation_key", "TEXT", true, true, None),
    column("payload_json", "TEXT", true, false, None),
    column("result_json", "TEXT", true, false, None),
    column("created_at", "TEXT", true, false, None),
];

const NO_FOREIGN_KEYS: &[ForeignKeySpec] = &[];
const ACCOUNT_CATEGORY_FOREIGN_KEYS: &[ForeignKeySpec] = &[ForeignKeySpec {
    from: "parent_id",
    table: "account_categories",
    to: "id",
}];
const ACCOUNT_FOREIGN_KEYS: &[ForeignKeySpec] = &[
    ForeignKeySpec {
        from: "account_category_id",
        table: "account_categories",
        to: "id",
    },
    ForeignKeySpec {
        from: "currency_id",
        table: "currencies",
        to: "id",
    },
];
const TRANSACTION_CATEGORY_FOREIGN_KEYS: &[ForeignKeySpec] = &[ForeignKeySpec {
    from: "parent_id",
    table: "transaction_categories",
    to: "id",
}];
const LEDGER_ENTRY_FOREIGN_KEYS: &[ForeignKeySpec] = &[
    ForeignKeySpec {
        from: "transaction_category_id",
        table: "transaction_categories",
        to: "id",
    },
    ForeignKeySpec {
        from: "account_id",
        table: "accounts",
        to: "id",
    },
    ForeignKeySpec {
        from: "currency_id",
        table: "currencies",
        to: "id",
    },
];

const TABLES: &[TableSpec] = &[
    TableSpec {
        name: "currencies",
        columns: CURRENCIES_COLUMNS,
        foreign_keys: NO_FOREIGN_KEYS,
        required_sql: &[
            "check(decimal_places>=0anddecimal_places<=18)",
            "check(activein(0,1))",
        ],
    },
    TableSpec {
        name: "account_categories",
        columns: ACCOUNT_CATEGORY_COLUMNS,
        foreign_keys: ACCOUNT_CATEGORY_FOREIGN_KEYS,
        required_sql: &["check(liabilityin(0,1))", "check(activein(0,1))"],
    },
    TableSpec {
        name: "accounts",
        columns: ACCOUNT_COLUMNS,
        foreign_keys: ACCOUNT_FOREIGN_KEYS,
        required_sql: &[
            "check(typeof(opening_balance_minor)='integer')",
            "check(activein(0,1))",
        ],
    },
    TableSpec {
        name: "transaction_categories",
        columns: TRANSACTION_CATEGORY_COLUMNS,
        foreign_keys: TRANSACTION_CATEGORY_FOREIGN_KEYS,
        required_sql: &["check(kindin('expense','income'))", "check(activein(0,1))"],
    },
    TableSpec {
        name: "ledger_entries",
        columns: LEDGER_ENTRY_COLUMNS,
        foreign_keys: LEDGER_ENTRY_FOREIGN_KEYS,
        required_sql: &[
            "check(entry_typein('expense','income','transfer_out','transfer_in','adjustment_out','adjustment_in'))",
            "check(typeof(amount_minor)='integer'andamount_minor>0)",
        ],
    },
    TableSpec {
        name: "audit_events",
        columns: AUDIT_COLUMNS,
        foreign_keys: NO_FOREIGN_KEYS,
        required_sql: &[],
    },
    TableSpec {
        name: "transfer_operations",
        columns: TRANSFER_OPERATION_COLUMNS,
        foreign_keys: NO_FOREIGN_KEYS,
        required_sql: &[],
    },
];

const TIMESTAMP_PAIRS: &[(&str, &str, &str)] = &[
    ("currencies", "created_at", "updated_at"),
    ("account_categories", "created_at", "updated_at"),
    ("accounts", "created_at", "updated_at"),
    ("transaction_categories", "created_at", "updated_at"),
    ("ledger_entries", "created_at", "updated_at"),
];

const CURRENCY_TIMESTAMPS: &[TimestampColumn] = &[
    TimestampColumn {
        table: "currencies",
        column: "created_at",
        nullable: false,
    },
    TimestampColumn {
        table: "currencies",
        column: "updated_at",
        nullable: false,
    },
    TimestampColumn {
        table: "currencies",
        column: "deleted_at",
        nullable: true,
    },
];

const ACCOUNT_CATEGORY_TIMESTAMPS: &[TimestampColumn] = &[
    TimestampColumn {
        table: "account_categories",
        column: "created_at",
        nullable: false,
    },
    TimestampColumn {
        table: "account_categories",
        column: "updated_at",
        nullable: false,
    },
    TimestampColumn {
        table: "account_categories",
        column: "deleted_at",
        nullable: true,
    },
];

const ACCOUNT_TIMESTAMPS: &[TimestampColumn] = &[
    TimestampColumn {
        table: "accounts",
        column: "created_at",
        nullable: false,
    },
    TimestampColumn {
        table: "accounts",
        column: "updated_at",
        nullable: false,
    },
    TimestampColumn {
        table: "accounts",
        column: "deleted_at",
        nullable: true,
    },
];

const TRANSACTION_CATEGORY_TIMESTAMPS: &[TimestampColumn] = &[
    TimestampColumn {
        table: "transaction_categories",
        column: "created_at",
        nullable: false,
    },
    TimestampColumn {
        table: "transaction_categories",
        column: "updated_at",
        nullable: false,
    },
    TimestampColumn {
        table: "transaction_categories",
        column: "deleted_at",
        nullable: true,
    },
];

const LEDGER_ENTRY_TIMESTAMPS: &[TimestampColumn] = &[
    TimestampColumn {
        table: "ledger_entries",
        column: "written_at",
        nullable: false,
    },
    TimestampColumn {
        table: "ledger_entries",
        column: "created_at",
        nullable: false,
    },
    TimestampColumn {
        table: "ledger_entries",
        column: "updated_at",
        nullable: false,
    },
    TimestampColumn {
        table: "ledger_entries",
        column: "deleted_at",
        nullable: true,
    },
];

const AUDIT_TIMESTAMPS: &[TimestampColumn] = &[TimestampColumn {
    table: "audit_events",
    column: "occurred_at",
    nullable: false,
}];

const TRANSFER_OPERATION_TIMESTAMPS: &[TimestampColumn] = &[TimestampColumn {
    table: "transfer_operations",
    column: "created_at",
    nullable: false,
}];

const PERSISTED_TABLES: &[PersistedTableSpec] = &[
    PersistedTableSpec {
        name: "currencies",
        required_nonblank_text: &["id", "code", "name", "symbol"],
        optional_nonblank_text: &[],
        required_text: &[],
        optional_text: &[],
        booleans: &["active"],
        timestamps: CURRENCY_TIMESTAMPS,
        extra_invalid: &["typeof(decimal_places) <> 'integer'
             OR decimal_places < 0
             OR decimal_places > 18"],
    },
    PersistedTableSpec {
        name: "account_categories",
        required_nonblank_text: &["id", "name"],
        optional_nonblank_text: &["parent_id"],
        required_text: &[],
        optional_text: &[],
        booleans: &["liability", "active"],
        timestamps: ACCOUNT_CATEGORY_TIMESTAMPS,
        extra_invalid: &[],
    },
    PersistedTableSpec {
        name: "accounts",
        required_nonblank_text: &["id", "name", "account_category_id", "currency_id"],
        optional_nonblank_text: &[],
        required_text: &[],
        optional_text: &[],
        booleans: &["active"],
        timestamps: ACCOUNT_TIMESTAMPS,
        extra_invalid: &["typeof(opening_balance_minor) <> 'integer'"],
    },
    PersistedTableSpec {
        name: "transaction_categories",
        required_nonblank_text: &["id", "name"],
        optional_nonblank_text: &["parent_id"],
        required_text: &[],
        optional_text: &[],
        booleans: &["active"],
        timestamps: TRANSACTION_CATEGORY_TIMESTAMPS,
        extra_invalid: &["typeof(kind) <> 'text'
             OR kind NOT IN ('expense', 'income')"],
    },
    PersistedTableSpec {
        name: "ledger_entries",
        required_nonblank_text: &["id", "content", "account_id", "currency_id", "source"],
        optional_nonblank_text: &["transaction_category_id", "transfer_group_id", "notes"],
        required_text: &[],
        optional_text: &[],
        booleans: &[],
        timestamps: LEDGER_ENTRY_TIMESTAMPS,
        extra_invalid: &[
            "typeof(date) <> 'text'
             OR length(date) <> 10
             OR date NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
             OR date(date, '+0 days') IS NULL
             OR date(date, '+0 days') <> date",
            "typeof(entry_type) <> 'text'
             OR entry_type NOT IN (
                 'expense', 'income', 'transfer_out', 'transfer_in',
                 'adjustment_out', 'adjustment_in'
             )",
            "typeof(amount_minor) <> 'integer' OR amount_minor <= 0",
        ],
    },
    PersistedTableSpec {
        name: "audit_events",
        required_nonblank_text: &[],
        optional_nonblank_text: &[],
        required_text: &["id", "actor", "action", "record_type", "record_id"],
        optional_text: &["before_json", "after_json", "reason"],
        booleans: &[],
        timestamps: AUDIT_TIMESTAMPS,
        extra_invalid: &[],
    },
    PersistedTableSpec {
        name: "transfer_operations",
        required_nonblank_text: &["operation_key", "payload_json", "result_json"],
        optional_nonblank_text: &[],
        required_text: &[],
        optional_text: &[],
        booleans: &[],
        timestamps: TRANSFER_OPERATION_TIMESTAMPS,
        extra_invalid: &[
            "json_valid(payload_json) = 0",
            "json_valid(result_json) = 0",
        ],
    },
];

const INDEXES: &[IndexSpec] = &[
    IndexSpec {
        name: "idx_currencies_code",
        table: "currencies",
        unique: true,
        columns: &["code"],
        create_sql: "CREATE UNIQUE INDEX idx_currencies_code ON currencies(code);",
    },
    IndexSpec {
        name: "idx_currencies_active_name",
        table: "currencies",
        unique: false,
        columns: &["active", "name"],
        create_sql: "CREATE INDEX idx_currencies_active_name ON currencies(active, name);",
    },
    IndexSpec {
        name: "idx_account_categories_parent",
        table: "account_categories",
        unique: false,
        columns: &["parent_id"],
        create_sql: "CREATE INDEX idx_account_categories_parent ON account_categories(parent_id);",
    },
    IndexSpec {
        name: "idx_account_categories_active_name",
        table: "account_categories",
        unique: false,
        columns: &["active", "name"],
        create_sql: "CREATE INDEX idx_account_categories_active_name \
                     ON account_categories(active, name);",
    },
    IndexSpec {
        name: "idx_accounts_category",
        table: "accounts",
        unique: false,
        columns: &["account_category_id"],
        create_sql: "CREATE INDEX idx_accounts_category ON accounts(account_category_id);",
    },
    IndexSpec {
        name: "idx_accounts_currency",
        table: "accounts",
        unique: false,
        columns: &["currency_id"],
        create_sql: "CREATE INDEX idx_accounts_currency ON accounts(currency_id);",
    },
    IndexSpec {
        name: "idx_accounts_active_name",
        table: "accounts",
        unique: false,
        columns: &["active", "name"],
        create_sql: "CREATE INDEX idx_accounts_active_name ON accounts(active, name);",
    },
    IndexSpec {
        name: "idx_transaction_categories_parent",
        table: "transaction_categories",
        unique: false,
        columns: &["parent_id"],
        create_sql: "CREATE INDEX idx_transaction_categories_parent \
                     ON transaction_categories(parent_id);",
    },
    IndexSpec {
        name: "idx_transaction_categories_active_name",
        table: "transaction_categories",
        unique: false,
        columns: &["active", "name"],
        create_sql: "CREATE INDEX idx_transaction_categories_active_name \
                     ON transaction_categories(active, name);",
    },
    IndexSpec {
        name: "idx_ledger_entries_date",
        table: "ledger_entries",
        unique: false,
        columns: &["date"],
        create_sql: "CREATE INDEX idx_ledger_entries_date ON ledger_entries(date);",
    },
    IndexSpec {
        name: "idx_ledger_entries_account",
        table: "ledger_entries",
        unique: false,
        columns: &["account_id"],
        create_sql: "CREATE INDEX idx_ledger_entries_account ON ledger_entries(account_id);",
    },
    IndexSpec {
        name: "idx_ledger_entries_category",
        table: "ledger_entries",
        unique: false,
        columns: &["transaction_category_id"],
        create_sql: "CREATE INDEX idx_ledger_entries_category ON ledger_entries(transaction_category_id);",
    },
    IndexSpec {
        name: "idx_ledger_entries_transfer_group",
        table: "ledger_entries",
        unique: false,
        columns: &["transfer_group_id"],
        create_sql: "CREATE INDEX idx_ledger_entries_transfer_group \
                     ON ledger_entries(transfer_group_id);",
    },
    IndexSpec {
        name: "idx_ledger_entries_transfer_group_type",
        table: "ledger_entries",
        unique: true,
        columns: &["transfer_group_id", "entry_type"],
        create_sql: "CREATE UNIQUE INDEX idx_ledger_entries_transfer_group_type \
                     ON ledger_entries(transfer_group_id, entry_type);",
    },
    IndexSpec {
        name: "idx_ledger_entries_deleted_at",
        table: "ledger_entries",
        unique: false,
        columns: &["deleted_at"],
        create_sql: "CREATE INDEX idx_ledger_entries_deleted_at ON ledger_entries(deleted_at);",
    },
    IndexSpec {
        name: "idx_audit_events_record",
        table: "audit_events",
        unique: false,
        columns: &["record_type", "record_id"],
        create_sql: "CREATE INDEX idx_audit_events_record ON audit_events(record_type, record_id);",
    },
    IndexSpec {
        name: "idx_audit_events_occurred_at",
        table: "audit_events",
        unique: false,
        columns: &["occurred_at"],
        create_sql: "CREATE INDEX idx_audit_events_occurred_at ON audit_events(occurred_at);",
    },
];

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Mutex, mpsc};
    use std::time::{Duration, Instant};

    use rusqlite::Connection;

    use super::init_schema;
    use crate::application::error::LedgerError;

    static BUSY_HANDLER_REACHED: AtomicBool = AtomicBool::new(false);
    static INTERLEAVING_TEST_LOCK: Mutex<()> = Mutex::new(());

    fn signal_busy_handler(_attempt: i32) -> bool {
        BUSY_HANDLER_REACHED.store(true, Ordering::Release);
        true
    }

    #[test]
    fn migration_rechecks_future_version_after_waiting_for_writer_lock() {
        let _test_lock = INTERLEAVING_TEST_LOCK.lock().unwrap();
        BUSY_HANDLER_REACHED.store(false, Ordering::Release);
        let directory = tempfile::tempdir().unwrap();
        let database = directory.path().join("ledger.sqlite");
        let initial = Connection::open(&database).unwrap();
        init_schema(&initial).unwrap();
        drop(initial);

        let writer = Connection::open(&database).unwrap();
        writer.pragma_update(None, "user_version", 0_i64).unwrap();
        writer
            .execute_batch(
                "BEGIN IMMEDIATE;
                 CREATE TABLE future_marker (value TEXT NOT NULL);
                 INSERT INTO future_marker (value) VALUES ('future-data');
                 PRAGMA user_version = 3;",
            )
            .unwrap();

        let reader_database = database.clone();
        let migration = std::thread::spawn(move || {
            let reader = Connection::open(reader_database).unwrap();
            reader.busy_handler(Some(signal_busy_handler)).unwrap();
            init_schema(&reader)
        });

        let deadline = Instant::now() + Duration::from_secs(2);
        while !BUSY_HANDLER_REACHED.load(Ordering::Acquire) {
            assert!(
                Instant::now() < deadline,
                "migration never waited for the writer lock"
            );
            std::thread::yield_now();
        }
        writer.execute_batch("COMMIT;").unwrap();

        let error = migration.join().unwrap().unwrap_err();
        assert!(
            matches!(error, LedgerError::Migration(message) if message.contains("newer than supported"))
        );
        let verification = Connection::open(&database).unwrap();
        assert_eq!(
            verification
                .pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
                .unwrap(),
            3
        );
        assert_eq!(
            verification
                .query_row("SELECT value FROM future_marker", [], |row| {
                    row.get::<_, String>(0)
                })
                .unwrap(),
            "future-data"
        );
    }

    #[test]
    fn version_two_open_never_downgrades_a_concurrent_future_commit() {
        let _test_lock = INTERLEAVING_TEST_LOCK.lock().unwrap();
        BUSY_HANDLER_REACHED.store(false, Ordering::Release);
        let directory = tempfile::tempdir().unwrap();
        let database = directory.path().join("ledger.sqlite");
        let initial = Connection::open(&database).unwrap();
        init_schema(&initial).unwrap();
        drop(initial);

        let writer = Connection::open(&database).unwrap();
        writer
            .execute_batch(
                "BEGIN IMMEDIATE;
                 CREATE TABLE future_marker (value TEXT NOT NULL);
                 INSERT INTO future_marker (value) VALUES ('future-data');
                 PRAGMA user_version = 3;",
            )
            .unwrap();

        let reader_database = database.clone();
        let (result_sender, result_receiver) = mpsc::channel();
        let reader = std::thread::spawn(move || {
            let connection = Connection::open(reader_database).unwrap();
            connection.busy_handler(Some(signal_busy_handler)).unwrap();
            result_sender.send(init_schema(&connection)).unwrap();
        });

        let deadline = Instant::now() + Duration::from_secs(2);
        let open_result = loop {
            if let Ok(result) = result_receiver.try_recv() {
                writer.execute_batch("COMMIT;").unwrap();
                break result;
            }
            if BUSY_HANDLER_REACHED.load(Ordering::Acquire) {
                writer.execute_batch("COMMIT;").unwrap();
                break result_receiver
                    .recv_timeout(Duration::from_secs(2))
                    .unwrap();
            }
            assert!(
                Instant::now() < deadline,
                "open neither completed read-only health nor waited for the writer"
            );
            std::thread::yield_now();
        };
        reader.join().unwrap();

        open_result.unwrap();
        let verification = Connection::open(&database).unwrap();
        assert_eq!(
            verification
                .pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
                .unwrap(),
            3
        );
        assert_eq!(
            verification
                .query_row("SELECT value FROM future_marker", [], |row| {
                    row.get::<_, String>(0)
                })
                .unwrap(),
            "future-data"
        );
    }
}
