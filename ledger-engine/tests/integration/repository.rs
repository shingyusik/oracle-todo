use ledger_engine::application::error::LedgerError;
use ledger_engine::application::ports::{
    AuditEvent, EntryQuery, LedgerRepository, LedgerTransaction,
};
use ledger_engine::domain::{
    Account, AccountCategory, Currency, EntryType, LedgerEntry, LedgerEntryRehydration, Money,
    TransactionCategory, TransactionCategoryKind,
};
use ledger_engine::infrastructure::sqlite::SqliteLedgerRepository;
use rusqlite::Connection;
use serde_json::json;
use time::macros::datetime;

#[test]
fn repository_port_is_object_safe() {
    fn accepts_trait_object(_repository: &dyn LedgerRepository) {}

    let repository = SqliteLedgerRepository::open_in_memory().unwrap();
    accepts_trait_object(&repository);
}

#[test]
fn committed_entry_round_trips_through_validated_domain_mapping() {
    let mut repository = SqliteLedgerRepository::open_in_memory().unwrap();
    let entry = entry("entry-1", None);

    let mut transaction = repository.begin_transaction().unwrap();
    seed_references(&mut *transaction);
    transaction.insert_entry(&entry).unwrap();
    transaction.commit().unwrap();

    assert_eq!(repository.get_entry("entry-1", false).unwrap(), Some(entry));
}

#[test]
fn master_records_round_trip_through_validated_domain_mapping() {
    let mut repository = SqliteLedgerRepository::open_in_memory().unwrap();
    let currency = Currency::new("currency-krw", "KRW", "Korean won", "KRW", 0).unwrap();
    let account_category =
        AccountCategory::new("account-category-cash", "Cash", None, false).unwrap();
    let account = Account::new(
        "account-cash",
        "Wallet",
        account_category.id(),
        currency.id(),
        Money::from_minor_units(-5_000),
    )
    .unwrap();
    let transaction_category = TransactionCategory::new(
        "transaction-food",
        "Food",
        None,
        TransactionCategoryKind::Expense,
    )
    .unwrap();

    let mut transaction = repository.begin_transaction().unwrap();
    let at = datetime!(2026-07-30 01:00:00 UTC);
    transaction.upsert_currency(&currency, at).unwrap();
    transaction
        .upsert_account_category(&account_category, at)
        .unwrap();
    transaction.upsert_account(&account, at).unwrap();
    transaction
        .upsert_transaction_category(&transaction_category, at)
        .unwrap();
    transaction.commit().unwrap();

    assert_eq!(
        repository.get_currency("currency-krw", false).unwrap(),
        Some(currency)
    );
    assert_eq!(
        repository
            .get_account_category("account-category-cash", false)
            .unwrap(),
        Some(account_category)
    );
    assert_eq!(
        repository.get_account("account-cash", false).unwrap(),
        Some(account)
    );
    assert_eq!(
        repository
            .get_transaction_category("transaction-food", false)
            .unwrap(),
        Some(transaction_category)
    );
}

#[test]
fn transaction_can_read_its_reference_writes_before_commit() {
    let mut repository = SqliteLedgerRepository::open_in_memory().unwrap();
    let mut transaction = repository.begin_transaction().unwrap();
    seed_references(&mut *transaction);

    assert_eq!(
        transaction
            .get_account("account-cash", false)
            .unwrap()
            .unwrap()
            .opening_balance()
            .minor_units(),
        -5_000
    );
    transaction.rollback().unwrap();
}

#[test]
fn repository_updates_only_existing_entries() {
    let mut repository = SqliteLedgerRepository::open_in_memory().unwrap();
    let original = entry("entry-update", None);
    let updated = custom_entry("entry-update", "Dinner");
    let missing = custom_entry("entry-missing", "Missing");

    let mut transaction = repository.begin_transaction().unwrap();
    seed_references(&mut *transaction);
    transaction.insert_entry(&original).unwrap();
    transaction.commit().unwrap();

    let mut transaction = repository.begin_transaction().unwrap();
    transaction.update_entry(&updated).unwrap();
    transaction.commit().unwrap();
    assert_eq!(
        repository.get_entry("entry-update", false).unwrap(),
        Some(updated)
    );

    let mut transaction = repository.begin_transaction().unwrap();
    assert_eq!(
        transaction.update_entry(&missing),
        Err(LedgerError::NotFound("entry-missing".to_string()))
    );
}

#[test]
fn entry_queries_hide_archived_rows_by_default() {
    let mut repository = SqliteLedgerRepository::open_in_memory().unwrap();
    let active = entry("entry-active", None);
    let archived = entry("entry-archived", Some(datetime!(2026-07-31 01:02:03 UTC)));

    let mut transaction = repository.begin_transaction().unwrap();
    seed_references(&mut *transaction);
    transaction.insert_entry(&active).unwrap();
    transaction.insert_entry(&archived).unwrap();
    transaction.commit().unwrap();

    assert_eq!(
        repository.list_entries(&EntryQuery::default()).unwrap(),
        vec![active.clone()]
    );
    assert_eq!(
        repository
            .list_entries(&EntryQuery {
                include_archived: true,
            })
            .unwrap(),
        vec![active, archived]
    );
    assert_eq!(repository.get_entry("entry-archived", false).unwrap(), None);
}

#[test]
fn archived_master_records_are_hidden_by_default() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("ledger.sqlite");
    let mut repository = SqliteLedgerRepository::open(&database).unwrap();
    let transaction = repository.begin_transaction().unwrap();
    seed_references_for_commit(transaction);
    drop(repository);

    let connection = Connection::open(&database).unwrap();
    connection
        .execute(
            "UPDATE currencies
             SET deleted_at = '2026-07-31T00:00:00Z'
             WHERE id = 'currency-krw'",
            [],
        )
        .unwrap();
    drop(connection);

    let repository = SqliteLedgerRepository::open(&database).unwrap();
    assert_eq!(
        repository.get_currency("currency-krw", false).unwrap(),
        None
    );
    assert!(
        repository
            .get_currency("currency-krw", true)
            .unwrap()
            .is_some()
    );
}

#[test]
fn dropped_transaction_rolls_back_entry_and_audit_together() {
    let mut repository = SqliteLedgerRepository::open_in_memory().unwrap();
    let entry = entry("entry-rollback", None);
    let audit = audit("audit-rollback", entry.id());

    {
        let mut transaction = repository.begin_transaction().unwrap();
        seed_references(&mut *transaction);
        transaction.insert_entry(&entry).unwrap();
        transaction.insert_audit_event(&audit).unwrap();

        let duplicate = transaction.insert_entry(&entry).unwrap_err();
        assert!(matches!(duplicate, LedgerError::Conflict(_)));
    }

    assert_eq!(repository.get_entry("entry-rollback", true).unwrap(), None);
    assert!(
        repository
            .list_audit_events("entry-rollback")
            .unwrap()
            .is_empty()
    );

    let transaction = repository.begin_transaction().unwrap();
    transaction.rollback().unwrap();
}

#[test]
fn audit_events_round_trip_without_an_entry_foreign_key() {
    let mut repository = SqliteLedgerRepository::open_in_memory().unwrap();
    let audit = audit("audit-purged", "entry-already-purged");

    let mut transaction = repository.begin_transaction().unwrap();
    transaction.insert_audit_event(&audit).unwrap();
    transaction.commit().unwrap();

    assert_eq!(
        repository
            .list_audit_events("entry-already-purged")
            .unwrap(),
        vec![audit]
    );
}

#[test]
fn invalid_persisted_master_is_rejected_by_domain_rehydration() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("ledger.sqlite");
    drop(SqliteLedgerRepository::open(&database).unwrap());

    let connection = Connection::open(&database).unwrap();
    connection
        .execute(
            "INSERT INTO currencies (
                id, code, name, symbol, decimal_places, active, created_at, updated_at
            ) VALUES (
                'currency-invalid', 'BAD', ' ', 'B', 0, 1,
                '2026-07-30T01:00:00Z', '2026-07-30T01:00:00Z'
            )",
            [],
        )
        .unwrap();
    drop(connection);

    let repository = SqliteLedgerRepository::open(&database).unwrap();
    let error = repository
        .get_currency("currency-invalid", true)
        .unwrap_err();
    assert!(matches!(error, LedgerError::Storage(message) if message.contains("domain invariant")));
}

#[test]
fn invalid_persisted_entry_is_rejected_by_domain_rehydration() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("ledger.sqlite");
    let mut repository = SqliteLedgerRepository::open(&database).unwrap();
    let transaction = repository.begin_transaction().unwrap();
    seed_references_for_commit(transaction);
    drop(repository);

    let connection = Connection::open(&database).unwrap();
    connection
        .execute(
            "INSERT INTO ledger_entries (
                id, date, written_at, content, transaction_category_id, account_id,
                entry_type, amount_minor, currency_id, transfer_group_id, source,
                notes, created_at, updated_at, deleted_at
            ) VALUES (
                'entry-invalid', '2026-07-30', '2026-07-30T01:02:03Z', ' ',
                'transaction-food', 'account-cash', 'expense', 12000, 'currency-krw',
                NULL, 'manual', NULL, '2026-07-30T01:02:04Z',
                '2026-07-30T01:02:05Z', NULL
            )",
            [],
        )
        .unwrap();
    drop(connection);

    let repository = SqliteLedgerRepository::open(&database).unwrap();
    let error = repository.get_entry("entry-invalid", true).unwrap_err();
    assert!(matches!(error, LedgerError::Storage(message) if message.contains("domain invariant")));
}

#[test]
fn open_path_reopens_committed_records() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("ledger.sqlite");
    let expected = entry("entry-file", None);

    {
        let mut repository = SqliteLedgerRepository::open(&database).unwrap();
        let mut transaction = repository.begin_transaction().unwrap();
        seed_references(&mut *transaction);
        transaction.insert_entry(&expected).unwrap();
        transaction.commit().unwrap();
    }

    let repository = SqliteLedgerRepository::open(&database).unwrap();
    assert_eq!(
        repository.get_entry("entry-file", false).unwrap(),
        Some(expected)
    );
}

fn seed_references(transaction: &mut dyn LedgerTransaction) {
    let at = datetime!(2026-07-30 01:00:00 UTC);
    let currency = Currency::new("currency-krw", "KRW", "Korean won", "KRW", 0).unwrap();
    let account_category =
        AccountCategory::new("account-category-cash", "Cash", None, false).unwrap();
    let account = Account::new(
        "account-cash",
        "Wallet",
        account_category.id(),
        currency.id(),
        Money::from_minor_units(-5_000),
    )
    .unwrap();
    let transaction_category = TransactionCategory::new(
        "transaction-food",
        "Food",
        None,
        TransactionCategoryKind::Expense,
    )
    .unwrap();

    transaction.upsert_currency(&currency, at).unwrap();
    transaction
        .upsert_account_category(&account_category, at)
        .unwrap();
    transaction.upsert_account(&account, at).unwrap();
    transaction
        .upsert_transaction_category(&transaction_category, at)
        .unwrap();
}

fn seed_references_for_commit(mut transaction: Box<dyn LedgerTransaction + '_>) {
    seed_references(&mut *transaction);
    transaction.commit().unwrap();
}

fn entry(id: &str, deleted_at: Option<time::OffsetDateTime>) -> LedgerEntry {
    custom_entry_with_deleted_at(id, "Lunch", deleted_at)
}

fn custom_entry(id: &str, content: &str) -> LedgerEntry {
    custom_entry_with_deleted_at(id, content, None)
}

fn custom_entry_with_deleted_at(
    id: &str,
    content: &str,
    deleted_at: Option<time::OffsetDateTime>,
) -> LedgerEntry {
    LedgerEntry::rehydrate(LedgerEntryRehydration {
        id: id.to_string(),
        date: "2026-07-30".to_string(),
        written_at: datetime!(2026-07-30 01:02:03 UTC),
        content: content.to_string(),
        transaction_category_id: Some("transaction-food".to_string()),
        account_id: "account-cash".to_string(),
        entry_type: EntryType::Expense,
        amount: Money::from_minor_units(12_000),
        currency_id: "currency-krw".to_string(),
        transfer_group_id: None,
        source: "manual".to_string(),
        notes: Some("Team meal".to_string()),
        created_at: datetime!(2026-07-30 01:02:04 UTC),
        updated_at: datetime!(2026-07-30 01:02:05 UTC),
        deleted_at,
    })
    .unwrap()
}

fn audit(id: &str, record_id: &str) -> AuditEvent {
    AuditEvent {
        id: id.to_string(),
        occurred_at: datetime!(2026-07-30 01:02:06 UTC),
        actor: "user".to_string(),
        action: "create".to_string(),
        record_type: "ledger_entry".to_string(),
        record_id: record_id.to_string(),
        before: None,
        after: Some(json!({"id": record_id})),
        reason: None,
    }
}
