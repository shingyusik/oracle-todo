use std::path::Path;

use ledger_engine::application::commands::{
    CreateAccount, CreateAccountCategory, CreateCurrency, CreateEntry, CreateTransactionCategory,
};
use ledger_engine::application::error::LedgerError;
use ledger_engine::application::ports::Page;
use ledger_engine::application::service::LedgerService;
use ledger_engine::application::transfers::{TransferCommand, TransferOperationKey};
use ledger_engine::domain::{EntryType, Money, TransactionCategoryKind};
use ledger_engine::infrastructure::sqlite::SqliteLedgerRepository;
use rusqlite::Connection;
use time::macros::datetime;

type TestService = LedgerService<SqliteLedgerRepository>;

struct Seeded {
    service: TestService,
    account_category_id: String,
}

#[test]
fn archive_and_restore_are_audited_reversible_and_idempotent() {
    let mut seeded = seeded_service_in_memory();
    let entry = seeded.service.create_entry(valid_expense()).unwrap();

    let archived = seeded.service.archive_entry(entry.id()).unwrap();
    assert!(archived.is_archived());
    assert!(seeded.service.get_entry(entry.id()).is_err());
    assert_eq!(
        seeded
            .service
            .entry_including_archived(entry.id())
            .unwrap()
            .map(|view| view.entry),
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
fn every_pair_lifecycle_operation_rejects_corrupt_identity_and_timestamp_invariants() {
    for operation in ["archive", "restore"] {
        for corruption in [
            "group_uuid",
            "entry_uuid",
            "created_at",
            "updated_at",
            "deleted_at",
        ] {
            assert_corrupt_pair_is_rejected(operation, corruption);
        }
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
    service
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
    service
        .create_category(CreateTransactionCategory {
            name: "Food".to_string(),
            parent: None,
            kind: TransactionCategoryKind::Expense,
            actor: "seed".to_string(),
        })
        .unwrap();
    Seeded {
        service,
        account_category_id: category.id().to_string(),
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
        operation_key: TransferOperationKey::generate(),
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

fn assert_corrupt_pair_is_rejected(operation: &str, corruption: &str) {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("ledger.sqlite");
    let mut seeded = seeded_service_at(&database);
    let result = seeded.service.transfer(valid_transfer()).unwrap();
    if operation == "archive" {
        seeded.service.archive_entry(&result.out_entry_id).unwrap();
    }
    drop(seeded);

    let connection = Connection::open(&database).unwrap();
    match corruption {
        "group_uuid" => {
            connection
                .execute(
                    "UPDATE ledger_entries SET transfer_group_id = 'not-an-engine-uuid'
                     WHERE transfer_group_id = ?1",
                    [&result.transfer_group_id],
                )
                .unwrap();
        }
        "entry_uuid" => {
            connection
                .execute(
                    "UPDATE ledger_entries SET id = 'not-an-engine-uuid' WHERE id = ?1",
                    [&result.in_entry_id],
                )
                .unwrap();
        }
        "created_at" => {
            connection
                .execute(
                    "UPDATE ledger_entries SET created_at = '2026-07-29T00:00:00Z' WHERE id = ?1",
                    [&result.in_entry_id],
                )
                .unwrap();
        }
        "updated_at" => {
            connection
                .execute(
                    "UPDATE ledger_entries SET updated_at = '2026-07-29T00:00:00Z' WHERE id = ?1",
                    [&result.in_entry_id],
                )
                .unwrap();
        }
        "deleted_at" => {
            connection
                .execute(
                    "UPDATE ledger_entries SET deleted_at = '2026-07-29T00:00:00Z' WHERE id = ?1",
                    [&result.in_entry_id],
                )
                .unwrap();
            if operation != "archive" {
                connection
                    .execute(
                        "UPDATE ledger_entries SET deleted_at = '2026-07-28T00:00:00Z'
                         WHERE id = ?1",
                        [&result.out_entry_id],
                    )
                    .unwrap();
            }
        }
        _ => unreachable!(),
    }
    let audit_count_before: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM audit_events
             WHERE record_type = 'transfer' AND record_id = ?1",
            [&result.transfer_group_id],
            |row| row.get(0),
        )
        .unwrap();
    let rows_before: Vec<(String, String, String, Option<String>)> = {
        let mut statement = connection
            .prepare(
                "SELECT id, created_at, updated_at, deleted_at
                 FROM ledger_entries ORDER BY entry_type",
            )
            .unwrap();
        statement
            .query_map([], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
            })
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap()
    };
    drop(connection);

    let mut service = LedgerService::new(SqliteLedgerRepository::open(&database).unwrap());
    let result_error = match operation {
        "archive" => service.archive_entry(&result.out_entry_id).map(drop),
        "restore" => service.restore_entry(&result.out_entry_id).map(drop),
        _ => unreachable!(),
    }
    .unwrap_err();
    assert!(
        matches!(result_error, LedgerError::Conflict(ref message) if message.contains("transfer pair")),
        "{operation}/{corruption}: {result_error:?}"
    );
    drop(service);

    let connection = Connection::open(&database).unwrap();
    let audit_count_after: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM audit_events
             WHERE record_type = 'transfer' AND record_id = ?1",
            [&result.transfer_group_id],
            |row| row.get(0),
        )
        .unwrap();
    let rows_after: Vec<(String, String, String, Option<String>)> = {
        let mut statement = connection
            .prepare(
                "SELECT id, created_at, updated_at, deleted_at
                 FROM ledger_entries ORDER BY entry_type",
            )
            .unwrap();
        statement
            .query_map([], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
            })
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap()
    };
    assert_eq!(audit_count_after, audit_count_before);
    assert_eq!(rows_after, rows_before);
}

#[test]
fn account_type_purge_keeps_exact_confirmation_and_dependency_policy() {
    let mut seeded = seeded_service_in_memory();
    assert!(
        seeded
            .service
            .purge_account_category_preview(&seeded.account_category_id)
            .is_err()
    );
    let unused = seeded
        .service
        .create_account_category(CreateAccountCategory {
            name: "Unused".into(),
            parent: None,
            liability: false,
            actor: "test".into(),
        })
        .unwrap();
    let preview = seeded
        .service
        .purge_account_category_preview(unused.id())
        .unwrap();
    assert_eq!(preview.confirmation_id, unused.id());
    assert!(
        seeded
            .service
            .purge_account_category(unused.id(), "wrong")
            .is_err()
    );
    seeded
        .service
        .purge_account_category(unused.id(), unused.id())
        .unwrap();
    assert!(
        seeded
            .service
            .purge_account_category_preview(unused.id())
            .is_err()
    );
    assert_eq!(
        seeded
            .service
            .audit_page("account_category", unused.id(), Page::default())
            .unwrap()
            .items
            .len(),
        2
    );
}

#[test]
fn historical_adjustments_remain_readable_editable_and_recoverable() {
    use ledger_engine::application::commands::UpdateEntry;
    let temp = tempfile::tempdir().unwrap();
    let database = temp.path().join("historical.sqlite");
    let mut seeded = seeded_service_at(&database);
    let entry = seeded.service.create_entry(valid_expense()).unwrap();
    Connection::open(&database).unwrap().execute(
        "UPDATE ledger_entries SET entry_type = 'adjustment_out', transaction_category_id = NULL WHERE id = ?1",
        [entry.id()],
    ).unwrap();
    let historical = seeded.service.get_entry(entry.id()).unwrap().entry;
    assert_eq!(historical.entry_type(), EntryType::AdjustmentOut);
    let updated = seeded
        .service
        .update_entry(
            entry.id(),
            UpdateEntry {
                notes: Some(Some("Historical correction".into())),
                actor: "test".into(),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(updated.written_at(), historical.written_at());
    assert_eq!(updated.source(), historical.source());
    assert!(
        seeded
            .service
            .update_entry(
                entry.id(),
                UpdateEntry {
                    entry_type: Some(EntryType::Expense),
                    actor: "test".into(),
                    ..Default::default()
                }
            )
            .is_err()
    );
    seeded.service.archive_entry(entry.id()).unwrap();
    assert!(seeded.service.get_entry(entry.id()).is_err());
    let restored = seeded.service.restore_entry(entry.id()).unwrap();
    assert_eq!(restored.entry_type(), EntryType::AdjustmentOut);
    assert_eq!(restored.notes(), Some("Historical correction"));
    assert_eq!(
        seeded
            .service
            .audit_page("ledger_entry", entry.id(), Page::default())
            .unwrap()
            .items
            .len(),
        4
    );
}
