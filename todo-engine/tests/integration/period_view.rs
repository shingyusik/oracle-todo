use todo_engine::application::service::{
    PeriodView, ProposeGoal, ProposeTask, TodoService, UpdateItem,
};
use todo_engine::domain::{Actor, Horizon};
use todo_engine::infrastructure::sqlite::{SqliteTodoRepository, connect, init_schema};

// Stand up a persistent service over a temp SQLite home (copied verbatim from
// date_view.rs:10-17 — NOT shared outside e2e, so each integration test file
// carries its own copy). `connect` + `init_schema` + `SqliteTodoRepository::new`
// + `TodoService::persistent` so the assertions exercise the real SQL CTE path.
fn persistent_service() -> (tempfile::TempDir, TodoService) {
    let dir = tempfile::tempdir().expect("create test home");
    let db_path = dir.path().join("todo.sqlite");
    let conn = connect(db_path.to_str().expect("utf-8 db path")).unwrap();
    init_schema(&conn).unwrap();
    let repo = SqliteTodoRepository::new(conn);
    (dir, TodoService::persistent(repo))
}

// ProposeGoal builder adapted from goal_view.rs:6 — DISTINCT titles double as
// stable structure keys (never raw ids; in-memory seeds `goal_000001`).
fn goal(title: &str, horizon: &str, scheduled: &str, parent_id: Option<&str>) -> ProposeGoal {
    ProposeGoal {
        title: title.to_string(),
        horizon: horizon.to_string(),
        scheduled: scheduled.to_string(),
        parent_id: parent_id.map(ToString::to_string),
        actor: Actor::User,
        note: None,
    }
}

// Create an OPEN task (Proposed -> Approved -> Active via the real service API)
// linked under `parent_goal_id` with an optional `scheduled`, returning its id.
// Mirrors date_view.rs:22 but sets `parent_id` (the audited update_item path,
// which validates the parent is a non-terminal Goal via ensure_relation).
fn open_task(
    service: &mut TodoService,
    title: &str,
    parent_goal_id: &str,
    scheduled: Option<&str>,
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
    service
        .update_item(
            &item.id,
            UpdateItem {
                parent_id: Some(parent_goal_id.to_string()),
                scheduled: scheduled.map(ToString::to_string),
                ..Default::default()
            },
        )
        .unwrap();
    item.id
}

// The Wave-0 nested-tree key (RESEARCH Wave 0 gap): a depth-first flattener that
// captures STRUCTURE — emitting (title, depth, kind) where kind is
// "goal"/"task" — unlike date_view's flat vec. Reused by Plan 03's parity test.
fn tree_keys(view: &PeriodView) -> Vec<(String, usize, &'static str)> {
    fn walk(
        node: &todo_engine::application::service::GoalNode,
        depth: usize,
        out: &mut Vec<(String, usize, &'static str)>,
    ) {
        out.push((node.goal.title.clone(), depth, "goal"));
        for task in &node.tasks {
            out.push((task.title.clone(), depth, "task"));
        }
        for child in &node.child_goals {
            walk(child, depth + 1, out);
        }
    }
    let mut out = Vec::new();
    for root in &view.roots {
        walk(root, 0, &mut out);
    }
    out
}

// year -> month -> week decomposition with TWO sibling month roots at the same
// (month, 2026-06-01) anchor (proving all exact matches are roots, D-02); a week
// child under the FIRST month goal; a scheduled task under that week child; and
// an UNSCHEDULED task under the month root (VIEW-04). A separate year goal exists
// as a COARSER ancestor that must NOT be climbed to (D-02). Returns the ids of
// the structurally interesting nodes for assertions.
struct Seed {
    month_a: String,
    month_b: String,
    week_child: String,
}

fn seed_goal_tree(service: &mut TodoService) -> Seed {
    let year = service
        .propose_goal(goal("year-2026", "year", "2026-01-01", None))
        .unwrap();
    // month-A is a TOP-LEVEL root; month-B is nested under the year goal. Both
    // anchor to (month, 2026-06-01) so both are roots by D-02, but they have
    // DISTINCT (horizon, scheduled, parent_id) identities so GOAL-05 (duplicate
    // top-level identity) does not reject them. The year goal is a COARSER
    // ancestor that must NOT be climbed to as a root in a month view (D-02).
    let month_a = service
        .propose_goal(goal("month-june-A", "month", "2026-06-01", None))
        .unwrap();
    let month_b = service
        .propose_goal(goal("month-june-B", "month", "2026-06-01", Some(&year.id)))
        .unwrap();
    // Week child under month-A; its OWN scheduled (2026-06-08) is a different
    // period than the month root, proving cross-period descent (D-03).
    let week_child = service
        .propose_goal(goal("week-jun08", "week", "2026-06-08", Some(&month_a.id)))
        .unwrap();
    // Scheduled task under the week child.
    open_task(
        service,
        "task-scheduled",
        &week_child.id,
        Some("2026-06-09"),
    );
    // Unscheduled task under the month-A root (VIEW-04: surfaced inline, last).
    open_task(service, "task-unscheduled", &month_a.id, None);

    Seed {
        month_a: month_a.id,
        month_b: month_b.id,
        week_child: week_child.id,
    }
}

// VIEW-03/SC1: a (horizon, in-period date) returns the exact-match month roots,
// with the week child nested under its month and the scheduled task under the
// week. Uses a NON-canonical in-period date (2026-06-15) to prove normalization.
#[test]
fn in_memory_period_view_builds_subtree() {
    let mut service = TodoService::in_memory();
    seed_goal_tree(&mut service);

    let view = service.period_view(Horizon::Month, "2026-06-15").unwrap();

    assert_eq!(view.horizon, "month");
    assert_eq!(view.period_key, "2026-06-01");
    assert_eq!(view.anomaly_count, 0);

    // Two sibling month roots.
    let root_titles: Vec<&str> = view.roots.iter().map(|n| n.goal.title.as_str()).collect();
    assert!(root_titles.contains(&"month-june-A"));
    assert!(root_titles.contains(&"month-june-B"));
    assert_eq!(view.roots.len(), 2);

    // The week child nests under month-A, and the scheduled task under the week.
    let month_a = view
        .roots
        .iter()
        .find(|n| n.goal.title == "month-june-A")
        .unwrap();
    assert_eq!(month_a.child_goals.len(), 1);
    let week = &month_a.child_goals[0];
    assert_eq!(week.goal.title, "week-jun08");
    let week_task_titles: Vec<&str> = week.tasks.iter().map(|t| t.title.as_str()).collect();
    assert_eq!(week_task_titles, vec!["task-scheduled"]);
}

// D-02: both sibling month goals are roots; a coarser ancestor (the year goal) is
// NEVER climbed to / NEVER a root in a month view.
#[test]
fn roots_are_exact_period_matches() {
    let mut service = TodoService::in_memory();
    seed_goal_tree(&mut service);

    let view = service.period_view(Horizon::Month, "2026-06-01").unwrap();

    let root_titles: Vec<&str> = view.roots.iter().map(|n| n.goal.title.as_str()).collect();
    assert_eq!(root_titles.len(), 2);
    assert!(root_titles.contains(&"month-june-A"));
    assert!(root_titles.contains(&"month-june-B"));
    // The year goal is a coarser ancestor — never a root, never climbed to.
    assert!(
        !tree_keys(&view)
            .iter()
            .any(|(title, _, _)| title == "year-2026")
    );
}

// D-03/D-03a: a finer goal whose OWN scheduled is a different week still appears
// under its month root via parent_id; and a finer goal whose parent is in a
// DIFFERENT period is NOT a root in this view.
#[test]
fn descendants_cross_period_included() {
    let mut service = TodoService::in_memory();
    let seed = seed_goal_tree(&mut service);

    let view = service.period_view(Horizon::Month, "2026-06-01").unwrap();

    // week-jun08 (scheduled in a different week) descends under month-A.
    let keys = tree_keys(&view);
    assert!(
        keys.iter().any(|(title, depth, kind)| {
            title == "week-jun08" && *depth == 1 && *kind == "goal"
        })
    );

    // The week child is NOT itself a (month, 2026-06-01) root.
    assert!(!view.roots.iter().any(|n| n.goal.id == seed.week_child));
    let _ = seed.month_a;
    let _ = seed.month_b;
}

// VIEW-04/SC2: the unscheduled task appears inline in its GoalNode.tasks, sorted
// LAST after scheduled siblings, never dropped.
#[test]
fn unscheduled_task_surfaced() {
    let mut service = TodoService::in_memory();
    let seed = seed_goal_tree(&mut service);

    // Add a SECOND scheduled task under month-A so we can prove ordering: the
    // unscheduled task lands after the scheduled one within month-A.tasks.
    open_task(
        &mut service,
        "month-task-scheduled",
        &seed.month_a,
        Some("2026-06-20"),
    );

    let view = service.period_view(Horizon::Month, "2026-06-01").unwrap();
    let month_a = view
        .roots
        .iter()
        .find(|n| n.goal.title == "month-june-A")
        .unwrap();

    let task_titles: Vec<&str> = month_a.tasks.iter().map(|t| t.title.as_str()).collect();
    // Membership: the unscheduled task is present.
    assert!(task_titles.contains(&"task-unscheduled"));
    // Ordering: scheduled task first, unscheduled LAST.
    assert_eq!(
        task_titles,
        vec!["month-task-scheduled", "task-unscheduled"]
    );
}

// D-05/D-06: tasks within a node are sort_date_view order (unscheduled last);
// child_goals are scheduled-asc then created_at/id.
#[test]
fn node_ordering_is_deterministic() {
    let mut service = TodoService::in_memory();
    let month = service
        .propose_goal(goal("month-root", "month", "2026-06-01", None))
        .unwrap();
    // Two week children with different scheduled dates (later created first to
    // prove the sort is by scheduled, not insertion/creation order).
    let _w_late = service
        .propose_goal(goal("week-later", "week", "2026-06-22", Some(&month.id)))
        .unwrap();
    let _w_early = service
        .propose_goal(goal("week-earlier", "week", "2026-06-08", Some(&month.id)))
        .unwrap();
    // Tasks under the month root: an unscheduled (created first) and a scheduled.
    open_task(&mut service, "m-task-unscheduled", &month.id, None);
    open_task(
        &mut service,
        "m-task-scheduled",
        &month.id,
        Some("2026-06-15"),
    );

    let view = service.period_view(Horizon::Month, "2026-06-01").unwrap();
    let root = view
        .roots
        .iter()
        .find(|n| n.goal.title == "month-root")
        .unwrap();

    // child_goals sorted by scheduled ascending.
    let child_titles: Vec<&str> = root
        .child_goals
        .iter()
        .map(|n| n.goal.title.as_str())
        .collect();
    assert_eq!(child_titles, vec!["week-earlier", "week-later"]);

    // tasks: scheduled first, unscheduled last (sort_date_view).
    let task_titles: Vec<&str> = root.tasks.iter().map(|t| t.title.as_str()).collect();
    assert_eq!(task_titles, vec!["m-task-scheduled", "m-task-unscheduled"]);
}

// SC3: the depth-cap/anomaly guard. The validating service API cannot build a
// >64-deep or cyclic goal chain (propose_goal enforces strictly-coarser horizons
// and rejects cycles), so the true over-depth/cyclic anomaly assertions are
// DEFERRED to Plan 03's store-level fixture. Here we assert the in-bounds happy
// path returns anomaly_count == 0.
#[test]
fn depth_cap_truncates() {
    let mut service = TodoService::in_memory();
    seed_goal_tree(&mut service);

    let view = service.period_view(Horizon::Month, "2026-06-01").unwrap();
    assert_eq!(view.anomaly_count, 0);
}

// SC3/CORE-03: period_view writes NO audit event — events().len() is unchanged
// across the call (mirrors date_view.rs:141-152).
#[test]
fn period_view_is_side_effect_free() {
    let mut service = TodoService::in_memory();
    seed_goal_tree(&mut service);

    let before = service.events().len();
    let _ = service.period_view(Horizon::Month, "2026-06-15").unwrap();
    assert_eq!(service.events().len(), before);
}

// ---------------------------------------------------------------------------
// Plan 04-03 Task 1: Persistent SQL CTE path, cross-store parity, persistent
// side-effect-freedom. The store-level anomaly fixtures (cycle/orphan/depth) are
// in Task 2 below.
// ---------------------------------------------------------------------------

// SC1/VIEW-03 over the REAL SQLite CTE path: the same `seed_goal_tree` fixture,
// run through a persistent service, builds the documented subtree shape. Adds a
// terminal GOAL (completed week child) and a terminal TASK under month-A to prove
// the CTE's ASYMMETRIC D-07 predicate: terminal goals are KEPT and traversed
// through; terminal tasks are EXCLUDED (open-only).
#[test]
fn persistent_period_view_builds_subtree() {
    let (_home, mut service) = persistent_service();
    let seed = seed_goal_tree(&mut service);

    // Terminal GOAL (D-07: kept + traversed). Complete the week child under
    // month-A; ADR-0006 no-cascade keeps it in the structure.
    service.complete(&seed.week_child, None).unwrap();

    // Terminal TASK (D-07: excluded, open-only). Add then complete a task under
    // month-A so it is terminal at view time.
    let terminal_task = open_task(
        &mut service,
        "task-terminal",
        &seed.month_a,
        Some("2026-06-12"),
    );
    service.complete(&terminal_task, None).unwrap();

    let view = service.period_view(Horizon::Month, "2026-06-01").unwrap();

    assert_eq!(view.horizon, "month");
    assert_eq!(view.period_key, "2026-06-01");
    assert_eq!(view.anomaly_count, 0);

    let keys = tree_keys(&view);

    // Two sibling month roots present via the SQL CTE.
    let root_titles: Vec<&str> = view.roots.iter().map(|n| n.goal.title.as_str()).collect();
    assert!(root_titles.contains(&"month-june-A"));
    assert!(root_titles.contains(&"month-june-B"));
    assert_eq!(view.roots.len(), 2);

    // D-07 asymmetry on the SQL path: the TERMINAL GOAL is STILL present and
    // traversed (the scheduled task under it still appears), while the TERMINAL
    // TASK is absent (open-only filter).
    assert!(
        keys.iter()
            .any(|(title, depth, kind)| title == "week-jun08" && *depth == 1 && *kind == "goal"),
        "terminal goal must be kept + traversed (D-07)"
    );
    assert!(
        keys.iter()
            .any(|(title, _, kind)| title == "task-scheduled" && *kind == "task"),
        "an open task under the terminal goal must still surface"
    );
    assert!(
        !keys.iter().any(|(title, _, _)| title == "task-terminal"),
        "terminal task must be excluded by the open-only CTE predicate (D-07)"
    );
}

// SC4/CORE-03/D-11 — MANDATORY cross-store parity. The IDENTICAL fixture runs
// through both an in-memory and a persistent store; the structure-capturing
// `tree_keys()` sequences (title, depth, kind) must be EQUAL — never raw ids,
// since in-memory uses `goal_000001`/`task_000001` and persistent uses UUIDs.
// The seed includes BOTH a terminal task and a live task under the same goal so
// the D-07 task-visibility predicate is exercised on BOTH loaders.
#[test]
fn parity_in_memory_vs_persistent() {
    fn seed_with_terminal_and_live_task(service: &mut TodoService) {
        let seed = seed_goal_tree(service);
        // A LIVE (open) task under month-A — must appear in BOTH stores.
        open_task(service, "task-live", &seed.month_a, Some("2026-06-11"));
        // A TERMINAL task under month-A — must appear in NEITHER store (D-07).
        let terminal = open_task(service, "task-dead", &seed.month_a, Some("2026-06-13"));
        service.complete(&terminal, None).unwrap();
    }

    let mut mem = TodoService::in_memory();
    let (_dir, mut disk) = persistent_service();

    seed_with_terminal_and_live_task(&mut mem);
    seed_with_terminal_and_live_task(&mut disk);

    let mem_view = mem.period_view(Horizon::Month, "2026-06-01").unwrap();
    let disk_view = disk.period_view(Horizon::Month, "2026-06-01").unwrap();

    // The structure-capturing key sequences are equal across stores (D-11).
    assert_eq!(tree_keys(&mem_view), tree_keys(&disk_view));
    // Clean seed: both anomaly_counts are 0.
    assert_eq!(mem_view.anomaly_count, disk_view.anomaly_count);
    assert_eq!(mem_view.anomaly_count, 0);

    // Cross-store D-07 absence-parity: the terminal task is absent in BOTH, the
    // live task is present in BOTH — the two loaders filter task status identically.
    let mem_keys = tree_keys(&mem_view);
    let disk_keys = tree_keys(&disk_view);
    assert!(!mem_keys.iter().any(|(title, _, _)| title == "task-dead"));
    assert!(!disk_keys.iter().any(|(title, _, _)| title == "task-dead"));
    assert!(mem_keys.iter().any(|(title, _, _)| title == "task-live"));
    assert!(disk_keys.iter().any(|(title, _, _)| title == "task-live"));
}

// SC3/CORE-03: the persistent `period_view` writes NO audit event — the SQL load
// is a pure read (mirrors date_view.rs:141-152).
#[test]
fn period_view_is_side_effect_free_persistent() {
    let (_home, mut service) = persistent_service();
    seed_goal_tree(&mut service);

    let before = service.events().len();
    let _ = service.period_view(Horizon::Month, "2026-06-15").unwrap();
    assert_eq!(service.events().len(), before);
}
