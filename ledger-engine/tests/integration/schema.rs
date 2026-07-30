use ledger_engine::application::error::LedgerError;
use ledger_engine::application::ports::LedgerRepository;
use ledger_engine::domain::{Account, Currency, Money};
use ledger_engine::infrastructure::sqlite::SqliteLedgerRepository;
use rusqlite::Connection;
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
