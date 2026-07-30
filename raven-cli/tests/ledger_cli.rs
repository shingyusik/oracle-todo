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
