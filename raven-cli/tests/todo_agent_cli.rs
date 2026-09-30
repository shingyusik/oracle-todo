use assert_cmd::Command;
use serde_json::Value;
fn run(home: &std::path::Path, args: &[&str]) -> Value {
    let output = Command::new(env!("CARGO_BIN_EXE_raven"))
        .args(["--home", home.to_str().unwrap(), "todo"])
        .args(args)
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    serde_json::from_slice(&output).unwrap()
}
#[test]
fn json_pages_show_reopen_and_clear_tags() {
    let home = tempfile::tempdir().unwrap();
    Command::new(env!("CARGO_BIN_EXE_raven"))
        .args(["--home", home.path().to_str().unwrap(), "todo", "init"])
        .assert()
        .success();
    let item = run(home.path(), &["task", "create", "one", "--tag", "test"]);
    let id = item["id"].as_str().unwrap();
    assert_eq!(run(home.path(), &["show", id])["id"], id);
    assert_eq!(
        run(home.path(), &["list", "--format", "json", "--limit", "1"])["items"][0]["id"],
        id
    );
    assert_eq!(
        run(home.path(), &["update", id, "--clear-tags"])["tags"],
        serde_json::json!([])
    );
    run(home.path(), &["complete", id]);
    assert_eq!(run(home.path(), &["reopen", id])["status"], "active");
    assert_eq!(
        run(home.path(), &["routine", "materialize"]),
        serde_json::json!([])
    );
}
#[test]
fn reads_never_initialize_missing_store() {
    for args in [
        vec!["list", "--format", "json"],
        vec!["pending"],
        vec!["today"],
        vec!["archive-list"],
        vec!["health"],
    ] {
        let home = tempfile::tempdir().unwrap();
        Command::new(env!("CARGO_BIN_EXE_raven"))
            .args(["--home", home.path().to_str().unwrap(), "todo"])
            .args(args)
            .assert()
            .failure();
        assert!(!home.path().join("todo.sqlite").exists());
    }
}

#[test]
fn today_is_pure_and_pages_are_bounded() {
    let home = tempfile::tempdir().unwrap();
    Command::new(env!("CARGO_BIN_EXE_raven"))
        .args(["--home", home.path().to_str().unwrap(), "todo", "init"])
        .assert()
        .success();
    run(
        home.path(),
        &["routine", "create", "daily", "--recurrence-rule", "daily"],
    );
    assert_eq!(
        run(home.path(), &["today", "--format", "json"])["items"],
        serde_json::json!([])
    );
    let tasks = run(home.path(), &["routine", "materialize"]);
    assert!(!tasks.as_array().unwrap().is_empty());
    assert!(
        !run(home.path(), &["today", "--format", "json"])["items"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    let page = run(home.path(), &["list", "--format", "json", "--limit", "1"]);
    assert_eq!(page["items"].as_array().unwrap().len(), 1);
    assert_eq!(page["next"], 1);
    let page = run(
        home.path(),
        &["list", "--format", "json", "--offset", "100"],
    );
    assert_eq!(page["items"], serde_json::json!([]));
    assert_eq!(page["next"], Value::Null);
    for limit in ["0", "1001"] {
        Command::new(env!("CARGO_BIN_EXE_raven"))
            .args([
                "--home",
                home.path().to_str().unwrap(),
                "todo",
                "list",
                "--limit",
                limit,
            ])
            .assert()
            .code(2);
    }
}
#[test]
fn generated_help_excludes_legacy_adapter_options() {
    for args in [vec!["todo", "--help"], vec!["todo", "help"], vec!["todo"]] {
        let home = tempfile::tempdir().unwrap();
        let output = Command::new(env!("CARGO_BIN_EXE_raven"))
            .args(["--home", home.path().to_str().unwrap()])
            .args(args)
            .output()
            .unwrap();
        let text = format!(
            "{}{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(!text.contains("--home"));
        assert!(!text.contains("Serve the HTTP API"));
        assert!(text.contains("show"));
    }
}

#[test]
fn reads_reject_uninitialized_schema_without_migration() {
    let home = tempfile::tempdir().unwrap();
    let path = home.path().join("todo.sqlite");
    rusqlite::Connection::open(&path).unwrap();
    for args in [
        vec!["list"],
        vec!["pending"],
        vec!["today"],
        vec!["archive-list"],
        vec!["health"],
        vec!["agenda", "2026-01-01"],
    ] {
        Command::new(env!("CARGO_BIN_EXE_raven"))
            .args(["--home", home.path().to_str().unwrap(), "todo"])
            .args(args)
            .assert()
            .failure();
    }
    let db = rusqlite::Connection::open(&path).unwrap();
    let count: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(count, 0);
}
#[test]
fn event_update_exposes_metadata_and_explicit_participant_clear() {
    let home = tempfile::tempdir().unwrap();
    let event = run(home.path(), &["event", "create", "visit", "2099-01-01"]);
    let id = event["id"].as_str().unwrap();
    let updated = run(
        home.path(),
        &[
            "update",
            id,
            "--location",
            "office",
            "--with",
            "Sam",
            "--commitment-type",
            "consultation",
        ],
    );
    assert_eq!(updated["metadata_"]["location"], "office");
    assert_eq!(
        updated["metadata_"]["participants"],
        serde_json::json!(["Sam"])
    );
    assert_eq!(updated["metadata_"]["commitment_type"], "consultation");
    assert_eq!(
        run(home.path(), &["update", id, "--clear-participants"])["metadata_"]["participants"],
        serde_json::json!([])
    );
}

#[test]
fn task_creation_links_project_and_materialize_assigns_routine() {
    let home = tempfile::tempdir().unwrap();
    let project = run(
        home.path(),
        &[
            "project",
            "create",
            "project",
            "--definition-of-done",
            "done",
        ],
    );
    let routine = run(
        home.path(),
        &["routine", "create", "routine", "--recurrence-rule", "daily"],
    );
    let item = run(
        home.path(),
        &[
            "task",
            "create",
            "linked",
            "--project-id",
            project["id"].as_str().unwrap(),
            "--tag",
            "work",
        ],
    );
    assert_eq!(item["project_id"], project["id"]);
    assert!(item["routine_id"].is_null());
    let generated = run(
        home.path(),
        &[
            "routine",
            "materialize",
            routine["id"].as_str().unwrap(),
            "--future-occurrences",
            "2",
        ],
    );
    assert_eq!(generated[0]["routine_id"], routine["id"]);
    assert_eq!(item["tags"], serde_json::json!(["work"]));
    let id = item["id"].as_str().unwrap();
    Command::new(env!("CARGO_BIN_EXE_raven"))
        .args(["--home", home.path().to_str().unwrap(), "todo", "pending"])
        .assert()
        .success()
        .stdout(predicates::str::contains(id));
    for command in ["pending", "today", "archive-list"] {
        let result = run(home.path(), &[command, "--format", "json", "--limit", "1"]);
        assert!(result["items"].is_array());
        assert!(result.get("next").is_some());
    }
}

#[test]
fn update_expected_version_rejects_stale_write_without_changing_item() {
    let home = tempfile::tempdir().unwrap();
    let item = run(home.path(), &["task", "create", "original"]);
    let id = item["id"].as_str().unwrap();
    let version = item["updated_at"].as_str().unwrap();
    let updated = run(
        home.path(),
        &[
            "update",
            id,
            "--title",
            "winner",
            "--expected-updated-at",
            version,
        ],
    );
    Command::new(env!("CARGO_BIN_EXE_raven"))
        .args([
            "--home",
            home.path().to_str().unwrap(),
            "todo",
            "update",
            id,
            "--title",
            "stale",
            "--expected-updated-at",
            version,
        ])
        .assert()
        .code(2);
    assert_eq!(run(home.path(), &["show", id]), updated);
    Command::new(env!("CARGO_BIN_EXE_raven"))
        .args([
            "--home",
            home.path().to_str().unwrap(),
            "todo",
            "update",
            id,
            "--title",
            "invalid",
            "--expected-updated-at",
            "invalid",
        ])
        .assert()
        .code(2);
    assert_eq!(run(home.path(), &["show", id]), updated);
}
