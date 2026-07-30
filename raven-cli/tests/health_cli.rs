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

    let output = assert_exit(home.path(), &["health", "timeline", "--format", "json"], 1);

    assert!(!home.path().join("health.sqlite").exists());
    assert!(!home.path().join("media/health").exists());
    assert!(
        !String::from_utf8(output.stderr)
            .unwrap()
            .contains(home.path().to_str().unwrap())
    );
}

#[test]
fn diet_and_timeline_json_round_trip_and_table_output() {
    let home = tempfile::tempdir().unwrap();
    init(home.path());
    let diet = add_diet(home.path());

    let timeline = json_success(home.path(), &["health", "timeline", "--format", "json"]);
    assert_eq!(timeline[0]["kind"], "diet");
    assert_eq!(timeline[0]["record"]["meal_type"], "lunch");
    assert_eq!(
        timeline[0]["record"]["tags"],
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
fn bowel_medication_and_all_metric_categories_round_trip() {
    let home = tempfile::tempdir().unwrap();
    init(home.path());

    let bowel = json_success(
        home.path(),
        &[
            "health",
            "bowel",
            "add",
            "--at",
            "2026-07-30T13:00:00+09:00",
            "--bristol",
            "4",
            "--blood-visible",
        ],
    );
    assert_eq!(bowel["attributes"]["bristol_scale"], 4);
    assert_eq!(bowel["attributes"]["blood_visible"], true);

    let medication = json_success(
        home.path(),
        &[
            "health",
            "medication",
            "add",
            "--at",
            "2026-07-30T14:00:00+09:00",
            "--name",
            "Vitamin",
            "--dose",
            "1",
            "--unit",
            "tablet",
        ],
    );
    assert_eq!(medication["category"], "medication");

    for args in [
        vec![
            "health",
            "metric",
            "add",
            "--at",
            "2026-07-30T07:00:00+09:00",
            "--category",
            "weight",
            "--name",
            "Weight",
            "--value",
            "70",
            "--unit",
            "kg",
        ],
        vec![
            "health",
            "metric",
            "add",
            "--at",
            "2026-07-30T08:00:00+09:00",
            "--category",
            "sleep",
            "--name",
            "Sleep",
            "--value",
            "8",
        ],
        vec![
            "health",
            "metric",
            "add",
            "--at",
            "2026-07-30T09:00:00+09:00",
            "--category",
            "lab",
            "--key",
            "fasting_glucose",
            "--name",
            "Fasting glucose",
            "--value",
            "90",
            "--unit",
            "mg/dL",
        ],
        vec![
            "health",
            "metric",
            "add",
            "--at",
            "2026-07-30T10:00:00+09:00",
            "--category",
            "symptom",
            "--key",
            "headache",
            "--name",
            "Headache",
            "--value",
            "3",
        ],
        vec![
            "health",
            "metric",
            "add",
            "--at",
            "2026-07-30T11:00:00+09:00",
            "--category",
            "overall_condition",
            "--name",
            "Condition",
            "--value",
            "8",
        ],
    ] {
        json_success(home.path(), &args);
    }

    let metrics = json_success(
        home.path(),
        &["health", "metric", "list", "--format", "json"],
    );
    assert_eq!(metrics.as_array().unwrap().len(), 5);
}

#[test]
fn daily_upsert_is_stable_and_strict_json_rejects_unknown_fields() {
    let home = tempfile::tempdir().unwrap();
    init(home.path());
    let input = r#"[{"at":"2026-07-30T07:00:00+09:00","category":"weight","name":"Weight","value":70,"unit":"kg"}]"#;
    let first = json_success(
        home.path(),
        &["health", "metric", "daily-upsert", "--json", input],
    );
    let changed = r#"[{"at":"2026-07-30T08:00:00+09:00","category":"weight","name":"Weight","value":71,"unit":"kg"}]"#;
    let second = json_success(
        home.path(),
        &["health", "metric", "daily-upsert", "--json", changed],
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
fn update_lifecycle_and_exact_purge_confirmation_work() {
    let home = tempfile::tempdir().unwrap();
    init(home.path());
    let diet = add_diet(home.path());
    let id = diet["id"].as_str().unwrap();

    let updated = json_success(
        home.path(),
        &["health", "diet", "update", id, "--food", "Noodles"],
    );
    assert_eq!(updated["food_name"], "Noodles");
    assert_exit(home.path(), &["health", "diet", "purge", id], 2);
    json_success(home.path(), &["health", "diet", "archive", id]);
    json_success(home.path(), &["health", "diet", "restore", id]);
    json_success(home.path(), &["health", "diet", "archive", id]);

    let preview = assert_exit(home.path(), &["health", "diet", "purge", id], 2);
    assert_eq!(
        serde_json::from_slice::<Value>(&preview.stdout).unwrap()["confirmation_id"],
        id
    );
    assert_exit(
        home.path(),
        &["health", "diet", "purge", id, "--confirm", "wrong"],
        2,
    );
    let purged = json_success(
        home.path(),
        &["health", "diet", "purge", id, "--confirm", id],
    );
    assert_eq!(purged["purged"], true);
    assert_exit(home.path(), &["health", "diet", "show", id], 4);
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

    success(home.path(), &["health", "timeline", "--format", "json"]);
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
    for command in [
        "diet",
        "bowel",
        "medication",
        "metric",
        "timeline",
        "trends",
    ] {
        assert!(help.contains(command));
    }
}
