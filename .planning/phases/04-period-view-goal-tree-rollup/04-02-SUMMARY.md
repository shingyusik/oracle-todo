---
phase: 04-period-view-goal-tree-rollup
plan: 02
subsystem: infrastructure
tags: [period-view, goal-tree, recursive-cte, sqlite, indexed-read, rust]

# Dependency graph
requires:
  - phase: 04-period-view-goal-tree-rollup
    plan: 01
    provides: "PeriodView/GoalNode type, period_view(), shared assemble() walk, InMemory loader, OPEN_STATUSES policy, MAX_GOAL_DEPTH cap, Persistent stub to replace"
  - phase: 01
    provides: "idx_items_type_horizon_scheduled + idx_items_parent_id indexes the CTE relies on"
provides:
  - "TodoRepository::load_period_subtree(horizon, period_key) trait method (ports.rs)"
  - "SqliteTodoRepository::load_period_subtree — single indexed WITH RECURSIVE CTE returning the flat working set (repo.rs)"
  - "OPEN_STATUSES promoted to domain/status.rs as the single cross-ring source of truth"
  - "Persistent arm of period_view wired to load_period_subtree (queries.rs)"
affects: [04-03-parity-anomaly-tests, period-view-cli, period-view-api]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "SQL-pushdown working-set load via WITH RECURSIVE over parent_id (D-10) — seed indexed by idx_items_type_horizon_scheduled, recursion by idx_items_parent_id; replaces list_items scan for this read only"
    - "Status IN(...) placeholder list GENERATED from OPEN_STATUSES so the Persistent and InMemory loaders share one open-status definition (no literal drift)"
    - "UNION (deduplicating) recursive CTE as the SQL-level cycle guard for legacy parent_id back-edges"

key-files:
  created: []
  modified:
    - todo-engine/src/domain/status.rs
    - todo-engine/src/domain/mod.rs
    - todo-engine/src/application/ports.rs
    - todo-engine/src/application/service/queries.rs
    - todo-engine/src/infrastructure/sqlite/repo.rs

key-decisions:
  - "Chose option (a): promote OPEN_STATUSES to domain/status.rs (single definition) and re-export it, so both queries.rs (application ring) and repo.rs (infrastructure ring) source it without an inward-dependency violation"
  - "CTE applies the asymmetric D-07 predicate: goals at ANY status (terminal kept + traversed), tasks restricted to OPEN_STATUSES, tasks NOT filtered by scheduled (unscheduled survive, VIEW-04)"
  - "UNION (not UNION ALL) is the SQL-level cycle guard; the in-memory assemble() visited-set + MAX_GOAL_DEPTH remains the locked SC3 guard on top"
  - "load_period_subtree takes horizon as &str (Persistent arm passes horizon.as_str()); all inputs bound as params (?1/?2 + status placeholders), no string interpolation (V5.3/T-04-04)"

requirements-completed: [VIEW-03, VIEW-04]

# Metrics
duration: 12min
completed: 2026-06-25
---

# Phase 4 Plan 02: Persistent Recursive-CTE Loader Summary

**The D-10 SQL-pushdown load path: a single indexed `WITH RECURSIVE` CTE (`load_period_subtree`) that returns the period-view working set from SQLite, applying the IDENTICAL D-07 visibility predicate as the InMemory loader (derived from one shared `OPEN_STATUSES`), wired into the Persistent arm of `period_view`.**

## Performance

- **Duration:** ~12 min
- **Completed:** 2026-06-25
- **Tasks:** 2
- **Files modified:** 5 (0 created, 5 modified)

## Accomplishments

- Promoted `OPEN_STATUSES` from `queries.rs` to `domain/status.rs` as a single `pub const` source of truth, re-exported from `domain/mod.rs`. After this plan there is exactly ONE definition of the open-status set; both the application-ring InMemory loader and the infrastructure-ring CTE loader derive their task-status predicate from it.
- Added `TodoRepository::load_period_subtree(&mut self, horizon: &str, period_key: &str) -> TodoResult<Vec<TodoItem>>` to the trait (ports.rs) — the Persistent loader lives in the infrastructure ring where SQL belongs. `ServiceStore::InMemory` is reached directly in `queries.rs` and does NOT implement the trait, so no InMemory trait impl is required.
- Implemented `SqliteTodoRepository::load_period_subtree` (repo.rs) using one `WITH RECURSIVE` CTE: seed selects root goals at `(horizon, period_key)` (exercises `idx_items_type_horizon_scheduled`); the recursive step joins `parent_id` (exercises `idx_items_parent_id`). Built via `item_select_sql(suffix)` so the column list / `row_to_item` indices stay aligned.
- Wired the Persistent arm of `period_view` to call `store.load_period_subtree(horizon.as_str(), &period_key)`, removing the exact Plan 01 stub `unimplemented!("Plan 02: persistent CTE loader")`. Both store arms now feed the same single `assemble()` call site (D-11).

## Final CTE SQL Shape

The statement is `item_select_sql(suffix)` where the suffix is:

```sql
WHERE id IN (
    WITH RECURSIVE subtree(id) AS (
        SELECT id FROM items
        WHERE type = 'goal' AND horizon = ?1 AND scheduled = ?2
        UNION
        SELECT i.id FROM items i
        JOIN subtree s ON i.parent_id = s.id
        WHERE i.type IN ('goal', 'task')
    )
    SELECT id FROM subtree
)
AND (type = 'goal' OR (type = 'task' AND status IN (?3, ?4, ?5)))
```

- **Seed:** `type = 'goal' AND horizon = ?1 AND scheduled = ?2` → indexed by `idx_items_type_horizon_scheduled`.
- **Recursion:** `JOIN subtree s ON i.parent_id = s.id WHERE i.type IN ('goal','task')` → indexed by `idx_items_parent_id`.
- **Dedup:** `UNION` (NOT `UNION ALL`) collapses the reachable id set — the SQL-level cycle guard for legacy `parent_id` back-edges (T-04-05). The in-memory `assemble()` visited-set + `MAX_GOAL_DEPTH` remains the SC3 guard on top.

## D-07 Status Predicate — How It Is Expressed in SQL (and parity)

The outer `WHERE` applies the **asymmetric** D-07 predicate:
`(type = 'goal' OR (type = 'task' AND status IN (<placeholders>)))`.

- **Goals:** kept at ANY status (terminal goals stay in the structure AND are traversed so a live grandchild can outlive a terminal parent — ADR-0006). Goals are NOT status-filtered.
- **Tasks:** restricted to `OPEN_STATUSES`. The `?3, ?4, ?5` placeholder list is **generated from `OPEN_STATUSES.len()`**, and the status strings (`ItemStatus::as_str`) are appended to the bound params. There is NO hand-typed `'proposed','approved','active'` literal in `repo.rs`.
- **Scheduled:** tasks are NOT filtered by `scheduled` — unscheduled tasks survive (VIEW-04).

This is byte-equivalent in intent to the InMemory loader (`load_period_subtree_in_memory`): both load all goals (terminal kept) and narrow tasks to `OPEN_STATUSES`, sourced from the same constant. Adding/removing an open status in `domain/status.rs` updates both loaders in lockstep — the drift the Plan 03 parity test exists to catch cannot occur.

## D-10 Fence Confirmation

- `list_items` (repo.rs) is **unchanged** — `load_period_subtree` is a NEW method only.
- `schema.rs` is **unchanged** (`git diff --stat HEAD~2 HEAD -- schema.rs` empty) — indexes already existed (additive-only rule).
- No new packages installed (RESEARCH Package Legitimacy Audit: none).

## `load_period_subtree` Trait Signature (for Plan 03 tests)

```rust
fn load_period_subtree(
    &mut self,
    horizon: &str,
    period_key: &str,
) -> TodoResult<Vec<TodoItem>>;
```

Reachable on the boxed `dyn TodoStore` via the `TodoRepository` supertrait. Returns the flat working set (goals + open tasks) feeding the shared `assemble()`.

## Task Commits

1. **Task 1: Add `load_period_subtree` trait method + SQLite recursive-CTE impl + promote `OPEN_STATUSES` to domain** — `2133220` (feat)
2. **Task 2: Wire Persistent arm of `period_view` to `load_period_subtree`** — `23f528d` (feat)

## Decisions Made

- **Single open-status definition (option a):** `OPEN_STATUSES` moved to `domain/status.rs` (`pub const`) + re-exported. This keeps the infrastructure ring (`repo.rs`) sourcing it without depending inward on the application ring — the dependency points into `domain`, which both rings already depend on.
- **`horizon: &str` signature:** the trait method takes `&str` (Persistent arm passes `horizon.as_str()`), matching the SQL bind shape and avoiding a domain-enum dependency in the bind path.
- **Asymmetric predicate placement:** applied in the OUTER `WHERE` (not inside the CTE) so the recursive walk still traverses THROUGH terminal goals to reach live descendants, then the final projection drops only closed tasks.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Reworded a doc comment to avoid a false-positive acceptance grep**
- **Found during:** Task 1 verification.
- **Issue:** The acceptance check `grep -c 'UNION ALL' repo.rs` must return 0, but a doc comment originally read "`UNION` (not `UNION ALL`)", which the literal grep counted as a `UNION ALL` occurrence even though the SQL uses bare `UNION`.
- **Fix:** Reworded the comment to "a deduplicating `UNION` (never the appending variant)" — the SQL is unchanged and still uses bare `UNION`.
- **Files modified:** `todo-engine/src/infrastructure/sqlite/repo.rs`
- **Verification:** `grep -c 'UNION ALL' repo.rs` → 0; `grep -c 'WITH RECURSIVE' repo.rs` ≥ 1.
- **Committed in:** `2133220` (Task 1 commit)

**2. [Rule 3 - Blocking] Added `#[cfg(doc)] use crate::domain::OPEN_STATUSES` to ports.rs**
- **Found during:** Task 1 (intra-doc link `[OPEN_STATUSES]` in the new trait doc comment).
- **Issue:** The doc comment references `[OPEN_STATUSES]` for the rustdoc link, but `ports.rs` did not import it; an unused runtime import would also trip clippy.
- **Fix:** Added a `#[cfg(doc)]`-gated import so the link resolves under rustdoc without an unused-import warning at build time.
- **Files modified:** `todo-engine/src/application/ports.rs`
- **Verification:** `cargo build` + `cargo clippy --all-targets --all-features -- -D warnings` clean.
- **Committed in:** `2133220` (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 3 - blocking). No scope creep; `list_items`/`schema.rs` untouched.

## Issues Encountered

- **Out-of-scope pre-existing e2e failure:** `cli::init_loads_todo_engine_home_from_dotenv` fails (dotenv `TODO_ENGINE_HOME` not honored). This lives entirely in the CLI/dotenv/data-home path, predates this plan (already logged in `deferred-items.md` from Plan 01), and is untouched here. NOT a regression. All integration tests including the 7 period-view tests pass; full suite: 29/30 in the e2e binary (the 1 failure is this pre-existing one).

## Known Stubs

None — the Plan 01 `unimplemented!("Plan 02: persistent CTE loader")` stub was the sole deliverable target and is now replaced by the real CTE loader.

## Next Phase Readiness

- The Persistent loader produces the same flat working set as InMemory (goals: terminal kept; tasks: `OPEN_STATUSES`), both feeding the single shared `assemble()`. Plan 03's parity test can now assert identical `tree_keys()` across stores using the same `seed_goal_tree` fixtures.
- Plan 03 owns the true store-level over-depth/cyclic anomaly fixtures (the validating service API cannot build a >64 / cyclic chain) — the CTE's `UNION` dedup + `assemble`'s visited-set/`MAX_GOAL_DEPTH` are the guards under test.

---
*Phase: 04-period-view-goal-tree-rollup*
*Completed: 2026-06-25*

## Self-Check: PASSED

- FOUND: `todo-engine/src/infrastructure/sqlite/repo.rs::load_period_subtree`
- FOUND: `todo-engine/src/application/ports.rs::load_period_subtree` (trait method)
- FOUND: `OPEN_STATUSES` single definition at `todo-engine/src/domain/status.rs:27`
- FOUND: Persistent arm `store.load_period_subtree(...)` in `queries.rs` (stub removed, grep returns 0)
- FOUND commit: `2133220` (Task 1)
- FOUND commit: `23f528d` (Task 2)
- `cargo build` + `cargo clippy --all-targets --all-features -- -D warnings`: clean
- `cargo test --test integration period_view`: 7/7 pass
- `schema.rs` and `list_items` unchanged (D-10 fence verified)
- One out-of-scope pre-existing e2e failure (`cli::init_loads_todo_engine_home_from_dotenv`), not a regression.
