# todo-engine — Planning Layer

## What This Is

`todo-engine` is a policy-enforced, local-first personal ToDo engine (Rust 2024) for agent workflows, with SQLite as the single source of truth and CLI + HTTP API as views over it. The shipped planning layer supports hierarchical period goals (yearly / monthly / weekly), top-down task decomposition, date-based views, and goal-tree views. The current milestone adds a frontend workbench MVP over that API so daily planning and workspace item management are usable from the browser.

## Core Value

A user can set a big goal for a period (year/month/week), break it top-down into tasks, and then run the day from a browser workbench: see the agenda, create dated tasks/events, adjust schedule fields, and move items through the same policy-enforced status lifecycle.

## Current Milestone: v1.1 Frontend Planning Workbench MVP

**Goal:** Make the shipped planning API usable from the frontend for daily planning and workspace item management.

**Target features:**
- Daily Planner: select a date, view agenda items, transition status, edit scheduled/due fields, and create task/event items for that date.
- Workspace Table Polish: tune Areas / Projects / Routines / Tasks / Events / Goals columns around the fields users actually need to scan.
- Inline Editing: expose supported relation/date/priority/status edits through the existing service-backed API paths.
- Minimal API Support: add only thin API support where the frontend would otherwise become awkward or duplicate backend policy.

## Requirements

### Validated

<!-- Inferred from existing codebase (see .planning/codebase/). Shipped and relied upon. -->

- ✓ Item model with Area / Project / Routine / Task / Event / Review types and status lifecycle — existing
- ✓ `TodoService` policy layer: validation + status state machine, single mutation path — existing
- ✓ Approval gating: agent-created items start `proposed`, user-created start `approved` — existing
- ✓ Mandatory audit events: every service mutation writes a `TodoEvent` row — existing
- ✓ SQLite repository with additive schema init (creates tables, backfills missing columns) — existing
- ✓ CLI surface (`init`, `health`, `list`, item CRUD, status transitions, `pending`, `today`) — existing
- ✓ axum HTTP API mirroring CLI/service behavior on `127.0.0.1:3002` — existing
- ✓ Item fields available as planning hooks: `parent_id`, `due`, `scheduled`, `horizon` (reserved, unused) — existing
- ✓ New `Goal` item type representing a period goal at year / month / week horizon — Phase 2
- ✓ A goal is anchored to a specific period via `(horizon, scheduled)` (strict canonical anchor, no `today` sentinel) — Phase 2
- ✓ Goals nest flexibly via `parent_id` (level-skipping allowed; strictly-coarser horizon enforced, cycles rejected) — Phase 2
- ✓ A task connects to a goal via `parent_id` and carries a `scheduled` date (audited `update_item` path) — Phase 2
- ✓ Service-layer read primitive: `ListFilter` `horizon` / `parent_id` / `scheduled` predicates over both in-memory and persistent SQLite list paths — Phase 2
- ✓ Date view: `agenda` (single-date `scheduled` ∪ `due`, deduped) + `date_range` ([from, to] scheduled-only), in `queries.rs`, side-effect-free, deterministic order, store-parity proven — Phase 3
- ✓ Period view: `period_view(horizon, period)` rolls up the goal tree (goals + decomposed tasks) over both InMemory and Persistent (SQLite recursive-CTE) stores via one shared in-memory `assemble()` walk — depth-capped, cycle-safe (never errors), side-effect-free, store-parity proven (VIEW-03 / VIEW-04) — Phase 4
- ✓ CLI subcommands for creating goals, linking tasks, and the date/period views (`goal propose`, flat `agenda`/`date-range`/`period`, `update --parent-id`) — Phase 5 (SURF-01)
- ✓ HTTP API endpoints mirroring the new CLI/service behavior (`POST /goals/propose`, `GET /views/*`, `parent_id` on `PATCH /items/:id`); CLI/API parity locked by paired e2e tests — Phase 5 (SURF-02)
- ✓ All planning mutations route through `TodoService` (interface adapters add no policy/validation/view logic — parse-and-call only) — Phase 5 (CORE-03)
- ✓ Schema changes are additive only (extend `items`; no dropped/rewritten columns) — held across milestone (no schema change in Phase 5)

### Active

<!-- This milestone. Hypotheses until shipped and validated. -->

- Daily planner frontend over `GET /views/agenda` with date selection and item list.
- Daily planner mutations for status transitions, scheduled/due edits, and same-date task/event creation.
- Workspace table column definitions and inline editing behavior tuned per item type.
- Minimal API additions allowed only when they keep the frontend thin and preserve `TodoService` as the mutation policy boundary.

### Out of Scope

- Progress rollup / completion-rate aggregation in period views — deferred beyond v1.1
- Weekly / Monthly / Yearly planner UI — deferred beyond v1.1
- Goal tree / period-view dedicated frontend — deferred beyond v1.1
- Drag-and-drop calendar scheduling — deferred beyond v1.1
- New frontend design system — existing workbench patterns stay the base for v1.1
- New goal-specific status states — reuse the existing `ItemStatus` lifecycle rather than inventing planning-only states
- Second_Brain write-back — `second_brain_refs` stay read-only (existing invariant)
- Concerns surfaced in the codebase map (in-memory filtering, WAL/busy_timeout, API auth) — not this milestone unless a planning requirement forces it

## Context

- **Brownfield.** The engine is mature; planning is layered on top of the existing item model. Codebase map: `.planning/codebase/` (STACK, ARCHITECTURE, STRUCTURE, CONVENTIONS, TESTING, INTEGRATIONS, CONCERNS).
- **Existing hooks make this additive.** `TodoItem` already has `parent_id`, `due`, `scheduled`, and a reserved `horizon` field documented as "Planning horizon; available for future views" — currently stored but unused. The planning layer is the first consumer of `horizon`.
- **Clean/hexagonal layering.** `domain` (pure) → `application` (`TodoService`, ports, error) → `infrastructure` (`sqlite`, paths, system) + `interfaces` (`cli`, `api`). Dependencies point inward; domain does no I/O.
- **Layered tests guard parity.** `todo-engine/tests/{unit,integration,e2e}`; e2e (`cli`, `api`) and integration suites assert CLI/API agree with the service layer — must stay green.

## Constraints

- **Tech stack**: Rust 2024, rusqlite (bundled SQLite), axum 0.7, clap 4.5, tokio, tracing — match existing dependencies, no new heavy deps without reason.
- **Frontend stack**: Next.js 14, React 18, TypeScript, lucide-react, Vitest/testing-library — use existing workbench structure and installed dependencies.
- **Architecture**: All mutations through `TodoService`; never bypass to the repository. Domain stays I/O-free. — preserves the core invariant.
- **Frontend scope**: Reuse existing workbench controller/model/table patterns before introducing new abstractions.
- **Schema**: Additive only — `init_schema()` creates tables and backfills missing columns; do not drop or rewrite existing columns. — protects existing live data homes.
- **Data safety**: Never aim destructive experiments at `~/.todo-engine/todo.sqlite`; copy to a temp home for smoke checks. — live data home is canonical.
- **Period identity**: Goals identified by `(horizon, scheduled)` combo; no new schema column for period key — reuse existing fields.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| `Goal` as a new `ItemType` (not reuse Project / not separate table) | Reuses status lifecycle, audit, approval gating, and the `horizon` field; minimal new machinery | ✓ Shipped v1.0 — Goal round-trips through SQLite with zero schema change |
| Period anchored by `(horizon, scheduled)` instead of a new `period_key` column | Keeps schema change to the item-type enum; no additive column needed | ✓ Shipped v1.0 — period identity derives from `(horizon, scheduled)`, no `period_key` |
| Flexible nesting via `parent_id` (level-skipping allowed) | Real planning skips levels (month → task directly); strict chain too rigid | ✓ Shipped v1.0 — level-skipping allowed; cycles + horizon-inversion rejected |
| Task→goal link via `parent_id` + task `scheduled` date | Goal tree powers period views; `scheduled` powers date view; both needed | ✓ Shipped v1.0 — audited `update_item` link path; powers both views |
| Progress rollup deferred to v2 | Keep v1 scope to tree + date views; aggregation is additive later | ✓ Held — period views ship structure-only; rollup remains v2 (ROLL-01/02) |
| Backend + CLI + HTTP API this milestone; frontend later | User scoped "db와 관련 cli"; API kept for CLI/API parity | ✓ Shipped v1.0 (backend); a workspace item-table frontend (`feature/workspace-item-table-editing`) was merged onto main post-milestone as a v1.x/v2 seed |
| Daily planner first for frontend | One daily workflow creates immediate browser value without forcing Weekly/Monthly/Goal-tree UI design | Active v1.1 — ship Daily plus workspace table polish before broader planner surfaces |
| Minimal API support only | Frontend should stay thin, but API should absorb awkward policy-shaped gaps | Active v1.1 — add small API support only when existing endpoints make the UI duplicate service logic |

## Current State

**Shipped: v1.0 Planning Layer (2026-06-26)** — 6 phases, 19 plans, 35 tasks. All 17 v1
requirements (GOAL×5, LINK×2, VIEW×5, SURF×2, CORE×3) satisfied and milestone-audited
(`milestones/v1.0-MILESTONE-AUDIT.md`, passed; re-audited clean after the frontend merge).

- **Backend** (`todo-engine/`, ~5.1k LOC Rust src + tests): `Goal` item type, period-anchor
  normalization, goal create/nest/link policy through `TodoService`, agenda/date-range/period
  views over InMemory + SQLite (recursive CTE) with proven store parity, parity-locked CLI +
  HTTP API. Gates green (build/clippy `-D warnings`/fmt); unit 49, integration 62, e2e 38/39.
- **Frontend** (`frontend/`): a workspace item-table editing UI (React/TSX) landed on main via
  `feature/workspace-item-table-editing` (merge `e00bb3b`) — first consumer of the API surface,
  not yet test-verified in this environment (deps not installed). Seeds a future frontend milestone.
- **Known tech debt** (non-blocking): Nyquist coverage partial (phases 01/02/03/04.1); code-review
  WR-01 (API approve/complete lack `--reason`); CLI `list` does not expose the parent/horizon/scheduled
  filters the API exposes. v2 backlog: COVER-01, ROLL-01/02, KR-01, CARRY-01.
- **Known deferred bug**: `cli::init_loads_todo_engine_home_from_dotenv` (init resolves default home,
  not `.env TODO_ENGINE_HOME`) — carried since Phase 3, out of scope.

**Active: v1.1 Frontend Planning Workbench MVP (started 2026-06-27)** — Daily Planner plus
Workspace table polish over the shipped API. Scope is frontend-first with minimal API support only
when it keeps UI code thin and policy-compliant.

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-06-27 — v1.1 Frontend Planning Workbench MVP started: Daily Planner plus Workspace table polish over the shipped planning API.*
