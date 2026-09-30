use std::process::Command;

fn run(home: &std::path::Path, args: &[&str]) -> serde_json::Value {
    let output = Command::new(env!("CARGO_BIN_EXE_raven"))
        .env("RAVEN_CONSOLE_LOG", "off")
        .args(["--home", home.to_str().unwrap()])
        .args(args)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).unwrap()
}

#[test]
fn health_reports_and_audit_read_records_without_writing() {
    let home = tempfile::tempdir().unwrap();
    let output = Command::new(env!("CARGO_BIN_EXE_raven"))
        .args(["--home", home.path().to_str().unwrap(), "init"])
        .output()
        .unwrap();
    assert!(output.status.success());
    let record = run(
        home.path(),
        &[
            "health",
            "bowel",
            "add",
            "--at",
            "2026-09-29T12:00:00+09:00",
            "--bristol",
            "4",
        ],
    );
    let before = std::fs::read(home.path().join("health.sqlite")).unwrap();
    let report = run(
        home.path(),
        &[
            "health",
            "reports",
            "--from",
            "2026-09-29",
            "--to",
            "2026-09-29",
            "--format",
            "json",
        ],
    );
    assert_eq!(report["bowel"]["current_count"], 1);
    let audit = run(
        home.path(),
        &[
            "health",
            "audit",
            "health_event",
            record["id"].as_str().unwrap(),
            "--format",
            "json",
        ],
    );
    assert_eq!(audit["items"].as_array().unwrap().len(), 1);
    assert_eq!(
        std::fs::read(home.path().join("health.sqlite")).unwrap(),
        before
    );
}

#[test]
fn ledger_reads_do_not_create_a_store() {
    let temp = tempfile::tempdir().unwrap();
    let home = temp.path().join("missing");
    let output = Command::new(env!("CARGO_BIN_EXE_raven"))
        .args([
            "--home",
            home.to_str().unwrap(),
            "ledger",
            "balances",
            "--format",
            "json",
        ])
        .output()
        .unwrap();
    assert!(!output.status.success());
    assert!(!home.join("ledger.sqlite").exists());
}

#[test]
fn health_reports_and_audit_are_available() {
    for command in ["reports", "audit"] {
        let output = Command::new(env!("CARGO_BIN_EXE_raven"))
            .args(["health", command, "--help"])
            .output()
            .unwrap();
        assert!(output.status.success(), "{command}");
    }
}

#[test]
fn transfer_update_is_available() {
    let output = Command::new(env!("CARGO_BIN_EXE_raven"))
        .args(["ledger", "transfer-update", "--help"])
        .output()
        .unwrap();
    assert!(output.status.success());
}

#[test]
fn transfer_update_preserves_both_minor_unit_amounts() {
    let home = tempfile::tempdir().unwrap();
    let output = Command::new(env!("CARGO_BIN_EXE_raven"))
        .args(["--home", home.path().to_str().unwrap(), "init"])
        .output()
        .unwrap();
    assert!(output.status.success());
    run(
        home.path(),
        &[
            "ledger",
            "currency",
            "create",
            "--code",
            "USD",
            "--name",
            "Dollar",
            "--symbol",
            "$",
            "--decimal-places",
            "2",
        ],
    );
    run(
        home.path(),
        &["ledger", "account-category", "create", "--name", "Cash"],
    );
    for name in ["bank", "cash"] {
        run(
            home.path(),
            &[
                "ledger",
                "account",
                "create",
                "--name",
                name,
                "--category",
                "Cash",
                "--currency",
                "USD",
                "--opening-balance",
                "0",
            ],
        );
    }
    let transfer = run(
        home.path(),
        &[
            "ledger",
            "transfer",
            "--operation-key",
            "018f31c0-5c2a-4e75-9c18-a14d7bddb2a1",
            "--date",
            "2026-09-29",
            "--amount",
            "1.23",
            "--currency",
            "USD",
            "--from-account",
            "bank",
            "--to-account",
            "cash",
            "--content",
            "Move",
        ],
    );
    let id = transfer["transfer_group_id"].as_str().unwrap();
    let payload = r#"{"date":"2026-09-29","amount":"2.34","currency":"USD","from_account":"bank","to_account":"cash","content":"Updated"}"#;
    let updated = run(
        home.path(),
        &["ledger", "transfer-update", id, "--json", payload],
    );
    assert_eq!(updated["amount_minor"], 234);
    let shown = run(
        home.path(),
        &["ledger", "transfer-show", id, "--format", "json"],
    );
    assert_eq!(shown["amount_minor"], 234);
    assert_eq!(shown["out_entry"]["amount_minor"], 234);
    assert_eq!(shown["in_entry"]["amount_minor"], 234);
    let invalid = payload.replace("USD", "BAD");
    let rejected = Command::new(env!("CARGO_BIN_EXE_raven"))
        .args([
            "--home",
            home.path().to_str().unwrap(),
            "ledger",
            "transfer-update",
            id,
            "--json",
            &invalid,
        ])
        .output()
        .unwrap();
    assert!(!rejected.status.success());
    assert_eq!(
        run(
            home.path(),
            &["ledger", "transfer-show", id, "--format", "json"]
        ),
        shown
    );
}
