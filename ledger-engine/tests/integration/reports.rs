use ledger_engine::application::commands::{
    CreateAccount, CreateAccountCategory, CreateCurrency, CreateEntry, CreateTransactionCategory,
    UpdateAccount, UpdateEntry,
};
use ledger_engine::application::doctor::{DoctorOptions, DoctorSeverity};
use ledger_engine::application::error::LedgerError;
use ledger_engine::application::export::ExportOptions;
use ledger_engine::application::ports::Page;
use ledger_engine::application::reports::{ReportPeriod, ReportRange, TrendGranularity, YearMonth};
use ledger_engine::application::service::LedgerService;
use ledger_engine::application::transfers::{TransferCommand, TransferOperationKey};
use ledger_engine::domain::{EntryType, Money, TransactionCategoryKind};
use ledger_engine::infrastructure::sqlite::SqliteLedgerRepository;
use rusqlite::Connection;
use time::format_description::well_known::Rfc3339;
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
fn report_periods_derive_the_immediately_preceding_inclusive_range() {
    assert_eq!(
        ReportPeriod::CurrentMonth
            .comparison_ranges(date!(2026 - 03 - 15))
            .unwrap(),
        (
            ReportRange::new(date!(2026 - 03 - 01), date!(2026 - 03 - 31)).unwrap(),
            ReportRange::new(date!(2026 - 02 - 01), date!(2026 - 02 - 28)).unwrap(),
        )
    );
    assert_eq!(
        ReportPeriod::PreviousMonth
            .comparison_ranges(date!(2026 - 03 - 15))
            .unwrap(),
        (
            ReportRange::new(date!(2026 - 02 - 01), date!(2026 - 02 - 28)).unwrap(),
            ReportRange::new(date!(2026 - 01 - 01), date!(2026 - 01 - 31)).unwrap(),
        )
    );
    assert_eq!(
        ReportPeriod::CurrentYear
            .comparison_ranges(date!(2024 - 08 - 15))
            .unwrap(),
        (
            ReportRange::new(date!(2024 - 01 - 01), date!(2024 - 12 - 31)).unwrap(),
            ReportRange::new(date!(2023 - 01 - 01), date!(2023 - 12 - 31)).unwrap(),
        )
    );
    assert_eq!(
        ReportPeriod::Custom(
            ReportRange::new(date!(2024 - 03 - 01), date!(2024 - 03 - 03)).unwrap()
        )
        .comparison_ranges(date!(2026 - 03 - 15))
        .unwrap(),
        (
            ReportRange::new(date!(2024 - 03 - 01), date!(2024 - 03 - 03)).unwrap(),
            ReportRange::new(date!(2024 - 02 - 27), date!(2024 - 02 - 29)).unwrap(),
        )
    );
}

#[test]
fn report_period_and_trend_boundaries_remain_calendar_aligned() {
    for (period, current, previous) in [
        (
            ReportPeriod::CurrentMonth,
            ReportRange::new(date!(2026 - 01 - 01), date!(2026 - 01 - 31)).unwrap(),
            ReportRange::new(date!(2025 - 12 - 01), date!(2025 - 12 - 31)).unwrap(),
        ),
        (
            ReportPeriod::PreviousMonth,
            ReportRange::new(date!(2025 - 12 - 01), date!(2025 - 12 - 31)).unwrap(),
            ReportRange::new(date!(2025 - 11 - 01), date!(2025 - 11 - 30)).unwrap(),
        ),
    ] {
        assert_eq!(
            period.comparison_ranges(date!(2026 - 01 - 15)).unwrap(),
            (current, previous)
        );
    }

    let mut seeded = seeded_service();
    for (end, expected) in [
        (date!(2026 - 03 - 03), TrendGranularity::Daily),
        (date!(2026 - 03 - 04), TrendGranularity::Weekly),
        (date!(2026 - 06 - 29), TrendGranularity::Weekly),
        (date!(2026 - 06 - 30), TrendGranularity::Monthly),
    ] {
        assert_eq!(
            seeded
                .service
                .trend(ReportRange::new(date!(2026 - 01 - 01), end).unwrap(), None,)
                .unwrap()
                .granularity,
            expected
        );
    }

    create_entry(
        &mut seeded.service,
        "2026-01-10",
        "january expense",
        "Bank",
        Some("Food"),
        EntryType::Expense,
        100,
        "KRW",
    );
    create_entry(
        &mut seeded.service,
        "2026-02-10",
        "february income",
        "Bank",
        Some("Salary"),
        EntryType::Income,
        300,
        "KRW",
    );
    let archived = create_entry(
        &mut seeded.service,
        "2026-01-20",
        "archived expense",
        "Bank",
        Some("Food"),
        EntryType::Expense,
        999,
        "KRW",
    );
    seeded.service.archive_entry(archived.id()).unwrap();

    let monthly = seeded
        .service
        .trend(
            ReportRange::new(date!(2026 - 01 - 01), date!(2026 - 02 - 28)).unwrap(),
            Some(TrendGranularity::Monthly),
        )
        .unwrap();
    assert_eq!(monthly.currencies[0].points[0].expense_minor, 100);
    assert_eq!(monthly.currencies[0].points[1].income_minor, 300);
}

#[test]
fn comparison_aligns_currencies_missing_from_either_period_with_zeroes() {
    let mut seeded = seeded_service();
    create_entry(
        &mut seeded.service,
        "2026-06-10",
        "previous won",
        "Bank",
        Some("Food"),
        EntryType::Expense,
        1_000,
        "KRW",
    );
    create_entry(
        &mut seeded.service,
        "2026-07-10",
        "current dollars",
        "Dollar card",
        Some("Food"),
        EntryType::Expense,
        2_500,
        "USD",
    );

    let comparison = seeded
        .service
        .compare(
            ReportRange::new(date!(2026 - 07 - 01), date!(2026 - 07 - 31)).unwrap(),
            ReportRange::new(date!(2026 - 06 - 01), date!(2026 - 06 - 30)).unwrap(),
        )
        .unwrap();

    assert_eq!(comparison.currencies.len(), 2);
    assert_eq!(comparison.currencies[0].currency_code, "KRW");
    assert_eq!(comparison.currencies[0].current.expense_minor, 0);
    assert_eq!(comparison.currencies[0].previous.expense_minor, 1_000);
    assert_eq!(comparison.currencies[1].currency_code, "USD");
    assert_eq!(comparison.currencies[1].current.expense_minor, 2_500);
    assert_eq!(comparison.currencies[1].previous.expense_minor, 0);
}

#[test]
fn trend_separates_currencies_and_zero_fills_inclusive_daily_points() {
    let mut seeded = seeded_service();
    create_entry(
        &mut seeded.service,
        "2026-07-01",
        "won income",
        "Bank",
        Some("Salary"),
        EntryType::Income,
        3_000,
        "KRW",
    );
    create_entry(
        &mut seeded.service,
        "2026-07-03",
        "won expense",
        "Bank",
        Some("Food"),
        EntryType::Expense,
        1_000,
        "KRW",
    );
    create_entry(
        &mut seeded.service,
        "2026-07-02",
        "dollar expense",
        "Dollar card",
        Some("Food"),
        EntryType::Expense,
        500,
        "USD",
    );

    let trend = seeded
        .service
        .trend(
            ReportRange::new(date!(2026 - 07 - 01), date!(2026 - 07 - 03)).unwrap(),
            Some(TrendGranularity::Daily),
        )
        .unwrap();

    assert_eq!(trend.granularity, TrendGranularity::Daily);
    assert_eq!(trend.currencies.len(), 2);
    assert_eq!(trend.currencies[0].currency_code, "KRW");
    assert_eq!(trend.currencies[0].points.len(), 3);
    assert_eq!(trend.currencies[0].points[0].income_minor, 3_000);
    assert_eq!(trend.currencies[0].points[1].income_minor, 0);
    assert_eq!(trend.currencies[0].points[2].expense_minor, 1_000);
    assert_eq!(trend.currencies[1].currency_code, "USD");
    assert_eq!(trend.currencies[1].points[1].expense_minor, 500);
}

#[test]
fn trend_uses_clipped_calendar_buckets_auto_granularity_and_empty_series() {
    let mut seeded = seeded_service();
    create_entry(
        &mut seeded.service,
        "2026-01-31",
        "january",
        "Bank",
        Some("Food"),
        EntryType::Expense,
        100,
        "KRW",
    );
    create_entry(
        &mut seeded.service,
        "2026-02-02",
        "monday",
        "Bank",
        Some("Salary"),
        EntryType::Income,
        300,
        "KRW",
    );

    let weekly = seeded
        .service
        .trend(
            ReportRange::new(date!(2026 - 01 - 31), date!(2026 - 02 - 08)).unwrap(),
            Some(TrendGranularity::Weekly),
        )
        .unwrap();
    assert_eq!(weekly.currencies[0].points[0].start, date!(2026 - 01 - 31));
    assert_eq!(weekly.currencies[0].points[0].end, date!(2026 - 02 - 01));
    assert_eq!(weekly.currencies[0].points[1].start, date!(2026 - 02 - 02));
    assert_eq!(weekly.currencies[0].points[1].end, date!(2026 - 02 - 08));

    let automatic = seeded
        .service
        .trend(
            ReportRange::new(date!(2026 - 01 - 01), date!(2026 - 12 - 31)).unwrap(),
            None,
        )
        .unwrap();
    assert_eq!(automatic.granularity, TrendGranularity::Monthly);
    assert_eq!(automatic.currencies[0].points.len(), 12);

    let empty = seeded
        .service
        .trend(
            ReportRange::new(date!(2025 - 01 - 01), date!(2025 - 01 - 31)).unwrap(),
            None,
        )
        .unwrap();
    assert!(empty.currencies.is_empty());
}

#[test]
fn trend_allows_366_buckets_and_rejects_367_before_reading_entries() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("ledger.sqlite");
    let seeded = seeded_service_at(&database);
    let maximum = ReportRange::new(date!(2024 - 01 - 01), date!(2024 - 12 - 31)).unwrap();
    assert!(
        seeded
            .service
            .trend(maximum, Some(TrendGranularity::Daily))
            .is_ok()
    );

    let connection = Connection::open(&database).unwrap();
    connection
        .execute(
            "ALTER TABLE ledger_entries RENAME TO blocked_ledger_entries",
            [],
        )
        .unwrap();
    drop(connection);

    let over_limit = ReportRange::new(date!(2024 - 01 - 01), date!(2025 - 01 - 01)).unwrap();
    assert!(matches!(
        seeded
            .service
            .trend(over_limit, Some(TrendGranularity::Daily)),
        Err(LedgerError::Validation {
            field: "date_range",
            ..
        })
    ));
}

#[test]
fn trend_rejects_directly_constructed_invalid_ranges() {
    let seeded = seeded_service();
    assert!(matches!(
        seeded.service.trend(
            ReportRange {
                start: date!(2026 - 07 - 02),
                end: date!(2026 - 07 - 01),
            },
            Some(TrendGranularity::Daily),
        ),
        Err(LedgerError::Validation {
            field: "date_range",
            ..
        })
    ));
}

#[test]
fn account_balances_include_opening_and_signed_live_movements_by_currency() {
    let mut seeded = seeded_service();
    let opening = seeded
        .service
        .accounts_page(Page {
            offset: 0,
            limit: 20,
        })
        .unwrap()
        .items
        .into_iter()
        .find(|account| account.name() == "Wallet")
        .unwrap();
    seeded
        .service
        .update_account(
            opening.id(),
            ledger_engine::application::commands::UpdateAccount {
                opening_balance: Some(Money::from_minor_units(1_000)),
                actor: "test".to_string(),
                ..Default::default()
            },
        )
        .unwrap();
    create_entry(
        &mut seeded.service,
        "2026-07-01",
        "expense",
        "Wallet",
        Some("Food"),
        EntryType::Expense,
        100,
        "KRW",
    );
    create_entry(
        &mut seeded.service,
        "2026-07-02",
        "income",
        "Wallet",
        Some("Salary"),
        EntryType::Income,
        300,
        "KRW",
    );
    create_entry(
        &mut seeded.service,
        "2026-07-03",
        "adjust out",
        "Wallet",
        None,
        EntryType::AdjustmentOut,
        50,
        "KRW",
    );
    let archived = create_entry(
        &mut seeded.service,
        "2026-07-04",
        "archived income",
        "Wallet",
        Some("Salary"),
        EntryType::Income,
        99_999,
        "KRW",
    );
    seeded.service.archive_entry(archived.id()).unwrap();
    seeded
        .service
        .transfer(TransferCommand {
            operation_key: TransferOperationKey::parse("40000000-0000-4000-8000-000000000001")
                .unwrap(),
            date: "2026-07-05".to_string(),
            written_at: datetime!(2026-07-05 12:00 UTC),
            content: "wallet to bank".to_string(),
            from_account: "Wallet".to_string(),
            to_account: "Bank".to_string(),
            amount: Money::from_minor_units(200),
            currency: "KRW".to_string(),
            source: "test".to_string(),
            notes: None,
            actor: "test".to_string(),
        })
        .unwrap();

    let balances = seeded
        .service
        .account_balances_page(Page {
            offset: 0,
            limit: 20,
        })
        .unwrap();
    assert_eq!(
        balances
            .items
            .iter()
            .map(|row| {
                (
                    row.account.name().to_string(),
                    row.currency_code.clone(),
                    row.current_balance_minor,
                )
            })
            .collect::<Vec<_>>(),
        vec![
            ("Bank".to_string(), "KRW".to_string(), 200),
            ("Dollar card".to_string(), "USD".to_string(), 0),
            ("Wallet".to_string(), "KRW".to_string(), 950),
        ]
    );
    assert_eq!(balances.next, None);
}

#[test]
fn summary_streams_more_than_one_hundred_thousand_entries() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("ledger.sqlite");
    let seeded = seeded_service_at(&database);
    let account = seeded
        .service
        .accounts_page(Page {
            offset: 0,
            limit: 20,
        })
        .unwrap()
        .items
        .into_iter()
        .find(|account| account.name() == "Wallet")
        .unwrap();
    let currency = seeded
        .service
        .currencies_page(Page {
            offset: 0,
            limit: 20,
        })
        .unwrap()
        .items
        .into_iter()
        .find(|currency| currency.code() == "KRW")
        .unwrap();
    let connection = Connection::open(&database).unwrap();
    connection
        .execute(
            "WITH RECURSIVE sequence(number) AS (
                 VALUES(1)
                 UNION ALL
                 SELECT number + 1 FROM sequence WHERE number < 100001
             )
             INSERT INTO ledger_entries (
                 id, date, written_at, content, transaction_category_id, account_id,
                 entry_type, amount_minor, currency_id, transfer_group_id, source, notes,
                 created_at, updated_at, deleted_at
             )
             SELECT
                 printf('bulk-%06d', number), '2026-07-10',
                 '2026-07-10T12:00:00Z', 'bulk', NULL, ?1,
                 'adjustment_out', 1, ?2, NULL, 'fixture', NULL,
                 '2026-07-10T12:00:00Z', '2026-07-10T12:00:00Z', NULL
             FROM sequence",
            [account.id(), currency.id()],
        )
        .unwrap();
    drop(connection);

    let summary = seeded
        .service
        .summary(ReportRange::new(date!(2026 - 07 - 01), date!(2026 - 07 - 31)).unwrap())
        .unwrap();
    assert_eq!(summary.currencies.len(), 1);
    assert_eq!(summary.currencies[0].entry_count, 100_001);
    assert_eq!(summary.currencies[0].net_change_minor, -100_001);
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
fn doctor_has_no_false_positives_for_valid_mutation_history() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("ledger.sqlite");
    let mut seeded = seeded_service_at(&database);
    let entry = create_entry(
        &mut seeded.service,
        "2026-07-01",
        "valid",
        "Wallet",
        Some("Food"),
        EntryType::Expense,
        100,
        "KRW",
    );
    seeded.service.archive_entry(entry.id()).unwrap();
    seeded.service.restore_entry(entry.id()).unwrap();
    seeded
        .service
        .transfer(TransferCommand {
            operation_key: TransferOperationKey::parse("60000000-0000-4000-8000-000000000001")
                .unwrap(),
            date: "2026-07-02".to_string(),
            written_at: datetime!(2026-07-02 12:00 UTC),
            content: "valid transfer".to_string(),
            from_account: "Wallet".to_string(),
            to_account: "Bank".to_string(),
            amount: Money::from_minor_units(200),
            currency: "KRW".to_string(),
            source: "test".to_string(),
            notes: None,
            actor: "test".to_string(),
        })
        .unwrap();
    let connection = Connection::open(&database).unwrap();
    connection
        .execute(
            "UPDATE audit_events SET occurred_at = '2026-07-30T12:00:00Z'",
            [],
        )
        .unwrap();
    drop(connection);

    let report = seeded.service.doctor().unwrap();

    assert!(report.healthy, "{:#?}", report.issues);
    assert!(report.issues.is_empty());
    assert!(report.scanned_records > report.scanned_entries);
    assert!(report.scans.iter().all(|scan| !scan.truncated));
}

#[test]
fn doctor_accepts_renamed_transfer_and_service_lifecycle_through_terminal_purge() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("ledger.sqlite");
    let mut seeded = seeded_service_at(&database);
    let transfer = seeded
        .service
        .transfer(TransferCommand {
            operation_key: TransferOperationKey::parse("61000000-0000-4000-8000-000000000001")
                .unwrap(),
            date: "2026-07-02".to_string(),
            written_at: datetime!(2026-07-02 12:00 UTC),
            content: "lifecycle transfer".to_string(),
            from_account: "Wallet".to_string(),
            to_account: "Bank".to_string(),
            amount: Money::from_minor_units(200),
            currency: "KRW".to_string(),
            source: "test".to_string(),
            notes: None,
            actor: "test".to_string(),
        })
        .unwrap();
    let wallet = seeded
        .service
        .accounts_page(Page::default())
        .unwrap()
        .items
        .into_iter()
        .find(|account| account.name() == "Wallet")
        .unwrap();
    seeded
        .service
        .update_account(
            wallet.id(),
            UpdateAccount {
                name: Some("Renamed wallet".to_string()),
                actor: "test".to_string(),
                ..UpdateAccount::default()
            },
        )
        .unwrap();

    let renamed = seeded.service.doctor().unwrap();
    assert!(renamed.healthy, "{:#?}", renamed.issues);

    seeded
        .service
        .archive_entry(&transfer.out_entry_id)
        .unwrap();
    let archived = seeded.service.doctor().unwrap();
    assert!(archived.healthy, "{:#?}", archived.issues);

    seeded
        .service
        .restore_entry(&transfer.out_entry_id)
        .unwrap();
    let restored = seeded.service.doctor().unwrap();
    assert!(restored.healthy, "{:#?}", restored.issues);

    seeded
        .service
        .purge_entry(&transfer.out_entry_id, &transfer.transfer_group_id)
        .unwrap();
    let purged = seeded.service.doctor().unwrap();
    assert!(purged.healthy, "{:#?}", purged.issues);
}

#[test]
fn doctor_rejects_update_before_create_and_terminal_action_violations() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("ledger.sqlite");
    let seeded = seeded_service_at(&database);
    let connection = Connection::open(&database).unwrap();
    let (currency_id, snapshot): (String, String) = connection
        .query_row(
            "SELECT record_id, after_json
             FROM audit_events
             WHERE record_type = 'currency' AND action = 'create'
             ORDER BY rowid LIMIT 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    connection
        .execute(
            "INSERT INTO audit_events (
                 id, occurred_at, actor, action, record_type, record_id,
                 before_json, after_json, reason
             ) VALUES (
                 'forged-update-before-create', '2000-01-01T00:00:00Z', 'fixture',
                 'update', 'currency', ?1, ?2, ?2, NULL
             )",
            rusqlite::params![currency_id, snapshot],
        )
        .unwrap();
    drop(connection);

    let report = seeded.service.doctor().unwrap();

    assert!(report.issues.iter().any(|issue| {
        issue.code == "audit_transition_invalid"
            && issue.record_id.as_deref() == Some(currency_id.as_str())
    }));
}

#[test]
fn doctor_rejects_master_archive_and_restore_actions() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("ledger.sqlite");
    let seeded = seeded_service_at(&database);
    let connection = Connection::open(&database).unwrap();
    let (currency_id, snapshot): (String, String) = connection
        .query_row(
            "SELECT record_id, after_json
             FROM audit_events
             WHERE record_type = 'currency' AND action = 'create'
             ORDER BY rowid LIMIT 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    let snapshot = serde_json::from_str(&snapshot).unwrap();
    insert_raw_audit(
        &connection,
        "forged-master-archive",
        "2099-01-01T00:00:00Z",
        "archive",
        "currency",
        &currency_id,
        Some(&snapshot),
        Some(&snapshot),
    );
    insert_raw_audit(
        &connection,
        "forged-master-restore",
        "2099-01-02T00:00:00Z",
        "restore",
        "currency",
        &currency_id,
        Some(&snapshot),
        Some(&snapshot),
    );
    drop(connection);

    let report = seeded.service.doctor().unwrap();
    let transition_messages = report
        .issues
        .iter()
        .filter(|issue| {
            issue.code == "audit_transition_invalid"
                && issue.record_id.as_deref() == Some(currency_id.as_str())
        })
        .map(|issue| issue.message.as_str())
        .collect::<Vec<_>>();

    assert!(
        transition_messages
            .iter()
            .any(|message| message.contains("archive")),
        "{:#?}",
        report.issues
    );
    assert!(
        transition_messages
            .iter()
            .any(|message| message.contains("restore")),
        "{:#?}",
        report.issues
    );
}

#[test]
fn doctor_rejects_entry_lifecycle_noops_and_reverse_directions() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("ledger.sqlite");
    let mut seeded = seeded_service_at(&database);

    let no_op_archive = create_entry(
        &mut seeded.service,
        "2026-07-01",
        "no-op archive",
        "Wallet",
        Some("Food"),
        EntryType::Expense,
        100,
        "KRW",
    );
    let no_op_restore = create_entry(
        &mut seeded.service,
        "2026-07-01",
        "no-op restore",
        "Wallet",
        Some("Food"),
        EntryType::Expense,
        100,
        "KRW",
    );
    seeded.service.archive_entry(no_op_restore.id()).unwrap();
    let reverse_restore = create_entry(
        &mut seeded.service,
        "2026-07-01",
        "reverse restore",
        "Wallet",
        Some("Food"),
        EntryType::Expense,
        100,
        "KRW",
    );
    let reverse_archive = create_entry(
        &mut seeded.service,
        "2026-07-01",
        "reverse archive",
        "Wallet",
        Some("Food"),
        EntryType::Expense,
        100,
        "KRW",
    );

    let connection = Connection::open(&database).unwrap();
    let active_no_op = latest_audit_after(&connection, "ledger_entry", no_op_archive.id());
    insert_raw_audit(
        &connection,
        "forged-entry-no-op-archive",
        "2099-01-01T00:00:00Z",
        "archive",
        "ledger_entry",
        no_op_archive.id(),
        Some(&active_no_op),
        Some(&active_no_op),
    );

    let archived_no_op = latest_audit_after(&connection, "ledger_entry", no_op_restore.id());
    insert_raw_audit(
        &connection,
        "forged-entry-no-op-restore",
        "2099-01-01T00:00:01Z",
        "restore",
        "ledger_entry",
        no_op_restore.id(),
        Some(&archived_no_op),
        Some(&archived_no_op),
    );

    let reverse_restore_active =
        latest_audit_after(&connection, "ledger_entry", reverse_restore.id());
    let mut reverse_restore_archived = reverse_restore_active.clone();
    reverse_restore_archived["updated_at"] =
        serde_json::Value::String("2099-01-02T00:00:00Z".to_string());
    reverse_restore_archived["deleted_at"] =
        serde_json::Value::String("2099-01-02T00:00:00Z".to_string());
    connection
        .execute(
            "UPDATE ledger_entries
             SET updated_at = '2099-01-02T00:00:00Z',
                 deleted_at = '2099-01-02T00:00:00Z'
             WHERE id = ?1",
            [reverse_restore.id()],
        )
        .unwrap();
    insert_raw_audit(
        &connection,
        "forged-entry-pre-reverse-restore",
        "2099-01-01T23:59:59Z",
        "archive",
        "ledger_entry",
        reverse_restore.id(),
        Some(&reverse_restore_active),
        Some(&reverse_restore_active),
    );
    insert_raw_audit(
        &connection,
        "forged-entry-reverse-restore",
        "2099-01-02T00:00:00Z",
        "restore",
        "ledger_entry",
        reverse_restore.id(),
        Some(&reverse_restore_active),
        Some(&reverse_restore_archived),
    );

    let reverse_archive_active =
        latest_audit_after(&connection, "ledger_entry", reverse_archive.id());
    let mut reverse_archive_archived = reverse_archive_active.clone();
    reverse_archive_archived["updated_at"] =
        serde_json::Value::String("2099-01-03T00:00:00Z".to_string());
    reverse_archive_archived["deleted_at"] =
        serde_json::Value::String("2099-01-03T00:00:00Z".to_string());
    let mut reverse_archive_final = reverse_archive_active.clone();
    reverse_archive_final["updated_at"] =
        serde_json::Value::String("2099-01-05T00:00:00Z".to_string());
    connection
        .execute(
            "UPDATE ledger_entries
             SET updated_at = '2099-01-05T00:00:00Z', deleted_at = NULL
             WHERE id = ?1",
            [reverse_archive.id()],
        )
        .unwrap();
    insert_raw_audit(
        &connection,
        "forged-entry-valid-archive-before-reverse",
        "2099-01-03T00:00:00Z",
        "archive",
        "ledger_entry",
        reverse_archive.id(),
        Some(&reverse_archive_active),
        Some(&reverse_archive_archived),
    );
    insert_raw_audit(
        &connection,
        "forged-entry-no-op-restore-before-reverse",
        "2099-01-04T00:00:00Z",
        "restore",
        "ledger_entry",
        reverse_archive.id(),
        Some(&reverse_archive_archived),
        Some(&reverse_archive_archived),
    );
    insert_raw_audit(
        &connection,
        "forged-entry-reverse-archive",
        "2099-01-05T00:00:00Z",
        "archive",
        "ledger_entry",
        reverse_archive.id(),
        Some(&reverse_archive_archived),
        Some(&reverse_archive_final),
    );
    drop(connection);

    let report = seeded.service.doctor().unwrap();
    for id in [
        no_op_archive.id(),
        no_op_restore.id(),
        reverse_restore.id(),
        reverse_archive.id(),
    ] {
        assert!(
            report.issues.iter().any(|issue| {
                issue.code == "audit_transition_invalid" && issue.record_id.as_deref() == Some(id)
            }),
            "missing lifecycle transition issue for {id}: {:#?}",
            report.issues
        );
    }
}

#[test]
fn doctor_accepts_service_entry_update_archive_restore_and_purge() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("ledger.sqlite");
    let mut seeded = seeded_service_at(&database);
    let entry = create_entry(
        &mut seeded.service,
        "2026-07-01",
        "valid entry lifecycle",
        "Wallet",
        Some("Food"),
        EntryType::Expense,
        100,
        "KRW",
    );
    seeded
        .service
        .update_entry(
            entry.id(),
            UpdateEntry {
                content: Some("updated entry lifecycle".to_string()),
                actor: "test".to_string(),
                ..UpdateEntry::default()
            },
        )
        .unwrap();
    seeded.service.archive_entry(entry.id()).unwrap();
    seeded.service.restore_entry(entry.id()).unwrap();
    seeded.service.purge_entry(entry.id(), entry.id()).unwrap();

    let report = seeded.service.doctor().unwrap();

    assert!(report.healthy, "{:#?}", report.issues);
    assert!(report.issues.is_empty());
}

#[test]
fn doctor_rejects_transfer_noop_and_single_side_lifecycle_snapshots() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("ledger.sqlite");
    let mut seeded = seeded_service_at(&database);
    let no_op = seeded
        .service
        .transfer(TransferCommand {
            operation_key: TransferOperationKey::parse("62000000-0000-4000-8000-000000000001")
                .unwrap(),
            date: "2026-07-02".to_string(),
            written_at: datetime!(2026-07-02 12:00 UTC),
            content: "no-op transfer lifecycle".to_string(),
            from_account: "Wallet".to_string(),
            to_account: "Bank".to_string(),
            amount: Money::from_minor_units(200),
            currency: "KRW".to_string(),
            source: "test".to_string(),
            notes: None,
            actor: "test".to_string(),
        })
        .unwrap();
    let single_side = seeded
        .service
        .transfer(TransferCommand {
            operation_key: TransferOperationKey::parse("62000000-0000-4000-8000-000000000002")
                .unwrap(),
            date: "2026-07-03".to_string(),
            written_at: datetime!(2026-07-03 12:00 UTC),
            content: "single-side transfer lifecycle".to_string(),
            from_account: "Wallet".to_string(),
            to_account: "Bank".to_string(),
            amount: Money::from_minor_units(300),
            currency: "KRW".to_string(),
            source: "test".to_string(),
            notes: None,
            actor: "test".to_string(),
        })
        .unwrap();

    let connection = Connection::open(&database).unwrap();
    let no_op_snapshot = latest_audit_after(&connection, "transfer", &no_op.transfer_group_id);
    insert_raw_audit(
        &connection,
        "forged-transfer-no-op-archive",
        "2099-01-01T00:00:00Z",
        "archive",
        "transfer",
        &no_op.transfer_group_id,
        Some(&no_op_snapshot),
        Some(&no_op_snapshot),
    );

    let single_side_before =
        latest_audit_after(&connection, "transfer", &single_side.transfer_group_id);
    let mut single_side_after = single_side_before.clone();
    single_side_after["out_entry"]["updated_at"] =
        serde_json::Value::String("2099-01-02T00:00:00Z".to_string());
    single_side_after["out_entry"]["deleted_at"] =
        serde_json::Value::String("2099-01-02T00:00:00Z".to_string());
    insert_raw_audit(
        &connection,
        "forged-transfer-single-side-archive",
        "2099-01-02T00:00:00Z",
        "archive",
        "transfer",
        &single_side.transfer_group_id,
        Some(&single_side_before),
        Some(&single_side_after),
    );
    drop(connection);

    let report = seeded.service.doctor().unwrap();
    for group_id in [
        no_op.transfer_group_id.as_str(),
        single_side.transfer_group_id.as_str(),
    ] {
        assert!(
            report.issues.iter().any(|issue| {
                issue.code == "audit_transition_invalid"
                    && issue.record_id.as_deref() == Some(group_id)
            }),
            "missing transfer lifecycle issue for {group_id}: {:#?}",
            report.issues
        );
    }
}

#[test]
fn doctor_rejects_forged_entry_category_kind_and_hierarchy_kind() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("ledger.sqlite");
    let mut seeded = seeded_service_at(&database);
    let entry = create_entry(
        &mut seeded.service,
        "2026-07-01",
        "forged category",
        "Wallet",
        Some("Food"),
        EntryType::Expense,
        100,
        "KRW",
    );
    let connection = Connection::open(&database).unwrap();
    drop_audit_mutation_triggers(&connection);
    let income_id: String = connection
        .query_row(
            "SELECT id FROM transaction_categories WHERE name = 'Salary'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let expense_id: String = connection
        .query_row(
            "SELECT id FROM transaction_categories WHERE name = 'Food'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    connection
        .execute(
            "UPDATE ledger_entries SET transaction_category_id = ?1 WHERE id = ?2",
            [&income_id, entry.id()],
        )
        .unwrap();
    connection
        .execute(
            "UPDATE audit_events
             SET after_json = json_set(after_json, '$.transaction_category_id', ?1)
             WHERE record_type = 'ledger_entry' AND record_id = ?2",
            [&income_id, entry.id()],
        )
        .unwrap();
    connection
        .execute(
            "UPDATE transaction_categories SET parent_id = ?1 WHERE id = ?2",
            [&income_id, &expense_id],
        )
        .unwrap();
    connection
        .execute(
            "UPDATE audit_events
             SET after_json = json_set(after_json, '$.parent_id', ?1)
             WHERE record_type = 'transaction_category' AND record_id = ?2",
            [&income_id, &expense_id],
        )
        .unwrap();
    drop(connection);

    let report = seeded.service.doctor().unwrap();

    assert!(report.issues.iter().any(|issue| {
        issue.code == "entry_category_invalid" && issue.record_id.as_deref() == Some(entry.id())
    }));
    assert!(report.issues.iter().any(|issue| {
        issue.code == "hierarchy_kind_mismatch"
            && issue.record_id.as_deref() == Some(expense_id.as_str())
    }));
}

#[test]
fn doctor_reports_missing_and_non_terminal_orphan_audit_histories() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("ledger.sqlite");
    let seeded = seeded_service_at(&database);
    let connection = Connection::open(&database).unwrap();
    drop_audit_mutation_triggers(&connection);
    let missing_id: String = connection
        .query_row("SELECT id FROM currencies WHERE code = 'USD'", [], |row| {
            row.get(0)
        })
        .unwrap();
    connection
        .execute(
            "DELETE FROM audit_events
             WHERE record_type = 'currency' AND record_id = ?1",
            [&missing_id],
        )
        .unwrap();
    connection
        .execute(
            "INSERT INTO audit_events (
                 id, occurred_at, actor, action, record_type, record_id,
                 before_json, after_json, reason
             ) VALUES (
                 'orphan-create', '2026-07-30T12:00:00Z', 'fixture', 'create',
                 'currency', 'missing-currency', NULL,
                 '{\"id\":\"missing-currency\",\"code\":\"XXX\",\"name\":\"Missing\",\"symbol\":\"?\",\"decimal_places\":0,\"active\":true}',
                 NULL
             )",
            [],
        )
        .unwrap();
    drop(connection);

    let report = seeded.service.doctor().unwrap();

    assert!(report.issues.iter().any(|issue| {
        issue.code == "audit_missing" && issue.record_id.as_deref() == Some(missing_id.as_str())
    }));
    assert!(report.issues.iter().any(|issue| {
        issue.code == "audit_orphan" && issue.record_id.as_deref() == Some("missing-currency")
    }));
}

#[test]
fn doctor_scans_every_signed_rowid_including_i64_minimum() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("ledger.sqlite");
    let seeded = seeded_service_at(&database);
    let connection = Connection::open(&database).unwrap();
    for (rowid, id, code) in [
        (i64::MIN, "negative-min-currency", "NMN"),
        (-1, "negative-currency", "NEG"),
        (0, "zero-currency", "ZER"),
    ] {
        connection
            .execute(
                "INSERT INTO currencies (
                     rowid, id, code, name, symbol, decimal_places, active,
                     created_at, updated_at
                 ) VALUES (?1, ?2, ?3, ?3, '?', 0, 1, ?4, ?4)",
                rusqlite::params![rowid, id, code, "2026-07-30T12:00:00Z"],
            )
            .unwrap();
    }
    drop(connection);

    let report = seeded.service.doctor().unwrap();
    let currency_scan = report
        .scans
        .iter()
        .find(|scan| scan.table == "currencies")
        .unwrap();

    assert_eq!(currency_scan.scanned_records, 5);
    for id in [
        "negative-min-currency",
        "negative-currency",
        "zero-currency",
    ] {
        assert!(report.issues.iter().any(|issue| {
            issue.code == "audit_missing" && issue.record_id.as_deref() == Some(id)
        }));
    }
}

#[test]
fn doctor_tiny_budgets_report_unknown_coverage_without_false_corruption() {
    for options in [
        DoctorOptions {
            max_records: 1,
            max_bytes: 8 * 1024 * 1024,
        },
        DoctorOptions {
            max_records: 10_000,
            max_bytes: 1,
        },
    ] {
        let seeded = seeded_service();
        let report = seeded.service.doctor_with_options(options).unwrap();

        assert!(report.issues.iter().any(|issue| {
            matches!(
                issue.code.as_str(),
                "doctor_scan_truncated" | "doctor_coverage_incomplete"
            )
        }));
        assert!(
            report
                .issues
                .iter()
                .all(|issue| issue.severity != DoctorSeverity::Error),
            "{:#?}",
            report.issues
        );
    }
}

#[test]
fn doctor_reports_malformed_master_and_audit_json_without_aborting() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("ledger.sqlite");
    let seeded = seeded_service_at(&database);
    let connection = Connection::open(&database).unwrap();
    connection
        .execute("UPDATE currencies SET name = '' WHERE code = 'KRW'", [])
        .unwrap();
    let audit_triggers = connection
        .prepare(
            "SELECT name FROM sqlite_master
             WHERE type = 'trigger' AND tbl_name = 'audit_events'",
        )
        .unwrap()
        .query_map([], |row| row.get::<_, String>(0))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    for trigger in audit_triggers {
        connection
            .execute_batch(&format!(
                "DROP TRIGGER \"{}\"",
                trigger.replace('"', "\"\"")
            ))
            .unwrap();
    }
    connection
        .execute(
            "UPDATE audit_events SET after_json = '{'
             WHERE record_type = 'currency' AND record_id = (
                 SELECT id FROM currencies WHERE code = 'KRW'
             )",
            [],
        )
        .unwrap();
    drop(connection);

    let report = seeded.service.doctor().unwrap();

    assert!(report.issues.iter().any(|issue| {
        issue.code == "record_invariant_invalid" && issue.record_type == "currency"
    }));
    assert!(
        report.issues.iter().any(|issue| {
            issue.code == "audit_json_invalid" && issue.record_type == "audit_event"
        })
    );
}

#[test]
fn doctor_truncates_large_keyset_scan_with_cursor_and_counts() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("ledger.sqlite");
    let seeded = seeded_service_at(&database);
    let account = seeded
        .service
        .accounts_page(Page {
            offset: 0,
            limit: 20,
        })
        .unwrap()
        .items
        .into_iter()
        .find(|account| account.name() == "Wallet")
        .unwrap();
    let currency = seeded
        .service
        .currencies_page(Page {
            offset: 0,
            limit: 20,
        })
        .unwrap()
        .items
        .into_iter()
        .find(|currency| currency.code() == "KRW")
        .unwrap();
    let connection = Connection::open(&database).unwrap();
    connection
        .execute(
            "WITH RECURSIVE sequence(number) AS (
                 VALUES(1)
                 UNION ALL
                 SELECT number + 1 FROM sequence WHERE number < 100001
             )
             INSERT INTO ledger_entries (
                 id, date, written_at, content, transaction_category_id, account_id,
                 entry_type, amount_minor, currency_id, transfer_group_id, source, notes,
                 created_at, updated_at, deleted_at
             )
             SELECT
                 printf('doctor-bulk-%06d', number), '2026-07-10',
                 '2026-07-10T12:00:00Z', 'bulk', NULL, ?1,
                 'adjustment_out', 1, ?2, NULL, 'fixture', NULL,
                 '2026-07-10T12:00:00Z', '2026-07-10T12:00:00Z', NULL
             FROM sequence",
            [account.id(), currency.id()],
        )
        .unwrap();
    drop(connection);

    let report = seeded
        .service
        .doctor_with_options(DoctorOptions {
            max_records: 1_000,
            max_bytes: 8 * 1024 * 1024,
        })
        .unwrap();
    let entries_scan = report
        .scans
        .iter()
        .find(|scan| scan.table == "ledger_entries")
        .unwrap();

    assert_eq!(report.scanned_records, 1_000);
    assert!(entries_scan.truncated);
    assert!(entries_scan.cursor.is_some_and(|cursor| cursor > 0));
    assert!(entries_scan.next_unscanned_rowid.is_some());
    assert!(report.issues.iter().any(|issue| {
        issue.code == "doctor_scan_truncated" && issue.record_type == "ledger_entries"
    }));
}

#[test]
fn doctor_byte_budget_truncates_before_large_audit_payload_decode() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("ledger.sqlite");
    let seeded = seeded_service_at(&database);
    let connection = Connection::open(&database).unwrap();
    let large_json = serde_json::to_string(&"x".repeat(256 * 1024)).unwrap();
    connection
        .execute(
            "UPDATE audit_events SET after_json = ?1
             WHERE id = (SELECT id FROM audit_events ORDER BY id LIMIT 1)",
            [&large_json],
        )
        .unwrap();
    drop(connection);

    let report = seeded
        .service
        .doctor_with_options(DoctorOptions {
            max_records: 10_000,
            max_bytes: 8 * 1024,
        })
        .unwrap();

    assert!(report.scanned_bytes <= 8 * 1024);
    assert!(report.issues.iter().any(|issue| {
        issue.code == "doctor_scan_truncated" && issue.record_type == "audit_events"
    }));
}

#[test]
fn doctor_checks_transfer_operations_and_create_audits_in_both_directions() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("ledger.sqlite");
    let mut seeded = seeded_service_at(&database);
    let transfer = seeded
        .service
        .transfer(TransferCommand {
            operation_key: TransferOperationKey::parse("70000000-0000-4000-8000-000000000001")
                .unwrap(),
            date: "2026-07-02".to_string(),
            written_at: datetime!(2026-07-02 12:00 UTC),
            content: "bidirectional".to_string(),
            from_account: "Wallet".to_string(),
            to_account: "Bank".to_string(),
            amount: Money::from_minor_units(200),
            currency: "KRW".to_string(),
            source: "test".to_string(),
            notes: None,
            actor: "test".to_string(),
        })
        .unwrap();
    let connection = Connection::open(&database).unwrap();
    let operation = connection
        .query_row(
            "SELECT payload_json, result_json, created_at
             FROM transfer_operations WHERE operation_key = ?1",
            ["70000000-0000-4000-8000-000000000001"],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .unwrap();
    connection
        .execute(
            "DELETE FROM transfer_operations WHERE operation_key = ?1",
            ["70000000-0000-4000-8000-000000000001"],
        )
        .unwrap();
    let missing = seeded.service.doctor().unwrap();
    assert!(missing.issues.iter().any(|issue| {
        issue.code == "transfer_operation_count_invalid"
            && issue.record_id.as_deref() == Some(transfer.transfer_group_id.as_str())
    }));

    connection
        .execute(
            "INSERT INTO transfer_operations (
                 operation_key, payload_json, result_json, created_at
             ) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![
                "70000000-0000-4000-8000-000000000001",
                operation.0,
                operation.1,
                operation.2,
            ],
        )
        .unwrap();
    let mut changed_payload: serde_json::Value = serde_json::from_str(&operation.0).unwrap();
    changed_payload["content"] = serde_json::Value::String("different".to_string());
    connection
        .execute(
            "UPDATE transfer_operations SET payload_json = ?1 WHERE operation_key = ?2",
            rusqlite::params![
                serde_json::to_string(&changed_payload).unwrap(),
                "70000000-0000-4000-8000-000000000001",
            ],
        )
        .unwrap();
    let mismatched = seeded.service.doctor().unwrap();
    assert!(mismatched.issues.iter().any(|issue| {
        issue.code == "transfer_operation_invalid"
            && issue
                .message
                .contains("payload does not match the persisted pair")
    }));
    connection
        .execute(
            "UPDATE transfer_operations SET payload_json = ?1 WHERE operation_key = ?2",
            rusqlite::params![operation.0, "70000000-0000-4000-8000-000000000001",],
        )
        .unwrap();
    connection
        .execute(
            "INSERT INTO audit_events (
                 id, occurred_at, actor, action, record_type, record_id,
                 before_json, after_json, reason
             )
             SELECT
                 'duplicate-transfer-create', occurred_at, actor, action, record_type,
                 record_id, before_json, after_json, reason
             FROM audit_events
             WHERE record_type = 'transfer' AND action = 'create' AND record_id = ?1",
            [&transfer.transfer_group_id],
        )
        .unwrap();
    drop(connection);

    let duplicated = seeded.service.doctor().unwrap();
    assert!(duplicated.issues.iter().any(|issue| {
        issue.code == "transfer_create_audit_count_invalid"
            && issue.record_id.as_deref() == Some(transfer.transfer_group_id.as_str())
    }));
}

#[test]
fn deterministic_export_is_repeatable_ordered_and_bounded() {
    let mut seeded = seeded_service();
    seeded
        .service
        .transfer(TransferCommand {
            operation_key: TransferOperationKey::parse("50000000-0000-4000-8000-000000000001")
                .unwrap(),
            date: "2026-07-04".to_string(),
            written_at: datetime!(2026-07-04 12:00 UTC),
            content: "exported operation".to_string(),
            from_account: "Wallet".to_string(),
            to_account: "Bank".to_string(),
            amount: Money::from_minor_units(50),
            currency: "KRW".to_string(),
            source: "test".to_string(),
            notes: Some("durable".to_string()),
            actor: "test".to_string(),
        })
        .unwrap();
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
    assert_eq!(first.schema_version, 3);
    assert!(!first.restore_capable);
    assert_eq!(first.entries.len(), 4);
    assert_eq!(first.entries[0].entry.content(), "earlier");
    assert_eq!(first.entries[1].entry.content(), "later");
    assert_eq!(first.transfer_operations.len(), 1);
    assert_eq!(
        first.transfer_operations[0].operation_key,
        "50000000-0000-4000-8000-000000000001"
    );
    assert!(
        first.transfer_operations[0]
            .payload_json
            .contains("\"content\":\"exported operation\"")
    );
    assert!(
        first.transfer_operations[0]
            .result_json
            .contains("\"transfer_group_id\"")
    );
    assert!(!first.transfer_operations[0].created_at.is_empty());
    assert!(!first.currencies[0].created_at.is_empty());
    assert!(!first.currencies[0].updated_at.is_empty());
    let audit_order = first
        .audit_events
        .iter()
        .map(|event| (event.occurred_at.format(&Rfc3339).unwrap(), event.sequence))
        .collect::<Vec<_>>();
    assert!(audit_order.windows(2).all(|pair| pair[0] <= pair[1]));
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
    assert!(with_archived.restore_capable);
    assert_eq!(with_archived.entries.len(), 5);
    assert!(with_archived.entries[2].entry.is_archived());

    let error = seeded
        .service
        .export(ExportOptions {
            max_records: 1,
            ..ExportOptions::default()
        })
        .unwrap_err();
    assert!(error.to_string().contains("export record limit"));

    let byte_error = seeded
        .service
        .export(ExportOptions {
            max_bytes: 128,
            ..ExportOptions::default()
        })
        .unwrap_err();
    assert!(byte_error.to_string().contains("export byte limit"));
}

#[test]
fn export_accepts_the_exact_emitted_byte_cap_and_rejects_cap_minus_one() {
    let mut seeded = seeded_service();
    create_entry(
        &mut seeded.service,
        "2026-07-02",
        "exact byte budget",
        "Wallet",
        Some("Food"),
        EntryType::Expense,
        200,
        "KRW",
    );
    let baseline = seeded
        .service
        .export(ExportOptions {
            include_archived: true,
            ..ExportOptions::default()
        })
        .unwrap();
    let exact_bytes = serde_json::to_vec(&baseline).unwrap().len();

    let exact = seeded
        .service
        .export(ExportOptions {
            include_archived: true,
            max_bytes: exact_bytes,
            ..ExportOptions::default()
        })
        .unwrap();
    assert_eq!(serde_json::to_vec(&exact).unwrap().len(), exact_bytes);

    let error = seeded
        .service
        .export(ExportOptions {
            include_archived: true,
            max_bytes: exact_bytes - 1,
            ..ExportOptions::default()
        })
        .unwrap_err();
    assert!(error.to_string().contains("export byte limit"));
}

#[test]
fn export_exact_cap_includes_repeated_resolved_labels() {
    let mut seeded = seeded_service();
    let wallet = seeded
        .service
        .accounts_page(Page::default())
        .unwrap()
        .items
        .into_iter()
        .find(|account| account.name() == "Wallet")
        .unwrap();
    seeded
        .service
        .update_account(
            wallet.id(),
            UpdateAccount {
                name: Some("L".repeat(64 * 1024)),
                actor: "test".to_string(),
                ..UpdateAccount::default()
            },
        )
        .unwrap();
    for number in 0..100 {
        create_entry(
            &mut seeded.service,
            "2026-07-02",
            &format!("shared label {number}"),
            wallet.id(),
            Some("Food"),
            EntryType::Expense,
            1,
            "KRW",
        );
    }
    let baseline = seeded
        .service
        .export(ExportOptions {
            include_archived: true,
            ..ExportOptions::default()
        })
        .unwrap();
    let exact_bytes = serde_json::to_vec(&baseline).unwrap().len();

    assert!(exact_bytes > 6 * 1024 * 1024);
    assert!(
        seeded
            .service
            .export(ExportOptions {
                include_archived: true,
                max_bytes: exact_bytes,
                ..ExportOptions::default()
            })
            .is_ok()
    );
    assert!(
        seeded
            .service
            .export(ExportOptions {
                include_archived: true,
                max_bytes: exact_bytes - 1,
                ..ExportOptions::default()
            })
            .is_err()
    );
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

fn drop_audit_mutation_triggers(connection: &Connection) {
    let triggers = connection
        .prepare(
            "SELECT name FROM sqlite_master
             WHERE type = 'trigger' AND tbl_name = 'audit_events'",
        )
        .unwrap()
        .query_map([], |row| row.get::<_, String>(0))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    for trigger in triggers {
        connection
            .execute_batch(&format!(
                "DROP TRIGGER \"{}\"",
                trigger.replace('"', "\"\"")
            ))
            .unwrap();
    }
}

fn latest_audit_after(
    connection: &Connection,
    record_type: &str,
    record_id: &str,
) -> serde_json::Value {
    let snapshot: String = connection
        .query_row(
            "SELECT after_json
             FROM audit_events
             WHERE record_type = ?1 AND record_id = ?2 AND after_json IS NOT NULL
             ORDER BY occurred_at DESC, rowid DESC
             LIMIT 1",
            [record_type, record_id],
            |row| row.get(0),
        )
        .unwrap();
    serde_json::from_str(&snapshot).unwrap()
}

#[allow(clippy::too_many_arguments)]
fn insert_raw_audit(
    connection: &Connection,
    id: &str,
    occurred_at: &str,
    action: &str,
    record_type: &str,
    record_id: &str,
    before: Option<&serde_json::Value>,
    after: Option<&serde_json::Value>,
) {
    let before = before.map(serde_json::to_string).transpose().unwrap();
    let after = after.map(serde_json::to_string).transpose().unwrap();
    connection
        .execute(
            "INSERT INTO audit_events (
                 id, occurred_at, actor, action, record_type, record_id,
                 before_json, after_json, reason
             ) VALUES (?1, ?2, 'fixture', ?3, ?4, ?5, ?6, ?7, NULL)",
            rusqlite::params![
                id,
                occurred_at,
                action,
                record_type,
                record_id,
                before,
                after
            ],
        )
        .unwrap();
}
