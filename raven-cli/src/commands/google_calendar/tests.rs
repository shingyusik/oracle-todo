use std::io::{Read, Write};

use raven_api::google_calendar::testing::{FakeGoogle, TEST_CLIENT_JSON};

use super::*;

fn calendar(dir: &tempfile::TempDir, fake: &FakeGoogle) -> GoogleCalendar {
    let home = dir.path().join("home");
    std::fs::create_dir_all(&home).unwrap();
    let calendar = fake
        .builder(&home, home.join("todo.sqlite"))
        .build()
        .unwrap();
    let client = dir.path().join("client.json");
    std::fs::write(&client, TEST_CLIENT_JSON).unwrap();
    calendar.set_oauth_client(&client).unwrap();
    calendar
}

fn http_get(url: &str) -> String {
    let rest = url.strip_prefix("http://").unwrap();
    let (authority, path) = rest.split_at(rest.find('/').unwrap());
    let mut stream = std::net::TcpStream::connect(authority).unwrap();
    write!(
        stream,
        "GET {path} HTTP/1.1\r\nHost: {authority}\r\nConnection: close\r\n\r\n"
    )
    .unwrap();
    let mut response = String::new();
    stream.read_to_string(&mut response).unwrap();
    response
}

fn query_value(url: &str, key: &str) -> String {
    url.split_once('?')
        .unwrap()
        .1
        .split('&')
        .find_map(|pair| pair.strip_prefix(&format!("{key}=")))
        .unwrap()
        .to_owned()
}

fn percent_decode(value: &str) -> String {
    let mut out = Vec::new();
    let bytes = value.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            out.push(u8::from_str_radix(&value[index + 1..index + 3], 16).unwrap());
            index += 3;
        } else {
            out.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(out).unwrap()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn connect_uses_its_own_loopback_listener_and_completes_on_redirect() {
    let dir = tempfile::tempdir().unwrap();
    let fake = FakeGoogle::new();
    let calendar = calendar(&dir, &fake);
    let args = GoogleConnectArgs {
        no_open: true,
        timeout_secs: 30,
    };
    let status = connect(&calendar, &args, |url| {
        let redirect = percent_decode(&query_value(url, "redirect_uri"));
        assert!(redirect.starts_with("http://127.0.0.1:"), "{redirect}");
        assert!(redirect.ends_with(CALLBACK_PATH));
        let state = query_value(url, "state");
        let callback = format!("{redirect}?state={state}&code=good-code");
        std::thread::spawn(move || {
            let response = http_get(&callback);
            assert!(response.starts_with("HTTP/1.1 200"), "{response}");
            assert!(
                response
                    .to_ascii_lowercase()
                    .contains("cache-control: no-store")
            );
        });
    })
    .await
    .unwrap();
    assert_eq!(status.connection, "connected");
    assert_eq!(fake.lock().exchanged_redirect_uris.len(), 1);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn connect_reports_a_failed_redirect() {
    let dir = tempfile::tempdir().unwrap();
    let fake = FakeGoogle::new();
    let calendar = calendar(&dir, &fake);
    let args = GoogleConnectArgs {
        no_open: true,
        timeout_secs: 30,
    };
    let error = connect(&calendar, &args, |url| {
        let redirect = percent_decode(&query_value(url, "redirect_uri"));
        std::thread::spawn(move || http_get(&format!("{redirect}?state=wrong&code=x")));
    })
    .await
    .unwrap_err();
    let error = error.downcast_ref::<CliError>().unwrap();
    assert_eq!(error.code, "validation_error");
    assert_eq!(error.exit, 2);
}

#[test]
fn sync_outcomes_map_to_exit_codes() {
    use raven_api::google_calendar::storage::LastSync;
    let report = |outcome: &str, dry_run: bool| SyncReport {
        dry_run,
        last_sync: Some(LastSync {
            run_id: "00000000-0000-4000-8000-000000000000".into(),
            trigger: "cli".into(),
            started_at: "2026-11-20T00:00:00Z".into(),
            finished_at: "2026-11-20T00:00:01Z".into(),
            outcome: outcome.into(),
            counts: Default::default(),
            error_kind: None,
        }),
    };
    for ok in ["ok", "nothing_to_do"] {
        assert!(outcome_error(&report(ok, false)).is_ok());
    }
    assert!(outcome_error(&report("guard_tripped", true)).is_ok());
    for (outcome, code, exit) in [
        ("partial", "google_calendar_sync_failed", 1),
        ("failed", "google_calendar_sync_failed", 1),
        ("guard_tripped", "google_calendar_guard_tripped", 2),
        ("reauth_required", "google_calendar_reauth_required", 2),
    ] {
        let error = outcome_error(&report(outcome, false)).unwrap_err();
        let error = error.downcast_ref::<CliError>().unwrap();
        assert_eq!((error.code.as_str(), error.exit), (code, exit), "{outcome}");
    }
}
