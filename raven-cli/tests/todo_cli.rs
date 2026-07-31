use std::path::{Path, PathBuf};

struct TestHome {
    dir: tempfile::TempDir,
}

impl TestHome {
    fn new() -> Self {
        Self {
            dir: tempfile::tempdir().expect("create test home"),
        }
    }
    fn path(&self) -> &Path {
        self.dir.path()
    }
    fn db_path(&self) -> PathBuf {
        self.path().join("todo.sqlite")
    }
}

fn raven() -> Command {
    Command::new(env!("CARGO_BIN_EXE_raven"))
}
use assert_cmd::Command;
use predicates::str::contains;
use time::{Date, format_description::parse};
use todo_engine::infrastructure::system::local_today_string;

fn local_day() -> Date {
    let format = parse("[year]-[month]-[day]").unwrap();
    Date::parse(&local_today_string(), &format).unwrap()
}

fn format_day(day: Date) -> String {
    let format = parse("[year]-[month]-[day]").unwrap();
    day.format(&format).unwrap()
}

#[test]
fn init_creates_sqlite_database() {
    let home = TestHome::new();

    raven()
        .args(["--home", home.path().to_str().unwrap(), "todo", "init"])
        .assert()
        .success()
        .stdout(contains("initialized"));

    assert!(home.db_path().exists());
}

#[test]
fn run_at_executes_today_against_the_explicit_home() {
    let home = tempfile::tempdir().unwrap();

    todo_engine::interfaces::cli::run_at(home.path(), ["todo-engine", "init"]).unwrap();

    assert!(home.path().join("todo.sqlite").exists());
}

#[test]
fn init_uses_raven_home_environment() {
    let home = TestHome::new();

    raven()
        .env("RAVEN_HOME", home.path())
        .args(["todo", "init"])
        .assert()
        .success()
        .stdout(contains("initialized"));

    assert!(home.db_path().exists());
}

#[test]
fn init_loads_raven_home_from_dotenv() {
    let home = TestHome::new();
    let cwd = tempfile::tempdir().expect("create dotenv cwd");
    let fallback_home = tempfile::tempdir().expect("create fallback home");
    // Single-quoted: dotenv reads `\` as an escape, so a bare Windows path does
    // not survive an unquoted value.
    std::fs::write(
        cwd.path().join(".env"),
        format!("RAVEN_HOME='{}'\n", home.path().display()),
    )
    .expect("write .env");

    raven()
        .current_dir(cwd.path())
        .env_remove("RAVEN_HOME")
        .env("HOME", fallback_home.path())
        .args(["todo", "init"])
        .assert()
        .success()
        .stdout(contains(home.db_path().to_string_lossy().as_ref()));

    assert!(home.db_path().exists());
    assert!(!fallback_home.path().join(".raven/todo.sqlite").exists());
}

#[test]
fn init_reports_an_unparsable_dotenv_instead_of_falling_back() {
    let cwd = tempfile::tempdir().expect("create dotenv cwd");
    let fallback_home = tempfile::tempdir().expect("create fallback home");
    // An unquoted backslash path -- the shape a Windows user reaches for first.
    // Silently ignoring it would resolve the home to the fallback with no hint
    // that the .env was dropped.
    std::fs::write(
        cwd.path().join(".env"),
        "RAVEN_HOME=C:\\Users\\someone\\todo-home\n",
    )
    .expect("write .env");

    raven()
        .current_dir(cwd.path())
        .env_remove("RAVEN_HOME")
        .env("HOME", fallback_home.path())
        .args(["todo", "init"])
        .assert()
        .failure()
        .stderr(contains("failed to parse .env"));

    assert!(!fallback_home.path().join(".raven/todo.sqlite").exists());
}

#[test]
fn task_propose_prints_json_item() {
    let home = TestHome::new();

    raven()
        .args(["--home", home.path().to_str().unwrap(), "todo", "init"])
        .assert()
        .success();

    raven()
        .args([
            "--home",
            home.path().to_str().unwrap(),
            "todo",
            "task",
            "propose",
            "MoneyManager 앱 열고 DB 생성 여부 확인",
            "--note",
            "앱 최초 실행 후 확인",
        ])
        .assert()
        .success()
        .stdout(contains("\"status\":\"active\""))
        .stdout(contains("\"note\":\"앱 최초 실행 후 확인\""));
}

#[test]
fn area_create_and_pending_show_current_cli_behavior() {
    let home = TestHome::new();

    raven()
        .args(["--home", home.path().to_str().unwrap(), "todo", "init"])
        .assert()
        .success();

    raven()
        .args([
            "--home",
            home.path().to_str().unwrap(),
            "todo",
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

    raven()
        .args([
            "--home",
            home.path().to_str().unwrap(),
            "todo",
            "task",
            "propose",
            "DB 확인",
        ])
        .assert()
        .success();

    raven()
        .args([
            "--home",
            home.path().to_str().unwrap(),
            "todo",
            "task",
            "propose",
            "직접 승인된 일",
            "--actor",
            "user",
        ])
        .assert()
        .success();

    raven()
        .args(["--home", home.path().to_str().unwrap(), "todo", "pending"])
        .assert()
        .success()
        .stdout(contains("DB 확인"))
        .stdout(contains("직접 승인된 일"));
}

#[test]
fn today_materializes_active_routines() {
    let home = TestHome::new();

    raven()
        .args(["--home", home.path().to_str().unwrap(), "todo", "init"])
        .assert()
        .success();

    let output = raven()
        .args([
            "--home",
            home.path().to_str().unwrap(),
            "todo",
            "routine",
            "propose",
            "매일 스트레칭",
            "--recurrence-rule",
            "daily",
            "--materialization-policy",
            "per_occurrence",
            "--future-occurrences",
            "2",
            "--actor",
            "user",
        ])
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    let routine: serde_json::Value = serde_json::from_slice(&output).unwrap();
    assert_eq!(routine["future_occurrences"], 2);

    raven()
        .args(["--home", home.path().to_str().unwrap(), "todo", "today"])
        .assert()
        .success()
        .stdout(contains("매일 스트레칭"));
}

#[test]
fn routine_propose_preserves_task_template_fields() {
    let home = TestHome::new();

    let output = raven()
        .args([
            "--home",
            home.path().to_str().unwrap(),
            "todo",
            "project",
            "propose",
            "수분 섭취",
            "--definition-of-done",
            "매일 충분히 마신다",
        ])
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    let project: serde_json::Value = serde_json::from_slice(&output).unwrap();
    let project_id = project["id"].as_str().unwrap();

    let output = raven()
        .args([
            "--home",
            home.path().to_str().unwrap(),
            "todo",
            "routine",
            "propose",
            "물 마시기",
            "--recurrence-rule",
            "daily",
            "--project-id",
            project_id,
            "--description",
            "500ml를 마신다",
            "--note",
            "찬물 제외",
            "--priority",
            "2",
            "--tag",
            "health",
            "--tag",
            "daily",
        ])
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    let routine: serde_json::Value = serde_json::from_slice(&output).unwrap();

    assert_eq!(routine["project_id"], project_id);
    assert_eq!(routine["description"], "500ml를 마신다");
    assert_eq!(routine["note"], "찬물 제외");
    assert_eq!(routine["priority"], 2);
    assert_eq!(routine["tags"], serde_json::json!(["health", "daily"]));
}

#[test]
fn export_subcommand_is_not_available() {
    let home = TestHome::new();

    raven()
        .args(["--home", home.path().to_str().unwrap(), "todo", "export"])
        .assert()
        .failure()
        .stderr(contains("unrecognized subcommand 'export'"));
}

#[test]
fn approval_subcommands_are_not_available() {
    for command in ["approve", "activate"] {
        raven()
            .args(["todo", command])
            .assert()
            .failure()
            .stderr(contains("unrecognized subcommand"));
    }
}

#[test]
fn event_propose_prints_external_commitment_metadata() {
    let home = TestHome::new();

    raven()
        .args(["--home", home.path().to_str().unwrap(), "todo", "init"])
        .assert()
        .success();

    raven()
        .args([
            "--home",
            home.path().to_str().unwrap(),
            "todo",
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

    raven()
        .args([
            "--home",
            home.path().to_str().unwrap(),
            "todo",
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

    raven()
        .args(["--home", home.path().to_str().unwrap(), "todo", "init"])
        .assert()
        .success();

    raven()
        .args([
            "--home",
            home.path().to_str().unwrap(),
            "todo",
            "area",
            "create",
            "운영",
        ])
        .assert()
        .success();

    let output = raven()
        .args([
            "--home",
            home.path().to_str().unwrap(),
            "todo",
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
        .stdout(contains("\"status\":\"active\""))
        .get_output()
        .stdout
        .clone();
    let project: serde_json::Value = serde_json::from_slice(&output).unwrap();
    let project_id = project["id"].as_str().unwrap();

    raven()
        .args([
            "--home",
            home.path().to_str().unwrap(),
            "todo",
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

    raven()
        .args([
            "--home",
            home.path().to_str().unwrap(),
            "todo",
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

    raven()
        .args(["--home", home.path().to_str().unwrap(), "todo", "init"])
        .assert()
        .success();

    let active = raven()
        .args([
            "--home",
            home.path().to_str().unwrap(),
            "todo",
            "task",
            "propose",
            "승인할 일",
        ])
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    let active: serde_json::Value = serde_json::from_slice(&active).unwrap();
    let active_id = active["id"].as_str().unwrap();

    raven()
        .args([
            "--home",
            home.path().to_str().unwrap(),
            "todo",
            "complete",
            active_id,
        ])
        .assert()
        .success()
        .stdout(contains("\"status\":\"completed\""));

    for (title, command, status) in [
        ("보관할 일", "archive", "archived"),
        ("버릴 일", "drop", "dropped"),
        ("취소할 일", "cancel", "cancelled"),
    ] {
        let output = raven()
            .args([
                "--home",
                home.path().to_str().unwrap(),
                "todo",
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

        raven()
            .args([
                "--home",
                home.path().to_str().unwrap(),
                "todo",
                command,
                item_id,
            ])
            .assert()
            .success()
            .stdout(contains(format!("\"status\":\"{status}\"")));
    }

    let pause_output = raven()
        .args([
            "--home",
            home.path().to_str().unwrap(),
            "todo",
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

    raven()
        .args([
            "--home",
            home.path().to_str().unwrap(),
            "todo",
            "pause",
            pause_id,
        ])
        .assert()
        .success()
        .stdout(contains("\"status\":\"paused\""));

    raven()
        .args([
            "--home",
            home.path().to_str().unwrap(),
            "todo",
            "resume",
            pause_id,
        ])
        .assert()
        .success()
        .stdout(contains("\"status\":\"active\""));
}

#[test]
fn postpone_prints_source_and_follow_up_json() {
    let home = TestHome::new();

    raven()
        .args(["--home", home.path().to_str().unwrap(), "todo", "init"])
        .assert()
        .success();

    let output = raven()
        .args([
            "--home",
            home.path().to_str().unwrap(),
            "todo",
            "task",
            "propose",
            "미룰 일",
            "--scheduled",
            "2099-01-01",
        ])
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    let task: serde_json::Value = serde_json::from_slice(&output).unwrap();
    let task_id = task["id"].as_str().unwrap();

    let output = raven()
        .args([
            "--home",
            home.path().to_str().unwrap(),
            "todo",
            "postpone",
            task_id,
            "--scheduled",
            "2099-01-02",
            "--reason",
            "내일 처리",
        ])
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    let postponed: serde_json::Value = serde_json::from_slice(&output).unwrap();
    assert_eq!(postponed["source"]["id"], task_id);
    assert_eq!(postponed["source"]["status"], "missed");
    assert_eq!(postponed["source"]["scheduled"], "2099-01-01");
    assert_eq!(postponed["follow_up"]["status"], "active");
    assert_eq!(postponed["follow_up"]["scheduled"], "2099-01-02");
}

#[test]
fn miss_prints_the_missed_source_json() {
    let home = TestHome::new();

    raven()
        .args(["--home", home.path().to_str().unwrap(), "todo", "init"])
        .assert()
        .success();

    let output = raven()
        .args([
            "--home",
            home.path().to_str().unwrap(),
            "todo",
            "task",
            "propose",
            "놓친 일",
            "--scheduled",
            "2099-01-01",
        ])
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    let task: serde_json::Value = serde_json::from_slice(&output).unwrap();
    let task_id = task["id"].as_str().unwrap();

    let output = raven()
        .args([
            "--home",
            home.path().to_str().unwrap(),
            "todo",
            "miss",
            task_id,
            "--reason",
            "수행하지 못함",
        ])
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    let missed: serde_json::Value = serde_json::from_slice(&output).unwrap();
    assert_eq!(missed["id"], task_id);
    assert_eq!(missed["status"], "missed");
    assert_eq!(missed["scheduled"], "2099-01-01");
}

#[test]
fn postpone_without_scheduled_defaults_to_cli_local_tomorrow() {
    let home = TestHome::new();

    raven()
        .args(["--home", home.path().to_str().unwrap(), "todo", "init"])
        .assert()
        .success();

    let output = raven()
        .args([
            "--home",
            home.path().to_str().unwrap(),
            "todo",
            "task",
            "propose",
            "내일 처리",
        ])
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    let task: serde_json::Value = serde_json::from_slice(&output).unwrap();
    let task_id = task["id"].as_str().unwrap();
    let tomorrow = format_day(local_day().next_day().unwrap());

    let output = raven()
        .args([
            "--home",
            home.path().to_str().unwrap(),
            "todo",
            "postpone",
            task_id,
        ])
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    let postponed: serde_json::Value = serde_json::from_slice(&output).unwrap();
    assert_eq!(postponed["source"]["status"], "missed");
    assert_eq!(postponed["follow_up"]["scheduled"], tomorrow);
}

#[test]
fn postpone_help_documents_the_scheduled_option() {
    raven()
        .args(["todo", "postpone", "--help"])
        .assert()
        .success()
        .stdout(contains("--scheduled"));
}

#[test]
fn archive_list_shows_terminal_items() {
    let home = TestHome::new();

    raven()
        .args(["--home", home.path().to_str().unwrap(), "todo", "init"])
        .assert()
        .success();

    let output = raven()
        .args([
            "--home",
            home.path().to_str().unwrap(),
            "todo",
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

    raven()
        .args([
            "--home",
            home.path().to_str().unwrap(),
            "todo",
            "archive",
            item_id,
        ])
        .assert()
        .success();

    raven()
        .args([
            "--home",
            home.path().to_str().unwrap(),
            "todo",
            "archive-list",
        ])
        .assert()
        .success()
        .stdout(contains("보관 목록 확인"));
}

#[test]
fn goal_propose_prints_active_json() {
    let home = TestHome::new();

    raven()
        .args(["--home", home.path().to_str().unwrap(), "todo", "init"])
        .assert()
        .success();

    raven()
        .args([
            "--home",
            home.path().to_str().unwrap(),
            "todo",
            "goal",
            "propose",
            "Q3 OKR",
            "--horizon",
            "month",
            "--scheduled",
            "2026-06-01",
        ])
        .assert()
        .success()
        .stdout(contains("\"type\":\"goal\""))
        .stdout(contains("\"status\":\"active\""))
        .stdout(contains("\"proposed_by\":\"agent\""));
}

#[test]
fn agenda_date_range_period_emit_json() {
    let home = TestHome::new();

    raven()
        .args(["--home", home.path().to_str().unwrap(), "todo", "init"])
        .assert()
        .success();

    // agenda <date> emits a JSON array (not a Markdown table) — D-01.
    let agenda = raven()
        .args([
            "--home",
            home.path().to_str().unwrap(),
            "todo",
            "agenda",
            "2026-06-26",
        ])
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    let agenda: serde_json::Value = serde_json::from_slice(&agenda).unwrap();
    assert!(agenda.is_array(), "agenda stdout must be a JSON array");

    // date-range <from> <to> emits a JSON array.
    let range = raven()
        .args([
            "--home",
            home.path().to_str().unwrap(),
            "todo",
            "date-range",
            "2026-06-01",
            "2026-06-30",
        ])
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    let range: serde_json::Value = serde_json::from_slice(&range).unwrap();
    assert!(range.is_array(), "date-range stdout must be a JSON array");

    // period --horizon --period emits a PeriodView JSON object with period_key + roots.
    let period = raven()
        .args([
            "--home",
            home.path().to_str().unwrap(),
            "todo",
            "period",
            "--horizon",
            "month",
            "--period",
            "2026-06-01",
        ])
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    let period: serde_json::Value = serde_json::from_slice(&period).unwrap();
    assert!(
        period["period_key"].is_string(),
        "period stdout must carry period_key"
    );
    assert!(
        period["roots"].is_array(),
        "period stdout must carry a roots array"
    );
}

#[test]
fn update_parent_id_links_task_to_goal() {
    let home = TestHome::new();

    raven()
        .args(["--home", home.path().to_str().unwrap(), "todo", "init"])
        .assert()
        .success();

    let goal = raven()
        .args([
            "--home",
            home.path().to_str().unwrap(),
            "todo",
            "goal",
            "propose",
            "분기 목표",
            "--horizon",
            "month",
            "--scheduled",
            "2026-06-01",
        ])
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    let goal: serde_json::Value = serde_json::from_slice(&goal).unwrap();
    let goal_id = goal["id"].as_str().unwrap();

    let task = raven()
        .args([
            "--home",
            home.path().to_str().unwrap(),
            "todo",
            "task",
            "propose",
            "목표에 연결할 일",
        ])
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    let task: serde_json::Value = serde_json::from_slice(&task).unwrap();
    let task_id = task["id"].as_str().unwrap();

    let linked = raven()
        .args([
            "--home",
            home.path().to_str().unwrap(),
            "todo",
            "update",
            task_id,
            "--parent-id",
            goal_id,
            "--scheduled",
            "2026-06-29",
        ])
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    let linked: serde_json::Value = serde_json::from_slice(&linked).unwrap();
    assert_eq!(linked["parent_id"], goal_id);
    assert_eq!(linked["scheduled"], "2026-06-29");
}

#[test]
fn period_bad_horizon_exits_two() {
    let home = TestHome::new();

    raven()
        .args(["--home", home.path().to_str().unwrap(), "todo", "init"])
        .assert()
        .success();

    // Present-but-invalid horizon => TodoError::Validation => exit code 2.
    // This is the CLI half of the SC3 rejection-parity pair (API half: HTTP 400).
    raven()
        .args([
            "--home",
            home.path().to_str().unwrap(),
            "todo",
            "period",
            "--horizon",
            "bogus",
            "--period",
            "2026-06-01",
        ])
        .assert()
        .failure()
        .code(2);
}

#[test]
fn routine_materialize_covers_cli_intent() {
    let home = TestHome::new();

    raven()
        .args(["--home", home.path().to_str().unwrap(), "todo", "init"])
        .assert()
        .success();

    let output = raven()
        .args([
            "--home",
            home.path().to_str().unwrap(),
            "todo",
            "routine",
            "propose",
            "매일 호환성 점검",
            "--recurrence-rule",
            "daily",
            "--materialization-policy",
            "per_occurrence",
            "--future-occurrences",
            "2",
            "--actor",
            "user",
        ])
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    let routine: serde_json::Value = serde_json::from_slice(&output).unwrap();
    assert_eq!(routine["future_occurrences"], 2);

    raven()
        .args([
            "--home",
            home.path().to_str().unwrap(),
            "todo",
            "routine",
            "materialize",
        ])
        .assert()
        .success()
        .stdout(contains("\"status\":\"active\""));

    // The target cap is shared service policy.
    raven()
        .args([
            "--home",
            home.path().to_str().unwrap(),
            "todo",
            "routine",
            "propose",
            "잘못된 루틴",
            "--recurrence-rule",
            "daily",
            "--future-occurrences",
            "366",
        ])
        .assert()
        .code(2)
        .stderr(contains("future_occurrences must be between 1 and 365"));
}
