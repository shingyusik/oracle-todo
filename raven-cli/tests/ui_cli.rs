use std::process::Command;

fn raven(home: &std::path::Path) -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_raven"));
    command.args(["--home", home.to_str().unwrap()]);
    command
}

#[test]
fn ui_is_visible_in_help_with_safe_defaults() {
    let output = Command::new(env!("CARGO_BIN_EXE_raven"))
        .args(["ui", "--help"])
        .output()
        .unwrap();
    assert!(output.status.success());
    let stdout = String::from_utf8(output.stdout).unwrap();
    assert!(stdout.contains("--ui-path"));
    assert!(stdout.contains("--port"));
    assert!(stdout.contains("3002"));
    assert!(stdout.contains("--no-open"));
    assert!(!stdout.contains("--host"));
}

#[test]
fn ui_rejects_missing_artifact_before_starting_or_opening_browser() {
    let home = tempfile::tempdir().unwrap();
    let output = raven(home.path())
        .args([
            "ui",
            "--ui-path",
            home.path().join("missing").to_str().unwrap(),
            "--no-open",
        ])
        .output()
        .unwrap();
    assert!(!output.status.success());
    let stderr = String::from_utf8(output.stderr).unwrap();
    assert!(stderr.contains("UI artifact"));
    assert!(!stderr.contains(home.path().to_str().unwrap()));
}
