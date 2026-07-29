use std::process::Command;

#[test]
fn raven_binary_prints_raven_help() {
    let output = Command::new(env!("CARGO_BIN_EXE_raven"))
        .arg("--help")
        .output()
        .unwrap();

    assert!(output.status.success());

    let stdout = String::from_utf8(output.stdout).unwrap();
    assert!(stdout.contains("Raven unified personal engine"));
    assert!(stdout.contains("Usage: raven"));
}
