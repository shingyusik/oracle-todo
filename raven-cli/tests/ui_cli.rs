use std::process::Command;
use std::sync::{Mutex, MutexGuard, OnceLock};

fn ui_server_test_lock() -> MutexGuard<'static, ()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(())).lock().unwrap()
}

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

#[test]
fn ui_rejects_an_invalid_public_origin_without_echoing_it() {
    let _lock = ui_server_test_lock();
    let home = tempfile::tempdir().unwrap();
    let ui = home.path().canonicalize().unwrap().join("ui");
    std::fs::create_dir(&ui).unwrap();
    std::fs::write(ui.join("index.html"), "Raven").unwrap();
    let invalid = "http://raven.b-sir.xyz/private";
    let mut command = raven(home.path());
    command
        .env("RAVEN_UI_PUBLIC_ORIGIN", invalid)
        .args(["ui", "--ui-path", ui.to_str().unwrap(), "--no-open"])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    let mut child = command.spawn().unwrap();
    let exited = (0..100).any(|_| {
        if child.try_wait().unwrap().is_some() {
            true
        } else {
            std::thread::sleep(std::time::Duration::from_millis(10));
            false
        }
    });
    if !exited {
        child.kill().unwrap();
        child.wait().unwrap();
        panic!("ui ignored invalid RAVEN_UI_PUBLIC_ORIGIN");
    }
    let output = child.wait_with_output().unwrap();
    assert_eq!(output.status.code(), Some(2));
    let stderr = String::from_utf8(output.stderr).unwrap();
    assert!(stderr.contains("invalid RAVEN_UI_PUBLIC_ORIGIN"));
    assert!(!stderr.contains(invalid));
}

#[cfg(unix)]
#[test]
fn ui_rejects_a_non_unicode_public_origin_without_echoing_it() {
    use std::os::unix::ffi::OsStringExt;

    let _lock = ui_server_test_lock();
    let home = tempfile::tempdir().unwrap();
    let ui = home.path().canonicalize().unwrap().join("ui");
    std::fs::create_dir(&ui).unwrap();
    std::fs::write(ui.join("index.html"), "Raven").unwrap();
    let invalid = std::ffi::OsString::from_vec(vec![0xff]);
    let mut command = raven(home.path());
    command
        .env("RAVEN_UI_PUBLIC_ORIGIN", &invalid)
        .args(["ui", "--ui-path", ui.to_str().unwrap(), "--no-open"])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    let mut child = command.spawn().unwrap();
    let exited = (0..100).any(|_| {
        if child.try_wait().unwrap().is_some() {
            true
        } else {
            std::thread::sleep(std::time::Duration::from_millis(10));
            false
        }
    });
    if !exited {
        child.kill().unwrap();
        child.wait().unwrap();
        panic!("ui ignored invalid RAVEN_UI_PUBLIC_ORIGIN");
    }
    let output = child.wait_with_output().unwrap();
    assert_eq!(output.status.code(), Some(2));
    let stderr = String::from_utf8(output.stderr).unwrap();
    assert!(stderr.contains("invalid RAVEN_UI_PUBLIC_ORIGIN"));
}

#[test]
fn ui_validates_public_origin_before_binding_the_listener() {
    let _lock = ui_server_test_lock();
    let occupied = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let port = occupied.local_addr().unwrap().port().to_string();
    let home = tempfile::tempdir().unwrap();
    let ui = home.path().canonicalize().unwrap().join("ui");
    std::fs::create_dir(&ui).unwrap();
    std::fs::write(ui.join("index.html"), "Raven").unwrap();
    let invalid = "https://:8443";

    let output = raven(home.path())
        .env("RAVEN_UI_PUBLIC_ORIGIN", invalid)
        .args([
            "ui",
            "--ui-path",
            ui.to_str().unwrap(),
            "--port",
            &port,
            "--no-open",
        ])
        .output()
        .unwrap();

    assert_eq!(output.status.code(), Some(2));
    let stderr = String::from_utf8(output.stderr).unwrap();
    assert!(stderr.contains("invalid RAVEN_UI_PUBLIC_ORIGIN"));
    assert!(!stderr.contains(invalid));
}
