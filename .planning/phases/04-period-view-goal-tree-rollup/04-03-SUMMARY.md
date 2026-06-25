---
phase: 04-period-view-goal-tree-rollup
plan: 03
subsystem: tests
tags: [period-view, goal-tree, parity, anomaly, sqlite, recursive-cte, rust]

# Dependency graph
requires:
  - phase: 04-period-view-goal-tree-rollup
    plan: 01
    provides: "PeriodView/GoalNode, period_view(), shared assemble() walk (visited-set + MAX_GOAL_DEPTH), InMemory loader, tree_keys/seed_goal_tree/goal/open_task helpers"
  - phase: 04-period-view-goal-tree-rollup
    plan: 02
    provides: "SqliteTodoRepository::load_period_subtree (WITH RECURSIVE CTE), TodoRepository::load_period_subtree trait method, OPEN_STATUSES in domain/status.rs, Persistent arm of period_view"
provides:
  - "Persistent SQL-path subtree test proving SC1/VIEW-03 over real SQLite with the D-07 visibility asymmetry"
  - "parity_in_memory_vs_persistent (D-11): the mandatory cross-store equality oracle (tree_keys + anomaly_count)"
  - "SC3 store-level anomaly fixtures: cycle / orphan / over-depth injected via raw SQL, proving period_view terminates Ok with anomaly_count bumped (never hangs/Errs)"
  - "Persistent side-effect-free test (no audit event on the SQL load)"
  - "raw_home()/insert_goal_row()/service_over() store-level injection helpers"
affects: [period-view-cli, period-view-api]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Store-level malformed-data injection: raw conn.execute INSERT (+ post-insert UPDATE for cycles, PRAGMA foreign_keys=OFF for dangling FKs) bypassing the validating service API, then SqliteTodoRepository::new over the SAME connection"
    - "Cross-store parity asserted by structure-capturing stable keys tree_keys() -> Vec<(title, depth, kind)>, never raw ids (in-memory goal_000001/task_000001 vs persistent UUIDs)"

key-files:
  created: []
  modified:
    - todo-engine/tests/integration/period_view.rs
    - .planning/phases/04-period-view-goal-tree-rollup/deferred-items.md

key-decisions:
  - "Cycle injection technique: insert goal A and B with parent_id = NULL, then two UPDATEs to point A->B and B->A; an UPDATE after both rows exist satisfies the forward FK that a self/mutual insert cannot"
  - "Orphan injection: PRAGMA foreign_keys = OFF around the single dangling-parent INSERT, then ON again — the only way to write a corrupt forward FK reference SC3 must defend against"
  - "MAX_GOAL_DEPTH (64) mirrored as a test-local const since goal.rs keeps it pub(super); the 65-node chain and the const move together if the cap changes"
  - "InMemory-side cycle/orphan fixture NOT added: ServiceStore::InMemory(HashMap) is pub(super) and not constructible from the test crate; the raw-SQLite fixture exercises the EXACT shared assemble() guard (the InMemory and Persistent stores feed the same walk), so the guarantee is proven without weakening the test"

requirements-completed: [VIEW-03, VIEW-04]

# Metrics
duration: 9min
completed: 2026-06-25
---

# Phase 4 Plan 03: Persistent Parity + SC3 Anomaly Tests Summary

**The final period-view plan: integration tests that lock the Persistent SQL CTE path, prove mandatory cross-store parity (D-11) by structure-capturing stable keys, and prove SC3 safety on cyclic/orphaned/over-depth legacy data that the validating service API cannot create — injected as raw SQLite rows. period_view is now proven side-effect-free and termination-safe on both stores.**

## Performance

- **Duration:** ~9 min
- **Completed:** 2026-06-25
- **Tasks:** 2
- **Files modified:** 2 (0 created, 2 modified)

## Accomplishments

- Copied `persistent_service()` verbatim from `date_view.rs` (not shared outside e2e) so the period-view tests exercise the real `connect` + `init_schema` + `SqliteTodoRepository` + `TodoService::persistent` path.
- `persistent_period_view_builds_subtree` (SC1/VIEW-03): the same `seed_goal_tree` fixture run through the SQL CTE builds the documented tree; a TERMINAL goal (completed week child) is STILL present and traversed (an open task under it surfaces) while a TERMINAL task is excluded — proving the CTE's asymmetric D-07 predicate end-to-end.
- `parity_in_memory_vs_persistent` (D-11, MANDATORY): the identical seed (a live task AND a terminal task under the same goal) runs through both an in-memory and a persistent store; `tree_keys()` sequences and `anomaly_count` are equal. The terminal task is absent in BOTH stores and the live task present in BOTH — the cross-store D-07 absence-parity guard proving the two loaders filter task status identically.
- `period_view_is_side_effect_free_persistent` (SC3/CORE-03): `events().len()` is unchanged across a persistent `period_view`, proving the SQL load writes nothing.
- SC3 store-level anomaly fixtures (`cycle_is_severed_no_error`, `orphan_parent_no_error`, `depth_cap_truncates_persistent`): malformed `parent_id` data injected via raw SQL, bypassing `validate_goal_nesting`; `period_view` returns `Ok` with `anomaly_count` bumped and the suite TERMINATES (the non-hang proof).

## Store-Level Cycle-Injection Technique

`parent_id` carries a forward FK (`REFERENCES items(id)`), so a self/mutual cycle cannot be written by a single INSERT (the referenced id does not yet exist). The technique:

1. Insert goal A and goal B each with `parent_id = NULL` (both anchored to `(month, 2026-06-01)` so they are CTE seeds/roots).
2. `UPDATE items SET parent_id = 'goal-B' WHERE id = 'goal-A'`.
3. `UPDATE items SET parent_id = 'goal-A' WHERE id = 'goal-B'`.

Both rows now exist, so each UPDATE satisfies the FK, leaving an A⇄B cycle no `propose_goal` path could ever create. The orphan fixture instead toggles `PRAGMA foreign_keys = OFF` around a single dangling-parent INSERT (a corrupt forward reference), then back `ON`.

## anomaly_count Semantics (observed)

One anomaly = one **severed child-goal branch** during the `assemble()` descent (`build_node`, queries.rs:368-372): a branch is severed and counted when descending it would either (a) re-visit an already-visited goal id (a cycle back-edge) or (b) exceed `MAX_GOAL_DEPTH`. So:

- **Cycle (A⇄B):** when descending from A into B (or vice versa), the second hop tries to re-enter an already-visited node → one anomaly (`>= 1` asserted; the exact count depends on which root the dedup'd CTE set surfaces first).
- **Over-depth (65-chain):** the hop from depth 64 to depth 65 exceeds the cap → branch severed, one anomaly; the returned tree depth stays `< MAX_GOAL_DEPTH`.
- **Orphan (dangling parent):** an unreachable orphan is simply **absent** from the working set (its parent is not in the frontier), so it is NOT counted as an anomaly — the SC3 guarantee here is `Ok` + no panic, which the test asserts (the orphan title is absent, the real root present).

## Final Test List (each locks an SC/requirement)

| Test | Locks |
|------|-------|
| `persistent_period_view_builds_subtree` | SC1 / VIEW-03 — SQL CTE builds the subtree; D-07 asymmetry (terminal goal kept, terminal task excluded) |
| `parity_in_memory_vs_persistent` | SC4 / CORE-03 / D-11 — cross-store tree + anomaly_count equality; D-07 absence-parity |
| `period_view_is_side_effect_free_persistent` | SC3 / CORE-03 — persistent load writes no audit event |
| `cycle_is_severed_no_error` | SC3 / D-08 / D-09 / T-04-07 — A⇄B cycle → Ok + anomaly_count ≥ 1, no hang |
| `orphan_parent_no_error` | SC3 / D-09 — dangling parent_id → Ok, no panic |
| `depth_cap_truncates_persistent` | SC3 / D-08 / D-09 / T-04-07 — 65-chain → Ok + anomaly_count ≥ 1 + bounded depth |

(Plus the 7 pre-existing in-memory tests from Plan 01, all still green.)

## Task Commits

1. **Task 1: Persistent CTE subtree, cross-store parity, persistent side-effect-free** — `6a5c404` (test)
2. **Task 2: SC3 store-level cycle/orphan/over-depth anomaly fixtures** — `14c0a31` (test)

## Decisions Made

- **No InMemory-side anomaly fixture:** `ServiceStore::InMemory(HashMap)` is `pub(super)` and not constructible from the integration-test crate, and there is no public seeding path that bypasses `validate_goal_nesting`. Rather than weaken the test, the raw-SQLite fixture is used as the single primary anomaly path — it exercises the EXACT same shared `assemble()` walk (both stores feed it), so the in-memory guard is the same code under test.
- **`MAX_GOAL_DEPTH` mirrored, not re-exported:** kept the production cap `pub(super)` (no API surface change for a test) and mirrored the value `64` as a test-local const with a comment tying the chain length and the const together.

## Deviations from Plan

None — plan executed as written. The plan's `<read_first>` already anticipated the `pub(super)` InMemory-store accessibility constraint and instructed preferring the raw-SQLite fixture; that path was taken with no scope change. The orphan FK handling (`PRAGMA foreign_keys = OFF` for the dangling-reference INSERT) is an implementation detail the plan implied ("insert a goal whose `parent_id` points to a non-existent id") — the schema's forward FK requires the pragma toggle to write a corrupt reference, which is exactly the SC3 legacy-corruption scenario under test.

## Verification Results

- `cargo test --test integration period_view` — **13/13 pass** (7 pre-existing in-memory + 6 new persistent/parity/anomaly).
- `cargo test --test integration` — **60/60 pass**. `cargo test --test unit` — **49/49 pass**.
- Suite TERMINATES on injected cycles (no hang/timeout) — the SC3 non-hang proof.
- `cargo clippy --all-targets --all-features -- -D warnings` — clean.
- `rustfmt --check --edition 2024 todo-engine/tests/integration/period_view.rs` — clean (exit 0).
- Acceptance greps: `grep -c 'parity_in_memory_vs_persistent'` = 1; `grep -c 'INSERT INTO items'` = 1 (≥ 1).
- `cargo test` (all binaries): one failure — `cli::init_loads_todo_engine_home_from_dotenv` — the documented PRE-EXISTING, out-of-scope dotenv/data-home failure (logged in `deferred-items.md` since Plan 01; lives in the CLI path, untouched here; not a regression).

## Issues Encountered

- **Pre-existing e2e failure (out of scope):** `cli::init_loads_todo_engine_home_from_dotenv` — dotenv `TODO_ENGINE_HOME` not honored; predates this plan, in the CLI/dotenv/data-home path, already in `deferred-items.md`. Not a regression.
- **Pre-existing fmt debt (out of scope):** `cargo fmt --check` reports one diff in Plan 02's `repo.rs::load_period_subtree` (a query call rustfmt wants collapsed). `repo.rs` is not in this plan's diff; logged to `deferred-items.md` for a future `cargo fmt` sweep. Only this plan's file was reformatted (SCOPE BOUNDARY).

## Known Stubs

None — this plan adds test functions only; no production stubs introduced or remaining (Plan 01's `unimplemented!` stub was already removed by Plan 02).

## Phase 4 Completion

This is the FINAL plan of Phase 4. With Plans 01 (core), 02 (persistent CTE), and 03 (parity + anomaly) complete, VIEW-03 and VIEW-04 are fully implemented and proven:

- **VIEW-03** (period goal-tree): root goal(s) at `(horizon, period)` plus their descendant goal+task subtree, built identically by the InMemory walk and the SQL CTE (parity locked), terminating safely on adversarial data.
- **VIEW-04** (unscheduled-in-goal surfacing): unscheduled tasks linked under a goal surface inline (proven in Plan 01's `unscheduled_task_surfaced` and carried through the parity seed).

Phase 5 (CLI + API surface) can now adapt the single shared `PeriodView` type over both surfaces.

## Next Phase Readiness

- `period_view` is proven correct, parity-locked, and termination-safe over BOTH stores — Phase 5 adapters serialize the existing `PeriodView`/`GoalNode` (already `Serialize`/`Deserialize`) with no further service work.
- The store-level injection helpers (`raw_home`/`insert_goal_row`) are available as a pattern for any future SC3-style legacy-data test.

---
*Phase: 04-period-view-goal-tree-rollup*
*Completed: 2026-06-25*

## Self-Check: PASSED

- FOUND: `todo-engine/tests/integration/period_view.rs` (modified: +6 tests, +helpers)
- FOUND commit: `6a5c404` (Task 1)
- FOUND commit: `14c0a31` (Task 2)
- `cargo test --test integration period_view`: 13/13 pass
- `cargo test --test integration`: 60/60; `cargo test --test unit`: 49/49
- `cargo clippy --all-targets --all-features -- -D warnings`: clean
- `parity_in_memory_vs_persistent` present (grep = 1); raw `INSERT INTO items` cycle fixture present (grep = 1)
- One out-of-scope pre-existing e2e failure (`cli::init_loads_todo_engine_home_from_dotenv`); not a regression.
