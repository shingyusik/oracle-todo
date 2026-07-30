use ledger_engine::application::commands::{
    CreateAccount, CreateAccountCategory, CreateCurrency, CreateEntry, CreateTransactionCategory,
};
use ledger_engine::application::error::LedgerError;
use ledger_engine::application::ports::EntryQuery;
use ledger_engine::application::queries::TransferView;
use ledger_engine::application::service::LedgerService;
use ledger_engine::application::transfers::{
    TransferCommand, TransferOperationKey, TransferResult,
};
use ledger_engine::domain::{EntryType, Money, TransactionCategoryKind};
use ledger_engine::infrastructure::sqlite::SqliteLedgerRepository;
use serde::Deserialize;
use time::macros::{date, datetime};

type TestService = LedgerService<SqliteLedgerRepository>;

#[derive(Deserialize)]
struct AppendParityFixture {
    date: String,
    content: String,
    account: String,
    category: String,
    #[serde(rename = "type")]
    entry_type: EntryType,
    amount_minor: i64,
    currency: String,
}

#[test]
fn pinned_name_resolution_fixture_uses_integer_minor_units() {
    let mut service = seeded_service();
    let fixture: AppendParityFixture =
        serde_json::from_str(include_str!("../fixtures/parity/append_with_names.json")).unwrap();
    let entry = service.create_entry(command_from_fixture(fixture)).unwrap();
    assert_eq!(entry.amount().minor_units(), 4_500);
    assert_eq!(entry.entry_type(), EntryType::Expense);

    let unknown: AppendParityFixture = serde_json::from_str(include_str!(
        "../fixtures/parity/append_unknown_currency.json"
    ))
    .unwrap();
    assert!(matches!(
        service.create_entry(command_from_fixture(unknown)),
        Err(LedgerError::NotFound(message)) if message.contains("currency")
    ));
}

#[test]
fn query_filters_before_pagination_with_inclusive_dates_and_resolved_names() {
    let mut service = seeded_service();
    create_entry(
        &mut service,
        "2026-07-01",
        "ÜBER 100%_커피",
        "Wallet",
        "Food",
        4_500,
    );
    create_entry(
        &mut service,
        "2026-07-31",
        "über 100%_커피",
        "Wallet",
        "Food",
        5_500,
    );
    create_entry(
        &mut service,
        "2026-08-01",
        "100xx커피",
        "Wallet",
        "Food",
        6_500,
    );
    create_entry(
        &mut service,
        "2026-07-15",
        "100%_커피",
        "Bank",
        "Food",
        7_500,
    );

    let page = service
        .query_entries(EntryQuery {
            date_from: Some(date!(2026 - 07 - 01)),
            date_to: Some(date!(2026 - 07 - 31)),
            entry_type: Some(EntryType::Expense),
            account: Some("Wallet".to_string()),
            category: Some("Food".to_string()),
            content: Some("über 100%_커피".to_string()),
            offset: 1,
            limit: 1,
            ..EntryQuery::default()
        })
        .unwrap();

    assert_eq!(page.items.len(), 1);
    assert_eq!(page.items[0].entry.content(), "über 100%_커피");
    assert_eq!(page.items[0].account_name.as_deref(), Some("Wallet"));
    assert_eq!(page.items[0].category_name.as_deref(), Some("Food"));
    assert_eq!(page.items[0].currency_code.as_deref(), Some("KRW"));
    assert_eq!(page.next, None);
}

#[test]
fn query_excludes_archived_by_default_and_includes_it_only_when_requested() {
    let mut service = seeded_service();
    let active = create_entry(&mut service, "2026-07-01", "active", "Wallet", "Food", 100);
    let archived = create_entry(
        &mut service,
        "2026-07-02",
        "archived",
        "Wallet",
        "Food",
        200,
    );
    service.archive_entry(archived.id()).unwrap();

    let default_rows = service.query_entries(EntryQuery::default()).unwrap();
    assert_eq!(default_rows.items.len(), 1);
    assert_eq!(default_rows.items[0].entry.id(), active.id());

    let all_rows = service
        .query_entries(EntryQuery {
            include_archived: true,
            ..EntryQuery::default()
        })
        .unwrap();
    assert_eq!(all_rows.items.len(), 2);
    assert!(all_rows.items[1].entry.is_archived());
}

#[test]
fn query_validates_range_and_page_bounds() {
    let service = seeded_service();

    assert!(matches!(
        service.query_entries(EntryQuery {
            date_from: Some(date!(2026 - 08 - 01)),
            date_to: Some(date!(2026 - 07 - 31)),
            ..EntryQuery::default()
        }),
        Err(LedgerError::Validation {
            field: "date_range",
            ..
        })
    ));
    assert!(matches!(
        service.query_entries(EntryQuery {
            limit: 0,
            ..EntryQuery::default()
        }),
        Err(LedgerError::Validation { field: "page", .. })
    ));
    assert!(matches!(
        service.query_entries(EntryQuery {
            limit: 501,
            ..EntryQuery::default()
        }),
        Err(LedgerError::Validation { field: "page", .. })
    ));
}

#[test]
fn transfer_show_returns_a_validated_pair_with_resolved_accounts() {
    let mut service = seeded_service();
    let result = service
        .transfer(TransferCommand {
            operation_key: TransferOperationKey::parse("10000000-0000-4000-8000-000000000001")
                .unwrap(),
            date: "2026-07-30".to_string(),
            written_at: datetime!(2026-07-30 12:00 UTC),
            content: "move cash".to_string(),
            from_account: "Wallet".to_string(),
            to_account: "Bank".to_string(),
            amount: Money::from_minor_units(25_000),
            currency: "KRW".to_string(),
            source: "test".to_string(),
            notes: None,
            actor: "test".to_string(),
        })
        .unwrap();

    let shown = service.show_transfer(&result.transfer_group_id).unwrap();
    assert_transfer(&shown, &result);
}

fn assert_transfer(shown: &TransferView, result: &TransferResult) {
    assert_eq!(shown.transfer_group_id, result.transfer_group_id);
    assert_eq!(shown.out_entry.entry.id(), result.out_entry_id);
    assert_eq!(shown.in_entry.entry.id(), result.in_entry_id);
    assert_eq!(shown.from_account_name.as_deref(), Some("Wallet"));
    assert_eq!(shown.to_account_name.as_deref(), Some("Bank"));
    assert_eq!(shown.amount_minor, 25_000);
    assert_eq!(shown.currency_code.as_deref(), Some("KRW"));
}

fn seeded_service() -> TestService {
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
    for name in ["Wallet", "Bank", "Cash"] {
        service
            .create_account(CreateAccount {
                name: name.to_string(),
                category: account_category.id().to_string(),
                currency: currency.id().to_string(),
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

fn command_from_fixture(fixture: AppendParityFixture) -> CreateEntry {
    CreateEntry {
        date: fixture.date,
        written_at: datetime!(2026-05-31 00:00 UTC),
        content: fixture.content,
        category: Some(fixture.category),
        account: fixture.account,
        entry_type: fixture.entry_type,
        amount: Money::from_minor_units(fixture.amount_minor),
        currency: fixture.currency,
        transfer_group: None,
        source: "fixture".to_string(),
        notes: None,
        actor: "test".to_string(),
    }
}

fn create_entry(
    service: &mut TestService,
    date: &str,
    content: &str,
    account: &str,
    category: &str,
    amount_minor: i64,
) -> ledger_engine::domain::LedgerEntry {
    service
        .create_entry(CreateEntry {
            date: date.to_string(),
            written_at: datetime!(2026-07-30 12:00 UTC),
            content: content.to_string(),
            category: Some(category.to_string()),
            account: account.to_string(),
            entry_type: EntryType::Expense,
            amount: Money::from_minor_units(amount_minor),
            currency: "KRW".to_string(),
            transfer_group: None,
            source: "test".to_string(),
            notes: None,
            actor: "test".to_string(),
        })
        .unwrap()
}
