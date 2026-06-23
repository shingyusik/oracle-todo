---
phase: 03-date-view
plan: 02
subsystem: tests
tags: [rust, tests, unit, date-view, oracles]

# Dependency graph
requires:
  - phase: 03-date-view
    provides: "TodoService::agenda / TodoService::date_range and the iso_day / sort_date_view / open_tasks / OPEN_STATUSES date-view surface in queries.rs (plan 03-01)"
provides:
  - "tests/unit/date_view.rs — fast in-memory behavior oracles for SC1 (range order), SC2 (unscheduled never dropped), SC3 (agenda union+dedup), D-05 (open-only), D-06 (no overdue roll), D-08 (tie-break)"
  - "date_view module registered in the unit test binary"
affects: [03-03, 05-cli-api]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Service-API in-memory fixture for date-view unit tests: TodoService::in_memory() + propose_task(Actor::User) + transitions + update_item, asserting on the returned Vec<TodoItem> (no I/O, no apply_list_filter shortcut)"
    - "In-memory clock advances 1s per mutation, so creation order == created_at asc == id asc — the tie-break oracle exploits this for deterministic same-day ordering"

key-files:
  created:
    - "todo-engine/tests/unit/date_view.rs — five #[test] oracles plus task()/ids() fixture helpers"
  modified:
    - "todo-engine/tests/unit.rs — added #[path] registration for the date_view module (alphabetical, between clock and error_mapping)"

key-decisions:
  - "Waiting omitted from open_only (D-05): the only Waiting producer is the routine-pause cascade, which fires solely on tasks carrying metadata[generated_by]==routine, and no public service API sets that marker — it is not drivable from a test fixture. The reachable Completed/Paused exclusions prove the OPEN_STATUSES allowlist semantics (exclusion-by-construction); Waiting/Someday are excluded the same way without a producer. Plan pre-authorized skipping Waiting ('or skip if a routine fixture is too heavy')."
  - "SC2 keeps unscheduled rows (None/today/junk scheduled) in agenda scope via due==D, then asserts they are present and occupy the trailing entries (sort_date_view puts unscheduled last) — proving SC2 on the agenda/full-set path as the plan requires (not date_range, which by D-03 legitimately excludes unscheduled)"

requirements-completed: [VIEW-02, VIEW-05]

# Metrics
duration: 3min
completed: 2026-06-23
---

# Phase 3 Plan 02: Date-View Unit Test Oracles Summary

**Five fast in-memory behavior oracles in `tests/unit/date_view.rs` proving the date-view contract (range ordering, unscheduled-never-dropped, agenda union+dedup, open-only, no overdue roll) against the real `agenda`/`date_range` signatures shipped in 03-01, registered in the `unit` test binary.**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-06-23T09:11:20Z
- **Completed:** 2026-06-23T09:14:23Z
- **Tasks:** 2
- **Files modified:** 2 (1 created, 1 modified)

## Accomplishments
- Created `tests/unit/date_view.rs` with the five VALIDATION.md oracle tests, all green:
  - `range_orders` (SC1 / VIEW-02, covers D-08): out-of-creation-order scheduled dates plus two same-day ties prove scheduled-asc -> created_at -> id ordering via `date_range`.
  - `unscheduled_never_dropped` (SC2 / VIEW-02): None / legacy `"today"` sentinel / junk `scheduled` rows (kept in agenda scope via `due == D`) are present and sorted to the tail; none dropped.
  - `agenda_union_dedup` (SC3 / VIEW-05): scheduled-only, due-only, and both-match tasks all appear in `agenda`, with the both-match task deduped to exactly one row.
  - `open_only` (D-05): Proposed/Approved/Active included; the reachable Completed (via `complete`) and Paused (via `pause`) excluded.
  - `no_overdue_roll` (D-06): a `2026-06-20`-scheduled task is absent from `agenda("2026-06-23")`.
- Registered the module in `tests/unit.rs` (`#[path = "unit/date_view.rs"] mod date_view;`) alphabetically between `clock` and `error_mapping`.
- Full gate green: `cargo test --test unit date_view` (5 passed), `cargo fmt --check`, `cargo clippy --all-targets --all-features -- -D warnings`.

## Test Names and Fixtures
- `#[test]` fns: `range_orders`, `unscheduled_never_dropped`, `agenda_union_dedup`, `open_only`, `no_overdue_roll`
- Fixture helpers: `task(service, scheduled, due) -> String` (proposes a user task and returns its id) and `ids(items) -> Vec<String>` (ordered id collection, the `filter.rs` idiom)

## Task Commits

Each task was committed atomically:

1. **Task 1: Write tests/unit/date_view.rs (five oracles)** - `ccd681a` (test)
2. **Task 2: Register date_view module in unit test binary** - `cb806b1` (test)

**Plan metadata:** see final docs commit.

## Files Created/Modified
- `todo-engine/tests/unit/date_view.rs` (created) - five date-view unit oracles + fixture helpers.
- `todo-engine/tests/unit.rs` (modified) - one `#[path]` registration line for the new module.

## Decisions Made
- **Waiting omitted from `open_only` (D-05):** the routine-pause cascade is the only Waiting producer and it only touches tasks with `metadata["generated_by"] == "routine"`, which no public service API sets — so a Waiting task is not drivable from a unit fixture. The reachable Completed/Paused exclusions prove the `OPEN_STATUSES` allowlist's exclusion-by-construction semantics; Waiting and Someday are excluded identically without a producer. The plan pre-authorized this skip.
- **SC2 scope via `due == D`:** the agenda/full-set path retains a row on `scheduled == D OR due == D`; unscheduled rows were kept in scope by setting `due` to the agenda day, then asserted present and trailing — matching the plan's instruction to prove SC2 on the agenda path (not `date_range`).

## Deviations from Plan

None - plan executed as written. The only judgment call (skipping the Waiting case in `open_only`) was explicitly pre-authorized by the plan ("or skip if a routine fixture is too heavy") and the D-05 acceptance criteria, which require excluding the reachable Completed/Paused.

## Issues Encountered
- Initial `open_only` draft attempted to drive a Waiting task via a routine-pause cascade by setting a `note`, but the cascade keys off `metadata["generated_by"] == "routine"` (not settable through any public API). Removed the unreachable Waiting fixture and documented the allowlist-by-construction rationale in the test. No production code change.

## Known Stubs
None — test-only plan; no UI, no data wiring, no placeholders.

## User Setup Required
None.

## Next Phase Readiness
- Unit-level oracles for VIEW-02 / VIEW-05 are green. Plan 03-03 (integration: SC1/SC4 store parity over persistent SQLite) can proceed against the same `agenda`/`date_range` surface.
- No blockers. The Phase 4 rollup performance concern is unaffected (test-only plan, no new scan path).

## Self-Check: PASSED

- FOUND: todo-engine/tests/unit/date_view.rs
- FOUND: todo-engine/tests/unit.rs (mod date_view registered)
- FOUND: .planning/phases/03-date-view/03-02-SUMMARY.md
- FOUND commit: ccd681a (Task 1)
- FOUND commit: cb806b1 (Task 2)

---
*Phase: 03-date-view*
*Completed: 2026-06-23*
