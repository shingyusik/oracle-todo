use assert_cmd::Command;
use predicates::prelude::*;
use std::process::Command as ProcessCommand;
use tempfile::TempDir;

fn rust_cli() -> Command {
    Command::cargo_bin("oracle-todo").unwrap()
}

fn python_oracle_todo(home: &TempDir, args: &[&str]) -> std::process::Output {
    ProcessCommand::new("uv")
        .args(["run", "oracle-todo"])
        .args(args)
        .env("ORACLE_TODO_HOME", home.path())
        .output()
        .unwrap()
}

#[test]
fn rust_reads_python_created_database() {
    let home = TempDir::new().unwrap();

    let init = python_oracle_todo(&home, &["init"]);
    assert!(
        init.status.success(),
        "{}",
        String::from_utf8_lossy(&init.stderr)
    );

    let area = python_oracle_todo(&home, &["area", "create", "검증 영역"]);
    assert!(
        area.status.success(),
        "{}",
        String::from_utf8_lossy(&area.stderr)
    );

    let task = python_oracle_todo(
        &home,
        &[
            "task",
            "propose",
            "파이썬 생성 태스크",
            "--area",
            "검증 영역",
            "--actor",
            "oracle",
        ],
    );
    assert!(
        task.status.success(),
        "{}",
        String::from_utf8_lossy(&task.stderr)
    );

    rust_cli()
        .args(["--home", home.path().to_str().unwrap(), "pending"])
        .assert()
        .success()
        .stdout(predicate::str::contains("파이썬 생성 태스크"));
}

#[test]
fn python_reads_rust_created_database() {
    let home = TempDir::new().unwrap();

    rust_cli()
        .args(["--home", home.path().to_str().unwrap(), "init"])
        .assert()
        .success();
    rust_cli()
        .args([
            "--home",
            home.path().to_str().unwrap(),
            "area",
            "create",
            "검증 영역",
        ])
        .assert()
        .success();
    rust_cli()
        .args([
            "--home",
            home.path().to_str().unwrap(),
            "task",
            "propose",
            "러스트 생성 태스크",
            "--area",
            "검증 영역",
            "--actor",
            "oracle",
        ])
        .assert()
        .success();

    let pending = python_oracle_todo(&home, &["pending"]);
    assert!(
        pending.status.success(),
        "{}",
        String::from_utf8_lossy(&pending.stderr)
    );
    let stdout = String::from_utf8_lossy(&pending.stdout);
    assert!(stdout.contains("task"), "{stdout}");
    assert!(stdout.contains("proposed"), "{stdout}");
    assert!(stdout.contains("러스트"), "{stdout}");
    assert!(stdout.contains("태스크"), "{stdout}");
}
