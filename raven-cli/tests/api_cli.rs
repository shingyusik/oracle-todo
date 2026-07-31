use std::process::Command;

fn raven(home: &std::path::Path) -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_raven"));
    command
        .args(["--home", home.to_str().unwrap()])
        .env_remove("RAVEN_API_TOKEN")
        .env_remove("RAVEN_API_TOKEN_FILE")
        .env_remove("RAVEN_API_BIND_HOST")
        .env_remove("RAVEN_API_BIND_PORT")
        .env_remove("RAVEN_API_ALLOW_UNSAFE_CLEARTEXT");
    command
}

#[test]
fn api_is_visible_in_help() {
    let output = Command::new(env!("CARGO_BIN_EXE_raven"))
        .arg("--help")
        .output()
        .unwrap();
    assert!(output.status.success());
    assert!(String::from_utf8(output.stdout).unwrap().contains("api"));
}

#[test]
fn api_fails_before_bind_without_a_token() {
    let home = tempfile::tempdir().unwrap();
    let output = raven(home.path())
        .arg("api")
        .env("RAVEN_API_BIND_HOST", "not-an-ip")
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(2));
    let stderr = String::from_utf8(output.stderr).unwrap();
    assert!(stderr.contains("API token"));
    assert!(!stderr.contains(home.path().to_str().unwrap()));
}

#[test]
fn api_rejects_invalid_bind_and_non_exact_unsafe_override() {
    let home = tempfile::tempdir().unwrap();
    for (host, allow) in [
        ("not-an-ip", None),
        ("0.0.0.0", None),
        ("0.0.0.0", Some("TRUE")),
    ] {
        let mut command = raven(home.path());
        command
            .arg("api")
            .env("RAVEN_API_TOKEN", "0123456789abcdef")
            .env("RAVEN_API_BIND_HOST", host);
        if let Some(value) = allow {
            command.env("RAVEN_API_ALLOW_UNSAFE_CLEARTEXT", value);
        }
        let output = command.output().unwrap();
        assert_eq!(output.status.code(), Some(2), "{host} {allow:?}");
        assert!(
            !String::from_utf8(output.stderr)
                .unwrap()
                .contains("0123456789abcdef")
        );
    }
}
