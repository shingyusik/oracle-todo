use ledger_engine::application::error::LedgerError;
use ledger_engine::application::ports::LedgerRepository;
use ledger_engine::domain::{Account, Currency, Money};
use ledger_engine::infrastructure::sqlite::SqliteLedgerRepository;
use rusqlite::Connection;
use std::path::Path;
use time::macros::datetime;

#[test]
fn schema_uses_integer_money_and_required_indexes() {
    let repository = SqliteLedgerRepository::open_in_memory().unwrap();

    assert_eq!(
        repository
            .column_type_for_test("ledger_entries", "amount_minor")
            .unwrap(),
        "INTEGER"
    );
    assert_eq!(
        repository
            .column_type_for_test("accounts", "opening_balance_minor")
            .unwrap(),
        "INTEGER"
    );

    for index in [
        "idx_ledger_entries_date",
        "idx_ledger_entries_account",
        "idx_ledger_entries_category",
        "idx_ledger_entries_transfer_group",
        "idx_currencies_code",
        "idx_currencies_active_name",
        "idx_account_categories_active_name",
        "idx_accounts_active_name",
        "idx_transaction_categories_active_name",
    ] {
        assert!(
            repository.index_exists_for_test(index).unwrap(),
            "missing index {index}"
        );
    }
}

#[test]
fn schema_initialization_is_idempotent_and_additive() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("ledger.sqlite");
    let connection = Connection::open(&database).unwrap();
    connection
        .execute_batch(
            "CREATE TABLE preserved_legacy_data (
                id TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            INSERT INTO preserved_legacy_data (id, value) VALUES ('legacy-1', 'keep-me');",
        )
        .unwrap();
    drop(connection);

    let repository = SqliteLedgerRepository::open(&database).unwrap();
    repository.init_schema().unwrap();
    repository.init_schema().unwrap();
    assert_eq!(repository.schema_version().unwrap(), 1);
    repository.check_schema().unwrap();
    drop(repository);

    let connection = Connection::open(&database).unwrap();
    assert_eq!(
        connection
            .query_row(
                "SELECT value FROM preserved_legacy_data WHERE id = 'legacy-1'",
                [],
                |row| row.get::<_, String>(0),
            )
            .unwrap(),
        "keep-me"
    );
}

#[test]
fn version_one_open_stays_read_only_under_a_concurrent_writer() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("ledger.sqlite");
    drop(SqliteLedgerRepository::open(&database).unwrap());
    execute(
        &database,
        "WITH RECURSIVE sequence(value) AS (
             SELECT 1
             UNION ALL
             SELECT value + 1 FROM sequence WHERE value < 2000
         )
         INSERT INTO audit_events (
             id, occurred_at, actor, action, record_type, record_id
         )
         SELECT
             printf('audit-scale-%04d', value),
             '2026-07-30T00:00:00Z',
             'scale-test',
             'inspect',
             'scale',
             printf('record-%04d', value)
         FROM sequence;",
    );
    let writer = Connection::open(&database).unwrap();
    writer.execute_batch("BEGIN IMMEDIATE;").unwrap();

    let reopened = SqliteLedgerRepository::open(&database);

    writer.execute_batch("ROLLBACK;").unwrap();
    assert!(
        reopened.is_ok(),
        "version 1 health unexpectedly requested a writer lock: {:?}",
        reopened.err()
    );
}

#[test]
fn version_zero_timestamp_migration_processes_multiple_bounded_batches() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("ledger.sqlite");
    drop(SqliteLedgerRepository::open(&database).unwrap());
    execute(
        &database,
        "WITH RECURSIVE sequence(value) AS (
             SELECT 1
             UNION ALL
             SELECT value + 1 FROM sequence WHERE value < 600
         )
         INSERT INTO audit_events (
             id, occurred_at, actor, action, record_type, record_id
         )
         SELECT
             printf('audit-migration-%04d', value),
             '2026-07-30T09:00:00+09:00',
             'migration-test',
             'normalize',
             'migration',
             printf('record-%04d', value)
         FROM sequence;
         PRAGMA user_version = 0;",
    );

    drop(SqliteLedgerRepository::open(&database).unwrap());

    let connection = Connection::open(&database).unwrap();
    assert_eq!(
        connection
            .query_row(
                "SELECT COUNT(*) FROM audit_events
                 WHERE occurred_at = '2026-07-30T00:00:00Z'",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap(),
        600
    );
}

#[test]
fn migration_backfills_compatible_partial_table_without_losing_rows() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("ledger.sqlite");
    execute(
        &database,
        "CREATE TABLE currencies (
            id TEXT NOT NULL PRIMARY KEY,
            code TEXT NOT NULL,
            name TEXT NOT NULL,
            symbol TEXT NOT NULL,
            decimal_places INTEGER NOT NULL
                CHECK (decimal_places >= 0 AND decimal_places <= 18),
            active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
            created_at TEXT NOT NULL
        ) STRICT;
        INSERT INTO currencies (
            id, code, name, symbol, decimal_places, active, created_at
        ) VALUES (
            'currency-legacy', 'KRW', 'Korean won', 'KRW', 0, 1,
            '2026-07-30T00:00:00Z'
        );",
    );

    let repository = SqliteLedgerRepository::open(&database).unwrap();

    assert_eq!(repository.schema_version().unwrap(), 1);
    assert_eq!(
        repository
            .get_currency("currency-legacy", false)
            .unwrap()
            .unwrap()
            .code(),
        "KRW"
    );
    assert_eq!(
        column_names(&database, "currencies"),
        vec![
            "id",
            "code",
            "name",
            "symbol",
            "decimal_places",
            "active",
            "created_at",
            "updated_at",
            "deleted_at",
        ]
    );
}

#[test]
fn migration_backfills_missing_updated_at_from_existing_created_at() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("ledger.sqlite");
    create_partial_currency_with_created_at(&database);

    drop(SqliteLedgerRepository::open(&database).unwrap());

    let connection = Connection::open(&database).unwrap();
    let timestamps = connection
        .query_row(
            "SELECT created_at, updated_at
             FROM currencies
             WHERE id = 'currency-created-only'",
            [],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .unwrap();
    assert_eq!(
        timestamps,
        (
            "2026-07-30T03:04:05Z".to_string(),
            "2026-07-30T03:04:05Z".to_string(),
        )
    );
}

#[test]
fn migrated_timestamp_columns_reject_future_omitted_values() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("ledger.sqlite");
    create_partial_currency_with_created_at(&database);
    drop(SqliteLedgerRepository::open(&database).unwrap());

    let result = Connection::open(&database).unwrap().execute(
        "INSERT INTO currencies (
            id, code, name, symbol, decimal_places, active, created_at
         ) VALUES (
            'currency-omitted-updated', 'OMT', 'Omitted updated', 'O', 0, 1,
            '2026-07-30T04:05:06Z'
         )",
        [],
    );

    assert!(
        result.is_err(),
        "migrated schema accepted omitted updated_at"
    );
}

#[test]
fn migration_preserves_compatible_extra_legacy_columns() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("ledger.sqlite");
    execute(
        &database,
        "CREATE TABLE currencies (
            id TEXT NOT NULL PRIMARY KEY,
            code TEXT NOT NULL,
            name TEXT NOT NULL,
            symbol TEXT NOT NULL,
            decimal_places INTEGER NOT NULL
                CHECK (decimal_places >= 0 AND decimal_places <= 18),
            active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            deleted_at TEXT,
            legacy_source TEXT
        ) STRICT;
        INSERT INTO currencies (
            id, code, name, symbol, decimal_places, active, created_at, updated_at,
            legacy_source
        ) VALUES (
            'currency-legacy-extra', 'KRW', 'Korean won', 'KRW', 0, 1,
            '2026-07-30T00:00:00Z', '2026-07-30T00:00:00Z', 'import-v0'
        );",
    );

    let repository = SqliteLedgerRepository::open(&database).unwrap();

    assert_eq!(
        repository
            .get_currency("currency-legacy-extra", false)
            .unwrap()
            .unwrap()
            .code(),
        "KRW"
    );
    assert!(column_names(&database, "currencies").contains(&"legacy_source".to_string()));
    assert_eq!(
        Connection::open(&database)
            .unwrap()
            .query_row(
                "SELECT legacy_source FROM currencies WHERE id = 'currency-legacy-extra'",
                [],
                |row| row.get::<_, String>(0),
            )
            .unwrap(),
        "import-v0"
    );
}

#[test]
fn migration_adds_missing_nullable_entry_lifecycle_column() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("ledger.sqlite");
    execute(
        &database,
        "CREATE TABLE ledger_entries (
            id TEXT NOT NULL PRIMARY KEY,
            date TEXT NOT NULL,
            written_at TEXT NOT NULL,
            content TEXT NOT NULL,
            transaction_category_id TEXT REFERENCES transaction_categories(id),
            account_id TEXT NOT NULL REFERENCES accounts(id),
            entry_type TEXT NOT NULL CHECK (
                entry_type IN (
                    'expense', 'income', 'transfer_out', 'transfer_in',
                    'adjustment_out', 'adjustment_in'
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
            updated_at TEXT NOT NULL
        ) STRICT;",
    );

    let repository = SqliteLedgerRepository::open(&database).unwrap();

    assert_eq!(repository.schema_version().unwrap(), 1);
    assert!(column_names(&database, "ledger_entries").contains(&"deleted_at".to_string()));
}

#[test]
fn migration_rejects_wrong_same_name_index_and_rolls_back_every_change() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("ledger.sqlite");
    execute(
        &database,
        "CREATE TABLE currencies (
            id TEXT NOT NULL PRIMARY KEY,
            code TEXT NOT NULL,
            name TEXT NOT NULL,
            symbol TEXT NOT NULL,
            decimal_places INTEGER NOT NULL
                CHECK (decimal_places >= 0 AND decimal_places <= 18),
            active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
            created_at TEXT NOT NULL
        ) STRICT;
        CREATE INDEX idx_currencies_code ON currencies(name);",
    );

    let error = open_error(&database);

    assert!(matches!(error, LedgerError::Migration(_)));
    assert_eq!(user_version(&database), 0);
    assert!(!table_exists(&database, "accounts"));
    assert!(!column_names(&database, "currencies").contains(&"updated_at".to_string()));
}

#[test]
fn migration_rejects_future_schema_versions_without_touching_the_database() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("ledger.sqlite");
    execute(
        &database,
        "CREATE TABLE future_marker (value TEXT NOT NULL);
         INSERT INTO future_marker (value) VALUES ('keep');
         PRAGMA user_version = 2;",
    );

    let error = open_error(&database);

    assert!(matches!(error, LedgerError::Migration(_)));
    assert_eq!(user_version(&database), 2);
    assert!(!table_exists(&database, "currencies"));
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
fn migration_rejects_incompatible_column_types() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("ledger.sqlite");
    execute(
        &database,
        "CREATE TABLE currencies (
            id TEXT NOT NULL PRIMARY KEY,
            code INTEGER NOT NULL,
            name TEXT NOT NULL,
            symbol TEXT NOT NULL,
            decimal_places INTEGER NOT NULL
                CHECK (decimal_places >= 0 AND decimal_places <= 18),
            active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            deleted_at TEXT
        ) STRICT;",
    );
    assert!(matches!(
        SqliteLedgerRepository::open(&database),
        Err(LedgerError::Migration(_))
    ));
}

#[test]
fn migration_rejects_incompatible_foreign_keys() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("ledger.sqlite");
    execute(
        &database,
        "CREATE TABLE accounts (
            id TEXT NOT NULL PRIMARY KEY,
            name TEXT NOT NULL,
            account_category_id TEXT NOT NULL REFERENCES currencies(id),
            currency_id TEXT NOT NULL REFERENCES currencies(id),
            opening_balance_minor INTEGER NOT NULL DEFAULT 0
                CHECK (typeof(opening_balance_minor) = 'integer'),
            active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            deleted_at TEXT
        ) STRICT;",
    );
    assert!(matches!(
        SqliteLedgerRepository::open(&database),
        Err(LedgerError::Migration(_))
    ));
}

#[test]
fn migration_rejects_legacy_money_columns_without_storage_class_constraints() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("ledger.sqlite");
    execute(
        &database,
        "CREATE TABLE accounts (
            id TEXT NOT NULL PRIMARY KEY,
            name TEXT NOT NULL,
            account_category_id TEXT NOT NULL REFERENCES account_categories(id),
            currency_id TEXT NOT NULL REFERENCES currencies(id),
            opening_balance_minor INTEGER NOT NULL DEFAULT 0,
            active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            deleted_at TEXT
        );",
    );

    assert!(matches!(
        SqliteLedgerRepository::open(&database),
        Err(LedgerError::Migration(_))
    ));
    assert_eq!(user_version(&database), 0);
}

#[test]
fn migration_fails_closed_when_legacy_money_uses_non_integer_storage() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("ledger.sqlite");
    execute(
        &database,
        "CREATE TABLE currencies (
            id TEXT NOT NULL PRIMARY KEY,
            code TEXT NOT NULL,
            name TEXT NOT NULL,
            symbol TEXT NOT NULL,
            decimal_places INTEGER NOT NULL
                CHECK (decimal_places >= 0 AND decimal_places <= 18),
            active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            deleted_at TEXT
        ) STRICT;
        CREATE TABLE account_categories (
            id TEXT NOT NULL PRIMARY KEY,
            name TEXT NOT NULL,
            parent_id TEXT REFERENCES account_categories(id),
            liability INTEGER NOT NULL DEFAULT 0 CHECK (liability IN (0, 1)),
            active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            deleted_at TEXT
        ) STRICT;
        CREATE TABLE accounts (
            id TEXT NOT NULL PRIMARY KEY,
            name TEXT NOT NULL,
            account_category_id TEXT NOT NULL REFERENCES account_categories(id),
            currency_id TEXT NOT NULL REFERENCES currencies(id),
            opening_balance_minor INTEGER NOT NULL DEFAULT 0
                CHECK (typeof(opening_balance_minor) = 'integer'),
            active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            deleted_at TEXT
        );
        INSERT INTO currencies (
            id, code, name, symbol, decimal_places, active, created_at, updated_at
        ) VALUES (
            'currency-krw', 'KRW', 'Korean won', 'KRW', 0, 1,
            '2026-07-30T00:00:00Z', '2026-07-30T00:00:00Z'
        );
        INSERT INTO account_categories (
            id, name, liability, active, created_at, updated_at
        ) VALUES (
            'account-category-cash', 'Cash', 0, 1,
            '2026-07-30T00:00:00Z', '2026-07-30T00:00:00Z'
        );
        PRAGMA ignore_check_constraints = ON;
        INSERT INTO accounts (
            id, name, account_category_id, currency_id, opening_balance_minor,
            active, created_at, updated_at
        ) VALUES (
            'account-corrupt', 'Corrupt', 'account-category-cash', 'currency-krw',
            1.25, 1, '2026-07-30T00:00:00Z', '2026-07-30T00:00:00Z'
        );
        PRAGMA ignore_check_constraints = OFF;",
    );

    let error = open_error(&database);

    assert!(
        matches!(error, LedgerError::Migration(message) if message.contains("persisted scalar"))
    );
    assert_eq!(user_version(&database), 0);
}

#[test]
fn migration_rejects_real_currency_precision_before_repository_reads() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("ledger.sqlite");
    execute(
        &database,
        "CREATE TABLE currencies (
            id TEXT NOT NULL PRIMARY KEY,
            code TEXT NOT NULL,
            name TEXT NOT NULL,
            symbol TEXT NOT NULL,
            decimal_places INTEGER NOT NULL
                CHECK (decimal_places >= 0 AND decimal_places <= 18),
            active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            deleted_at TEXT
        );
        INSERT INTO currencies (
            id, code, name, symbol, decimal_places, active, created_at, updated_at
        ) VALUES (
            'currency-real-precision', 'BAD', 'Bad precision', 'B', 1.5, 1,
            '2026-07-30T00:00:00Z', '2026-07-30T00:00:00Z'
        );",
    );

    let error = open_error(&database);

    assert!(
        matches!(error, LedgerError::Migration(message) if message.contains("persisted scalar"))
    );
    assert_eq!(user_version(&database), 0);
}

#[test]
fn health_rejects_nonpositive_entry_amount_before_repository_reads() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("ledger.sqlite");
    seed_valid_scalar_rows(&database);
    execute(
        &database,
        "PRAGMA ignore_check_constraints = ON;
         UPDATE ledger_entries SET amount_minor = 0 WHERE id = 'entry-health';
         PRAGMA ignore_check_constraints = OFF;",
    );

    let error = open_error(&database);

    assert!(
        matches!(error, LedgerError::Migration(message) if message.contains("persisted scalar"))
    );
    assert_eq!(user_version(&database), 1);
}

#[test]
fn health_rejects_each_persisted_scalar_that_mapping_cannot_read() {
    for (case, mutation) in [
        (
            "invalid boolean",
            "UPDATE currencies SET active = 2 WHERE id = 'currency-health';",
        ),
        (
            "invalid category enum",
            "UPDATE transaction_categories SET kind = 'refund'
             WHERE id = 'transaction-health';",
        ),
        (
            "invalid calendar date",
            "UPDATE ledger_entries SET date = '2026-02-30' WHERE id = 'entry-health';",
        ),
        (
            "blank required domain string",
            "UPDATE ledger_entries SET content = '   ' WHERE id = 'entry-health';",
        ),
        (
            "timestamp SQLite accepts but RFC3339 rejects",
            "UPDATE ledger_entries SET updated_at = '2026-07-30T24:00:00Z'
             WHERE id = 'entry-health';",
        ),
        (
            "invalid audit JSON",
            "UPDATE audit_events SET after_json = '{invalid'
             WHERE id = 'audit-health';",
        ),
    ] {
        let directory = tempfile::tempdir().unwrap();
        let database = directory.path().join("ledger.sqlite");
        seed_valid_scalar_rows(&database);
        execute(
            &database,
            &format!(
                "PRAGMA ignore_check_constraints = ON;
                 {mutation}
                 PRAGMA ignore_check_constraints = OFF;"
            ),
        );

        assert!(
            matches!(
                SqliteLedgerRepository::open(&database),
                Err(LedgerError::Migration(message)) if message.contains("persisted scalar")
            ),
            "health accepted {case}"
        );
    }
}

#[test]
fn fresh_schema_rejects_real_and_text_money_at_the_sqlite_boundary() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("ledger.sqlite");
    drop(SqliteLedgerRepository::open(&database).unwrap());
    let connection = Connection::open(&database).unwrap();
    connection
        .execute_batch(
            "PRAGMA foreign_keys = ON;
         INSERT INTO currencies (
             id, code, name, symbol, decimal_places, active, created_at, updated_at
         ) VALUES (
             'currency-krw', 'KRW', 'Korean won', 'KRW', 0, 1,
             '2026-07-30T00:00:00Z', '2026-07-30T00:00:00Z'
         );
         INSERT INTO account_categories (
             id, name, liability, active, created_at, updated_at
         ) VALUES (
             'account-category-cash', 'Cash', 0, 1,
             '2026-07-30T00:00:00Z', '2026-07-30T00:00:00Z'
         );
         INSERT INTO accounts (
             id, name, account_category_id, currency_id, opening_balance_minor,
             active, created_at, updated_at
         ) VALUES (
             'account-cash', 'Cash', 'account-category-cash', 'currency-krw',
             0, 1, '2026-07-30T00:00:00Z', '2026-07-30T00:00:00Z'
         );
         INSERT INTO transaction_categories (
             id, name, kind, active, created_at, updated_at
         ) VALUES (
             'transaction-food', 'Food', 'expense', 1,
             '2026-07-30T00:00:00Z', '2026-07-30T00:00:00Z'
         );
         INSERT INTO ledger_entries (
             id, date, written_at, content, transaction_category_id, account_id,
             entry_type, amount_minor, currency_id, source, created_at, updated_at
         ) VALUES (
             'entry-1', '2026-07-30', '2026-07-30T00:00:00Z', 'Lunch',
             'transaction-food', 'account-cash', 'expense', 12000, 'currency-krw',
             'manual', '2026-07-30T00:00:00Z', '2026-07-30T00:00:00Z'
         );",
        )
        .unwrap();

    assert!(
        connection
            .execute(
                "UPDATE accounts SET opening_balance_minor = 1.25 WHERE id = 'account-cash'",
                [],
            )
            .is_err()
    );
    assert!(
        connection
            .execute(
                "UPDATE ledger_entries SET amount_minor = 12.5 WHERE id = 'entry-1'",
                [],
            )
            .is_err()
    );
    assert!(
        connection
            .execute(
                "UPDATE ledger_entries SET amount_minor = 'oops' WHERE id = 'entry-1'",
                [],
            )
            .is_err()
    );
}

#[test]
fn schema_enables_foreign_keys_and_enforces_reference_integrity() {
    let mut repository = SqliteLedgerRepository::open_in_memory().unwrap();
    let account = Account::new(
        "account-orphan",
        "Orphan",
        "missing-category",
        "missing-currency",
        Money::from_minor_units(0),
    )
    .unwrap();

    let mut transaction = repository.begin_transaction().unwrap();
    let error = transaction
        .upsert_account(&account, datetime!(2026-07-30 00:00:00 UTC))
        .unwrap_err();
    assert!(matches!(error, LedgerError::Storage(_)));
}

#[test]
fn schema_has_lifecycle_columns_and_unique_currency_codes() {
    let mut repository = SqliteLedgerRepository::open_in_memory().unwrap();

    for table in [
        "currencies",
        "account_categories",
        "accounts",
        "transaction_categories",
        "ledger_entries",
    ] {
        assert_eq!(
            repository
                .column_type_for_test(table, "deleted_at")
                .unwrap(),
            "TEXT",
            "{table} must support reversible archival"
        );
    }

    let first = Currency::new("currency-1", "KRW", "Korean won", "KRW", 0).unwrap();
    let duplicate = Currency::new("currency-2", "KRW", "Duplicate won", "KRW", 0).unwrap();
    let mut transaction = repository.begin_transaction().unwrap();
    transaction
        .upsert_currency(&first, datetime!(2026-07-30 00:00:00 UTC))
        .unwrap();
    assert!(
        transaction
            .upsert_currency(&duplicate, datetime!(2026-07-30 00:00:00 UTC))
            .is_err()
    );
}

#[test]
fn schema_creates_all_ledger_and_audit_tables() {
    let repository = SqliteLedgerRepository::open_in_memory().unwrap();

    for table in [
        "currencies",
        "account_categories",
        "accounts",
        "transaction_categories",
        "ledger_entries",
        "audit_events",
    ] {
        assert!(
            repository.table_exists_for_test(table).unwrap(),
            "missing table {table}"
        );
    }
}

fn execute(path: &Path, sql: &str) {
    Connection::open(path).unwrap().execute_batch(sql).unwrap();
}

fn open_error(path: &Path) -> LedgerError {
    match SqliteLedgerRepository::open(path) {
        Ok(_) => panic!("opening an incompatible schema must fail"),
        Err(error) => error,
    }
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

fn column_names(path: &Path, table: &str) -> Vec<String> {
    let connection = Connection::open(path).unwrap();
    let mut statement = connection
        .prepare("SELECT name FROM pragma_table_info(?1) ORDER BY cid")
        .unwrap();
    statement
        .query_map([table], |row| row.get(0))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap()
}

fn create_partial_currency_with_created_at(path: &Path) {
    execute(
        path,
        "CREATE TABLE currencies (
            id TEXT NOT NULL PRIMARY KEY,
            code TEXT NOT NULL,
            name TEXT NOT NULL,
            symbol TEXT NOT NULL,
            decimal_places INTEGER NOT NULL
                CHECK (decimal_places >= 0 AND decimal_places <= 18),
            active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
            created_at TEXT NOT NULL
        ) STRICT;
        INSERT INTO currencies (
            id, code, name, symbol, decimal_places, active, created_at
        ) VALUES (
            'currency-created-only', 'CRT', 'Created only', 'C', 0, 1,
            '2026-07-30T03:04:05Z'
        );",
    );
}

fn seed_valid_scalar_rows(path: &Path) {
    drop(SqliteLedgerRepository::open(path).unwrap());
    execute(
        path,
        "PRAGMA foreign_keys = ON;
         INSERT INTO currencies (
             id, code, name, symbol, decimal_places, active, created_at, updated_at
         ) VALUES (
             'currency-health', 'HLT', 'Health currency', 'H', 2, 1,
             '2026-07-30T00:00:00Z', '2026-07-30T00:00:00Z'
         );
         INSERT INTO account_categories (
             id, name, liability, active, created_at, updated_at
         ) VALUES (
             'account-category-health', 'Health accounts', 0, 1,
             '2026-07-30T00:00:00Z', '2026-07-30T00:00:00Z'
         );
         INSERT INTO accounts (
             id, name, account_category_id, currency_id, opening_balance_minor,
             active, created_at, updated_at
         ) VALUES (
             'account-health', 'Health account', 'account-category-health',
             'currency-health', 0, 1,
             '2026-07-30T00:00:00Z', '2026-07-30T00:00:00Z'
         );
         INSERT INTO transaction_categories (
             id, name, kind, active, created_at, updated_at
         ) VALUES (
             'transaction-health', 'Health category', 'expense', 1,
             '2026-07-30T00:00:00Z', '2026-07-30T00:00:00Z'
         );
         INSERT INTO ledger_entries (
             id, date, written_at, content, transaction_category_id, account_id,
             entry_type, amount_minor, currency_id, source, created_at, updated_at
         ) VALUES (
             'entry-health', '2026-07-30', '2026-07-30T00:00:00Z',
             'Health entry', 'transaction-health', 'account-health', 'expense',
             1250, 'currency-health', 'health-test',
             '2026-07-30T00:00:00Z', '2026-07-30T00:00:00Z'
         );
         INSERT INTO audit_events (
             id, occurred_at, actor, action, record_type, record_id, after_json
         ) VALUES (
             'audit-health', '2026-07-30T00:00:01Z', 'tester', 'create',
             'ledger_entry', 'entry-health', '{\"id\":\"entry-health\"}'
         );",
    );
}
