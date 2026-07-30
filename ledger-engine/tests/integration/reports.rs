use ledger_engine::application::commands::{
    CreateAccount, CreateAccountCategory, CreateCurrency, CreateEntry, CreateTransactionCategory,
};
use ledger_engine::application::doctor::DoctorSeverity;
use ledger_engine::application::export::ExportOptions;
use ledger_engine::application::reports::{ReportRange, YearMonth};
use ledger_engine::application::service::LedgerService;
use ledger_engine::application::transfers::{TransferCommand, TransferOperationKey};
use ledger_engine::domain::{EntryType, Money, TransactionCategoryKind};
use ledger_engine::infrastructure::sqlite::SqliteLedgerRepository;
use rusqlite::Connection;
use time::macros::{date, datetime};

type TestService = LedgerService<SqliteLedgerRepository>;

#[test]
fn monthly_summary_partitions_currencies_and_uses_type_direction() {
    let mut seeded = seeded_service();
    create_entry(
        &mut seeded.service,
        "2026-07-01",
        "salary",
        "Bank",
        Some("Salary"),
        EntryType::Income,
        3_200_000,
        "KRW",
    );
    create_entry(
        &mut seeded.service,
        "2026-07-02",
        "rent",
        "Bank",
        Some("Food"),
        EntryType::Expense,
        1_900_000,
        "KRW",
    );
    create_entry(
        &mut seeded.service,
        "2026-07-03",
        "book",
        "Dollar card",
        Some("Food"),
        EntryType::Expense,
        2_500,
        "USD",
    );
    let archived = create_entry(
        &mut seeded.service,
        "2026-07-04",
        "archived",
        "Bank",
        Some("Food"),
        EntryType::Expense,
        99_000_000,
        "KRW",
    );
    seeded.service.archive_entry(archived.id()).unwrap();
    seeded
        .service
        .transfer(TransferCommand {
            operation_key: TransferOperationKey::parse("20000000-0000-4000-8000-000000000001")
                .unwrap(),
            date: "2026-07-05".to_string(),
            written_at: datetime!(2026-07-05 12:00 UTC),
            content: "rebalance".to_string(),
            from_account: "Wallet".to_string(),
            to_account: "Bank".to_string(),
            amount: Money::from_minor_units(500_000),
            currency: "KRW".to_string(),
            source: "test".to_string(),
            notes: None,
            actor: "test".to_string(),
        })
        .unwrap();

    let summary = seeded
        .service
        .monthly_summary(YearMonth::new(2026, 7).unwrap())
        .unwrap();

    assert_eq!(summary.currencies.len(), 2);
    assert_eq!(summary.currencies[0].currency_code, "KRW");
    assert_eq!(summary.currencies[0].income_minor, 3_200_000);
    assert_eq!(summary.currencies[0].expense_minor, 1_900_000);
    assert_eq!(summary.currencies[0].net_change_minor, 1_300_000);
    assert_eq!(summary.currencies[1].currency_code, "USD");
    assert_eq!(summary.currencies[1].income_minor, 0);
    assert_eq!(summary.currencies[1].expense_minor, 2_500);
    assert_eq!(summary.currencies[1].net_change_minor, -2_500);
}

#[test]
fn breakdown_comparison_and_briefing_are_deterministically_ordered() {
    let mut seeded = seeded_service();
    create_entry(
        &mut seeded.service,
        "2026-06-10",
        "previous",
        "Bank",
        Some("Food"),
        EntryType::Expense,
        1_000,
        "KRW",
    );
    create_entry(
        &mut seeded.service,
        "2026-07-10",
        "wallet",
        "Wallet",
        Some("Food"),
        EntryType::Expense,
        2_000,
        "KRW",
    );
    create_entry(
        &mut seeded.service,
        "2026-07-11",
        "bank",
        "Bank",
        Some("Food"),
        EntryType::Expense,
        3_000,
        "KRW",
    );

    let range = ReportRange::new(date!(2026 - 07 - 01), date!(2026 - 07 - 31)).unwrap();
    let accounts = seeded.service.account_breakdown(range).unwrap();
    assert_eq!(
        accounts
            .iter()
            .map(|row| (row.name.as_str(), row.expense_minor))
            .collect::<Vec<_>>(),
        vec![("Bank", 3_000), ("Wallet", 2_000)]
    );
    let categories = seeded.service.category_breakdown(range).unwrap();
    assert_eq!(categories.len(), 1);
    assert_eq!(categories[0].name, "Food");
    assert_eq!(categories[0].expense_minor, 5_000);

    let comparison = seeded
        .service
        .compare(
            range,
            ReportRange::new(date!(2026 - 06 - 01), date!(2026 - 06 - 30)).unwrap(),
        )
        .unwrap();
    assert_eq!(comparison.current.currencies[0].expense_minor, 5_000);
    assert_eq!(comparison.previous.currencies[0].expense_minor, 1_000);

    let briefing = seeded.service.briefing(range).unwrap();
    assert_eq!(briefing.summary, comparison.current);
    assert!(briefing.markdown.contains("KRW"));
    assert!(briefing.markdown.contains("5000"));
}

#[test]
fn doctor_detects_transfer_fk_orphan_and_hierarchy_corruption_without_mutating() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("ledger.sqlite");
    let mut seeded = seeded_service_at(&database);
    let transfer = seeded
        .service
        .transfer(TransferCommand {
            operation_key: TransferOperationKey::parse("30000000-0000-4000-8000-000000000001")
                .unwrap(),
            date: "2026-07-05".to_string(),
            written_at: datetime!(2026-07-05 12:00 UTC),
            content: "corrupt me".to_string(),
            from_account: "Wallet".to_string(),
            to_account: "Bank".to_string(),
            amount: Money::from_minor_units(500),
            currency: "KRW".to_string(),
            source: "test".to_string(),
            notes: None,
            actor: "test".to_string(),
        })
        .unwrap();

    let connection = Connection::open(&database).unwrap();
    connection
        .pragma_update(None, "foreign_keys", "OFF")
        .unwrap();
    connection
        .execute(
            "UPDATE ledger_entries SET amount_minor = 501 WHERE id = ?1",
            [&transfer.in_entry_id],
        )
        .unwrap();
    connection
        .execute(
            "UPDATE accounts SET account_category_id = 'missing-category'
             WHERE name = 'Dollar card'",
            [],
        )
        .unwrap();
    connection
        .execute(
            "UPDATE account_categories SET parent_id = id WHERE name = 'Cash'",
            [],
        )
        .unwrap();
    connection
        .execute(
            "UPDATE transfer_operations SET result_json = '{}'
             WHERE operation_key = '30000000-0000-4000-8000-000000000001'",
            [],
        )
        .unwrap();
    drop(connection);

    let before = std::fs::read(&database).unwrap();
    let report = seeded.service.doctor().unwrap();
    let after = std::fs::read(&database).unwrap();

    assert_eq!(before, after);
    assert!(report.issues.iter().any(|issue| {
        issue.code == "transfer_pair_invalid"
            && issue.record_id.as_deref() == Some(transfer.transfer_group_id.as_str())
    }));
    assert!(
        report
            .issues
            .iter()
            .any(|issue| issue.code == "foreign_key_violation")
    );
    assert!(
        report
            .issues
            .iter()
            .any(|issue| issue.code == "orphan_reference")
    );
    assert!(
        report
            .issues
            .iter()
            .any(|issue| issue.code == "hierarchy_cycle")
    );
    assert!(
        report
            .issues
            .iter()
            .any(|issue| issue.code == "transfer_operation_invalid")
    );
    assert!(
        report
            .issues
            .iter()
            .all(|issue| issue.severity != DoctorSeverity::Info)
    );
}

#[test]
fn deterministic_export_is_repeatable_ordered_and_bounded() {
    let mut seeded = seeded_service();
    create_entry(
        &mut seeded.service,
        "2026-07-02",
        "later",
        "Wallet",
        Some("Food"),
        EntryType::Expense,
        200,
        "KRW",
    );
    create_entry(
        &mut seeded.service,
        "2026-07-01",
        "earlier",
        "Wallet",
        Some("Food"),
        EntryType::Expense,
        100,
        "KRW",
    );
    let archived = create_entry(
        &mut seeded.service,
        "2026-07-03",
        "archived",
        "Wallet",
        Some("Food"),
        EntryType::Expense,
        300,
        "KRW",
    );
    seeded.service.archive_entry(archived.id()).unwrap();

    let first = seeded.service.export(ExportOptions::default()).unwrap();
    let second = seeded.service.export(ExportOptions::default()).unwrap();
    let first_json = serde_json::to_string(&first).unwrap();
    let second_json = serde_json::to_string(&second).unwrap();

    assert_eq!(first_json, second_json);
    assert_eq!(first.schema_version, 1);
    assert_eq!(first.entries.len(), 2);
    assert_eq!(first.entries[0].entry.content(), "earlier");
    assert_eq!(first.entries[1].entry.content(), "later");
    assert!(
        first
            .currencies
            .windows(2)
            .all(|pair| pair[0].id() < pair[1].id())
    );
    let with_archived = seeded
        .service
        .export(ExportOptions {
            include_archived: true,
            ..ExportOptions::default()
        })
        .unwrap();
    assert_eq!(with_archived.entries.len(), 3);
    assert!(with_archived.entries[2].entry.is_archived());

    let error = seeded
        .service
        .export(ExportOptions {
            max_records: 1,
            ..ExportOptions::default()
        })
        .unwrap_err();
    assert!(error.to_string().contains("export record limit"));
}

struct Seeded {
    service: TestService,
}

fn seeded_service() -> Seeded {
    Seeded {
        service: seed_repository(SqliteLedgerRepository::open_in_memory().unwrap()),
    }
}

fn seeded_service_at(path: &std::path::Path) -> Seeded {
    Seeded {
        service: seed_repository(SqliteLedgerRepository::open(path).unwrap()),
    }
}

fn seed_repository(repository: SqliteLedgerRepository) -> TestService {
    let mut service = LedgerService::new(repository);
    let krw = service
        .create_currency(CreateCurrency {
            code: "KRW".to_string(),
            name: "Korean won".to_string(),
            symbol: "₩".to_string(),
            decimal_places: 0,
            actor: "test".to_string(),
        })
        .unwrap();
    let usd = service
        .create_currency(CreateCurrency {
            code: "USD".to_string(),
            name: "US dollar".to_string(),
            symbol: "$".to_string(),
            decimal_places: 2,
            actor: "test".to_string(),
        })
        .unwrap();
    let category = service
        .create_account_category(CreateAccountCategory {
            name: "Cash".to_string(),
            parent: None,
            liability: false,
            actor: "test".to_string(),
        })
        .unwrap();
    for (name, currency) in [
        ("Wallet", krw.id()),
        ("Bank", krw.id()),
        ("Dollar card", usd.id()),
    ] {
        service
            .create_account(CreateAccount {
                name: name.to_string(),
                category: category.id().to_string(),
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
        .create_category(CreateTransactionCategory {
            name: "Salary".to_string(),
            parent: None,
            kind: TransactionCategoryKind::Income,
            actor: "test".to_string(),
        })
        .unwrap();
    service
}

#[allow(clippy::too_many_arguments)]
fn create_entry(
    service: &mut TestService,
    date: &str,
    content: &str,
    account: &str,
    category: Option<&str>,
    entry_type: EntryType,
    amount_minor: i64,
    currency: &str,
) -> ledger_engine::domain::LedgerEntry {
    service
        .create_entry(CreateEntry {
            date: date.to_string(),
            written_at: datetime!(2026-07-30 12:00 UTC),
            content: content.to_string(),
            category: category.map(str::to_string),
            account: account.to_string(),
            entry_type,
            amount: Money::from_minor_units(amount_minor),
            currency: currency.to_string(),
            transfer_group: None,
            source: "test".to_string(),
            notes: None,
            actor: "test".to_string(),
        })
        .unwrap()
}
