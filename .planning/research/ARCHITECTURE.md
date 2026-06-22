# Architecture Research

**Domain:** Hierarchical period-goal planning layer added to an existing clean/hexagonal Rust ToDo engine (`todo-engine`)
**Researched:** 2026-06-22
**Confidence:** HIGH

> Scope note: this is a brownfield, subsequent-milestone architecture question. The answer is derived from reading the existing codebase (`todo-engine/src/**`, `.planning/codebase/*`), not external sources — the existing engine already establishes every pattern the planning layer must reuse. The existing architecture is FIXED; nothing below re-architects it. All file paths are relative to `D:\02_Area\oracle-todo\`.

## Standard Architecture

### System Overview

The planning layer is a *vertical feature slice* layered across the four existing rings. It introduces no new ring, no new mutation path, and (per the PROJECT decision) no new schema column — `(horizon, scheduled)` reuses existing columns and `parent_id` is the nesting edge.

```
┌─────────────────────────────────────────────────────────────────────┐
│                     interfaces/ (thin adapters)                       │
│  cli/{mod,create,views}.rs        api/{mod,handlers,dto}.rs           │
│  goal subcommands + date/period   POST /goals, GET /views/date|period │
│  views render via shared helpers  handlers call the SAME service fns  │
├──────────────────────────────┬───────────────────────────────────────┤
│                application/ (the ONLY mutation path)                  │
│  service/creation.rs   ProposeGoal{horizon,scheduled,parent_id,...}   │
│  service/queries.rs    date_view(...) / period_view(...)  (NEW home)  │
│  service/mod.rs        ensure_parent(...) helper + (horizon,sched)    │
│  ports.rs              ListFilter += parent_id / horizon / scheduled  │
├──────────────────────────────┬───────────────────────────────────────┤
│                       domain/ (pure, no I/O)                          │
│  model.rs   ItemType::Goal + as_str/FromStr arms                     │
│  NEW horizon.rs   Horizon{Year,Month,Week} enum + period validation  │
├──────────────────────────────┬───────────────────────────────────────┤
│                   infrastructure/sqlite/ (rusqlite)                   │
│  schema.rs   additive: NO new column; add indexes on parent_id,      │
│              (type,horizon,scheduled), scheduled                     │
│  mapping.rs  unchanged (horizon/parent_id/scheduled already mapped)  │
├──────────────────────────────┴───────────────────────────────────────┤
│        SQLite source of truth — items + events (todo.sqlite)         │
└─────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Where it lives (file) |
|-----------|----------------|------------------------|
| `Horizon` enum | `Year`/`Month`/`Week`; coarser-than ordering; period-start validation for a given `scheduled` date | NEW `todo-engine/src/domain/horizon.rs` (re-export via `domain/mod.rs`) |
| `ItemType::Goal` | New item-type variant + `as_str`/`FromStr` arms | `todo-engine/src/domain/model.rs` |
| `ProposeGoal` request | Goal creation input (`title`, `horizon`, `scheduled`, `parent_id`, `area`, `description`, `note`, `actor`) | `todo-engine/src/application/service/creation.rs` |
| `propose_goal` policy | Validate `(horizon, scheduled)`, validate `parent_id`, set `horizon`/`scheduled`, route through `store_item_and_event` | `todo-engine/src/application/service/creation.rs` |
| `ensure_parent` helper | Validate a `parent_id` is a Goal of a *coarser* horizon (level-skip allowed), non-terminal | `todo-engine/src/application/service/mod.rs` (`pub(super)`) |
| `date_view` / `period_view` | Group tasks by `scheduled`; roll up goal tree for a week/month/year period | NEW `todo-engine/src/application/service/queries.rs` (extends existing file) |
| `ListFilter` fields | Add `parent_id`, `horizon`, `scheduled` so views can filter at the port | `todo-engine/src/application/ports.rs` |
| Goal CLI + view CLI | `goal` subcommand, `date`/`week`/`month`/`year` views → call service, render Markdown/JSON | `interfaces/cli/{mod,create,views}.rs`, render helpers in `interfaces/cli/markdown.rs` |
| Goal API + view API | `POST /goals`, link via existing update, `GET` view endpoints → call the SAME service methods | `interfaces/api/{mod,handlers,dto}.rs` |

## Recommended Project Structure

Touches existing files in place plus one new domain file. No new directory module is warranted (the planning slice is small and lives inside existing split modules).

```
todo-engine/src/
├── domain/
│   ├── model.rs            # EDIT: ItemType::Goal + as_str/FromStr arms
│   ├── horizon.rs          # NEW: Horizon enum, ordering, period-start validation (PURE)
│   └── mod.rs              # EDIT: pub mod horizon; re-export Horizon
├── application/
│   ├── ports.rs            # EDIT: ListFilter += parent_id/horizon/scheduled; apply_list_filter arms
│   └── service/
│       ├── mod.rs          # EDIT: ensure_parent() pub(super) helper; reuse parse_day
│       ├── creation.rs     # EDIT: ProposeGoal struct + propose_goal()
│       └── queries.rs      # EDIT: date_view()/period_view() returning structured roll-ups
├── infrastructure/sqlite/
│   ├── schema.rs           # EDIT: additive indexes only (NO new column)
│   └── mapping.rs          # (likely unchanged — horizon/parent_id/scheduled already mapped)
└── interfaces/
    ├── cli/
    │   ├── mod.rs          # EDIT: Goal/Date/Period subcommand enums + dispatch
    │   ├── create.rs       # EDIT: goal create handler
    │   ├── views.rs        # EDIT: date/period view handlers
    │   └── markdown.rs     # EDIT: render helpers for grouped/tree output
    └── api/
        ├── mod.rs          # EDIT: routes for goals + view endpoints
        ├── handlers.rs     # EDIT: propose_goal/date_view/period_view handlers
        └── dto.rs          # EDIT: GoalProposeBody, view query structs
```

### Structure Rationale

- **`domain/horizon.rs` (new file):** `Horizon` is pure logic with no I/O — the coarser-than relation and the "is this `scheduled` a valid period start for this horizon?" check belong here, mirroring the existing `domain/recurrence.rs` precedent (pure date logic already lives in domain). Keeping it in domain satisfies the dependency-rule guard (`tests/unit/architecture.rs`).
- **`ItemType::Goal` in the enum (not a new table, not reusing `Project`):** Matches the PROJECT key decision. A new enum variant inherits the entire `items` row shape, the `ItemStatus` lifecycle, approval gating, audit events, and the reserved `horizon` column for free. A separate table would force a parallel mutation path and break the single-`TodoService` invariant.
- **Views in `service/queries.rs` (not in `interfaces`):** This is the single most important placement decision — see the parity concern in Anti-Patterns below. View computation is shared logic; putting it in the service is the only way CLI and API render identical results.
- **`(horizon, scheduled)` reuses existing columns:** No `ALTER TABLE` for a `period_key`; `init_schema()` stays additive by only adding indexes.

## Architectural Patterns

### Pattern 1: New item type as an `ItemType` enum variant + factory reuse

**What:** Add `Goal` to `ItemType`, wire `as_str`/`FromStr`, and construct via the existing `TodoItem::new(id, ItemType::Goal, title, actor, now)` factory (which already applies approval gating: `User` → `Approved`, `Agent` → `Proposed`).
**When to use:** Always for this milestone — it is the decided approach.
**Trade-offs:** (+) zero new lifecycle/audit/approval machinery; (+) `list`/`get`/filters work immediately. (−) the `items` row is wide and most columns stay `NULL` for goals — acceptable, already true for other types.

**Example (domain/model.rs — the four edit sites that must stay in sync):**
```rust
pub enum ItemType { Area, Project, Routine, Task, Event, Review, Goal, ArchiveItem }
// as_str:  ItemType::Goal => "goal",
// FromStr: "goal" => Ok(ItemType::Goal),
```
There is no `ItemType` exhaustiveness compiler guard beyond these two `match`es, so add the arm to both `as_str` and `FromStr` together.

### Pattern 2: Validate relations in the service via an `ensure_*` helper (not in domain)

**What:** The existing service validates relations with `ensure_relation(id, expected_type, label)` (checks type + non-terminal) and `find_area`. Parent-goal validation needs cross-item lookups (fetch the parent, compare horizons), which is I/O — so it belongs in the **service**, not domain. Add `ensure_parent` next to `ensure_relation` in `service/mod.rs`.
**When to use:** Whenever a rule needs to read another row. The *pure* part (horizon A is coarser than horizon B) lives in `domain/horizon.rs`; the *lookup + policy error* part lives in the service.
**Trade-offs:** (+) keeps domain I/O-free and the guard green; (+) consistent with `ensure_relation`. (−) split between two layers, but that split is exactly the clean-architecture boundary.

**Example (service/mod.rs):**
```rust
pub(super) fn ensure_parent(
    &mut self,
    parent_id: Option<String>,
    child_horizon: Horizon,
) -> TodoResult<Option<String>> {
    let Some(parent_id) = parent_id else { return Ok(None) };
    let parent = self.get(&parent_id)?;                       // I/O: service-only
    if parent.item_type != ItemType::Goal {
        return Err(TodoError::Policy(format!("Parent must be goal: {parent_id}")));
    }
    if terminal_status(parent.status) {
        return Err(TodoError::Policy(format!("Parent is terminal: {}", parent.status.as_str())));
    }
    let parent_h = Horizon::from_item(&parent)?;              // PURE parse, domain
    if !parent_h.is_coarser_than(child_horizon) {             // PURE rule, domain
        return Err(TodoError::Policy(format!(
            "Goal parent must be a coarser horizon than {}", child_horizon.as_str())));
    }
    Ok(Some(parent.id))
}
```
A Task linking to a goal reuses this with the task's effective horizon treated as the finest level (any goal horizon is coarser), so the same helper covers Task→goal linking.

### Pattern 3: Period identity = pure validation in domain, applied in service

**What:** `(horizon, scheduled)` is validated by `Horizon::validate_period_start(scheduled: Date)` in `domain/horizon.rs` — e.g. `Month` requires day-of-month == 1; `Year` requires Jan 1; `Week` requires the configured week-start weekday (decide Monday vs Sunday and lock it). `propose_goal` calls `parse_day` (already in `service/mod.rs`) then this validator before constructing the item.
**When to use:** On every goal create and on any update that changes `horizon`/`scheduled`.
**Trade-offs:** (+) one source of truth for "what is a valid period"; (+) testable as pure unit tests in `tests/unit`. (−) requires picking week-start convention now — document it as a locked decision.

### Pattern 4: Views computed in the service, rendered in interfaces (parity by construction)

**What:** Add `date_view(day_or_range) -> Vec<TodoItem>` (tasks grouped by `scheduled`) and `period_view(horizon, scheduled) -> PeriodView` (the goal at `(horizon, scheduled)` plus its descendant goals and their linked tasks) to `service/queries.rs`. Both CLI and API call these identical methods; interfaces only render.
**When to use:** For the date view and all period (week/month/year) views.
**Trade-offs:** (+) CLI/API parity is guaranteed because there is one implementation; (+) e2e `cli`/`api` suites can assert agreement. (−) the roll-up shape (`PeriodView`) is a new return type that both adapters serialize — define it once (in `application`, or as a domain view struct) and reuse.

**Example (service/queries.rs):**
```rust
pub fn date_view(&mut self, day: &str) -> TodoResult<Vec<TodoItem>> {
    let day = parse_day(day)?;
    let tasks = self.list_items(ListFilter { item_type: Some(ItemType::Task), ..Default::default() })?;
    Ok(tasks.into_iter()
        .filter(|t| t.scheduled.as_deref().and_then(parse_scheduled_day) == Some(day))
        .collect())
}
```

## Data Flow

### create-goal

```
CLI `goal --horizon month --scheduled 2026-06-01 [--parent <id>]`  |  POST /goals {horizon,scheduled,parent_id,...}
        ↓ build ProposeGoal
TodoService::propose_goal
   → parse_day(scheduled)                         (service/mod.rs)
   → Horizon::from_str + validate_period_start    (domain/horizon.rs, PURE)
   → find_area(area)                              (existing helper)
   → ensure_parent(parent_id, horizon)            (service/mod.rs → domain rule)
   → TodoItem::new(ItemType::Goal, ..)            (approval gating applied here)
   → set item.horizon / item.scheduled / item.parent_id / item.area_id
   → store_item_and_event(actor,"propose_goal",None,item,None)   ← single mutation path + audit
        ↓
SqliteTodoRepository::save_item_and_event (item row + events row, atomic)
        ↓
render TodoItem as Markdown (CLI) / JSON (API)
```

### link-task → goal

Reuse the existing `update_item` path (`service/update.rs`) by extending `UpdateItem` to accept `parent_id` (and validate it via `ensure_parent` with the task's finest horizon). This avoids a bespoke linking endpoint and keeps the audit `before/after` snapshot for the link change. CLI `update <task> --parent <goal>` and `PATCH`-style update on the API both flow through it.

### date-view

```
CLI `date 2026-06-22`  |  GET /views/date?day=2026-06-22
        ↓
TodoService::date_view("2026-06-22")   (service/queries.rs)
   → list_items(type=Task) → filter scheduled == day → group/sort
        ↓
render grouped Markdown (cli/markdown.rs) / JSON array (api)
```

### period-view (week/month/year roll-up)

```
CLI `month --scheduled 2026-06-01`  |  GET /views/period?horizon=month&scheduled=2026-06-01
        ↓
TodoService::period_view(Horizon::Month, "2026-06-01")   (service/queries.rs)
   → get goal at (horizon, scheduled)
   → walk parent_id tree downward (descendant goals, level-skip aware)
   → attach each goal's linked tasks (parent_id == goal.id)
   → return PeriodView { root_goal, sub_goals, tasks }
        ↓
render tree Markdown / nested JSON
```

**State management:** unchanged — stateless adapters, SQLite is canonical, in-memory store for tests. The new views are read-only and add no state.

### Key Data Flows

1. **Single mutation path preserved:** every goal create/link goes through `store_item_and_event`; no adapter ever touches `SqliteTodoRepository` directly.
2. **Read views never mutate:** `date_view`/`period_view` only `list_items`/`get`. (Note: unlike `today`, they should NOT trigger `materialize_routines` — keep views side-effect-free unless a requirement says otherwise.)

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| Single user (the actual target) | No change needed — fine as-is. |
| Thousands of items | Existing `list_items` loads rows then `apply_list_filter` filters **in memory** (`ports.rs:apply_list_filter`). The period roll-up walking `parent_id` will do repeated `get`/`list` calls. Acceptable at this scale; flag only if item counts grow. |
| Larger | Push `parent_id`/`horizon`/`scheduled` filtering into SQL `WHERE` in `SqliteTodoRepository` (the in-memory filter is a known CONCERNS item) and add the indexes below. Out of scope for this milestone. |

### Scaling Priorities

1. **First bottleneck:** period roll-up doing N+1 `get` calls per goal. Mitigate by loading all goals once (`list_items(type=Goal)`) and building the tree in memory from that single fetch — cheap and avoids N+1.
2. **Second bottleneck:** in-memory `apply_list_filter`. Pre-existing; do not fix here.

**Additive index recommendations (schema.rs, indexes only — no column):**
```sql
CREATE INDEX IF NOT EXISTS idx_items_parent_id ON items(parent_id);
CREATE INDEX IF NOT EXISTS idx_items_scheduled ON items(scheduled);
CREATE INDEX IF NOT EXISTS idx_items_type_horizon_scheduled ON items(type, horizon, scheduled);
```

## Anti-Patterns

### Anti-Pattern 1: Putting view/roll-up logic in `interfaces/cli` (parity drift) — ACTIVE RISK

**What people do:** Follow the existing `today`/`pending` precedent, which computes view logic in `interfaces/cli/markdown.rs` (`today_tasks`, `current_today_items`, `pending_items`) — code the **API does not call**. The API's `list_items` handler re-sorts independently; there is no shared `today`/`pending` service method.
**Why it's wrong:** It silently breaks CLI/API parity for the new views — the milestone explicitly requires parity, and the e2e suites assert it. Copying the `today` pattern would put the new date/period logic where only the CLI can reach it.
**Do this instead:** Put `date_view`/`period_view` in `application/service/queries.rs`. Both `cli/views.rs` and `api/handlers.rs` call the same method; interfaces only render. (Optional but recommended: while adding the new views, also lift the existing `today`/`pending` filtering into the service to close the pre-existing parity gap — but that is a judgment call, not required by this milestone.)

### Anti-Pattern 2: Enforcing the parent-horizon rule inside `domain` (I/O in domain)

**What people do:** Try to validate "parent must be a coarser-horizon goal" in `domain/`, requiring a row lookup.
**Why it's wrong:** Domain must stay I/O-free; `tests/unit/architecture.rs` fails the build on any `application`/`infrastructure`/`rusqlite` reference inside `domain/`.
**Do this instead:** Split it — the *pure* comparison (`Horizon::is_coarser_than`) lives in `domain/horizon.rs`; the *lookup + policy error* lives in `service::ensure_parent`. Mirrors how `ensure_relation` already works.

### Anti-Pattern 3: Adding a `period_key`/new column or a separate goals table

**What people do:** Introduce a dedicated period column or table for "cleanliness."
**Why it's wrong:** Violates the PROJECT decision (`(horizon, scheduled)` reuses existing fields) and either bloats the additive schema or forks the mutation path away from `TodoService`.
**Do this instead:** Use the existing `horizon` (reserved, now first consumed) and `scheduled` columns; identity is the `(horizon, scheduled)` pair, validated in the service.

### Anti-Pattern 4: A bespoke `link_task` mutation that bypasses update/audit

**What people do:** Write a direct `set parent_id` that skips the `before/after` snapshot.
**Why it's wrong:** Loses the audit event and duplicates validation.
**Do this instead:** Extend `UpdateItem`/`update_item` to carry and validate `parent_id`, reusing `ensure_parent` and the existing audit snapshot.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| (none new) | — | Local-first; no new external dependency. Stack stays Rust 2024 / rusqlite / axum 0.7 / clap 4.5. |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| `interfaces` ↔ `application` | Direct method calls on `TodoService` (`propose_goal`, `date_view`, `period_view`, `update_item`) | The ONLY parity-safe seam — both CLI and API call identical methods. |
| `application` ↔ `domain` | `Horizon` enum + pure validators; `ItemType::Goal` | Domain provides rules; service applies them with I/O. |
| `application` ↔ `infrastructure` | `TodoStore` port (`save_item_and_event`, `list_items`, `get_item`) | Unchanged trait surface; views compose existing port calls. New `ListFilter` fields are additive. |
| `infrastructure` ↔ SQLite | rusqlite, additive schema (indexes only) | `init_schema()` stays additive; mapping likely unchanged since columns already exist. |

## Suggested Build Order

Dependency-driven, bottom-up so each layer compiles against a ready layer below; tests follow each step.

1. **Domain** — `ItemType::Goal` (model.rs: enum + `as_str` + `FromStr`) and new `domain/horizon.rs` (`Horizon` enum, `is_coarser_than`, `validate_period_start`, `from_item`/`from_str`). Pure; unit-testable immediately in `tests/unit`. *Guarded by `tests/unit/architecture.rs`.*
2. **Schema (infrastructure)** — additive indexes in `schema.rs` (no column, no mapping change expected). Verify `init_schema` on a temp-home copy.
3. **Service policy (application)** — `ListFilter` fields in `ports.rs` + `apply_list_filter` arms; `ProposeGoal` + `propose_goal` in `creation.rs`; `ensure_parent` in `mod.rs`; extend `UpdateItem`/`update_item` for `parent_id`. Integration tests against the in-memory store.
4. **Views (application)** — `date_view`/`period_view` (+ `PeriodView` return type) in `queries.rs`. Integration tests.
5. **CLI (interfaces)** — `goal` subcommand and `date`/`week`/`month`/`year` view commands in `cli/{mod,create,views}.rs`; render helpers in `cli/markdown.rs`. e2e `cli` tests.
6. **API (interfaces)** — `POST /goals`, view `GET` endpoints, DTOs in `api/{mod,handlers,dto}.rs`, calling the SAME service methods. e2e `api` tests assert parity with CLI/service.

Rationale: domain has no dependencies so it goes first and unblocks everything; schema must exist before the service writes/reads goals; service must exist before either adapter; CLI and API are independent siblings and can be parallelized once the service is done, but build CLI first to validate the service shape, then mirror it in the API.

## Sources

- `D:\02_Area\oracle-todo\todo-engine\src\domain\model.rs` (HIGH — `ItemType`, `TodoItem`, factory + approval gating)
- `D:\02_Area\oracle-todo\todo-engine\src\application\service\mod.rs` (HIGH — `store_item_and_event`, `ensure_relation`, `find_area`, `parse_day`)
- `D:\02_Area\oracle-todo\todo-engine\src\application\service\creation.rs` (HIGH — `Propose*` request + create pattern)
- `D:\02_Area\oracle-todo\todo-engine\src\application\service\queries.rs` (HIGH — list/get/archive; new view home)
- `D:\02_Area\oracle-todo\todo-engine\src\application\service\materialization.rs` (HIGH — list-filter composition precedent)
- `D:\02_Area\oracle-todo\todo-engine\src\application\ports.rs` (HIGH — `ListFilter`, `apply_list_filter` in-memory filtering)
- `D:\02_Area\oracle-todo\todo-engine\src\infrastructure\sqlite\schema.rs` (HIGH — additive schema + index pattern, `horizon` column exists)
- `D:\02_Area\oracle-todo\todo-engine\src\interfaces\cli\markdown.rs` (HIGH — reveals the today/pending parity gap)
- `D:\02_Area\oracle-todo\todo-engine\src\interfaces\api\handlers.rs` (HIGH — `with_service` adapter pattern, independent re-sort)
- `D:\02_Area\oracle-todo\.planning\PROJECT.md` (HIGH — key decisions: Goal as ItemType, `(horizon,scheduled)` identity, flexible nesting)
- `D:\02_Area\oracle-todo\.planning\codebase\{ARCHITECTURE,STRUCTURE,CONVENTIONS}.md` (HIGH — layering, placement, `pub(super)` convention, dependency-rule guard)

---
*Architecture research for: hierarchical period-goal planning layer on a clean/hexagonal Rust engine*
*Researched: 2026-06-22*
