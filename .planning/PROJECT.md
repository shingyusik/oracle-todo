# todo-engine — Planning Layer

## What This Is

`todo-engine` is a policy-enforced, local-first personal ToDo engine (Rust 2024) for agent workflows, with SQLite as the single source of truth and CLI + HTTP API as views over it. This milestone adds a **planning layer**: hierarchical period goals (yearly / monthly / weekly) that decompose top-down into tasks, plus date-based and goal-tree views so existing tasks can be planned, scheduled, and reviewed by period.

## Core Value

A user can set a big goal for a period (year/month/week), break it top-down into tasks, and see those tasks by date — all through the same policy-enforced engine (validation, status state machine, audit events, approval gating). If everything else fails, top-down goal → task decomposition with date visibility must work.

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

### Active

<!-- This milestone. Hypotheses until shipped and validated. -->

- [ ] New `Goal` item type representing a period goal at year / month / week horizon
- [ ] A goal is anchored to a specific period via `(horizon, scheduled)` — e.g. month goal = `horizon:month` + `scheduled:2026-06-01`
- [ ] Goals nest flexibly via `parent_id` (level-skipping allowed; a sub-goal or task may attach at any level)
- [ ] A task connects to a goal via `parent_id` and carries a `scheduled` date
- [ ] Date view: list tasks grouped by `scheduled` date for a given day/range
- [ ] Period views: week / month / year views roll up the goal tree (goals + their decomposed tasks)
- [ ] All planning mutations route through `TodoService` (validation, state machine, audit event, approval gating reused — no new bypass)
- [ ] Schema changes are additive only (extend `items`; no dropped/rewritten columns)
- [ ] CLI subcommands for creating goals, linking tasks, and the date/period views
- [ ] HTTP API endpoints mirroring the new CLI/service behavior (CLI/API parity preserved)

### Out of Scope

- Progress rollup / completion-rate aggregation in period views — deferred to v2 (v1 ships goal-tree + date views only)
- Frontend (Next.js `frontend/`) planning UI — deferred to a later milestone; this milestone is backend (DB + service + CLI + API)
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
- **Architecture**: All mutations through `TodoService`; never bypass to the repository. Domain stays I/O-free. — preserves the core invariant.
- **Schema**: Additive only — `init_schema()` creates tables and backfills missing columns; do not drop or rewrite existing columns. — protects existing live data homes.
- **Data safety**: Never aim destructive experiments at `~/.todo-engine/todo.sqlite`; copy to a temp home for smoke checks. — live data home is canonical.
- **Period identity**: Goals identified by `(horizon, scheduled)` combo; no new schema column for period key — reuse existing fields.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| `Goal` as a new `ItemType` (not reuse Project / not separate table) | Reuses status lifecycle, audit, approval gating, and the `horizon` field; minimal new machinery | — Pending |
| Period anchored by `(horizon, scheduled)` instead of a new `period_key` column | Keeps schema change to the item-type enum; no additive column needed | — Pending |
| Flexible nesting via `parent_id` (level-skipping allowed) | Real planning skips levels (month → task directly); strict chain too rigid | — Pending |
| Task→goal link via `parent_id` + task `scheduled` date | Goal tree powers period views; `scheduled` powers date view; both needed | — Pending |
| Progress rollup deferred to v2 | Keep v1 scope to tree + date views; aggregation is additive later | — Pending |
| Backend + CLI + HTTP API this milestone; frontend later | User scoped "db와 관련 cli"; API kept for CLI/API parity | — Pending |

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
*Last updated: 2026-06-22 after initialization*
