use crate::application::commands::{
    CreateAccount, CreateAccountCategory, CreateCurrency, CreateEntry, CreateTransactionCategory,
    UpdateEntry,
};
use crate::application::error::LedgerError;
use crate::application::ports::{
    AuditEvent, EntryQuery, LedgerMutationRepository, LedgerTransaction, Page,
};
use crate::application::service::LedgerService;
use crate::domain::{
    Account, AccountCategory, Currency, EntryType, LedgerEntry, LedgerEntryRehydration, Money,
    TransactionCategory, TransactionCategoryKind,
};
use crate::infrastructure::sqlite::SqliteLedgerRepository;
use serde_json::json;
use time::macros::datetime;

#[test]
fn general_update_rejects_every_single_side_transfer_edit_without_mutation_or_audit() {
    let mut service = transfer_pair_service();
    let before_out = service.get_entry("transfer-out").unwrap();
    let before_in = service.get_entry("transfer-in").unwrap();
    let before_audit = service
        .audit_page("ledger_entry", "transfer-out", Page::default())
        .unwrap();

    for update in [
        UpdateEntry {
            amount: Some(Money::from_minor_units(250)),
            actor: "test".to_string(),
            ..UpdateEntry::default()
        },
        UpdateEntry {
            entry_type: Some(EntryType::Expense),
            category: Some(Some("Food".to_string())),
            actor: "test".to_string(),
            ..UpdateEntry::default()
        },
        UpdateEntry {
            account: Some("Bank".to_string()),
            actor: "test".to_string(),
            ..UpdateEntry::default()
        },
        UpdateEntry {
            currency: Some("USD".to_string()),
            actor: "test".to_string(),
            ..UpdateEntry::default()
        },
    ] {
        assert!(matches!(
            service.update_entry("transfer-out", update),
            Err(LedgerError::Validation {
                field: "entry_type",
                ..
            })
        ));
        assert_eq!(service.get_entry("transfer-out").unwrap(), before_out);
        assert_eq!(service.get_entry("transfer-in").unwrap(), before_in);
        assert_eq!(
            service
                .audit_page("ledger_entry", "transfer-out", Page::default())
                .unwrap(),
            before_audit
        );
    }
}

#[test]
fn general_update_rejects_a_non_transfer_row_with_a_historical_transfer_group() {
    let mut repository = seeded_repository();
    let transaction = repository.begin_transaction().unwrap();
    insert_entry(
        transaction,
        "corrupt-group",
        EntryType::Expense,
        Some("category-food"),
        "account-wallet",
        "currency-krw",
        Some("historical-group"),
    );
    let mut service = LedgerService::new(repository);

    assert!(matches!(
        service.update_entry(
            "corrupt-group",
            UpdateEntry {
                content: Some("changed".to_string()),
                actor: "test".to_string(),
                ..UpdateEntry::default()
            }
        ),
        Err(LedgerError::Validation {
            field: "transfer_group",
            ..
        })
    ));
    assert_eq!(
        service.get_entry("corrupt-group").unwrap().content(),
        "Lunch"
    );
    assert!(
        service
            .audit_page("ledger_entry", "corrupt-group", Page::default())
            .unwrap()
            .items
            .is_empty()
    );
}

#[test]
fn entry_create_requires_the_resolved_account_currency() {
    let mut service = compatibility_service();

    let error = service
        .create_entry(create_expense("Wallet", "USD"))
        .unwrap_err();
    assert!(matches!(
        error,
        LedgerError::Validation {
            field: "currency",
            ..
        }
    ));
    assert!(
        service
            .entries_page(EntryQuery::default())
            .unwrap()
            .items
            .is_empty()
    );
}

#[test]
fn entry_update_checks_final_account_and_currency_when_either_is_explicit() {
    let mut service = compatibility_service();
    let entry = service
        .create_entry(create_expense("Wallet", "KRW"))
        .unwrap();

    for update in [
        UpdateEntry {
            account: Some("Bank".to_string()),
            actor: "test".to_string(),
            ..UpdateEntry::default()
        },
        UpdateEntry {
            currency: Some("USD".to_string()),
            actor: "test".to_string(),
            ..UpdateEntry::default()
        },
        UpdateEntry {
            account: Some("Bank".to_string()),
            currency: Some("KRW".to_string()),
            actor: "test".to_string(),
            ..UpdateEntry::default()
        },
    ] {
        assert!(matches!(
            service.update_entry(entry.id(), update),
            Err(LedgerError::Validation {
                field: "currency",
                ..
            })
        ));
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

    let updated = service
        .update_entry(
            entry.id(),
            UpdateEntry {
                account: Some("Bank".to_string()),
                currency: Some("USD".to_string()),
                actor: "test".to_string(),
                reason: Some("move transaction".to_string()),
                ..UpdateEntry::default()
            },
        )
        .unwrap();
    assert_ne!(updated.account_id(), entry.account_id());
    assert_ne!(updated.currency_id(), entry.currency_id());
    assert_eq!(
        service
            .audit_page("ledger_entry", entry.id(), Page::default())
            .unwrap()
            .items
            .len(),
        2
    );
}

#[test]
fn unrelated_update_preserves_an_omitted_historical_currency_mismatch() {
    let mut repository = seeded_repository();
    let transaction = repository.begin_transaction().unwrap();
    insert_entry(
        transaction,
        "historical-mismatch",
        EntryType::Expense,
        Some("category-food"),
        "account-wallet",
        "currency-usd",
        None,
    );
    let mut service = LedgerService::new(repository);

    let updated = service
        .update_entry(
            "historical-mismatch",
            UpdateEntry {
                content: Some("Dinner".to_string()),
                actor: "test".to_string(),
                ..UpdateEntry::default()
            },
        )
        .unwrap();
    assert_eq!(updated.content(), "Dinner");
    assert_eq!(updated.account_id(), "account-wallet");
    assert_eq!(updated.currency_id(), "currency-usd");
}

fn compatibility_service() -> LedgerService<SqliteLedgerRepository> {
    let mut service = LedgerService::new(SqliteLedgerRepository::open_in_memory().unwrap());
    for (code, name, symbol, decimals) in
        [("KRW", "Korean won", "₩", 0), ("USD", "US dollar", "$", 2)]
    {
        service
            .create_currency(CreateCurrency {
                code: code.to_string(),
                name: name.to_string(),
                symbol: symbol.to_string(),
                decimal_places: decimals,
                actor: "test".to_string(),
            })
            .unwrap();
    }
    service
        .create_account_category(CreateAccountCategory {
            name: "Cash".to_string(),
            parent: None,
            liability: false,
            actor: "test".to_string(),
        })
        .unwrap();
    for (name, currency) in [("Wallet", "KRW"), ("Bank", "USD")] {
        service
            .create_account(CreateAccount {
                name: name.to_string(),
                category: "Cash".to_string(),
                currency: currency.to_string(),
                opening_balance: Money::from_minor_units(0),
                actor: "test".to_string(),
            })
            .unwrap();
    }
    service
        .create_category(CreateTransactionCategory {
            name: "Food".to_string(),
            parent: None,
            kind: TransactionCategoryKind::Expense,
            actor: "test".to_string(),
        })
        .unwrap();
    service
}

fn create_expense(account: &str, currency: &str) -> CreateEntry {
    CreateEntry {
        date: "2026-07-30".to_string(),
        written_at: datetime!(2026-07-30 01:02:03 UTC),
        content: "Lunch".to_string(),
        category: Some("Food".to_string()),
        account: account.to_string(),
        entry_type: EntryType::Expense,
        amount: Money::from_minor_units(100),
        currency: currency.to_string(),
        transfer_group: None,
        source: "test".to_string(),
        notes: None,
        actor: "test".to_string(),
    }
}

fn transfer_pair_service() -> LedgerService<SqliteLedgerRepository> {
    let mut repository = seeded_repository();
    let mut transaction = repository.begin_transaction().unwrap();
    let out = raw_entry(
        "transfer-out",
        EntryType::TransferOut,
        None,
        "account-wallet",
        "currency-krw",
        Some("transfer-pair"),
    );
    let incoming = raw_entry(
        "transfer-in",
        EntryType::TransferIn,
        None,
        "account-bank",
        "currency-krw",
        Some("transfer-pair"),
    );
    transaction.insert_entry(&out).unwrap();
    transaction.insert_entry(&incoming).unwrap();
    transaction
        .insert_audit_event(&AuditEvent {
            id: "audit-transfer-out".to_string(),
            occurred_at: datetime!(2026-07-30 01:02:03 UTC),
            actor: "seed".to_string(),
            action: "create".to_string(),
            record_type: "ledger_entry".to_string(),
            record_id: out.id().to_string(),
            before: None,
            after: Some(json!({"id": out.id()})),
            reason: None,
        })
        .unwrap();
    transaction.commit().unwrap();
    LedgerService::new(repository)
}

fn seeded_repository() -> SqliteLedgerRepository {
    let mut repository = SqliteLedgerRepository::open_in_memory().unwrap();
    let mut transaction = repository.begin_transaction().unwrap();
    let now = datetime!(2026-07-30 01:02:03 UTC);
    for currency in [
        Currency::new("currency-krw", "KRW", "Korean won", "₩", 0).unwrap(),
        Currency::new("currency-usd", "USD", "US dollar", "$", 2).unwrap(),
    ] {
        transaction.upsert_currency(&currency, now).unwrap();
    }
    transaction
        .upsert_account_category(
            &AccountCategory::new("account-category-cash", "Cash", None, false).unwrap(),
            now,
        )
        .unwrap();
    for account in [
        Account::new(
            "account-wallet",
            "Wallet",
            "account-category-cash",
            "currency-krw",
            Money::from_minor_units(0),
        )
        .unwrap(),
        Account::new(
            "account-bank",
            "Bank",
            "account-category-cash",
            "currency-krw",
            Money::from_minor_units(0),
        )
        .unwrap(),
    ] {
        transaction.upsert_account(&account, now).unwrap();
    }
    transaction
        .upsert_transaction_category(
            &TransactionCategory::new(
                "category-food",
                "Food",
                None,
                TransactionCategoryKind::Expense,
            )
            .unwrap(),
            now,
        )
        .unwrap();
    transaction.commit().unwrap();
    repository
}

fn insert_entry(
    mut transaction: Box<dyn LedgerTransaction + '_>,
    id: &str,
    entry_type: EntryType,
    category: Option<&str>,
    account: &str,
    currency: &str,
    transfer_group: Option<&str>,
) {
    let entry = raw_entry(id, entry_type, category, account, currency, transfer_group);
    transaction.insert_entry(&entry).unwrap();
    transaction.commit().unwrap();
}

fn raw_entry(
    id: &str,
    entry_type: EntryType,
    category: Option<&str>,
    account: &str,
    currency: &str,
    transfer_group: Option<&str>,
) -> LedgerEntry {
    LedgerEntry::rehydrate(LedgerEntryRehydration {
        id: id.to_string(),
        date: "2026-07-30".to_string(),
        written_at: datetime!(2026-07-30 01:02:03 UTC),
        content: "Lunch".to_string(),
        transaction_category_id: category.map(str::to_string),
        account_id: account.to_string(),
        entry_type,
        amount: Money::from_minor_units(100),
        currency_id: currency.to_string(),
        transfer_group_id: transfer_group.map(str::to_string),
        source: "test".to_string(),
        notes: None,
        created_at: datetime!(2026-07-30 01:02:03 UTC),
        updated_at: datetime!(2026-07-30 01:02:03 UTC),
        deleted_at: None,
    })
    .unwrap()
}
