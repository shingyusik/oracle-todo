use assert_cmd::Command;
use predicates::str::contains;
use std::ffi::OsString;

fn raven() -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_raven"));
    command.env("HOME", std::env::temp_dir());
    command
}

#[test]
fn raven_todo_rejects_the_legacy_api_server() {
    raven()
        .args(["todo", "api", "--host", "0.0.0.0"])
        .assert()
        .code(2)
        .stderr(contains("use `raven api` or `raven ui`"));
}

#[test]
fn raven_todo_rejects_the_legacy_api_after_the_option_delimiter() {
    raven()
        .args(["todo", "--", "api"])
        .assert()
        .code(2)
        .stderr(contains("use `raven api` or `raven ui`"));
}

#[test]
fn raven_todo_help_describes_only_the_raven_delegated_surface() {
    for args in [
        vec!["todo", "--help"],
        vec!["todo", "-h"],
        vec!["todo", "help"],
    ] {
        let output = raven().args(args).output().unwrap();

        assert!(output.status.success());
        let stdout = String::from_utf8(output.stdout).unwrap();
        assert!(stdout.contains("Policy-enforced personal ToDo engine"));
        assert!(stdout.contains("Usage: raven todo <COMMAND>"));
        assert!(stdout.contains("init"));
        assert!(stdout.contains("period"));
        for legacy in [
            "todo-engine",
            "TODO_ENGINE_HOME",
            "~/.todo-engine",
            "Serve the HTTP API",
            "\n  api ",
        ] {
            assert!(!stdout.contains(legacy), "{legacy}");
        }
    }
}

#[test]
fn nested_todo_help_keeps_the_raven_program_name() {
    for (args, usage, option) in [
        (
            &["todo", "task", "--help"][..],
            "Usage: raven todo task <COMMAND>",
            "propose",
        ),
        (
            &["todo", "postpone", "--help"][..],
            "Usage: raven todo postpone [OPTIONS] <ITEM_ID>",
            "--scheduled",
        ),
        (
            &["todo", "help", "task"][..],
            "Usage: raven todo task <COMMAND>",
            "propose",
        ),
        (
            &["todo", "help", "postpone"][..],
            "Usage: raven todo postpone [OPTIONS] <ITEM_ID>",
            "--scheduled",
        ),
    ] {
        let output = raven().args(args).output().unwrap();

        assert!(output.status.success());
        let stdout = String::from_utf8(output.stdout).unwrap();
        assert!(stdout.contains(usage), "{stdout}");
        assert!(stdout.contains(option), "{stdout}");
        for legacy in [
            "todo-engine",
            "TODO_ENGINE_HOME",
            "~/.todo-engine",
            "\n  api ",
        ] {
            assert!(!stdout.contains(legacy), "{legacy}");
        }
    }
}

#[test]
fn nested_home_is_rejected_before_it_can_target_the_resolved_raven_home() {
    let resolved = tempfile::tempdir().unwrap();
    let alternate = tempfile::tempdir().unwrap();
    let alternate_path = alternate.path().to_str().unwrap();

    for nested in [
        vec![
            OsString::from("--home"),
            alternate.path().as_os_str().to_owned(),
            OsString::from("init"),
        ],
        vec![
            OsString::from(format!("--home={alternate_path}")),
            OsString::from("init"),
        ],
        vec![
            OsString::from("--"),
            OsString::from(format!("--home={alternate_path}")),
            OsString::from("init"),
        ],
    ] {
        raven()
            .args(["--home", resolved.path().to_str().unwrap(), "todo"])
            .args(nested)
            .assert()
            .code(2)
            .stderr(contains("use `raven --home <path> todo ...`"));
    }

    assert!(!resolved.path().join("todo.sqlite").exists());
    assert!(!alternate.path().join("todo.sqlite").exists());
}

#[test]
fn api_remains_valid_as_a_todo_command_argument() {
    let home = tempfile::tempdir().unwrap();
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
            "api",
        ])
        .assert()
        .success()
        .stdout(contains("\"title\":\"api\""));
}
