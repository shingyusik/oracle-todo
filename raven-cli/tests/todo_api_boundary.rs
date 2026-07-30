use assert_cmd::Command;
use predicates::str::contains;

fn raven() -> Command {
    Command::new(env!("CARGO_BIN_EXE_raven"))
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
fn raven_todo_rejects_the_legacy_api_after_forwarded_root_options() {
    for args in [
        vec!["todo", "--home", "ignored", "api"],
        vec!["todo", "--home=ignored", "api"],
        vec!["todo", "--", "api"],
        vec!["todo", "--home=ignored", "--", "api"],
    ] {
        raven()
            .args(args)
            .assert()
            .code(2)
            .stderr(contains("use `raven api` or `raven ui`"));
    }
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
