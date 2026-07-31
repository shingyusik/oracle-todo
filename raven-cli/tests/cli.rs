use std::process::Command;

fn raven(home: &std::path::Path) -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_raven"));
    command.args(["--home", home.to_str().unwrap()]);
    command
}

fn raven_log_events(home: &std::path::Path) -> Vec<serde_json::Value> {
    std::fs::read_to_string(home.join("logs/raven.log.jsonl"))
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect()
}

fn command_events<'a>(events: &'a [serde_json::Value], event: &str) -> Vec<&'a serde_json::Value> {
    labeled_command_events(events, "todo", event)
}

fn labeled_command_events<'a>(
    events: &'a [serde_json::Value],
    command: &str,
    event: &str,
) -> Vec<&'a serde_json::Value> {
    events
        .iter()
        .filter(|record| {
            record["fields"]["command"] == command && record["fields"]["event"] == event
        })
        .collect()
}

fn assert_todo_failed_with_exit(home: &std::path::Path, expected_exit: i64) {
    let events = raven_log_events(home);
    assert_eq!(command_events(&events, "command_started").len(), 1);
    let failed = command_events(&events, "command_failed");
    assert_eq!(failed.len(), 1);
    assert_eq!(failed[0]["fields"]["exit_code"], expected_exit);
    assert!(failed[0]["fields"]["duration_ms"].is_number());
    assert!(command_events(&events, "command_completed").is_empty());
}

#[test]
fn raven_binary_prints_raven_help() {
    let output = Command::new(env!("CARGO_BIN_EXE_raven"))
        .arg("--help")
        .output()
        .unwrap();

    assert!(output.status.success());

    let stdout = String::from_utf8(output.stdout).unwrap();
    assert!(stdout.contains("Raven unified personal engine"));
    assert!(stdout.contains("Usage: raven"));
}

#[test]
fn raven_init_creates_todo_and_ledger_databases_and_media_directory() {
    let home = tempfile::tempdir().unwrap();

    let status = raven(home.path()).arg("init").status().unwrap();

    assert!(status.success());
    let status = raven(home.path()).args(["todo", "today"]).status().unwrap();

    assert!(status.success());
    assert!(home.path().join("todo.sqlite").exists());
    assert!(home.path().join("ledger.sqlite").exists());
    assert!(home.path().join("health.sqlite").exists());
    assert!(home.path().join("media/health").is_dir());
}

#[test]
fn raven_todo_delegates_existing_commands() {
    let home = tempfile::tempdir().unwrap();

    let status = raven(home.path()).args(["todo", "init"]).status().unwrap();

    assert!(status.success());
    assert!(home.path().join("todo.sqlite").exists());
}

#[test]
fn raven_todo_invalid_command_logs_a_terminal_exit_two_event() {
    let home = tempfile::tempdir().unwrap();

    let output = raven(home.path())
        .env("RAVEN_CONSOLE_LOG", "off")
        .args(["todo", "definitely-not-a-command"])
        .output()
        .unwrap();

    assert_eq!(output.status.code(), Some(2));
    assert!(
        String::from_utf8(output.stderr)
            .unwrap()
            .contains("unrecognized subcommand")
    );
    let events = raven_log_events(home.path());
    assert_eq!(command_events(&events, "command_started").len(), 1);
    let failed = command_events(&events, "command_failed");
    assert_eq!(failed.len(), 1);
    assert_eq!(failed[0]["fields"]["exit_code"], 2);
    assert!(failed[0]["fields"]["duration_ms"].is_number());
    assert!(command_events(&events, "command_completed").is_empty());
}

#[test]
fn raven_todo_help_logs_a_terminal_exit_zero_event() {
    let home = tempfile::tempdir().unwrap();

    let output = raven(home.path())
        .env("RAVEN_CONSOLE_LOG", "off")
        .args(["todo", "--help"])
        .output()
        .unwrap();

    assert!(output.status.success());
    assert!(
        String::from_utf8(output.stdout)
            .unwrap()
            .contains("Policy-enforced personal ToDo engine")
    );
    let events = raven_log_events(home.path());
    assert_eq!(command_events(&events, "command_started").len(), 1);
    let completed = command_events(&events, "command_completed");
    assert_eq!(completed.len(), 1);
    assert_eq!(completed[0]["fields"]["exit_code"], 0);
    assert!(completed[0]["fields"]["duration_ms"].is_number());
    assert!(command_events(&events, "command_failed").is_empty());
}

#[test]
fn raven_todo_policy_failure_preserves_exit_two_and_safe_terminal_logging() {
    let home = tempfile::tempdir().unwrap();
    assert!(raven(home.path()).arg("init").status().unwrap().success());

    let output = raven(home.path())
        .env("RAVEN_CONSOLE_LOG", "off")
        .args(["todo", "project", "propose", "private policy title"])
        .output()
        .unwrap();

    assert_eq!(output.status.code(), Some(2));
    assert_todo_failed_with_exit(home.path(), 2);
    let log = std::fs::read_to_string(home.path().join("logs/raven.log.jsonl")).unwrap();
    assert!(!log.contains("private policy title"));
    assert!(!log.contains(home.path().to_str().unwrap()));
}

#[test]
fn raven_todo_not_found_failure_preserves_exit_four_and_terminal_logging() {
    let home = tempfile::tempdir().unwrap();
    assert!(raven(home.path()).arg("init").status().unwrap().success());

    let output = raven(home.path())
        .env("RAVEN_CONSOLE_LOG", "off")
        .args(["todo", "complete", "missing_item"])
        .output()
        .unwrap();

    assert_eq!(output.status.code(), Some(4));
    assert_todo_failed_with_exit(home.path(), 4);
}

#[test]
fn raven_todo_storage_failure_preserves_exit_one_and_safe_terminal_logging() {
    let home = tempfile::tempdir().unwrap();
    std::fs::create_dir(home.path().join("todo.sqlite")).unwrap();

    let output = raven(home.path())
        .env("RAVEN_CONSOLE_LOG", "off")
        .args(["todo", "pending"])
        .output()
        .unwrap();

    assert_eq!(output.status.code(), Some(1));
    assert_todo_failed_with_exit(home.path(), 1);
    let log = std::fs::read_to_string(home.path().join("logs/raven.log.jsonl")).unwrap();
    assert!(!log.contains(home.path().to_str().unwrap()));
    assert!(!log.contains("unable to open"));
}

#[test]
fn raven_health_check_reports_a_corrupt_ledger_as_unavailable() {
    let home = tempfile::tempdir().unwrap();
    assert!(raven(home.path()).arg("init").status().unwrap().success());
    std::fs::write(home.path().join("ledger.sqlite"), b"not initialized").unwrap();

    let output = raven(home.path()).arg("health-check").output().unwrap();

    assert_eq!(output.status.code(), Some(1));
    let stdout = String::from_utf8(output.stdout).unwrap();
    assert!(stdout.contains("todo=ok"));
    assert!(stdout.contains("ledger=unavailable"));
    assert!(stdout.contains("health=ok"));
    assert!(
        String::from_utf8(output.stderr)
            .unwrap()
            .contains("Ledger database is unavailable")
    );
}

#[test]
fn raven_health_check_does_not_create_a_missing_todo_database() {
    let home = tempfile::tempdir().unwrap();
    let todo_db = home.path().join("todo.sqlite");

    let output = raven(home.path()).arg("health-check").output().unwrap();

    assert_eq!(output.status.code(), Some(1));
    assert!(
        String::from_utf8(output.stdout)
            .unwrap()
            .contains("todo=not_initialized")
    );
    let stderr = String::from_utf8(output.stderr).unwrap();
    assert!(stderr.contains("ToDo database is not initialized"));
    assert!(!stderr.contains(home.path().to_str().unwrap()));
    assert!(!todo_db.exists());
    let events = raven_log_events(home.path());
    assert_eq!(
        labeled_command_events(&events, "health-check", "command_started").len(),
        1
    );
    let failed = labeled_command_events(&events, "health-check", "command_failed");
    assert_eq!(failed.len(), 1);
    assert_eq!(failed[0]["fields"]["exit_code"], 1);
    assert!(failed[0]["fields"]["duration_ms"].is_number());
}

#[test]
fn raven_health_check_does_not_change_a_version_zero_todo_database() {
    let home = tempfile::tempdir().unwrap();
    let todo_db = home.path().join("todo.sqlite");
    std::fs::write(&todo_db, b"").unwrap();
    let before = std::fs::read(&todo_db).unwrap();

    let output = raven(home.path()).arg("health-check").output().unwrap();

    assert_eq!(output.status.code(), Some(1));
    assert!(
        String::from_utf8(output.stdout)
            .unwrap()
            .contains("todo=not_initialized")
    );
    assert_eq!(std::fs::read(todo_db).unwrap(), before);
}

#[test]
fn raven_health_check_rejects_an_unknown_todo_schema_version() {
    let home = tempfile::tempdir().unwrap();
    assert!(raven(home.path()).arg("init").status().unwrap().success());
    let connection = todo_engine::infrastructure::sqlite::connect(
        home.path().join("todo.sqlite").to_str().unwrap(),
    )
    .unwrap();
    connection
        .execute_batch("PRAGMA user_version = 2;")
        .unwrap();
    drop(connection);

    let output = raven(home.path()).arg("health-check").output().unwrap();

    assert_eq!(output.status.code(), Some(1));
    assert!(
        String::from_utf8(output.stdout)
            .unwrap()
            .contains("todo=unavailable")
    );
    let stderr = String::from_utf8(output.stderr).unwrap();
    assert!(stderr.contains("ToDo database is unavailable"));
    assert!(!stderr.contains("file is not a database"));
    assert!(!stderr.contains(home.path().to_str().unwrap()));
}

#[test]
fn raven_health_check_does_not_change_a_corrupt_todo_database() {
    let home = tempfile::tempdir().unwrap();
    let todo_db = home.path().join("todo.sqlite");
    std::fs::write(&todo_db, b"not a sqlite database").unwrap();
    let before = std::fs::read(&todo_db).unwrap();

    let output = raven(home.path()).arg("health-check").output().unwrap();

    assert_eq!(output.status.code(), Some(1));
    assert!(
        String::from_utf8(output.stdout)
            .unwrap()
            .contains("todo=unavailable")
    );
    let stderr = String::from_utf8(output.stderr).unwrap();
    assert!(stderr.contains("ToDo database is unavailable"));
    assert!(!stderr.contains("file is not a database"));
    assert!(!stderr.contains(home.path().to_str().unwrap()));
    assert_eq!(std::fs::read(todo_db).unwrap(), before);
}

#[test]
fn raven_health_check_rejects_a_non_file_todo_database_without_changing_it() {
    let home = tempfile::tempdir().unwrap();
    let todo_db = home.path().join("todo.sqlite");
    std::fs::create_dir(&todo_db).unwrap();

    let output = raven(home.path()).arg("health-check").output().unwrap();

    assert_eq!(output.status.code(), Some(1));
    assert!(
        String::from_utf8(output.stdout)
            .unwrap()
            .contains("todo=unavailable")
    );
    assert!(todo_db.is_dir());
    assert_eq!(std::fs::read_dir(todo_db).unwrap().count(), 0);
}

#[test]
fn raven_log_omits_sensitive_todo_arguments_and_paths() {
    let home = tempfile::tempdir().unwrap();
    assert!(raven(home.path()).arg("init").status().unwrap().success());

    let status = raven(home.path())
        .env("RAVEN_CONSOLE_LOG", "off")
        .args([
            "todo",
            "task",
            "propose",
            "private title",
            "--description",
            "private description",
            "--note",
            "private note",
        ])
        .status()
        .unwrap();

    assert!(status.success());
    let log = std::fs::read_to_string(home.path().join("logs/raven.log.jsonl")).unwrap();
    assert!(log.contains("\"engine\":\"todo\""));
    assert!(log.contains("\"command\":\"todo\""));
    assert!(log.contains("\"duration_ms\":"));
    assert!(log.contains("\"exit_code\":0"));
    assert!(!log.contains("\"target\":\"todo_engine"));
    assert!(!log.contains("private title"));
    assert!(!log.contains("private description"));
    assert!(!log.contains("private note"));
    assert!(!log.contains(home.path().to_str().unwrap()));
}

#[test]
fn raven_file_sink_failure_is_silent_when_console_logging_is_off() {
    let home = tempfile::tempdir().unwrap();
    let log_sink = home.path().join("logs/raven.log.jsonl");
    std::fs::create_dir_all(&log_sink).unwrap();

    let output = raven(home.path())
        .env("RAVEN_CONSOLE_LOG", "off")
        .arg("init")
        .output()
        .unwrap();

    assert!(output.status.success());
    assert!(output.stderr.is_empty());
    assert!(log_sink.is_dir());
}

#[test]
fn raven_file_sink_failure_uses_only_a_fixed_safe_warning() {
    let home = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(home.path().join("logs/raven.log.jsonl")).unwrap();

    let output = raven(home.path())
        .env("RAVEN_CONSOLE_LOG", "warn")
        .arg("init")
        .output()
        .unwrap();

    assert!(output.status.success());
    let stderr = String::from_utf8(output.stderr).unwrap();
    assert!(stderr.contains("Raven file logging unavailable"));
    assert!(!stderr.contains(home.path().to_str().unwrap()));
    assert!(!stderr.contains("os error"));
    assert!(!stderr.contains("error="));
}

#[test]
fn raven_rotation_failure_is_silent_when_console_logging_is_off() {
    let home = tempfile::tempdir().unwrap();
    let logs = home.path().join("logs");
    std::fs::create_dir_all(&logs).unwrap();
    std::fs::write(logs.join("raven.log.jsonl"), b"existing log\n").unwrap();
    std::fs::create_dir(logs.join("raven.log.jsonl.1")).unwrap();

    let output = raven(home.path())
        .env("RAVEN_CONSOLE_LOG", "off")
        .env("RAVEN_LOG_MAX_BYTES", "1")
        .env("RAVEN_LOG_MAX_FILES", "1")
        .arg("init")
        .output()
        .unwrap();

    assert!(output.status.success());
    assert!(output.stderr.is_empty());
    assert_eq!(
        std::fs::read_to_string(logs.join("raven.log.jsonl")).unwrap(),
        "existing log\n"
    );
}

#[test]
fn raven_file_log_off_creates_no_log_file() {
    let home = tempfile::tempdir().unwrap();

    let output = raven(home.path())
        .env("RAVEN_CONSOLE_LOG", "off")
        .env("RAVEN_FILE_LOG", "off")
        .arg("init")
        .output()
        .unwrap();

    assert!(output.status.success());
    assert!(!home.path().join("logs/raven.log.jsonl").exists());
}

#[test]
fn raven_rotation_honors_backup_count_and_keeps_all_logs_private() {
    let home = tempfile::tempdir().unwrap();
    for args in [
        &["init"][..],
        &[
            "todo",
            "task",
            "propose",
            "private rotated title",
            "--note",
            "private rotated note",
        ][..],
    ] {
        let output = raven(home.path())
            .env("RAVEN_CONSOLE_LOG", "off")
            .env("RAVEN_LOG_MAX_BYTES", "1")
            .env("RAVEN_LOG_MAX_FILES", "2")
            .args(args)
            .output()
            .unwrap();
        assert!(output.status.success());
    }

    let logs = home.path().join("logs");
    assert!(logs.join("raven.log.jsonl").is_file());
    assert!(logs.join("raven.log.jsonl.1").is_file());
    assert!(logs.join("raven.log.jsonl.2").is_file());
    assert!(!logs.join("raven.log.jsonl.3").exists());
    for path in [
        logs.join("raven.log.jsonl"),
        logs.join("raven.log.jsonl.1"),
        logs.join("raven.log.jsonl.2"),
    ] {
        let log = std::fs::read_to_string(path).unwrap();
        assert!(!log.contains("private rotated title"));
        assert!(!log.contains("private rotated note"));
        assert!(!log.contains(home.path().to_str().unwrap()));
    }
}

#[cfg(unix)]
#[test]
fn raven_permission_failure_is_silent_when_console_logging_is_off() {
    use std::os::unix::fs::PermissionsExt;

    let home = tempfile::tempdir().unwrap();
    let logs = home.path().join("logs");
    std::fs::create_dir(&logs).unwrap();
    std::fs::set_permissions(&logs, std::fs::Permissions::from_mode(0o500)).unwrap();

    let output = raven(home.path())
        .env("RAVEN_CONSOLE_LOG", "off")
        .arg("init")
        .output()
        .unwrap();

    std::fs::set_permissions(&logs, std::fs::Permissions::from_mode(0o700)).unwrap();
    assert!(output.status.success());
    assert!(output.stderr.is_empty());
    assert!(!logs.join("raven.log.jsonl").exists());
}

#[test]
fn raven_home_from_dotenv_precedes_the_default_home() {
    let working_dir = tempfile::tempdir().unwrap();
    let dotenv_home = working_dir.path().join("from-dotenv");
    std::fs::write(
        working_dir.path().join(".env"),
        format!("RAVEN_HOME={}\n", dotenv_home.display()),
    )
    .unwrap();

    let status = Command::new(env!("CARGO_BIN_EXE_raven"))
        .current_dir(working_dir.path())
        .env_remove("RAVEN_HOME")
        .env("HOME", working_dir.path().join("default-home"))
        .arg("init")
        .status()
        .unwrap();

    assert!(status.success());
    assert!(dotenv_home.join("todo.sqlite").exists());
}
