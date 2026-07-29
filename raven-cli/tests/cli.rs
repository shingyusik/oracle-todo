use std::process::Command;

fn raven(home: &std::path::Path) -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_raven"));
    command.args(["--home", home.to_str().unwrap()]);
    command
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
fn raven_init_creates_todo_database_and_media_directory() {
    let home = tempfile::tempdir().unwrap();

    let status = raven(home.path()).arg("init").status().unwrap();

    assert!(status.success());
    assert!(home.path().join("todo.sqlite").exists());
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
fn raven_health_check_reports_uninitialized_engines() {
    let home = tempfile::tempdir().unwrap();
    assert!(raven(home.path()).arg("init").status().unwrap().success());

    let output = raven(home.path()).arg("health-check").output().unwrap();

    assert!(output.status.success());
    let stdout = String::from_utf8(output.stdout).unwrap();
    assert!(stdout.contains("ledger=not_initialized"));
    assert!(stdout.contains("health=not_initialized"));
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
