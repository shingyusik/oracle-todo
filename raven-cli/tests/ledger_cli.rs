use std::path::Path;
use std::process::{Command, Output};

use serde_json::{Value, json};

fn raven(home: &Path) -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_raven"));
    command
        .env("RAVEN_CONSOLE_LOG", "off")
        .args(["--home", home.to_str().unwrap()]);
    command
}

fn run(home: &Path, args: &[&str]) -> Output {
    raven(home).args(args).output().unwrap()
}

fn success(home: &Path, args: &[&str]) -> Output {
    let output = run(home, args);
    assert!(
        output.status.success(),
        "command failed: {args:?}\nstdout: {}\nstderr: {}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    output
}

fn json_success(home: &Path, args: &[&str]) -> Value {
    let output = success(home, args);
    serde_json::from_slice(&output.stdout).unwrap_or_else(|error| {
        panic!(
            "invalid JSON for {args:?}: {error}\n{}",
            String::from_utf8_lossy(&output.stdout)
        )
    })
}

fn assert_exit(home: &Path, args: &[&str], expected: i32) -> Output {
    let output = run(home, args);
    assert_eq!(
        output.status.code(),
        Some(expected),
        "wrong exit for {args:?}\nstdout: {}\nstderr: {}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    output
}

fn assert_exit_owned(home: &Path, args: &[String], expected: i32) -> Output {
    let output = raven(home).args(args).output().unwrap();
    assert_eq!(
        output.status.code(),
        Some(expected),
        "wrong exit for {args:?}\nstdout: {}\nstderr: {}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    output
}

fn init_and_seed(home: &Path) {
    success(home, &["init"]);
    json_success(
        home,
        &[
            "ledger",
            "currency",
            "create",
            "--code",
            "KRW",
            "--name",
            "Korean won",
            "--symbol",
            "won",
            "--decimal-places",
            "0",
        ],
    );
    json_success(
        home,
        &[
            "ledger",
            "currency",
            "create",
            "--code",
            "USD",
            "--name",
            "US dollar",
            "--symbol",
            "$",
            "--decimal-places",
            "2",
        ],
    );
    json_success(
        home,
        &["ledger", "account-category", "create", "--name", "Cash"],
    );
    json_success(
        home,
        &[
            "ledger",
            "account",
            "create",
            "--name",
            "card",
            "--category",
            "Cash",
            "--currency",
            "KRW",
            "--opening-balance",
            "0",
        ],
    );
    json_success(
        home,
        &[
            "ledger",
            "account",
            "create",
            "--name",
            "bank",
            "--category",
            "Cash",
            "--currency",
            "KRW",
            "--opening-balance",
            "100000",
        ],
    );
    json_success(
        home,
        &[
            "ledger", "category", "create", "--name", "food", "--kind", "expense",
        ],
    );
    json_success(
        home,
        &[
            "ledger", "category", "create", "--name", "salary", "--kind", "income",
        ],
    );
}

fn add_lunch(home: &Path) -> Value {
    json_success(
        home,
        &[
            "ledger",
            "entry",
            "add",
            "--date",
            "2026-07-30",
            "--type",
            "expense",
            "--amount",
            "12000",
            "--currency",
            "KRW",
            "--account",
            "card",
            "--category",
            "food",
            "--content",
            "Lunch",
        ],
    )
}

#[test]
fn init_creates_ledger_and_health_check_is_schema_aware_and_read_only() {
    let home = tempfile::tempdir().unwrap();
    let missing = home.path().join("ledger.sqlite");

    let before = assert_exit(home.path(), &["health-check"], 1);
    assert!(
        String::from_utf8(before.stdout)
            .unwrap()
            .contains("ledger=not_initialized")
    );
    assert!(!missing.exists());

    success(home.path(), &["init"]);
    assert!(missing.is_file());
    let health = success(home.path(), &["health-check"]);
    assert!(
        String::from_utf8(health.stdout)
            .unwrap()
            .contains("ledger=ok user_version=2")
    );
}

#[test]
fn all_master_commands_create_update_list_and_purge() {
    let home = tempfile::tempdir().unwrap();
    success(home.path(), &["init"]);

    let currency = json_success(
        home.path(),
        &[
            "ledger",
            "currency",
            "create",
            "--json",
            r#"{"code":"JPY","name":"Yen","symbol":"yen","decimal_places":0}"#,
        ],
    );
    let currency_id = currency["id"].as_str().unwrap();
    let updated = json_success(
        home.path(),
        &[
            "ledger",
            "currency",
            "update",
            currency_id,
            "--name",
            "Japanese yen",
        ],
    );
    assert_eq!(updated["name"], "Japanese yen");
    assert_eq!(
        json_success(
            home.path(),
            &["ledger", "currency", "list", "--format", "json"]
        )["items"][0]["code"],
        "JPY"
    );

    let account_category = json_success(
        home.path(),
        &[
            "ledger",
            "account-category",
            "create",
            "--name",
            "Temporary cash",
        ],
    );
    let account_category_id = account_category["id"].as_str().unwrap();
    let account = json_success(
        home.path(),
        &[
            "ledger",
            "account",
            "create",
            "--name",
            "temporary account",
            "--category",
            "Temporary cash",
            "--currency",
            "JPY",
            "--opening-balance",
            "10",
        ],
    );
    let account_id = account["id"].as_str().unwrap();
    let category = json_success(
        home.path(),
        &[
            "ledger",
            "category",
            "create",
            "--name",
            "temporary expense",
            "--kind",
            "expense",
        ],
    );
    let category_id = category["id"].as_str().unwrap();

    assert_eq!(
        json_success(
            home.path(),
            &[
                "ledger",
                "account",
                "update",
                account_id,
                "--opening-balance",
                "11"
            ]
        )["opening_balance_minor"],
        11
    );
    assert_eq!(
        json_success(
            home.path(),
            &[
                "ledger",
                "account-category",
                "update",
                account_category_id,
                "--liability",
                "true"
            ]
        )["liability"],
        true
    );
    assert_eq!(
        json_success(
            home.path(),
            &[
                "ledger",
                "category",
                "update",
                category_id,
                "--name",
                "renamed expense"
            ]
        )["name"],
        "renamed expense"
    );

    assert_exit(home.path(), &["ledger", "account", "purge", account_id], 2);
    success(
        home.path(),
        &[
            "ledger",
            "account",
            "purge",
            account_id,
            "--confirm",
            account_id,
        ],
    );
    success(
        home.path(),
        &[
            "ledger",
            "category",
            "purge",
            category_id,
            "--confirm",
            category_id,
        ],
    );
    success(
        home.path(),
        &[
            "ledger",
            "account-category",
            "purge",
            account_category_id,
            "--confirm",
            account_category_id,
        ],
    );
    success(
        home.path(),
        &[
            "ledger",
            "currency",
            "purge",
            currency_id,
            "--confirm",
            currency_id,
        ],
    );
}

#[test]
fn entry_flags_and_strict_json_round_trip_with_filters_and_pages() {
    let home = tempfile::tempdir().unwrap();
    init_and_seed(home.path());

    let lunch = add_lunch(home.path());
    let id = lunch["id"].as_str().unwrap();
    assert_eq!(lunch["amount_minor"], 12_000);
    assert_eq!(lunch["currency_code"], "KRW");

    let shown = json_success(
        home.path(),
        &["ledger", "entry", "show", id, "--format", "json"],
    );
    assert_eq!(shown["id"], id);
    assert_eq!(shown["content"], "Lunch");

    let updated = json_success(
        home.path(),
        &[
            "ledger",
            "entry",
            "update",
            id,
            "--json",
            r#"{"content":"Late lunch","amount":"12500","notes":"receipt"}"#,
        ],
    );
    assert_eq!(updated["content"], "Late lunch");
    assert_eq!(updated["amount_minor"], 12_500);

    let page = json_success(
        home.path(),
        &[
            "ledger",
            "entry",
            "list",
            "--from",
            "2026-07-01",
            "--to",
            "2026-07-31",
            "--account",
            "card",
            "--category",
            "food",
            "--currency",
            "KRW",
            "--content",
            "late",
            "--limit",
            "1",
            "--format",
            "json",
        ],
    );
    assert_eq!(page["items"].as_array().unwrap().len(), 1);
    assert_eq!(page["items"][0]["id"], id);
    assert!(page["next"].is_null());

    let table = success(
        home.path(),
        &["ledger", "entry", "list", "--format", "table"],
    );
    let stdout = String::from_utf8(table.stdout).unwrap();
    assert!(stdout.contains("AMOUNT_MINOR"));
    assert!(stdout.contains("Late lunch"));
}

#[test]
fn amount_precision_dates_and_json_schema_fail_before_mutation() {
    let home = tempfile::tempdir().unwrap();
    init_and_seed(home.path());

    let invalid_precision = assert_exit(
        home.path(),
        &[
            "ledger",
            "account",
            "create",
            "--name",
            "usd",
            "--category",
            "Cash",
            "--currency",
            "USD",
            "--opening-balance",
            "1.234",
        ],
        2,
    );
    assert!(
        String::from_utf8(invalid_precision.stderr)
            .unwrap()
            .contains("fractional")
    );

    assert_exit(
        home.path(),
        &[
            "ledger",
            "entry",
            "add",
            "--json",
            r#"{"id":"caller-id","date":"2026-07-30","entry_type":"expense","amount":"1","currency":"KRW","account":"card","category":"food","content":"private"}"#,
        ],
        2,
    );
    assert_exit(
        home.path(),
        &[
            "ledger",
            "entry",
            "add",
            "--json",
            r#"{"date":"2026-02-30","entry_type":"expense","amount":"1","currency":"KRW","account":"card","category":"food","content":"private","unknown":true}"#,
        ],
        2,
    );

    let listed = json_success(
        home.path(),
        &["ledger", "entry", "list", "--format", "json"],
    );
    assert!(listed["items"].as_array().unwrap().is_empty());
}

#[test]
fn transfer_retries_are_idempotent_and_group_purge_requires_preview_confirmation() {
    let home = tempfile::tempdir().unwrap();
    init_and_seed(home.path());
    let operation_key = "018f31c0-5c2a-4e75-9c18-a14d7bddb2a1";
    let args = [
        "ledger",
        "transfer",
        "--operation-key",
        operation_key,
        "--date",
        "2026-07-30",
        "--amount",
        "5000",
        "--currency",
        "KRW",
        "--from-account",
        "bank",
        "--to-account",
        "card",
        "--content",
        "Move cash",
    ];
    let first = json_success(home.path(), &args);
    let retried = json_success(home.path(), &args);
    assert_eq!(first, retried);

    let group_id = first["transfer_group_id"].as_str().unwrap();
    let out_id = first["out_entry_id"].as_str().unwrap();
    let shown = json_success(
        home.path(),
        &["ledger", "transfer-show", group_id, "--format", "json"],
    );
    assert_eq!(shown["transfer_group_id"], group_id);

    json_success(home.path(), &["ledger", "entry", "archive", out_id]);
    let archived = json_success(
        home.path(),
        &[
            "ledger",
            "entry",
            "list",
            "--include-archived",
            "--format",
            "json",
        ],
    );
    assert_eq!(archived["items"].as_array().unwrap().len(), 2);
    assert!(
        archived["items"]
            .as_array()
            .unwrap()
            .iter()
            .all(|entry| !entry["deleted_at"].is_null())
    );
    json_success(home.path(), &["ledger", "entry", "restore", out_id]);

    let preview = assert_exit(home.path(), &["ledger", "entry", "purge", out_id], 2);
    let preview: Value = serde_json::from_slice(&preview.stdout).unwrap();
    assert_eq!(preview["confirmation_id"], group_id);
    assert_eq!(preview["transfer_group_id"], group_id);
    assert_eq!(preview["entry_ids"].as_array().unwrap().len(), 2);

    assert_exit(
        home.path(),
        &["ledger", "entry", "purge", out_id, "--confirm", out_id],
        2,
    );
    success(
        home.path(),
        &["ledger", "entry", "purge", out_id, "--confirm", group_id],
    );
    assert_exit(
        home.path(),
        &["ledger", "entry", "show", out_id, "--format", "json"],
        4,
    );
}

#[test]
fn reports_balances_briefing_doctor_and_export_are_structured_and_deterministic() {
    let home = tempfile::tempdir().unwrap();
    init_and_seed(home.path());
    add_lunch(home.path());
    json_success(
        home.path(),
        &[
            "ledger",
            "entry",
            "add",
            "--date",
            "2026-07-30",
            "--type",
            "income",
            "--amount",
            "50000",
            "--currency",
            "KRW",
            "--account",
            "bank",
            "--category",
            "salary",
            "--content",
            "Pay",
        ],
    );

    let report = json_success(
        home.path(),
        &[
            "ledger",
            "reports",
            "--from",
            "2026-07-01",
            "--to",
            "2026-07-31",
            "--format",
            "json",
        ],
    );
    assert_eq!(report["currencies"][0]["income_minor"], 50_000);
    assert_eq!(report["currencies"][0]["expense_minor"], 12_000);

    let balances = json_success(home.path(), &["ledger", "balances", "--format", "json"]);
    assert_eq!(balances["items"].as_array().unwrap().len(), 2);
    assert!(balances["items"][0]["current_balance_minor"].is_number());

    let briefing = json_success(
        home.path(),
        &[
            "ledger",
            "briefing",
            "--from",
            "2026-07-01",
            "--to",
            "2026-07-31",
            "--format",
            "json",
        ],
    );
    assert!(briefing["markdown"].as_str().unwrap().contains("KRW"));

    let doctor = json_success(home.path(), &["ledger", "doctor", "--format", "json"]);
    assert_eq!(doctor["healthy"], true);

    let first = success(
        home.path(),
        &["ledger", "export", "--include-archived", "--format", "json"],
    );
    let second = success(
        home.path(),
        &["ledger", "export", "--include-archived", "--format", "json"],
    );
    assert_eq!(first.stdout, second.stdout);
    let export: Value = serde_json::from_slice(&first.stdout).unwrap();
    assert_eq!(export["schema_version"], 3);
    assert_eq!(export["restore_capable"], true);
}

#[test]
fn validation_not_found_clap_and_terminal_logging_use_stable_exit_codes_without_secrets() {
    let home = tempfile::tempdir().unwrap();
    init_and_seed(home.path());

    assert_exit(
        home.path(),
        &["ledger", "entry", "add", "natural language transaction"],
        2,
    );
    assert_exit(
        home.path(),
        &["ledger", "entry", "show", "missing", "--format", "json"],
        4,
    );
    assert!(run(home.path(), &["ledger", "--help"]).status.success());

    let private_content = "private card purchase";
    assert_exit(
        home.path(),
        &[
            "ledger",
            "entry",
            "add",
            "--date",
            "2026-07-30",
            "--type",
            "expense",
            "--amount",
            "1",
            "--currency",
            "MISSING",
            "--account",
            "card",
            "--category",
            "food",
            "--content",
            private_content,
        ],
        4,
    );
    let log = std::fs::read_to_string(home.path().join("logs/raven.log.jsonl")).unwrap();
    assert!(log.contains(r#""engine":"ledger""#));
    assert!(log.contains(r#""command":"ledger""#));
    assert!(!log.contains(private_content));
    assert!(!log.contains(home.path().to_str().unwrap()));
    assert!(!log.contains("MISSING"));

    let events: Vec<Value> = log
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    let terminal: Vec<_> = events
        .iter()
        .filter(|event| {
            event["fields"]["command"] == "ledger"
                && matches!(
                    event["fields"]["event"].as_str(),
                    Some("command_completed" | "command_failed")
                )
        })
        .collect();
    assert!(!terminal.is_empty());
    assert!(
        terminal
            .iter()
            .all(|event| event["fields"]["exit_code"].is_number())
    );
}

#[test]
fn mutation_json_rejects_mixed_flags_and_unknown_or_caller_owned_fields() {
    let home = tempfile::tempdir().unwrap();
    success(home.path(), &["init"]);

    assert_exit(
        home.path(),
        &[
            "ledger",
            "currency",
            "create",
            "--code",
            "KRW",
            "--json",
            r#"{"code":"KRW","name":"Won","symbol":"won","decimal_places":0}"#,
        ],
        2,
    );
    assert_exit(
        home.path(),
        &[
            "ledger",
            "currency",
            "create",
            "--json",
            r#"{"id":"caller","code":"KRW","name":"Won","symbol":"won","decimal_places":0}"#,
        ],
        2,
    );
    assert_exit(
        home.path(),
        &[
            "ledger",
            "currency",
            "create",
            "--json",
            &json!({
                "code": "KRW",
                "name": "Won",
                "symbol": "won",
                "decimal_places": 0,
                "unknown": "field"
            })
            .to_string(),
        ],
        2,
    );
    let currencies = json_success(
        home.path(),
        &["ledger", "currency", "list", "--format", "json"],
    );
    assert!(currencies["items"].as_array().unwrap().is_empty());
}

#[test]
fn ambiguous_references_map_to_exit_two_without_creating_a_record() {
    let home = tempfile::tempdir().unwrap();
    success(home.path(), &["init"]);
    for (code, name) in [("AAA", "Shared"), ("BBB", "Shared")] {
        json_success(
            home.path(),
            &[
                "ledger",
                "currency",
                "create",
                "--code",
                code,
                "--name",
                name,
                "--symbol",
                code,
                "--decimal-places",
                "2",
            ],
        );
    }
    json_success(
        home.path(),
        &["ledger", "account-category", "create", "--name", "Cash"],
    );
    assert_exit(
        home.path(),
        &[
            "ledger",
            "account",
            "create",
            "--name",
            "ambiguous",
            "--category",
            "Cash",
            "--currency",
            "Shared",
            "--opening-balance",
            "1.00",
        ],
        2,
    );
    let accounts = json_success(
        home.path(),
        &["ledger", "account", "list", "--format", "json"],
    );
    assert!(accounts["items"].as_array().unwrap().is_empty());
}

#[test]
fn ledger_storage_failures_map_to_exit_one_and_log_no_paths() {
    let home = tempfile::tempdir().unwrap();
    std::fs::create_dir(home.path().join("ledger.sqlite")).unwrap();

    assert_exit(
        home.path(),
        &["ledger", "entry", "list", "--format", "json"],
        1,
    );
    let log = std::fs::read_to_string(home.path().join("logs/raven.log.jsonl")).unwrap();
    assert!(log.contains(r#""exit_code":1"#));
    assert!(!log.contains(home.path().to_str().unwrap()));
    assert!(!log.contains("unable to open"));
}

#[test]
fn ledger_health_rejects_future_schema_without_changing_database_bytes() {
    let home = tempfile::tempdir().unwrap();
    success(home.path(), &["init"]);
    let database = home.path().join("ledger.sqlite");
    let connection = rusqlite::Connection::open(&database).unwrap();
    connection
        .execute_batch("PRAGMA user_version = 999;")
        .unwrap();
    drop(connection);
    let before = std::fs::read(&database).unwrap();

    let output = assert_exit(home.path(), &["health-check"], 1);

    assert!(
        String::from_utf8(output.stdout)
            .unwrap()
            .contains("ledger=unavailable")
    );
    assert_eq!(std::fs::read(database).unwrap(), before);
}

#[test]
fn historical_precision_updates_ignore_active_master_pages_and_soft_deletion() {
    let home = tempfile::tempdir().unwrap();
    success(home.path(), &["init"]);

    for index in 0..101 {
        let code = format!("X{index:03}");
        json_success(
            home.path(),
            &[
                "ledger",
                "currency",
                "create",
                "--code",
                &code,
                "--name",
                &format!("Currency {index:03}"),
                "--symbol",
                &code,
                "--decimal-places",
                "2",
            ],
        );
    }
    json_success(
        home.path(),
        &["ledger", "account-category", "create", "--name", "Cash"],
    );
    json_success(
        home.path(),
        &[
            "ledger",
            "category",
            "create",
            "--name",
            "historical expense",
            "--kind",
            "expense",
        ],
    );
    let currency = json_success(
        home.path(),
        &[
            "ledger",
            "currency",
            "create",
            "--code",
            "HIS",
            "--name",
            "Historical",
            "--symbol",
            "H",
            "--decimal-places",
            "2",
        ],
    );
    let currency_id = currency["id"].as_str().unwrap();
    let account = json_success(
        home.path(),
        &[
            "ledger",
            "account",
            "create",
            "--name",
            "historical account",
            "--category",
            "Cash",
            "--currency",
            currency_id,
            "--opening-balance",
            "1.23",
        ],
    );
    let account_id = account["id"].as_str().unwrap();
    let entry = json_success(
        home.path(),
        &[
            "ledger",
            "entry",
            "add",
            "--date",
            "2024-02-29",
            "--type",
            "expense",
            "--amount",
            "2.34",
            "--currency",
            currency_id,
            "--account",
            account_id,
            "--category",
            "historical expense",
            "--content",
            "Historical precision",
        ],
    );
    let entry_id = entry["id"].as_str().unwrap();

    json_success(
        home.path(),
        &[
            "ledger",
            "currency",
            "update",
            currency_id,
            "--active",
            "false",
        ],
    );
    assert_eq!(
        json_success(
            home.path(),
            &["ledger", "entry", "update", entry_id, "--amount", "3.45"],
        )["amount_minor"],
        345
    );

    json_success(
        home.path(),
        &[
            "ledger", "account", "update", account_id, "--active", "false",
        ],
    );
    assert_eq!(
        json_success(
            home.path(),
            &[
                "ledger",
                "account",
                "update",
                account_id,
                "--opening-balance",
                "4.56",
            ],
        )["opening_balance_minor"],
        456
    );
    assert_eq!(
        json_success(
            home.path(),
            &[
                "ledger",
                "account",
                "update",
                account_id,
                "--active",
                "true",
                "--opening-balance",
                "5.67",
            ],
        )["opening_balance_minor"],
        567
    );

    let connection = rusqlite::Connection::open(home.path().join("ledger.sqlite")).unwrap();
    connection
        .execute(
            "UPDATE currencies
             SET active = 0,
                 updated_at = '2099-07-30T00:00:00Z',
                 deleted_at = '2099-07-30T00:00:00Z'
             WHERE id = ?1",
            [currency_id],
        )
        .unwrap();
    drop(connection);

    assert_eq!(
        json_success(
            home.path(),
            &[
                "ledger",
                "account",
                "update",
                account_id,
                "--opening-balance",
                "7.89",
            ],
        )["opening_balance_minor"],
        789
    );

    let connection = rusqlite::Connection::open(home.path().join("ledger.sqlite")).unwrap();
    connection
        .execute(
            "UPDATE accounts
             SET active = 0,
                 updated_at = '2099-07-30T00:00:00Z',
                 deleted_at = '2099-07-30T00:00:00Z'
             WHERE id = ?1",
            [account_id],
        )
        .unwrap();
    drop(connection);

    assert_eq!(
        json_success(
            home.path(),
            &["ledger", "entry", "update", entry_id, "--amount", "6.78"],
        )["amount_minor"],
        678
    );
}

#[test]
fn reports_compare_briefing_and_audit_emit_stable_iso_json() {
    let home = tempfile::tempdir().unwrap();
    init_and_seed(home.path());
    let entry = json_success(
        home.path(),
        &[
            "ledger",
            "entry",
            "add",
            "--date",
            "2024-02-29",
            "--written-at",
            "2024-02-29T23:30:00-05:00",
            "--type",
            "expense",
            "--amount",
            "10",
            "--currency",
            "KRW",
            "--account",
            "card",
            "--category",
            "food",
            "--content",
            "Leap day",
        ],
    );
    let entry_id = entry["id"].as_str().unwrap();
    json_success(
        home.path(),
        &["ledger", "entry", "update", entry_id, "--notes", "reviewed"],
    );

    let report = json_success(
        home.path(),
        &[
            "ledger",
            "reports",
            "--from",
            "2024-02-29",
            "--to",
            "2024-03-01",
            "--format",
            "json",
        ],
    );
    assert_eq!(
        report["range"],
        json!({"start":"2024-02-29","end":"2024-03-01"})
    );

    let briefing = json_success(
        home.path(),
        &[
            "ledger",
            "briefing",
            "--from",
            "2024-02-29",
            "--to",
            "2024-03-01",
            "--format",
            "json",
        ],
    );
    assert_eq!(
        briefing["summary"]["range"],
        json!({"start":"2024-02-29","end":"2024-03-01"})
    );

    let comparison = json_success(
        home.path(),
        &[
            "ledger",
            "compare",
            "--current-from",
            "2024-02-29",
            "--current-to",
            "2024-03-01",
            "--previous-from",
            "2023-02-28",
            "--previous-to",
            "2023-03-01",
            "--format",
            "json",
        ],
    );
    assert_eq!(
        comparison["current"]["range"],
        json!({"start":"2024-02-29","end":"2024-03-01"})
    );
    assert_eq!(
        comparison["previous"]["range"],
        json!({"start":"2023-02-28","end":"2023-03-01"})
    );
    let comparison_table = success(
        home.path(),
        &[
            "ledger",
            "compare",
            "--current-from",
            "2024-02-29",
            "--current-to",
            "2024-03-01",
            "--previous-from",
            "2023-02-28",
            "--previous-to",
            "2023-03-01",
            "--format",
            "table",
        ],
    );
    let comparison_table = String::from_utf8(comparison_table.stdout).unwrap();
    assert!(comparison_table.contains("current\t2024-02-29\t2024-03-01"));
    assert!(comparison_table.contains("previous\t2023-02-28\t2023-03-01"));

    let first = json_success(
        home.path(),
        &[
            "ledger",
            "audit",
            "--record-type",
            "ledger_entry",
            "--record-id",
            entry_id,
            "--limit",
            "1",
            "--format",
            "json",
        ],
    );
    assert_eq!(first["items"].as_array().unwrap().len(), 1);
    let occurred_at = first["items"][0]["occurred_at"].as_str().unwrap();
    let parsed =
        time::OffsetDateTime::parse(occurred_at, &time::format_description::well_known::Rfc3339)
            .unwrap();
    assert_eq!(parsed.offset(), time::UtcOffset::UTC);
    assert!(occurred_at.ends_with('Z'));
    assert_eq!(first["items"][0]["after"]["date"], "2024-02-29");
    assert_eq!(
        first["items"][0]["after"]["written_at"],
        "2024-03-01T04:30:00Z"
    );
    assert_eq!(first["next"], json!({"offset":1,"limit":1}));

    let second = json_success(
        home.path(),
        &[
            "ledger",
            "history",
            "--record-type",
            "ledger_entry",
            "--record-id",
            entry_id,
            "--offset",
            "1",
            "--limit",
            "1",
            "--format",
            "json",
        ],
    );
    assert_eq!(second["items"].as_array().unwrap().len(), 1);
    assert!(
        second["items"][0]["occurred_at"]
            .as_str()
            .unwrap()
            .ends_with('Z')
    );
    let audit_table = success(
        home.path(),
        &[
            "ledger",
            "audit",
            "--record-type",
            "ledger_entry",
            "--record-id",
            entry_id,
            "--limit",
            "1",
            "--format",
            "table",
        ],
    );
    let audit_table = String::from_utf8(audit_table.stdout).unwrap();
    assert!(audit_table.contains("OCCURRED_AT"));
    assert!(audit_table.contains("BEFORE_JSON"));
    assert!(audit_table.contains(r#""date":"2024-02-29""#));

    let help = String::from_utf8(success(home.path(), &["ledger", "--help"]).stdout).unwrap();
    assert!(help.contains("compare"));
    assert!(help.contains("audit"));
    assert!(help.contains("history"));
}

#[test]
fn master_purge_preview_is_service_validated_before_stdout() {
    let home = tempfile::tempdir().unwrap();
    init_and_seed(home.path());

    let missing = assert_exit(home.path(), &["ledger", "currency", "purge", "missing"], 4);
    assert!(missing.stdout.is_empty());

    let krw = json_success(
        home.path(),
        &["ledger", "currency", "list", "--format", "json"],
    );
    let krw_id = krw["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["code"] == "KRW")
        .unwrap()["id"]
        .as_str()
        .unwrap();
    let referenced = assert_exit(home.path(), &["ledger", "currency", "purge", krw_id], 2);
    assert!(referenced.stdout.is_empty());
    assert!(
        String::from_utf8(referenced.stderr)
            .unwrap()
            .contains("referenced")
    );
    let referenced_confirmed = assert_exit(
        home.path(),
        &["ledger", "currency", "purge", krw_id, "--confirm", krw_id],
        2,
    );
    assert!(referenced_confirmed.stdout.is_empty());
    assert!(
        String::from_utf8(referenced_confirmed.stderr)
            .unwrap()
            .contains("referenced")
    );

    let temporary = json_success(
        home.path(),
        &[
            "ledger",
            "currency",
            "create",
            "--code",
            "TMP",
            "--name",
            "Temporary",
            "--symbol",
            "T",
            "--decimal-places",
            "2",
        ],
    );
    let temporary_id = temporary["id"].as_str().unwrap();
    let connection = rusqlite::Connection::open(home.path().join("ledger.sqlite")).unwrap();
    connection
        .execute(
            "UPDATE currencies
             SET active = 0,
                 updated_at = '2099-07-30T00:00:00Z',
                 deleted_at = '2099-07-30T00:00:00Z'
             WHERE id = ?1",
            [temporary_id],
        )
        .unwrap();
    drop(connection);
    let preview = assert_exit(
        home.path(),
        &["ledger", "currency", "purge", temporary_id],
        2,
    );
    assert_eq!(
        serde_json::from_slice::<Value>(&preview.stdout).unwrap(),
        json!({"confirmation_id":temporary_id,"record_type":"currency"})
    );
    json_success(
        home.path(),
        &[
            "ledger",
            "currency",
            "purge",
            temporary_id,
            "--confirm",
            temporary_id,
        ],
    );
    assert_exit(
        home.path(),
        &[
            "ledger",
            "currency",
            "purge",
            temporary_id,
            "--confirm",
            temporary_id,
        ],
        4,
    );
}

#[test]
fn mutation_help_documents_input_modes_and_canonical_formats() {
    let home = tempfile::tempdir().unwrap();
    let entry =
        String::from_utf8(success(home.path(), &["ledger", "entry", "add", "--help"]).stdout)
            .unwrap();
    for required in [
        "--json",
        "--date YYYY-MM-DD",
        "--written-at RFC3339",
        "--type",
        "--amount",
        "--currency",
        "--account",
        "--category",
        "--content",
    ] {
        assert!(
            entry.contains(required),
            "missing {required:?} in:\n{entry}"
        );
    }
    assert!(entry.contains("Expense and income entries also require --category"));
    assert!(entry.contains("--account cash --category food --content Lunch"));
    assert!(entry.contains(r#""account":"cash","category":"food","content":"Lunch""#));

    let transfer =
        String::from_utf8(success(home.path(), &["ledger", "transfer", "--help"]).stdout).unwrap();
    for required in [
        "--json",
        "--operation-key",
        "UUID v4",
        "--date YYYY-MM-DD",
        "--written-at RFC3339",
        "--from-account",
        "--to-account",
    ] {
        assert!(
            transfer.contains(required),
            "missing {required:?} in:\n{transfer}"
        );
    }
}

#[test]
fn table_cells_escape_line_breaks_controls_and_ansi_but_json_does_not() {
    let home = tempfile::tempdir().unwrap();
    init_and_seed(home.path());
    let content = "line1\tline2\nline3\r\u{1b}[31m\\end";
    let entry = json_success(
        home.path(),
        &[
            "ledger",
            "entry",
            "add",
            "--date",
            "2026-07-30",
            "--type",
            "expense",
            "--amount",
            "1",
            "--currency",
            "KRW",
            "--account",
            "card",
            "--category",
            "food",
            "--content",
            content,
        ],
    );
    let entry_id = entry["id"].as_str().unwrap();

    let table = success(
        home.path(),
        &["ledger", "entry", "list", "--format", "table"],
    );
    let stdout = String::from_utf8(table.stdout).unwrap();
    assert_eq!(stdout.lines().count(), 2);
    assert!(!stdout.contains('\r'));
    assert!(!stdout.contains('\u{1b}'));
    assert!(stdout.contains(r"line1\tline2\nline3\r\u{001b}[31m\\end"));

    let shown = json_success(
        home.path(),
        &["ledger", "entry", "show", entry_id, "--format", "json"],
    );
    assert_eq!(shown["content"], content);
}

#[test]
fn export_max_bytes_caps_exact_stdout_document_bytes() {
    let home = tempfile::tempdir().unwrap();
    init_and_seed(home.path());
    add_lunch(home.path());

    let baseline = success(
        home.path(),
        &[
            "ledger",
            "export",
            "--format",
            "json",
            "--max-bytes",
            "10000000",
        ],
    );
    assert!(!baseline.stdout.ends_with(b"\n"));
    let exact = baseline.stdout.len().to_string();
    let capped = success(
        home.path(),
        &[
            "ledger",
            "export",
            "--format",
            "json",
            "--max-bytes",
            &exact,
        ],
    );
    assert_eq!(capped.stdout, baseline.stdout);

    let one_less = (baseline.stdout.len() - 1).to_string();
    assert_exit(
        home.path(),
        &[
            "ledger",
            "export",
            "--format",
            "json",
            "--max-bytes",
            &one_less,
        ],
        1,
    );
}

#[test]
fn explicit_currency_precision_matches_service_policy_across_mutations() {
    use ledger_engine::application::error::LedgerError;
    use ledger_engine::application::service::LedgerService;
    use ledger_engine::infrastructure::sqlite::SqliteLedgerRepository;

    let home = tempfile::tempdir().unwrap();
    init_and_seed(home.path());
    let entry = add_lunch(home.path());
    let entry_id = entry["id"].as_str().unwrap().to_string();
    let candidate = json_success(
        home.path(),
        &[
            "ledger",
            "account",
            "create",
            "--name",
            "candidate",
            "--category",
            "Cash",
            "--currency",
            "KRW",
            "--opening-balance",
            "0",
        ],
    );
    let candidate_id = candidate["id"].as_str().unwrap().to_string();

    for index in 0..101 {
        let code = format!("P{index:03}");
        json_success(
            home.path(),
            &[
                "ledger",
                "currency",
                "create",
                "--code",
                &code,
                "--name",
                &format!("Paged currency {index:03}"),
                "--symbol",
                &code,
                "--decimal-places",
                "3",
            ],
        );
    }
    let target = json_success(
        home.path(),
        &[
            "ledger",
            "currency",
            "create",
            "--code",
            "ZZZ",
            "--name",
            "Zed target",
            "--symbol",
            "Z",
            "--decimal-places",
            "3",
        ],
    );
    let target_id = target["id"].as_str().unwrap();
    let target_account = json_success(
        home.path(),
        &[
            "ledger",
            "account",
            "create",
            "--name",
            "target one",
            "--category",
            "Cash",
            "--currency",
            "Zed target",
            "--opening-balance",
            "1.234",
        ],
    );
    let target_account_id = target_account["id"].as_str().unwrap();
    let target_account_two = json_success(
        home.path(),
        &[
            "ledger",
            "account",
            "create",
            "--name",
            "target two",
            "--category",
            "Cash",
            "--currency",
            target_id,
            "--opening-balance",
            "0.000",
        ],
    );
    let target_account_two_id = target_account_two["id"].as_str().unwrap();
    let target_entry = json_success(
        home.path(),
        &[
            "ledger",
            "entry",
            "add",
            "--date",
            "2026-07-30",
            "--type",
            "expense",
            "--amount",
            "1.234",
            "--currency",
            target_id,
            "--account",
            target_account_id,
            "--category",
            "food",
            "--content",
            "Paged precision",
        ],
    );
    let target_entry_id = target_entry["id"].as_str().unwrap();
    assert_eq!(
        json_success(
            home.path(),
            &[
                "ledger",
                "entry",
                "update",
                target_entry_id,
                "--currency",
                "ZZZ",
                "--amount",
                "2.345",
            ],
        )["amount_minor"],
        2345
    );
    assert_eq!(
        json_success(
            home.path(),
            &[
                "ledger",
                "account",
                "update",
                &candidate_id,
                "--currency",
                "Zed target",
                "--opening-balance",
                "3.456",
            ],
        )["opening_balance_minor"],
        3456
    );
    let transfer = json_success(
        home.path(),
        &[
            "ledger",
            "transfer",
            "--operation-key",
            "018f31c0-5c2a-4e75-9c18-a14d7bddb2a2",
            "--date",
            "2026-07-30",
            "--amount",
            "0.111",
            "--currency",
            "ZZZ",
            "--from-account",
            target_account_id,
            "--to-account",
            target_account_two_id,
            "--content",
            "Paged transfer",
        ],
    );
    assert!(transfer["transfer_group_id"].is_string());

    let inactive = json_success(
        home.path(),
        &[
            "ledger",
            "currency",
            "create",
            "--code",
            "INA",
            "--name",
            "Inactive precision",
            "--symbol",
            "I",
            "--decimal-places",
            "3",
        ],
    );
    let inactive_id = inactive["id"].as_str().unwrap().to_string();
    json_success(
        home.path(),
        &[
            "ledger",
            "currency",
            "update",
            &inactive_id,
            "--active",
            "false",
        ],
    );
    let deleted = json_success(
        home.path(),
        &[
            "ledger",
            "currency",
            "create",
            "--code",
            "DEL",
            "--name",
            "Deleted precision",
            "--symbol",
            "D",
            "--decimal-places",
            "3",
        ],
    );
    let deleted_id = deleted["id"].as_str().unwrap().to_string();
    for code in ["AM1", "AM2"] {
        json_success(
            home.path(),
            &[
                "ledger",
                "currency",
                "create",
                "--code",
                code,
                "--name",
                "Ambiguous precision",
                "--symbol",
                code,
                "--decimal-places",
                "3",
            ],
        );
    }
    let connection = rusqlite::Connection::open(home.path().join("ledger.sqlite")).unwrap();
    connection
        .execute(
            "UPDATE currencies
             SET active = 0,
                 updated_at = '2099-07-30T00:00:00Z',
                 deleted_at = '2099-07-30T00:00:00Z'
             WHERE id = ?1",
            [&deleted_id],
        )
        .unwrap();
    drop(connection);

    let references = [
        (inactive_id.as_str(), 2),
        (deleted_id.as_str(), 4),
        ("00000000-0000-4000-8000-000000000000", 4),
        ("Ambiguous precision", 2),
    ];
    for (reference, expected) in references {
        let mut service = LedgerService::new(
            SqliteLedgerRepository::open(home.path().join("ledger.sqlite")).unwrap(),
        );
        let service_exit = match service.resolve_active_currency_precision(reference) {
            Ok(_) => 0,
            Err(LedgerError::Validation { .. } | LedgerError::Conflict(_)) => 2,
            Err(LedgerError::NotFound(_)) => 4,
            Err(_) => 1,
        };
        assert_eq!(service_exit, expected);

        let commands = [
            vec![
                "ledger".to_string(),
                "entry".to_string(),
                "add".to_string(),
                "--date".to_string(),
                "2026-07-30".to_string(),
                "--type".to_string(),
                "expense".to_string(),
                "--amount".to_string(),
                "1.000".to_string(),
                "--currency".to_string(),
                reference.to_string(),
                "--account".to_string(),
                "card".to_string(),
                "--category".to_string(),
                "food".to_string(),
                "--content".to_string(),
                "Policy matrix".to_string(),
            ],
            vec![
                "ledger".to_string(),
                "entry".to_string(),
                "update".to_string(),
                entry_id.clone(),
                "--currency".to_string(),
                reference.to_string(),
                "--amount".to_string(),
                "1.000".to_string(),
            ],
            vec![
                "ledger".to_string(),
                "account".to_string(),
                "create".to_string(),
                "--name".to_string(),
                "policy matrix".to_string(),
                "--category".to_string(),
                "Cash".to_string(),
                "--currency".to_string(),
                reference.to_string(),
                "--opening-balance".to_string(),
                "1.000".to_string(),
            ],
            vec![
                "ledger".to_string(),
                "account".to_string(),
                "update".to_string(),
                candidate_id.clone(),
                "--currency".to_string(),
                reference.to_string(),
                "--opening-balance".to_string(),
                "1.000".to_string(),
            ],
            vec![
                "ledger".to_string(),
                "transfer".to_string(),
                "--operation-key".to_string(),
                "018f31c0-5c2a-4e75-9c18-a14d7bddb2a3".to_string(),
                "--date".to_string(),
                "2026-07-30".to_string(),
                "--amount".to_string(),
                "1.000".to_string(),
                "--currency".to_string(),
                reference.to_string(),
                "--from-account".to_string(),
                "bank".to_string(),
                "--to-account".to_string(),
                "card".to_string(),
                "--content".to_string(),
                "Policy matrix".to_string(),
            ],
        ];
        for command in commands {
            let output = assert_exit_owned(home.path(), &command, service_exit);
            assert!(output.stdout.is_empty());
        }
    }
}

#[test]
fn briefing_table_escapes_currency_controls_without_changing_json() {
    let home = tempfile::tempdir().unwrap();
    success(home.path(), &["init"]);
    let code = "B\tR\r\n\u{1b}[31m";
    let currency = json_success(
        home.path(),
        &[
            "ledger",
            "currency",
            "create",
            "--code",
            code,
            "--name",
            "Briefing control",
            "--symbol",
            "B",
            "--decimal-places",
            "2",
        ],
    );
    let currency_id = currency["id"].as_str().unwrap();
    json_success(
        home.path(),
        &["ledger", "account-category", "create", "--name", "Cash"],
    );
    let account = json_success(
        home.path(),
        &[
            "ledger",
            "account",
            "create",
            "--name",
            "briefing account",
            "--category",
            "Cash",
            "--currency",
            currency_id,
            "--opening-balance",
            "0.00",
        ],
    );
    let account_id = account["id"].as_str().unwrap();
    json_success(
        home.path(),
        &[
            "ledger",
            "category",
            "create",
            "--name",
            "briefing expense",
            "--kind",
            "expense",
        ],
    );
    json_success(
        home.path(),
        &[
            "ledger",
            "entry",
            "add",
            "--date",
            "2024-02-29",
            "--type",
            "expense",
            "--amount",
            "1.23",
            "--currency",
            currency_id,
            "--account",
            account_id,
            "--category",
            "briefing expense",
            "--content",
            "Control",
        ],
    );

    let table = success(
        home.path(),
        &[
            "ledger",
            "briefing",
            "--from",
            "2024-02-29",
            "--to",
            "2024-02-29",
            "--format",
            "table",
        ],
    );
    let table = String::from_utf8(table.stdout).unwrap();
    assert_eq!(table.lines().count(), 2);
    assert!(table.lines().all(|line| line.matches('\t').count() == 6));
    assert!(!table.contains('\r'));
    assert!(!table.contains('\u{1b}'));
    assert!(table.contains(r"B\tR\r\n\u{001b}[31m"));

    let briefing = json_success(
        home.path(),
        &[
            "ledger",
            "briefing",
            "--from",
            "2024-02-29",
            "--to",
            "2024-02-29",
            "--format",
            "json",
        ],
    );
    assert_eq!(briefing["summary"]["currencies"][0]["currency_code"], code);
    assert!(briefing["markdown"].as_str().unwrap().contains(code));
}
