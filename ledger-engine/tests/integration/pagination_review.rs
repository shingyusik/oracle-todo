use std::collections::HashSet;

use ledger_engine::application::commands::{
    CreateAccount, CreateAccountCategory, CreateCurrency, CreateEntry, CreateTransactionCategory,
    UpdateCurrency,
};
use ledger_engine::application::ports::{EntryQuery, Page, Paged};
use ledger_engine::application::service::LedgerService;
use ledger_engine::domain::{EntryType, Money, TransactionCategoryKind};
use ledger_engine::infrastructure::sqlite::SqliteLedgerRepository;
use time::macros::datetime;

#[test]
fn every_reference_surface_exposes_next_page_and_the_101st_record() {
    let mut service = LedgerService::new(SqliteLedgerRepository::open_in_memory().unwrap());
    for index in 0..101 {
        service
            .create_currency(CreateCurrency {
                code: format!("C{index:03}"),
                name: format!("Currency {index:03}"),
                symbol: index.to_string(),
                decimal_places: 0,
                actor: "test".to_string(),
            })
            .unwrap();
    }
    let first_currency = service.currencies_page(page(0, 100)).unwrap();
    assert_page_boundary(&first_currency, 100, 100);
    let last_currency = service
        .currencies_page(first_currency.next.unwrap())
        .unwrap();
    assert_eq!(last_currency.items.len(), 1);
    assert_eq!(last_currency.items[0].code(), "C100");
    assert_eq!(last_currency.next, None);

    let currency_id = first_currency.items[0].id().to_string();
    for index in 0..101 {
        service
            .create_account_category(CreateAccountCategory {
                name: format!("Account category {index:03}"),
                parent: None,
                liability: false,
                actor: "test".to_string(),
            })
            .unwrap();
    }
    let first_account_category = service.account_categories_page(page(0, 100)).unwrap();
    assert_page_boundary(&first_account_category, 100, 100);
    let last_account_category = service
        .account_categories_page(first_account_category.next.unwrap())
        .unwrap();
    assert_eq!(last_account_category.items.len(), 1);
    assert_eq!(
        last_account_category.items[0].name(),
        "Account category 100"
    );
    assert_eq!(last_account_category.next, None);

    let account_category_id = first_account_category.items[0].id().to_string();
    for index in 0..101 {
        service
            .create_account(CreateAccount {
                name: format!("Account {index:03}"),
                category: account_category_id.clone(),
                currency: currency_id.clone(),
                opening_balance: Money::from_minor_units(0),
                actor: "test".to_string(),
            })
            .unwrap();
    }
    let first_account = service.accounts_page(page(0, 100)).unwrap();
    assert_page_boundary(&first_account, 100, 100);
    let last_account = service.accounts_page(first_account.next.unwrap()).unwrap();
    assert_eq!(last_account.items.len(), 1);
    assert_eq!(last_account.items[0].name(), "Account 100");
    assert_eq!(last_account.next, None);

    for index in 0..101 {
        service
            .create_category(CreateTransactionCategory {
                name: format!("Transaction category {index:03}"),
                parent: None,
                kind: TransactionCategoryKind::Expense,
                actor: "test".to_string(),
            })
            .unwrap();
    }
    let first_category = service.transaction_categories_page(page(0, 100)).unwrap();
    assert_page_boundary(&first_category, 100, 100);
    let last_category = service
        .transaction_categories_page(first_category.next.unwrap())
        .unwrap();
    assert_eq!(last_category.items.len(), 1);
    assert_eq!(last_category.items[0].name(), "Transaction category 100");
    assert_eq!(last_category.next, None);
}

#[test]
fn entries_and_audit_pages_expose_all_101_records_without_silent_truncation() {
    let mut service = basic_service();
    for index in 0..101 {
        service
            .create_entry(CreateEntry {
                date: "2026-07-30".to_string(),
                written_at: datetime!(2026-07-30 01:02:03 UTC),
                content: format!("Entry {index:03}"),
                category: Some("Food".to_string()),
                account: "Wallet".to_string(),
                entry_type: EntryType::Expense,
                amount: Money::from_minor_units(100),
                currency: "KRW".to_string(),
                transfer_group: None,
                source: "test".to_string(),
                notes: None,
                actor: "test".to_string(),
            })
            .unwrap();
    }

    let first_entries = service
        .entries_page(EntryQuery {
            offset: 0,
            limit: 100,
            ..EntryQuery::default()
        })
        .unwrap();
    assert_page_boundary(&first_entries, 100, 100);
    let next = first_entries.next.unwrap();
    let second_entries = service
        .entries_page(EntryQuery {
            offset: next.offset,
            limit: next.limit,
            ..EntryQuery::default()
        })
        .unwrap();
    assert_eq!(second_entries.items.len(), 1);
    assert_eq!(second_entries.next, None);
    let contents = first_entries
        .items
        .iter()
        .chain(&second_entries.items)
        .map(|entry| entry.content())
        .collect::<HashSet<_>>();
    assert_eq!(contents.len(), 101);
    assert!(contents.contains("Entry 100"));

    let currency_id = service.currencies_page(page(0, 1)).unwrap().items[0]
        .id()
        .to_string();
    for index in 0..100 {
        service
            .update_currency(
                &currency_id,
                UpdateCurrency {
                    name: Some(format!("Korean won {index:03}")),
                    actor: "test".to_string(),
                    ..UpdateCurrency::default()
                },
            )
            .unwrap();
    }
    let first_audit = service
        .audit_page("currency", &currency_id, page(0, 100))
        .unwrap();
    assert_page_boundary(&first_audit, 100, 100);
    let last_audit = service
        .audit_page("currency", &currency_id, first_audit.next.unwrap())
        .unwrap();
    assert_eq!(last_audit.items.len(), 1);
    assert_eq!(last_audit.next, None);
    assert_eq!(last_audit.items[0].action, "update");
}

fn assert_page_boundary<T>(result: &Paged<T>, item_count: usize, next_offset: u32) {
    assert_eq!(result.items.len(), item_count);
    assert_eq!(
        result.next,
        Some(Page {
            offset: next_offset,
            limit: 100,
        })
    );
}

fn page(offset: u32, limit: u16) -> Page {
    Page { offset, limit }
}

fn basic_service() -> LedgerService<SqliteLedgerRepository> {
    let mut service = LedgerService::new(SqliteLedgerRepository::open_in_memory().unwrap());
    let currency = service
        .create_currency(CreateCurrency {
            code: "KRW".to_string(),
            name: "Korean won".to_string(),
            symbol: "₩".to_string(),
            decimal_places: 0,
            actor: "test".to_string(),
        })
        .unwrap();
    let account_category = service
        .create_account_category(CreateAccountCategory {
            name: "Cash".to_string(),
            parent: None,
            liability: false,
            actor: "test".to_string(),
        })
        .unwrap();
    service
        .create_account(CreateAccount {
            name: "Wallet".to_string(),
            category: account_category.id().to_string(),
            currency: currency.id().to_string(),
            opening_balance: Money::from_minor_units(0),
            actor: "test".to_string(),
        })
        .unwrap();
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
