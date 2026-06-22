# ADR-0006: Goals reuse the ItemStatus lifecycle with no cascade

## Status

Accepted (v1, 2026-06-22).

## Context

The planning layer adds a `Goal` item type: a period plan (year / month / week)
that decomposes top-down into tasks and nests under coarser goals via `parent_id`.
A goal is a first-class `items` row that flows through the same `TodoService` policy,
audit, and approval gating as every other item type. That raises a question the
Phase 4 period-view (rollup) work would otherwise re-litigate: what does an
`ItemStatus` *mean* for a goal, and does a goal's status change ripple to the goals
and tasks beneath it?

Two pressures push toward over-engineering here. First, "goal" intuitively invites
health states (`on_track` / `at_risk`) derived from child progress. Second,
completing a goal intuitively invites auto-completing its children. Both would add
new machinery, and progress rollup is explicitly out of scope for v1 (tree + date
views only). The engine already has exactly one cascade — a routine cascading to its
generated tasks (`transitions.rs`) — and that mechanism is specific to routine
materialization, not to `parent_id` nesting.

## Decision

A `Goal` reuses the existing `ItemStatus` lifecycle **unchanged**, with three rules:

- **No new states.** Goals use the same lifecycle as every other item
  (`proposed` → `approved` → `active` → terminal). Goal-specific health states such
  as `on_track` / `at_risk` are explicitly out of scope and deferred to v2, where they
  would be *derived* signals over the goal tree, not stored statuses.
- **`active` means "in its period."** Agent-created goals start `proposed` and
  user-created goals start `approved` (actor-driven, via `TodoItem::new`); the agent
  approval gate still applies before activation. Activation has no goal-specific
  precondition in v1 — the `activate` path special-cases `Project` / `Routine` / `Area`
  but has no `Goal` branch, so a goal activates with no extra requirement and is then
  meaningfully `active` for its period.
- **No cascade on terminal status.** `completed` / `dropped` / `cancelled` are
  user-driven and terminal. A goal reaching a terminal status does **not** cascade
  completion, drop, or cancellation to its child goals or its linked tasks. The only
  cascade in the engine is routine → generated tasks; it does not apply to goals.

## Consequences

- Goals inherit status validation, the state machine, approval gating, and mandatory
  audit events for free — no goal-specific status code to maintain or test.
- Completing or dropping a goal never silently mass-completes or mass-drops the work
  beneath it, avoiding accidental data loss when a user closes out a period.
- The Phase 4 period view stays structure-only: it reads the goal tree and tasks by
  status without inferring or writing derived states. Rollup and health signals can be
  layered on additively in v2 as read-side derivations, with this ADR superseded if the
  derived-state model changes.
- A child goal or linked task can outlive a terminal parent; period views and any future
  rollup must treat parent terminality as informational, not as a child-state override.
