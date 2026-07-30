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
fn import_rejects_unknown_schema_version_and_cleans_up_without_modifying_source() {
    let source = seeded_todo_home();
    let source_path = source.path().join("todo.sqlite");
    let source_connection =
        todo_engine::infrastructure::sqlite::connect(source_path.to_str().unwrap()).unwrap();
    source_connection
        .execute_batch("PRAGMA user_version = 999;")
        .unwrap();
    drop(source_connection);
    let source_before = std::fs::read(&source_path).unwrap();
    let destination = tempfile::tempdir().unwrap();

    let error = import_todo(source.path(), &RavenPaths::from_home(destination.path())).unwrap_err();

    assert!(matches!(
        error,
        ImportTodoError::UnsupportedSchemaVersion(999)
    ));
    assert!(!destination.path().join("todo.sqlite").exists());
    assert_eq!(std::fs::read(&source_path).unwrap(), source_before);
    let source_connection =
        todo_engine::infrastructure::sqlite::connect(source_path.to_str().unwrap()).unwrap();
    let source_version: i64 = source_connection
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap();
    assert_eq!(source_version, 999);
    assert_eq!(std::fs::read_dir(destination.path()).unwrap().count(), 0);
}

#[test]
fn import_copies_committed_live_wal_data_without_changing_durable_source_data() {
    let source = seeded_todo_home();
    let source_path = source.path().join("todo.sqlite");
    let source_wal_path = source.path().join("todo.sqlite-wal");
    let source_connection =
        todo_engine::infrastructure::sqlite::connect(source_path.to_str().unwrap()).unwrap();
    let journal_mode: String = source_connection
        .query_row("PRAGMA journal_mode = WAL", [], |row| row.get(0))
        .unwrap();
    assert_eq!(journal_mode, "wal");
    source_connection
        .execute_batch(
            "PRAGMA wal_autocheckpoint = 0;
             CREATE TABLE wal_probe (value TEXT NOT NULL);
             INSERT INTO wal_probe VALUES ('committed-in-wal');",
        )
        .unwrap();
    let source_main_before = std::fs::read(&source_path).unwrap();
    let source_wal_before = std::fs::read(&source_wal_path).unwrap();
    assert!(!source_wal_before.is_empty());
    let destination = tempfile::tempdir().unwrap();

    let report = import_todo(source.path(), &RavenPaths::from_home(destination.path())).unwrap();

    let destination_entries: Vec<std::ffi::OsString> = std::fs::read_dir(destination.path())
        .unwrap()
        .map(|entry| entry.unwrap().file_name())
        .collect();
    assert_eq!(
        destination_entries,
        [std::ffi::OsString::from("todo.sqlite")],
        "no import-owned temporary main or sidecar may remain after publication"
    );

    let isolated = tempfile::tempdir().unwrap();
    let isolated_db = isolated.path().join("todo.sqlite");
    std::fs::copy(&report.destination, &isolated_db).unwrap();
    let imported =
        todo_engine::infrastructure::sqlite::connect(isolated_db.to_str().unwrap()).unwrap();
    let imported_value: String = imported
        .query_row("SELECT value FROM wal_probe", [], |row| row.get(0))
        .unwrap();
    assert_eq!(imported_value, "committed-in-wal");
    let imported_version: i64 = imported
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap();
    assert_eq!(
        imported_version,
        todo_engine::interfaces::cli::TODO_SCHEMA_VERSION
    );
    let imported_integrity: String = imported
        .query_row("PRAGMA integrity_check", [], |row| row.get(0))
        .unwrap();
    assert_eq!(imported_integrity, "ok");
    let imported_journal_mode: String = imported
        .query_row("PRAGMA journal_mode", [], |row| row.get(0))
        .unwrap();
    assert_eq!(imported_journal_mode, "delete");
    drop(imported);
    assert_eq!(
        todo_engine::interfaces::cli::health_at(isolated.path()),
        todo_engine::interfaces::cli::TodoHealth::Healthy {
            user_version: todo_engine::interfaces::cli::TODO_SCHEMA_VERSION,
        }
    );
    let source_value: String = source_connection
        .query_row("SELECT value FROM wal_probe", [], |row| row.get(0))
        .unwrap();
    assert_eq!(source_value, "committed-in-wal");
    assert_eq!(std::fs::read(source_path).unwrap(), source_main_before);
    assert_eq!(std::fs::read(source_wal_path).unwrap(), source_wal_before);
    // SQLite may update `todo.sqlite-shm` reader/WAL-index state for a
    // read-only connection; it is intentionally not treated as durable data.
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

#[test]
fn raven_import_todo_conflict_exits_two_and_logs_without_paths() {
    let source = seeded_todo_home();
    let destination = tempfile::tempdir().unwrap();
    let destination_path = destination.path().join("todo.sqlite");
    let existing = b"existing Raven data";
    std::fs::write(&destination_path, existing).unwrap();

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

    assert_eq!(output.status.code(), Some(2));
    assert_eq!(std::fs::read(&destination_path).unwrap(), existing);
    let events: Vec<serde_json::Value> =
        std::fs::read_to_string(destination.path().join("logs/raven.log.jsonl"))
            .unwrap()
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect();
    let failed: Vec<&serde_json::Value> = events
        .iter()
        .filter(|record| record["fields"]["event"] == "command_failed")
        .collect();
    assert_eq!(failed.len(), 1);
    assert_eq!(failed[0]["fields"]["command"], "import");
    assert_eq!(failed[0]["fields"]["engine"], "todo");
    assert_eq!(failed[0]["fields"]["exit_code"], 2);
    let log = serde_json::to_string(&events).unwrap();
    assert!(!log.contains(source.path().to_str().unwrap()));
    assert!(!log.contains(destination.path().to_str().unwrap()));
}
