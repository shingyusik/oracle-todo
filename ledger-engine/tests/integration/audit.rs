use ledger_engine::application::commands::{
    CreateAccount, CreateAccountCategory, CreateCurrency, CreateEntry, CreateTransactionCategory,
    UpdateAccount, UpdateAccountCategory, UpdateCurrency, UpdateEntry, UpdateTransactionCategory,
};
use ledger_engine::application::error::LedgerError;
use ledger_engine::application::ports::{EntryQuery, Page};
use ledger_engine::application::service::LedgerService;
use ledger_engine::domain::{EntryType, Money, TransactionCategoryKind};
use ledger_engine::infrastructure::sqlite::SqliteLedgerRepository;
use serde_json::json;
use time::macros::datetime;
use uuid::Uuid;

#[test]
fn create_audit_contains_exact_after_snapshot_identity_and_timestamp() {
    let mut service = seeded_service();
    let entry = service.create_entry(valid_expense("Lunch")).unwrap();
    let events = service
        .audit_page("ledger_entry", entry.id(), Page::default())
        .unwrap()
        .items;

    assert_eq!(events.len(), 1);
    let event = &events[0];
    assert!(Uuid::parse_str(&event.id).is_ok());
    assert_eq!(event.action, "create");
    assert_eq!(event.actor, "tester");
    assert_eq!(event.record_type, "ledger_entry");
    assert_eq!(event.record_id, entry.id());
    assert_eq!(event.occurred_at, entry.created_at());
    assert_eq!(event.before, None);
    assert_eq!(event.after, Some(serde_json::to_value(&entry).unwrap()));
    assert_eq!(event.reason, None);
    assert_eq!(event.after.as_ref().unwrap()["amount"], json!(12_500));
    assert_eq!(
        event.after.as_ref().unwrap()["entry_type"],
        json!("expense")
    );
}

#[test]
fn update_audit_contains_before_and_after_snapshots_and_reason() {
    let mut service = seeded_service();
    let entry = service.create_entry(valid_expense("Lunch")).unwrap();
    let updated = service
        .update_entry(
            entry.id(),
            UpdateEntry {
                content: Some("Dinner".to_string()),
                notes: Some(Some("corrected".to_string())),
                actor: "reviewer".to_string(),
                reason: Some("receipt correction".to_string()),
                ..UpdateEntry::default()
            },
        )
        .unwrap();
    let events = service
        .audit_page("ledger_entry", entry.id(), Page::default())
        .unwrap()
        .items;

    assert_eq!(events.len(), 2);
    let event = &events[1];
    assert_eq!(event.action, "update");
    assert_eq!(event.actor, "reviewer");
    assert_eq!(event.occurred_at, updated.updated_at());
    assert_eq!(event.before, Some(serde_json::to_value(&entry).unwrap()));
    assert_eq!(event.after, Some(serde_json::to_value(&updated).unwrap()));
    assert_eq!(event.reason.as_deref(), Some("receipt correction"));
}

#[test]
fn audit_failure_rolls_back_the_entry_write() {
    let mut service = seeded_service();
    let command = valid_expense(&"x".repeat(1024 * 1024));

    let error = service.create_entry(command).unwrap_err();
    assert!(matches!(error, LedgerError::Storage(message) if message.contains("audit JSON")));
    assert!(
        service
            .entries_page(EntryQuery::default())
            .unwrap()
            .items
            .is_empty()
    );
}

#[test]
fn update_audit_failure_rolls_back_to_the_before_snapshot() {
    let mut service = seeded_service();
    let entry = service.create_entry(valid_expense("Lunch")).unwrap();

    let error = service
        .update_entry(
            entry.id(),
            UpdateEntry {
                content: Some("x".repeat(1024 * 1024)),
                actor: "reviewer".to_string(),
                reason: Some("force audit failure".to_string()),
                ..UpdateEntry::default()
            },
        )
        .unwrap_err();

    assert!(matches!(error, LedgerError::Storage(message) if message.contains("audit JSON")));
    assert_eq!(service.get_entry(entry.id()).unwrap(), entry);
    assert_eq!(
        service
            .audit_page("ledger_entry", entry.id(), Page::default())
            .unwrap()
            .items
            .len(),
        1
    );
}

#[test]
fn every_master_create_writes_an_audit_event() {
    let mut service = LedgerService::new(SqliteLedgerRepository::open_in_memory().unwrap());
    let currency = service
        .create_currency(CreateCurrency {
            code: "KRW".to_string(),
            name: "Korean won".to_string(),
            symbol: "₩".to_string(),
            decimal_places: 0,
            actor: "seed".to_string(),
        })
        .unwrap();
    let account_category = service
        .create_account_category(CreateAccountCategory {
            name: "Cash".to_string(),
            parent: None,
            liability: false,
            actor: "seed".to_string(),
        })
        .unwrap();
    let account = service
        .create_account(CreateAccount {
            name: "Wallet".to_string(),
            category: account_category.id().to_string(),
            currency: currency.id().to_string(),
            opening_balance: Money::from_minor_units(0),
            actor: "seed".to_string(),
        })
        .unwrap();
    let category = service
        .create_category(CreateTransactionCategory {
            name: "Food".to_string(),
            parent: None,
            kind: TransactionCategoryKind::Expense,
            actor: "seed".to_string(),
        })
        .unwrap();

    for (record_type, record_id) in [
        ("currency", currency.id()),
        ("account_category", account_category.id()),
        ("account", account.id()),
        ("transaction_category", category.id()),
    ] {
        let events = service
            .audit_page(record_type, record_id, Page::default())
            .unwrap()
            .items;
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].action, "create");
        assert_eq!(events[0].before, None);
        assert!(events[0].after.is_some());
    }
}

#[test]
fn every_master_partial_update_writes_before_and_after_audit() {
    let mut service = LedgerService::new(SqliteLedgerRepository::open_in_memory().unwrap());
    let currency = service
        .create_currency(CreateCurrency {
            code: "KRW".to_string(),
            name: "Korean won".to_string(),
            symbol: "₩".to_string(),
            decimal_places: 0,
            actor: "seed".to_string(),
        })
        .unwrap();
    let account_category = service
        .create_account_category(CreateAccountCategory {
            name: "Cash".to_string(),
            parent: None,
            liability: false,
            actor: "seed".to_string(),
        })
        .unwrap();
    let account = service
        .create_account(CreateAccount {
            name: "Wallet".to_string(),
            category: account_category.id().to_string(),
            currency: currency.id().to_string(),
            opening_balance: Money::from_minor_units(0),
            actor: "seed".to_string(),
        })
        .unwrap();
    let category = service
        .create_category(CreateTransactionCategory {
            name: "Food".to_string(),
            parent: None,
            kind: TransactionCategoryKind::Expense,
            actor: "seed".to_string(),
        })
        .unwrap();

    service
        .update_currency(
            currency.id(),
            UpdateCurrency {
                symbol: Some("KRW".to_string()),
                actor: "editor".to_string(),
                reason: Some("normalize symbol".to_string()),
                ..UpdateCurrency::default()
            },
        )
        .unwrap();
    service
        .update_account_category(
            account_category.id(),
            UpdateAccountCategory {
                liability: Some(true),
                actor: "editor".to_string(),
                reason: Some("correct classification".to_string()),
                ..UpdateAccountCategory::default()
            },
        )
        .unwrap();
    service
        .update_account(
            account.id(),
            UpdateAccount {
                name: Some("Main wallet".to_string()),
                actor: "editor".to_string(),
                reason: Some("clarify name".to_string()),
                ..UpdateAccount::default()
            },
        )
        .unwrap();
    service
        .update_category(
            category.id(),
            UpdateTransactionCategory {
                name: Some("Meals".to_string()),
                actor: "editor".to_string(),
                reason: Some("rename category".to_string()),
                ..UpdateTransactionCategory::default()
            },
        )
        .unwrap();

    for (record_type, record_id) in [
        ("currency", currency.id()),
        ("account_category", account_category.id()),
        ("account", account.id()),
        ("transaction_category", category.id()),
    ] {
        let events = service
            .audit_page(record_type, record_id, Page::default())
            .unwrap()
            .items;
        assert_eq!(events.len(), 2);
        assert_eq!(events[1].action, "update");
        assert_eq!(events[1].actor, "editor");
        assert!(events[1].before.is_some());
        assert!(events[1].after.is_some());
        assert_ne!(events[1].before, events[1].after);
        assert!(events[1].reason.is_some());
    }
}

fn seeded_service() -> LedgerService<SqliteLedgerRepository> {
    let mut service = LedgerService::new(SqliteLedgerRepository::open_in_memory().unwrap());
    let currency = service
        .create_currency(CreateCurrency {
            code: "KRW".to_string(),
            name: "Korean won".to_string(),
            symbol: "₩".to_string(),
            decimal_places: 0,
            actor: "seed".to_string(),
        })
        .unwrap();
    let account_category = service
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
            category: account_category.id().to_string(),
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
    service
}

fn valid_expense(content: &str) -> CreateEntry {
    CreateEntry {
        date: "2026-07-30".to_string(),
        written_at: datetime!(2026-07-30 01:02:03 UTC),
        content: content.to_string(),
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
