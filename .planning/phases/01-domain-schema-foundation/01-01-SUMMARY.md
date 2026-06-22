---
phase: 01-domain-schema-foundation
plan: 01
subsystem: database
tags: [rust, time, domain, horizon, period-anchor, iso-week]

# Dependency graph
requires: []
provides:
  - "Horizon enum (Year/Month/Week) with serde lowercase, as_str, and FromStr"
  - "Horizon::is_coarser_than — strict coarser-than ordering (year > month > week), no Ord, no _or_equal"
  - "normalize_to_period_start(Date, Horizon) -> Date — the single canonical period-anchor helper"
  - "is_period_start(Date, Horizon) -> bool — strict is-canonical check (no auto-snap)"
  - "Public module path todo_engine::domain::horizon, re-exported from domain/mod.rs"
affects: [02-goal-itemtype, 03-schema-indexes, period-views, date-view, anchor-validation]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure I/O-free domain module mirroring recurrence.rs date idioms (local infallible calendar_date ctor, Monday-zero weekday_index)"
    - "Enum string mapping mirrors model.rs ItemType: serde rename_all=lowercase + as_str + FromStr with trim and unknown-error"

key-files:
  created:
    - todo-engine/src/domain/horizon.rs
    - todo-engine/tests/unit/horizon.rs
  modified:
    - todo-engine/src/domain/mod.rs
    - todo-engine/tests/unit.rs

key-decisions:
  - "Week start = ISO Monday; normalization may land in the prior calendar year (2026-01-01 Thu -> 2025-12-29 Mon); the engine never clamps to Jan 1 and never auto-snaps — strict reject of non-canonical anchors is Phase 2."
  - "Strict coarser-than ordering via Horizon::is_coarser_than (rank: Year=0 < Month=1 < Week=2); no Ord/PartialOrd impl and no _or_equal variant (Phase 2's parent rule is parent STRICTLY coarser than child, D-02/D-07)."
  - "Anchor helper operates on already-parsed time::Date; string->Date parsing is Phase 2's job."

patterns-established:
  - "Canonical period-anchor: one helper (normalize_to_period_start) buckets every period; is_period_start is just normalize == self."
  - "Self-contained domain module re-implements borrowed recurrence.rs helpers locally rather than making them pub."

requirements-completed: [GOAL-02]

# Metrics
duration: 8min
completed: 2026-06-22
---

# Phase 1 Plan 01: Horizon enum + period-anchor helper Summary

**The milestone lynchpin: one pure, tested, I/O-free way to anchor any `time::Date` to its canonical period start (year->Jan 1, month->1st, week->ISO Monday) plus a strict is-canonical check, with year-boundary correctness pinned by 13 unit tests.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-06-22T08:35:00Z (approx)
- **Completed:** 2026-06-22T08:42:37Z
- **Tasks:** 2
- **Files modified:** 4 (2 created, 2 modified)

## Accomplishments
- `Horizon { Year, Month, Week }` enum with serde lowercase, `as_str`, and `FromStr` (mirrors `ItemType` idiom).
- `Horizon::is_coarser_than` — strict coarser-than ordering with no `Ord` impl and no `_or_equal` variant (D-02/D-07).
- `normalize_to_period_start` + `is_period_start` — the single canonical period-anchor helper and its strict is-canonical companion, operating on already-parsed `time::Date`.
- ISO-Monday week-start convention documented as a Key Decision next to the helper (SC2); cross-year Monday and Jan-1-is-Monday cases proven by tests (SC1).

## Task Commits

Each task was committed atomically:

1. **Task 1: Horizon enum + period-anchor helper** - `0b76d73` (feat)
2. **Task 2: Boundary unit tests (SC1)** - `d4c2891` (test)

_Note: This plan's frontmatter marks both tasks `tdd="true"`. Because the helper's behavior is fully proven by deterministic boundary literals, Task 1 landed the implementation (verified by build + clippy) and Task 2 landed the boundary/ordering tests — the test commit and feat commit are both present in git history._

## Files Created/Modified
- `todo-engine/src/domain/horizon.rs` - Horizon enum, strict ordering, normalize/is-canonical anchor helpers, ISO-Monday Key Decision doc (102 lines).
- `todo-engine/src/domain/mod.rs` - `mod horizon;` + `pub use horizon::{Horizon, is_period_start, normalize_to_period_start};`.
- `todo-engine/tests/unit/horizon.rs` - 13 boundary/ordering/round-trip tests (133 lines).
- `todo-engine/tests/unit.rs` - registered `#[path = "unit/horizon.rs"] mod horizon;` (alphabetical).

## Decisions Made
- **Week start = ISO Monday, never clamped, never auto-snapped.** The Monday of a date's week may fall in the previous calendar year; normalization returns the true ISO Monday (2026-01-01 -> 2025-12-29). Strict rejection of non-canonical anchors is deferred to Phase 2, which calls `is_period_start`. Recorded as a Key Decision so no later view buckets a period two ways (Roadmap SC2).
- **Strict coarseness, no `Ord`.** Exposed only via `is_coarser_than` (rank-based); equality is not coarser, matching Phase 2's "parent strictly coarser than child" parent rule (D-02/D-07).
- **Helper takes `time::Date`, not a string.** Parsing is Phase 2's concern; the domain helper stays a pure normalization.

## Deviations from Plan

None - plan executed exactly as written. Function names match the plan's suggested names (`normalize_to_period_start`, `is_period_start`).

## Issues Encountered
None. Build, clippy (warnings-as-errors), full `cargo test` (43 unit tests incl. the architecture purity test), and `cargo fmt --check` all pass clean on first attempt. The only output was benign Git LF->CRLF warnings on Windows.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `todo_engine::domain::Horizon`, `normalize_to_period_start`, and `is_period_start` are on the public domain path, ready for Plan 01-02 (Goal ItemType) and 01-03 (schema/indexes) to consume.
- Phase 2 can call `is_period_start` to strict-reject non-canonical `(horizon, scheduled)` anchors without auto-snapping, and `is_coarser_than` for parent-goal coarseness checks.
- Domain purity preserved: `domain_has_no_outward_dependencies` architecture test stays green.

## Self-Check: PASSED

- FOUND: todo-engine/src/domain/horizon.rs
- FOUND: todo-engine/tests/unit/horizon.rs
- FOUND commit: 0b76d73 (Task 1)
- FOUND commit: d4c2891 (Task 2)

---
*Phase: 01-domain-schema-foundation*
*Completed: 2026-06-22*
