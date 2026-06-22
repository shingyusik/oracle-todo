# Phase 2: Service Policy — Goal Create, Link & Validation - Pattern Map

**Mapped:** 2026-06-22
**Files analyzed:** 8 (3 modify-service, 1 new-service, 1 modify-port, 1 verify-repo, 2 test)
**Analogs found:** 8 / 8 (all in-repo; this is an existing hexagonal codebase)

> **Open Question 1 RESOLVED (was A3 / Q1):** `SqliteTodoRepository::list_items` (repo.rs:29-40)
> loads all rows via `item_select_sql("ORDER BY created_at, id")` then delegates to the SHARED
> `apply_list_filter` (repo.rs:39). It does **NOT** build SQL `WHERE` clauses. Therefore the new
> `ListFilter` fields (`horizon`, `parent_id`, recommended `scheduled`) work for BOTH the in-memory
> and persistent paths the moment they are added to `apply_list_filter` in `ports.rs`. **No SQL/bound-param
> changes are required in repo.rs.** The rusqlite bound-param concern from the security section does not
> apply to filtering (filtering is in Rust); it only governs `save_item_on` writes, which are unchanged.
> Planner action: still add a *persistent* integration test (TestHome/SQLite) for VIEW-01 to prove parity,
> but no repo.rs code task.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/application/service/creation.rs` (MODIFY: add `ProposeGoal` + `propose_goal`) | application-service | request-response / create | `propose_project` same file (creation.rs:40-48, 112-128) | exact |
| `src/application/service/goal.rs` (NEW: `validate_goal_anchor`, `validate_goal_nesting`, duplicate check) | application-service | transform / validation | `ensure_relation` (mod.rs:169-192) + `find_area` (mod.rs:100-108) | role-match |
| `src/application/service/mod.rs` (MODIFY: `mod goal;` + `pub use`) | application-service (wiring) | n/a | existing `mod creation;` line (mod.rs:11-18) | exact |
| `src/application/service/update.rs` (MODIFY: add `parent_id` field + apply block) | application-service | request-response / update | existing `project_id` field+apply (update.rs:17,78-81) | exact |
| `src/application/ports.rs` (MODIFY: `ListFilter` fields + `apply_list_filter` predicates) | application-port | read / filter | existing `project_id` field+predicate (ports.rs:23,52-57) | exact |
| `src/infrastructure/sqlite/repo.rs` (VERIFY ONLY — no change) | infrastructure-repo | read | `list_items` (repo.rs:29-40) reuses `apply_list_filter` | exact (already parametric) |
| `tests/integration/goal_policy.rs` (NEW) + `mod` line in `tests/integration.rs` | test (integration) | policy + audit | `service_policy.rs` (whole file) + dispatcher (integration.rs:3-4) | exact |
| `tests/unit/filter.rs` (MODIFY: extend) | test (unit) | pure filter | existing `type_and_query_filters_select_expected_rows` (filter.rs:40-69) | exact |

## Pattern Assignments

### `src/application/service/creation.rs` — add `ProposeGoal` + `propose_goal` (GOAL-01)

**Analog:** `propose_project` in the same file.

**Request struct pattern** (creation.rs:40-48) — mirror this shape; add `horizon: String`, `scheduled: String`, `parent_id: Option<String>`:
```rust
pub struct ProposeProject {
    pub title: String,
    pub area: Option<String>,
    pub definition_of_done: Option<String>,
    pub outcome: Option<String>,
    pub due: Option<String>,
    pub actor: Actor,
    pub note: Option<String>,
}
```

**Create-method pattern** (creation.rs:112-128) — the exact propose+store skeleton to replicate:
```rust
pub fn propose_project(&mut self, request: ProposeProject) -> TodoResult<TodoItem> {
    let area_id = self.find_area(request.area)?;
    let now = self.next_now();
    let mut item = TodoItem::new(
        self.next_id("project"),
        ItemType::Project,
        request.title,
        request.actor,
        now,
    );
    item.area_id = area_id;
    item.definition_of_done = request.definition_of_done;
    item.outcome = request.outcome;
    item.due = request.due;
    item.note = request.note;
    self.store_item_and_event(item.proposed_by, "propose_project", None, item, None)
}
```

**Replicate as `propose_goal`:** parse `Horizon::from_str(&request.horizon)` (map err → `TodoError::Validation`);
call new helpers `self.validate_goal_anchor(horizon, &request.scheduled)?` → returns canonical string,
`self.validate_goal_nesting(parent_id, horizon)?`, then the duplicate check — ALL before building the item.
Then `TodoItem::new(self.next_id("goal"), ItemType::Goal, request.title, request.actor, now)`,
set `item.horizon = Some(horizon.as_str().to_string())`, `item.scheduled = Some(canonical)`,
`item.parent_id = parent_id`, finally `self.store_item_and_event(item.proposed_by, "propose_goal", None, item, None)`.
Actor→status is FREE (model.rs:102-112, confirmed below). Export via mod.rs `pub use creation::ProposeGoal`.

---

### `src/application/service/goal.rs` (NEW) — anchor/nesting/duplicate helpers (GOAL-03/04/05)

**Analog (nesting/parent-type guard):** `ensure_relation` (mod.rs:169-192) — the canonical type+terminal guard, returns consistent `Policy` messages:
```rust
pub(super) fn ensure_relation(
    &mut self,
    item_id: Option<String>,
    expected: ItemType,
    label: &str,
) -> TodoResult<Option<String>> {
    let Some(item_id) = item_id else { return Ok(None); };
    let item = self.get(&item_id)?;
    if item.item_type != expected {
        return Err(TodoError::Policy(format!("{label} must be {}: {item_id}", expected.as_str())));
    }
    if terminal_status(item.status) {
        return Err(TodoError::Policy(format!("{label} is terminal: {}", item.status.as_str())));
    }
    Ok(Some(item.id))
}
```

**Analog (anchor parse building blocks):** `parse_day` (mod.rs:219-224) returns `TodoError::Validation` on bad date; `is_period_start` (horizon.rs:90-92) is the strict canonical check:
```rust
pub(super) fn parse_day(value: &str) -> TodoResult<Date> {        // mod.rs:219
    let format = parse_format_description("[year]-[month]-[day]")
        .map_err(|error| TodoError::Internal(format!("failed to prepare date parser: {error}")))?;
    Date::parse(value, &format)
        .map_err(|error| TodoError::Validation(format!("Invalid date {value}: {error}")))
}
pub fn is_period_start(date: Date, horizon: Horizon) -> bool {     // horizon.rs:90
    normalize_to_period_start(date, horizon) == date
}
```

**Analog (horizon comparison):** `Horizon::is_coarser_than` (horizon.rs:42-44) — STRICT, equality returns false (exactly the parent rule; do NOT use `<=` or `Ord`, none exists by design horizon.rs:9-17):
```rust
pub fn is_coarser_than(self, other: Horizon) -> bool {
    self.rank() < other.rank()
}
```

**Patterns to replicate (all `pub(super)` on `impl TodoService` in `goal.rs`):**
- `validate_goal_anchor(horizon, scheduled) -> TodoResult<String>`: trim; reject empty and `eq_ignore_ascii_case("today")` with `TodoError::Validation` (SC2); `parse_day` → `is_period_start` strict reject; return canonical string. **Never call `normalize_to_period_start` to silently fix** (Phase 1 lock).
- `validate_goal_nesting(parent_id, child_horizon) -> TodoResult<()>`: `self.get(parent_id)?` (NotFound→404); assert `parent.item_type == Goal` else `Policy`; parse parent horizon; require `parent_h.is_coarser_than(child)` else `Policy`; walk ancestors with `HashSet` visited-set + a named `MAX_GOAL_DEPTH` const (use `constants-config-audit` skill — no magic number).
- duplicate check: `self.list_items(ListFilter { item_type: Some(ItemType::Goal), ..Default::default() })?` then `.iter().any(|g| g.horizon.as_deref()==Some(h) && g.scheduled.as_deref()==Some(canonical) && g.parent_id==parent_id)` → `Policy`. Compare against the CANONICAL string (Pitfall 3).

**Reuse, do not hand-roll:** `find_area` (mod.rs:100-108) shows the `list_items(ListFilter{ item_type, ..Default::default() })`-then-filter idiom the duplicate check copies.

---

### `src/application/service/mod.rs` — module wiring

**Analog (mod + re-export):** mod.rs:11-18:
```rust
mod creation;
mod materialization;
mod queries;
mod transitions;
mod update;

pub use creation::{CreateArea, ProposeEvent, ProposeProject, ProposeRoutine, ProposeTask};
pub use update::UpdateItem;
```
**Replicate:** add `mod goal;` (alphabetical, after `creation`) and add `ProposeGoal` to the `creation::{...}` re-export.

---

### `src/application/service/update.rs` — add `parent_id` (LINK-01/02)

**Analog (struct field + apply block):** the existing `project_id` field and its apply block already route through `ensure_relation` and the audited path.

Field (update.rs:17), in struct `UpdateItem`:
```rust
pub project_id: Option<String>,
```
Apply block (update.rs:78-81):
```rust
if let Some(project_id) = request.project_id {
    item.project_id = self.ensure_relation(Some(project_id), ItemType::Project, "Project")?;
}
```
`scheduled` apply already exists (update.rs:89-91) — LINK-02 needs NO new code, only a test:
```rust
if let Some(scheduled) = request.scheduled {
    item.scheduled = Some(scheduled);
}
```
**Replicate for `parent_id`:** add `pub parent_id: Option<String>,` to `UpdateItem` (struct is `#[derive(Default)]`, additive). Add an apply block that validates the parent is a non-terminal `Goal` via `ensure_relation(Some(parent_id), ItemType::Goal, "Goal parent")?` before `item.parent_id = ...`. The whole `update_item` path already calls `store_item_and_event` (update.rs:98-104) with action `"update_item"` — audit is automatic (CORE-01 satisfied).

---

### `src/application/ports.rs` — `ListFilter` + `apply_list_filter` (VIEW-01)

**Analog (field + predicate):** the `project_id` field (ports.rs:23) and its predicate (ports.rs:52-57):
```rust
pub project_id: Option<String>,                 // in ListFilter (struct is #[derive(Default)])
// ...in apply_list_filter:
.filter(|item| {
    filter
        .project_id
        .as_ref()
        .is_none_or(|project_id| item.project_id.as_ref() == Some(project_id))
})
```
**Replicate:** add `pub horizon: Option<String>,` and `pub parent_id: Option<String>,` (and per A2, recommended `pub scheduled: Option<String>,` so "period" = exact `(horizon, scheduled)`) to `ListFilter`, and one `.filter(...)` predicate each mirroring the `project_id` predicate against `item.horizon` / `item.parent_id` / `item.scheduled` (all `Option<String>` on `TodoItem`). Because `repo.rs::list_items` (repo.rs:39) and `queries.rs::list_items` (queries.rs:28) BOTH delegate to `apply_list_filter`, this single edit covers in-memory AND persistent paths.

---

### `src/infrastructure/sqlite/repo.rs` — VERIFY ONLY, no change

**Analog = the file itself** (repo.rs:29-40). Confirmed it reuses the shared `apply_list_filter`:
```rust
fn list_items(&mut self, filter: ListFilter) -> TodoResult<Vec<TodoItem>> {
    let mut statement = self.conn
        .prepare(item_select_sql("ORDER BY created_at, id").as_str()).map_err(storage_error)?;
    let mut rows = statement.query([]).map_err(storage_error)?;
    let mut items = Vec::new();
    while let Some(row) = rows.next().map_err(storage_error)? {
        items.push(row_to_item(row)?);
    }
    Ok(apply_list_filter(items, filter))   // <-- new fields work for free
}
```
No code task. (Full-table-scan debt is acknowledged for Phase 4, not here.) Writes use bound `params` (`save_item_on`, repo.rs:59-74) and already persist `parent_id`/`scheduled`/`horizon` columns — no schema change.

---

### `tests/integration/goal_policy.rs` (NEW) + dispatcher line

**Analog (test harness + assertion style):** `service_policy.rs` (whole file). Construction + status + error-equality patterns:
```rust
use todo_engine::application::error::TodoError;
use todo_engine::application::service::{/* ProposeGoal, */ TodoService, UpdateItem};
use todo_engine::domain::{Actor, ItemStatus, ItemType};

let mut service = TodoService::in_memory();
let item = service.propose_task("...", Default::default()).unwrap();
assert_eq!(item.status, ItemStatus::Proposed);              // SC1 agent→Proposed
let error = service.activate(&item.id, None).unwrap_err();  // error-equality idiom
assert_eq!(error, TodoError::Policy("...".to_string()));
```
**Dispatcher line (Pitfall 5):** `tests/integration.rs` uses `#[path=...]` + `mod`:
```rust
#[path = "integration/goal_roundtrip.rs"]
mod goal_roundtrip;
```
Add (alphabetical, after `goal_roundtrip`):
```rust
#[path = "integration/goal_policy.rs"]
mod goal_policy;
```
> Note: alphabetically `goal_policy` sorts BEFORE `goal_roundtrip`. Place it before the existing `goal_roundtrip` block to keep the list ordered.

**Persistent-store test (VIEW-01 parity, A3):** use `TestHome` (tests/support/mod.rs) — `TestHome::new()` + `db_path()` give a temp SQLite home so VIEW-01 is proven against the persistent path, not just in-memory.

Cover: SC1 (agent→Proposed/user→Approved + `service.events().last().action == "propose_goal"`), SC2 (`today`/unparseable/non-canonical → `Validation`), SC3a (cycle + inversion → `Policy`), SC3b (duplicate → `Policy`), SC4 (`update_item{ parent_id, scheduled }` sets fields + emits `update_item` event; non-Goal/terminal parent → `Policy`).

---

### `tests/unit/filter.rs` (MODIFY) — extend for new predicates

**Analog:** `type_and_query_filters_select_expected_rows` (filter.rs:40-69) and the `item(...)` helper (filter.rs:8-12):
```rust
fn item(id: &str, item_type: ItemType, status: ItemStatus) -> TodoItem {
    let mut i = TodoItem::new(id, item_type, id, Actor::User, NOW);
    i.status = status;
    i
}
let projects = apply_list_filter(items.clone(), ListFilter {
    item_type: Some(ItemType::Project),
    ..ListFilter::default()
});
assert_eq!(projects.iter().map(|i| i.id.as_str()).collect::<Vec<_>>(), ["p"]);
```
**Replicate:** build goals with `.horizon`/`.scheduled`/`.parent_id` set, then assert `apply_list_filter` with `ListFilter { horizon: Some(..), .. }` (and `parent_id`, `scheduled`) selects the expected rows. No new dispatcher line needed (`filter.rs` already registered in `tests/unit.rs`).

## Shared Patterns

### Audited mutation (CORE-01 — apply to EVERY new write path)
**Source:** `store_item_and_event` (mod.rs:110-139).
```rust
self.store_item_and_event(item.proposed_by, "propose_goal", None, item, None)  // create
self.store_item_and_event(Actor::User, "update_item", before, item, reason)    // update
```
Never call `store.save_item` / `save_item_on` directly from a goal path. This single helper builds the `TodoEvent` and persists item+event atomically (persistent path: `save_item_and_event` transaction, repo.rs:49-56).

### Actor-driven status (apply to `propose_goal` — SC1 is free)
**Source:** `TodoItem::new` (model.rs:102-112). Passing `request.actor` into `new` derives Proposed (agent) vs Approved (user) and sets `approved_by`/`approved_at`. No goal-specific status branch.
```rust
let approved = actor == Actor::User;
status: if approved { ItemStatus::Approved } else { ItemStatus::Proposed },
```

### Error variant reuse (no new variant — apply everywhere)
**Source:** `error.rs` (Validation/Policy both map to CLI 2 / HTTP 400). Anchor parse/canonical → `TodoError::Validation`; nesting/inversion/duplicate/parent-type → `TodoError::Policy`. Adding a variant is non-additive churn.

### Goal field surface (apply to create/link/filter)
**Source:** `TodoItem` (model.rs:116,128,129). `parent_id`, `scheduled`, `horizon` already exist as `Option<String>` (horizon stored as its lowercase string via `Horizon::as_str`). No model change — purely setting existing fields.

### Read-primitive delegation (apply to VIEW-01)
**Source:** `queries.rs:28` (in-memory) and `repo.rs:39` (persistent) both call `apply_list_filter`. One edit in `ports.rs` covers both stores.

## No Analog Found

None. Every file has a direct in-repo analog (this is an established hexagonal codebase; Phase 2 is composition of verified Phase-1 primitives + additive struct fields).

## Metadata

**Analog search scope:** `todo-engine/src/{domain,application,infrastructure}/`, `todo-engine/tests/{integration,unit,support}/`
**Files scanned (read this pass):** creation.rs, update.rs, ports.rs, queries.rs, horizon.rs, model.rs, service/mod.rs, repo.rs, service_policy.rs, unit/filter.rs, support/mod.rs, integration.rs
**Key resolution:** Open Question 1 (repo.rs::list_items mechanism) confirmed — Rust-side `apply_list_filter`, no SQL WHERE; new filter fields require zero repo.rs changes.
**Convention honored:** `pub(super)` for new `goal.rs` helpers; string parsing stays in service (not `horizon.rs`); inward dependency rule intact.
**Pattern extraction date:** 2026-06-22

## PATTERN MAPPING COMPLETE

**Phase:** 2 - Service Policy — Goal Create, Link & Validation
**Files classified:** 8
**Analogs found:** 8 / 8

### Coverage
- Files with exact analog: 7
- Files with role-match analog: 1 (new `goal.rs` — composes `ensure_relation` + `parse_day`/`is_period_start` + `find_area` idioms)
- Files with no analog: 0

### Key Patterns Identified
- All creates mirror `propose_project` (validate → `TodoItem::new` actor-status → set fields → `store_item_and_event`); status is free from `TodoItem::new`.
- Both `list_items` paths (in-memory queries.rs:28 and persistent repo.rs:39) delegate to the single `apply_list_filter` — VIEW-01 is ONE edit in ports.rs; repo.rs needs NO change (Open Question 1 resolved).
- Additive struct-field pattern (`UpdateItem.parent_id`, `ListFilter.horizon/parent_id/scheduled`) mirrors existing `project_id` field+apply/predicate; type guards reuse `ensure_relation`; errors reuse `Validation`/`Policy`.

### File Created
`.planning/phases/02-service-policy-goal-create-link-validation/02-PATTERNS.md`

### Ready for Planning
Pattern mapping complete. Planner can reference exact analog files and line ranges in each PLAN.md `read_first`/`action` field. Confirmed: no repo.rs code task (verify-only); add a persistent (TestHome) integration test for VIEW-01 parity.
