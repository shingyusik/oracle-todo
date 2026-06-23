---
phase: 03-date-view
plan: 03
subsystem: api
tags: [rust, todo-service, date-view, integration-tests, sqlite, store-parity]

# Dependency graph
requires:
  - phase: 03-date-view
    provides: "TodoService::agenda / date_range and the open_tasks/iso_day/sort_date_view helpers (plan 03-01)"
provides:
  - "tests/integration/date_view.rs — persistent SQLite parity + side-effect-free integration suite proving SC4/CORE-03"
  - "parity_in_memory_vs_persistent — explicit cross-store oracle comparing in_memory vs persistent by stable (title, scheduled) key"
affects: [05-cli-api]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Cross-store parity oracle: run ONE seed_fixture through both TodoService::in_memory and TodoService::persistent, compare ordered (title, scheduled) stable keys (NOT raw ids — in-memory seeds task_000001, persistent uses UUIDs)"
    - "Side-effect-free read oracle: capture service.events().len() before/after agenda+date_range, assert unchanged (no routine materialization / no audit write)"

key-files:
  created:
    - "todo-engine/tests/integration/date_view.rs — 4 #[test] fns + persistent_service/open_task/seed_fixture/keys helpers"
  modified:
    - "todo-engine/tests/integration.rs — #[path] registration of mod date_view (first entry, sorts before events)"

key-decisions:
  - "open_task helper drives the real service API (propose_task Actor::User -> approve -> activate -> update_item) to build OPEN tasks with scheduled/due; user-proposed so activate flows without an extra approval gate"
  - "seed_fixture uses distinct deterministic titles (sched-in-range/due-only/both-match/sched-other-day/sched-out-of-range/unscheduled) so the stable (title, scheduled) key identifies rows across store id schemes"
  - "keys() maps results to ordered Vec<(String, Option<String>)>; parity asserts equality for BOTH date_range and agenda, never by raw id"

patterns-established:
  - "persistent_service() mirrored verbatim from goal_view.rs (tempfile::tempdir -> connect -> init_schema -> SqliteTodoRepository -> TodoService::persistent); tests/support::TestHome avoided (e2e-only)"

requirements-completed: [VIEW-02, VIEW-05]

# Metrics
duration: 4min
completed: 2026-06-23
---

# Phase 3 Plan 03: Date-View Persistent Integration Tests Summary

**A persistent SQLite integration suite proving SC4 store parity (an explicit `parity_in_memory_vs_persistent` cross-store oracle comparing both stores by stable `(title, scheduled)` key) and side-effect-free behavior (`events().len()` unchanged across `agenda`/`date_range`, proving no routine materialization), with `agenda`/`date_range` re-proven over the real `list_items` SQLite path.**

## Performance
- **Duration:** 4 min
- **Tasks:** 2
- **Files created:** 1
- **Files modified:** 1

## Accomplishments
- Created `tests/integration/date_view.rs` with four `#[test]` fns: `persistent_agenda_unions_scheduled_and_due_open_tasks` (SC4/VIEW-05 union + single-date dedup over persistent store), `persistent_date_range_groups_by_scheduled` (SC4/VIEW-02 scheduled-only inclusive range, deterministic order), `agenda_is_side_effect_free` (SC4/CORE-03 `events().len()` oracle), and `parity_in_memory_vs_persistent` (SC4 cross-store stable-key oracle for both `agenda` and `date_range`).
- Added the shared helpers: `persistent_service()` (mirrored verbatim from `goal_view.rs`), `open_task()` (real service propose/approve/activate/update path), `seed_fixture(&mut TodoService)` (the identical fixture run through both stores), and `keys()` (stable-key projection).
- Registered `mod date_view` in `tests/integration.rs` as the first `#[path]` entry (sorts before `events`).
- Full gate green: `cargo test` (whole suite), `cargo fmt --check`, and `cargo clippy --all-targets --all-features -- -D warnings` all pass; the four date_view tests pass.

## Test Names (deliverables)
```
persistent_agenda_unions_scheduled_and_due_open_tasks
persistent_date_range_groups_by_scheduled
agenda_is_side_effect_free
parity_in_memory_vs_persistent
```
Helpers: `persistent_service()`, `open_task()`, `seed_fixture(&mut TodoService)`, `keys()`.

## Task Commits
1. **Task 1: Write tests/integration/date_view.rs** — `c4784f2` (test)
2. **Task 2: Register date_view in integration binary** — `a45d3b8` (test)

**Plan metadata:** see final docs commit.

## Files Created/Modified
- `todo-engine/tests/integration/date_view.rs` (created) — persistent SQLite parity + side-effect-free SC4/CORE-03 suite.
- `todo-engine/tests/integration.rs` (modified) — `#[path = "integration/date_view.rs"] mod date_view;` first entry.

## Decisions Made
All within the plan's pre-authorized discretion: `open_task` builds OPEN tasks via the real service API; `seed_fixture` uses distinct deterministic titles so the `(title, scheduled)` stable key is store-independent; cross-store parity compares by stable key, never raw id. No locked-decision deviations.

## Deviations from Plan
None - plan executed exactly as written. Note: Task 1's test cannot compile or run without Task 2's module registration, so both files were authored before the first commit; they were still committed atomically as two separate task commits (test file, then registration).

## Issues Encountered
`cargo fmt --check` initially flagged two `open_task("both-match", ...)` call sites for line wrapping; resolved by running `cargo fmt`. No logic change.

## User Setup Required
None.

## Next Phase Readiness
- SC4 (store parity) and CORE-03 (side-effect-free, shared service code identical regardless of caller) are now proven over the persistent SQLite path. Phase 5 (CLI/API) can build adapters over `agenda`/`date_range` knowing the read is pure and store-agnostic.
- No blockers. The Phase 4 period-view rollup performance concern is unaffected (these reads compose `list_items`, no new scan path).

## Self-Check: PASSED
- FOUND: todo-engine/tests/integration/date_view.rs
- FOUND: todo-engine/tests/integration.rs (mod date_view registered)
- FOUND commit: c4784f2 (Task 1)
- FOUND commit: a45d3b8 (Task 2)

---
*Phase: 03-date-view*
*Completed: 2026-06-23*
