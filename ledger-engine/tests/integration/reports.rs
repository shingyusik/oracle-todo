use ledger_engine::application::commands::{
    CreateAccount, CreateAccountCategory, CreateCurrency, CreateEntry, CreateTransactionCategory,
};
use ledger_engine::application::doctor::{DoctorOptions, DoctorSeverity};
use ledger_engine::application::export::ExportOptions;
use ledger_engine::application::ports::Page;
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
    assert!(entries_scan.cursor > 0);
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
    assert_eq!(first.schema_version, 2);
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
