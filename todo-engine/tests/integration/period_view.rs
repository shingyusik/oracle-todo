use todo_engine::application::service::{
    MAX_GOAL_DEPTH, PeriodView, ProposeGoal, ProposeTask, TodoService, UpdateItem,
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

// D-07 / WR-04 — cross-store parity for the `goal(root) -> task -> goal` shape, the
// exact topology where WR-01's divergence lived. The validating service API rejects
// goal-under-task (validate_goal_nesting), so the persistent half is raw-injected;
// the in-memory half cannot be raw-built (ServiceStore::InMemory is pub(super)).
//
// RESEARCH Open Question 1 resolved with the recommended loader-level comparison
// (option b, no production test hook): seed the in-memory side with the
// rendered-EQUIVALENT VALID shape the API permits — `goal G1(root)` with an open
// task T under it, G2 simply NOT created (because under Plan 02's D-01 CTE fix G2 is
// provably unreachable in the persistent store too: its parent is a task, so the
// goal-only descent drops it). The assertion then proves the persistent
// goal->task->goal view's tree_keys + anomaly_count EQUAL the in-memory goal->task
// view's — i.e. G2 does NOT leak into the persistent tree. If Plan 02's fix were
// absent/wrong, G2 would surface in the persistent tree and tree_keys would diverge,
// failing this test (the WR-01 divergence guard). Compare tree_keys (title, depth,
// kind) — NEVER raw ids (in-memory `goal_000001`, persistent UUIDs).
#[test]
fn parity_goal_task_goal_cross_store() {
    // Persistent half: raw-inject goal G1(root) -> task T -> goal G2, parent-first
    // so each FK is satisfied at insert time (Pitfall-4).
    let home = raw_home();
    insert_goal_row(&home.conn, "G1", "g1-root", "month", "2026-06-01", None);
    insert_task_row(&home.conn, "T", "t-under-goal", Some("2026-06-11"), Some("G1"));
    insert_goal_row(&home.conn, "G2", "g2-under-task", "week", "2026-06-08", Some("T"));
    let mut disk = service_over(home.conn);
    let disk_view = disk.period_view(Horizon::Month, "2026-06-01").unwrap();

    // In-memory-equivalent half: the valid `goal G1 -> open task T` the API permits
    // (G2 is unreachable in the persistent store too, so it is correctly absent here).
    let mut mem = TodoService::in_memory();
    let g1 = mem
        .propose_goal(goal("g1-root", "month", "2026-06-01", None))
        .unwrap();
    open_task(&mut mem, "t-under-goal", &g1.id, Some("2026-06-11"));
    let mem_view = mem.period_view(Horizon::Month, "2026-06-01").unwrap();

    // The persistent goal->task->goal working set is {G1, T}: G1 rendered, T inlined,
    // G2 ABSENT — identical structure to the in-memory goal->task view (D-01 enforced).
    assert_eq!(
        tree_keys(&disk_view),
        tree_keys(&mem_view),
        "goal->task->goal must render identically to goal->task (G2 must NOT leak, WR-01)"
    );
    // Anomaly parity: both clean, both 0 (G2 dropped pre-walk, not severed-as-anomaly).
    assert_eq!(disk_view.anomaly_count, mem_view.anomaly_count);
    assert_eq!(disk_view.anomaly_count, 0);
    // G2 is absent from the persistent tree keys; T (open) is present.
    let disk_keys = tree_keys(&disk_view);
    assert!(
        !disk_keys.iter().any(|(title, _, _)| title == "g2-under-task"),
        "G2 (goal under a task) must not leak into the persistent tree (D-01)"
    );
    assert!(disk_keys.iter().any(|(title, _, _)| title == "t-under-goal"));
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

// ---------------------------------------------------------------------------
// Plan 04-03 Task 2: SC3 store-level anomaly fixtures. The validating service API
// (propose_goal -> validate_goal_nesting, goal.rs:50) REJECTS cycles and
// over-coarse nesting at create time, so the cycle/orphan/over-depth fixtures
// must be injected as RAW SQLite rows, bypassing the service-layer validation.
// These prove SC3/D-08/D-09: period_view TERMINATES and returns Ok with
// anomaly_count bumped — never hangs, never Errs — on adversarial legacy data.
//
// All fixtures live in a per-test tempfile home (never the live data home,
// CLAUDE.md). `*.sqlite` is gitignored.
// ---------------------------------------------------------------------------

// Open a raw SQLite connection over a temp home, init the schema, and hand BOTH
// the live `Connection` (for raw row injection that bypasses TodoService) and a
// deferred builder that wraps the SAME connection in a persistent service once
// injection is done. The TempDir is returned so the home outlives the service.
struct RawHome {
    _dir: tempfile::TempDir,
    conn: rusqlite::Connection,
}

fn raw_home() -> RawHome {
    let dir = tempfile::tempdir().expect("create test home");
    let db_path = dir.path().join("todo.sqlite");
    let conn = connect(db_path.to_str().expect("utf-8 db path")).unwrap();
    init_schema(&conn).unwrap();
    RawHome { _dir: dir, conn }
}

// Insert a goal row DIRECTLY via SQL, bypassing propose_goal/validate_goal_nesting.
// Only the NOT-NULL columns plus (horizon, scheduled, parent_id) are set; the
// defaulted columns (materialization_policy/second_brain_refs/metadata) fall back
// to their schema DEFAULTs. Mirrors the repo.rs column contract. `parent_id` may
// reference a not-yet-existing id ONLY if the FK is satisfiable at insert time —
// for cycles, insert with parent_id = NULL then UPDATE (see cycle test).
fn insert_goal_row(
    conn: &rusqlite::Connection,
    id: &str,
    title: &str,
    horizon: &str,
    scheduled: &str,
    parent_id: Option<&str>,
) {
    conn.execute(
        "INSERT INTO items
            (id, type, title, status, proposed_by, created_at, updated_at,
             horizon, scheduled, parent_id)
         VALUES (?1, 'goal', ?2, 'active', 'user', ?3, ?3, ?4, ?5, ?6)",
        rusqlite::params![
            id,
            title,
            "2026-06-01T00:00:00Z",
            horizon,
            scheduled,
            parent_id,
        ],
    )
    .expect("raw goal insert");
}

// Insert a TASK row DIRECTLY via SQL, mirroring insert_goal_row's column contract
// but with type='task' and an OPEN status ('active'). A terminal status would be
// filtered out by the D-07 open-only task predicate (Pitfall-5), so 'active' keeps
// the task visible under its parent goal. Tasks need no `horizon` column for the
// CTE — only the goal seed must match the requested period. `parent_id` must
// reference an already-inserted id (insert parent-first to satisfy the FK).
fn insert_task_row(
    conn: &rusqlite::Connection,
    id: &str,
    title: &str,
    scheduled: Option<&str>,
    parent_id: Option<&str>,
) {
    conn.execute(
        "INSERT INTO items
            (id, type, title, status, proposed_by, created_at, updated_at, scheduled, parent_id)
         VALUES (?1, 'task', ?2, 'active', 'user', ?3, ?3, ?4, ?5)",
        rusqlite::params![id, title, "2026-06-01T00:00:00Z", scheduled, parent_id],
    )
    .expect("raw task insert");
}

// Build a persistent service over a raw connection after injection is complete.
fn service_over(conn: rusqlite::Connection) -> TodoService {
    TodoService::persistent(SqliteTodoRepository::new(conn))
}

// SC3 / T-04-07 (DoS): a 2-node parent_id CYCLE (A<->B) injected at the store
// level, where BOTH nodes anchor to the requested (month, 2026-06-01) period.
// Because parent_id has a forward FK (REFERENCES items(id)), the cycle is built by
// inserting A and B with parent_id = NULL, then UPDATE-ing each to point at the
// other (an UPDATE after both rows exist satisfies the FK).
//
// D-04 (04.1) reclassification: because A and B are BOTH exact (month, 2026-06-01)
// matches, they are valid D-02 SIBLING ROOTS, not an anomaly. With strict
// single-parent topology a cycle can only ever be loaded into the working set when
// at least one cycle node is itself a period root (a non-root cycle is unreachable
// from any seed), and re-visiting a root is correctly NOT counted (it is already
// emitted as a top-level sibling). So the correct post-fix result here is
// anomaly_count == 0 — exactly the WR-02 over-count this plan removes. The genuine
// sever-and-count path (depth/visited) is still exercised by the over-depth
// fixtures (`depth_cap_truncates` / `depth_cap_truncates_persistent`), and the
// sibling-root==0 invariant is locked independently by the Plan 03 D-08 fixture.
//
// The call must still return Ok and the test COMPLETING is the non-hang proof (SQL
// UNION bounds the load; the in-memory visited-set bounds the walk despite the
// store-level cycle).
#[test]
fn cycle_is_severed_no_error() {
    let home = raw_home();

    // Both nodes at (month, 2026-06-01) so the cycle is reachable from the seed.
    // Distinct parent_id identities are irrelevant here (raw insert bypasses the
    // GOAL-05 duplicate check too).
    insert_goal_row(&home.conn, "goal-A", "cycle-A", "month", "2026-06-01", None);
    insert_goal_row(&home.conn, "goal-B", "cycle-B", "month", "2026-06-01", None);
    // Form the A<->B cycle now that both rows exist (FK satisfied).
    home.conn
        .execute(
            "UPDATE items SET parent_id = ?1 WHERE id = ?2",
            rusqlite::params!["goal-B", "goal-A"],
        )
        .unwrap();
    home.conn
        .execute(
            "UPDATE items SET parent_id = ?1 WHERE id = ?2",
            rusqlite::params!["goal-A", "goal-B"],
        )
        .unwrap();

    let mut service = service_over(home.conn);

    // Must terminate and return Ok despite the store-level cycle (non-hang proof).
    let view = service.period_view(Horizon::Month, "2026-06-01").unwrap();
    // D-04: two same-period nodes are valid sibling roots, NOT an anomaly. Re-visiting
    // a root is intercepted by `root_ids.contains` and skipped without bumping.
    assert_eq!(
        view.anomaly_count, 0,
        "two same-period sibling roots must NOT over-count (D-04 / WR-02); got {}",
        view.anomaly_count
    );
    // Both same-period nodes still surface as top-level sibling roots (D-02).
    let titles: Vec<&str> = view.roots.iter().map(|n| n.goal.title.as_str()).collect();
    assert!(titles.contains(&"cycle-A") && titles.contains(&"cycle-B"));
}

// SC3: a goal whose parent_id points to a NON-EXISTENT id. The FK is checked, so
// the orphan is created by inserting the goal at (month, 2026-06-01) as a root,
// then re-pointing its parent_id to a dangling id via a deferred/standalone
// UPDATE. period_view must return Ok and not panic. The orphan is simply
// unreachable as a child (its parent is not in the working set), so it surfaces
// as a normal root here — the key SC3 guarantee is Ok + no panic on malformed
// parent linkage.
#[test]
fn orphan_parent_no_error() {
    let home = raw_home();

    // A real root at the period.
    insert_goal_row(&home.conn, "root", "real-root", "month", "2026-06-01", None);
    // A child of the root, then re-point its parent at a dangling id. The schema
    // FK would reject a forward reference to a missing id at insert time, so we
    // disable FK enforcement for THIS injection only (the legacy/corrupt-data
    // scenario SC3 defends against) then restore it.
    home.conn
        .execute_batch("PRAGMA foreign_keys = OFF;")
        .unwrap();
    insert_goal_row(
        &home.conn,
        "orphan",
        "orphan-goal",
        "week",
        "2026-06-08",
        Some("does-not-exist"),
    );
    home.conn
        .execute_batch("PRAGMA foreign_keys = ON;")
        .unwrap();

    let mut service = service_over(home.conn);

    // Malformed parent linkage must NOT error or panic (D-09).
    let view = service.period_view(Horizon::Month, "2026-06-01").unwrap();
    // The orphan is unreachable from the period root, so it is absent; the real
    // root is present. (Plan 01's walk treats an unreachable orphan as simply not
    // in the working set — no anomaly bump required for unreachability.)
    let titles: Vec<&str> = view.roots.iter().map(|n| n.goal.title.as_str()).collect();
    assert!(titles.contains(&"real-root"));
    assert!(!titles.contains(&"orphan-goal"));
}

// SC3 / T-04-07 (DoS): a parent_id chain DEEPER than MAX_GOAL_DEPTH (65 nodes),
// root anchored to the period. period_view must return Ok with anomaly_count
// bumped and the returned tree depth NOT exceeding the cap. Inserted root-first so
// each row's parent_id FK is satisfied at insert time.
#[test]
fn depth_cap_truncates_persistent() {
    let home = raw_home();

    // Chain of 65 goals: g0 (root at the period) -> g1 -> ... -> g64. 65 > the
    // 64 MAX_GOAL_DEPTH cap, so the deepest link is severed as an anomaly.
    const CHAIN_LEN: usize = 65;
    insert_goal_row(&home.conn, "g0", "g0", "month", "2026-06-01", None);
    for i in 1..CHAIN_LEN {
        let id = format!("g{i}");
        let parent = format!("g{}", i - 1);
        // Finer horizon strings are irrelevant to the CTE seed (only g0 matches
        // the period); the recursive step pulls children by parent_id regardless.
        insert_goal_row(&home.conn, &id, &id, "week", "2026-06-08", Some(&parent));
    }

    let mut service = service_over(home.conn);

    let view = service.period_view(Horizon::Month, "2026-06-01").unwrap();
    assert!(
        view.anomaly_count >= 1,
        "over-depth chain must bump anomaly_count (got {})",
        view.anomaly_count
    );

    // The returned tree depth must not exceed the cap. Measure max depth via the
    // structure-capturing key (depth component).
    let max_depth = tree_keys(&view)
        .iter()
        .map(|(_, depth, _)| *depth)
        .max()
        .unwrap_or(0);
    assert!(
        max_depth < MAX_GOAL_DEPTH,
        "returned tree depth {max_depth} must be bounded by MAX_GOAL_DEPTH {MAX_GOAL_DEPTH}"
    );
}
