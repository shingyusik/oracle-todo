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
use rusqlite::{Connection, params};
use serde::Deserialize;
use time::macros::{date, datetime};
use uuid::{Uuid, Version};

type TestService = LedgerService<SqliteLedgerRepository>;

#[derive(Clone, Deserialize)]
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

#[derive(Deserialize)]
struct CurrencyParityFixture {
    id: String,
    code: String,
    name: String,
    symbol: String,
    decimal_places: u8,
    active: bool,
}

#[derive(Deserialize)]
struct AccountCategoryParityFixture {
    id: String,
    name: String,
    parent_id: Option<String>,
    liability: bool,
    active: bool,
}

#[derive(Deserialize)]
struct AccountParityFixture {
    id: String,
    name: String,
    account_category_id: String,
    currency_id: String,
    opening_balance_minor: i64,
    active: bool,
}

#[derive(Deserialize)]
struct TransactionCategoryParityFixture {
    id: String,
    name: String,
    parent_id: Option<String>,
    kind: TransactionCategoryKind,
    active: bool,
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
fn all_pinned_parity_fixtures_execute_against_the_service_boundary() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("ledger.sqlite");
    drop(SqliteLedgerRepository::open(&database).unwrap());
    let currencies: Vec<CurrencyParityFixture> =
        serde_json::from_str(include_str!("../fixtures/parity/currencies.json")).unwrap();
    let account_categories: Vec<AccountCategoryParityFixture> =
        serde_json::from_str(include_str!("../fixtures/parity/account_categories.json")).unwrap();
    let accounts: Vec<AccountParityFixture> =
        serde_json::from_str(include_str!("../fixtures/parity/accounts.json")).unwrap();
    let transaction_categories: Vec<TransactionCategoryParityFixture> = serde_json::from_str(
        include_str!("../fixtures/parity/transaction_categories.json"),
    )
    .unwrap();
    let connection = Connection::open(&database).unwrap();
    for currency in currencies {
        connection
            .execute(
                "INSERT INTO currencies (
                     id, code, name, symbol, decimal_places, active, created_at, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
                params![
                    currency.id,
                    currency.code,
                    currency.name,
                    currency.symbol,
                    currency.decimal_places,
                    i64::from(currency.active),
                    "2026-05-31T00:00:00Z",
                ],
            )
            .unwrap();
    }
    for category in account_categories {
        connection
            .execute(
                "INSERT INTO account_categories (
                     id, name, parent_id, liability, active, created_at, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
                params![
                    category.id,
                    category.name,
                    category.parent_id,
                    i64::from(category.liability),
                    i64::from(category.active),
                    "2026-05-31T00:00:00Z",
                ],
            )
            .unwrap();
    }
    for account in accounts {
        connection
            .execute(
                "INSERT INTO accounts (
                     id, name, account_category_id, currency_id, opening_balance_minor,
                     active, created_at, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
                params![
                    account.id,
                    account.name,
                    account.account_category_id,
                    account.currency_id,
                    account.opening_balance_minor,
                    i64::from(account.active),
                    "2026-05-31T00:00:00Z",
                ],
            )
            .unwrap();
    }
    for category in transaction_categories {
        connection
            .execute(
                "INSERT INTO transaction_categories (
                     id, name, parent_id, kind, active, created_at, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
                params![
                    category.id,
                    category.name,
                    category.parent_id,
                    match category.kind {
                        TransactionCategoryKind::Expense => "expense",
                        TransactionCategoryKind::Income => "income",
                    },
                    i64::from(category.active),
                    "2026-05-31T00:00:00Z",
                ],
            )
            .unwrap();
    }
    drop(connection);

    let mut service = LedgerService::new(SqliteLedgerRepository::open(&database).unwrap());
    let fixture: AppendParityFixture =
        serde_json::from_str(include_str!("../fixtures/parity/append_with_names.json")).unwrap();
    let entry = service
        .create_entry(command_from_fixture(fixture.clone()))
        .unwrap();
    let parsed_id = Uuid::parse_str(entry.id()).unwrap();
    assert_eq!(parsed_id.get_version(), Some(Version::Random));
    assert_eq!(entry.account_id(), "asset_cash");
    assert_eq!(entry.transaction_category_id(), Some("cat_food"));
    assert_eq!(entry.currency_id(), "cur_krw");
    assert_eq!(
        Connection::open(&database)
            .unwrap()
            .query_row(
                "SELECT typeof(amount_minor) FROM ledger_entries WHERE id = ?1",
                [entry.id()],
                |row| row.get::<_, String>(0),
            )
            .unwrap(),
        "integer"
    );

    for (field, value) in [
        ("account", "Inactive Asset"),
        ("category", "Inactive Category"),
        ("currency", "ZZZ"),
    ] {
        let mut inactive = fixture.clone();
        match field {
            "account" => inactive.account = value.to_string(),
            "category" => inactive.category = value.to_string(),
            "currency" => inactive.currency = value.to_string(),
            _ => unreachable!(),
        }
        assert!(matches!(
            service.create_entry(command_from_fixture(inactive)),
            Err(LedgerError::NotFound(_))
        ));
    }

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
fn content_query_uses_unicode_nfkc_casefold_equivalence() {
    let mut service = seeded_service();
    create_entry(
        &mut service,
        "2026-07-01",
        "Straße café",
        "Wallet",
        "Food",
        100,
    );

    let sharp_s = service
        .query_entries(EntryQuery {
            content: Some("STRASSE".to_string()),
            ..EntryQuery::default()
        })
        .unwrap();
    assert_eq!(sharp_s.items.len(), 1);
    assert_eq!(sharp_s.items[0].entry.content(), "Straße café");

    let decomposed = service
        .query_entries(EntryQuery {
            content: Some("cafe\u{301}".to_string()),
            ..EntryQuery::default()
        })
        .unwrap();
    assert_eq!(decomposed.items.len(), 1);
    assert_eq!(decomposed.items[0].entry.content(), "Straße café");
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
