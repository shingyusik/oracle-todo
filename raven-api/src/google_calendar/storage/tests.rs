use time::macros::datetime;

use super::*;
use crate::google_calendar::mapping::FieldHashes;
use crate::google_calendar::reconcile::{Link, LinkOrigin, LinkState, SyncCounts};

fn temp() -> (tempfile::TempDir, GoogleCalendarPaths) {
    let dir = tempfile::tempdir().unwrap();
    let paths = GoogleCalendarPaths::new(dir.path().join("home"));
    (dir, paths)
}

#[cfg(unix)]
fn mode(path: &Path) -> u32 {
    use std::os::unix::fs::PermissionsExt;
    fs::metadata(path).unwrap().permissions().mode() & 0o777
}

#[cfg(unix)]
fn set_mode(path: &Path, mode: u32) {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(mode)).unwrap();
}

fn write_raw(paths: &GoogleCalendarPaths, name: &str, bytes: &[u8]) -> PathBuf {
    fs::create_dir_all(paths.dir()).unwrap();
    let path = paths.dir().join(name);
    fs::write(&path, bytes).unwrap();
    #[cfg(unix)]
    set_mode(&path, 0o600);
    path
}

// --- paths & read-only behavior ------------------------------------------------

#[test]
fn layout_is_under_integrations_google_calendar() {
    let paths = GoogleCalendarPaths::new("/h");
    let dir = Path::new("/h/integrations/google-calendar");
    assert_eq!(paths.dir(), dir);
    assert_eq!(paths.settings_file(), dir.join("settings.json"));
    assert_eq!(paths.state_file(), dir.join("state.json"));
    assert_eq!(paths.token_file(), dir.join("token.json"));
    assert_eq!(paths.oauth_client_file(), dir.join("oauth-client.json"));
    assert_eq!(paths.sync_db(), dir.join("sync.sqlite"));
    assert_eq!(paths.lock_file(), dir.join("sync.lock"));
    assert_eq!(format!("{paths:?}"), "GoogleCalendarPaths(<redacted>)");
    assert_eq!(
        paths.oauth_client_source(Some(std::ffi::OsStr::new("/x/client.json"))),
        Path::new("/x/client.json")
    );
    assert_eq!(
        paths.oauth_client_source(Some(std::ffi::OsStr::new(""))),
        dir.join("oauth-client.json")
    );
    assert_eq!(
        paths.oauth_client_source(None),
        dir.join("oauth-client.json")
    );
}

#[test]
fn reading_never_creates_anything() {
    let (_dir, paths) = temp();
    assert_eq!(
        load_settings(&paths).unwrap(),
        GoogleCalendarSettings::default()
    );
    assert_eq!(load_state(&paths).unwrap(), SyncState::default());
    assert_eq!(load_token(&paths).unwrap(), None);
    assert_eq!(load_oauth_client(&paths.oauth_client_file()).unwrap(), None);
    assert!(SyncDb::open_existing(&paths).unwrap().is_none());
    delete_token(&paths).unwrap();
    assert!(!paths.home.exists());
}

// --- settings.json --------------------------------------------------------------

#[test]
fn settings_default_file_shape_matches_contract() {
    let (_dir, paths) = temp();
    save_settings(&paths, &GoogleCalendarSettings::default()).unwrap();
    let value: serde_json::Value =
        serde_json::from_slice(&fs::read(paths.settings_file()).unwrap()).unwrap();
    assert_eq!(
        value,
        serde_json::json!({
            "version": 1, "enabled": false, "calendar_id": null, "calendar_summary": null,
            "time_zone": "Asia/Seoul", "poll_interval_secs": 120,
            "default_duration_minutes": 60, "sync_note": true, "push_since": null
        })
    );
}

#[cfg(unix)]
#[test]
fn writes_are_private_and_atomic() {
    let (_dir, paths) = temp();
    save_settings(&paths, &GoogleCalendarSettings::default()).unwrap();
    save_state(&paths, &SyncState::default()).unwrap();
    save_token(
        &paths,
        &StoredToken::new("1//r", vec!["s".into()], "2026-07-01T00:00:00Z".into()),
    )
    .unwrap();
    assert_eq!(mode(&paths.dir()), 0o700);
    for file in [
        paths.settings_file(),
        paths.state_file(),
        paths.token_file(),
    ] {
        assert_eq!(mode(&file), 0o600, "{}", file.display());
    }
    let leftovers: Vec<_> = fs::read_dir(paths.dir())
        .unwrap()
        .filter_map(Result::ok)
        .filter(|entry| entry.file_name().to_string_lossy().contains(".tmp-"))
        .collect();
    assert!(leftovers.is_empty());
}

#[test]
fn settings_round_trip_and_update() {
    let (_dir, paths) = temp();
    let settings = GoogleCalendarSettings {
        enabled: true,
        calendar_id: Some("abc@group.calendar.google.com".into()),
        calendar_summary: Some("Raven".into()),
        push_since: Some("2026-07-03".into()),
        ..Default::default()
    };
    save_settings(&paths, &settings).unwrap();
    assert_eq!(load_settings(&paths).unwrap(), settings);
    assert_eq!(
        settings.push_since_date(),
        Some(time::macros::date!(2026 - 07 - 03))
    );

    let next = update_settings(
        &paths,
        SettingsUpdate {
            poll_interval_secs: Some(600),
            sync_note: Some(false),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(next.poll_interval_secs, 600);
    assert!(!next.sync_note);
    assert_eq!(next.calendar_id, settings.calendar_id);
    assert_eq!(load_settings(&paths).unwrap(), next);
}

#[test]
fn settings_validation_table() {
    let base = GoogleCalendarSettings::default;
    let cases: Vec<(GoogleCalendarSettings, Option<&str>)> = vec![
        (base(), None),
        (
            GoogleCalendarSettings {
                poll_interval_secs: 60,
                ..base()
            },
            None,
        ),
        (
            GoogleCalendarSettings {
                poll_interval_secs: 3600,
                ..base()
            },
            None,
        ),
        (
            GoogleCalendarSettings {
                poll_interval_secs: 59,
                ..base()
            },
            Some("poll_interval_secs"),
        ),
        (
            GoogleCalendarSettings {
                poll_interval_secs: 3601,
                ..base()
            },
            Some("poll_interval_secs"),
        ),
        (
            GoogleCalendarSettings {
                default_duration_minutes: 0,
                ..base()
            },
            Some("default_duration_minutes"),
        ),
        (
            GoogleCalendarSettings {
                default_duration_minutes: 1441,
                ..base()
            },
            Some("default_duration_minutes"),
        ),
        (
            GoogleCalendarSettings {
                time_zone: String::new(),
                ..base()
            },
            Some("time_zone"),
        ),
        (
            GoogleCalendarSettings {
                time_zone: "Asia/Seoul; rm".into(),
                ..base()
            },
            Some("time_zone"),
        ),
        (
            GoogleCalendarSettings {
                calendar_id: Some(" ".into()),
                ..base()
            },
            Some("calendar_id"),
        ),
        (
            GoogleCalendarSettings {
                push_since: Some("07/03/2026".into()),
                ..base()
            },
            Some("push_since"),
        ),
    ];
    for (settings, field) in cases {
        let result = settings.validate();
        match field {
            None => assert_eq!(result, Ok(()), "{settings:?}"),
            Some(field) => assert_eq!(result, Err(StorageError::Validation { field })),
        }
    }
    let (_dir, paths) = temp();
    let error = update_settings(
        &paths,
        SettingsUpdate {
            poll_interval_secs: Some(5),
            ..Default::default()
        },
    )
    .unwrap_err();
    assert_eq!(
        error,
        StorageError::Validation {
            field: "poll_interval_secs"
        }
    );
    assert!(!paths.settings_file().exists());
}

#[test]
fn settings_reject_unknown_fields_bad_version_invalid_values_and_oversize() {
    let (_dir, paths) = temp();
    let valid = r#"{"version":1,"enabled":false,"calendar_id":null,"calendar_summary":null,"time_zone":"Asia/Seoul","poll_interval_secs":120,"default_duration_minutes":60,"sync_note":true,"push_since":null}"#;
    write_raw(&paths, "settings.json", valid.as_bytes());
    assert!(load_settings(&paths).is_ok());
    let cases = [
        (
            valid.replace("\"push_since\":null", "\"push_since\":null,\"extra\":1"),
            StorageError::Invalid,
        ),
        (
            valid.replace("\"version\":1", "\"version\":2"),
            StorageError::UnsupportedVersion,
        ),
        (valid.replace("120", "1"), StorageError::Invalid),
        ("not json".to_owned(), StorageError::Invalid),
        (
            format!("{valid}{}", " ".repeat(5000)),
            StorageError::TooLarge,
        ),
    ];
    for (text, expected) in cases {
        write_raw(&paths, "settings.json", text.as_bytes());
        assert_eq!(
            load_settings(&paths),
            Err(expected),
            "{}",
            &text[..text.len().min(80)]
        );
    }
}

// --- state.json -----------------------------------------------------------------

#[test]
fn state_round_trip_with_last_sync() {
    let (_dir, paths) = temp();
    let state = SyncState {
        connection: ConnectionState::Connected,
        connected_at: Some("2026-07-01T00:00:00Z".into()),
        first_sync_completed_at: None,
        last_sync: Some(LastSync {
            run_id: "r1".into(),
            trigger: "scheduled".into(),
            started_at: "2026-07-01T00:00:00Z".into(),
            finished_at: "2026-07-01T00:00:01Z".into(),
            outcome: "ok".into(),
            counts: SyncCounts {
                google_created: 2,
                conflicts: 1,
                ..Default::default()
            },
            error_kind: None,
        }),
    };
    save_state(&paths, &state).unwrap();
    assert_eq!(load_state(&paths).unwrap(), state);
    let value: serde_json::Value =
        serde_json::from_slice(&fs::read(paths.state_file()).unwrap()).unwrap();
    assert_eq!(value["version"], 1);
    assert_eq!(value["connection"], "connected");
    assert_eq!(value["last_sync"]["counts"]["google_created"], 2);
    assert_eq!(value["last_sync"]["counts"]["skipped_recurring"], 0);
    assert_eq!(ConnectionState::ReauthRequired.as_str(), "reauth_required");
}

#[test]
fn state_rejects_unknown_fields_and_versions() {
    let (_dir, paths) = temp();
    write_raw(
        &paths,
        "state.json",
        br#"{"version":1,"connection":"connected","connected_at":null,"first_sync_completed_at":null,"last_sync":null,"token":"x"}"#,
    );
    assert_eq!(load_state(&paths), Err(StorageError::Invalid));
    write_raw(
        &paths,
        "state.json",
        br#"{"version":9,"connection":"connected","connected_at":null,"first_sync_completed_at":null,"last_sync":null}"#,
    );
    assert_eq!(load_state(&paths), Err(StorageError::UnsupportedVersion));
    write_raw(
        &paths,
        "state.json",
        br#"{"version":1,"connection":"weird","connected_at":null,"first_sync_completed_at":null,"last_sync":null}"#,
    );
    assert_eq!(load_state(&paths), Err(StorageError::Invalid));
}

// --- token.json -----------------------------------------------------------------

#[test]
fn token_round_trip_redacts_and_deletes() {
    let (_dir, paths) = temp();
    let token = StoredToken::new(
        "1//secret-refresh",
        vec!["https://www.googleapis.com/auth/calendar.events".into()],
        "2026-07-01T00:00:00Z".into(),
    );
    save_token(&paths, &token).unwrap();
    let loaded = load_token(&paths).unwrap().unwrap();
    assert_eq!(loaded, token);
    assert_eq!(loaded.refresh_token(), "1//secret-refresh");
    assert!(!format!("{loaded:?}").contains("secret-refresh"));
    delete_token(&paths).unwrap();
    assert_eq!(load_token(&paths).unwrap(), None);
    assert_eq!(
        save_token(&paths, &StoredToken::new("", vec![], String::new())),
        Err(StorageError::Validation {
            field: "refresh_token"
        })
    );
}

#[cfg(unix)]
#[test]
fn token_readable_by_group_or_other_is_refused() {
    let (_dir, paths) = temp();
    save_token(
        &paths,
        &StoredToken::new("1//r", vec![], "2026-07-01T00:00:00Z".into()),
    )
    .unwrap();
    for (mode, ok) in [
        (0o600, true),
        (0o400, true),
        (0o640, false),
        (0o604, false),
        (0o620, false),
        (0o644, false),
    ] {
        set_mode(&paths.token_file(), mode);
        let result = load_token(&paths);
        if ok {
            assert!(result.is_ok(), "{mode:o}");
        } else {
            assert_eq!(result, Err(StorageError::InsecurePermissions), "{mode:o}");
        }
    }
}

#[cfg(unix)]
#[test]
fn token_symlink_is_refused() {
    let (dir, paths) = temp();
    let target = dir.path().join("elsewhere.json");
    fs::write(
        &target,
        br#"{"version":1,"refresh_token":"x","scopes":[],"obtained_at":""}"#,
    )
    .unwrap();
    set_mode(&target, 0o600);
    fs::create_dir_all(paths.dir()).unwrap();
    std::os::unix::fs::symlink(&target, paths.token_file()).unwrap();
    assert_eq!(load_token(&paths), Err(StorageError::InsecurePermissions));
}

#[test]
fn token_rejects_unknown_fields_and_oversize() {
    let (_dir, paths) = temp();
    write_raw(
        &paths,
        "token.json",
        br#"{"version":1,"refresh_token":"x","scopes":[],"obtained_at":"","access_token":"y"}"#,
    );
    assert_eq!(load_token(&paths), Err(StorageError::Invalid));
    write_raw(&paths, "token.json", &vec![b' '; 17 * 1024]);
    assert_eq!(load_token(&paths), Err(StorageError::TooLarge));
}

// --- oauth-client.json ------------------------------------------------------------

const GOOGLE_CLIENT: &str = r#"{"installed":{"client_id":"123.apps.googleusercontent.com","project_id":"p","auth_uri":"https://evil.example/auth","token_uri":"https://evil.example/token","auth_provider_x509_cert_url":"https://www.googleapis.com/oauth2/v1/certs","client_secret":"GOCSPX-secret","redirect_uris":["http://localhost"]}}"#;

#[test]
fn oauth_client_parse_table() {
    let parsed = parse_oauth_client(GOOGLE_CLIENT.as_bytes()).unwrap();
    assert_eq!(parsed.client_id, "123.apps.googleusercontent.com");
    assert_eq!(parsed.client_secret.expose(), "GOCSPX-secret");
    assert!(!format!("{parsed:?}").contains("GOCSPX"));
    for bad in [
        r#"{"web":{"client_id":"a","client_secret":"b"}}"#,
        r#"{"installed":{"client_id":"a"}}"#,
        r#"{"installed":{"client_id":" ","client_secret":"b"}}"#,
        r#"{"installed":{"client_id":"a","client_secret":""}}"#,
        "[]",
    ] {
        assert_eq!(
            parse_oauth_client(bad.as_bytes()),
            Err(StorageError::Invalid),
            "{bad}"
        );
    }
}

#[test]
fn oauth_client_import_stores_only_id_and_secret_privately() {
    let (dir, paths) = temp();
    let source = dir.path().join("download.json");
    fs::write(&source, GOOGLE_CLIENT).unwrap();
    let imported = import_oauth_client(&paths, &source).unwrap();
    assert_eq!(imported.client_id, "123.apps.googleusercontent.com");
    let stored = fs::read_to_string(paths.oauth_client_file()).unwrap();
    assert!(!stored.contains("evil.example"));
    #[cfg(unix)]
    assert_eq!(mode(&paths.oauth_client_file()), 0o600);
    assert_eq!(
        load_oauth_client(&paths.oauth_client_file()).unwrap(),
        Some(imported)
    );
    // Invalid source leaves nothing behind.
    let (dir, paths) = temp();
    let source = dir.path().join("bad.json");
    fs::write(&source, "{}").unwrap();
    assert_eq!(
        import_oauth_client(&paths, &source),
        Err(StorageError::Invalid)
    );
    assert!(!paths.home.exists());
    assert_eq!(
        import_oauth_client(&paths, &dir.path().join("missing.json")),
        Err(StorageError::Io)
    );
}

// --- sync.lock ----------------------------------------------------------------------

#[test]
fn sync_lock_is_exclusive() {
    let (_dir, paths) = temp();
    let first = try_lock(&paths).unwrap();
    assert!(first.is_some());
    assert!(try_lock(&paths).unwrap().is_none());
    drop(first);
    assert!(try_lock(&paths).unwrap().is_some());
}

// --- sync.sqlite --------------------------------------------------------------------

fn link(google_event_id: &str, raven_item_id: &str) -> Link {
    let mut link = Link::new(
        "cal",
        google_event_id,
        raven_item_id,
        LinkOrigin::Raven,
        datetime!(2026-07-01 00:00:00.123456789 UTC),
    );
    link.google_etag = Some("\"1\"".into());
    link.google_updated = Some(datetime!(2026-07-01 00:00 UTC));
    link.google_time_zone = Some("Asia/Seoul".into());
    link.base_hashes = FieldHashes {
        title: "a".into(),
        start: "b".into(),
        note: String::new(),
        location: "d".into(),
        status: Some("e".into()),
    };
    link.duration_seconds = Some(3600);
    link
}

#[test]
fn schema_is_created_at_user_version_one() {
    let (_dir, paths) = temp();
    let db = SyncDb::open(&paths).unwrap();
    assert_eq!(db.user_version().unwrap(), 1);
    let tables: Vec<String> = db
        .conn
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .unwrap()
        .query_map([], |row| row.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    assert_eq!(tables, ["calendars", "links", "pending_inbound"]);
    drop(db);
    #[cfg(unix)]
    {
        assert_eq!(mode(&paths.sync_db()), 0o600);
        assert_eq!(mode(&paths.dir()), 0o700);
    }
    // Reopening is idempotent and open_existing finds it.
    assert_eq!(SyncDb::open(&paths).unwrap().user_version().unwrap(), 1);
    assert!(SyncDb::open_existing(&paths).unwrap().is_some());
}

#[test]
fn open_existing_migrates_an_empty_database_and_rejects_newer() {
    let (_dir, paths) = temp();
    fs::create_dir_all(paths.dir()).unwrap();
    Connection::open(paths.sync_db()).unwrap();
    let db = SyncDb::open_existing(&paths).unwrap().unwrap();
    assert_eq!(db.user_version().unwrap(), 1);
    drop(db);
    let conn = Connection::open(paths.sync_db()).unwrap();
    conn.pragma_update(None, "user_version", 2).unwrap();
    drop(conn);
    assert_eq!(
        SyncDb::open_existing(&paths).unwrap_err(),
        StorageError::UnsupportedVersion
    );
    assert_eq!(
        SyncDb::open(&paths).unwrap_err(),
        StorageError::UnsupportedVersion
    );
}

#[test]
fn links_round_trip_and_lookup() {
    let db = SyncDb::in_memory().unwrap();
    let repo = db.repo();
    let first = link("g1", "e1");
    let mut second = link("g2", "e2");
    second.origin = LinkOrigin::Google;
    second.state = LinkState::Frozen;
    second.google_etag = None;
    second.google_updated = None;
    second.duration_seconds = None;
    second.duration_days = Some(2);
    repo.upsert_link(&second).unwrap();
    repo.upsert_link(&first).unwrap();
    assert_eq!(
        repo.links("cal").unwrap(),
        vec![first.clone(), second.clone()]
    );
    assert_eq!(repo.links("other").unwrap(), vec![]);
    assert_eq!(repo.link_by_google("cal", "g2").unwrap(), Some(second));
    assert_eq!(
        repo.link_by_raven("cal", "e1").unwrap(),
        Some(first.clone())
    );
    assert_eq!(repo.link_by_raven("cal", "missing").unwrap(), None);
    repo.delete_link("cal", "g1").unwrap();
    assert_eq!(repo.link_by_google("cal", "g1").unwrap(), None);
}

#[test]
fn upsert_replaces_by_google_id_and_relinks_by_raven_id() {
    let db = SyncDb::in_memory().unwrap();
    let repo = db.repo();
    repo.upsert_link(&link("g1", "e1")).unwrap();
    // Postpone re-link: same Google event, new Raven id.
    let mut relinked = link("g1", "e2");
    relinked.state = LinkState::Active;
    repo.upsert_link(&relinked).unwrap();
    assert_eq!(repo.links("cal").unwrap(), vec![relinked.clone()]);
    // A new Google id for an already-linked Raven id replaces the stale row.
    let moved = link("g9", "e2");
    repo.upsert_link(&moved).unwrap();
    assert_eq!(repo.links("cal").unwrap(), vec![moved]);
    // Placeholder raven ids are rejected (runtime must fill CreateRaven links).
    assert_eq!(
        repo.upsert_link(&link("g3", "")),
        Err(StorageError::Validation { field: "link" })
    );
}

#[test]
fn transaction_commits_or_rolls_back() {
    let mut db = SyncDb::in_memory().unwrap();
    let result: Result<(), StorageError> = db.transaction(|repo| {
        repo.upsert_link(&link("g1", "e1"))?;
        Err(StorageError::Io)
    });
    assert_eq!(result, Err(StorageError::Io));
    assert!(db.repo().links("cal").unwrap().is_empty());
    db.transaction(|repo| {
        repo.upsert_link(&link("g1", "e1"))?;
        repo.set_sync_token("cal", Some("tok"), true, datetime!(2026-07-01 00:00 UTC))
    })
    .unwrap();
    assert_eq!(db.repo().links("cal").unwrap().len(), 1);
    assert_eq!(
        db.repo()
            .calendar("cal")
            .unwrap()
            .unwrap()
            .sync_token
            .as_deref(),
        Some("tok")
    );
}

#[test]
fn calendar_sync_token_lifecycle() {
    let db = SyncDb::in_memory().unwrap();
    let repo = db.repo();
    assert_eq!(repo.calendar("cal").unwrap(), None);
    repo.set_sync_token("cal", Some("t1"), true, datetime!(2026-07-01 00:00 UTC))
        .unwrap();
    let row = repo.calendar("cal").unwrap().unwrap();
    assert_eq!(row.sync_token.as_deref(), Some("t1"));
    assert_eq!(row.full_synced_at.as_deref(), Some("2026-07-01T00:00:00Z"));
    repo.set_sync_token("cal", Some("t2"), false, datetime!(2026-07-02 00:00 UTC))
        .unwrap();
    let row = repo.calendar("cal").unwrap().unwrap();
    assert_eq!(row.sync_token.as_deref(), Some("t2"));
    assert_eq!(row.full_synced_at.as_deref(), Some("2026-07-01T00:00:00Z"));
    assert_eq!(row.updated_at, "2026-07-02T00:00:00Z");
    repo.clear_sync_token("cal", datetime!(2026-07-03 00:00 UTC))
        .unwrap();
    assert_eq!(repo.calendar("cal").unwrap().unwrap().sync_token, None);
    repo.upsert_calendar(&CalendarRow {
        calendar_id: "c2".into(),
        sync_token: None,
        full_synced_at: None,
        updated_at: "x".into(),
    })
    .unwrap();
    assert!(repo.calendar("c2").unwrap().is_some());
}

#[test]
fn forget_calendar_drops_links_pending_and_token_of_that_calendar_only() {
    let db = SyncDb::in_memory().unwrap();
    let repo = db.repo();
    repo.upsert_link(&link("g1", "e1")).unwrap();
    let mut other = link("g1", "e1");
    other.calendar_id = "new".into();
    repo.upsert_link(&other).unwrap();
    repo.set_sync_token("cal", Some("t"), true, datetime!(2026-07-01 00:00 UTC))
        .unwrap();
    repo.record_pending_failure("cal", "g5", "invalid", datetime!(2026-07-01 00:00 UTC))
        .unwrap();
    assert_eq!(repo.forget_calendar("cal").unwrap(), 1);
    assert!(repo.links("cal").unwrap().is_empty());
    assert!(repo.pending("cal").unwrap().is_empty());
    assert_eq!(repo.calendar("cal").unwrap(), None);
    assert_eq!(repo.links("new").unwrap(), vec![other]);
}

#[test]
fn link_counts_and_error_recording() {
    let db = SyncDb::in_memory().unwrap();
    let repo = db.repo();
    repo.upsert_link(&link("g1", "e1")).unwrap();
    repo.upsert_link(&link("g2", "e2")).unwrap();
    assert_eq!(
        repo.link_counts("cal").unwrap(),
        LinkCounts { total: 2, error: 0 }
    );
    for _ in 0..3 {
        repo.record_link_error("cal", "g1", "server", 3).unwrap();
    }
    let errored = repo.link_by_google("cal", "g1").unwrap().unwrap();
    assert_eq!(errored.state, LinkState::Error);
    assert_eq!(errored.error_count, 3);
    assert_eq!(errored.error_kind.as_deref(), Some("server"));
    repo.record_link_error("cal", "g2", "server", 3).unwrap();
    assert_eq!(
        repo.link_by_google("cal", "g2").unwrap().unwrap().state,
        LinkState::Active
    );
    assert_eq!(
        repo.link_counts("cal").unwrap(),
        LinkCounts { total: 2, error: 2 }
    );
}

#[test]
fn pending_inbound_retries_up_to_max_attempts() {
    let db = SyncDb::in_memory().unwrap();
    let repo = db.repo();
    let now = datetime!(2026-07-01 00:00 UTC);
    assert_eq!(
        repo.record_pending_failure("cal", "g1", "invalid", now)
            .unwrap(),
        1
    );
    assert_eq!(
        repo.record_pending_failure("cal", "g1", "conflict", now + time::Duration::minutes(5))
            .unwrap(),
        2
    );
    let rows = repo.pending("cal").unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].last_error_kind.as_deref(), Some("conflict"));
    assert!(repo.due_pending("cal", now).unwrap().is_empty());
    assert_eq!(
        repo.due_pending("cal", now + time::Duration::minutes(5))
            .unwrap()
            .len(),
        1
    );
    for _ in 0..3 {
        repo.record_pending_failure("cal", "g1", "invalid", now)
            .unwrap();
    }
    assert_eq!(
        repo.pending("cal").unwrap()[0].attempts,
        PENDING_MAX_ATTEMPTS
    );
    assert!(
        repo.due_pending("cal", now + time::Duration::days(1))
            .unwrap()
            .is_empty()
    );
    repo.clear_pending("cal", "g1").unwrap();
    assert!(repo.pending("cal").unwrap().is_empty());
}

#[test]
fn corrupt_link_row_is_reported_without_details() {
    let db = SyncDb::in_memory().unwrap();
    db.conn
        .execute(
            "INSERT INTO links(calendar_id, google_event_id, raven_item_id, origin, state, raven_updated_at, base_hashes, last_synced_at)
             VALUES ('cal','g1','e1','raven','active','not-a-time','{}','also-bad')",
            [],
        )
        .unwrap();
    assert_eq!(db.repo().links("cal"), Err(StorageError::Invalid));
    assert!(
        db.conn
            .execute(
                "INSERT INTO links(calendar_id, google_event_id, raven_item_id, origin, state, raven_updated_at, base_hashes, last_synced_at)
                 VALUES ('cal','g2','e2','raven','bogus','t','{}','t')",
                [],
            )
            .is_err()
    );
}

#[test]
fn delete_sync_db_removes_database_files() {
    let (_dir, paths) = temp();
    drop(SyncDb::open(&paths).unwrap());
    write_raw(&paths, "sync.sqlite-journal", b"");
    delete_sync_db(&paths).unwrap();
    assert!(!paths.sync_db().exists());
    assert!(!paths.dir().join("sync.sqlite-journal").exists());
    delete_sync_db(&paths).unwrap();
}

#[test]
fn errors_expose_kinds_only() {
    for error in [
        StorageError::Io,
        StorageError::Invalid,
        StorageError::TooLarge,
        StorageError::InsecurePermissions,
        StorageError::UnsupportedVersion,
        StorageError::Database,
        StorageError::Validation { field: "x" },
    ] {
        assert!(!error.kind().is_empty());
        assert!(!error.to_string().contains('/'));
    }
}
