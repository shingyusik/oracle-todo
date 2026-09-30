use std::path::Path;
use std::process::{Command, Output};

use serde_json::Value;

fn raven(home: &Path) -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_raven"));
    command
        .env("RAVEN_CONSOLE_LOG", "off")
        .args(["--home", home.to_str().unwrap()]);
    command
}

fn run(home: &Path, args: &[&str]) -> Output {
    raven(home).args(args).output().unwrap()
}

fn success(home: &Path, args: &[&str]) -> Output {
    let output = run(home, args);
    assert!(
        output.status.success(),
        "{args:?}\nstdout: {}\nstderr: {}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr),
    );
    output
}

fn json_success(home: &Path, args: &[&str]) -> Value {
    serde_json::from_slice(&success(home, args).stdout).unwrap()
}

fn assert_exit(home: &Path, args: &[&str], code: i32) -> Output {
    let output = run(home, args);
    assert_eq!(
        output.status.code(),
        Some(code),
        "{args:?}\nstdout: {}\nstderr: {}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr),
    );
    output
}

fn init(home: &Path) {
    success(home, &["init"]);
}

fn add_diet(home: &Path) -> Value {
    json_success(
        home,
        &[
            "health",
            "diet",
            "add",
            "--at",
            "2026-07-30T12:30:00+09:00",
            "--meal",
            "lunch",
            "--food",
            "Bibimbap",
            "--tags",
            "wheat,spicy",
        ],
    )
}

#[test]
fn init_is_idempotent_and_health_check_is_read_only() {
    let home = tempfile::tempdir().unwrap();
    let missing = home.path().join("health.sqlite");

    assert_exit(home.path(), &["health-check"], 1);
    assert!(!missing.exists());
    init(home.path());
    init(home.path());

    let before = std::fs::read(&missing).unwrap();
    let output = success(home.path(), &["health-check"]);
    let after = std::fs::read(&missing).unwrap();
    assert_eq!(before, after);
    let stdout = String::from_utf8(output.stdout).unwrap();
    assert!(stdout.contains("health=ok"));
    assert!(stdout.contains("media=ok"));
}

#[test]
fn read_commands_do_not_initialize_missing_health_storage() {
    let home = tempfile::tempdir().unwrap();

    let output = assert_exit(
        home.path(),
        &["health", "diet", "list", "--format", "json"],
        1,
    );

    assert!(!home.path().join("health.sqlite").exists());
    assert!(!home.path().join("media/health").exists());
    assert!(
        !String::from_utf8(output.stderr)
            .unwrap()
            .contains(home.path().to_str().unwrap())
    );
}

#[test]
fn diet_json_round_trip_and_table_output() {
    let home = tempfile::tempdir().unwrap();
    init(home.path());
    let diet = add_diet(home.path());

    let timeline = json_success(home.path(), &["health", "diet", "list", "--format", "json"]);
    assert_eq!(timeline["items"][0]["meal_type"], "lunch");
    assert_eq!(
        timeline["items"][0]["tags"],
        serde_json::json!(["spicy", "wheat"])
    );

    let table = success(home.path(), &["health", "diet", "list"]);
    let table = String::from_utf8(table.stdout).unwrap();
    assert!(table.starts_with("ID\tOCCURRED_AT\tMEAL\tFOOD"));
    assert!(table.contains(diet["id"].as_str().unwrap()));
}

#[test]
fn diet_image_is_bounded_validated_and_stored_by_generated_name() {
    let home = tempfile::tempdir().unwrap();
    init(home.path());
    let image = home.path().join("input.png");
    std::fs::write(
        &image,
        [
            0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, b'I', b'H', b'D', b'R', 0,
            0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0x1f, 0x15, 0xc4, 0x89, 0, 0, 0, 10, b'I', b'D',
            b'A', b'T', 0x78, 0x9c, 0x63, 0, 1, 0, 0, 5, 0, 1, 0x0d, 0x0a, 0x2d, 0xb4, 0, 0, 0, 0,
            b'I', b'E', b'N', b'D', 0xae, 0x42, 0x60, 0x82,
        ],
    )
    .unwrap();

    let diet = json_success(
        home.path(),
        &[
            "health",
            "diet",
            "add",
            "--at",
            "2026-07-30T12:30:00+09:00",
            "--meal",
            "lunch",
            "--food",
            "Soup",
            "--image",
            image.to_str().unwrap(),
        ],
    );

    let media_id = diet["media_id"].as_str().unwrap();
    assert_ne!(media_id, "input");
    let files = std::fs::read_dir(home.path().join("media/health"))
        .unwrap()
        .filter_map(Result::ok)
        .filter(|entry| !entry.file_name().to_string_lossy().starts_with('.'))
        .collect::<Vec<_>>();
    assert_eq!(files.len(), 1);
    assert!(files[0].file_name().to_string_lossy().starts_with(media_id));
}

#[test]
fn daily_upsert_is_stable_and_strict_json_rejects_unknown_fields() {
    let home = tempfile::tempdir().unwrap();
    init(home.path());
    let input = r#"[{"at":"2026-07-30T07:00:00+09:00","category":"weight","name":"Body weight","value":70,"unit":"kg"}]"#;
    let first = json_success(
        home.path(),
        &["health", "metric", "daily-upsert", "--json", input],
    );
    let changed = serde_json::json!([{ "at":"2026-07-30T08:00:00+09:00", "category":"weight", "value":71,"unit":"kg", "expected_updated_at":first[0]["updated_at"] }]).to_string();
    let second = json_success(
        home.path(),
        &["health", "metric", "daily-upsert", "--json", &changed],
    );
    assert_eq!(first[0]["id"], second[0]["id"]);
    assert_eq!(second[0]["value_num"], 71.0);

    assert_exit(
        home.path(),
        &[
            "health",
            "bowel",
            "add",
            "--json",
            r#"{"at":"2026-07-30T12:00:00Z","bristol":4,"extra":"no"}"#,
        ],
        2,
    );
}

#[test]
fn read_commands_do_not_retry_pending_cleanup_but_mutations_do() {
    let home = tempfile::tempdir().unwrap();
    init(home.path());
    let media_id = "11111111-1111-4111-8111-111111111111";
    let relative_path = format!("{media_id}.png");
    let blocked_path = home.path().join("media/health").join(&relative_path);
    std::fs::create_dir(&blocked_path).unwrap();
    let connection = rusqlite::Connection::open(home.path().join("health.sqlite")).unwrap();
    connection
        .execute(
            "INSERT INTO media_files (
                id, relative_path, mime_type, byte_size, checksum_sha256,
                cleanup_pending, created_at, updated_at, deleted_at
             ) VALUES (?1, ?2, 'image/png', 0, ?3, 1, ?4, ?4, ?4)",
            rusqlite::params![
                media_id,
                relative_path,
                "0".repeat(64),
                "2026-07-30T00:00:00.000000000Z",
            ],
        )
        .unwrap();
    drop(connection);

    success(home.path(), &["health", "diet", "list", "--format", "json"]);
    assert!(blocked_path.is_dir());
    assert_exit(
        home.path(),
        &[
            "health",
            "bowel",
            "add",
            "--at",
            "2026-07-30T12:00:00Z",
            "--bristol",
            "4",
        ],
        1,
    );

    let failed = run(
        home.path(),
        &[
            "--error-format",
            "json",
            "health",
            "bowel",
            "add",
            "--at",
            "2026-07-30T12:00:00Z",
            "--bristol",
            "4",
        ],
    );
    assert_eq!(failed.status.code(), Some(1));
    let failure: Value = serde_json::from_slice(&failed.stderr).unwrap();
    assert_eq!(failure["code"], "cleanup_failed");
    assert_eq!(failure["committed"], false);
    assert!(failed.stdout.is_empty());
    assert_eq!(
        rusqlite::Connection::open(home.path().join("health.sqlite"))
            .unwrap()
            .query_row("SELECT count(*) FROM health_events", [], |row| row
                .get::<_, i64>(0))
            .unwrap(),
        0
    );
    std::fs::remove_dir(&blocked_path).unwrap();
    json_success(
        home.path(),
        &[
            "health",
            "bowel",
            "add",
            "--at",
            "2026-07-30T12:00:00Z",
            "--bristol",
            "4",
        ],
    );
    let connection = rusqlite::Connection::open(home.path().join("health.sqlite")).unwrap();
    let pending: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM media_files WHERE cleanup_pending = 1",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(pending, 0);
}

#[test]
fn corrupt_database_and_private_input_fail_safely() {
    let home = tempfile::tempdir().unwrap();
    init(home.path());
    std::fs::write(home.path().join("health.sqlite"), b"not sqlite").unwrap();

    let output = assert_exit(home.path(), &["health-check"], 1);
    assert!(
        String::from_utf8(output.stdout)
            .unwrap()
            .contains("health=unavailable")
    );

    let private = "private-food-name";
    let output = assert_exit(
        home.path(),
        &[
            "health", "diet", "add", "--at", "invalid", "--meal", "lunch", "--food", private,
        ],
        1,
    );
    let stderr = String::from_utf8(output.stderr).unwrap();
    assert!(!stderr.contains(private));
    let log = std::fs::read_to_string(home.path().join("logs/raven.log.jsonl")).unwrap();
    assert!(!log.contains(private));
    assert!(!log.contains(home.path().to_str().unwrap()));
}

#[test]
fn validation_exit_codes_and_help_are_stable() {
    let home = tempfile::tempdir().unwrap();
    init(home.path());
    assert_exit(
        home.path(),
        &[
            "health",
            "bowel",
            "add",
            "--at",
            "2026-07-30T12:00:00Z",
            "--bristol",
            "8",
        ],
        2,
    );
    assert_exit(
        home.path(),
        &[
            "health",
            "metric",
            "add",
            "--at",
            "2026-07-30T12:00:00Z",
            "--category",
            "sleep",
            "--name",
            "Sleep",
            "--value",
            "25",
        ],
        2,
    );

    let help = success(home.path(), &["health", "--help"]);
    let help = String::from_utf8(help.stdout).unwrap();
    for command in ["diet", "bowel", "medication", "metric"] {
        assert!(help.contains(command));
    }
}

#[test]
fn every_health_table_cell_neutralizes_control_characters() {
    let home = tempfile::tempdir().unwrap();
    init(home.path());
    let diet = json_success(
        home.path(),
        &[
            "health",
            "diet",
            "add",
            "--at",
            "2026-07-31T12:00:00Z",
            "--meal",
            "lunch",
            "--food",
            "Food\tINJECT",
            "--tags",
            "tag\nrow",
            "--note",
            "note\u{1b}[31mred",
        ],
    );
    for args in [
        vec!["health", "diet", "list"],
        vec!["health", "diet", "show", diet["id"].as_str().unwrap()],
        vec!["health", "metric", "list"],
        vec!["health", "diet", "list"],
    ] {
        let output = success(home.path(), &args);
        let table = String::from_utf8(output.stdout).unwrap();
        assert!(!table.contains('\u{1b}'));
        for line in table.lines() {
            assert!(
                !line.contains("Food\tINJECT") && !line.contains("kg\tINJECT"),
                "unescaped cell: {line:?}"
            );
        }
    }
}

#[cfg(unix)]
#[test]
fn image_input_rejects_symlinks_without_disclosing_the_path() {
    use std::os::unix::fs::symlink;

    let home = tempfile::tempdir().unwrap();
    init(home.path());
    let target = home.path().join("target.png");
    std::fs::write(
        &target,
        [
            0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, b'I', b'H', b'D', b'R', 0,
            0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0x1f, 0x15, 0xc4, 0x89, 0, 0, 0, 10, b'I', b'D',
            b'A', b'T', 0x78, 0x9c, 0x63, 0, 1, 0, 0, 5, 0, 1, 0x0d, 0x0a, 0x2d, 0xb4, 0, 0, 0, 0,
            b'I', b'E', b'N', b'D', 0xae, 0x42, 0x60, 0x82,
        ],
    )
    .unwrap();
    let link = home.path().join("private-link.png");
    symlink(&target, &link).unwrap();

    let output = assert_exit(
        home.path(),
        &[
            "health",
            "diet",
            "add",
            "--at",
            "2026-07-31T12:00:00Z",
            "--meal",
            "lunch",
            "--food",
            "Soup",
            "--image",
            link.to_str().unwrap(),
        ],
        2,
    );
    assert!(
        !String::from_utf8(output.stderr)
            .unwrap()
            .contains(link.to_str().unwrap())
    );
}

#[cfg(unix)]
#[test]
fn image_input_rejects_a_fifo_without_blocking() {
    use std::os::unix::net::UnixListener;
    use std::process::Stdio;
    use std::thread;
    use std::time::{Duration, Instant};

    let home = tempfile::tempdir_in("/tmp").unwrap();
    init(home.path());
    let fifo = home.path().join("input.png");
    assert!(
        Command::new("mkfifo")
            .arg(&fifo)
            .status()
            .unwrap()
            .success()
    );

    let mut child = raven(home.path())
        .args([
            "health",
            "diet",
            "add",
            "--at",
            "2026-07-31T12:00:00Z",
            "--meal",
            "lunch",
            "--food",
            "Soup",
            "--image",
            fifo.to_str().unwrap(),
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(2);
    let status = loop {
        if let Some(status) = child.try_wait().unwrap() {
            break status;
        }
        if Instant::now() >= deadline {
            child.kill().unwrap();
            child.wait().unwrap();
            panic!("FIFO image input blocked instead of being rejected");
        }
        thread::sleep(Duration::from_millis(10));
    };
    assert_eq!(status.code(), Some(2));

    let socket = home.path().join("input.webp");
    let listener = match UnixListener::bind(&socket) {
        Ok(listener) => Some(listener),
        Err(error) if error.kind() == std::io::ErrorKind::PermissionDenied => None,
        Err(error) => panic!("could not create test socket: {error}"),
    };
    let paths = listener
        .as_ref()
        .map(|_| socket.as_path())
        .into_iter()
        .chain([Path::new("/dev/null")]);
    for path in paths {
        assert_exit(
            home.path(),
            &[
                "health",
                "diet",
                "add",
                "--at",
                "2026-07-31T12:00:00Z",
                "--meal",
                "lunch",
                "--food",
                "Soup",
                "--image",
                path.to_str().unwrap(),
            ],
            2,
        );
    }
}

#[test]
fn metrics_are_canonical_daily_only_and_require_current_version() {
    let home = tempfile::tempdir().unwrap();
    init(home.path());
    for args in [
        vec!["health", "metric", "add"],
        vec!["health", "metric", "update", "any"],
        vec!["health", "timeline"],
        vec!["health", "trends"],
        vec!["health", "diet", "purge", "any"],
    ] {
        assert_exit(home.path(), &args, 2);
    }
    let input = r#"[{"at":"2026-09-30T12:00:00+09:00","category":"weight","value":68}]"#;
    let first = json_success(
        home.path(),
        &["health", "metric", "daily-upsert", "--json", input],
    );
    assert_exit(
        home.path(),
        &["health", "metric", "daily-upsert", "--json", input],
        2,
    );
    let update=serde_json::json!([{ "at":"2026-09-30T12:00:00+09:00", "category":"weight","value":69,"expected_updated_at":first[0]["updated_at"] }]).to_string();
    let second = json_success(
        home.path(),
        &["health", "metric", "daily-upsert", "--json", &update],
    );
    assert_eq!(first[0]["id"], second[0]["id"]);
    assert_exit(
        home.path(),
        &["health", "metric", "daily-upsert", "--json", &update],
        2,
    );
    for invalid in [
        r#"[{"at":"2026-09-30T12:00:00+09:00","category":"lab","key":"crp","value":-1,"unit":"mg/L"}]"#,
        r#"[{"at":"2026-09-30T12:00:00+09:00","category":"weight","value":68,"unit":"lb"}]"#,
    ] {
        assert_exit(
            home.path(),
            &["health", "metric", "daily-upsert", "--json", invalid],
            2,
        );
    }
}
