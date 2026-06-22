---
phase: 01-domain-schema-foundation
plan: 03
subsystem: database
tags: [sqlite, rusqlite, schema, indexes, migration]

# Dependency graph
requires:
  - phase: 01-domain-schema-foundation
    provides: "tests/integration.rs harness with goal_roundtrip registered (01-02)"
provides:
  - "idx_items_parent_id on items(parent_id)"
  - "idx_items_scheduled on items(scheduled)"
  - "composite idx_items_type_horizon_scheduled on items(type, horizon, scheduled)"
  - "SC4 executable test locking the additive-only migration contract"
affects: [period-views, date-view, goal-tree, phase-03, phase-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Additive index DDL via CREATE INDEX IF NOT EXISTS inside the rollback-wrapped init_schema_inner batch"
    - "SC4 migration test: re-run init_schema over a populated in-memory copy; assert indexes-added + rows-preserved + columns-superset + no period_key + user_version unchanged"

key-files:
  created:
    - todo-engine/tests/integration/schema_indexes.rs
  modified:
    - todo-engine/src/infrastructure/sqlite/schema.rs
    - todo-engine/tests/integration.rs

key-decisions:
  - "Three planning indexes added inside the existing index execute_batch, between idx_items_routine_occurrence and idx_events_*, keeping PRAGMA user_version = 1; COMMIT; last."
  - "No ALTER TABLE, no period_key column, no user_version bump — additive-only contract pinned by an executable SC4 test on a populated copy (never the live data home)."

patterns-established:
  - "Migration-safety test pattern: capture PRAGMA table_info before/after a re-run, assert BEFORE column set is a subset of AFTER, and forbidden columns are absent."

requirements-completed: [CORE-02]

# Metrics
duration: 4min
completed: 2026-06-22
---

# Phase 01 Plan 03: Schema Indexes Summary

**Three additive planning indexes (parent_id, scheduled, composite type+horizon+scheduled) added to init_schema via CREATE INDEX IF NOT EXISTS, with an SC4 test proving the migration is additive-only on a populated copy.**

## Performance

- **Duration:** 4 min
- **Started:** 2026-06-22T08:50:39Z
- **Completed:** 2026-06-22T08:55:00Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Added `idx_items_parent_id`, `idx_items_scheduled`, and composite `idx_items_type_horizon_scheduled` to the `init_schema_inner` index batch (CORE-02 / D-08), pre-paving the Phase 3-4 period and date view access paths additively.
- Locked the additive-only invariant with an executable SC4 test: re-running `init_schema` over a populated DB adds all three indexes idempotently, preserves existing rows, drops/rewrites no columns, introduces no `period_key`, and leaves `user_version` at 1.
- Existing repository integration tests (which assert `user_version == 1`) and the full workspace suite stay green.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add the three additive planning indexes to init_schema_inner** - `16a50ed` (feat)
2. **Task 2: SC4 — additive migration verified on a populated, pre-existing data-home copy** - `ae9dcaf` (test)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `todo-engine/src/infrastructure/sqlite/schema.rs` - Added three `CREATE INDEX IF NOT EXISTS` statements inside the existing index batch; `ensure_item_columns` / `ITEM_COLUMN_ADDITIONS` untouched; `PRAGMA user_version = 1; COMMIT;` remains last.
- `todo-engine/tests/integration/schema_indexes.rs` - SC4 tests: indexes-on-populated-copy with rows + columns intact, no `period_key`, no version bump; in-memory DBs only.
- `todo-engine/tests/integration.rs` - Registered `schema_indexes` module (alphabetical, after `repository`).

## Decisions Made
None - followed plan as specified. Indexes placed exactly between `idx_items_routine_occurrence` and `idx_events_*`; `user_version` left at 1.

## Output Confirmations (required by plan)
- **Three index names:** `idx_items_parent_id`, `idx_items_scheduled`, `idx_items_type_horizon_scheduled`.
- **No `ALTER TABLE`:** confirmed — only `CREATE INDEX IF NOT EXISTS` added; `ensure_item_columns` / `ITEM_COLUMN_ADDITIONS` unchanged.
- **No `period_key`:** confirmed and asserted by `migration_preserves_columns_and_adds_no_period_key`.
- **`user_version` unchanged (stays 1):** confirmed; asserted by the SC4 test and the pre-existing repository tests.
- **Verified on a copied/in-memory DB:** confirmed — tests use `connect(":memory:")` only; the live `~/.todo-engine/todo.sqlite` is never opened.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None. (Git emitted a benign LF->CRLF warning on the new test file on Windows; no action needed.)

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Planning access paths (`parent_id`, `scheduled`, `(type, horizon, scheduled)`) are now indexed and the additive-only contract is test-locked, so Phase 3-4 period/date views can query without any further schema change.
- Phase 01 (domain-schema-foundation) plans 01-03 are complete; phase verification can proceed.

## Self-Check: PASSED

All created/modified files exist on disk and both task commits (`16a50ed`, `ae9dcaf`) are present in git history.

---
*Phase: 01-domain-schema-foundation*
*Completed: 2026-06-22*
