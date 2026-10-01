use serde_json::Value;
use std::path::Path;
use std::process::{Command, Output};
fn run(home: &Path, args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_raven"))
        .arg("--home")
        .arg(home)
        .args(["--error-format", "json"])
        .args(args)
        .output()
        .unwrap()
}
#[test]
fn json_errors_are_one_safe_object() {
    let home = tempfile::tempdir().unwrap();
    let output = run(home.path(), &["health", "bowel", "add", "--bristol", "250"]);
    assert_eq!(output.status.code(), Some(2));
    let error: Value = serde_json::from_slice(&output.stderr).unwrap();
    assert_eq!(error["code"], "validation_error");
    assert_eq!(error["committed"], false);
    let output = run(home.path(), &["--unknown-secret-path"]);
    assert_eq!(output.status.code(), Some(2));
    let error: Value = serde_json::from_slice(&output.stderr).unwrap();
    assert_eq!(error["code"], "invalid_arguments");
    assert!(!String::from_utf8_lossy(&output.stderr).contains("unknown-secret-path"));
}
#[test]
fn request_replays_and_conflicts() {
    let home = tempfile::tempdir().unwrap();
    assert!(run(home.path(), &["init"]).status.success());
    let args = ["--request-key", "area-1", "todo", "area", "create", "Work"];
    let first = run(home.path(), &args);
    assert!(
        first.status.success(),
        "{}",
        String::from_utf8_lossy(&first.stderr)
    );
    let replay = run(home.path(), &args);
    assert!(replay.status.success());
    assert_eq!(first.stdout, replay.stdout);
    let conflict = run(
        home.path(),
        &["--request-key", "area-1", "todo", "area", "create", "Other"],
    );
    assert_eq!(conflict.status.code(), Some(2));
    let value: Value = serde_json::from_slice(&conflict.stderr).unwrap();
    assert_eq!(value["code"], "request_key_conflict");
}
#[test]
fn unsupported_request_does_not_create_home() {
    let temp = tempfile::tempdir().unwrap();
    let home = temp.path().join("absent");
    let output = run(&home, &["--request-key", "read", "health-check"]);
    assert_eq!(output.status.code(), Some(2));
    assert!(!home.exists());
}
#[test]
fn pending_outcome_is_never_reexecuted() {
    let home = tempfile::tempdir().unwrap();
    let args = ["--request-key", "pending", "todo", "area", "create", "Work"];
    assert!(run(home.path(), &["init"]).status.success());
    assert!(run(home.path(), &args).status.success());
    let db = rusqlite::Connection::open(home.path().join("retry.sqlite")).unwrap();
    db.execute(
        "UPDATE receipts SET stdout=NULL WHERE request_key='pending'",
        [],
    )
    .unwrap();
    let output = run(home.path(), &args);
    assert_eq!(output.status.code(), Some(1));
    let error: Value = serde_json::from_slice(&output.stderr).unwrap();
    assert_eq!(error["code"], "request_outcome_unknown");
    assert!(error["committed"].is_null());
    assert_eq!(error["retryable"], false);
}
#[test]
fn validation_failure_allows_corrected_retry() {
    let home = tempfile::tempdir().unwrap();
    assert!(run(home.path(), &["init"]).status.success());
    let output = run(
        home.path(),
        &[
            "--request-key",
            "bowel",
            "health",
            "bowel",
            "add",
            "--bristol",
            "8",
            "--at",
            "2026-09-30T12:00:00Z",
        ],
    );
    assert_eq!(output.status.code(), Some(2));
    let output = run(
        home.path(),
        &[
            "--request-key",
            "bowel",
            "health",
            "bowel",
            "add",
            "--bristol",
            "4",
            "--at",
            "2026-09-30T12:00:00Z",
        ],
    );
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
}
#[test]
fn concurrent_requests_do_not_duplicate() {
    let home = tempfile::tempdir().unwrap();
    assert!(run(home.path(), &["init"]).status.success());
    let args = [
        "--request-key",
        "concurrent",
        "todo",
        "area",
        "create",
        "Work",
    ];
    std::thread::scope(|scope| {
        let a = scope.spawn(|| run(home.path(), &args));
        let b = scope.spawn(|| run(home.path(), &args));
        let a = a.join().unwrap();
        let b = b.join().unwrap();
        assert!(a.status.success() || b.status.success());
        if a.status.success() && b.status.success() {
            assert_eq!(a.stdout, b.stdout);
        } else {
            let failed = if a.status.success() { b } else { a };
            let error: Value = serde_json::from_slice(&failed.stderr).unwrap();
            assert_eq!(error["code"], "request_outcome_unknown");
        }
    });
    let db = rusqlite::Connection::open(home.path().join("todo.sqlite")).unwrap();
    let count: i64 = db
        .query_row("SELECT COUNT(*) FROM items WHERE title='Work'", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(count, 1);
}
#[test]
fn error_format_in_data_is_not_a_switch() {
    let args = [
        "raven",
        "health",
        "diet",
        "add",
        "--food",
        "--error-format=json",
    ]
    .map(std::ffi::OsString::from);
    assert!(!raven_cli::errors::json_requested(&args));
}
#[test]
fn keyed_help_has_no_receipt() {
    let temp = tempfile::tempdir().unwrap();
    let home = temp.path().join("absent");
    let output = run(
        &home,
        &["--request-key", "help", "todo", "task", "create", "--help"],
    );
    assert_eq!(output.status.code(), Some(0));
    assert!(String::from_utf8_lossy(&output.stdout).contains("Usage:"));
    assert!(!home.exists());
}
#[test]
fn todo_json_validation_is_quiet_and_failed_key_can_retry() {
    let home = tempfile::tempdir().unwrap();
    assert!(run(home.path(), &["init"]).status.success());
    assert!(
        run(home.path(), &["todo", "area", "create", "Work"])
            .status
            .success()
    );
    let failed = run(
        home.path(),
        &[
            "--request-key",
            "todo-validation",
            "todo",
            "project",
            "create",
            "Project",
        ],
    );
    assert_eq!(failed.status.code(), Some(2));
    let error: Value = serde_json::from_slice(&failed.stderr).unwrap();
    assert_eq!(error["code"], "policy_error");
    assert_eq!(error["committed"], false);
    let db = rusqlite::Connection::open(home.path().join("retry.sqlite")).unwrap();
    let count: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM receipts WHERE request_key='todo-validation'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 0);
    let corrected = run(
        home.path(),
        &[
            "--request-key",
            "todo-validation",
            "todo",
            "project",
            "create",
            "Project",
            "--definition-of-done",
            "Delivered",
            "--area",
            "Work",
        ],
    );
    assert!(
        corrected.status.success(),
        "{}",
        String::from_utf8_lossy(&corrected.stderr)
    );
    assert!(corrected.stderr.is_empty());
}
#[test]
fn cleanup_pending_is_committed_and_hides_storage_details() {
    let error = anyhow::Error::new(
        health_engine::application::error::HealthError::CleanupPending {
            record_id: "record-1".into(),
            message: "private/path SELECT secret".into(),
        },
    );
    let value = serde_json::to_value(raven_cli::errors::describe(&error)).unwrap();
    assert_eq!(value["code"], "cleanup_pending");
    assert_eq!(value["record_id"], "record-1");
    assert_eq!(value["committed"], true);
    assert_eq!(value["retryable"], false);
    assert!(!value.to_string().contains("private/path"));
}
#[test]
fn malformed_dotenv_text_does_not_echo_secret_line() {
    let working = tempfile::tempdir().unwrap();
    let home = working.path().join("data");
    let secret = "private-secret-never-echo";
    std::fs::write(
        working.path().join(".env"),
        format!("RAVEN_HOME='unterminated-{secret}\n"),
    )
    .unwrap();
    let output = Command::new(env!("CARGO_BIN_EXE_raven"))
        .current_dir(working.path())
        .arg("--home")
        .arg(home)
        .arg("init")
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(1));
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(stderr.contains("failed to parse .env"));
    assert!(!stderr.contains(secret));
}

#[test]
fn timed_out_mutation_keeps_uncertain_receipt() {
    let home = tempfile::tempdir().unwrap();
    assert!(run(home.path(), &["init"]).status.success());
    let db = rusqlite::Connection::open(home.path().join("todo.sqlite")).unwrap();
    db.execute_batch("BEGIN EXCLUSIVE;").unwrap();
    let args = [
        "--request-key",
        "timeout",
        "--request-timeout-seconds",
        "1",
        "todo",
        "area",
        "create",
        "Blocked",
    ];
    let timed_out = run(home.path(), &args);
    assert_eq!(timed_out.status.code(), Some(1));
    let error: Value = serde_json::from_slice(&timed_out.stderr).unwrap();
    assert_eq!(error["code"], "request_timeout");
    assert!(error["committed"].is_null());
    assert_eq!(error["retryable"], false);
    db.execute_batch("ROLLBACK;").unwrap();
    let replay = run(home.path(), &args);
    let error: Value = serde_json::from_slice(&replay.stderr).unwrap();
    assert_eq!(error["code"], "request_outcome_unknown");
    let count: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM items WHERE title='Blocked'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 0);
}
#[test]
fn validation_fields_explain_safe_constraints_without_echoing_input() {
    let todo = anyhow::Error::new(todo_engine::application::error::TodoError::Policy(
        "Routine requires recurrence_rule".into(),
    ));
    assert!(raven_cli::errors::describe(&todo).fields["recurrence_rule"].contains("RRULE"));
    let todo = anyhow::Error::new(todo_engine::application::error::TodoError::Validation(
        "expected_updated_at must be RFC 3339".into(),
    ));
    assert!(raven_cli::errors::describe(&todo).fields["expected_updated_at"].contains("RFC3339"));
    let health = anyhow::Error::new(health_engine::application::error::HealthError::Validation {
        field: "record",
        message: health_engine::domain::ValidationError::InvalidBristolScale.to_string(),
    });
    assert_eq!(
        raven_cli::errors::describe(&health).fields["bristol"],
        "Must be an integer from 1 through 7."
    );
    let health = anyhow::Error::new(health_engine::application::error::HealthError::Validation {
        field: "record",
        message: "unsupported meal type: private/path SELECT token".into(),
    });
    let value = serde_json::to_value(raven_cli::errors::describe(&health)).unwrap();
    assert!(
        value["fields"]["meal"]
            .as_str()
            .unwrap()
            .contains("late_night")
    );
    assert!(!value.to_string().contains("private/path"));
    let ledger = anyhow::Error::new(ledger_engine::application::error::LedgerError::Validation {
        field: "json",
        message: "unknown field private-token SELECT secret".into(),
    });
    assert!(
        !serde_json::to_string(&raven_cli::errors::describe(&ledger))
            .unwrap()
            .contains("private-token")
    );
}
