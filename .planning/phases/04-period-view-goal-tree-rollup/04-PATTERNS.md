# Phase 4: Period View (goal-tree rollup) - Pattern Map

**Mapped:** 2026-06-25
**Files analyzed:** 5 (1 new method + 1 new type in queries.rs, repo.rs, ports.rs trait, schema reuse, 1 new test file)
**Analogs found:** 5 / 5 (every building block has an in-tree analog — this phase is reuse-heavy)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `todo-engine/src/application/service/queries.rs` (NEW `period_view` method + `PeriodView`/`GoalNode` types + in-memory tree assembly + SC3 walk) | service (read query) | transform / request-response | same file: `agenda`/`date_range`/`open_tasks`/`sort_date_view`/`iso_day`; walk idiom from `goal.rs` | exact (same file, same layer) |
| `todo-engine/src/infrastructure/sqlite/repo.rs` (NEW `load_period_subtree` recursive-CTE method) | infrastructure (repository) | request-response (indexed read) | `list_items` / `get_item` in same file (`item_select_sql` + `row_to_item` + `params!`) | role-match (new SQL shape, same mapping/error idioms) |
| `todo-engine/src/application/ports.rs` (extend `TodoRepository` trait + maybe new `ListFilter` use) | port (trait) | n/a (interface) | existing `TodoRepository` trait methods + `ListFilter`/`apply_list_filter` | exact |
| `todo-engine/src/infrastructure/sqlite/schema.rs` (REUSE only — no change) | config (schema/index) | n/a | `idx_items_parent_id`, `idx_items_type_horizon_scheduled` (already present) | exact (read-only reuse) |
| `todo-engine/tests/integration/period_view.rs` (NEW) | test (integration) | n/a | `date_view.rs` + `goal_view.rs` (`persistent_service`, parity idiom, goal seed helper) | exact |

## Pattern Assignments

### `todo-engine/src/application/service/queries.rs` — `period_view()` + `PeriodView`/`GoalNode` (service, transform)

**Analog:** the existing date-view methods in the *same file*. Period view is the next read-only query alongside `agenda`/`date_range` — same module, same `impl TodoService`, same side-effect-free contract.

**Imports / module-header pattern** (queries.rs:1-14): reuse these imports; add `std::collections::{HashSet, HashMap}` and `Horizon`/`is_period_start`/`normalize_to_period_start`.
```rust
use super::{ServiceStore, TodoService, parse_day};
use crate::application::error::{TodoError, TodoResult};
use crate::application::ports::{ListFilter, apply_list_filter};
use crate::domain::{ItemStatus, ItemType, TodoItem, terminal_status};
use time::Date;

const OPEN_STATUSES: [ItemStatus; 3] = [   // D-07 task allowlist — REUSE for the task branch
    ItemStatus::Proposed, ItemStatus::Approved, ItemStatus::Active,
];
```

**Read-method shape — store dispatch + side-effect-free** (queries.rs:60-84, the `agenda`/`date_range` template). `period_view` mirrors this: parse/normalize input, load working set ONCE, transform, return. NEVER materialize/write.
```rust
pub fn agenda(&mut self, date: &str) -> TodoResult<Vec<TodoItem>> {
    let day = parse_day(date)?;
    let mut items = self.open_tasks()?;        // <- period_view loads via the new subtree loader instead
    items.retain(|item| iso_day(item.scheduled.as_deref()) == Some(day) || ...);
    sort_date_view(&mut items);
    Ok(items)
}
```

**Store-branch loader** — mirror `list_items` (queries.rs:29-42): match `self.store`; Persistent → new `store.load_period_subtree(...)`; InMemory → compose `list_items(ListFilter{..})` + Rust `parent_id` BFS (D-11).
```rust
pub fn list_items(&mut self, filter: ListFilter) -> TodoResult<Vec<TodoItem>> {
    match &mut self.store {
        ServiceStore::InMemory(items) => { /* clone, sort by created_at->id, apply_list_filter */ }
        ServiceStore::Persistent(store) => store.list_items(filter),
    }
}
```

**Period-key derivation** — do NOT hand-roll month/week math. Use domain helpers (horizon.rs:75-92):
```rust
let day = parse_day(period)?;                          // mod.rs parse_day
let period_key = normalize_to_period_start(day, horizon);  // horizon.rs:75 (ISO-Monday safe)
// match goals by exact string equality on canonical scheduled (Pitfall 1/5)
```

**In-node task sort — REUSE verbatim** (queries.rs:113, D-05). Unscheduled lands LAST, never dropped (VIEW-04):
```rust
fn sort_date_view(items: &mut [TodoItem]) {
    items.sort_by(|left, right| {
        let ka = iso_day(left.scheduled.as_deref());
        let kb = iso_day(right.scheduled.as_deref());
        ka.is_none().cmp(&kb.is_none())
            .then_with(|| ka.cmp(&kb))
            .then_with(|| left.created_at.cmp(&right.created_at))
            .then_with(|| left.id.cmp(&right.id))
    });
}
```
For `child_goals` (D-06) build the same key inline (`iso_day(scheduled)` asc → `created_at` → `id`).

**Unscheduled detection — REUSE** (queries.rs:106). `None`/sentinel/junk → `None`; that just sorts last, never excludes:
```rust
fn iso_day(value: Option<&str>) -> Option<Date> { parse_day(value?.get(..10)?).ok() }
```

**SC3 visited-set + depth-cap walk — REUSE the goal.rs idiom** (goal.rs:11, 81-101). Promote `MAX_GOAL_DEPTH` to `pub(super)` (or re-declare per layers.md `pub(super)` convention). Difference from goal.rs: this walk DESCENDS via `parent_id` index and on cycle/depth/orphan it **bumps `anomaly_count` and severs — NEVER returns `Err`** (D-09 vs goal.rs which returns `Err`):
```rust
const MAX_GOAL_DEPTH: usize = 64;            // goal.rs:11
let mut visited: HashSet<String> = HashSet::new();   // goal.rs:81
let mut depth = 0usize;                              // goal.rs:82
// per node:
if !visited.insert(node.id.clone()) { anomaly_count += 1; /* sever, no recurse */ }  // cf goal.rs:85 (returns Err there)
depth += 1;
if depth > MAX_GOAL_DEPTH { anomaly_count += 1; /* stop descent */ }                  // cf goal.rs:92
```

**Type derives** — match the wire-type convention: `#[derive(Debug, Clone, Serialize, Deserialize)]` on `PeriodView`/`GoalNode` (consumed by CLI/API in Phase 5). Period meta = `horizon` string + normalized `period_key` string + `anomaly_count: usize`.

---

### `todo-engine/src/infrastructure/sqlite/repo.rs` — `load_period_subtree()` (infrastructure, indexed read)

**Analog:** `list_items` / `get_item` (repo.rs:18-40). Same column list (`item_select_sql`), same row mapping (`row_to_item`), same error wrapper (`storage_error`), same `params!` binding. Only the WHERE/CTE differs.

**Query + row-collect skeleton — mirror `list_items`** (repo.rs:29-40), but bind params and use `WITH RECURSIVE`:
```rust
fn list_items(&mut self, filter: ListFilter) -> TodoResult<Vec<TodoItem>> {
    let mut statement = self.conn
        .prepare(item_select_sql("ORDER BY created_at, id").as_str())  // <- reuse item_select_sql
        .map_err(storage_error)?;
    let mut rows = statement.query([]).map_err(storage_error)?;        // <- new method binds [horizon, period_key]
    let mut items = Vec::new();
    while let Some(row) = rows.next().map_err(storage_error)? {
        items.push(row_to_item(row)?);                                 // <- reuse row_to_item verbatim
    }
    Ok(items)   // list_items applies apply_list_filter; the CTE encodes the filter in SQL instead
}
```

**Column list — REUSE `item_select_sql`** (mapping.rs:22-33). Pass a suffix of `WHERE id IN (WITH RECURSIVE subtree(id) AS (...) SELECT id FROM subtree)` so row indices stay aligned with `row_to_item`.

**Recursive CTE (research-recommended shape, bundled SQLite 3.45.3):**
```sql
WITH RECURSIVE subtree(id) AS (
    SELECT id FROM items
    WHERE type = 'goal' AND horizon = ?1 AND scheduled = ?2   -- idx_items_type_horizon_scheduled (schema.rs:85)
    UNION                                                      -- UNION dedups = SQL-level cycle guard
    SELECT i.id FROM items i
    JOIN subtree s ON i.parent_id = s.id                      -- idx_items_parent_id (schema.rs:83)
    WHERE i.type IN ('goal', 'task')
)
```
**Security (V5.3):** bind `?1`/`?2` via `params![horizon, period_key]` — NEVER `format!` the values (repo.rs already fully parameterized; keep it).

**Visibility parity gotcha (Pitfall 4):** `list_items` applies `apply_list_filter` hidden-by-default; the raw CTE does not. Apply the D-07 status predicate (open-only for tasks, all goals) IDENTICALLY in the CTE task branch AND the InMemory loader, or parity breaks.

**Scope fence (D-10):** add a NEW method; do NOT touch `list_items` (repo.rs:29) — global scan rewrite is deferred debt.

---

### `todo-engine/src/application/ports.rs` — extend `TodoRepository` (port trait)

**Analog:** existing `TodoRepository` trait (ports.rs:4-8). Add `fn load_period_subtree(&mut self, horizon: &str, period_key: &str) -> TodoResult<Vec<TodoItem>>;` alongside `list_items`. InMemory and Persistent both implement it.
```rust
pub trait TodoRepository: Send {
    fn save_item(&mut self, item: &TodoItem) -> TodoResult<()>;
    fn get_item(&mut self, id: &str) -> TodoResult<Option<TodoItem>>;
    fn list_items(&mut self, filter: ListFilter) -> TodoResult<Vec<TodoItem>>;
    // NEW: fn load_period_subtree(...) -> TodoResult<Vec<TodoItem>>;
}
```

**InMemory equivalence material — `ListFilter` + `apply_list_filter`** (ports.rs:18-30, 32-98). The InMemory loader composes `ListFilter { item_type, horizon, scheduled, parent_id, .. }` exactly like `open_tasks` (queries.rs:89) and `ensure_goal_not_duplicate` (goal.rs:115) do, then a Rust `parent_id` BFS deduping by id. Note the hidden-by-default branch (ports.rs:39-42) — set `status`/`include_archived` to match whatever the CTE shows.

*Note:* If the planner prefers to keep the subtree walk entirely in `queries.rs` (loading via `list_items` for InMemory and only adding the CTE method for Persistent), the trait may not need extension — the load can branch in `queries.rs` `match self.store`. Planner's call.

---

### `todo-engine/src/infrastructure/sqlite/schema.rs` — REUSE indexes (no change)

Indexes the CTE relies on already exist (schema.rs:83-86). Read-only reuse; additive-schema rule means no edit here.
```sql
CREATE INDEX IF NOT EXISTS idx_items_parent_id ON items(parent_id);              -- recursive JOIN step
CREATE INDEX IF NOT EXISTS idx_items_type_horizon_scheduled ON items(type, horizon, scheduled);  -- CTE seed
```

---

### `todo-engine/tests/integration/period_view.rs` (NEW test)

**Analog:** `date_view.rs` (full file) for `persistent_service`, stable-key parity, side-effect-free; `goal_view.rs:6-15` for the goal-seed helper.

**`persistent_service()` — copy verbatim** (date_view.rs:10-17 == goal_view.rs:20-27; not shared outside e2e):
```rust
fn persistent_service() -> (tempfile::TempDir, TodoService) {
    let dir = tempfile::tempdir().expect("create test home");
    let db_path = dir.path().join("todo.sqlite");
    let conn = connect(db_path.to_str().expect("utf-8 db path")).unwrap();
    init_schema(&conn).unwrap();
    let repo = SqliteTodoRepository::new(conn);
    (dir, TodoService::persistent(repo))
}
```

**Goal seed helper — adapt from goal_view.rs:6-15** (build a year→month→week tree with cross-period children + an unscheduled task; DISTINCT titles as stable keys):
```rust
fn goal(horizon: &str, scheduled: &str, parent_id: Option<&str>) -> ProposeGoal { ProposeGoal {
    title: format!("{horizon} goal {scheduled}"), horizon: horizon.to_string(),
    scheduled: scheduled.to_string(), parent_id: parent_id.map(ToString::to_string),
    actor: Actor::User, note: None,
}}
```

**Parity test — mirror date_view.rs:159-174**, but `keys()` must flatten the NESTED tree to ordered `Vec<(title, depth, kind)>` (date view returns a flat vec; the period tree does not):
```rust
#[test]
fn parity_in_memory_vs_persistent() {
    let mut mem = TodoService::in_memory();
    let (_dir, mut disk) = persistent_service();
    seed_goal_tree(&mut mem); seed_goal_tree(&mut disk);
    let mem_view = mem.period_view(Horizon::Month, "2026-06-01").unwrap();
    let disk_view = disk.period_view(Horizon::Month, "2026-06-01").unwrap();
    assert_eq!(tree_keys(&mem_view), tree_keys(&disk_view));   // (title, depth, kind), NEVER raw id
}
```

**Side-effect-free test — mirror date_view.rs:141-152** (`events().len()` unchanged after the call).

**SC3 anomaly fixture (research Wave-0 gap):** the service rejects cycles at create time (goal.rs:85), so a cyclic/orphan `parent_id` must be injected at the STORE level — write rows directly to the temp SQLite (Persistent) / construct an InMemory map with a back-edge — bypassing `validate_goal_nesting`. Plan must budget a low-level fixture path.

## Shared Patterns

### Side-effect-free read contract
**Source:** queries.rs:60-98 (`agenda`/`date_range`/`open_tasks`).
**Apply to:** `period_view`. No `save_*`, no event write, no materialization. Asserted by the `events().len()` test (date_view.rs:141-152).

### Store-parity via a single shared transform
**Source:** queries.rs:29-42 store dispatch + date_view.rs:159 parity test.
**Apply to:** `period_view` (loader differs per store; the `assemble()` tree-build is the SAME code over the flat vec). This is the only thing the parity test validates after D-10 splits the load paths.

### Visited-set + depth-cap traversal guard
**Source:** goal.rs:11, 81-101 (`MAX_GOAL_DEPTH=64`, `HashSet`).
**Apply to:** the in-memory tree-assembly walk in `queries.rs`. KEEP it even though the SQL `UNION` dedups (InMemory has no SQL guard; SC3 is a locked in-memory invariant). Diverge from the source only in failure mode: bump `anomaly_count`, never `Err` (D-09).

### SQL: reuse column list + row mapping + parameterized binding
**Source:** mapping.rs:22-33 (`item_select_sql`), mapping.rs:35-82 (`row_to_item`), mapping.rs:160-162 (`storage_error`), repo.rs:106 (`params!`).
**Apply to:** `load_period_subtree`. Never string-interpolate user values (V5.3 injection control).

### Period-key derivation (never hand-roll)
**Source:** horizon.rs:75-92 (`normalize_to_period_start`/`is_period_start`).
**Apply to:** `period_view` root matching. ISO-Monday week start can land in the prior year — the helper handles it; re-deriving reintroduces the two-ways-to-bucket bug.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| (the recursive-CTE SQL string itself) | infrastructure | indexed read | First `WITH RECURSIVE` in the engine — no existing CTE analog; structurally modeled on `list_items` + `item_select_sql`, novelty is only the CTE body. Use RESEARCH.md "Pattern 1" sketch. |
| (`tree_keys()` nested-tree flattener in tests) | test util | n/a | date_view `keys()` flattens a flat vec; the period tree is nested → must capture `(title, depth, kind)`, no direct analog. Trivial new helper. |

## Metadata

**Analog search scope:** `todo-engine/src/application/service/`, `todo-engine/src/infrastructure/sqlite/`, `todo-engine/src/application/ports.rs`, `todo-engine/src/domain/horizon.rs`, `todo-engine/tests/integration/`
**Files scanned:** 7 (queries.rs, goal.rs, ports.rs, repo.rs, mapping.rs, horizon.rs, schema.rs, date_view.rs, goal_view.rs)
**Pattern extraction date:** 2026-06-25
