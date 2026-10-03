use std::process::Command;

#[test]
fn mcp_help_works_without_a_home_or_credentials() {
    let temp = tempfile::tempdir().unwrap();
    let home = temp.path().join("absent");
    let output = Command::new(env!("CARGO_BIN_EXE_raven"))
        .args(["--home", home.to_str().unwrap(), "mcp", "--help"])
        .env_remove("RAVEN_API_TOKEN")
        .env_remove("RAVEN_API_TOKEN_FILE")
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let help = String::from_utf8(output.stdout).unwrap();
    assert!(help.contains("--port"));
    assert!(help.contains("--public-origin"));
    assert!(!home.exists());
}

#[test]
fn mcp_invalid_configuration_has_safe_json_errors() {
    let temp = tempfile::tempdir().unwrap();
    let output = Command::new(env!("CARGO_BIN_EXE_raven"))
        .args([
            "--home",
            temp.path().to_str().unwrap(),
            "--error-format",
            "json",
            "mcp",
            "--public-origin",
            "https://private-value.example/path",
        ])
        .env_remove("RAVEN_MCP_ACCESS_ISSUER")
        .env_remove("RAVEN_MCP_ACCESS_AUDIENCE")
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(2));
    let error: serde_json::Value = serde_json::from_slice(&output.stderr).unwrap();
    assert_eq!(error["code"], "validation_error");
    assert!(!String::from_utf8_lossy(&output.stderr).contains("private-value"));
    assert!(!temp.path().join("todo.sqlite").exists());
}

#[test]
fn mcp_origin_cannot_alias_its_custom_listener_port() {
    let temp = tempfile::tempdir().unwrap();
    let mut child = Command::new(env!("CARGO_BIN_EXE_raven"))
        .args([
            "--home",
            temp.path().to_str().unwrap(),
            "--error-format",
            "json",
            "mcp",
            "--port",
            "39003",
            "--public-origin",
            "https://127.0.0.1:39003",
            "--access-issuer",
            "https://test.cloudflareaccess.com",
            "--access-audience",
            "test-audience",
        ])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .unwrap();
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    while child.try_wait().unwrap().is_none() {
        if std::time::Instant::now() >= deadline {
            let _ = child.kill();
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    let output = child.wait_with_output().unwrap();
    assert_eq!(output.status.code(), Some(2));
    let error: serde_json::Value = serde_json::from_slice(&output.stderr).unwrap();
    assert_eq!(error["code"], "validation_error");
}
