use std::collections::BTreeMap;
use std::process::{Command, Output};

use serde_json::{Value, json};

#[path = "../../raven-api/tests/support/retention_fixture.rs"]
mod fixture;

use fixture::FixtureHome;

fn raven(home: &std::path::Path, args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_raven"))
        .args(["--home", home.to_str().unwrap()])
        .args(args)
        .env_remove("RAVEN_RETENTION")
        .env("RAVEN_CONSOLE_LOG", "off")
        .output()
        .unwrap()
}

fn json_stdout(output: &Output) -> Value {
    serde_json::from_slice(&output.stdout).unwrap_or_else(|_| {
        panic!(
            "stdout is not JSON: {}\nstderr: {}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        )
    })
}

#[test]
fn show_and_set_round_trip_with_validation_exit_codes() {
    let fixture = FixtureHome::empty();
    let output = raven(
        &fixture.home,
        &["maintenance", "retention", "show", "--format", "json"],
    );
    assert!(output.status.success());
    assert_eq!(
        json_stdout(&output),
        json!({
            "settings": {"enabled": true, "retention_days": 30, "backup_keep": 3},
            "env_override": null,
            "schedule": {"interval_hours": 24, "scheduler_active": false, "next_run_at": null},
            "last_run": null,
        })
    );

    let output = raven(
        &fixture.home,
        &[
            "maintenance",
            "retention",
            "set",
            "--enabled",
            "false",
            "--days",
            "45",
            "--backup-keep",
            "5",
            "--format",
            "json",
        ],
    );
    assert!(output.status.success());
    assert_eq!(
        json_stdout(&output)["settings"],
        json!({"enabled": false, "retention_days": 45, "backup_keep": 5})
    );
    let output = raven(&fixture.home, &["maintenance", "retention", "show"]);
    assert!(output.status.success());
    let text = String::from_utf8(output.stdout).unwrap();
    assert!(text.contains("enabled: false"), "{text}");
    assert!(text.contains("retention_days: 45"), "{text}");

    let output = raven(
        &fixture.home,
        &[
            "--error-format",
            "json",
            "maintenance",
            "retention",
            "set",
            "--days",
            "3",
        ],
    );
    assert_eq!(output.status.code(), Some(2));
    let error: Value = serde_json::from_slice(&output.stderr).unwrap();
    assert_eq!(error["code"], "validation_error");
    assert!(error["fields"]["retention_days"].is_string());

    let output = raven(&fixture.home, &["maintenance", "retention", "set"]);
    assert_eq!(output.status.code(), Some(2), "set requires a change");
    let output = raven(&fixture.home, &["maintenance", "purge"]);
    assert_eq!(output.status.code(), Some(2), "purge requires a mode");
    let output = raven(
        &fixture.home,
        &["maintenance", "purge", "--dry-run", "--apply"],
    );
    assert_eq!(output.status.code(), Some(2), "modes are exclusive");
}

#[test]
fn dry_run_counts_match_apply_counts() {
    let fixture = FixtureHome::initialized();
    let seeded = fixture::seed(&fixture);
    let output = raven(
        &fixture.home,
        &[
            "maintenance",
            "purge",
            "--dry-run",
            "--limit",
            "1",
            "--format",
            "json",
        ],
    );
    assert!(output.status.success());
    let preview = json_stdout(&output);
    assert_eq!(preview["retention_days"], 30);
    assert_eq!(
        preview["domains"]["todo"]["items"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(preview["domains"]["todo"]["truncated"], true);
    assert!(
        !fixture.home.join("backups").exists(),
        "dry run never backs up"
    );
    assert_eq!(
        fixture::count(
            &fixture.todo_db(),
            "SELECT COUNT(*) FROM items WHERE id = ?1",
            &seeded.todo_old[0]
        ),
        1,
        "dry run never purges"
    );

    let output = raven(
        &fixture.home,
        &["maintenance", "purge", "--apply", "--format", "json"],
    );
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let report = json_stdout(&output);
    assert_eq!(report["skipped"], Value::Null);
    let last = &report["last_run"];
    assert_eq!(last["trigger"], "cli");
    assert_eq!(last["outcome"], "ok");
    let mut expected_total = BTreeMap::new();
    for domain in ["todo", "ledger", "health"] {
        assert_eq!(
            last["domains"][domain]["purged"], preview["domains"][domain]["counts"],
            "{domain}"
        );
        for (kind, count) in preview["domains"][domain]["counts"].as_object().unwrap() {
            expected_total.insert(kind.clone(), count.as_u64().unwrap());
        }
    }
    assert_eq!(
        expected_total,
        BTreeMap::from(
            [
                ("todo_item", 2),
                ("ledger_entry", 1),
                ("ledger_transfer", 1),
                ("health_diet", 1),
                ("health_bowel", 1),
                ("health_media", 1),
            ]
            .map(|(kind, count)| (kind.to_owned(), count))
        )
    );
    let backup = last["backup"]["name"].as_str().unwrap();
    assert!(
        fixture
            .backups_dir()
            .join(backup)
            .join("manifest.json")
            .is_file()
    );

    // Logs carry counts only.
    let log = std::fs::read_to_string(fixture.home.join("logs/raven.log.jsonl")).unwrap();
    assert!(log.contains("retention_run_completed"));
    for secret in fixture::SECRET_TITLES.iter().copied().chain([
        seeded.todo_old[0].as_str(),
        seeded.ledger_old_entry.as_str(),
    ]) {
        assert!(!log.contains(secret), "log leaks {secret}");
    }

    let output = raven(&fixture.home, &["maintenance", "purge", "--apply"]);
    assert!(output.status.success());
    let text = String::from_utf8(output.stdout).unwrap();
    assert!(text.contains("last_run: nothing_due"), "{text}");
    let output = raven(&fixture.home, &["ledger", "doctor"]);
    assert!(
        output.status.success(),
        "ledger doctor: {}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}

#[test]
fn apply_while_locked_exits_two() {
    let fixture = FixtureHome::initialized();
    let maintenance = fixture.home.join("maintenance");
    std::fs::create_dir_all(&maintenance).unwrap();
    let held = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(maintenance.join("retention.lock"))
        .unwrap();
    held.try_lock().unwrap();
    let output = raven(
        &fixture.home,
        &["--error-format", "json", "maintenance", "purge", "--apply"],
    );
    assert_eq!(output.status.code(), Some(2));
    let error: Value = serde_json::from_slice(&output.stderr).unwrap();
    assert_eq!(error["code"], "retention_in_progress");
    drop(held);
}

#[test]
fn storage_errors_exit_one() {
    let fixture = FixtureHome::empty();
    let maintenance = fixture.home.join("maintenance");
    std::fs::create_dir_all(&maintenance).unwrap();
    std::fs::write(maintenance.join("retention.json"), b"{not json").unwrap();
    let output = raven(
        &fixture.home,
        &["--error-format", "json", "maintenance", "retention", "show"],
    );
    assert_eq!(output.status.code(), Some(1));
    let error: Value = serde_json::from_slice(&output.stderr).unwrap();
    assert_eq!(error["code"], "storage_error");
    assert!(
        !String::from_utf8_lossy(&output.stderr).contains(fixture.home.to_str().unwrap()),
        "errors never echo paths"
    );
}
