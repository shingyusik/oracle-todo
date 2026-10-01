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
fn all_master_commands_create_update_list_and_reject_removed_purge() {
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
    assert_exit(
        home.path(),
        &["ledger", "category", "purge", category_id],
        2,
    );
    assert_exit(
        home.path(),
        &["ledger", "currency", "purge", currency_id],
        2,
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
fn transfer_retries_are_idempotent_and_archive_restore_preserve_the_pair() {
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

    assert_exit(home.path(), &["ledger", "entry", "purge", out_id], 2);
    json_success(
        home.path(),
        &["ledger", "entry", "show", out_id, "--format", "json"],
    );
}

#[test]
fn reports_balances_doctor_and_export_are_structured_and_deterministic() {
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
fn mutation_help_documents_input_modes_and_canonical_formats() {
    let home = tempfile::tempdir().unwrap();
    let entry =
        String::from_utf8(success(home.path(), &["ledger", "entry", "add", "--help"]).stdout)
            .unwrap();
    for required in [
        "--json",
        "--date YYYY-MM-DD",
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
    assert!(entry.contains("Expense and income entries require --category"));
    assert!(entry.contains("--account cash --category food --content Lunch"));
    assert!(entry.contains(r#""account":"cash","category":"food","content":"Lunch""#));

    let transfer =
        String::from_utf8(success(home.path(), &["ledger", "transfer", "--help"]).stdout).unwrap();
    for required in [
        "--json",
        "--operation-key",
        "UUID v4",
        "--date YYYY-MM-DD",
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
fn public_entry_metadata_adjustment_creation_and_manual_comparison_are_rejected() {
    let home = tempfile::tempdir().unwrap();
    init_and_seed(home.path());
    for field in ["written_at", "source", "actor", "reason"] {
        let mut payload = serde_json::json!({"date":"2026-09-30","content":"policy","category":"food","account":"card","entry_type":"expense","amount":"1","currency":"KRW"});
        payload[field] = Value::String("caller".into());
        assert_exit(
            home.path(),
            &["ledger", "entry", "add", "--json", &payload.to_string()],
            2,
        );
    }
    for kind in ["adjustment_out", "adjustment_in"] {
        let payload = serde_json::json!({"date":"2026-09-30","content":"policy","category":"food","account":"card","entry_type":kind,"amount":"1","currency":"KRW"}).to_string();
        assert_exit(
            home.path(),
            &["ledger", "entry", "add", "--json", &payload],
            2,
        );
    }
    let report = json_success(
        home.path(),
        &[
            "ledger",
            "compare",
            "--from",
            "2026-07-01",
            "--to",
            "2026-07-03",
            "--format",
            "json",
        ],
    );
    assert_eq!(report["current"]["range"]["start"], "2026-07-01");
    assert_eq!(report["previous"]["range"]["end"], "2026-06-30");
    assert_exit(
        home.path(),
        &["ledger", "compare", "--current-from", "2026-07-01"],
        2,
    );
    let list = json_success(
        home.path(),
        &["ledger", "entry", "list", "--format", "json"],
    );
    assert!(list["items"].as_array().unwrap().is_empty());
}
#[test]
fn journal_cli_entry_mutation_help_excludes_historical_types() {
    let home = tempfile::tempdir().unwrap();
    for command in ["add", "update"] {
        let help =
            String::from_utf8(success(home.path(), &["ledger", "entry", command, "--help"]).stdout)
                .unwrap();
        assert!(help.contains("expense"));
        assert!(help.contains("income"));
        for unsupported in [
            "transfer_out",
            "transfer_in",
            "adjustment_out",
            "adjustment_in",
        ] {
            assert!(
                !help.contains(unsupported),
                "unexpected {unsupported}: {help}"
            );
        }
    }
    let help =
        String::from_utf8(success(home.path(), &["ledger", "entry", "list", "--help"]).stdout)
            .unwrap();
    assert!(help.contains("adjustment_in"));
}

#[test]
fn master_search_includes_inactive_and_filters_before_paging() {
    let home = tempfile::tempdir().unwrap();
    success(home.path(), &["init"]);
    for name in ["Alpha", "Match A", "Match B", "Zebra"] {
        let category = json_success(
            home.path(),
            &["ledger", "account-category", "create", "--name", name],
        );
        if name == "Match A" {
            json_success(
                home.path(),
                &[
                    "ledger",
                    "account-category",
                    "update",
                    category["id"].as_str().unwrap(),
                    "--active",
                    "false",
                ],
            );
        }
    }
    let first = json_success(
        home.path(),
        &[
            "ledger",
            "account-category",
            "list",
            "--query",
            "match",
            "--include-inactive",
            "--limit",
            "1",
            "--format",
            "json",
        ],
    );
    assert_eq!(first["items"].as_array().unwrap().len(), 1);
    assert_eq!(first["next"], 1);
    let second = json_success(
        home.path(),
        &[
            "ledger",
            "account-category",
            "list",
            "--query",
            "MATCH",
            "--include-inactive",
            "--offset",
            "1",
            "--limit",
            "1",
            "--format",
            "json",
        ],
    );
    assert_eq!(second["items"].as_array().unwrap().len(), 1);
    assert!(second["next"].is_null());
    let active = json_success(
        home.path(),
        &[
            "ledger",
            "account-category",
            "list",
            "--query",
            "match",
            "--format",
            "json",
        ],
    );
    assert_eq!(active["items"].as_array().unwrap().len(), 1);
}
#[test]
fn ledger_table_query_and_lookups_share_ui_schema() {
    let home = tempfile::tempdir().unwrap();
    init_and_seed(home.path());
    let query = r#"{"scope":"ledger.accounts","filters":[{"field":"name","operator":"contains","value":{"text":"card"}}],"sorts":[{"field":"name","direction":"asc"}],"group_by":"none","group_settings":{"sort":"alphabetical","hide_empty":false,"manual_order":[],"hidden_group_keys":[]}}"#;
    let result = json_success(home.path(), &["ledger", "table", "query", "--json", query]);
    assert_eq!(result["items"].as_array().unwrap().len(), 1);
    assert!(result["next_offset"].is_null());
    let lookups = json_success(
        home.path(),
        &["ledger", "table", "lookups", "--scope", "ledger.accounts"],
    );
    assert!(
        lookups["currencies"]
            .as_array()
            .unwrap()
            .iter()
            .any(|option| option["label"] == "KRW")
    );
    assert_exit(
        home.path(),
        &[
            "ledger",
            "table",
            "query",
            "--json",
            "{\"scope\":\"ledger.accounts\",\"unknown\":true}",
        ],
        2,
    );
}
