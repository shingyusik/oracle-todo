use std::path::Path;
use std::time::{Duration as StdDuration, Instant};

use ledger_engine::application::commands::{
    CreateAccount, CreateAccountCategory, CreateCurrency, CreateEntry, CreateTransactionCategory,
};
use ledger_engine::application::doctor::DoctorSeverity;
use ledger_engine::application::ports::Page;
use ledger_engine::application::retention::{RetentionPlan, RetentionWindow};
use ledger_engine::application::service::LedgerService;
use ledger_engine::application::transfers::{
    TransferCommand, TransferOperationKey, TransferResult,
};
use ledger_engine::domain::{EntryType, Money, TransactionCategoryKind};
use ledger_engine::infrastructure::sqlite::{SqliteLedgerRepository, retention_plan_at};
use rusqlite::Connection;
use time::macros::datetime;
use time::{Duration, OffsetDateTime};

type TestService = LedgerService<SqliteLedgerRepository>;

fn window_at(now: OffsetDateTime) -> RetentionWindow {
    RetentionWindow {
        now,
        cutoff: now - Duration::days(30),
        local_today: now.date(),
    }
}

/// A window far enough in the future that everything archived "now" is due.
fn future_window() -> RetentionWindow {
    window_at(OffsetDateTime::now_utc() + Duration::days(31))
}

fn service_at(path: &Path) -> TestService {
    LedgerService::new(SqliteLedgerRepository::open(path).unwrap())
}

fn seed(service: &mut TestService) {
    let currency = service
        .create_currency(CreateCurrency {
            code: "KRW".into(),
            name: "Korean won".into(),
            symbol: "W".into(),
            decimal_places: 0,
            actor: "seed".into(),
        })
        .unwrap();
    let category = service
        .create_account_category(CreateAccountCategory {
            name: "Cash".into(),
            parent: None,
            liability: false,
            actor: "seed".into(),
        })
        .unwrap();
    for name in ["Wallet", "Savings"] {
        service
            .create_account(CreateAccount {
                name: name.into(),
                category: category.id().to_string(),
                currency: currency.id().to_string(),
                opening_balance: Money::from_minor_units(100_000),
                purpose: None,
                actor: "seed".into(),
            })
            .unwrap();
    }
    service
        .create_category(CreateTransactionCategory {
            name: "Food".into(),
            parent: None,
            kind: TransactionCategoryKind::Expense,
            actor: "seed".into(),
        })
        .unwrap();
}

fn seeded(path: &Path) -> TestService {
    let mut service = service_at(path);
    seed(&mut service);
    service
}

fn expense(content: &str) -> CreateEntry {
    CreateEntry {
        date: "2026-07-30".into(),
        written_at: datetime!(2026-07-30 09:10:11 UTC),
        content: content.into(),
        category: Some("Food".into()),
        account: "Wallet".into(),
        entry_type: EntryType::Expense,
        amount: Money::from_minor_units(12_500),
        currency: "KRW".into(),
        transfer_group: None,
        source: "test".into(),
        notes: None,
        actor: "tester".into(),
    }
}

fn transfer(service: &mut TestService) -> TransferResult {
    service
        .transfer(TransferCommand {
            operation_key: TransferOperationKey::generate(),
            date: "2026-07-30".into(),
            written_at: datetime!(2026-07-30 10:11:12 UTC),
            content: "Move to savings".into(),
            from_account: "Wallet".into(),
            to_account: "Savings".into(),
            amount: Money::from_minor_units(50_000),
            currency: "KRW".into(),
            source: "test".into(),
            notes: None,
            actor: "tester".into(),
        })
        .unwrap()
}

fn count(path: &Path, sql: &str, value: &str) -> i64 {
    Connection::open(path)
        .unwrap()
        .query_row(sql, [value], |row| row.get(0))
        .unwrap()
}

fn entry_exists(path: &Path, id: &str) -> bool {
    count(
        path,
        "SELECT COUNT(*) FROM ledger_entries WHERE id = ?1",
        id,
    ) == 1
}

fn operation_count(path: &Path, group: &str) -> i64 {
    count(
        path,
        "SELECT COUNT(*) FROM transfer_operations
         WHERE json_extract(result_json, '$.transfer_group_id') = ?1",
        group,
    )
}

fn errors(service: &TestService) -> Vec<String> {
    service
        .doctor()
        .unwrap()
        .issues
        .into_iter()
        .filter(|issue| issue.severity == DoctorSeverity::Error)
        .map(|issue| format!("{}:{}", issue.code, issue.message))
        .collect()
}

#[test]
fn entry_archived_31_days_ago_is_purged_and_29_days_is_kept() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("ledger.sqlite");
    let mut service = seeded(&path);
    let old = service.create_entry(expense("Old lunch")).unwrap();
    let recent = service.create_entry(expense("Recent lunch")).unwrap();
    let active = service.create_entry(expense("Active lunch")).unwrap();
    service.archive_entry(old.id()).unwrap();
    service.archive_entry(recent.id()).unwrap();
    let now = OffsetDateTime::now_utc();
    let connection = Connection::open(&path).unwrap();
    for (id, days) in [(old.id(), 31), (recent.id(), 29)] {
        let at = (now - Duration::days(days))
            .format(&time::format_description::well_known::Rfc3339)
            .unwrap();
        connection
            .execute(
                "UPDATE ledger_entries SET deleted_at = ?2, updated_at = ?2 WHERE id = ?1",
                [id, at.as_str()],
            )
            .unwrap();
    }
    drop(connection);

    let plan = service.retention_plan(&window_at(now)).unwrap();
    assert_eq!(plan.candidates.len(), 1);
    assert_eq!(plan.candidates[0].kind, "ledger_entry");
    assert_eq!(plan.candidates[0].id, old.id());
    assert_eq!(plan.candidates[0].label, "Old lunch");
    assert!(plan.skipped.is_empty());

    let outcome = service.retention_apply(&plan).unwrap();
    assert_eq!(outcome.purged.get("ledger_entry"), Some(&1));
    assert!(outcome.skipped.is_empty());
    assert_eq!(outcome.media_cleanup_pending, 0);
    assert!(!entry_exists(&path, old.id()));
    assert!(entry_exists(&path, recent.id()));
    assert!(entry_exists(&path, active.id()));

    let history = service
        .audit_page("ledger_entry", old.id(), Page::default())
        .unwrap()
        .items;
    assert_eq!(history.len(), 1, "history is erased to a single tombstone");
    let tombstone = &history[0];
    assert_eq!(tombstone.action, "purge");
    assert_eq!(tombstone.reason.as_deref(), Some("retention"));
    assert_eq!(tombstone.actor, "ledger-retention");
    assert_eq!(tombstone.before, None);
    assert_eq!(tombstone.after, None);
    assert_eq!(
        service
            .audit_page("ledger_entry", recent.id(), Page::default())
            .unwrap()
            .items
            .len(),
        2
    );
}

#[test]
fn transfer_pair_purges_both_rows_and_its_operation() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("ledger.sqlite");
    let mut service = seeded(&path);
    let result = transfer(&mut service);
    service.archive_entry(&result.out_entry_id).unwrap();
    assert_eq!(operation_count(&path, &result.transfer_group_id), 1);

    let plan = service.retention_plan(&future_window()).unwrap();
    assert_eq!(plan.candidates.len(), 1);
    assert_eq!(plan.candidates[0].kind, "ledger_transfer");
    assert_eq!(plan.candidates[0].id, result.transfer_group_id);

    let outcome = service.retention_apply(&plan).unwrap();
    assert_eq!(outcome.purged.get("ledger_transfer"), Some(&1));
    assert!(!entry_exists(&path, &result.out_entry_id));
    assert!(!entry_exists(&path, &result.in_entry_id));
    assert_eq!(operation_count(&path, &result.transfer_group_id), 0);
    let history = service
        .audit_page("transfer", &result.transfer_group_id, Page::default())
        .unwrap()
        .items;
    assert_eq!(history.len(), 1);
    assert_eq!(history[0].action, "purge");
    assert_eq!(history[0].reason.as_deref(), Some("retention"));
    assert_eq!(history[0].before, None);
    assert_eq!(history[0].after, None);
}

#[test]
fn doctor_is_clean_after_purging_an_entry_and_a_transfer() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("ledger.sqlite");
    let mut service = seeded(&path);
    let entry = service.create_entry(expense("Purged lunch")).unwrap();
    let kept = service.create_entry(expense("Kept lunch")).unwrap();
    service.archive_entry(entry.id()).unwrap();
    let result = transfer(&mut service);
    service.archive_entry(&result.in_entry_id).unwrap();
    transfer(&mut service);
    assert_eq!(errors(&service), Vec::<String>::new());

    let plan = service.retention_plan(&future_window()).unwrap();
    let outcome = service.retention_apply(&plan).unwrap();
    assert_eq!(outcome.purged.get("ledger_entry"), Some(&1));
    assert_eq!(outcome.purged.get("ledger_transfer"), Some(&1));
    assert!(entry_exists(&path, kept.id()));

    let report = service.doctor().unwrap();
    assert!(report.issues.is_empty(), "{:?}", report.issues);
    assert!(report.healthy);
    let activity = service.recent_audit_activity(100).unwrap();
    assert!(
        activity.iter().all(|event| event.action != "purge"),
        "retention tombstones are hidden from recent activity"
    );
    assert!(!activity.is_empty());
}

#[test]
fn recent_activity_still_shows_non_retention_purges() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("ledger.sqlite");
    let mut service = seeded(&path);
    let unused = service
        .create_account_category(CreateAccountCategory {
            name: "Unused".into(),
            parent: None,
            liability: false,
            actor: "test".into(),
        })
        .unwrap();
    service
        .purge_account_category(unused.id(), unused.id())
        .unwrap();
    let activity = service.recent_audit_activity(100).unwrap();
    assert!(activity.iter().any(|event| event.action == "purge"));
}

fn insert_audit(path: &Path, sql_values: &str, params: [&str; 3]) {
    Connection::open(path)
        .unwrap()
        .execute(
            &format!(
                "INSERT INTO audit_events (
                    id, occurred_at, actor, action, record_type, record_id,
                    before_json, after_json, reason
                 ) VALUES {sql_values}"
            ),
            params,
        )
        .unwrap();
}

#[test]
fn doctor_flags_a_retention_tombstone_next_to_a_live_record() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("ledger.sqlite");
    let mut service = seeded(&path);
    let entry = service.create_entry(expense("Live lunch")).unwrap();
    insert_audit(
        &path,
        "(?1, '2099-01-01T00:00:00Z', 'ledger-retention', 'purge', ?2, ?3, NULL, NULL, 'retention')",
        [&uuid_v4(), "ledger_entry", entry.id()],
    );
    let issues = errors(&service);
    assert!(
        issues.iter().any(|issue| issue.starts_with("audit_")),
        "{issues:?}"
    );

    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("ledger.sqlite");
    let mut service = seeded(&path);
    let result = transfer(&mut service);
    insert_audit(
        &path,
        "(?1, '2099-01-01T00:00:00Z', 'ledger-retention', 'purge', ?2, ?3, NULL, NULL, 'retention')",
        [&uuid_v4(), "transfer", &result.transfer_group_id],
    );
    let issues = errors(&service);
    assert!(
        issues
            .iter()
            .any(|issue| issue.contains("terminal purge audit")),
        "{issues:?}"
    );
}

#[test]
fn doctor_keeps_existing_purge_shape_errors() {
    // A payload-free purge without the retention reason is not a tombstone.
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("ledger.sqlite");
    let service = seeded(&path);
    insert_audit(
        &path,
        "(?1, '2099-01-01T00:00:00Z', 'ledger-retention', 'purge', ?2, ?3, NULL, NULL, NULL)",
        [&uuid_v4(), "ledger_entry", &uuid_v4()],
    );
    let issues = errors(&service);
    assert!(
        issues
            .iter()
            .any(|issue| issue.starts_with("audit_snapshot_invalid")),
        "{issues:?}"
    );

    // A retention tombstone that is not the terminal event is still a broken chain.
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("ledger.sqlite");
    let service = seeded(&path);
    let record = uuid_v4();
    insert_audit(
        &path,
        "(?1, '2099-01-01T00:00:00Z', 'ledger-retention', 'purge', ?2, ?3, NULL, NULL, 'retention')",
        [&uuid_v4(), "ledger_entry", &record],
    );
    insert_audit(
        &path,
        "(?1, '2099-01-02T00:00:00Z', 'ledger-retention', 'purge', ?2, ?3, NULL, NULL, 'retention')",
        [&uuid_v4(), "ledger_entry", &record],
    );
    let issues = errors(&service);
    assert!(
        issues
            .iter()
            .any(|issue| issue.contains("purge must be the terminal audit action")),
        "{issues:?}"
    );
}

#[test]
fn inconsistent_transfer_pair_is_skipped() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("ledger.sqlite");
    let mut service = seeded(&path);
    let result = transfer(&mut service);
    service.archive_entry(&result.out_entry_id).unwrap();
    Connection::open(&path)
        .unwrap()
        .execute(
            "UPDATE ledger_entries SET deleted_at = '2026-01-01T00:00:00Z' WHERE id = ?1",
            [&result.in_entry_id],
        )
        .unwrap();

    let plan = service.retention_plan(&future_window()).unwrap();
    assert!(plan.candidates.is_empty());
    assert_eq!(plan.skipped.get("invalid_transfer_pair"), Some(&1));
    let outcome = service.retention_apply(&plan).unwrap();
    assert!(outcome.purged.is_empty());
    assert_eq!(outcome.skipped.get("invalid_transfer_pair"), Some(&1));
    assert!(entry_exists(&path, &result.out_entry_id));
    assert!(entry_exists(&path, &result.in_entry_id));
    assert_eq!(operation_count(&path, &result.transfer_group_id), 1);
}

#[test]
fn restore_between_plan_and_apply_is_changed_since_plan() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("ledger.sqlite");
    let mut service = seeded(&path);
    let entry = service.create_entry(expense("Restored lunch")).unwrap();
    let result = transfer(&mut service);
    service.archive_entry(entry.id()).unwrap();
    service.archive_entry(&result.out_entry_id).unwrap();

    let plan = service.retention_plan(&future_window()).unwrap();
    assert_eq!(plan.candidates.len(), 2);
    service.restore_entry(entry.id()).unwrap();
    service.restore_entry(&result.in_entry_id).unwrap();

    let outcome = service.retention_apply(&plan).unwrap();
    assert!(outcome.purged.is_empty());
    assert_eq!(outcome.skipped.get("changed_since_plan"), Some(&2));
    assert!(entry_exists(&path, entry.id()));
    assert!(entry_exists(&path, &result.out_entry_id));
    assert_eq!(errors(&service), Vec::<String>::new());
}

#[test]
fn rearchive_between_plan_and_apply_is_changed_since_plan() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("ledger.sqlite");
    let mut service = seeded(&path);
    let entry = service.create_entry(expense("Rearchived lunch")).unwrap();
    service.archive_entry(entry.id()).unwrap();
    let plan = service.retention_plan(&future_window()).unwrap();
    service.restore_entry(entry.id()).unwrap();
    std::thread::sleep(StdDuration::from_millis(5));
    service.archive_entry(entry.id()).unwrap();

    let outcome = service.retention_apply(&plan).unwrap();
    assert_eq!(outcome.skipped.get("changed_since_plan"), Some(&1));
    assert!(entry_exists(&path, entry.id()));
}

#[test]
fn purging_archived_entries_keeps_balances_unchanged() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("ledger.sqlite");
    let mut service = seeded(&path);
    service.create_entry(expense("Kept lunch")).unwrap();
    let archived = service.create_entry(expense("Archived lunch")).unwrap();
    service.archive_entry(archived.id()).unwrap();
    let result = transfer(&mut service);
    service.archive_entry(&result.out_entry_id).unwrap();
    transfer(&mut service);
    let before = service.account_balances_page(Page::default()).unwrap();

    let plan = service.retention_plan(&future_window()).unwrap();
    assert_eq!(plan.candidates.len(), 2);
    service.retention_apply(&plan).unwrap();

    assert_eq!(
        service.account_balances_page(Page::default()).unwrap(),
        before
    );
}

#[test]
fn many_candidates_are_applied_in_bounded_batches() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("ledger.sqlite");
    let mut service = seeded(&path);
    for index in 0..205 {
        let entry = service
            .create_entry(expense(&format!("Lunch {index}")))
            .unwrap();
        service.archive_entry(entry.id()).unwrap();
    }
    let plan = service.retention_plan(&future_window()).unwrap();
    assert_eq!(plan.candidates.len(), 205);
    let outcome = service.retention_apply(&plan).unwrap();
    assert_eq!(outcome.purged.get("ledger_entry"), Some(&205));
    assert_eq!(
        count(
            &path,
            "SELECT COUNT(*) FROM ledger_entries WHERE content LIKE ?1",
            "Lunch %"
        ),
        0
    );
}

#[test]
fn busy_writer_lock_is_retried_until_apply_succeeds() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("ledger.sqlite");
    let mut service = seeded(&path);
    let entry = service.create_entry(expense("Busy lunch")).unwrap();
    service.archive_entry(entry.id()).unwrap();
    let plan = service.retention_plan(&future_window()).unwrap();

    let holder = Connection::open(&path).unwrap();
    holder.execute_batch("BEGIN IMMEDIATE;").unwrap();
    let (locked_tx, locked_rx) = std::sync::mpsc::channel();
    let release = std::thread::spawn(move || {
        locked_tx.send(()).unwrap();
        // Longer than one 5 s busy wait, so the first attempt must fail with Busy.
        std::thread::sleep(StdDuration::from_millis(5_600));
        holder.execute_batch("COMMIT;").unwrap();
    });
    locked_rx.recv().unwrap();
    let started = Instant::now();
    let outcome = service.retention_apply(&plan).unwrap();
    release.join().unwrap();
    assert!(started.elapsed() >= StdDuration::from_secs(5));
    assert_eq!(outcome.purged.get("ledger_entry"), Some(&1));
    assert!(!entry_exists(&path, entry.id()));
}

#[test]
fn plan_does_not_create_a_missing_store_and_returns_an_empty_plan() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("ledger.sqlite");
    let window = future_window();
    let plan: RetentionPlan = retention_plan_at(&path, &window).unwrap();
    assert!(plan.candidates.is_empty());
    assert!(plan.skipped.is_empty());
    assert_eq!(plan.window, window);
    assert!(!path.exists());

    let mut service = seeded(&path);
    let entry = service.create_entry(expense("Path lunch")).unwrap();
    service.archive_entry(entry.id()).unwrap();
    drop(service);
    let plan = retention_plan_at(&path, &window).unwrap();
    assert_eq!(plan.candidates.len(), 1);
}

fn uuid_v4() -> String {
    // Synthetic canonical v4 identifiers without a direct uuid dev-dependency.
    TransferOperationKey::generate().as_str().to_string()
}
