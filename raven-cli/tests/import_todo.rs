use std::path::Path;
use std::process::Command;

use raven_cli::commands::import::{ImportTodoError, import_todo};
use raven_cli::config::RavenPaths;

fn seeded_todo_home() -> tempfile::TempDir {
    let home = tempfile::tempdir().unwrap();
    todo_engine::interfaces::cli::run_at(home.path(), ["todo-engine", "init"]).unwrap();
    todo_engine::interfaces::cli::run_at(
        home.path(),
        ["todo-engine", "task", "propose", "imported task"],
    )
    .unwrap();
    home
}

fn raven(home: &Path) -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_raven"));
    command.args(["--home", home.to_str().unwrap()]);
    command
}

#[test]
fn import_copies_and_validates_without_modifying_source() {
    let source = seeded_todo_home();
    let source_path = source.path().join("todo.sqlite");
    let source_before = std::fs::read(&source_path).unwrap();
    let destination = tempfile::tempdir().unwrap();
    let paths = RavenPaths::from_home(destination.path());

    let report = import_todo(source.path(), &paths).unwrap();

    assert_eq!(report.source, source_path);
    assert_eq!(report.destination, destination.path().join("todo.sqlite"));
    assert_eq!(report.integrity_check, "ok");
    let imported =
        todo_engine::infrastructure::sqlite::connect(report.destination.to_str().unwrap()).unwrap();
    let title: String = imported
        .query_row(
            "SELECT title FROM items WHERE title = 'imported task'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(title, "imported task");
    assert_eq!(std::fs::read(source_path).unwrap(), source_before);
}

#[test]
fn import_refuses_and_preserves_an_existing_destination() {
    let source = seeded_todo_home();
    let source_path = source.path().join("todo.sqlite");
    let source_before = std::fs::read(&source_path).unwrap();
    let destination = tempfile::tempdir().unwrap();
    let destination_path = destination.path().join("todo.sqlite");
    let existing = b"existing Raven data";
    std::fs::write(&destination_path, existing).unwrap();

    let error = import_todo(source.path(), &RavenPaths::from_home(destination.path())).unwrap_err();

    assert!(matches!(
        error,
        ImportTodoError::DestinationExists(path) if path == destination_path
    ));
    assert_eq!(std::fs::read(destination_path).unwrap(), existing);
    assert_eq!(std::fs::read(source_path).unwrap(), source_before);
}

#[test]
fn import_failure_removes_only_the_new_destination_and_preserves_source() {
    let source = tempfile::tempdir().unwrap();
    let source_path = source.path().join("todo.sqlite");
    let source_connection =
        todo_engine::infrastructure::sqlite::connect(source_path.to_str().unwrap()).unwrap();
    source_connection
        .execute_batch(
            "CREATE TABLE items (legacy TEXT);
             INSERT INTO items (legacy) VALUES ('source-only');
             PRAGMA user_version = 1;",
        )
        .unwrap();
    drop(source_connection);
    let source_before = std::fs::read(&source_path).unwrap();
    let destination = tempfile::tempdir().unwrap();
    let destination_path = destination.path().join("todo.sqlite");

    let error = import_todo(source.path(), &RavenPaths::from_home(destination.path())).unwrap_err();

    assert!(!matches!(error, ImportTodoError::DestinationExists(_)));
    assert!(!destination_path.exists());
    assert_eq!(std::fs::read(&source_path).unwrap(), source_before);
    let source_connection =
        todo_engine::infrastructure::sqlite::connect(source_path.to_str().unwrap()).unwrap();
    let legacy: String = source_connection
        .query_row("SELECT legacy FROM items", [], |row| row.get(0))
        .unwrap();
    assert_eq!(legacy, "source-only");
}

#[test]
fn raven_import_todo_uses_an_explicit_source_home_and_safe_log_labels() {
    let source = seeded_todo_home();
    let destination = tempfile::tempdir().unwrap();

    let output = raven(destination.path())
        .env("RAVEN_CONSOLE_LOG", "off")
        .args([
            "import",
            "todo",
            "--source-home",
            source.path().to_str().unwrap(),
        ])
        .output()
        .unwrap();

    assert!(output.status.success());
    let stdout = String::from_utf8(output.stdout).unwrap();
    assert!(stdout.contains("integrity_check=ok"));
    assert!(stdout.contains(source.path().to_str().unwrap()));
    assert!(stdout.contains(destination.path().to_str().unwrap()));
    let log = std::fs::read_to_string(destination.path().join("logs/raven.log.jsonl")).unwrap();
    assert!(log.contains("\"command\":\"import\""));
    assert!(log.contains("\"engine\":\"todo\""));
    assert!(!log.contains(source.path().to_str().unwrap()));
    assert!(!log.contains(destination.path().to_str().unwrap()));
}

#[test]
fn raven_import_todo_defaults_to_the_legacy_home_under_home() {
    let isolated_home = tempfile::tempdir().unwrap();
    let legacy_home = isolated_home.path().join(".todo-engine");
    std::fs::create_dir(&legacy_home).unwrap();
    todo_engine::interfaces::cli::run_at(&legacy_home, ["todo-engine", "init"]).unwrap();
    let destination = tempfile::tempdir().unwrap();

    let output = raven(destination.path())
        .env("HOME", isolated_home.path())
        .env("RAVEN_CONSOLE_LOG", "off")
        .args(["import", "todo"])
        .output()
        .unwrap();

    assert!(output.status.success());
    assert!(destination.path().join("todo.sqlite").exists());
}
