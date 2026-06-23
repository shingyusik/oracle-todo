---
phase: 03-date-view
plan: 01
subsystem: api
tags: [rust, todo-service, date-view, queries, time]

# Dependency graph
requires:
  - phase: 02-service-policy
    provides: "ListFilter horizon/parent_id/scheduled predicates over in-memory + persistent SQLite list paths; task->goal link via parent_id + scheduled"
provides:
  - "TodoService::agenda(date) — single-date scheduled==D OR due==D union, deduped by id"
  - "TodoService::date_range(from, to) — inclusive scheduled-only range, deterministic order"
  - "Private helpers iso_day / sort_date_view / open_tasks and the OPEN_STATUSES allowlist in queries.rs (the API plans 03-02/03-03 test against)"
affects: [03-02, 03-03, 05-cli-api]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Compose-on-list_items date reads: service-layer query methods narrow list_items output rather than branching on store kind (SC4 CLI/API parity is free)"
    - "iso_day leading-10-char ISO parse: bare and timestamped scheduled/due collapse uniformly; None/sentinel/junk -> None (unscheduled signal, not error)"

key-files:
  created: []
  modified:
    - "todo-engine/src/application/service/queries.rs — added agenda + date_range pub methods, open_tasks + iso_day + sort_date_view helpers, OPEN_STATUSES const"

key-decisions:
  - "agenda/date_range take &str params parsed internally via super::parse_day (param error surfaces as TodoError::Validation at the method boundary); no DateView struct (D-01) — flat Vec<TodoItem> only"
  - "Open-only narrowing uses an explicit OPEN_STATUSES allowlist (Proposed/Approved/Active), NOT list_items hidden-by-default (which leaks Completed/Waiting/Paused/Someday/Rejected)"
  - "date_range is scheduled-only (D-03); due-spanning is single-date agenda only (D-02). No due-tagging on agenda rows (D-04) — adapter discriminates via scheduled/due fields"

patterns-established:
  - "Date-view sort (D-08): scheduled ISO ascending, unscheduled (None) last, then created_at -> id tie-break reused verbatim from list_items"
  - "Side-effect-free reads: date-view methods never call materialize_routines and never apply the scheduled<=today overdue roll (SC4/CORE-03, D-06)"

requirements-completed: [VIEW-02, VIEW-05, CORE-03]

# Metrics
duration: 2min
completed: 2026-06-23
---

# Phase 3 Plan 01: Date-View Service Query Methods Summary

**Two pure, side-effect-free `TodoService` date reads — `agenda` (scheduled||due union, deduped) and `date_range` (scheduled-only inclusive range) — composing `list_items` with a deterministic `scheduled -> created_at -> id` sort that is the CLI/API parity guarantee.**

## Performance

- **Duration:** 2 min
- **Started:** 2026-06-23T09:04:02Z
- **Completed:** 2026-06-23T09:06:43Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments
- Added the date-view foundation to `queries.rs`: `OPEN_STATUSES` D-05 allowlist, `iso_day` ISO-day extractor (D-07 unscheduled-not-error), `sort_date_view` D-08 comparator, and the `open_tasks` `list_items`-composing helper.
- Added the two public `TodoService` methods — `agenda(date)` (VIEW-05/SC3, D-02 union+dedup) and `date_range(from, to)` (VIEW-02/SC1, D-03 scheduled-only) — both narrowing `open_tasks` and applying `sort_date_view`.
- Full gate green: `cargo build`, `cargo clippy --all-targets --all-features -- -D warnings`, and `cargo fmt --check` all pass. No materialization call and no overdue-roll predicate introduced (SC4/CORE-03, D-06).

## Final Signatures (for plans 03-02 / 03-03 to test against)

```rust
// public methods on impl TodoService (queries.rs)
pub fn agenda(&mut self, date: &str) -> TodoResult<Vec<TodoItem>>
pub fn date_range(&mut self, from: &str, to: &str) -> TodoResult<Vec<TodoItem>>

// private helpers (queries.rs)
fn open_tasks(&mut self) -> TodoResult<Vec<TodoItem>>   // method on impl TodoService
fn iso_day(value: Option<&str>) -> Option<time::Date>   // free fn
fn sort_date_view(items: &mut [TodoItem])               // free fn

// module const (queries.rs)
const OPEN_STATUSES: [ItemStatus; 3] =
    [ItemStatus::Proposed, ItemStatus::Approved, ItemStatus::Active];
```

Behavioral contract for the tests:
- `agenda(date)` retains open tasks where `iso_day(scheduled) == Some(day) || iso_day(due) == Some(day)`; a single date dedups by id (each item retained at most once); due-included rows are NOT tagged (D-04).
- `date_range(from, to)` retains open tasks where `iso_day(scheduled)` is within `[from, to]` inclusive, scheduled-only (D-03); None/junk `scheduled` excluded from the range match.
- Both: junk param -> `TodoError::Validation` (via `super::parse_day`); output sorted by `sort_date_view` (scheduled asc, unscheduled last, `created_at -> id` tie-break).

## Task Commits

Each task was committed atomically:

1. **Task 1: Add iso_day, sort_date_view, OPEN_STATUSES, open_tasks** - `4ab8483` (feat)
2. **Task 2: Add agenda and date_range pub methods** - `389fc18` (feat)

**Plan metadata:** see final docs commit.

## Files Created/Modified
- `todo-engine/src/application/service/queries.rs` - Added the date-view query surface: `OPEN_STATUSES` const, `iso_day`/`sort_date_view`/`open_tasks` helpers, and the `agenda`/`date_range` public methods.

## Decisions Made
None beyond the Claude's-Discretion resolutions the plan pre-authorized (separate `&str`-param methods parsed internally, no `DateView` type, private free-fn helpers). All locked decisions D-01..D-08 were followed as specified.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None. After Task 1, `cargo build` emitted expected dead-code warnings for the not-yet-used helpers; these were resolved by Task 2 wiring them into `agenda`/`date_range`, and the clippy `-D warnings` gate passed clean after Task 2.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- The flat date-view read primitive is complete and exercised by the build/clippy/fmt gate. Plans 03-02 (unit tests: SC2/SC3 oracles) and 03-03 (integration tests: SC1/SC4 store parity) can now assert against the real `agenda`/`date_range`/helper signatures above.
- No blockers. The Phase 4 period-view rollup performance concern (recursive rollup vs. in-memory full-table-scan debt) is unaffected by this plan — these reads compose `list_items` and add no new scan path.

## Self-Check: PASSED

- FOUND: todo-engine/src/application/service/queries.rs
- FOUND: .planning/phases/03-date-view/03-01-SUMMARY.md
- FOUND commit: 4ab8483 (Task 1)
- FOUND commit: 389fc18 (Task 2)

---
*Phase: 03-date-view*
*Completed: 2026-06-23*
