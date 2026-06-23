use crate::support::TestHome;
use assert_cmd::Command;
use predicates::prelude::PredicateBooleanExt;
use predicates::str::contains;

#[test]
fn init_creates_sqlite_database() {
    let home = TestHome::new();

    Command::cargo_bin("todo-engine")
        .unwrap()
        .args(["--home", home.path().to_str().unwrap(), "init"])
        .assert()
        .success()
        .stdout(contains("initialized"));

    assert!(home.db_path().exists());
}

#[test]
fn init_uses_todo_engine_home_environment() {
    let home = TestHome::new();

    Command::cargo_bin("todo-engine")
        .unwrap()
        .env("TODO_ENGINE_HOME", home.path())
        .arg("init")
        .assert()
        .success()
        .stdout(contains("initialized"));

    assert!(home.db_path().exists());
}

#[test]
fn init_loads_todo_engine_home_from_dotenv() {
    let home = TestHome::new();
    let cwd = tempfile::tempdir().expect("create dotenv cwd");
    let fallback_home = tempfile::tempdir().expect("create fallback home");
    std::fs::write(
        cwd.path().join(".env"),
        format!("TODO_ENGINE_HOME={}\n", home.path().display()),
    )
    .expect("write .env");

    Command::cargo_bin("todo-engine")
        .unwrap()
        .current_dir(cwd.path())
        .env_remove("TODO_ENGINE_HOME")
        .env("HOME", fallback_home.path())
        .arg("init")
        .assert()
        .success()
        .stdout(contains(home.db_path().to_string_lossy().as_ref()));

    assert!(home.db_path().exists());
    assert!(
        !fallback_home
            .path()
            .join(".todo-engine/todo.sqlite")
            .exists()
    );
}

#[test]
fn api_command_exposes_default_port() {
    Command::cargo_bin("todo-engine")
        .unwrap()
        .args(["api", "--help"])
        .assert()
        .success()
        .stdout(contains("3002"));
}

#[test]
fn task_propose_prints_json_item() {
    let home = TestHome::new();

    Command::cargo_bin("todo-engine")
        .unwrap()
        .args(["--home", home.path().to_str().unwrap(), "init"])
        .assert()
        .success();

    Command::cargo_bin("todo-engine")
        .unwrap()
        .args([
            "--home",
            home.path().to_str().unwrap(),
            "task",
            "propose",
            "MoneyManager 앱 열고 DB 생성 여부 확인",
            "--note",
            "앱 최초 실행 후 확인",
        ])
        .assert()
        .success()
        .stdout(contains("\"status\":\"proposed\""))
        .stdout(contains("\"note\":\"앱 최초 실행 후 확인\""));
}

#[test]
fn cli_writes_info_to_stderr_and_debug_to_file_without_changing_stdout() {
    let home = TestHome::new();

    let output = Command::cargo_bin("todo-engine")
        .unwrap()
        .args(["--home", home.path().to_str().unwrap(), "init"])
        .assert()
        .success()
        .stdout(contains("initialized"))
        .get_output()
        .clone();

    let stdout = String::from_utf8(output.stdout).unwrap();
    assert!(stdout.contains("todo.sqlite"));

    let stderr = String::from_utf8(output.stderr).unwrap();
    assert!(stderr.contains("INFO"));
    assert!(stderr.contains("command started"));
    assert!(stderr.contains("command completed"));
    assert!(!stderr.contains("DEBUG"));

    let records = read_jsonl_records(home.path().join("logs/todo-engine.log.jsonl"));
    assert_jsonl_event(&records, "INFO", "command_started");
    assert_jsonl_event(&records, "INFO", "command_completed");
    assert_jsonl_event(&records, "DEBUG", "home_resolved");
    assert_jsonl_event(&records, "DEBUG", "database_opened");
}

#[test]
fn cli_logs_error_event_with_exit_code_to_file() {
    let home = TestHome::new();

    Command::cargo_bin("todo-engine")
        .unwrap()
        .args(["--home", home.path().to_str().unwrap(), "init"])
        .assert()
        .success();

    Command::cargo_bin("todo-engine")
        .unwrap()
        .args([
            "--home",
            home.path().to_str().unwrap(),
            "task",
            "propose",
            "실패할 일",
            "--area",
            "없는영역",
        ])
        .assert()
        .code(4)
        .stderr(contains("ERROR"))
        .stderr(contains("Item not found: 없는영역"));

    let records = read_jsonl_records(home.path().join("logs/todo-engine.log.jsonl"));
    let error = find_jsonl_event(&records, "command_failed");
    assert_eq!(error["level"], "ERROR");
    assert_eq!(error["fields"]["command"], "task propose");
    assert_eq!(error["fields"]["exit_code"], 4);
    assert!(
        error["fields"]["error"]
            .as_str()
            .unwrap()
            .contains("Item not found: 없는영역")
    );
}

#[test]
fn cli_rotates_tracing_jsonl_logs_with_configurable_backup_count() {
    let home = TestHome::new();

    for _ in 0..8 {
        Command::cargo_bin("todo-engine")
            .unwrap()
            .env("TODO_ENGINE_LOG_MAX_BYTES", "520")
            .env("TODO_ENGINE_LOG_MAX_FILES", "2")
            .args(["--home", home.path().to_str().unwrap(), "init"])
            .assert()
            .success();
    }

    let log_path = home.path().join("logs/todo-engine.log.jsonl");
    let rotated_path = home.path().join("logs/todo-engine.log.jsonl.1");
    let second_rotated_path = home.path().join("logs/todo-engine.log.jsonl.2");
    let third_rotated_path = home.path().join("logs/todo-engine.log.jsonl.3");
    assert!(log_path.exists());
    assert!(rotated_path.exists());
    assert!(second_rotated_path.exists());
    assert!(!third_rotated_path.exists());

    let records = read_jsonl_records(&log_path)
        .into_iter()
        .chain(read_jsonl_records(rotated_path))
        .chain(read_jsonl_records(second_rotated_path))
        .collect::<Vec<_>>();
    assert_jsonl_event(&records, "INFO", "log_rotated");
    assert!(
        records
            .iter()
            .any(|record| record["fields"]["event"] == "command_completed")
    );
}

#[test]
fn cli_file_log_error_filters_debug_info_and_rotation_records() {
    let home = TestHome::new();
    let log_path = home.path().join("logs/todo-engine.log.jsonl");
    std::fs::create_dir_all(log_path.parent().unwrap()).unwrap();
    std::fs::write(&log_path, "old log large enough to rotate\n").unwrap();

    Command::cargo_bin("todo-engine")
        .unwrap()
        .env("TODO_ENGINE_FILE_LOG", "error")
        .env("TODO_ENGINE_LOG_MAX_BYTES", "1")
        .env("TODO_ENGINE_LOG_MAX_FILES", "1")
        .args([
            "--home",
            home.path().to_str().unwrap(),
            "task",
            "propose",
            "실패할 일",
            "--area",
            "없는영역",
        ])
        .assert()
        .code(4);

    let records = read_jsonl_records(&log_path);
    assert_jsonl_event(&records, "ERROR", "command_failed");
    assert!(
        records.iter().all(|record| record["level"] == "ERROR"),
        "expected only ERROR records in active log, got {records:#?}"
    );
    assert!(
        records
            .iter()
            .all(|record| record["fields"]["event"] != "log_rotated"),
        "log_rotated should be filtered when TODO_ENGINE_FILE_LOG=error: {records:#?}"
    );
    assert!(
        records
            .iter()
            .all(|record| record["fields"]["event"] != "home_resolved"),
        "DEBUG events should be filtered when TODO_ENGINE_FILE_LOG=error: {records:#?}"
    );
    assert!(
        records
            .iter()
            .all(|record| record["fields"]["event"] != "command_started"),
        "INFO events should be filtered when TODO_ENGINE_FILE_LOG=error: {records:#?}"
    );
}

fn read_jsonl_records(path: impl AsRef<std::path::Path>) -> Vec<serde_json::Value> {
    std::fs::read_to_string(path)
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect()
}

fn find_jsonl_event<'a>(records: &'a [serde_json::Value], event: &str) -> &'a serde_json::Value {
    records
        .iter()
        .find(|record| record["fields"]["event"] == event)
        .unwrap_or_else(|| panic!("{event} event in {records:#?}"))
}

fn assert_jsonl_event(records: &[serde_json::Value], level: &str, event: &str) {
    let record = find_jsonl_event(records, event);
    assert_eq!(record["level"], level);
}

#[test]
fn area_create_and_pending_show_current_cli_behavior() {
    let home = TestHome::new();

    Command::cargo_bin("todo-engine")
        .unwrap()
        .args(["--home", home.path().to_str().unwrap(), "init"])
        .assert()
        .success();

    Command::cargo_bin("todo-engine")
        .unwrap()
        .args([
            "--home",
            home.path().to_str().unwrap(),
            "area",
            "create",
            "재정",
            "--review-cycle",
            "weekly",
        ])
        .assert()
        .success()
        .stdout(contains("\"type\":\"area\""))
        .stdout(contains("\"status\":\"active\""));

    Command::cargo_bin("todo-engine")
        .unwrap()
        .args([
            "--home",
            home.path().to_str().unwrap(),
            "task",
            "propose",
            "DB 확인",
        ])
        .assert()
        .success();

    Command::cargo_bin("todo-engine")
        .unwrap()
        .args([
            "--home",
            home.path().to_str().unwrap(),
            "task",
            "propose",
            "직접 승인된 일",
            "--actor",
            "user",
        ])
        .assert()
        .success();

    Command::cargo_bin("todo-engine")
        .unwrap()
        .args(["--home", home.path().to_str().unwrap(), "pending"])
        .assert()
        .success()
        .stdout(contains("DB 확인"))
        .stdout(contains("직접 승인된 일").not());
}

#[test]
fn today_materializes_active_routines() {
    let home = TestHome::new();

    Command::cargo_bin("todo-engine")
        .unwrap()
        .args(["--home", home.path().to_str().unwrap(), "init"])
        .assert()
        .success();

    let output = Command::cargo_bin("todo-engine")
        .unwrap()
        .args([
            "--home",
            home.path().to_str().unwrap(),
            "routine",
            "propose",
            "매일 스트레칭",
            "--recurrence-rule",
            "daily",
            "--actor",
            "user",
        ])
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    let routine: serde_json::Value = serde_json::from_slice(&output).unwrap();
    let routine_id = routine["id"].as_str().unwrap();

    Command::cargo_bin("todo-engine")
        .unwrap()
        .args([
            "--home",
            home.path().to_str().unwrap(),
            "activate",
            routine_id,
        ])
        .assert()
        .success();

    Command::cargo_bin("todo-engine")
        .unwrap()
        .args(["--home", home.path().to_str().unwrap(), "today"])
        .assert()
        .success()
        .stdout(contains("매일 스트레칭"));
}

#[test]
fn export_subcommand_is_not_available() {
    let home = TestHome::new();

    Command::cargo_bin("todo-engine")
        .unwrap()
        .args(["--home", home.path().to_str().unwrap(), "export"])
        .assert()
        .failure()
        .stderr(contains("unrecognized subcommand 'export'"));
}

#[test]
fn event_propose_prints_external_commitment_metadata() {
    let home = TestHome::new();

    Command::cargo_bin("todo-engine")
        .unwrap()
        .args(["--home", home.path().to_str().unwrap(), "init"])
        .assert()
        .success();

    Command::cargo_bin("todo-engine")
        .unwrap()
        .args([
            "--home",
            home.path().to_str().unwrap(),
            "event",
            "propose",
            "병원 예약",
            "2026-06-01 15:00",
            "--with",
            "서울대병원",
            "--location",
            "서울대병원",
        ])
        .assert()
        .success()
        .stdout(contains("\"type\":\"event\""))
        .stdout(contains("\"commitment_type\":\"appointment\""))
        .stdout(contains("서울대병원"));

    Command::cargo_bin("todo-engine")
        .unwrap()
        .args([
            "--home",
            home.path().to_str().unwrap(),
            "event",
            "propose",
            "컨설팅",
            "2026-06-02 10:00",
            "--commitment-type",
            "consultation",
        ])
        .assert()
        .success()
        .stdout(contains("\"commitment_type\":\"consultation\""));
}

#[test]
fn list_project_propose_and_update_cover_cli_surface() {
    let home = TestHome::new();

    Command::cargo_bin("todo-engine")
        .unwrap()
        .args(["--home", home.path().to_str().unwrap(), "init"])
        .assert()
        .success();

    Command::cargo_bin("todo-engine")
        .unwrap()
        .args([
            "--home",
            home.path().to_str().unwrap(),
            "area",
            "create",
            "운영",
        ])
        .assert()
        .success();

    let output = Command::cargo_bin("todo-engine")
        .unwrap()
        .args([
            "--home",
            home.path().to_str().unwrap(),
            "project",
            "propose",
            "Rust cutover",
            "--area",
            "운영",
            "--definition-of-done",
            "copied DB smoke passes",
            "--outcome",
            "safe cutover",
            "--due",
            "2026-06-10",
            "--actor",
            "user",
        ])
        .assert()
        .success()
        .stdout(contains("\"type\":\"project\""))
        .stdout(contains("\"status\":\"approved\""))
        .get_output()
        .stdout
        .clone();
    let project: serde_json::Value = serde_json::from_slice(&output).unwrap();
    let project_id = project["id"].as_str().unwrap();

    Command::cargo_bin("todo-engine")
        .unwrap()
        .args([
            "--home",
            home.path().to_str().unwrap(),
            "update",
            project_id,
            "--title",
            "Rust cutover ready",
            "--definition-of-done",
            "smoke tests pass",
            "--reason",
            "tighten scope",
        ])
        .assert()
        .success()
        .stdout(contains("Rust cutover ready"))
        .stdout(contains("smoke tests pass"));

    Command::cargo_bin("todo-engine")
        .unwrap()
        .args([
            "--home",
            home.path().to_str().unwrap(),
            "list",
            "--type",
            "project",
            "--include-archived",
        ])
        .assert()
        .success()
        .stdout(contains("Rust cutover ready"));
}

#[test]
fn lifecycle_commands_emit_json_status_changes() {
    let home = TestHome::new();

    Command::cargo_bin("todo-engine")
        .unwrap()
        .args(["--home", home.path().to_str().unwrap(), "init"])
        .assert()
        .success();

    let proposed = Command::cargo_bin("todo-engine")
        .unwrap()
        .args([
            "--home",
            home.path().to_str().unwrap(),
            "task",
            "propose",
            "승인할 일",
        ])
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    let proposed: serde_json::Value = serde_json::from_slice(&proposed).unwrap();
    let proposed_id = proposed["id"].as_str().unwrap();

    Command::cargo_bin("todo-engine")
        .unwrap()
        .args([
            "--home",
            home.path().to_str().unwrap(),
            "approve",
            proposed_id,
            "--reason",
            "accepted",
        ])
        .assert()
        .success()
        .stdout(contains("\"status\":\"approved\""));

    Command::cargo_bin("todo-engine")
        .unwrap()
        .args([
            "--home",
            home.path().to_str().unwrap(),
            "complete",
            proposed_id,
        ])
        .assert()
        .success()
        .stdout(contains("\"status\":\"completed\""));

    for (title, command, status) in [
        ("보관할 일", "archive", "archived"),
        ("버릴 일", "drop", "dropped"),
        ("취소할 일", "cancel", "cancelled"),
    ] {
        let output = Command::cargo_bin("todo-engine")
            .unwrap()
            .args([
                "--home",
                home.path().to_str().unwrap(),
                "task",
                "propose",
                title,
                "--actor",
                "user",
            ])
            .assert()
            .success()
            .get_output()
            .stdout
            .clone();
        let item: serde_json::Value = serde_json::from_slice(&output).unwrap();
        let item_id = item["id"].as_str().unwrap();

        Command::cargo_bin("todo-engine")
            .unwrap()
            .args(["--home", home.path().to_str().unwrap(), command, item_id])
            .assert()
            .success()
            .stdout(contains(format!("\"status\":\"{status}\"")));
    }

    let pause_output = Command::cargo_bin("todo-engine")
        .unwrap()
        .args([
            "--home",
            home.path().to_str().unwrap(),
            "task",
            "propose",
            "일시정지할 일",
            "--actor",
            "user",
        ])
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    let pause_item: serde_json::Value = serde_json::from_slice(&pause_output).unwrap();
    let pause_id = pause_item["id"].as_str().unwrap();

    Command::cargo_bin("todo-engine")
        .unwrap()
        .args(["--home", home.path().to_str().unwrap(), "pause", pause_id])
        .assert()
        .success()
        .stdout(contains("\"status\":\"paused\""));

    Command::cargo_bin("todo-engine")
        .unwrap()
        .args(["--home", home.path().to_str().unwrap(), "resume", pause_id])
        .assert()
        .success()
        .stdout(contains("\"status\":\"active\""));
}

#[test]
fn archive_list_shows_terminal_items() {
    let home = TestHome::new();

    Command::cargo_bin("todo-engine")
        .unwrap()
        .args(["--home", home.path().to_str().unwrap(), "init"])
        .assert()
        .success();

    let output = Command::cargo_bin("todo-engine")
        .unwrap()
        .args([
            "--home",
            home.path().to_str().unwrap(),
            "task",
            "propose",
            "보관 목록 확인",
            "--actor",
            "user",
        ])
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    let item: serde_json::Value = serde_json::from_slice(&output).unwrap();
    let item_id = item["id"].as_str().unwrap();

    Command::cargo_bin("todo-engine")
        .unwrap()
        .args(["--home", home.path().to_str().unwrap(), "archive", item_id])
        .assert()
        .success();

    Command::cargo_bin("todo-engine")
        .unwrap()
        .args(["--home", home.path().to_str().unwrap(), "archive-list"])
        .assert()
        .success()
        .stdout(contains("보관 목록 확인"));
}

#[test]
fn routine_materialize_covers_cli_intent() {
    let home = TestHome::new();

    Command::cargo_bin("todo-engine")
        .unwrap()
        .args(["--home", home.path().to_str().unwrap(), "init"])
        .assert()
        .success();

    let output = Command::cargo_bin("todo-engine")
        .unwrap()
        .args([
            "--home",
            home.path().to_str().unwrap(),
            "routine",
            "propose",
            "매일 호환성 점검",
            "--recurrence-rule",
            "daily",
            "--actor",
            "user",
        ])
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    let routine: serde_json::Value = serde_json::from_slice(&output).unwrap();
    let routine_id = routine["id"].as_str().unwrap();

    Command::cargo_bin("todo-engine")
        .unwrap()
        .args([
            "--home",
            home.path().to_str().unwrap(),
            "activate",
            routine_id,
        ])
        .assert()
        .success();

    Command::cargo_bin("todo-engine")
        .unwrap()
        .args([
            "--home",
            home.path().to_str().unwrap(),
            "routine",
            "materialize",
            "--now",
            "2026-06-01",
            "--lookahead-days",
            "1",
            "--catchup-days",
            "0",
        ])
        .assert()
        .success()
        .stdout(contains("매일 호환성 점검"));
}
