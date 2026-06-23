//! Fast in-memory behavior tests for the date-view contract (VIEW-02 / VIEW-05).
//!
//! These are the Nyquist oracles for the locked decisions proven at unit level
//! against the real `TodoService::agenda` / `TodoService::date_range` signatures
//! shipped in plan 03-01:
//!
//! - SC1 / D-08 (`range_orders`): `date_range` orders scheduled ascending, then
//!   `created_at`, then `id`.
//! - SC2 (`unscheduled_never_dropped`): unscheduled rows (None / legacy `"today"`
//!   sentinel / junk) are retained on the agenda/full-set path and sorted last.
//! - SC3 (`agenda_union_dedup`): single-date `agenda` is the `scheduled == D`
//!   union `due == D`, id-deduped to one row.
//! - D-05 (`open_only`): only Proposed / Approved / Active surface; the reachable
//!   closed/hidden statuses (Completed / Waiting / Paused) are excluded.
//! - D-06 (`no_overdue_roll`): a past-scheduled task is absent from a later agenda.
//!
//! All tests use `TodoService::in_memory()` and the real service API (no I/O).
//! The in-memory clock advances one second per mutation, so creation order is
//! `created_at` ascending and `id` ascending — which is what the tie-break asserts.

use todo_engine::application::service::{ProposeTask, TodoService, UpdateItem};
use todo_engine::domain::Actor;

/// Propose a user task (so it starts Approved and can be activated) with an
/// optional `scheduled` and `due`, returning its id.
fn task(service: &mut TodoService, scheduled: Option<&str>, due: Option<&str>) -> String {
    service
        .propose_task(
            "task",
            ProposeTask {
                actor: Actor::User,
                scheduled: scheduled.map(ToString::to_string),
                due: due.map(ToString::to_string),
                ..Default::default()
            },
        )
        .unwrap()
        .id
}

/// Collect the returned ids in order for an ordered-sequence assertion (the
/// `filter.rs` id-collection idiom).
fn ids(items: &[todo_engine::domain::TodoItem]) -> Vec<String> {
    items.iter().map(|i| i.id.clone()).collect()
}

/// SC1 (VIEW-02) + D-08: `date_range` returns scheduled ascending, with same-day
/// ties broken by `created_at` then `id`. Two same-day tasks prove the tie-break.
#[test]
fn range_orders() {
    let mut service = TodoService::in_memory();

    // Out-of-creation-order scheduled dates plus two same-day (2026-06-10) ties.
    let late = task(&mut service, Some("2026-06-20"), None); // created first
    let tie_a = task(&mut service, Some("2026-06-10"), None); // same day, created earlier
    let tie_b = task(&mut service, Some("2026-06-10"), None); // same day, created later
    let early = task(&mut service, Some("2026-06-02"), None); // created last

    let result = service.date_range("2026-06-01", "2026-06-30").unwrap();

    // scheduled ascending: 06-02, then the 06-10 pair (created_at -> id), then 06-20.
    assert_eq!(ids(&result), vec![early, tie_a, tie_b, late]);
}

/// SC2 (VIEW-02): on the agenda/full-set path, unscheduled rows (None, legacy
/// `"today"` sentinel, junk) are NEVER dropped and are sorted last. The agenda
/// retains a row when `scheduled == D OR due == D`; we keep the unscheduled rows
/// in scope by giving each a `due == D` while leaving `scheduled` unscheduled
/// (None / "today" / junk), then assert all are present and occupy the tail of
/// the ordering (sorted last by `sort_date_view`, which puts unscheduled last).
#[test]
fn unscheduled_never_dropped() {
    let mut service = TodoService::in_memory();

    // Two genuinely scheduled rows on the agenda day.
    let sched_a = task(&mut service, Some("2026-06-23"), None);
    let sched_b = task(&mut service, Some("2026-06-23"), None);

    // Three unscheduled rows that are still in agenda scope via due == D:
    // None scheduled, the legacy "today" sentinel, and a junk value. All three
    // have scheduled that iso_day() collapses to None (unscheduled), so they must
    // sort LAST while remaining present.
    let none_sched = task(&mut service, None, Some("2026-06-23"));
    let today_sentinel = task(&mut service, None, Some("2026-06-23"));
    service
        .update_item(
            &today_sentinel,
            UpdateItem {
                scheduled: Some("today".to_string()),
                ..Default::default()
            },
        )
        .unwrap();
    let junk = task(&mut service, None, Some("2026-06-23"));
    service
        .update_item(
            &junk,
            UpdateItem {
                scheduled: Some("not-a-date".to_string()),
                ..Default::default()
            },
        )
        .unwrap();

    let result = service.agenda("2026-06-23").unwrap();
    let order = ids(&result);

    // All five rows present — none dropped.
    assert_eq!(order.len(), 5);
    for id in [&sched_a, &sched_b, &none_sched, &today_sentinel, &junk] {
        assert!(order.contains(id), "row {id} was dropped from the agenda");
    }

    // The three unscheduled rows occupy the trailing entries (sorted last).
    let tail = &order[order.len() - 3..];
    for id in [&none_sched, &today_sentinel, &junk] {
        assert!(
            tail.contains(id),
            "unscheduled row {id} was not sorted to the tail"
        );
    }
    // The two scheduled rows lead.
    assert_eq!(&order[..2], &[sched_a, sched_b]);
}

/// SC3 (VIEW-05): single-date `agenda` is the `scheduled == D` union `due == D`,
/// id-deduped so a both-match task appears exactly once.
#[test]
fn agenda_union_dedup() {
    let mut service = TodoService::in_memory();

    let scheduled_only = task(&mut service, Some("2026-06-23"), None);
    let due_only = task(&mut service, None, Some("2026-06-23"));
    let both = task(&mut service, Some("2026-06-23"), Some("2026-06-23"));

    let result = service.agenda("2026-06-23").unwrap();
    let order = ids(&result);

    // All three appear.
    for id in [&scheduled_only, &due_only, &both] {
        assert!(order.contains(id), "agenda is missing {id}");
    }
    // The both-match task is deduped to a single row.
    assert_eq!(
        result.iter().filter(|i| i.id == both).count(),
        1,
        "both-match task appeared more than once"
    );
}

/// D-05: only Proposed / Approved / Active surface in a date-view read. The
/// reachable closed/hidden statuses Completed (via `complete`) and Paused (via
/// `pause`) are excluded. Waiting is omitted: the only producer is the
/// routine-pause cascade, which fires solely on tasks carrying the
/// `metadata["generated_by"] == "routine"` marker, and no public service API
/// sets that marker — it is not drivable from a test fixture. The OPEN_STATUSES
/// allowlist is exclusion-by-construction (anything not in
/// {Proposed, Approved, Active} is excluded), so the reachable Completed/Paused
/// exclusions prove the allowlist semantics; Waiting/Someday are excluded the
/// same way without a producer. Someday is likewise unreachable via any mutation.
#[test]
fn open_only() {
    let mut service = TodoService::in_memory();
    let day = "2026-06-23";

    // Open statuses — must be INCLUDED.
    let proposed = service
        .propose_task(
            "proposed",
            ProposeTask {
                actor: Actor::Agent, // agent-created stays Proposed
                scheduled: Some(day.to_string()),
                ..Default::default()
            },
        )
        .unwrap()
        .id;

    let approved = task(&mut service, Some(day), None); // user task -> Approved

    let active = task(&mut service, Some(day), None);
    service.activate(&active, None).unwrap();

    // Reachable closed/hidden statuses — must be EXCLUDED.
    let completed = task(&mut service, Some(day), None);
    service.complete(&completed, None).unwrap();

    let paused = task(&mut service, Some(day), None);
    service.pause(&paused, None).unwrap();

    let result = service.agenda(day).unwrap();
    let order = ids(&result);

    for id in [&proposed, &approved, &active] {
        assert!(order.contains(id), "open task {id} was excluded");
    }
    for id in [&completed, &paused] {
        assert!(
            !order.contains(id),
            "non-open task {id} leaked into the agenda"
        );
    }
}

/// D-06: no overdue roll — a task scheduled 2026-06-20 is ABSENT from
/// `agenda("2026-06-23")`. The legacy `scheduled <= today` roll is NOT replicated;
/// the agenda is exact-date only.
#[test]
fn no_overdue_roll() {
    let mut service = TodoService::in_memory();

    let past = task(&mut service, Some("2026-06-20"), None);
    let on_day = task(&mut service, Some("2026-06-23"), None);

    let result = service.agenda("2026-06-23").unwrap();
    let order = ids(&result);

    assert!(
        !order.contains(&past),
        "past-scheduled task rolled into a later agenda"
    );
    assert!(order.contains(&on_day), "on-day task missing from agenda");
}
