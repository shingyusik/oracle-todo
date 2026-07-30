use std::path::Path;

use ledger_engine::application::commands::{
    CreateAccount, CreateAccountCategory, CreateCurrency, CreateEntry, CreateTransactionCategory,
    UpdateAccount, UpdateCurrency,
};
use ledger_engine::application::error::LedgerError;
use ledger_engine::application::ports::{EntryQuery, LedgerRepository, Page};
use ledger_engine::application::service::LedgerService;
use ledger_engine::application::transfers::TransferCommand;
use ledger_engine::domain::{EntryType, Money, TransactionCategoryKind};
use ledger_engine::infrastructure::sqlite::SqliteLedgerRepository;
use rusqlite::Connection;
use time::macros::datetime;

type TestService = LedgerService<SqliteLedgerRepository>;

struct Seeded {
    service: TestService,
    currency_id: String,
    account_category_id: String,
    account_id: String,
    transaction_category_id: String,
}

#[test]
fn archive_and_restore_are_audited_reversible_and_idempotent() {
    let mut seeded = seeded_service_in_memory();
    let entry = seeded.service.create_entry(valid_expense()).unwrap();

    let archived = seeded.service.archive_entry(entry.id()).unwrap();
    assert!(archived.is_archived());
    assert!(seeded.service.get_entry(entry.id()).is_err());
    assert_eq!(
        seeded.service.entry_including_archived(entry.id()).unwrap(),
        Some(archived.clone())
    );
    assert_eq!(seeded.service.archive_entry(entry.id()).unwrap(), archived);

    let after_archive = seeded
        .service
        .audit_page("ledger_entry", entry.id(), Page::default())
        .unwrap()
        .items;
    assert_eq!(after_archive.len(), 2);
    assert_eq!(after_archive[1].action, "archive");
    assert_eq!(after_archive[1].actor, "ledger-service");
    assert_eq!(
        after_archive[1].before,
        Some(serde_json::to_value(&entry).unwrap())
    );
    assert_eq!(
        after_archive[1].after,
        Some(serde_json::to_value(&archived).unwrap())
    );

    let restored = seeded.service.restore_entry(entry.id()).unwrap();
    assert!(!restored.is_archived());
    assert_eq!(seeded.service.get_entry(entry.id()).unwrap(), restored);
    assert_eq!(seeded.service.restore_entry(entry.id()).unwrap(), restored);
    let events = seeded
        .service
        .audit_page("ledger_entry", entry.id(), Page::default())
        .unwrap()
        .items;
    assert_eq!(events.len(), 3);
    assert_eq!(events[2].action, "restore");
    assert_eq!(
        events[2].before,
        Some(serde_json::to_value(&archived).unwrap())
    );
    assert_eq!(
        events[2].after,
        Some(serde_json::to_value(&restored).unwrap())
    );
}

#[test]
fn purge_requires_exact_confirmation_accepts_archived_rows_and_keeps_final_audit() {
    let mut seeded = seeded_service_in_memory();
    let entry = seeded.service.create_entry(valid_expense()).unwrap();
    let archived = seeded.service.archive_entry(entry.id()).unwrap();

    assert_eq!(
        seeded.service.purge_entry(entry.id(), "wrong"),
        Err(LedgerError::ConfirmationMismatch)
    );
    assert_eq!(
        seeded.service.entry_including_archived(entry.id()).unwrap(),
        Some(archived.clone())
    );

    seeded.service.purge_entry(entry.id(), entry.id()).unwrap();
    assert!(
        seeded
            .service
            .entry_including_archived(entry.id())
            .unwrap()
            .is_none()
    );
    let events = seeded
        .service
        .audit_page("ledger_entry", entry.id(), Page::default())
        .unwrap()
        .items;
    assert_eq!(events.len(), 3);
    let purge = &events[2];
    assert_eq!(purge.action, "purge");
    assert_eq!(purge.before, Some(serde_json::to_value(&archived).unwrap()));
    assert_eq!(purge.after, None);
    assert_eq!(
        seeded.service.purge_entry(entry.id(), entry.id()),
        Err(LedgerError::NotFound(format!(
            "ledger entry {}",
            entry.id()
        )))
    );
}

#[test]
fn missing_entries_have_explicit_lifecycle_errors() {
    let mut seeded = seeded_service_in_memory();

    for result in [
        seeded.service.archive_entry("missing").map(drop),
        seeded.service.restore_entry("missing").map(drop),
        seeded.service.purge_entry("missing", "missing"),
    ] {
        assert!(matches!(
            result,
            Err(LedgerError::NotFound(message)) if message == "ledger entry missing"
        ));
    }
}

#[test]
fn transfer_lifecycle_updates_and_purges_the_validated_pair_together() {
    let mut seeded = seeded_service_in_memory();
    let result = seeded.service.transfer(valid_transfer()).unwrap();

    seeded.service.archive_entry(&result.out_entry_id).unwrap();
    let archived = seeded
        .service
        .entries_page(EntryQuery {
            include_archived: true,
            ..EntryQuery::default()
        })
        .unwrap()
        .items;
    assert_eq!(archived.len(), 2);
    assert!(archived.iter().all(|entry| entry.is_archived()));

    seeded.service.restore_entry(&result.in_entry_id).unwrap();
    let active = seeded
        .service
        .entries_page(EntryQuery::default())
        .unwrap()
        .items;
    assert_eq!(active.len(), 2);
    assert!(active.iter().all(|entry| !entry.is_archived()));

    seeded
        .service
        .purge_entry(&result.out_entry_id, &result.out_entry_id)
        .unwrap();
    assert!(
        seeded
            .service
            .entries_page(EntryQuery {
                include_archived: true,
                ..EntryQuery::default()
            })
            .unwrap()
            .items
            .is_empty()
    );
    for id in [&result.out_entry_id, &result.in_entry_id] {
        let actions: Vec<_> = seeded
            .service
            .audit_page("ledger_entry", id, Page::default())
            .unwrap()
            .items
            .into_iter()
            .map(|event| event.action)
            .collect();
        assert_eq!(actions, ["archive", "restore", "purge"]);
    }
    assert_eq!(
        seeded
            .service
            .audit_page("transfer", &result.transfer_group_id, Page::default())
            .unwrap()
            .items
            .len(),
        1
    );
}

#[test]
fn lifecycle_rejects_a_damaged_transfer_pair_without_mutation_or_audit() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("ledger.sqlite");
    let mut seeded = seeded_service_at(&database);
    let result = seeded.service.transfer(valid_transfer()).unwrap();
    drop(seeded);

    let connection = Connection::open(&database).unwrap();
    connection
        .execute(
            "DELETE FROM ledger_entries WHERE id = ?1",
            [&result.in_entry_id],
        )
        .unwrap();
    drop(connection);

    let mut service = LedgerService::new(SqliteLedgerRepository::open(&database).unwrap());
    let error = service.archive_entry(&result.out_entry_id).unwrap_err();
    assert!(matches!(error, LedgerError::Conflict(message) if message.contains("transfer pair")));
    assert!(
        !service
            .entry_including_archived(&result.out_entry_id)
            .unwrap()
            .unwrap()
            .is_archived()
    );
    assert!(
        service
            .audit_page("ledger_entry", &result.out_entry_id, Page::default())
            .unwrap()
            .items
            .is_empty()
    );
}

#[test]
fn lifecycle_preserves_historical_master_references_and_purge_never_deletes_them() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("ledger.sqlite");
    let mut seeded = seeded_service_at(&database);
    let entry = seeded.service.create_entry(valid_expense()).unwrap();
    seeded
        .service
        .update_account(
            &seeded.account_id,
            UpdateAccount {
                active: Some(false),
                actor: "tester".to_string(),
                ..UpdateAccount::default()
            },
        )
        .unwrap();
    seeded
        .service
        .update_currency(
            &seeded.currency_id,
            UpdateCurrency {
                active: Some(false),
                actor: "tester".to_string(),
                ..UpdateCurrency::default()
            },
        )
        .unwrap();

    seeded.service.archive_entry(entry.id()).unwrap();
    seeded.service.restore_entry(entry.id()).unwrap();
    seeded.service.purge_entry(entry.id(), entry.id()).unwrap();
    let account_id = seeded.account_id.clone();
    let currency_id = seeded.currency_id.clone();
    drop(seeded);

    let repository = SqliteLedgerRepository::open(&database).unwrap();
    assert!(repository.get_account(&account_id, true).unwrap().is_some());
    assert!(
        repository
            .get_currency(&currency_id, true)
            .unwrap()
            .is_some()
    );
}

#[test]
fn referenced_master_data_cannot_be_purged_even_when_the_entry_is_archived() {
    let mut seeded = seeded_service_in_memory();
    let entry = seeded.service.create_entry(valid_expense()).unwrap();
    seeded.service.archive_entry(entry.id()).unwrap();

    for (record_type, record_id, result) in [
        (
            "currency",
            seeded.currency_id.clone(),
            seeded
                .service
                .purge_currency(&seeded.currency_id, &seeded.currency_id),
        ),
        (
            "account_category",
            seeded.account_category_id.clone(),
            seeded
                .service
                .purge_account_category(&seeded.account_category_id, &seeded.account_category_id),
        ),
        (
            "account",
            seeded.account_id.clone(),
            seeded
                .service
                .purge_account(&seeded.account_id, &seeded.account_id),
        ),
        (
            "transaction_category",
            seeded.transaction_category_id.clone(),
            seeded.service.purge_category(
                &seeded.transaction_category_id,
                &seeded.transaction_category_id,
            ),
        ),
    ] {
        assert!(
            matches!(result, Err(LedgerError::Conflict(message)) if message.contains("referenced"))
        );
        assert!(
            seeded
                .service
                .audit_page(record_type, &record_id, Page::default())
                .unwrap()
                .items
                .iter()
                .all(|event| event.action != "purge")
        );
    }
}

#[test]
fn unreferenced_master_purge_keeps_final_snapshot_audits() {
    let mut seeded = seeded_service_in_memory();
    let currency = seeded
        .service
        .create_currency(CreateCurrency {
            code: "JPY".to_string(),
            name: "Japanese yen".to_string(),
            symbol: "¥".to_string(),
            decimal_places: 0,
            actor: "tester".to_string(),
        })
        .unwrap();
    let account_category = seeded
        .service
        .create_account_category(CreateAccountCategory {
            name: "Unused".to_string(),
            parent: None,
            liability: false,
            actor: "tester".to_string(),
        })
        .unwrap();
    let account = seeded
        .service
        .create_account(CreateAccount {
            name: "Unused account".to_string(),
            category: seeded.account_category_id.clone(),
            currency: seeded.currency_id.clone(),
            opening_balance: Money::from_minor_units(0),
            actor: "tester".to_string(),
        })
        .unwrap();
    let transaction_category = seeded
        .service
        .create_category(CreateTransactionCategory {
            name: "Unused expense".to_string(),
            parent: None,
            kind: TransactionCategoryKind::Expense,
            actor: "tester".to_string(),
        })
        .unwrap();
    let expected = [
        (
            "currency",
            currency.id().to_string(),
            serde_json::to_value(&currency).unwrap(),
        ),
        (
            "account_category",
            account_category.id().to_string(),
            serde_json::to_value(&account_category).unwrap(),
        ),
        (
            "account",
            account.id().to_string(),
            serde_json::to_value(&account).unwrap(),
        ),
        (
            "transaction_category",
            transaction_category.id().to_string(),
            serde_json::to_value(&transaction_category).unwrap(),
        ),
    ];

    seeded
        .service
        .purge_currency(currency.id(), currency.id())
        .unwrap();
    seeded
        .service
        .purge_account_category(account_category.id(), account_category.id())
        .unwrap();
    seeded
        .service
        .purge_account(account.id(), account.id())
        .unwrap();
    seeded
        .service
        .purge_category(transaction_category.id(), transaction_category.id())
        .unwrap();

    for (record_type, record_id, before) in expected {
        let events = seeded
            .service
            .audit_page(record_type, &record_id, Page::default())
            .unwrap()
            .items;
        let purge = events.last().unwrap();
        assert_eq!(purge.action, "purge");
        assert_eq!(purge.before, Some(before));
        assert_eq!(purge.after, None);
    }
}

fn seeded_service_in_memory() -> Seeded {
    seed(LedgerService::new(
        SqliteLedgerRepository::open_in_memory().unwrap(),
    ))
}

fn seeded_service_at(path: &Path) -> Seeded {
    seed(LedgerService::new(
        SqliteLedgerRepository::open(path).unwrap(),
    ))
}

fn seed(mut service: TestService) -> Seeded {
    let currency = service
        .create_currency(CreateCurrency {
            code: "KRW".to_string(),
            name: "Korean won".to_string(),
            symbol: "₩".to_string(),
            decimal_places: 0,
            actor: "seed".to_string(),
        })
        .unwrap();
    let category = service
        .create_account_category(CreateAccountCategory {
            name: "Cash".to_string(),
            parent: None,
            liability: false,
            actor: "seed".to_string(),
        })
        .unwrap();
    let wallet = service
        .create_account(CreateAccount {
            name: "Wallet".to_string(),
            category: category.id().to_string(),
            currency: currency.id().to_string(),
            opening_balance: Money::from_minor_units(0),
            actor: "seed".to_string(),
        })
        .unwrap();
    service
        .create_account(CreateAccount {
            name: "Savings".to_string(),
            category: category.id().to_string(),
            currency: currency.id().to_string(),
            opening_balance: Money::from_minor_units(0),
            actor: "seed".to_string(),
        })
        .unwrap();
    let transaction_category = service
        .create_category(CreateTransactionCategory {
            name: "Food".to_string(),
            parent: None,
            kind: TransactionCategoryKind::Expense,
            actor: "seed".to_string(),
        })
        .unwrap();
    Seeded {
        service,
        currency_id: currency.id().to_string(),
        account_category_id: category.id().to_string(),
        account_id: wallet.id().to_string(),
        transaction_category_id: transaction_category.id().to_string(),
    }
}

fn valid_expense() -> CreateEntry {
    CreateEntry {
        date: "2026-07-30".to_string(),
        written_at: datetime!(2026-07-30 09:10:11 UTC),
        content: "Lunch".to_string(),
        category: Some("Food".to_string()),
        account: "Wallet".to_string(),
        entry_type: EntryType::Expense,
        amount: Money::from_minor_units(12_500),
        currency: "KRW".to_string(),
        transfer_group: None,
        source: "test".to_string(),
        notes: None,
        actor: "tester".to_string(),
    }
}

fn valid_transfer() -> TransferCommand {
    TransferCommand {
        date: "2026-07-30".to_string(),
        written_at: datetime!(2026-07-30 10:11:12 UTC),
        content: "Move to savings".to_string(),
        from_account: "Wallet".to_string(),
        to_account: "Savings".to_string(),
        amount: Money::from_minor_units(50_000),
        currency: "KRW".to_string(),
        source: "test".to_string(),
        notes: None,
        actor: "tester".to_string(),
    }
}
