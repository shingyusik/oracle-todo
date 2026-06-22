---
phase: 01-domain-schema-foundation
plan: 02
subsystem: database
tags: [rust, itemtype, sqlite, rusqlite, serde, domain-enum]

# Dependency graph
requires:
  - phase: 01-domain-schema-foundation (plan 01)
    provides: horizon/scheduled anchoring columns and the period-anchor foundation that Goal items reuse
provides:
  - "ItemType::Goal variant on the public todo_engine::domain::ItemType path, mapping to the string \"goal\""
  - "SC3 SQLite round-trip contract for a goal-typed item (write then read) locked by an integration test"
  - "Confirmation that the SQLite type-column round-trip is generic over ItemType (as_str/FromStr) — no mapping.rs edit needed"
affects: [01-03-schema-indexes, phase-02-goal-creation, phase-02-todoservice-policy, period-views]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "D-01 string-mapping idiom: enum variant + exhaustive as_str (no wildcard) + FromStr arm + enum-level serde snake_case"
    - "Storage round-trip stays generic over ItemType via mapping.rs item_type_sqlite_value/parse_item_type — new variants round-trip for free"

key-files:
  created:
    - todo-engine/tests/integration/goal_roundtrip.rs
  modified:
    - todo-engine/src/domain/model.rs
    - todo-engine/tests/unit/model.rs
    - todo-engine/tests/integration.rs

key-decisions:
  - "Goal is an ItemType variant (zero schema) — reuses the existing type TEXT column, keeping CORE-02 additive"
  - "SC3 round-trip flows through as_str/FromStr via mapping.rs, NOT serde; serde snake_case independently governs the JSON type field only"
  - "mapping.rs left unedited — item_type_sqlite_value -> as_str and parse_item_type -> ItemType::from_str are generic over ItemType"

patterns-established:
  - "Adding an ItemType variant requires exactly three edits in model.rs (enum, as_str, FromStr) plus the iterated unit round-trip list; storage follows for free"
  - "Exhaustive as_str match (no wildcard) makes the compiler force every future variant to be handled"

requirements-completed: [GOAL-02]

# Metrics
duration: 6min
completed: 2026-06-22
---

# Phase 01 Plan 02: Goal ItemType Summary

**ItemType::Goal added via the as_str/FromStr/serde snake_case idiom; a goal-typed item with horizon/scheduled round-trips through SQLite (SC3) with zero schema change.**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-06-22T08:44Z
- **Completed:** 2026-06-22
- **Tasks:** 2
- **Files modified:** 4 (1 created, 3 modified)

## Accomplishments
- `ItemType::Goal` is a first-class variant mapping to `"goal"`, ready for Phase 2 goal creation/validation.
- SC3 satisfied: a `Goal`-typed item with `horizon=Some("year")` and `scheduled=Some("2026-01-01")` survives a `save_item`/`get_item` round-trip through `SqliteTodoRepository` with no Storage error and all fields intact.
- Confirmed the SQLite type-column round-trip is generic over `ItemType` — `mapping.rs` required no edit. Zero schema added (CORE-02 stays additive).
- The exhaustive `as_str` match (no wildcard) now compiler-forces every future `ItemType` variant to be handled.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add the Goal variant to ItemType (model.rs) and confirm the mapping round-trip path** - `9164c19` (feat) — test addition and minimal implementation landed together (the unit-test edit references `ItemType::Goal`, so RED was a compile failure until the variant existed).
2. **Task 2: SC3 — goal-typed row round-trips through SQLite (integration test)** - `2daab78` (test)

**Plan metadata:** (final docs commit)

_Note: Task 1 combined the TDD RED (unit-test extension) and GREEN (enum arms) into one atomic commit because the test references the not-yet-existing variant — they cannot compile separately._

## Files Created/Modified
- `todo-engine/src/domain/model.rs` - Added `Goal` to the `ItemType` enum, the `as_str` match (`=> "goal"`), and the `FromStr` match (`"goal" => Ok(...)`).
- `todo-engine/tests/unit/model.rs` - Added `ItemType::Goal` to the `item_type_round_trips_every_variant` iteration list (domain-layer as_str<->FromStr round-trip assertion).
- `todo-engine/tests/integration/goal_roundtrip.rs` - New SC3 integration test: builds a `Goal` item with `horizon`/`scheduled`, saves and reloads via `SqliteTodoRepository`, asserts the type and reserved columns round-trip intact.
- `todo-engine/tests/integration.rs` - Registered `#[path = "integration/goal_roundtrip.rs"] mod goal_roundtrip;` (alphabetical, between `events` and `materialization`).

## Decisions Made
- **mapping.rs left unedited (as predicted):** `item_type_sqlite_value` calls `as_str()` and `parse_item_type` calls `ItemType::from_str` — both are generic over `ItemType`, so adding the enum arms makes the SQLite `type` column round-trip for free. No build or round-trip failure proved a gap, so the "confirm, don't edit" guidance held.
- **SC3 carried by as_str/FromStr, not serde:** the storage path uses the domain string mapping; serde `snake_case` independently yields `"goal"` only for the separate JSON `type` field (D-01 pattern).
- **Zero schema:** `Goal` reuses the existing `type` TEXT column — no new table, no new column, no migration. CORE-02 stays additive.

## Deviations from Plan

None - plan executed exactly as written. `mapping.rs` was confirmed and required no edit, matching the plan's stated expectation.

## Issues Encountered
None. Git emitted a benign LF->CRLF warning on the new test file (Windows line-ending normalization), which does not affect compilation or test results.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `ItemType::Goal` is on the public `todo_engine::domain::ItemType` path and the storage round-trip is locked — Phase 2 can create and validate goals through `TodoService`.
- Plan 01-03 (schema indexes) depends on this plan; its own `tests/integration.rs` edit applies after this one (no concurrent harness edit).
- Carry-forward (already in STATE.md): Phase 2 must document `ItemStatus` meaning for goals (recommended: `Active` for the period; `Completed`/`Dropped` user-driven, no cascade to children in v1).

---
*Phase: 01-domain-schema-foundation*
*Completed: 2026-06-22*

## Self-Check: PASSED

- FOUND: todo-engine/tests/integration/goal_roundtrip.rs
- FOUND: .planning/phases/01-domain-schema-foundation/01-02-SUMMARY.md
- FOUND commit: 9164c19 (Task 1, feat)
- FOUND commit: 2daab78 (Task 2, test)
