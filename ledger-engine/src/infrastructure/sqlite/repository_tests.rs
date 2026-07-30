use super::SqliteLedgerRepository;
use crate::application::error::LedgerError;
use crate::application::ports::{
    AuditEvent, CandidateMatch, EntryQuery, LedgerMutationRepository, LedgerReadRepository,
    LedgerRepository, LedgerTransaction, Page,
};
use crate::domain::{
    Account, AccountCategory, Currency, EntryType, LedgerEntry, LedgerEntryRehydration, Money,
    TransactionCategory, TransactionCategoryKind,
};
use rusqlite::Connection;
use serde_json::{Value, json};
use std::time::{Duration, Instant};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;
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
fn transaction_dependency_probes_observe_uncommitted_references_and_entries() {
    let mut repository = SqliteLedgerRepository::open_in_memory().unwrap();
    let mut transaction = repository.begin_transaction().unwrap();
    seed_references(&mut *transaction);

    assert!(
        transaction
            .currency_has_dependencies("currency-krw")
            .unwrap()
    );
    assert!(!transaction.account_has_entries("account-cash").unwrap());
    assert!(
        !transaction
            .transaction_category_has_entries("transaction-food")
            .unwrap()
    );
    assert!(
        !transaction
            .transaction_category_has_children("transaction-food")
            .unwrap()
    );

    transaction
        .insert_entry(&entry("entry-probe", None))
        .unwrap();
    let child = TransactionCategory::new(
        "transaction-lunch",
        "Lunch",
        Some("transaction-food".to_string()),
        TransactionCategoryKind::Expense,
    )
    .unwrap();
    transaction
        .upsert_transaction_category(&child, datetime!(2026-07-30 01:03:00 UTC))
        .unwrap();

    assert!(transaction.account_has_entries("account-cash").unwrap());
    assert!(
        transaction
            .transaction_category_has_entries("transaction-food")
            .unwrap()
    );
    assert!(
        transaction
            .transaction_category_has_children("transaction-food")
            .unwrap()
    );
    assert!(
        !transaction
            .currency_has_dependencies("currency-missing")
            .unwrap()
    );
    transaction.rollback().unwrap();
}

#[test]
fn transaction_currency_code_candidates_distinguish_none_and_one() {
    let mut repository = SqliteLedgerRepository::open_in_memory().unwrap();
    let mut transaction = repository.begin_transaction().unwrap();
    let active = Currency::new("currency-krw", "KRW", "Korean won", "KRW", 0).unwrap();
    let inactive =
        Currency::rehydrate("currency-usd", "USD", "US dollar", "USD", 2, false).unwrap();
    let at = datetime!(2026-07-30 01:00:00 UTC);
    transaction.upsert_currency(&active, at).unwrap();
    transaction.upsert_currency(&inactive, at).unwrap();

    assert_eq!(
        transaction.currency_by_code("KRW").unwrap(),
        CandidateMatch::One(active)
    );
    assert_eq!(
        transaction.currency_by_code("USD").unwrap(),
        CandidateMatch::None
    );
    assert_eq!(
        transaction.currency_by_code("EUR").unwrap(),
        CandidateMatch::None
    );
    transaction.rollback().unwrap();
}

#[test]
fn active_name_candidates_report_ambiguity_without_unique_name_constraints() {
    let mut repository = SqliteLedgerRepository::open_in_memory().unwrap();
    let mut transaction = repository.begin_transaction().unwrap();
    let at = datetime!(2026-07-30 01:00:00 UTC);
    let currency_one = Currency::new("currency-1", "ONE", "Shared", "1", 0).unwrap();
    let currency_two = Currency::new("currency-2", "TWO", "Shared", "2", 0).unwrap();
    let inactive = Currency::rehydrate("currency-3", "THR", "Solo", "3", 0, false).unwrap();
    let solo = Currency::new("currency-4", "FOR", "Solo", "4", 0).unwrap();
    for currency in [&currency_one, &currency_two, &inactive, &solo] {
        transaction.upsert_currency(currency, at).unwrap();
    }

    let account_category_one =
        AccountCategory::new("account-category-1", "Shared", None, false).unwrap();
    let account_category_two =
        AccountCategory::new("account-category-2", "Shared", None, false).unwrap();
    for category in [&account_category_one, &account_category_two] {
        transaction.upsert_account_category(category, at).unwrap();
    }

    let account_one = Account::new(
        "account-1",
        "Shared",
        account_category_one.id(),
        currency_one.id(),
        Money::from_minor_units(0),
    )
    .unwrap();
    let account_two = Account::new(
        "account-2",
        "Shared",
        account_category_one.id(),
        currency_one.id(),
        Money::from_minor_units(0),
    )
    .unwrap();
    for account in [&account_one, &account_two] {
        transaction.upsert_account(account, at).unwrap();
    }

    let transaction_category_one = TransactionCategory::new(
        "transaction-category-1",
        "Shared",
        None,
        TransactionCategoryKind::Expense,
    )
    .unwrap();
    let transaction_category_two = TransactionCategory::new(
        "transaction-category-2",
        "Shared",
        None,
        TransactionCategoryKind::Expense,
    )
    .unwrap();
    for category in [&transaction_category_one, &transaction_category_two] {
        transaction
            .upsert_transaction_category(category, at)
            .unwrap();
    }

    assert_eq!(
        transaction.currency_by_active_name("Shared").unwrap(),
        CandidateMatch::Ambiguous
    );
    assert_eq!(
        transaction.currency_by_active_name("Solo").unwrap(),
        CandidateMatch::One(solo)
    );
    assert_eq!(
        transaction
            .account_category_by_active_name("Shared")
            .unwrap(),
        CandidateMatch::Ambiguous
    );
    assert_eq!(
        transaction.account_by_active_name("Shared").unwrap(),
        CandidateMatch::Ambiguous
    );
    assert_eq!(
        transaction
            .transaction_category_by_active_name("Shared")
            .unwrap(),
        CandidateMatch::Ambiguous
    );
    transaction.rollback().unwrap();
}

#[test]
fn transaction_master_lists_are_deterministic_and_bounded() {
    let mut repository = SqliteLedgerRepository::open_in_memory().unwrap();
    let mut transaction = repository.begin_transaction().unwrap();
    seed_references(&mut *transaction);

    let page = Page {
        offset: 0,
        limit: 1,
    };
    assert_eq!(transaction.list_active_currencies(page).unwrap().len(), 1);
    assert_eq!(
        transaction
            .list_active_account_categories(page)
            .unwrap()
            .len(),
        1
    );
    assert_eq!(transaction.list_active_accounts(page).unwrap().len(), 1);
    assert_eq!(
        transaction
            .list_active_transaction_categories(page)
            .unwrap()
            .len(),
        1
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
                ..EntryQuery::default()
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
            .list_audit_events("ledger_entry", "entry-rollback", Page::default(),)
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
            .list_audit_events("ledger_entry", "entry-already-purged", Page::default(),)
            .unwrap(),
        vec![audit]
    );
}

#[test]
fn persistence_normalizes_master_and_audit_timestamps_to_utc() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("ledger.sqlite");
    let mut repository = SqliteLedgerRepository::open(&database).unwrap();
    let changed_at = parse_time("2026-07-30T09:00:00+09:00");
    let audit = audit_at(
        "audit-offset",
        "ledger_entry",
        "entry-offset",
        parse_time("2026-07-30T10:00:00+09:00"),
    );
    let currency = Currency::new("currency-offset", "UTC", "UTC test", "U", 0).unwrap();

    let mut transaction = repository.begin_transaction().unwrap();
    transaction.upsert_currency(&currency, changed_at).unwrap();
    transaction.insert_audit_event(&audit).unwrap();
    transaction.commit().unwrap();
    drop(repository);

    let connection = Connection::open(&database).unwrap();
    assert_eq!(
        connection
            .query_row(
                "SELECT created_at FROM currencies WHERE id = 'currency-offset'",
                [],
                |row| row.get::<_, String>(0),
            )
            .unwrap(),
        "2026-07-30T00:00:00Z"
    );
    assert_eq!(
        connection
            .query_row(
                "SELECT occurred_at FROM audit_events WHERE id = 'audit-offset'",
                [],
                |row| row.get::<_, String>(0),
            )
            .unwrap(),
        "2026-07-30T01:00:00Z"
    );
}

#[test]
fn version_zero_migration_normalizes_legacy_offset_timestamps_to_utc() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("ledger.sqlite");
    let mut repository = SqliteLedgerRepository::open(&database).unwrap();
    let currency = Currency::new("currency-legacy-offset", "LOT", "Legacy offset", "L", 0).unwrap();
    let audit = audit_at(
        "audit-legacy-offset",
        "currency",
        currency.id(),
        datetime!(2026-07-30 00:00:00 UTC),
    );
    let mut transaction = repository.begin_transaction().unwrap();
    transaction
        .upsert_currency(&currency, datetime!(2026-07-30 00:00:00 UTC))
        .unwrap();
    transaction.insert_audit_event(&audit).unwrap();
    transaction.commit().unwrap();
    drop(repository);

    let connection = Connection::open(&database).unwrap();
    connection
        .execute_batch(
            "UPDATE currencies
             SET created_at = '2026-07-30T09:00:00+09:00',
                 updated_at = '2026-07-30T09:00:00+09:00'
             WHERE id = 'currency-legacy-offset';
             UPDATE audit_events
             SET occurred_at = '2026-07-29T20:30:00-04:00'
             WHERE id = 'audit-legacy-offset';
             PRAGMA user_version = 0;",
        )
        .unwrap();
    drop(connection);

    drop(SqliteLedgerRepository::open(&database).unwrap());

    let connection = Connection::open(&database).unwrap();
    assert_eq!(
        connection
            .query_row(
                "SELECT created_at FROM currencies WHERE id = 'currency-legacy-offset'",
                [],
                |row| row.get::<_, String>(0),
            )
            .unwrap(),
        "2026-07-30T00:00:00Z"
    );
    assert_eq!(
        connection
            .query_row(
                "SELECT occurred_at FROM audit_events WHERE id = 'audit-legacy-offset'",
                [],
                |row| row.get::<_, String>(0),
            )
            .unwrap(),
        "2026-07-30T00:30:00Z"
    );
}

#[test]
fn version_one_health_rejects_non_utc_timestamps_without_rewriting_them() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("ledger.sqlite");
    let mut repository = SqliteLedgerRepository::open(&database).unwrap();
    let currency = Currency::new("currency-non-utc", "NUT", "Non UTC", "N", 0).unwrap();
    let mut transaction = repository.begin_transaction().unwrap();
    transaction
        .upsert_currency(&currency, datetime!(2026-07-30 00:00:00 UTC))
        .unwrap();
    transaction.commit().unwrap();
    drop(repository);

    let connection = Connection::open(&database).unwrap();
    connection
        .execute(
            "UPDATE currencies
             SET updated_at = '2026-07-30T09:00:00+09:00'
             WHERE id = 'currency-non-utc'",
            [],
        )
        .unwrap();
    drop(connection);

    assert!(matches!(
        SqliteLedgerRepository::open(&database),
        Err(LedgerError::Migration(_))
    ));
    assert_eq!(
        Connection::open(&database)
            .unwrap()
            .query_row(
                "SELECT updated_at FROM currencies WHERE id = 'currency-non-utc'",
                [],
                |row| row.get::<_, String>(0),
            )
            .unwrap(),
        "2026-07-30T09:00:00+09:00"
    );
}

#[test]
fn audit_order_uses_instant_order_across_input_offsets() {
    let mut repository = SqliteLedgerRepository::open_in_memory().unwrap();
    let earlier = audit_at(
        "audit-earlier",
        "ledger_entry",
        "entry-order",
        parse_time("2026-07-30T09:00:00+09:00"),
    );
    let later = audit_at(
        "audit-later",
        "ledger_entry",
        "entry-order",
        parse_time("2026-07-29T20:30:00-04:00"),
    );

    let mut transaction = repository.begin_transaction().unwrap();
    transaction.insert_audit_event(&later).unwrap();
    transaction.insert_audit_event(&earlier).unwrap();
    transaction.commit().unwrap();

    let events = repository
        .list_audit_events("ledger_entry", "entry-order", Page::default())
        .unwrap();
    assert_eq!(
        events
            .iter()
            .map(|event| event.id.as_str())
            .collect::<Vec<_>>(),
        vec!["audit-earlier", "audit-later"]
    );
    assert!(
        events
            .iter()
            .all(|event| event.occurred_at.offset() == time::UtcOffset::UTC)
    );
}

#[test]
fn audit_lookup_uses_full_record_identity_and_bounded_page() {
    let mut repository = SqliteLedgerRepository::open_in_memory().unwrap();
    let mut transaction = repository.begin_transaction().unwrap();
    for (id, record_type) in [
        ("audit-1", "ledger_entry"),
        ("audit-2", "ledger_entry"),
        ("audit-3", "ledger_entry"),
        ("audit-account", "account"),
    ] {
        transaction
            .insert_audit_event(&audit_at(
                id,
                record_type,
                "shared-id",
                datetime!(2026-07-30 01:02:06 UTC),
            ))
            .unwrap();
    }
    transaction.commit().unwrap();

    let events = repository
        .list_audit_events(
            "ledger_entry",
            "shared-id",
            Page {
                offset: 1,
                limit: 1,
            },
        )
        .unwrap();
    assert_eq!(
        events
            .iter()
            .map(|event| event.id.as_str())
            .collect::<Vec<_>>(),
        vec!["audit-2"]
    );
}

#[test]
fn deep_audit_json_write_error_allows_the_paired_mutation_to_roll_back() {
    let mut repository = SqliteLedgerRepository::open_in_memory().unwrap();
    let paired_entry = entry("entry-deep-audit", None);
    let mut deep_audit = audit("audit-deep", paired_entry.id());
    deep_audit.after = Some(nested_array_value(200));

    let mut transaction = repository.begin_transaction().unwrap();
    seed_references(&mut *transaction);
    transaction.insert_entry(&paired_entry).unwrap();
    let error = transaction.insert_audit_event(&deep_audit).unwrap_err();
    transaction.rollback().unwrap();

    assert!(
        matches!(error, LedgerError::Storage(_)),
        "deep audit JSON must be rejected before persistence"
    );
    assert_eq!(repository.get_entry(paired_entry.id(), true).unwrap(), None);
    assert!(
        repository
            .list_audit_events("ledger_entry", paired_entry.id(), Page::default())
            .unwrap()
            .is_empty()
    );
    repository.check_schema().unwrap();
}

#[test]
fn normal_nested_audit_json_writes_and_round_trips() {
    let mut repository = SqliteLedgerRepository::open_in_memory().unwrap();
    let mut event = audit("audit-nested", "entry-nested");
    event.before = Some(json!({
        "account": {"tags": ["cash", {"region": "KR"}]},
        "active": true
    }));
    event.after = Some(json!([
        {"entry": {"amount": 1250, "metadata": {"source": "manual"}}},
        null
    ]));

    let mut transaction = repository.begin_transaction().unwrap();
    transaction.insert_audit_event(&event).unwrap();
    transaction.commit().unwrap();

    repository.check_schema().unwrap();
    assert_eq!(
        repository
            .list_audit_events("ledger_entry", "entry-nested", Page::default())
            .unwrap(),
        vec![event]
    );
}

#[test]
fn audit_json_write_matches_the_documented_byte_boundary() {
    const MAX_AUDIT_JSON_BYTES: usize = 1024 * 1024;

    let mut repository = SqliteLedgerRepository::open_in_memory().unwrap();
    let mut exact = audit("audit-exact-limit", "entry-exact-limit");
    exact.after = Some(json!("x".repeat(MAX_AUDIT_JSON_BYTES - 2)));
    let mut above = audit("audit-above-limit", "entry-above-limit");
    above.after = Some(json!("x".repeat(MAX_AUDIT_JSON_BYTES - 1)));

    let mut transaction = repository.begin_transaction().unwrap();
    transaction.insert_audit_event(&exact).unwrap();
    transaction.commit().unwrap();

    let mut transaction = repository.begin_transaction().unwrap();
    let error = transaction.insert_audit_event(&above).unwrap_err();
    transaction.rollback().unwrap();

    assert!(
        matches!(error, LedgerError::Storage(message) if message.contains("audit JSON")),
        "one byte above the audit JSON boundary must be rejected"
    );
    repository.check_schema().unwrap();
    assert_eq!(
        repository
            .list_audit_events("ledger_entry", "entry-exact-limit", Page::default())
            .unwrap(),
        vec![exact]
    );
}

#[test]
fn entry_query_applies_bounded_offset_and_limit_in_sql() {
    let mut repository = SqliteLedgerRepository::open_in_memory().unwrap();
    let mut transaction = repository.begin_transaction().unwrap();
    seed_references(&mut *transaction);
    for id in ["entry-page-1", "entry-page-2", "entry-page-3"] {
        transaction.insert_entry(&entry(id, None)).unwrap();
    }
    transaction.commit().unwrap();

    let entries = repository
        .list_entries(&EntryQuery {
            offset: 1,
            limit: 1,
            ..EntryQuery::default()
        })
        .unwrap();
    assert_eq!(
        entries.iter().map(|entry| entry.id()).collect::<Vec<_>>(),
        vec!["entry-page-2"]
    );
}

#[test]
fn writer_lock_expiry_is_reported_as_retryable_busy() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("ledger.sqlite");
    drop(SqliteLedgerRepository::open(&database).unwrap());
    let locker = Connection::open(&database).unwrap();
    locker
        .execute_batch(
            "PRAGMA user_version = 0;
             BEGIN IMMEDIATE;",
        )
        .unwrap();

    let started = Instant::now();
    let error = match SqliteLedgerRepository::open(&database) {
        Ok(_) => panic!("a held writer lock must prevent schema initialization"),
        Err(error) => error,
    };
    let elapsed = started.elapsed();
    locker.execute_batch("ROLLBACK;").unwrap();

    assert!(matches!(error, LedgerError::Busy(_)));
    assert!(
        elapsed < Duration::from_secs(2),
        "configured busy timeout must remain bounded, got {elapsed:?}"
    );
}

#[test]
fn invalid_persisted_master_is_rejected_during_health_check() {
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

    assert!(matches!(
        SqliteLedgerRepository::open(&database),
        Err(LedgerError::Migration(message)) if message.contains("persisted scalar")
    ));
}

#[test]
fn invalid_persisted_entry_is_rejected_during_health_check() {
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

    assert!(matches!(
        SqliteLedgerRepository::open(&database),
        Err(LedgerError::Migration(message)) if message.contains("persisted scalar")
    ));
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
    audit_at(
        id,
        "ledger_entry",
        record_id,
        datetime!(2026-07-30 01:02:06 UTC),
    )
}

fn audit_at(
    id: &str,
    record_type: &str,
    record_id: &str,
    occurred_at: OffsetDateTime,
) -> AuditEvent {
    AuditEvent {
        id: id.to_string(),
        occurred_at,
        actor: "user".to_string(),
        action: "create".to_string(),
        record_type: record_type.to_string(),
        record_id: record_id.to_string(),
        before: None,
        after: Some(json!({"id": record_id})),
        reason: None,
    }
}

fn nested_array_value(depth: usize) -> Value {
    (0..depth).fold(json!(0), |value, _| Value::Array(vec![value]))
}

fn parse_time(value: &str) -> OffsetDateTime {
    OffsetDateTime::parse(value, &Rfc3339).unwrap()
}
