mod support;

use assert_cmd::Command;
use oracle_todo::infrastructure::system::local_date_string_at;
use predicates::prelude::PredicateBooleanExt;
use predicates::str::contains;
use support::TestHome;
use time::macros::{datetime, offset};

#[test]
fn init_creates_sqlite_database() {
    let home = TestHome::new();

    Command::cargo_bin("oracle-todo")
        .unwrap()
        .args(["--home", home.path().to_str().unwrap(), "init"])
        .assert()
        .success()
        .stdout(contains("initialized"));

    assert!(home.db_path().exists());
}

#[test]
fn init_uses_oracle_todo_home_environment() {
    let home = TestHome::new();

    Command::cargo_bin("oracle-todo")
        .unwrap()
        .env("ORACLE_TODO_HOME", home.path())
        .arg("init")
        .assert()
        .success()
        .stdout(contains("initialized"));

    assert!(home.db_path().exists());
}

#[test]
fn task_propose_prints_json_item() {
    let home = TestHome::new();

    Command::cargo_bin("oracle-todo")
        .unwrap()
        .args(["--home", home.path().to_str().unwrap(), "init"])
        .assert()
        .success();

    Command::cargo_bin("oracle-todo")
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
fn cli_writes_structured_jsonl_logs_without_changing_stdout() {
    let home = TestHome::new();

    let output = Command::cargo_bin("oracle-todo")
        .unwrap()
        .args(["--home", home.path().to_str().unwrap(), "init"])
        .assert()
        .success()
        .stderr("")
        .stdout(contains("initialized"))
        .get_output()
        .stdout
        .clone();
    assert!(String::from_utf8(output).unwrap().contains("todo.sqlite"));

    let records = read_jsonl_records(home.path().join("logs/oracle-todo.jsonl"));
    let start = records
        .iter()
        .find(|record| record["event"] == "command_start")
        .expect("command_start record");
    assert_eq!(start["level"], "INFO");
    assert_eq!(start["command"], "init");
    assert!(start["timestamp"].as_str().unwrap().contains('T'));
    assert!(start["message"].as_str().unwrap().contains("started"));
    assert!(start["pid"].as_u64().unwrap() > 0);
    assert!(start.get("duration_ms").is_none());

    let success = records
        .iter()
        .find(|record| record["event"] == "command_success")
        .expect("command_success record");
    assert_eq!(success["level"], "INFO");
    assert_eq!(success["command"], "init");
    assert_eq!(success["exit_code"], 0);
    assert!(success["duration_ms"].as_u64().is_some());
}

#[test]
fn cli_logs_error_exit_code_for_todo_errors() {
    let home = TestHome::new();

    Command::cargo_bin("oracle-todo")
        .unwrap()
        .args(["--home", home.path().to_str().unwrap(), "init"])
        .assert()
        .success();

    Command::cargo_bin("oracle-todo")
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
        .stderr(contains("Item not found: 없는영역"));

    let records = read_jsonl_records(home.path().join("logs/oracle-todo.jsonl"));
    let error = records
        .iter()
        .find(|record| record["event"] == "command_error")
        .expect("command_error record");
    assert_eq!(error["level"], "ERROR");
    assert_eq!(error["command"], "task propose");
    assert_eq!(error["exit_code"], 4);
    assert!(error["duration_ms"].as_u64().is_some());
    assert!(
        error["message"]
            .as_str()
            .unwrap()
            .contains("Item not found: 없는영역")
    );
}

#[test]
fn cli_rotates_jsonl_logs_with_configurable_backup_count() {
    let home = TestHome::new();

    for _ in 0..8 {
        Command::cargo_bin("oracle-todo")
            .unwrap()
            .env("ORACLE_TODO_LOG_MAX_BYTES", "260")
            .env("ORACLE_TODO_LOG_MAX_FILES", "2")
            .args(["--home", home.path().to_str().unwrap(), "init"])
            .assert()
            .success();
    }

    let log_path = home.path().join("logs/oracle-todo.jsonl");
    let rotated_path = home.path().join("logs/oracle-todo.jsonl.1");
    let second_rotated_path = home.path().join("logs/oracle-todo.jsonl.2");
    let third_rotated_path = home.path().join("logs/oracle-todo.jsonl.3");
    assert!(log_path.exists());
    assert!(rotated_path.exists());
    assert!(second_rotated_path.exists());
    assert!(!third_rotated_path.exists());

    let rotated_records = read_jsonl_records(rotated_path)
        .into_iter()
        .chain(read_jsonl_records(second_rotated_path))
        .collect::<Vec<_>>();
    assert!(!rotated_records.is_empty());
    assert!(
        rotated_records.iter().all(
            |record| record["event"] == "command_start" || record["event"] == "command_success"
        )
    );
}

fn read_jsonl_records(path: impl AsRef<std::path::Path>) -> Vec<serde_json::Value> {
    std::fs::read_to_string(path)
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect()
}

#[test]
fn area_create_and_pending_match_python_cli_intent() {
    let home = TestHome::new();

    Command::cargo_bin("oracle-todo")
        .unwrap()
        .args(["--home", home.path().to_str().unwrap(), "init"])
        .assert()
        .success();

    Command::cargo_bin("oracle-todo")
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

    Command::cargo_bin("oracle-todo")
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

    Command::cargo_bin("oracle-todo")
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

    Command::cargo_bin("oracle-todo")
        .unwrap()
        .args(["--home", home.path().to_str().unwrap(), "pending"])
        .assert()
        .success()
        .stdout(contains("DB 확인"))
        .stdout(contains("직접 승인된 일").not());
}

#[test]
fn today_and_export_materialize_active_routines() {
    let home = TestHome::new();

    Command::cargo_bin("oracle-todo")
        .unwrap()
        .args(["--home", home.path().to_str().unwrap(), "init"])
        .assert()
        .success();

    let output = Command::cargo_bin("oracle-todo")
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

    Command::cargo_bin("oracle-todo")
        .unwrap()
        .args([
            "--home",
            home.path().to_str().unwrap(),
            "activate",
            routine_id,
        ])
        .assert()
        .success();

    Command::cargo_bin("oracle-todo")
        .unwrap()
        .args(["--home", home.path().to_str().unwrap(), "today"])
        .assert()
        .success()
        .stdout(contains("매일 스트레칭"));

    Command::cargo_bin("oracle-todo")
        .unwrap()
        .args(["--home", home.path().to_str().unwrap(), "export"])
        .assert()
        .success();

    assert!(home.path().join("exports/today.md").exists());
}

#[test]
fn event_propose_prints_external_commitment_metadata() {
    let home = TestHome::new();

    Command::cargo_bin("oracle-todo")
        .unwrap()
        .args(["--home", home.path().to_str().unwrap(), "init"])
        .assert()
        .success();

    Command::cargo_bin("oracle-todo")
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

    Command::cargo_bin("oracle-todo")
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
fn local_today_uses_configured_offset_not_utc_date() {
    assert_eq!(
        local_date_string_at(datetime!(2026-05-31 15:30 UTC), offset!(+09:00)),
        "2026-06-01"
    );
}
