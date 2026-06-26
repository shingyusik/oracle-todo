---
phase: 05-cli-api-surface-parity-locked
plan: 02
subsystem: api
tags: [axum, http-api, goal, period-view, json, parent-link, query-extractor]

# Dependency graph
requires:
  - phase: 05-cli-api-surface-parity-locked
    plan: 01
    provides: CLI surface (goal propose / agenda / date-range / period / update --parent-id) to mirror for parity
  - phase: 02-goal-create-and-task-link
    provides: propose_goal service method, update_item parent_id validation
  - phase: 03-date-views
    provides: agenda / date_range side-effect-free read methods
  - phase: 04-period-view-goal-tree-rollup
    provides: period_view + PeriodView serde type
provides:
  - "`POST /goals/propose` mirroring `/projects/propose`; agent-default actor keeps goals proposed (SC4)"
  - "`GET /views/agenda?date=`, `GET /views/date-range?from=&to=`, `GET /views/period?horizon=&period=` calling identical service methods (CORE-03)"
  - "`parent_id` wired through BOTH UpdateBody DTO and update_item handler so `PATCH /items/:id` persists task->goal links (Pitfall 1 fixed)"
affects: [05-03-paired-e2e-tests]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Thin axum adapter: handler calls one service method via with_service, serializes the return type (CORE-03)"
    - "View GET routes use axum::extract::Query DTOs; only view_period parses Horizon (period_view takes the enum)"
    - "parse_actor_or_default (default Agent) reused on propose_goal for approval gating (SC4)"

key-files:
  created: []
  modified:
    - todo-engine/src/interfaces/api/mod.rs
    - todo-engine/src/interfaces/api/handlers.rs
    - todo-engine/src/interfaces/api/dto.rs

key-decisions:
  - "Handlers forward raw strings to the service; the service owns horizon/date/anchor parsing and validation (no policy in api/)."
  - "Only view_period parses Horizon (period_view's signature requires the enum); the parse error maps to TodoError::Validation -> HTTP 400."
  - "Task->goal linking reuses PATCH /items/:id (update_item); BOTH the DTO field AND the handler de-hardcode are required (Pitfall 1) — field alone silently no-ops."

patterns-established:
  - "/goals/propose cloned from /projects/propose route + handler + body DTO."
  - "/views/* GET routes grouped under a /views prefix (D-10), consistent with /items reads."

requirements-completed: [SURF-02, CORE-03]

# Metrics
duration: 6min
completed: 2026-06-26
---

# Phase 5 Plan 02: HTTP API Surface (goals/views/link) Summary

**Phase 5 HTTP API surface mirroring the CLI half: `POST /goals/propose`, three JSON `GET /views/*` read routes, and `parent_id` wired end-to-end through `PATCH /items/:id` — all thin axum adapters calling the identical `TodoService` methods with zero new policy or view logic.**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-06-26T02:24:10Z
- **Completed:** 2026-06-26T02:30:00Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments
- `POST /goals/propose` reachable over HTTP, mirroring `propose_project`; `parse_actor_or_default` defaults `Agent` so an agent-created goal starts `proposed` (SC4 — behavioral proof owned by 05-03).
- Three view read routes — `GET /views/agenda?date=`, `GET /views/date-range?from=&to=`, `GET /views/period?horizon=&period=` — call `agenda` / `date_range` / `period_view` and serialize the same `Vec<TodoItem>` / `PeriodView` types the CLI emits (CORE-03 re-confirmed). Only `view_period` parses `Horizon`; agenda/date-range pass raw `&str` (Pitfall 2).
- `parent_id` added to `UpdateBody` AND `update_item` de-hardcoded from `parent_id: None` to `body.parent_id`, so API task->goal linking actually persists rather than silently no-op'ing (Pitfall 1, LINK-01/LINK-02).
- `cargo build -p todo-engine`, `cargo clippy --all-targets --all-features -- -D warnings`, and `cargo fmt --check` all green; unit 49/49, integration 62/62, lib 2/2 pass.

## Task Commits

Each task was committed atomically:

1. **Task 1: POST /goals/propose route + propose_goal handler + GoalProposeBody DTO** - `886a358` (feat)
2. **Task 2: GET /views/{agenda,date-range,period} routes + Query handlers + DTOs** - `3f3c779` (feat)
3. **Task 3: parent_id wired through UpdateBody DTO + update_item handler** - `f04af42` (feat)

## Files Created/Modified
- `todo-engine/src/interfaces/api/mod.rs` - `/goals/propose` POST route; `/views/agenda`, `/views/date-range`, `/views/period` GET routes added to the `Router::new()` chain.
- `todo-engine/src/interfaces/api/handlers.rs` - `propose_goal` handler (builds `ProposeGoal`, calls `service.propose_goal`); `view_agenda` / `view_date_range` / `view_period` Query handlers (call + serialize only; only `view_period` parses `Horizon`); `update_item` `parent_id: None` -> `body.parent_id`; imports extended (`GoalProposeBody`/`AgendaQuery`/`DateRangeQuery`/`PeriodQuery` DTOs, `ProposeGoal`/`PeriodView` service types, `Horizon` domain type).
- `todo-engine/src/interfaces/api/dto.rs` - `GoalProposeBody`, `AgendaQuery`, `DateRangeQuery`, `PeriodQuery` DTOs; `parent_id: Option<String>` added to `UpdateBody`.

## Decisions Made
- None beyond the plan. Handlers forward raw strings; only `view_period` parses `Horizon` (the one place the service signature requires an enum), mapping the parse error to `TodoError::Validation` so an invalid horizon yields HTTP 400 with no panic. To avoid clippy `-D warnings` failures from unused imports, the Task 2 DTO/service/domain imports were added in Task 2 rather than front-loaded in Task 1 — each commit builds and lints clean on its own.

## Deviations from Plan

None - plan executed exactly as written. (`cargo fmt` reflowed the `view_date_range` and `view_period` `with_service` closures across lines after the manual edit; cosmetic, no behavior change.)

## Issues Encountered
None for planned work. The full test run surfaces one failure — `cli::init_loads_todo_engine_home_from_dotenv` (e2e) — which is the **pre-existing deferred dotenv failure** documented in STATE.md (Phase 04.1 Plan 03: "init resolves default home not .env TODO_ENGINE_HOME") and already noted in 05-01-SUMMARY. It is unrelated to this plan's changes (no init/dotenv code touched — only API surface) and remains deferred/out of scope.

## Known Stubs
None. No hardcoded empty values flow to output; empty `agenda`/`period` results (`[]` / empty `roots`) reflect a genuinely empty store, not stubs. The previously-hardcoded `parent_id: None` in `update_item` is explicitly removed by this plan (the opposite of a stub).

## Threat Surface
All new surface maps to the plan's `<threat_model>` register (T-05-API-01..05). No new endpoints, auth paths, file access, or schema changes beyond those planned: the three view routes expose existing side-effect-free reads, `/goals/propose` reuses the `parse_actor_or_default` gating entry, and `parent_id` linking routes through `update_item`'s existing `ensure_relation` Goal/non-terminal check. No threat flags.

## User Setup Required
None - no external service configuration required; no new dependencies installed.

## Next Phase Readiness
- Plan 05-03 (paired e2e tests) can now consume the new routes — `POST /goals/propose`, `GET /views/{agenda,date-range,period}`, `PATCH /items/:id {"parent_id":...}` — via `router(..)` + `oneshot`, asserting CLI/API parity, SC4 (agent goal starts `proposed`, cannot start `active`), and the Pitfall-1 regression guard (`parent_id` is non-null after linking).

## Self-Check: PASSED

- Modified files present: api/mod.rs, api/handlers.rs, api/dto.rs (all exist, all compile, clippy clean).
- Commits present: 886a358, 3f3c779, f04af42.

---
*Phase: 05-cli-api-surface-parity-locked*
*Completed: 2026-06-26*
