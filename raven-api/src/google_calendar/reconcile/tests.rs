use serde_json::json;
use time::macros::{date, datetime};
use todo_engine::domain::{Actor, ItemStatus, ItemType, TodoItem};

use super::*;
use crate::google_calendar::mapping::{
    EventTime, GEvent, GEventStatus, field_hash, google_event_id_for,
};

const CAL: &str = "cal@group";
const NOW: OffsetDateTime = datetime!(2026-07-10 03:00 UTC); // 12:00 KST, window 07-03
const T0: OffsetDateTime = datetime!(2026-07-01 00:00 UTC);
const T1: OffsetDateTime = datetime!(2026-07-05 00:00 UTC);
const T2: OffsetDateTime = datetime!(2026-07-06 00:00 UTC);

fn cfg() -> SyncConfig {
    SyncConfig::new(CAL)
}

fn raven(id: &str, scheduled: &str, status: ItemStatus) -> TodoItem {
    let mut item = TodoItem::new(id, ItemType::Event, "Meeting", Actor::User, T0);
    item.scheduled = Some(scheduled.to_owned());
    item.status = status;
    item
}

fn active(id: &str, scheduled: &str) -> TodoItem {
    raven(id, scheduled, ItemStatus::Active)
}

fn google(id: &str, start: EventTime) -> GEvent {
    let mut event = GEvent::new(id);
    event.summary = Some("Meeting".into());
    event.end = Some(match &start {
        EventTime::Date(day) => EventTime::Date(day.next_day().unwrap()),
        EventTime::DateTime { at, time_zone } => EventTime::DateTime {
            at: *at + Duration::hours(1),
            time_zone: time_zone.clone(),
        },
    });
    event.start = Some(start);
    event.etag = Some("\"e1\"".into());
    event.updated = Some(T0);
    event
}

fn timed(at: OffsetDateTime) -> EventTime {
    EventTime::date_time(at, Some("Asia/Seoul".into()))
}

/// A link in sync with `item` and `event`.
fn synced(item: &TodoItem, event: &GEvent) -> Link {
    let mut link = Link::new(CAL, &event.id, &item.id, LinkOrigin::Raven, T0);
    link.google_etag = event.etag.clone();
    link.google_updated = event.updated;
    link.raven_updated_at = item.updated_at;
    link.base_hashes = SyncedFields::of_raven(item).hashes(Some(google_status_for(item.status)));
    link
}

fn pair(id: &str) -> (TodoItem, GEvent, Link) {
    let item = active(id, "2026-07-14T10:00:00+09:00");
    let event = google(
        &google_event_id_for(id),
        timed(datetime!(2026-07-14 10:00 +9)),
    );
    let link = synced(&item, &event);
    (item, event, link)
}

fn edited(event: &GEvent, at: OffsetDateTime) -> GEvent {
    let mut event = event.clone();
    event.etag = Some(format!("\"{}\"", at.unix_timestamp()));
    event.updated = Some(at);
    event
}

fn touched(item: &TodoItem, at: OffsetDateTime) -> TodoItem {
    let mut item = item.clone();
    item.updated_at = at;
    item
}

fn run(raven: &[TodoItem], google: &[GEvent], links: &[Link]) -> Plan {
    let changes: Vec<GChange> = google.iter().cloned().map(GChange::event).collect();
    reconcile(raven, &changes, links, &cfg(), NOW)
}

fn only_update(plan: &Plan) -> (&Option<GooglePatch>, &Option<RavenChange>, &Link) {
    assert_eq!(plan.actions.len(), 1, "{:#?}", plan.actions);
    match &plan.actions[0] {
        Action::Update {
            google,
            raven,
            link,
            ..
        } => (google, raven, link),
        other => panic!("expected update, got {other:#?}"),
    }
}

fn only_save_links(plan: &Plan) -> bool {
    plan.actions
        .iter()
        .all(|action| matches!(action, Action::SaveLink(_)))
}

// --- first sync window & unlinked Raven events ---------------------------------

#[test]
fn window_is_today_minus_seven_days_in_seoul() {
    let seoul = UtcOffset::from_hms(9, 0, 0).unwrap();
    // 2026-07-10 01:00 KST
    assert_eq!(
        first_sync_window_start(datetime!(2026-07-09 16:00 UTC), seoul),
        date!(2026 - 07 - 03)
    );
    // 2026-07-09 23:59 KST
    assert_eq!(
        first_sync_window_start(datetime!(2026-07-09 14:59 UTC), seoul),
        date!(2026 - 07 - 02)
    );
    assert_eq!(cfg().window_start(NOW), date!(2026 - 07 - 03));
    let mut config = cfg();
    config.push_since = Some(date!(2026 - 01 - 01));
    assert_eq!(config.window_start(NOW), date!(2026 - 01 - 01));
}

#[test]
fn unlinked_raven_push_table() {
    use ItemStatus::*;
    // (scheduled, status, inserted, skipped_terminal)
    let cases = [
        ("2026-07-03", Active, true, 0),
        ("2026-07-02T15:00:00Z", Active, true, 0), // 07-03 00:00 KST
        ("2026-07-02T14:59:59Z", Active, false, 0), // 07-02 23:59 KST
        ("2026-07-02", Active, false, 0),
        ("2026-07-20", Paused, true, 0),
        ("2026-07-20", Completed, false, 1),
        ("2026-07-20", Missed, false, 1),
        ("2026-07-20", Archived, false, 1),
        ("2026-07-20", Dropped, false, 1),
        ("2026-07-01", Completed, false, 0),
        ("garbage", Active, false, 0),
    ];
    for (scheduled, status, inserted, skipped) in cases {
        let plan = run(&[raven("e1", scheduled, status)], &[], &[]);
        assert_eq!(
            plan.counts.google_created,
            u64::from(inserted),
            "{scheduled} {status:?}"
        );
        assert_eq!(
            plan.actions.len(),
            usize::from(inserted),
            "{scheduled} {status:?}"
        );
        assert_eq!(
            plan.counts.skipped_terminal, skipped,
            "{scheduled} {status:?}"
        );
    }
}

#[test]
fn insert_uses_deterministic_id_and_records_link() {
    let mut item = raven("e1", "2026-07-14", ItemStatus::Paused);
    item.note = Some("n".into());
    let plan = run(std::slice::from_ref(&item), &[], &[]);
    let [
        Action::InsertGoogle {
            raven_item_id,
            event,
            link,
        },
    ] = plan.actions.as_slice()
    else {
        panic!("{:#?}", plan.actions);
    };
    assert_eq!(raven_item_id, "e1");
    assert_eq!(
        event.id.as_deref(),
        Some(google_event_id_for("e1").as_str())
    );
    assert_eq!(event.status, Some(GEventStatus::Tentative));
    assert_eq!(event.raven_item_id.as_deref(), Some("e1"));
    assert_eq!(link.google_event_id, google_event_id_for("e1"));
    assert_eq!(link.origin, LinkOrigin::Raven);
    assert_eq!(link.state, LinkState::Active);
    assert_eq!(link.raven_updated_at, item.updated_at);
    assert_eq!(
        link.base_hashes,
        SyncedFields::of_raven(&item).hashes(Some(GEventStatus::Tentative))
    );
}

#[test]
fn push_since_extends_window_for_push_and_import() {
    let mut config = cfg();
    config.push_since = Some(date!(2026 - 01 - 01));
    let old_raven = active("e1", "2026-03-01");
    let old_google = google("g1", EventTime::Date(date!(2026 - 03 - 01)));
    let plan = reconcile(
        &[old_raven],
        &[GChange::event(old_google)],
        &[],
        &config,
        NOW,
    );
    assert_eq!(plan.counts.google_created, 1);
    assert_eq!(plan.counts.raven_created, 1);
}

#[test]
fn non_event_items_are_ignored() {
    let mut task = active("t1", "2026-07-14");
    task.item_type = ItemType::Task;
    assert_eq!(run(&[task], &[], &[]), Plan::default());
}

#[test]
fn raven_imported_from_other_calendar_is_pushed_but_same_calendar_is_not() {
    let mut other = active("e1", "2026-07-14");
    other.metadata.insert(
        "external_source".into(),
        json!({"system": "google_calendar", "id": "old@cal/g1"}),
    );
    let mut same = active("e2", "2026-07-14");
    same.metadata.insert(
        "external_source".into(),
        json!({"system": "google_calendar", "id": format!("{CAL}/g2")}),
    );
    let plan = run(&[other, same], &[], &[]);
    assert_eq!(plan.counts.google_created, 1);
    assert!(
        matches!(&plan.actions[0], Action::InsertGoogle { raven_item_id, .. } if raven_item_id == "e1")
    );
}

// --- unlinked Google events -----------------------------------------------------

#[test]
fn unlinked_google_import_table() {
    let base = || google("g1", timed(datetime!(2026-07-14 10:00 +9)));
    let mut recurring = base();
    recurring.recurring = true;
    let mut focus = base();
    focus.event_type = Some("focusTime".into());
    let mut explicit_default = base();
    explicit_default.event_type = Some("default".into());
    let mut tentative = base();
    tentative.status = GEventStatus::Tentative;
    let old = google("g1", EventTime::Date(date!(2026 - 07 - 02)));
    let boundary = google("g1", timed(datetime!(2026-07-03 00:00 +9)));
    let before = google("g1", timed(datetime!(2026-07-02 23:59 +9)));
    let mut no_start = base();
    no_start.start = None;
    // (event, created, skipped_recurring)
    let cases = [
        (base(), 1, 0),
        (explicit_default, 1, 0),
        (tentative, 1, 0),
        (recurring, 0, 1),
        (focus, 0, 0),
        (GEvent::cancelled("g1"), 0, 0),
        (old, 0, 0),
        (boundary, 1, 0),
        (before, 0, 0),
        (no_start, 0, 0),
    ];
    for (index, (event, created, recurring)) in cases.into_iter().enumerate() {
        let plan = run(&[], &[event], &[]);
        assert_eq!(plan.counts.raven_created, created, "case {index}");
        assert_eq!(plan.counts.skipped_recurring, recurring, "case {index}");
        assert_eq!(plan.actions.len() as u64, created, "case {index}");
    }
}

#[test]
fn import_creates_raven_event_with_external_source_and_link() {
    let mut event = google("g1", timed(datetime!(2026-07-14 01:00 UTC)));
    event.end = Some(timed(datetime!(2026-07-14 01:30 UTC)));
    event.description = Some("agenda".into());
    event.location = Some("Room".into());
    event.status = GEventStatus::Tentative;
    let plan = run(&[], std::slice::from_ref(&event), &[]);
    let [
        Action::CreateRaven {
            google_event_id,
            event: new,
            link,
        },
    ] = plan.actions.as_slice()
    else {
        panic!("{:#?}", plan.actions);
    };
    assert_eq!(google_event_id, "g1");
    assert_eq!(new.scheduled, "2026-07-14T10:00:00+09:00");
    assert_eq!(new.note.as_deref(), Some("agenda"));
    assert_eq!(new.location.as_deref(), Some("Room"));
    assert_eq!(new.external_source.id, format!("{CAL}/g1"));
    assert_eq!(link.origin, LinkOrigin::Google);
    assert_eq!(link.duration_seconds, Some(1800));
    assert_eq!(link.google_time_zone.as_deref(), Some("Asia/Seoul"));
    assert_eq!(link.google_etag, event.etag);
    // Incoming tentative is ignored: the new active Raven event must not push a status.
    assert_eq!(
        link.base_hashes.status,
        Some(field_hash("status", GEventStatus::Confirmed.as_str()))
    );
}

#[test]
fn imported_event_round_trip_is_quiet() {
    // After import the Raven item exists with the stored updated_at: no echo either way.
    let event = google("g1", timed(datetime!(2026-07-14 10:00 +9)));
    let plan = run(&[], std::slice::from_ref(&event), &[]);
    let Action::CreateRaven {
        event: new, link, ..
    } = plan.actions[0].clone()
    else {
        panic!();
    };
    let mut item = active("e9", &new.scheduled);
    item.title = new.title;
    item.updated_at = T1;
    let mut link = link;
    link.raven_item_id = "e9".into();
    link.raven_updated_at = T1;
    assert_eq!(
        run(
            std::slice::from_ref(&item),
            &[],
            std::slice::from_ref(&link)
        ),
        Plan::default()
    );
    assert_eq!(run(&[item], &[event], &[link]), Plan::default());
}

// --- echo suppression & three-way merge ----------------------------------------

#[test]
fn nothing_changed_plans_nothing() {
    let (item, event, link) = pair("e1");
    assert_eq!(
        run(
            std::slice::from_ref(&item),
            &[],
            std::slice::from_ref(&link)
        ),
        Plan::default()
    );
    // Our own write echoed back with the stored etag.
    assert_eq!(run(&[item], &[event], &[link]), Plan::default());
}

#[test]
fn raven_only_change_patches_changed_field_with_if_match() {
    let (item, _, link) = pair("e1");
    let mut changed = touched(&item, T1);
    changed.title = "Renamed".into();
    let plan = run(
        std::slice::from_ref(&changed),
        &[],
        std::slice::from_ref(&link),
    );
    let (google, raven, next) = only_update(&plan);
    let google = google.as_ref().unwrap();
    assert_eq!(google.if_match, link.google_etag);
    assert_eq!(
        google.event,
        GEventWrite {
            summary: Some("Renamed".into()),
            ..Default::default()
        }
    );
    assert!(raven.is_none());
    assert_eq!(next.raven_updated_at, T1);
    assert_eq!(
        next.base_hashes,
        SyncedFields::of_raven(&changed).hashes(Some(GEventStatus::Confirmed))
    );
    assert_eq!(plan.counts.google_updated, 1);
    assert_eq!(plan.counts.conflicts, 0);
}

#[test]
fn raven_only_change_unrelated_field_just_refreshes_link() {
    let (item, _, link) = pair("e1");
    let mut changed = touched(&item, T1);
    changed.tags = vec!["work".into()];
    changed.priority = Some(3);
    changed
        .metadata
        .insert("participants".into(), json!(["kim"]));
    let plan = run(&[changed], &[], std::slice::from_ref(&link));
    let [Action::SaveLink(next)] = plan.actions.as_slice() else {
        panic!("{:#?}", plan.actions);
    };
    assert_eq!(next.raven_updated_at, T1);
    assert_eq!(next.base_hashes, link.base_hashes);
}

#[test]
fn google_only_change_updates_raven_field() {
    let (item, event, link) = pair("e1");
    let mut changed = edited(&event, T1);
    changed.location = Some("Cafe".into());
    let plan = run(
        std::slice::from_ref(&item),
        std::slice::from_ref(&changed),
        &[link],
    );
    let (google, raven, next) = only_update(&plan);
    assert!(google.is_none());
    let raven = raven.as_ref().unwrap();
    assert_eq!(raven.expected_updated_at, item.updated_at);
    assert_eq!(
        raven.update,
        RavenUpdate {
            location: Some("Cafe".into()),
            ..Default::default()
        }
    );
    assert_eq!(next.google_etag, changed.etag);
    assert_eq!(next.google_updated, Some(T1));
    assert_eq!(plan.counts.raven_updated, 1);
}

#[test]
fn google_time_change_writes_plus_nine_and_updates_duration() {
    let (item, event, link) = pair("e1");
    let mut changed = edited(&event, T1);
    changed.start = Some(timed(datetime!(2026-07-15 06:00 UTC)));
    changed.end = Some(timed(datetime!(2026-07-15 08:00 UTC)));
    let plan = run(&[item], &[changed], &[link]);
    let (_, raven, next) = only_update(&plan);
    assert_eq!(
        raven.as_ref().unwrap().update.scheduled.as_deref(),
        Some("2026-07-15T15:00:00+09:00")
    );
    assert_eq!(next.duration_seconds, Some(7200));
}

#[test]
fn google_switch_to_all_day_writes_date_and_days() {
    let (item, event, link) = pair("e1");
    let mut changed = edited(&event, T1);
    changed.start = Some(EventTime::Date(date!(2026 - 07 - 20)));
    changed.end = Some(EventTime::Date(date!(2026 - 07 - 22)));
    let plan = run(&[item], &[changed], &[link]);
    let (_, raven, next) = only_update(&plan);
    assert_eq!(
        raven.as_ref().unwrap().update.scheduled.as_deref(),
        Some("2026-07-20")
    );
    assert_eq!(next.duration_days, Some(2));
}

#[test]
fn google_end_only_change_updates_link_duration_without_raven_write() {
    let (item, event, link) = pair("e1");
    let mut changed = edited(&event, T1);
    changed.end = Some(timed(datetime!(2026-07-14 12:00 +9)));
    let plan = run(&[item], &[changed], &[link]);
    let [Action::SaveLink(next)] = plan.actions.as_slice() else {
        panic!("{:#?}", plan.actions);
    };
    assert_eq!(next.duration_seconds, Some(7200));
}

#[test]
fn raven_time_change_uses_link_duration_and_time_zone() {
    let (item, _, mut link) = pair("e1");
    link.duration_seconds = Some(5400);
    link.google_time_zone = Some("Europe/Paris".into());
    let mut changed = touched(&item, T1);
    changed.scheduled = Some("2026-07-16T00:00:00Z".into());
    let plan = run(&[changed], &[], &[link]);
    let (google, _, _) = only_update(&plan);
    let patch = &google.as_ref().unwrap().event;
    assert_eq!(
        patch.start,
        Some(EventTime::date_time(
            datetime!(2026-07-16 09:00 +9),
            Some("Europe/Paris".into())
        ))
    );
    assert_eq!(
        patch.end,
        Some(EventTime::date_time(
            datetime!(2026-07-16 10:30 +9),
            Some("Europe/Paris".into())
        ))
    );
}

#[test]
fn raven_switch_to_all_day_uses_stored_or_default_days() {
    let (item, _, mut link) = pair("e1");
    let mut changed = touched(&item, T1);
    changed.scheduled = Some("2026-07-16".into());
    let plan = run(
        std::slice::from_ref(&changed),
        &[],
        std::slice::from_ref(&link),
    );
    let patch = &only_update(&plan).0.as_ref().unwrap().event;
    assert_eq!(patch.start, Some(EventTime::Date(date!(2026 - 07 - 16))));
    assert_eq!(patch.end, Some(EventTime::Date(date!(2026 - 07 - 17))));
    link.duration_days = Some(2);
    let plan = run(&[changed], &[], &[link]);
    let patch = &only_update(&plan).0.as_ref().unwrap().event;
    assert_eq!(patch.end, Some(EventTime::Date(date!(2026 - 07 - 18))));
}

#[test]
fn same_instant_different_text_is_not_a_change() {
    let (item, event, link) = pair("e1");
    let mut changed = touched(&item, T1);
    changed.scheduled = Some("2026-07-14T01:00:00Z".into());
    let plan = run(&[changed], &[edited(&event, T1)], &[link]);
    assert!(only_save_links(&plan), "{:#?}", plan.actions);
}

#[test]
fn conflict_resolution_table() {
    // (raven updated, google updated, expect push)
    let cases = [
        (T2, Some(T1), true),
        (T1, Some(T2), false),
        (T1, Some(T1), true), // tie → Raven
        (T1, None, true),     // unknown Google time → Raven
    ];
    for (raven_at, google_at, push) in cases {
        let (item, event, link) = pair("e1");
        let mut item = touched(&item, raven_at);
        item.title = "Raven title".into();
        let mut event = edited(&event, T1);
        event.updated = google_at;
        event.summary = Some("Google title".into());
        let plan = run(&[item], &[event], &[link]);
        let (google, raven, next) = only_update(&plan);
        assert_eq!(plan.counts.conflicts, 1, "{raven_at} {google_at:?}");
        if push {
            assert_eq!(
                google.as_ref().unwrap().event.summary.as_deref(),
                Some("Raven title")
            );
            assert!(raven.is_none());
            assert_eq!(next.base_hashes.title, field_hash("title", "Raven title"));
        } else {
            assert!(google.is_none());
            assert_eq!(
                raven.as_ref().unwrap().update.title.as_deref(),
                Some("Google title")
            );
            assert_eq!(next.base_hashes.title, field_hash("title", "Google title"));
        }
    }
}

#[test]
fn both_sides_changed_to_same_value_is_not_a_conflict() {
    let (item, event, link) = pair("e1");
    let mut item = touched(&item, T1);
    item.title = "Same".into();
    let mut event = edited(&event, T2);
    event.summary = Some("Same".into());
    let plan = run(std::slice::from_ref(&item), &[event], &[link]);
    assert_eq!(plan.counts.conflicts, 0);
    let [Action::SaveLink(next)] = plan.actions.as_slice() else {
        panic!("{:#?}", plan.actions);
    };
    assert_eq!(
        next.base_hashes,
        SyncedFields::of_raven(&item).hashes(Some(GEventStatus::Confirmed))
    );
}

#[test]
fn different_fields_merge_in_both_directions_without_conflict() {
    let (item, event, link) = pair("e1");
    let mut item = touched(&item, T2);
    item.title = "Raven title".into();
    let mut event = edited(&event, T1);
    event.description = Some("Google note".into());
    let plan = run(&[item], &[event], &[link]);
    let (google, raven, _) = only_update(&plan);
    assert_eq!(
        google.as_ref().unwrap().event,
        GEventWrite {
            summary: Some("Raven title".into()),
            ..Default::default()
        }
    );
    assert_eq!(
        raven.as_ref().unwrap().update,
        RavenUpdate {
            note: Some("Google note".into()),
            ..Default::default()
        }
    );
    assert_eq!(plan.counts.conflicts, 0);
    assert_eq!(plan.counts.google_updated, 1);
    assert_eq!(plan.counts.raven_updated, 1);
}

#[test]
fn incoming_tentative_is_ignored_and_paused_pushes_tentative() {
    let (item, event, link) = pair("e1");
    let mut tentative = edited(&event, T1);
    tentative.status = GEventStatus::Tentative;
    let plan = run(
        std::slice::from_ref(&item),
        &[tentative],
        std::slice::from_ref(&link),
    );
    assert!(only_save_links(&plan));

    let mut paused = touched(&item, T1);
    paused.status = ItemStatus::Paused;
    let plan = run(&[paused], &[], &[link]);
    let (google, _, next) = only_update(&plan);
    assert_eq!(
        google.as_ref().unwrap().event,
        GEventWrite {
            status: Some(GEventStatus::Tentative),
            ..Default::default()
        }
    );
    assert_eq!(next.state, LinkState::Active);
}

#[test]
fn sync_note_off_ignores_note_both_ways() {
    let (item, event, link) = pair("e1");
    let mut item = touched(&item, T1);
    item.note = Some("raven note".into());
    let mut event = edited(&event, T1);
    event.description = Some("google note".into());
    let mut config = cfg();
    config.map.sync_note = false;
    let plan = reconcile(&[item], &[GChange::event(event)], &[link], &config, NOW);
    let [Action::SaveLink(next)] = plan.actions.as_slice() else {
        panic!("{:#?}", plan.actions);
    };
    assert_eq!(next.base_hashes.note, "");
}

#[test]
fn unknown_note_base_prefers_content_and_never_blanks_google() {
    // Note sync re-enabled: base note unknown.
    let (item, event, mut link) = pair("e1");
    link.base_hashes.note = String::new();
    // Raven empty, Google not seen → keep.
    assert!(only_save_links(&run(
        std::slice::from_ref(&item),
        &[],
        std::slice::from_ref(&link)
    )));
    // Raven empty, Google has a description → pull it.
    let mut described = edited(&event, T1);
    described.description = Some("from google".into());
    let plan = run(
        std::slice::from_ref(&item),
        std::slice::from_ref(&described),
        std::slice::from_ref(&link),
    );
    assert_eq!(
        only_update(&plan)
            .1
            .as_ref()
            .unwrap()
            .update
            .note
            .as_deref(),
        Some("from google")
    );
    assert_eq!(plan.counts.conflicts, 0);
    // Raven has a note, Google empty → push it.
    let mut noted = item.clone();
    noted.note = Some("from raven".into());
    let plan = run(
        std::slice::from_ref(&noted),
        &[edited(&event, T1)],
        std::slice::from_ref(&link),
    );
    assert_eq!(
        only_update(&plan)
            .0
            .as_ref()
            .unwrap()
            .event
            .description
            .as_deref(),
        Some("from raven")
    );
    // Both have content → newer wins, not counted as conflict.
    let plan = run(&[touched(&noted, T2)], &[described], &[link]);
    assert_eq!(
        only_update(&plan)
            .0
            .as_ref()
            .unwrap()
            .event
            .description
            .as_deref(),
        Some("from raven")
    );
    assert_eq!(plan.counts.conflicts, 0);
}

// --- deletion / close rules -----------------------------------------------------

#[test]
fn raven_closed_statuses_delete_google_event() {
    for status in [
        ItemStatus::Archived,
        ItemStatus::Dropped,
        ItemStatus::Cancelled,
        ItemStatus::Rejected,
    ] {
        for state in [LinkState::Active, LinkState::Frozen] {
            let (item, _, mut link) = pair("e1");
            link.state = state;
            let mut closed = touched(&item, T1);
            closed.status = status;
            let plan = run(&[closed], &[], std::slice::from_ref(&link));
            let [
                Action::DeleteGoogle {
                    google_event_id,
                    link: next,
                    ..
                },
            ] = plan.actions.as_slice()
            else {
                panic!("{status:?}: {:#?}", plan.actions);
            };
            assert_eq!(google_event_id, &link.google_event_id);
            assert_eq!(next.state, LinkState::Deleted);
            assert_eq!(plan.counts.google_deleted, 1);
        }
    }
}

#[test]
fn raven_archived_and_google_cancelled_marks_link_deleted() {
    let (item, event, link) = pair("e1");
    let mut closed = touched(&item, T1);
    closed.status = ItemStatus::Archived;
    let plan = run(&[closed], &[GEvent::cancelled(event.id)], &[link]);
    let [Action::SaveLink(next)] = plan.actions.as_slice() else {
        panic!("{:#?}", plan.actions);
    };
    assert_eq!(next.state, LinkState::Deleted);
    assert_eq!(plan.counts.google_deleted, 0);
}

#[test]
fn raven_finished_freezes_and_later_google_edits_are_ignored() {
    for status in [ItemStatus::Completed, ItemStatus::Missed] {
        let (item, event, link) = pair("e1");
        let mut done = touched(&item, T1);
        done.status = status;
        let mut google_edit = edited(&event, T2);
        google_edit.summary = Some("ignored".into());
        let plan = run(
            std::slice::from_ref(&done),
            std::slice::from_ref(&google_edit),
            &[link],
        );
        let [Action::SaveLink(frozen)] = plan.actions.as_slice() else {
            panic!("{status:?}: {:#?}", plan.actions);
        };
        assert_eq!(frozen.state, LinkState::Frozen);
        assert_eq!(frozen.google_etag, google_edit.etag);

        let mut later = edited(&event, datetime!(2026-07-07 00:00 UTC));
        later.summary = Some("still ignored".into());
        assert_eq!(
            run(&[done], &[later], std::slice::from_ref(frozen)),
            Plan::default()
        );
    }
}

#[test]
fn completing_with_a_raven_field_change_pushes_then_freezes() {
    let (item, _, link) = pair("e1");
    let mut done = touched(&item, T1);
    done.status = ItemStatus::Completed;
    done.note = Some("minutes".into());
    let plan = run(&[done], &[], &[link]);
    let (google, raven, next) = only_update(&plan);
    assert_eq!(
        google.as_ref().unwrap().event.description.as_deref(),
        Some("minutes")
    );
    assert!(raven.is_none());
    assert_eq!(next.state, LinkState::Frozen);
}

#[test]
fn reopened_after_freeze_force_pushes_raven_state() {
    let (item, _, mut link) = pair("e1");
    link.state = LinkState::Frozen;
    let reopened = touched(&item, T2);
    let plan = run(&[reopened], &[], &[link]);
    let (google, _, next) = only_update(&plan);
    let patch = &google.as_ref().unwrap().event;
    assert!(patch.summary.is_some() && patch.start.is_some() && patch.status.is_some());
    assert_eq!(next.state, LinkState::Active);
}

#[test]
fn google_deleted_rule_table() {
    use ItemStatus::*;
    #[derive(Debug, PartialEq, Clone, Copy)]
    enum Expect {
        Archive,
        DropLink,
    }
    // (raven status, link state, expect)
    let cases = [
        (Active, LinkState::Active, Expect::Archive),
        (Paused, LinkState::Active, Expect::Archive),
        (Active, LinkState::Error, Expect::Archive),
        (Completed, LinkState::Active, Expect::DropLink),
        (Missed, LinkState::Active, Expect::DropLink),
        (Completed, LinkState::Frozen, Expect::DropLink),
        (Missed, LinkState::Frozen, Expect::DropLink),
    ];
    for (status, state, expect) in cases {
        for gone in [false, true] {
            let (mut item, event, mut link) = pair("e1");
            item.status = status;
            link.state = state;
            let changes = [if gone {
                GChange::deleted(&event.id)
            } else {
                GChange::event(GEvent::cancelled(&event.id))
            }];
            let plan = reconcile(std::slice::from_ref(&item), &changes, &[link], &cfg(), NOW);
            match expect {
                Expect::Archive => {
                    let [
                        Action::ArchiveRaven {
                            raven_item_id,
                            expected_updated_at,
                            link: next,
                            ..
                        },
                    ] = plan.actions.as_slice()
                    else {
                        panic!("{status:?}/{state:?}: {:#?}", plan.actions);
                    };
                    assert_eq!(raven_item_id, "e1");
                    assert_eq!(*expected_updated_at, item.updated_at);
                    assert_eq!(next.state, LinkState::Deleted);
                    assert_eq!(plan.counts.raven_archived, 1);
                }
                Expect::DropLink => {
                    assert_eq!(
                        plan.actions,
                        vec![Action::DeleteLink {
                            calendar_id: CAL.into(),
                            google_event_id: event.id.clone()
                        }],
                        "{status:?}/{state:?}"
                    );
                }
            }
        }
    }
}

#[test]
fn google_restored_after_archive_creates_new_raven_event() {
    let (item, event, mut link) = pair("e1");
    let mut archived = item.clone();
    archived.status = ItemStatus::Archived;
    link.state = LinkState::Deleted;
    let restored = edited(&event, T2);
    let plan = run(&[archived], &[restored], &[link]);
    let [
        Action::CreateRaven {
            google_event_id,
            link: next,
            ..
        },
    ] = plan.actions.as_slice()
    else {
        panic!("{:#?}", plan.actions);
    };
    assert_eq!(google_event_id, &event.id);
    assert_eq!(next.state, LinkState::Active);
    assert_eq!(next.origin, LinkOrigin::Raven);
    assert_eq!(plan.counts.raven_created, 1);
}

#[test]
fn deleted_link_is_dropped_once_raven_item_is_purged() {
    let (_, event, mut link) = pair("e1");
    link.state = LinkState::Deleted;
    let plan = run(&[], &[], std::slice::from_ref(&link));
    assert_eq!(
        plan.actions,
        vec![Action::DeleteLink {
            calendar_id: CAL.into(),
            google_event_id: event.id
        }]
    );
    // Still archived in Raven: keep the link quietly.
    let archived = raven("e1", "2026-07-14", ItemStatus::Archived);
    assert_eq!(run(&[archived], &[], &[link]), Plan::default());
}

#[test]
fn vanished_raven_item_orphans_link_and_never_deletes_google() {
    let (_, event, link) = pair("e1");
    let plan = run(&[], &[], &[link]);
    let [Action::SaveLink(next)] = plan.actions.as_slice() else {
        panic!("{:#?}", plan.actions);
    };
    assert_eq!(next.state, LinkState::Orphaned);

    let mut changed = edited(&event, T2);
    changed.summary = Some("edited".into());
    assert_eq!(
        run(&[], &[changed], std::slice::from_ref(next)),
        Plan::default()
    );
    assert_eq!(run(&[], &[], std::slice::from_ref(next)), Plan::default());
    let plan = run(
        &[],
        &[GEvent::cancelled(&event.id)],
        std::slice::from_ref(next),
    );
    assert!(matches!(
        plan.actions.as_slice(),
        [Action::DeleteLink { .. }]
    ));
}

#[test]
fn linked_event_turned_recurring_becomes_unsupported() {
    let (item, event, link) = pair("e1");
    let mut recurring = edited(&event, T1);
    recurring.recurring = true;
    let plan = run(
        std::slice::from_ref(&item),
        std::slice::from_ref(&recurring),
        &[link],
    );
    let [Action::SaveLink(next)] = plan.actions.as_slice() else {
        panic!("{:#?}", plan.actions);
    };
    assert_eq!(next.state, LinkState::Unsupported);
    assert_eq!(plan.counts.skipped_recurring, 1);
    // Unsupported links ignore further changes on both sides.
    let changed = touched(&item, T2);
    assert_eq!(
        run(&[changed], &[recurring], std::slice::from_ref(next)),
        Plan::default()
    );
}

// --- postpone ------------------------------------------------------------------

fn postponed(source: &TodoItem, follow_id: &str, day: &str) -> (TodoItem, TodoItem) {
    let mut missed = touched(source, T1);
    missed.status = ItemStatus::Missed;
    missed
        .metadata
        .insert("postponed_to".into(), json!(follow_id));
    let mut follow = touched(source, T1);
    follow.id = follow_id.into();
    follow.scheduled = Some(day.into());
    follow
        .metadata
        .insert("postponed_from".into(), json!(source.id));
    (missed, follow)
}

#[test]
fn postpone_relinks_same_google_event_as_all_day() {
    let (item, event, link) = pair("e1");
    let (missed, follow) = postponed(&item, "e2", "2026-07-15");
    let plan = run(&[missed, follow], &[], &[link]);
    let (google, raven, next) = only_update(&plan);
    let patch = &google.as_ref().unwrap().event;
    assert_eq!(patch.start, Some(EventTime::Date(date!(2026 - 07 - 15))));
    assert_eq!(patch.end, Some(EventTime::Date(date!(2026 - 07 - 16))));
    assert!(raven.is_none());
    assert_eq!(next.google_event_id, event.id);
    assert_eq!(next.raven_item_id, "e2");
    assert_eq!(next.state, LinkState::Active);
    assert_eq!(plan.counts.google_created, 0);
    assert_eq!(plan.counts.skipped_terminal, 0);
}

#[test]
fn postpone_chain_relinks_to_latest_follow_up() {
    let (item, event, link) = pair("e1");
    let (first_missed, second) = postponed(&item, "e2", "2026-07-15");
    let (second_missed, third) = postponed(&second, "e3", "2026-07-16");
    let plan = run(&[first_missed, second_missed, third], &[], &[link]);
    let (google, _, next) = only_update(&plan);
    assert_eq!(next.raven_item_id, "e3");
    assert_eq!(next.google_event_id, event.id);
    assert_eq!(
        google.as_ref().unwrap().event.start,
        Some(EventTime::Date(date!(2026 - 07 - 16)))
    );
}

#[test]
fn postponed_follow_up_with_google_deleted_archives_follow_up() {
    let (item, event, link) = pair("e1");
    let (missed, follow) = postponed(&item, "e2", "2026-07-15");
    let plan = run(&[missed, follow], &[GEvent::cancelled(&event.id)], &[link]);
    let [
        Action::ArchiveRaven {
            raven_item_id,
            link: next,
            ..
        },
    ] = plan.actions.as_slice()
    else {
        panic!("{:#?}", plan.actions);
    };
    assert_eq!(raven_item_id, "e2");
    assert_eq!(next.raven_item_id, "e2");
}

// --- adoption (links lost / forgotten) -----------------------------------------

#[test]
fn unlinked_raven_with_its_deterministic_google_event_is_adopted() {
    let item = active("e1", "2026-07-14T10:00:00+09:00");
    let mut event = google(
        &google_event_id_for("e1"),
        timed(datetime!(2026-07-14 10:00 +9)),
    );
    event.raven_item_id = Some("e1".into());
    let plan = run(&[item], std::slice::from_ref(&event), &[]);
    assert_eq!(plan.counts.google_created, 0);
    assert_eq!(plan.counts.raven_created, 0);
    // Status hash is unknown on adoption, so the status is (re)written once.
    let (google, raven, link) = only_update(&plan);
    assert_eq!(
        google.as_ref().unwrap().event,
        GEventWrite {
            status: Some(GEventStatus::Confirmed),
            ..Default::default()
        }
    );
    assert!(raven.is_none());
    assert_eq!(link.google_event_id, event.id);
    assert_eq!(link.raven_item_id, "e1");
    assert_eq!(link.origin, LinkOrigin::Raven);
}

#[test]
fn google_event_carrying_raven_id_is_not_imported() {
    let item = active("e1", "2026-07-14T10:00:00+09:00");
    let mut event = google("other-id", timed(datetime!(2026-07-14 10:00 +9)));
    event.raven_item_id = Some("e1".into());
    let plan = run(
        std::slice::from_ref(&item),
        std::slice::from_ref(&event),
        &[],
    );
    assert_eq!(plan.counts.raven_created, 0);
    let other = google(
        &google_event_id_for("e1"),
        timed(datetime!(2026-07-14 10:00 +9)),
    );
    let link = synced(&item, &other);
    let plan = run(&[item], &[event], &[link]);
    assert_eq!(plan.counts.raven_created, 0);
    assert_eq!(plan, Plan::default());
}

#[test]
fn imported_raven_event_adopts_its_google_event_newer_wins() {
    let mut item = active("e1", "2026-07-14T10:00:00+09:00");
    item.metadata.insert(
        "external_source".into(),
        json!({"system": "google_calendar", "id": format!("{CAL}/g1")}),
    );
    let mut event = google("g1", timed(datetime!(2026-07-14 10:00 +9)));
    event.summary = Some("Google newer".into());
    event.updated = Some(T2);
    let plan = run(&[item], &[event], &[]);
    let (_, raven, link) = only_update(&plan);
    assert_eq!(
        raven.as_ref().unwrap().update.title.as_deref(),
        Some("Google newer")
    );
    assert_eq!(link.origin, LinkOrigin::Google);
    assert_eq!(plan.counts.conflicts, 0);
}

// --- mass-change guard ----------------------------------------------------------

fn closed_pairs(count: usize, extra_links: usize) -> (Vec<TodoItem>, Vec<Link>) {
    let mut items = Vec::new();
    let mut links = Vec::new();
    for index in 0..count + extra_links {
        let (mut item, _, link) = pair(&format!("e{index}"));
        if index < count {
            item.status = ItemStatus::Archived;
            item.updated_at = T1;
        }
        items.push(item);
        links.push(link);
    }
    (items, links)
}

#[test]
fn guard_threshold_table() {
    // (deletes, other links, tripped, threshold)
    let cases = [
        (10, 0, false, 10),
        (11, 0, true, 10),
        (20, 80, false, 20),
        (21, 79, true, 20),
        (21, 89, false, 22),
    ];
    for (deletes, extra, tripped, threshold) in cases {
        let (items, links) = closed_pairs(deletes, extra);
        let plan = reconcile(&items, &[], &links, &cfg(), NOW);
        let deletions = plan
            .actions
            .iter()
            .filter(|a| matches!(a, Action::DeleteGoogle { .. }))
            .count();
        if tripped {
            assert_eq!(
                plan.guard,
                Some(GuardTrip {
                    google_deletes: deletes as u64,
                    raven_archives: 0,
                    threshold
                }),
                "{deletes}/{extra}"
            );
            assert_eq!(deletions, 0);
            assert_eq!(plan.counts.google_deleted, 0);
        } else {
            assert_eq!(plan.guard, None, "{deletes}/{extra}");
            assert_eq!(deletions, deletes);
        }
    }
}

#[test]
fn guard_allows_mass_delete_when_requested() {
    let (items, links) = closed_pairs(30, 0);
    let mut config = cfg();
    config.allow_mass_delete = true;
    let plan = reconcile(&items, &[], &links, &config, NOW);
    assert_eq!(plan.guard, None);
    assert_eq!(plan.counts.google_deleted, 30);
}

#[test]
fn guard_counts_raven_archives_and_keeps_other_actions() {
    let mut items = Vec::new();
    let mut links = Vec::new();
    let mut changes = Vec::new();
    for index in 0..12 {
        let (item, event, link) = pair(&format!("e{index}"));
        items.push(item);
        links.push(link);
        changes.push(GChange::deleted(event.id));
    }
    items.push(active("new", "2026-07-20"));
    let plan = reconcile(&items, &changes, &links, &cfg(), NOW);
    assert_eq!(
        plan.guard,
        Some(GuardTrip {
            google_deletes: 0,
            raven_archives: 12,
            threshold: 10
        })
    );
    assert_eq!(plan.counts.raven_archived, 0);
    assert_eq!(plan.counts.google_created, 1);
    assert!(
        plan.actions
            .iter()
            .all(|a| !matches!(a, Action::ArchiveRaven { .. }))
    );
}

// --- misc -------------------------------------------------------------------------

#[test]
fn links_of_other_calendars_are_ignored() {
    let (item, _, mut link) = pair("e1");
    link.calendar_id = "old@cal".into();
    let plan = run(&[item], &[], &[link]);
    // Treated as unlinked: pushed to the selected calendar.
    assert_eq!(plan.counts.google_created, 1);
}

#[test]
fn error_link_without_changes_keeps_error_state() {
    let (item, _, mut link) = pair("e1");
    link.state = LinkState::Error;
    link.error_kind = Some("server".into());
    link.error_count = 3;
    assert_eq!(
        run(
            std::slice::from_ref(&item),
            &[],
            std::slice::from_ref(&link)
        ),
        Plan::default()
    );
    let mut changed = touched(&item, T1);
    changed.title = "retry".into();
    let plan = run(&[changed], &[], &[link]);
    let (_, _, next) = only_update(&plan);
    assert_eq!(next.state, LinkState::Active);
    assert_eq!(next.error_count, 0);
}

#[test]
fn gchange_and_enum_helpers() {
    assert_eq!(GChange::deleted("x").id(), "x");
    assert!(GChange::deleted("x").is_deleted());
    assert!(GChange::event(GEvent::cancelled("y")).is_deleted());
    assert!(!GChange::event(GEvent::new("z")).is_deleted());
    for state in [
        LinkState::Active,
        LinkState::Frozen,
        LinkState::Deleted,
        LinkState::Orphaned,
        LinkState::Unsupported,
        LinkState::Error,
    ] {
        assert_eq!(LinkState::parse(state.as_str()), Some(state));
    }
    for origin in [LinkOrigin::Raven, LinkOrigin::Google] {
        assert_eq!(LinkOrigin::parse(origin.as_str()), Some(origin));
    }
    assert_eq!(LinkState::parse("bogus"), None);
}
