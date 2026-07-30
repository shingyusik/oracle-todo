use std::collections::BTreeSet;

use rusqlite::{Connection, OptionalExtension, params};
use time::format_description::well_known::Rfc3339;
use time::{OffsetDateTime, UtcOffset};

use super::is_busy_error;
use crate::application::error::{LedgerError, LedgerResult};

pub(super) const SCHEMA_VERSION: i64 = 1;

pub(super) fn init_schema(connection: &Connection) -> LedgerResult<()> {
    connection
        .execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(migration_error)?;

    let version = user_version(connection)?;
    if version > SCHEMA_VERSION {
        return Err(LedgerError::Migration(format!(
            "ledger schema version {version} is newer than supported version {SCHEMA_VERSION}"
        )));
    }

    connection
        .execute_batch("BEGIN IMMEDIATE;")
        .map_err(migration_error)?;
    let result = (|| {
        create_missing_tables(connection)?;
        reconcile_tables(connection)?;
        ensure_indexes(connection)?;
        validate_schema_objects(connection)?;
        normalize_persisted_timestamps(connection)?;
        validate_persisted_integrity(connection)?;
        connection
            .pragma_update(None, "user_version", SCHEMA_VERSION)
            .map_err(migration_error)?;
        Ok(())
    })();

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
    for (table, column) in [
        ("accounts", "opening_balance_minor"),
        ("ledger_entries", "amount_minor"),
    ] {
        let corrupt: bool = connection
            .query_row(
                &format!(
                    "SELECT EXISTS(
                        SELECT 1 FROM {table} WHERE typeof({column}) <> 'integer'
                    )"
                ),
                [],
                |row| row.get(0),
            )
            .map_err(migration_error)?;
        if corrupt {
            return Err(LedgerError::Migration(format!(
                "table {table} contains non-integer persisted money"
            )));
        }
    }

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
    validate_persisted_timestamps(connection)?;
    Ok(())
}

fn normalize_persisted_timestamps(connection: &Connection) -> LedgerResult<()> {
    for timestamp in TIMESTAMP_COLUMNS {
        let rows = timestamp_values(connection, timestamp)?;
        for (id, value) in rows {
            let normalized = normalize_timestamp(timestamp, &id, &value)?;
            if normalized != value {
                connection
                    .execute(
                        &format!(
                            "UPDATE {} SET {} = ?1 WHERE id = ?2",
                            timestamp.table, timestamp.column
                        ),
                        params![normalized, id],
                    )
                    .map_err(migration_error)?;
            }
        }
    }
    Ok(())
}

fn validate_persisted_timestamps(connection: &Connection) -> LedgerResult<()> {
    for timestamp in TIMESTAMP_COLUMNS {
        for (id, value) in timestamp_values(connection, timestamp)? {
            if normalize_timestamp(timestamp, &id, &value)? != value {
                return Err(LedgerError::Migration(format!(
                    "table {} contains non-UTC timestamp in {} for record {}",
                    timestamp.table, timestamp.column, id
                )));
            }
        }
    }
    Ok(())
}

fn timestamp_values(
    connection: &Connection,
    timestamp: &TimestampColumn,
) -> LedgerResult<Vec<(String, String)>> {
    let mut statement = connection
        .prepare(&format!(
            "SELECT id, {} FROM {} WHERE {} IS NOT NULL",
            timestamp.column, timestamp.table, timestamp.column
        ))
        .map_err(migration_error)?;
    statement
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(migration_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(migration_error)
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
            "SELECT name, type, [notnull], pk
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
                primary_key: row.get::<_, i64>(3)? == 1,
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
        .filter(|character| !character.is_whitespace() && *character != '"')
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
        Some("created_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00Z'"),
    ),
    column(
        "updated_at",
        "TEXT",
        true,
        false,
        Some("updated_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00Z'"),
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
        Some("created_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00Z'"),
    ),
    column(
        "updated_at",
        "TEXT",
        true,
        false,
        Some("updated_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00Z'"),
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
        Some("created_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00Z'"),
    ),
    column(
        "updated_at",
        "TEXT",
        true,
        false,
        Some("updated_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00Z'"),
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
        Some("created_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00Z'"),
    ),
    column(
        "updated_at",
        "TEXT",
        true,
        false,
        Some("updated_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00Z'"),
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
        Some("created_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00Z'"),
    ),
    column(
        "updated_at",
        "TEXT",
        true,
        false,
        Some("updated_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00Z'"),
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
];

const TIMESTAMP_COLUMNS: &[TimestampColumn] = &[
    TimestampColumn {
        table: "currencies",
        column: "created_at",
    },
    TimestampColumn {
        table: "currencies",
        column: "updated_at",
    },
    TimestampColumn {
        table: "currencies",
        column: "deleted_at",
    },
    TimestampColumn {
        table: "account_categories",
        column: "created_at",
    },
    TimestampColumn {
        table: "account_categories",
        column: "updated_at",
    },
    TimestampColumn {
        table: "account_categories",
        column: "deleted_at",
    },
    TimestampColumn {
        table: "accounts",
        column: "created_at",
    },
    TimestampColumn {
        table: "accounts",
        column: "updated_at",
    },
    TimestampColumn {
        table: "accounts",
        column: "deleted_at",
    },
    TimestampColumn {
        table: "transaction_categories",
        column: "created_at",
    },
    TimestampColumn {
        table: "transaction_categories",
        column: "updated_at",
    },
    TimestampColumn {
        table: "transaction_categories",
        column: "deleted_at",
    },
    TimestampColumn {
        table: "ledger_entries",
        column: "written_at",
    },
    TimestampColumn {
        table: "ledger_entries",
        column: "created_at",
    },
    TimestampColumn {
        table: "ledger_entries",
        column: "updated_at",
    },
    TimestampColumn {
        table: "ledger_entries",
        column: "deleted_at",
    },
    TimestampColumn {
        table: "audit_events",
        column: "occurred_at",
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
