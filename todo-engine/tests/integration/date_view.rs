use todo_engine::application::service::{ProposeTask, TodoService, UpdateItem};
use todo_engine::domain::Actor;
use todo_engine::infrastructure::sqlite::{SqliteTodoRepository, connect, init_schema};

// Stand up a persistent service over a temp SQLite home (mirrors goal_view.rs's
// connect/init_schema/SqliteTodoRepository setup) and wrap it with
// TodoService::persistent so the assertions exercise the real list_items path.
// Uses tempfile::tempdir() directly because tests/support::TestHome is only
// registered in e2e.rs.
fn persistent_service() -> (tempfile::TempDir, TodoService) {
    let dir = tempfile::tempdir().expect("create test home");
    let db_path = dir.path().join("todo.sqlite");
    let conn = connect(db_path.to_str().expect("utf-8 db path")).unwrap();
    init_schema(&conn).unwrap();
    let repo = SqliteTodoRepository::new(conn);
    (dir, TodoService::persistent(repo))
}

// Create an OPEN task (Proposed -> Approved -> Active via the real service API)
// with the given scheduled/due, returning its id. User-proposed so approve()
// and activate() flow without an extra approval gate.
fn open_task(
    service: &mut TodoService,
    title: &str,
    scheduled: Option<&str>,
    due: Option<&str>,
) -> String {
    let item = service
        .propose_task(
            title,
            ProposeTask {
                actor: Actor::User,
                ..Default::default()
            },
        )
        .unwrap();
    service.approve(&item.id, None).unwrap();
    service.activate(&item.id, None).unwrap();
    if scheduled.is_some() || due.is_some() {
        service
            .update_item(
                &item.id,
                UpdateItem {
                    scheduled: scheduled.map(ToString::to_string),
                    due: due.map(ToString::to_string),
                    ..Default::default()
                },
            )
            .unwrap();
    }
    item.id
}

// The IDENTICAL fixture loaded into any &mut TodoService (in-memory OR
// persistent). Every task gets a DISTINCT, deterministic title so a stable key
// (title + scheduled) identifies rows independent of the store's id scheme
// (in-memory uses seeded `task_000001` ids; persistent uses UUIDs). This is what
// makes parity_in_memory_vs_persistent run "the SAME fixture" through both stores.
fn seed_fixture(service: &mut TodoService) {
    // scheduled in the June range AND == agenda date 2026-06-23
    open_task(service, "sched-in-range", Some("2026-06-23"), None);
    // due == agenda date but NOT scheduled (agenda union; excluded from range)
    open_task(service, "due-only", None, Some("2026-06-23"));
    // scheduled == due == agenda date (both-match; appears once)
    open_task(
        service,
        "both-match",
        Some("2026-06-23"),
        Some("2026-06-23"),
    );
    // scheduled in range but a different day (range yes; agenda no)
    open_task(service, "sched-other-day", Some("2026-06-10"), None);
    // scheduled OUTSIDE the June range (excluded everywhere)
    open_task(service, "sched-out-of-range", Some("2026-07-15"), None);
    // no scheduled, no due (unscheduled; excluded from both)
    open_task(service, "unscheduled", None, None);
}

// Map a result Vec to the store-independent stable key = (title, scheduled),
// preserving order. NOT raw ids (those differ across stores per VALIDATION.md).
fn keys(items: &[todo_engine::domain::TodoItem]) -> Vec<(String, Option<String>)> {
    items
        .iter()
        .map(|item| (item.title.clone(), item.scheduled.clone()))
        .collect()
}

// SC4 over the persistent store, re-proving SC3/VIEW-05: the agenda unions
// scheduled==D and due==D open tasks, and a both-match task appears once.
#[test]
fn persistent_agenda_unions_scheduled_and_due_open_tasks() {
    let (_home, mut service) = persistent_service();

    open_task(&mut service, "sched-only", Some("2026-06-23"), None);
    open_task(&mut service, "due-only", None, Some("2026-06-23"));
    open_task(
        &mut service,
        "both-match",
        Some("2026-06-23"),
        Some("2026-06-23"),
    );
    open_task(&mut service, "off-day", Some("2026-06-22"), None);

    let agenda = service.agenda("2026-06-23").unwrap();

    let mut titles: Vec<&str> = agenda.iter().map(|item| item.title.as_str()).collect();
    titles.sort_unstable();
    assert_eq!(titles, vec!["both-match", "due-only", "sched-only"]);

    // The both-match task is retained exactly once (single-date dedup).
    let both_match = agenda
        .iter()
        .filter(|item| item.title == "both-match")
        .count();
    assert_eq!(both_match, 1);
}

// SC4 / VIEW-02 over the persistent store: date_range groups by scheduled,
// returning only in-range scheduled tasks in deterministic (scheduled asc) order.
#[test]
fn persistent_date_range_groups_by_scheduled() {
    let (_home, mut service) = persistent_service();

    open_task(&mut service, "early-june", Some("2026-06-05"), None);
    open_task(&mut service, "late-june", Some("2026-06-28"), None);
    open_task(&mut service, "july-out", Some("2026-07-02"), None);
    // due in range but no scheduled -> excluded (date_range is scheduled-only).
    open_task(&mut service, "due-in-range", None, Some("2026-06-15"));
    open_task(&mut service, "unscheduled", None, None);

    let range = service.date_range("2026-06-01", "2026-06-30").unwrap();

    let titles: Vec<&str> = range.iter().map(|item| item.title.as_str()).collect();
    // scheduled ascending: 2026-06-05 then 2026-06-28.
    assert_eq!(titles, vec!["early-june", "late-june"]);
}

// SC4 / CORE-03 — the core side-effect-free oracle: calling agenda/date_range
// writes NO audit event (events().len() unchanged), proving no routine
// materialization and a pure read.
#[test]
fn agenda_is_side_effect_free() {
    let (_home, mut service) = persistent_service();

    open_task(&mut service, "task-a", Some("2026-06-23"), None);
    open_task(&mut service, "task-b", Some("2026-06-10"), None);

    let before = service.events().len();
    let _ = service.agenda("2026-06-23").unwrap();
    let _ = service.date_range("2026-06-01", "2026-06-30").unwrap();
    assert_eq!(service.events().len(), before);
}

// SC4 store parity — the explicit cross-store oracle (VALIDATION.md "identical
// results regardless of caller"): the IDENTICAL seed_fixture runs through both an
// in-memory and a persistent service; the ordered (title, scheduled) stable-key
// sequences must be equal for BOTH agenda and date_range. Compared by stable key,
// NEVER raw id (in-memory seeds `task_000001`, persistent uses UUIDs).
#[test]
fn parity_in_memory_vs_persistent() {
    let mut mem = TodoService::in_memory();
    let (_dir, mut disk) = persistent_service();

    seed_fixture(&mut mem);
    seed_fixture(&mut disk);

    let mem_range = mem.date_range("2026-06-01", "2026-06-30").unwrap();
    let disk_range = disk.date_range("2026-06-01", "2026-06-30").unwrap();
    assert_eq!(keys(&mem_range), keys(&disk_range));

    let mem_agenda = mem.agenda("2026-06-23").unwrap();
    let disk_agenda = disk.agenda("2026-06-23").unwrap();
    assert_eq!(keys(&mem_agenda), keys(&disk_agenda));
}
