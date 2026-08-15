use std::path::Path;
use std::sync::{Arc, Barrier};

use ledger_engine::application::commands::{
    CreateAccount, CreateAccountCategory, CreateCurrency, UpdateAccount,
};
use ledger_engine::application::error::LedgerError;
use ledger_engine::application::ports::{EntryQuery, Page};
use ledger_engine::application::service::LedgerService;
use ledger_engine::application::transfers::{
    TransferCommand, TransferOperationKey, UpdateTransferCommand,
};
use ledger_engine::domain::{EntryType, Money};
use ledger_engine::infrastructure::sqlite::SqliteLedgerRepository;
use rusqlite::Connection;
use time::macros::datetime;
use uuid::Uuid;

type TestService = LedgerService<SqliteLedgerRepository>;

struct Seeded {
    service: TestService,
    krw_id: String,
    wallet_id: String,
    savings_id: String,
}

#[test]
fn transfer_operation_keys_require_canonical_uuid_v4_values() {
    for invalid in [
        "not-a-uuid",
        "10000000-0000-1000-8000-000000000001",
        "10000000-0000-4000-8000-000000000001 ",
        "ABCDEF00-0000-4000-8000-000000000001",
    ] {
        assert!(matches!(
            TransferOperationKey::parse(invalid),
            Err(LedgerError::Validation {
                field: "operation_key",
                ..
            })
        ));
    }
}

#[test]
fn transfer_creates_exactly_two_opposite_rows_and_one_paired_audit() {
    let mut seeded = seeded_service_in_memory();

    let result = seeded.service.transfer(valid_transfer()).unwrap();

    assert_ne!(result.out_entry_id, result.in_entry_id);
    assert!(Uuid::parse_str(&result.out_entry_id).is_ok());
    assert!(Uuid::parse_str(&result.in_entry_id).is_ok());
    assert!(Uuid::parse_str(&result.transfer_group_id).is_ok());

    let entries = seeded
        .service
        .entries_page(EntryQuery::default())
        .unwrap()
        .items;
    assert_eq!(entries.len(), 2);
    let out = entries
        .iter()
        .find(|entry| entry.id() == result.out_entry_id)
        .unwrap();
    let input = entries
        .iter()
        .find(|entry| entry.id() == result.in_entry_id)
        .unwrap();
    assert_eq!(out.entry_type(), EntryType::TransferOut);
    assert_eq!(input.entry_type(), EntryType::TransferIn);
    assert_eq!(out.account_id(), seeded.wallet_id);
    assert_eq!(input.account_id(), seeded.savings_id);
    assert_eq!(out.amount(), Money::from_minor_units(12_345));
    assert_eq!(input.amount(), Money::from_minor_units(12_345));
    assert_eq!(out.currency_id(), seeded.krw_id);
    assert_eq!(input.currency_id(), seeded.krw_id);
    assert_eq!(
        out.transfer_group_id(),
        Some(result.transfer_group_id.as_str())
    );
    assert_eq!(
        input.transfer_group_id(),
        Some(result.transfer_group_id.as_str())
    );
    assert_eq!(out.transaction_category_id(), None);
    assert_eq!(input.transaction_category_id(), None);

    let events = seeded
        .service
        .audit_page("transfer", &result.transfer_group_id, Page::default())
        .unwrap()
        .items;
    assert_eq!(events.len(), 1);
    let event = &events[0];
    assert_eq!(event.action, "create");
    assert_eq!(event.actor, "tester");
    assert_eq!(event.before, None);
    let after = event.after.as_ref().unwrap();
    assert_eq!(
        after["out_entry"],
        serde_json::to_value(&out.entry).unwrap()
    );
    assert_eq!(
        after["in_entry"],
        serde_json::to_value(&input.entry).unwrap()
    );
}

#[test]
fn update_transfer_changes_the_validated_pair_atomically_and_audits_once() {
    let mut seeded = seeded_service_in_memory();
    let created = seeded.service.transfer(valid_transfer()).unwrap();
    let before = seeded
        .service
        .show_transfer(&created.transfer_group_id)
        .unwrap();

    let updated = seeded
        .service
        .update_transfer(
            &created.transfer_group_id,
            UpdateTransferCommand {
                date: "2026-08-15".to_string(),
                content: "Move more savings".to_string(),
                from_account: "Savings".to_string(),
                to_account: "Wallet".to_string(),
                amount: Money::from_minor_units(25_000),
                currency: "KRW".to_string(),
                notes: Some("rebalanced".to_string()),
                actor: "editor".to_string(),
                reason: Some("correct transfer".to_string()),
            },
        )
        .unwrap();

    assert_eq!(updated.transfer_group_id, created.transfer_group_id);
    assert_eq!(updated.out_entry.entry.id(), before.out_entry.entry.id());
    assert_eq!(updated.in_entry.entry.id(), before.in_entry.entry.id());
    assert_eq!(updated.out_entry.entry.account_id(), seeded.savings_id);
    assert_eq!(updated.in_entry.entry.account_id(), seeded.wallet_id);
    assert_eq!(updated.out_entry.entry.content(), "Move more savings");
    assert_eq!(updated.in_entry.entry.content(), "Move more savings");
    assert_eq!(updated.amount_minor, 25_000);
    assert_eq!(
        updated.out_entry.entry.written_at(),
        before.out_entry.entry.written_at()
    );
    assert_eq!(
        updated.out_entry.entry.source(),
        before.out_entry.entry.source()
    );
    assert_eq!(
        updated.out_entry.entry.created_at(),
        before.out_entry.entry.created_at()
    );
    assert_eq!(updated.out_entry.entry.notes(), Some("rebalanced"));

    let events = seeded
        .service
        .audit_page("transfer", &created.transfer_group_id, Page::default())
        .unwrap()
        .items;
    assert_eq!(events.len(), 2);
    let update = events
        .iter()
        .find(|event| event.action == "update")
        .unwrap();
    assert_eq!(update.actor, "editor");
    assert_eq!(update.reason.as_deref(), Some("correct transfer"));
    assert!(update.before.is_some());
    assert!(update.after.is_some());
    let doctor = seeded.service.doctor().unwrap();
    assert!(doctor.healthy, "{:?}", doctor.issues);
}

#[test]
fn invalid_transfer_update_rolls_back_both_rows_and_writes_no_audit() {
    let mut seeded = seeded_service_in_memory();
    let created = seeded.service.transfer(valid_transfer()).unwrap();
    let before = seeded
        .service
        .show_transfer(&created.transfer_group_id)
        .unwrap();

    let error = seeded
        .service
        .update_transfer(
            &created.transfer_group_id,
            UpdateTransferCommand {
                date: "2026-08-15".to_string(),
                content: "Invalid move".to_string(),
                from_account: "Wallet".to_string(),
                to_account: "Dollar card".to_string(),
                amount: Money::from_minor_units(25_000),
                currency: "KRW".to_string(),
                notes: None,
                actor: "editor".to_string(),
                reason: None,
            },
        )
        .unwrap_err();

    assert!(matches!(
        error,
        LedgerError::Validation {
            field: "currency",
            ..
        }
    ));
    assert_eq!(
        seeded
            .service
            .show_transfer(&created.transfer_group_id)
            .unwrap(),
        before
    );
    assert_eq!(
        seeded
            .service
            .audit_page("transfer", &created.transfer_group_id, Page::default())
            .unwrap()
            .items
            .len(),
        1
    );
}

#[test]
fn transfer_rejects_same_account_cross_currency_and_inactive_accounts() {
    let mut seeded = seeded_service_in_memory();

    let mut same_account = valid_transfer();
    same_account.to_account = "Wallet".to_string();
    assert!(matches!(
        seeded.service.transfer(same_account),
        Err(LedgerError::Validation {
            field: "accounts",
            ..
        })
    ));

    let mut cross_currency = valid_transfer();
    cross_currency.to_account = "Dollar card".to_string();
    assert!(matches!(
        seeded.service.transfer(cross_currency),
        Err(LedgerError::Validation {
            field: "currency",
            ..
        })
    ));

    let mut wrong_currency = valid_transfer();
    wrong_currency.currency = "USD".to_string();
    assert!(matches!(
        seeded.service.transfer(wrong_currency),
        Err(LedgerError::Validation {
            field: "currency",
            ..
        })
    ));

    seeded
        .service
        .update_account(
            &seeded.savings_id,
            UpdateAccount {
                active: Some(false),
                actor: "tester".to_string(),
                ..UpdateAccount::default()
            },
        )
        .unwrap();
    let mut inactive_command = valid_transfer();
    inactive_command.to_account = seeded.savings_id.clone();
    let inactive = seeded.service.transfer(inactive_command).unwrap_err();
    assert!(matches!(inactive, LedgerError::Conflict(message) if message.contains("inactive")));

    assert!(
        seeded
            .service
            .entries_page(EntryQuery::default())
            .unwrap()
            .items
            .is_empty()
    );
}

#[test]
fn second_transfer_insert_failure_rolls_back_first_row_and_audit() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("ledger.sqlite");
    drop(seeded_service_at(&database));

    let connection = Connection::open(&database).unwrap();
    connection
        .execute_batch(
            "CREATE TRIGGER reject_transfer_in
             BEFORE INSERT ON ledger_entries
             WHEN NEW.entry_type = 'transfer_in'
             BEGIN
                 SELECT RAISE(ABORT, 'forced second transfer insert failure');
             END;",
        )
        .unwrap();
    drop(connection);

    let mut service = LedgerService::new(SqliteLedgerRepository::open(&database).unwrap());
    let error = service.transfer(valid_transfer()).unwrap_err();
    assert!(matches!(error, LedgerError::Storage(message) if message.contains("forced second")));
    assert!(
        service
            .entries_page(EntryQuery::default())
            .unwrap()
            .items
            .is_empty()
    );
    drop(service);

    let connection = Connection::open(&database).unwrap();
    let transfer_audits: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM audit_events WHERE record_type = 'transfer'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(transfer_audits, 0);
}

#[test]
fn paired_audit_failure_rolls_back_both_transfer_rows() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("ledger.sqlite");
    let mut seeded = seeded_service_at(&database);
    let mut command = valid_transfer();
    let operation_key = command.operation_key.clone();
    command.content = "x".repeat(1024 * 1024);

    let error = seeded.service.transfer(command).unwrap_err();

    assert!(matches!(error, LedgerError::Storage(message) if message.contains("audit JSON")));
    assert!(
        seeded
            .service
            .entries_page(EntryQuery::default())
            .unwrap()
            .items
            .is_empty()
    );
    drop(seeded);
    let connection = Connection::open(&database).unwrap();
    let transfer_audits: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM audit_events WHERE record_type = 'transfer'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(transfer_audits, 0);
    drop(connection);

    let mut retry = valid_transfer();
    retry.operation_key = operation_key;
    let retry_result = LedgerService::new(SqliteLedgerRepository::open(&database).unwrap())
        .transfer(retry)
        .unwrap();
    assert!(Uuid::parse_str(&retry_result.transfer_group_id).is_ok());
}

#[test]
fn transfer_retries_with_the_same_operation_key_return_the_persisted_result_once() {
    let mut seeded = seeded_service_in_memory();
    let command = valid_transfer();

    let first = seeded.service.transfer(command.clone()).unwrap();
    let second = seeded.service.transfer(command).unwrap();

    assert_eq!(second, first);
    assert_eq!(
        seeded
            .service
            .entries_page(EntryQuery::default())
            .unwrap()
            .items
            .len(),
        2
    );
    assert_eq!(
        seeded
            .service
            .audit_page("transfer", &first.transfer_group_id, Page::default())
            .unwrap()
            .items
            .len(),
        1
    );
}

#[test]
fn transfer_operation_key_rejects_a_different_payload() {
    let mut seeded = seeded_service_in_memory();
    let command = valid_transfer();
    seeded.service.transfer(command.clone()).unwrap();

    let mut changed = command;
    changed.amount = Money::from_minor_units(99_999);
    let error = seeded.service.transfer(changed).unwrap_err();

    assert!(matches!(error, LedgerError::Conflict(message) if message.contains("operation key")));
    assert_eq!(
        seeded
            .service
            .entries_page(EntryQuery::default())
            .unwrap()
            .items
            .len(),
        2
    );
}

#[test]
fn equal_transfer_payloads_with_distinct_operation_keys_are_not_deduplicated() {
    let mut seeded = seeded_service_in_memory();
    let first = valid_transfer();
    let mut second = first.clone();
    second.operation_key =
        TransferOperationKey::parse("10000000-0000-4000-8000-000000000002").unwrap();

    let first = seeded.service.transfer(first).unwrap();
    let second = seeded.service.transfer(second).unwrap();

    assert_ne!(first.transfer_group_id, second.transfer_group_id);
    assert_eq!(
        seeded
            .service
            .entries_page(EntryQuery::default())
            .unwrap()
            .items
            .len(),
        4
    );
}

#[test]
fn concurrent_retries_with_one_operation_key_converge_on_one_transfer() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("ledger.sqlite");
    drop(seeded_service_at(&database));
    let barrier = Arc::new(Barrier::new(2));
    let handles: Vec<_> = (0..2)
        .map(|_| {
            let database = database.clone();
            let barrier = Arc::clone(&barrier);
            std::thread::spawn(move || {
                let mut service =
                    LedgerService::new(SqliteLedgerRepository::open(&database).unwrap());
                barrier.wait();
                service.transfer(valid_transfer())
            })
        })
        .collect();

    let results: Vec<_> = handles
        .into_iter()
        .map(|handle| handle.join().unwrap().unwrap())
        .collect();
    assert_eq!(results[0], results[1]);

    let service = LedgerService::new(SqliteLedgerRepository::open(&database).unwrap());
    assert_eq!(
        service
            .entries_page(EntryQuery::default())
            .unwrap()
            .items
            .len(),
        2
    );
}

#[test]
fn sqlite_rejects_raw_operation_claim_and_transfer_side_collisions() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("ledger.sqlite");
    let mut seeded = seeded_service_at(&database);
    let command = valid_transfer();
    let operation_key = command.operation_key.clone();
    let result = seeded.service.transfer(command).unwrap();
    drop(seeded);

    let connection = Connection::open(&database).unwrap();
    assert!(
        connection
            .execute(
                "INSERT INTO transfer_operations (
                    operation_key, payload_json, result_json, created_at
                 ) VALUES (?1, '{}', '{}', '2026-07-30T00:00:00Z')",
                [operation_key.as_str()],
            )
            .is_err()
    );
    assert!(
        connection
            .execute(
                "INSERT INTO ledger_entries (
                    id, date, written_at, content, transaction_category_id, account_id,
                    entry_type, amount_minor, currency_id, transfer_group_id, source,
                    notes, created_at, updated_at, deleted_at
                 )
                 SELECT
                    '40000000-0000-4000-8000-000000000001', date, written_at, content,
                    transaction_category_id, account_id, entry_type, amount_minor,
                    currency_id, transfer_group_id, source, notes, created_at, updated_at,
                    deleted_at
                 FROM ledger_entries
                 WHERE id = ?1",
                [&result.out_entry_id],
            )
            .is_err()
    );
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
    let krw = service
        .create_currency(CreateCurrency {
            code: "KRW".to_string(),
            name: "Korean won".to_string(),
            symbol: "₩".to_string(),
            decimal_places: 0,
            actor: "seed".to_string(),
        })
        .unwrap();
    let usd = service
        .create_currency(CreateCurrency {
            code: "USD".to_string(),
            name: "US dollar".to_string(),
            symbol: "$".to_string(),
            decimal_places: 2,
            actor: "seed".to_string(),
        })
        .unwrap();
    let cash = service
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
            category: cash.id().to_string(),
            currency: krw.id().to_string(),
            opening_balance: Money::from_minor_units(0),
            actor: "seed".to_string(),
        })
        .unwrap();
    let savings = service
        .create_account(CreateAccount {
            name: "Savings".to_string(),
            category: cash.id().to_string(),
            currency: krw.id().to_string(),
            opening_balance: Money::from_minor_units(0),
            actor: "seed".to_string(),
        })
        .unwrap();
    service
        .create_account(CreateAccount {
            name: "Dollar card".to_string(),
            category: cash.id().to_string(),
            currency: usd.id().to_string(),
            opening_balance: Money::from_minor_units(0),
            actor: "seed".to_string(),
        })
        .unwrap();
    Seeded {
        service,
        krw_id: krw.id().to_string(),
        wallet_id: wallet.id().to_string(),
        savings_id: savings.id().to_string(),
    }
}

fn valid_transfer() -> TransferCommand {
    TransferCommand {
        operation_key: TransferOperationKey::parse("10000000-0000-4000-8000-000000000001").unwrap(),
        date: "2026-07-30".to_string(),
        written_at: datetime!(2026-07-30 09:10:11 UTC),
        content: "Move to savings".to_string(),
        from_account: "Wallet".to_string(),
        to_account: "Savings".to_string(),
        amount: Money::from_minor_units(12_345),
        currency: "KRW".to_string(),
        source: "test".to_string(),
        notes: Some("monthly allocation".to_string()),
        actor: "tester".to_string(),
    }
}
