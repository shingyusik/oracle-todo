---
phase: 02-service-policy-goal-create-link-validation
plan: 02
subsystem: api
tags: [rust, goal, policy, validation, audit, horizon, nesting]

# Dependency graph
requires:
  - phase: 01
    provides: "ItemType::Goal, Horizon + is_coarser_than + is_period_start, parse_day, actor-driven status in TodoItem::new, goal SQLite round-trip"
  - phase: 02-01
    provides: "ListFilter horizon/parent_id/scheduled fields (used by the goal duplicate-check query path)"
provides:
  - "ProposeGoal request + propose_goal service method (audited, actor-gated goal create)"
  - "service/goal.rs strict anchor/nesting/duplicate validation helpers"
  - "MAX_GOAL_DEPTH cycle/depth guard constant"
  - "tests/integration/goal_policy.rs (SC1/SC2/SC3a/SC3b) — extended by 02-03"
affects: [02-03-cli-api-goal-create, 02-04-task-goal-link, period-views]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Goal-create policy concentrated in service/goal.rs; validation order anchor -> nesting -> duplicate, all before TodoItem::new"
    - "Defensive ancestor walk (visited HashSet + named depth cap) for cycle/DoS guard against legacy data"
    - "Strict canonical anchor reject (never normalize_to_period_start auto-snap)"

key-files:
  created:
    - todo-engine/src/application/service/goal.rs
    - todo-engine/tests/integration/goal_policy.rs
  modified:
    - todo-engine/src/application/service/creation.rs
    - todo-engine/src/application/service/mod.rs
    - todo-engine/tests/integration.rs

key-decisions:
  - "Goal anchor does NOT inherit the task 'today' sentinel — a goal must be an explicit ISO date (GOAL-03/SC2)."
  - "Parent rule uses strict Horizon::is_coarser_than; equal horizon is rejected (no Ord/<=)."
  - "Duplicate identity = (horizon, canonical scheduled, parent_id) triple; top-level goals share parent_id = None."
  - "Cycle test manufactures cyclic data via update_item (which validates parent type but not the nesting chain), proving the defensive ancestor walk."

patterns-established:
  - "Validation-first create: parse horizon, validate anchor, validate nesting, dedupe, THEN build + store via store_item_and_event."
  - "pub(super) validation helpers on impl TodoService live in a dedicated per-concern module file."

requirements-completed: [GOAL-01, GOAL-03, GOAL-04, GOAL-05, CORE-01]

# Metrics
duration: 18min
completed: 2026-06-22
---

# Phase 2 Plan 02: Goal Create / Validate / Nest Summary

**Policy-core goal create: `propose_goal` + `ProposeGoal` with strict anchor, horizon-inversion/cycle nesting, and duplicate-triple validation, all routed through the single audited `store_item_and_event` path.**

## Performance

- **Duration:** ~18 min
- **Started:** 2026-06-22
- **Completed:** 2026-06-22
- **Tasks:** 2
- **Files modified:** 5 (2 created, 3 modified)

## Accomplishments
- `service/goal.rs` with three `pub(super)` helpers on `impl TodoService`: `validate_goal_anchor` (strict canonical, never auto-snaps), `validate_goal_nesting` (strict coarser-than parent + visited-set/depth-cap ancestor walk), `ensure_goal_not_duplicate` ((horizon, canonical scheduled, parent_id) triple).
- `MAX_GOAL_DEPTH = 64` named constant as the cycle/DoS depth guard (T-02-05).
- `ProposeGoal` request + `propose_goal` method mirroring `propose_project`: validates anchor -> nesting -> duplicate before building the item, then stores via `store_item_and_event` with action `"propose_goal"` (CORE-01, no `save_item` bypass). Actor->status is free via `TodoItem::new` (agent Proposed / user Approved).
- `mod goal;` wired and `ProposeGoal` re-exported from `service`.
- `tests/integration/goal_policy.rs` proving SC1 (actor status + audit), SC2 (today/unparseable/non-canonical/empty -> Validation), SC3a (horizon inversion + equality + manufactured cycle -> Policy), SC3b (duplicate triple -> Policy); registered in `tests/integration.rs`.

## Task Commits

Each task was committed atomically:

1. **Task 1: Create service/goal.rs validation helpers** - `a450a20` (feat)
2. **Task 2: ProposeGoal + propose_goal + SC1-SC3b integration tests** - `15652b8` (feat)

_Note: tasks are `tdd="true"` but config `tdd_mode: false`; helpers in Task 1 are intentionally unused until Task 2 wires them (plan-acknowledged), so they were committed in a single feat commit per task rather than a separate RED/GREEN split._

## Files Created/Modified
- `todo-engine/src/application/service/goal.rs` - Goal anchor/nesting/duplicate validation helpers + MAX_GOAL_DEPTH.
- `todo-engine/src/application/service/creation.rs` - `ProposeGoal` struct + `propose_goal` method.
- `todo-engine/src/application/service/mod.rs` - `mod goal;` wiring + `ProposeGoal` re-export.
- `todo-engine/tests/integration/goal_policy.rs` - SC1/SC2/SC3a/SC3b coverage.
- `todo-engine/tests/integration.rs` - Registered `goal_policy` module (alphabetical, before `goal_roundtrip`).

## Decisions Made
- Goal anchor rejects the `"today"` sentinel that tasks accept — goals require an explicit ISO date (GOAL-03/SC2).
- Parent nesting uses strict `Horizon::is_coarser_than` (equality rejected); no `Ord`/`<=`.
- Cycle test introduces cyclic data through `update_item` (validates parent type/non-terminal via `ensure_relation`, but not the goal nesting chain), which is exactly the legacy-data scenario the defensive ancestor walk guards.

## Deviations from Plan

None - plan executed exactly as written. The only non-task edits were:
- Adding `mod goal;` during Task 1 (the plan assigns wiring to Task 2, but Task 1's `cargo build` verification requires the module be registered or it is an orphaned file; the re-export was still added in Task 2 as planned).
- Two test anchor dates corrected to canonical period starts during the GREEN loop (week anchors must be ISO Mondays): the cycle-case week goal uses `2024-01-01` (Monday). This was a test-data fix found by the test itself, not a behavior change.

## Issues Encountered
- Initial cycle-case test used `2028-06-01` (a Thursday) as a week anchor, which failed `validate_goal_anchor` with `Validation` before reaching the nesting walk. Fixed by using the canonical Monday `2024-01-01`; the cycle then correctly surfaces `TodoError::Policy`.

## Threat Flags

None — no new security surface beyond the plan's `<threat_model>`. T-02-04 (anchor tampering), T-02-05 (cycle DoS), T-02-06 (audit bypass), and T-02-07 (horizon-inversion/wrong-type parent) are all mitigated as planned.

## Known Stubs

None — `propose_goal` is fully wired through validation and the audited store path; no placeholder/empty-data flows.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `propose_goal`/`ProposeGoal` ready for 02-03 (CLI/API goal create) to wrap as a thin adapter.
- `tests/integration/goal_policy.rs` exists for 02-03 to extend.
- Full suite green: `cargo test` (44 unit + integration + e2e all pass), `cargo fmt --check` clean, `cargo clippy --all-targets --all-features -- -D warnings` clean.

## Self-Check: PASSED

- Files: all 5 present (goal.rs, creation.rs, mod.rs, goal_policy.rs, integration.rs).
- Commits: `a450a20`, `15652b8` both in git log.

---
*Phase: 02-service-policy-goal-create-link-validation*
*Completed: 2026-06-22*
