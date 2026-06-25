---
phase: 04-period-view-goal-tree-rollup
plan: 01
subsystem: api
tags: [period-view, goal-tree, rollup, serde, in-memory, rust]

# Dependency graph
requires:
  - phase: 02-goal-model
    provides: "Goal ItemType, (horizon, scheduled) anchor, parent_id nesting, ListFilter horizon/parent_id/scheduled predicates"
  - phase: 03-date-view
    provides: "queries.rs read-query module, OPEN_STATUSES allowlist, iso_day/sort_date_view helpers, side-effect-free read shape"
provides:
  - "Shared serde-serializable PeriodView/GoalNode nested tree type (queries.rs)"
  - "TodoService::period_view(horizon, period) over the InMemory store"
  - "Store-agnostic assemble() tree-build with visited-set + MAX_GOAL_DEPTH cap + anomaly count (SC3/D-09)"
  - "InMemory load_period_subtree_in_memory loader composing list_items"
  - "MAX_GOAL_DEPTH promoted to pub(super) for shared reuse"
  - "tree_keys/seed_goal_tree/goal/open_task test helpers reusable by Plan 03 parity"
affects: [04-02-persistent-cte-loader, 04-03-parity-anomaly-tests, period-view-cli, period-view-api]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Single shared assemble() walk fed by both stores; loaders diverge only in producing the flat working set (D-01)"
    - "Descent guard mirrors goal.rs ancestor walk but DESCENDS and NEVER Errs — anomalies counted, not thrown"

key-files:
  created:
    - todo-engine/tests/integration/period_view.rs
  modified:
    - todo-engine/src/application/service/queries.rs
    - todo-engine/src/application/service/goal.rs
    - todo-engine/src/application/service/mod.rs
    - todo-engine/tests/integration.rs

key-decisions:
  - "D-07 status policy: terminal GOALS are kept and traversed THROUGH (ADR-0006 no-cascade lets a live child outlive a terminal parent); TASKS filtered to OPEN_STATUSES only"
  - "period_view(horizon, period) accepts ANY in-period date and normalizes via normalize_to_period_start — caller never passes the canonical start"
  - "Two roots at the same (horizon, scheduled) require distinct parent_id (GOAL-05 forbids duplicate top-level identity); test seeds one top-level + one nested-under-year root"
  - "Persistent loader arm is exactly unimplemented!(\"Plan 02: persistent CTE loader\") — the single stub form Plan 02 Task 2 removes"

patterns-established:
  - "Nested-tree stable key tree_keys() -> Vec<(title, depth, kind)> for structure assertions and Plan 03 parity"
  - "assemble() partitions flat working set by item_type, indexes by parent_id (goals_by_parent keyed Option<String>, tasks_by_parent keyed String)"

requirements-completed: [VIEW-03, VIEW-04]

# Metrics
duration: 18min
completed: 2026-06-25
---

# Phase 4 Plan 01: Period-View Core (PeriodView/GoalNode + period_view + InMemory) Summary

**Store-agnostic `PeriodView`/`GoalNode` nested tree plus `period_view(horizon, period)` and a shared `assemble()` walk (visited-set + depth-cap + anomaly count) proven against the InMemory store; persistent loader stubbed for Plan 02.**

## Performance

- **Duration:** ~18 min
- **Started:** 2026-06-25T02:59Z
- **Completed:** 2026-06-25
- **Tasks:** 2
- **Files modified:** 5 (1 created, 4 modified)

## Accomplishments
- Defined the single shared `#[derive(Debug, Clone, Serialize, Deserialize)]` `PeriodView` + `GoalNode` nested type in `queries.rs` with `child_goals`/`tasks` as SEPARATE vecs (D-01/D-01a).
- Added `TodoService::period_view(&mut self, horizon: Horizon, period: &str) -> TodoResult<PeriodView>`: normalizes any in-period date via `normalize_to_period_start`, loads the working set once, runs the shared `assemble()`, and is side-effect-free (no save/event/materialization).
- Built the store-agnostic `assemble()` tree-walk: roots = exact `(horizon, period_key)` matches (D-02), descent follows `parent_id` across periods (D-03), tasks sorted with unscheduled last (D-05), child goals scheduled-asc (D-06); a `visited` set + reused `MAX_GOAL_DEPTH` cap sever cycle/over-depth branches into `anomaly_count` and never `Err` (SC3/D-09).
- Implemented the InMemory `load_period_subtree_in_memory` loader composing `list_items`; promoted `MAX_GOAL_DEPTH` to `pub(super)` in `goal.rs` so it is the single source of truth.
- Locked in-memory behavior with 7 passing integration tests and reusable `tree_keys`/`seed_goal_tree` helpers for Plan 03.

## Task Commits

Each task was committed atomically:

1. **Task 1: PeriodView/GoalNode type + period_view + assemble() + InMemory loader** - `0be1b25` (feat)
2. **Task 2: In-memory integration tests + PeriodView/GoalNode re-export** - `99705d6` (test)

**Plan metadata:** (final docs commit follows)

## Files Created/Modified
- `todo-engine/src/application/service/queries.rs` - PeriodView/GoalNode types, `period_view()`, `assemble()`/`build_node()`/`sort_child_goals()`/`format_iso_day()` helpers, InMemory loader.
- `todo-engine/src/application/service/goal.rs` - `MAX_GOAL_DEPTH` promoted to `pub(super)`.
- `todo-engine/src/application/service/mod.rs` - re-export `PeriodView`/`GoalNode`.
- `todo-engine/tests/integration/period_view.rs` - new: 7 in-memory period-view tests + helpers.
- `todo-engine/tests/integration.rs` - registered `period_view` module.

## Decisions Made
- **D-07 status policy (per plan output requirement):** terminal goals are KEPT in the tree and TRAVERSED THROUGH (ADR-0006 no-cascade — a live child can outlive a terminal parent); tasks are narrowed to `OPEN_STATUSES`. The InMemory loader loads goals with `include_archived: true` (NOT relying on `list_items` hidden-by-default) so the set is deterministic and the Plan 02 CTE must apply the IDENTICAL predicate.
- **Final field names:** `PeriodView { horizon: String, period_key: String, roots: Vec<GoalNode>, anomaly_count: usize }`; `GoalNode { goal: TodoItem, child_goals: Vec<GoalNode>, tasks: Vec<TodoItem> }`.
- **period_view signature:** `pub fn period_view(&mut self, horizon: Horizon, period: &str) -> TodoResult<PeriodView>` — accepts any in-period date, normalizes internally.
- **Persistent loader:** `unimplemented!("Plan 02: persistent CTE loader")` — exact stub form Plan 02 removes (no `todo!()`, no `TodoError`).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Two-root test seed adjusted for GOAL-05 duplicate-identity rule**
- **Found during:** Task 2 (in-memory integration tests)
- **Issue:** The plan asked for "a SECOND month goal at 2026-06-01 (sibling root)". Seeding two top-level goals at `(month, 2026-06-01, None)` is rejected by `ensure_goal_not_duplicate` (GOAL-05: identical `(horizon, scheduled, parent_id)` triple, both `parent_id = None`).
- **Fix:** Made the second month root a child of the year goal (`parent_id = year.id`), giving it a distinct identity triple while still anchoring to `(month, 2026-06-01)` so it remains a root by D-02. The year goal doubles as the coarser-ancestor-not-a-root assertion.
- **Files modified:** `todo-engine/tests/integration/period_view.rs`
- **Verification:** `cargo test --test integration period_view` — all 7 tests pass.
- **Committed in:** `99705d6` (Task 2 commit)

**2. [Rule 3 - Blocking] Added `pub use queries::{GoalNode, PeriodView}` re-export**
- **Found during:** Task 2 (tests reference `todo_engine::application::service::PeriodView`)
- **Issue:** `queries` is a private module in `service/mod.rs`; the new public structs were not reachable from the integration test crate.
- **Fix:** Added `pub use queries::{GoalNode, PeriodView};` alongside the existing `creation`/`update` re-exports.
- **Files modified:** `todo-engine/src/application/service/mod.rs`
- **Verification:** Tests compile and pass; `cargo clippy -- -D warnings` clean.
- **Committed in:** `99705d6` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 3 - blocking). Both necessary to make the planned tests compile/pass; no scope creep.

## Issues Encountered
- **Out-of-scope pre-existing e2e failure:** `cli::init_loads_todo_engine_home_from_dotenv` fails (dotenv `TODO_ENGINE_HOME` not honored; resolves default home). It lives entirely in the CLI/dotenv/data-home path — untouched by this plan — and the test predates this work (present unchanged at commit `7faa001`). NOT fixed (out of scope per SCOPE BOUNDARY); logged to `.planning/phases/04-period-view-goal-tree-rollup/deferred-items.md`. All integration tests (including the 7 new period-view tests) pass.

## Known Stubs

| Stub | File | Line | Reason |
|------|------|------|--------|
| `unimplemented!("Plan 02: persistent CTE loader")` | `todo-engine/src/application/service/queries.rs` | period_view Persistent arm | Intentional — the persistent working-set loader is Plan 02's deliverable. No Plan 01 test exercises the Persistent path, so InMemory + all 04-01 tests pass. Plan 02 Task 2 removes this exact stub and must apply the identical D-07 status predicate in the SQL CTE. |

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- The shared `PeriodView`/`GoalNode` type and `assemble()` walk are LOCKED — Plan 02's SQL CTE loader only needs to produce the same flat working set (goals: terminal kept; tasks: OPEN_STATUSES) for the shared assembler.
- Plan 02 must replace `unimplemented!("Plan 02: persistent CTE loader")` and apply the IDENTICAL D-07 status predicate in the CTE.
- Plan 03 reuses `tree_keys`/`seed_goal_tree` for parity and owns the true store-level over-depth/cyclic anomaly fixtures (deferred from `depth_cap_truncates` because the validating service API cannot build a >64 / cyclic chain).

---
*Phase: 04-period-view-goal-tree-rollup*
*Completed: 2026-06-25*

## Self-Check: PASSED

- FOUND: `todo-engine/tests/integration/period_view.rs`
- FOUND: `.planning/phases/04-period-view-goal-tree-rollup/04-01-SUMMARY.md`
- FOUND commit: `0be1b25` (Task 1)
- FOUND commit: `99705d6` (Task 2)
- `cargo build` + `cargo clippy --all-targets --all-features -- -D warnings`: clean
- `cargo test --test integration period_view`: 7/7 pass
- One out-of-scope pre-existing e2e failure (`cli::init_loads_todo_engine_home_from_dotenv`) logged to deferred-items.md; not a regression.
