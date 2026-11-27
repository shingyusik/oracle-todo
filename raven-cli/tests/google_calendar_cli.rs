use std::process::{Command, Output};

use serde_json::{Value, json};

const CLIENT: &str = r#"{"installed":{"client_id":"cli-test.apps.googleusercontent.com","client_secret":"cli-test-secret","auth_uri":"https://evil.example/auth"}}"#;

fn raven(home: &std::path::Path, args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_raven"))
        .args(["--home", home.to_str().unwrap()])
        .args(args)
        .env_remove("RAVEN_GOOGLE_CALENDAR")
        .env_remove("RAVEN_GOOGLE_OAUTH_CLIENT_FILE")
        // Never reach Google: any network call goes to a closed loopback port.
        .env("RAVEN_GOOGLE_API_URL", "http://127.0.0.1:9")
        .env("RAVEN_CONSOLE_LOG", "off")
        .output()
        .unwrap()
}

fn json_stdout(output: &Output) -> Value {
    serde_json::from_slice(&output.stdout).unwrap_or_else(|_| {
        panic!(
            "stdout is not JSON: {}\nstderr: {}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        )
    })
}

fn json_error(output: &Output) -> Value {
    serde_json::from_slice(&output.stderr).unwrap_or_else(|_| {
        panic!(
            "stderr is not JSON: {}",
            String::from_utf8_lossy(&output.stderr)
        )
    })
}

#[test]
fn status_reads_without_creating_files_and_matches_the_api_shape() {
    let dir = tempfile::tempdir().unwrap();
    let home = dir.path().join("home");
    let output = raven(&home, &["google-calendar", "status", "--format", "json"]);
    assert!(output.status.success());
    let status = json_stdout(&output);
    assert_eq!(
        status,
        json!({
            "configured": false,
            "connection": "disconnected",
            "scopes": [],
            "calendar": null,
            "settings": {
                "enabled": false,
                "calendar_id": null,
                "calendar_summary": null,
                "time_zone": "Asia/Seoul",
                "poll_interval_secs": 120,
                "default_duration_minutes": 60,
                "sync_note": true,
                "push_since": null
            },
            "env_override": null,
            "schedule": {"scheduler_active": false, "next_run_at": null},
            "first_sync_pending": false,
            "last_sync": null,
            "links": {"total": 0, "error": 0}
        })
    );
    assert!(!home.join("integrations").exists());
}

#[test]
fn client_set_show_settings_and_state_errors() {
    let dir = tempfile::tempdir().unwrap();
    let home = dir.path().join("home");
    let download = dir.path().join("client_secret.json");
    std::fs::write(&download, CLIENT).unwrap();

    let output = raven(
        &home,
        &[
            "google-calendar",
            "client",
            "set",
            "--file",
            download.to_str().unwrap(),
        ],
    );
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(
        json_stdout(&output),
        json!({"configured": true, "client_id": "cli-test.apps.googleusercontent.com"})
    );
    let stored =
        std::fs::read_to_string(home.join("integrations/google-calendar/oauth-client.json"))
            .unwrap();
    assert!(!stored.contains("evil.example"));

    let output = raven(
        &home,
        &["google-calendar", "client", "show", "--format", "json"],
    );
    let text = String::from_utf8_lossy(&output.stdout).into_owned();
    assert!(!text.contains("cli-test-secret"));
    assert_eq!(json_stdout(&output)["configured"], true);

    let output = raven(
        &home,
        &[
            "google-calendar",
            "set",
            "--enabled",
            "true",
            "--poll-interval-secs",
            "300",
        ],
    );
    assert!(output.status.success());
    let status = json_stdout(&output);
    assert_eq!(status["settings"]["enabled"], true);
    assert_eq!(status["settings"]["poll_interval_secs"], 300);
    assert_eq!(status["configured"], true);

    let output = raven(
        &home,
        &[
            "--error-format",
            "json",
            "google-calendar",
            "set",
            "--default-duration-minutes",
            "0",
        ],
    );
    assert_eq!(output.status.code(), Some(2));
    let error = json_error(&output);
    assert_eq!(error["code"], "validation_error");
    assert!(error["fields"]["default_duration_minutes"].is_string());

    for args in [
        &["google-calendar", "sync"][..],
        &["google-calendar", "calendars"][..],
    ] {
        let mut full = vec!["--error-format", "json"];
        full.extend_from_slice(args);
        let output = raven(&home, &full);
        assert_eq!(output.status.code(), Some(2), "{args:?}");
        assert_eq!(json_error(&output)["code"], "google_calendar_not_connected");
    }

    let output = raven(&home, &["google-calendar", "disconnect"]);
    assert!(output.status.success());
    assert_eq!(json_stdout(&output)["connection"], "disconnected");
}

#[test]
fn missing_client_reports_not_configured() {
    let dir = tempfile::tempdir().unwrap();
    let home = dir.path().join("home");
    let output = raven(
        &home,
        &[
            "--error-format",
            "json",
            "google-calendar",
            "connect",
            "--no-open",
            "--timeout-secs",
            "10",
        ],
    );
    assert_eq!(output.status.code(), Some(2));
    assert_eq!(
        json_error(&output)["code"],
        "google_calendar_not_configured"
    );
}
