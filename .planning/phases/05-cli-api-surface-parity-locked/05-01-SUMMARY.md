---
phase: 05-cli-api-surface-parity-locked
plan: 01
subsystem: api
tags: [clap, cli, goal, period-view, json, parent-link]

# Dependency graph
requires:
  - phase: 02-goal-create-and-task-link
    provides: propose_goal service method, update_item parent_id validation
  - phase: 03-date-views
    provides: agenda / date_range side-effect-free read methods
  - phase: 04-period-view-goal-tree-rollup
    provides: period_view + PeriodView/GoalNode serde types
provides:
  - "`goal propose` grouped CLI subcommand calling service.propose_goal (JSON, agent-default = proposed)"
  - "`agenda <date>` / `date-range <from> <to>` / `period --horizon --period` flat top-level view commands (JSON-only)"
  - "`update --parent-id <goal>` task->goal linking through the audited update_item path"
affects: [05-02-api-surface, 05-03-paired-e2e-tests]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Thin clap adapter: parse args, forward raw strings, call one service method (CORE-03)"
    - "New views emit print_json only (D-01); render_items untouched"
    - "Only the period adapter parses Horizon (map_err -> TodoError::Validation -> exit 2)"

key-files:
  created: []
  modified:
    - todo-engine/src/interfaces/cli/mod.rs
    - todo-engine/src/interfaces/cli/create.rs
    - todo-engine/src/interfaces/cli/views.rs
    - todo-engine/src/interfaces/cli/lifecycle.rs

key-decisions:
  - "Adapters forward --horizon/--scheduled/dates as raw strings; the service owns all parsing and validation (no policy in cli/)."
  - "period is the only handler that parses Horizon, because period_view takes the Horizon enum; the parse error maps to TodoError::Validation (exit 2)."
  - "Task->goal linking reuses update --parent-id over the audited update_item path; no bespoke link command (D-07)."

patterns-established:
  - "Grouped { Propose } subcommand cloned for goal (mirrors project/task)."
  - "Flat top-level view commands (agenda/date-range/period) consistent with today/pending (D-05)."

requirements-completed: [SURF-01]

# Metrics
duration: 12min
completed: 2026-06-26
---

# Phase 5 Plan 01: CLI Surface (goal/views/link) Summary

**Phase 5 CLI surface over the existing TodoService: `goal propose`, JSON-only `agenda`/`date-range`/`period` views, and `update --parent-id` task->goal linking — all thin adapters with zero new policy.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-06-26T02:13:00Z
- **Completed:** 2026-06-26T02:20:00Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments
- `goal propose <title> --horizon <h> --scheduled <date> [--parent] [--note] [--actor]` reachable from the CLI; agent-default actor keeps goals `proposed` (SC4 confirmed by smoke).
- Three flat top-level view commands — `agenda <date>`, `date-range <from> <to>`, `period --horizon <h> --period <date>` — all emit JSON via `print_json` (D-01); `render_items` untouched.
- `update --parent-id <goal>` forwards through the audited `update_item` path, de-hardcoding the `parent_id: None` placeholder; non-Goal/terminal parents reject with exit 2.
- `cargo build`, `cargo clippy -- -D warnings`, and `cargo fmt --check` all green; unit 49/49, integration 62/62, lib 2/2 pass.

## Task Commits

Each task was committed atomically:

1. **Task 1: Goal grouped subcommand + goal_propose handler** - `4d0c810` (feat)
2. **Task 2: agenda / date-range / period flat view commands (JSON-only)** - `88fd304` (feat)
3. **Task 3: --parent-id on update for task->goal linking** - `891186f` (feat)

## Files Created/Modified
- `todo-engine/src/interfaces/cli/mod.rs` - `GoalCommand` enum + `GoalProposeArgs`; `Command::Goal` variant; `Agenda`/`DateRange`/`Period` flat variants + arg structs; `--parent-id` field on `UpdateArgs`; dispatch + `command_label` arms for all new variants.
- `todo-engine/src/interfaces/cli/create.rs` - `goal_propose` handler building `ProposeGoal` and calling `service.propose_goal`; imports updated.
- `todo-engine/src/interfaces/cli/views.rs` - `agenda` / `date_range` / `period` handlers emitting `print_json`; `Horizon` + `TodoError` imports added.
- `todo-engine/src/interfaces/cli/lifecycle.rs` - `update` now forwards `parent_id: args.parent_id` (was hardcoded `None`).

## Decisions Made
- None beyond the plan. Adapters forward raw strings; only `period` parses `Horizon` (the one place the service signature requires an enum), with the error mapped to `TodoError::Validation` so invalid horizon yields exit 2 with no panic.

## Deviations from Plan

None - plan executed exactly as written. (`cargo fmt` reflowed the `period` handler's `parse().map_err()` chain across lines after the manual edit; cosmetic, no behavior change.)

## Issues Encountered
None for planned work. The full test run surfaces one failure — `cli::init_loads_todo_engine_home_from_dotenv` (e2e) — which is the **pre-existing deferred dotenv failure** documented in STATE.md (Phase 04.1 Plan 03: "init resolves default home not .env TODO_ENGINE_HOME"). It is unrelated to this plan's changes (no init/dotenv code touched) and remains deferred/out of scope.

## Known Stubs
None. No hardcoded empty values flow to output; empty `agenda`/`period` results (`[]` / empty `roots`) reflect a genuinely empty store, not stubs.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Plan 05-02 (API half) can mirror these surfaces: `POST /goals/propose`, `GET /views/{agenda,date-range,period}`, and `parent_id` on the update DTO/handler.
- Plan 05-03 (paired e2e tests) can consume the new command names (`goal propose`, `agenda`, `date-range`, `period`, `update --parent-id`) to assert CLI/API parity + SC4.

## Self-Check: PASSED

- Modified files present: cli/mod.rs, cli/create.rs, cli/views.rs, cli/lifecycle.rs (all exist, all compile).
- Commits present: 4d0c810, 88fd304, 891186f.

---
*Phase: 05-cli-api-surface-parity-locked*
*Completed: 2026-06-26*
