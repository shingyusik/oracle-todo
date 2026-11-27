use serde_json::json;
use time::macros::{date, datetime};
use todo_engine::domain::{Actor, ExternalSource, ItemStatus, ItemType, TodoItem};

use super::*;

fn event(id: &str, scheduled: &str) -> TodoItem {
    let mut item = TodoItem::new(
        id,
        ItemType::Event,
        "Meeting",
        Actor::User,
        datetime!(2026-07-01 00:00 UTC),
    );
    item.scheduled = Some(scheduled.to_owned());
    item
}

fn seoul() -> MapConfig {
    MapConfig::default()
}

#[test]
fn deterministic_google_id_is_raven_plus_32_hex() {
    let id = google_event_id_for("evt-1");
    assert_eq!(id.len(), 37);
    assert!(id.starts_with("raven"));
    assert!(id[5..].chars().all(|c| matches!(c, '0'..='9' | 'a'..='f')));
    assert_eq!(id, google_event_id_for("evt-1"));
    assert_ne!(id, google_event_id_for("evt-2"));
    // sha256("evt-1") prefix, pinned so the id never silently changes.
    let digest = Sha256::digest(b"evt-1");
    assert_eq!(&id[5..], &hex(&digest)[..32]);
}

#[test]
fn schedule_parse_table() {
    let cases: &[(&str, Option<Schedule>)] = &[
        ("2026-07-14", Some(Schedule::Date(date!(2026 - 07 - 14)))),
        (
            "2026-07-14T01:00:00Z",
            Some(Schedule::At(datetime!(2026-07-14 01:00 UTC))),
        ),
        (
            "2026-07-14T10:00:00+09:00",
            Some(Schedule::At(datetime!(2026-07-14 10:00 +9))),
        ),
        ("2026-13-01", None),
        ("tomorrow", None),
        ("", None),
    ];
    for (text, expected) in cases {
        assert_eq!(Schedule::parse(text), *expected, "{text}");
    }
}

#[test]
fn raven_timestamp_in_utc_is_written_with_plus_nine() {
    let item = event("evt-1", "2026-07-14T01:00:00Z");
    let write = google_insert(&item, Durations::default(), None, &seoul()).unwrap();
    let body = write.to_json();
    assert_eq!(body["start"]["dateTime"], "2026-07-14T10:00:00+09:00");
    assert_eq!(body["start"]["timeZone"], "Asia/Seoul");
    assert_eq!(body["end"]["dateTime"], "2026-07-14T11:00:00+09:00");
    assert_eq!(body["start"]["date"], Value::Null);
    assert_eq!(body["id"], google_event_id_for("evt-1"));
    assert_eq!(body["status"], "confirmed");
    assert_eq!(
        body["extendedProperties"]["private"]["raven_item_id"],
        "evt-1"
    );
    assert!(!body.to_string().contains("Z\""));
}

#[test]
fn all_day_end_is_exclusive_and_uses_stored_days() {
    let item = event("evt-1", "2026-07-14");
    let write = google_insert(&item, Durations::default(), None, &seoul()).unwrap();
    assert_eq!(write.start, Some(EventTime::Date(date!(2026 - 07 - 14))));
    assert_eq!(write.end, Some(EventTime::Date(date!(2026 - 07 - 15))));
    let three = Durations {
        seconds: None,
        days: Some(3),
    };
    let write = google_insert(&item, three, None, &seoul()).unwrap();
    assert_eq!(write.end, Some(EventTime::Date(date!(2026 - 07 - 17))));
    let body = write.to_json();
    assert_eq!(
        body["start"],
        json!({"date": "2026-07-14", "dateTime": null, "timeZone": null})
    );
}

#[test]
fn timed_duration_from_link_and_default_and_link_time_zone() {
    let item = event("evt-1", "2026-07-14T10:00:00+09:00");
    let config = MapConfig {
        default_duration_minutes: 30,
        ..seoul()
    };
    let write = google_insert(&item, Durations::default(), None, &config).unwrap();
    assert_eq!(
        write.end,
        Some(EventTime::date_time(
            datetime!(2026-07-14 10:30 +9),
            Some("Asia/Seoul".into())
        ))
    );
    let stored = Durations {
        seconds: Some(5400),
        days: None,
    };
    let write = google_insert(&item, stored, Some("Europe/Paris"), &config).unwrap();
    assert_eq!(
        write.end,
        Some(EventTime::date_time(
            datetime!(2026-07-14 11:30 +9),
            Some("Europe/Paris".into())
        ))
    );
}

#[test]
fn insert_maps_title_note_location_and_paused_status() {
    let mut item = event("evt-1", "2026-07-14");
    item.title = "  ".into();
    item.note = Some("bring slides".into());
    item.status = ItemStatus::Paused;
    item.metadata.insert("location".into(), json!("Room A"));
    item.metadata.insert("participants".into(), json!(["kim"]));
    item.tags = vec!["work".into()];
    let write = google_insert(&item, Durations::default(), None, &seoul()).unwrap();
    assert_eq!(write.summary.as_deref(), Some(UNTITLED));
    assert_eq!(write.description.as_deref(), Some("bring slides"));
    assert_eq!(write.location.as_deref(), Some("Room A"));
    assert_eq!(write.status, Some(GEventStatus::Tentative));
    let body = write.to_json();
    assert!(body.get("attendees").is_none());
    let text = body.to_string();
    assert!(!text.contains("kim") && !text.contains("work"));

    let no_note = MapConfig {
        sync_note: false,
        ..seoul()
    };
    let write = google_insert(&item, Durations::default(), None, &no_note).unwrap();
    assert_eq!(write.description, None);
}

#[test]
fn insert_without_valid_schedule_is_none() {
    let mut item = event("evt-1", "bogus");
    assert!(google_insert(&item, Durations::default(), None, &seoul()).is_none());
    item.scheduled = None;
    assert!(google_insert(&item, Durations::default(), None, &seoul()).is_none());
}

#[test]
fn status_mapping_table() {
    for (status, expected) in [
        (ItemStatus::Active, GEventStatus::Confirmed),
        (ItemStatus::Paused, GEventStatus::Tentative),
        (ItemStatus::Completed, GEventStatus::Confirmed),
        (ItemStatus::Missed, GEventStatus::Confirmed),
    ] {
        assert_eq!(google_status_for(status), expected, "{status:?}");
    }
}

#[test]
fn google_timed_event_becomes_plus_nine_raven_event() {
    let mut google = GEvent::new("g1");
    google.summary = Some("Lunch".into());
    google.description = Some("menu".into());
    google.location = Some("Cafe".into());
    google.start = Some(EventTime::date_time(
        datetime!(2026-07-14 03:00 UTC),
        Some("UTC".into()),
    ));
    let new = raven_from_google(&google, "cal@x", &seoul()).unwrap();
    assert_eq!(new.title, "Lunch");
    assert_eq!(new.scheduled, "2026-07-14T12:00:00+09:00");
    assert_eq!(new.note.as_deref(), Some("menu"));
    assert_eq!(new.location.as_deref(), Some("Cafe"));
    assert_eq!(
        new.external_source,
        ExternalSource {
            system: "google_calendar".into(),
            id: "cal@x/g1".into()
        }
    );
    let propose = new.into_propose_event();
    assert_eq!(propose.actor, Actor::System);
    assert_eq!(propose.external_source.unwrap().id, "cal@x/g1".to_string());
}

#[test]
fn google_all_day_and_untitled_and_sync_note_off() {
    let mut google = GEvent::new("g1");
    google.summary = Some(String::new());
    google.description = Some("secret".into());
    google.start = Some(EventTime::Date(date!(2026 - 07 - 14)));
    let config = MapConfig {
        sync_note: false,
        ..seoul()
    };
    let new = raven_from_google(&google, "c", &config).unwrap();
    assert_eq!(new.title, UNTITLED);
    assert_eq!(new.scheduled, "2026-07-14");
    assert_eq!(new.note, None);
    assert_eq!(new.location, None);
    google.start = None;
    assert!(raven_from_google(&google, "c", &config).is_none());
}

#[test]
fn durations_from_google_table() {
    let d = |s, e| Durations::from_google(&EventTime::Date(s), Some(&EventTime::Date(e)));
    assert_eq!(
        d(date!(2026 - 07 - 14), date!(2026 - 07 - 15)).days,
        Some(1)
    );
    assert_eq!(
        d(date!(2026 - 07 - 14), date!(2026 - 07 - 17)).days,
        Some(3)
    );
    assert_eq!(
        d(date!(2026 - 07 - 14), date!(2026 - 07 - 14)).days,
        Some(1)
    );
    let t = |s, e| {
        Durations::from_google(
            &EventTime::date_time(s, None),
            Some(&EventTime::date_time(e, None)),
        )
    };
    assert_eq!(
        t(
            datetime!(2026-07-14 10:00 +9),
            datetime!(2026-07-14 10:45 +9)
        ),
        Durations {
            seconds: Some(2700),
            days: None
        }
    );
    assert_eq!(
        t(
            datetime!(2026-07-14 10:00 +9),
            datetime!(2026-07-14 09:00 +9)
        )
        .seconds,
        Some(0)
    );
    assert_eq!(
        Durations::from_google(&EventTime::Date(date!(2026 - 07 - 14)), None),
        Durations::default()
    );
}

#[test]
fn hashes_compare_instants_not_text() {
    let utc = SyncedFields::of_raven(&event("e", "2026-07-14T01:00:00Z"));
    let seoul_text = SyncedFields::of_raven(&event("e", "2026-07-14T10:00:00+09:00"));
    assert_eq!(utc.hashes(None).start, seoul_text.hashes(None).start);
    let day = SyncedFields::of_raven(&event("e", "2026-07-14"));
    assert_ne!(day.hashes(None).start, utc.hashes(None).start);

    let mut google = GEvent::new("g");
    google.summary = Some("Meeting".into());
    google.start = Some(EventTime::date_time(datetime!(2026-07-14 10:00 +9), None));
    assert_eq!(
        SyncedFields::of_google(&google).hashes(None),
        utc.hashes(None)
    );
}

#[test]
fn hashes_treat_missing_and_empty_note_alike_and_separate_fields() {
    let mut a = event("e", "2026-07-14");
    let mut b = a.clone();
    a.note = None;
    b.note = Some(String::new());
    assert_eq!(
        SyncedFields::of_raven(&a).hashes(None),
        SyncedFields::of_raven(&b).hashes(None)
    );
    assert_ne!(field_hash("title", "x"), field_hash("note", "x"));
    assert_eq!(field_hash("title", "x").len(), 32);
}

#[test]
fn field_hashes_json_round_trip_and_rejects_unknown() {
    let hashes =
        SyncedFields::of_raven(&event("e", "2026-07-14")).hashes(Some(GEventStatus::Confirmed));
    let text = hashes.to_json();
    assert_eq!(FieldHashes::from_json(&text), Some(hashes));
    assert_eq!(
        FieldHashes::from_json(r#"{"title":"a","start":"b","note":"c","location":"d","x":1}"#),
        None
    );
}

#[test]
fn gevent_from_json_reads_all_sync_fields() {
    let value = json!({
        "id": "abc",
        "etag": "\"3\"",
        "status": "tentative",
        "summary": "S",
        "description": "D",
        "location": "L",
        "updated": "2026-07-01T00:00:00.000Z",
        "start": {"dateTime": "2026-07-14T10:00:00+09:00", "timeZone": "Asia/Seoul"},
        "end": {"dateTime": "2026-07-14T11:00:00+09:00", "timeZone": "Asia/Seoul"},
        "eventType": "default",
        "extendedProperties": {"private": {"raven_item_id": "evt-1"}},
        "attendees": [{"email": "x@example.com"}]
    });
    let event = GEvent::from_json(&value).unwrap();
    assert_eq!(event.id, "abc");
    assert_eq!(event.status, GEventStatus::Tentative);
    assert_eq!(event.etag.as_deref(), Some("\"3\""));
    assert_eq!(event.updated, Some(datetime!(2026-07-01 00:00 UTC)));
    assert_eq!(event.raven_item_id.as_deref(), Some("evt-1"));
    assert!(!event.recurring);
    assert!(event.is_default_type());
    assert_eq!(
        event.start,
        Some(EventTime::date_time(
            datetime!(2026-07-14 10:00 +9),
            Some("Asia/Seoul".into())
        ))
    );
}

#[test]
fn gevent_from_json_flags_recurring_and_types_and_cancelled() {
    let recurring =
        GEvent::from_json(&json!({"id": "r", "recurrence": ["RRULE:FREQ=DAILY"]})).unwrap();
    assert!(recurring.recurring);
    let instance = GEvent::from_json(&json!({"id": "i", "recurringEventId": "r"})).unwrap();
    assert!(instance.recurring);
    let focus = GEvent::from_json(&json!({"id": "f", "eventType": "focusTime"})).unwrap();
    assert!(!focus.is_default_type());
    let cancelled = GEvent::from_json(&json!({"id": "c", "status": "cancelled"})).unwrap();
    assert_eq!(cancelled, GEvent::cancelled("c"));
    assert!(GEvent::from_json(&json!({"summary": "no id"})).is_none());
    let all_day = GEvent::from_json(&json!({"id": "a", "start": {"date": "2026-07-14"}})).unwrap();
    assert_eq!(all_day.start, Some(EventTime::Date(date!(2026 - 07 - 14))));
}

#[test]
fn patch_body_contains_only_set_fields() {
    let patch = GEventWrite {
        summary: Some("New".into()),
        ..Default::default()
    };
    assert_eq!(patch.to_json(), json!({"summary": "New"}));
    assert!(GEventWrite::default().is_empty());
    assert!(!patch.is_empty());
}

#[test]
fn imported_google_event_id_matches_only_same_calendar() {
    let mut item = event("e", "2026-07-14");
    assert_eq!(imported_google_event_id(&item, "cal"), None);
    item.metadata.insert(
        "external_source".into(),
        json!({"system": "google_calendar", "id": "cal/g1"}),
    );
    assert_eq!(
        imported_google_event_id(&item, "cal").as_deref(),
        Some("g1")
    );
    assert_eq!(imported_google_event_id(&item, "other"), None);
    assert_eq!(imported_google_event_id(&item, "ca"), None);
    item.metadata.insert(
        "external_source".into(),
        json!({"system": "ical", "id": "cal/g1"}),
    );
    assert_eq!(imported_google_event_id(&item, "cal"), None);
}

#[test]
fn raven_update_converts_to_update_item() {
    let update = RavenUpdate {
        title: Some("T".into()),
        note: Some(String::new()),
        ..Default::default()
    }
    .into_update_item("google_calendar_sync");
    assert_eq!(update.title.as_deref(), Some("T"));
    assert_eq!(update.note.as_deref(), Some(""));
    assert_eq!(update.scheduled, None);
    assert_eq!(update.reason.as_deref(), Some("google_calendar_sync"));
}
