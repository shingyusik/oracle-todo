# Remove Proposed and Approved Statuses Design

**Date:** 2026-07-16
**Status:** Approved
**Scope:** Make `active` a truthful stored status by removing the approval lifecycle from the engine and frontend.

## Goal

The status shown in the UI must equal the status returned by the API and stored in SQLite. New work
enters the active lifecycle directly; no proposal or approval transition exists.

## Status Model

- Remove `proposed` and `approved` from `ItemStatus`.
- New areas, projects, tasks, routines, events, goals, and generated routine tasks start as `active`.
- The open working set contains `active` only.
- Keep the remaining lifecycle unchanged: `active`, `waiting`, `paused`, `completed`, `cancelled`,
  `dropped`, `archived`, `someday`, and `rejected`.
- Routine pause/resume cascades move generated tasks between `waiting` and `active`.

## Creation Validation

Projects and routines are complete at creation:

- Project creation requires a non-empty, trimmed `definition_of_done`.
- Routine creation requires a supported, non-empty `recurrence_rule`.
- The Rust service enforces both rules for CLI and API callers.
- Existing goal, event, relation, period, and materialization validation remains unchanged.

## Existing Data Migration

SQLite schema initialization performs an additive, idempotent data migration:

```sql
UPDATE items
SET status = 'active'
WHERE status IN ('proposed', 'approved');
```

- Migration runs before rows are decoded into `ItemStatus`.
- Existing domain content is not invented: missing project definitions or routine rules remain empty
  and can be edited after migration.
- Legacy `proposed_by`, `approved_by`, and `approved_at` columns remain for schema compatibility and
  historical provenance; new code does not use them for authorization or status decisions.

## CLI and API

- Remove the `approve` and `activate` service methods, CLI commands, and API routes.
- Creation endpoints and CLI creation command names remain compatible, including existing
  `/propose` paths; they create `active` items.
- `pending` remains a convenience view and returns active work only.
- Remove approval-specific policy errors and transition types.

## Frontend Creation

The existing New dialog gains type-specific required fields:

- Project: `Definition of Done` text input.
- Routine: the existing recurrence editor, initialized to `Every 1 / Daily`
  (`RRULE:FREQ=DAILY`).

The creation request includes the entered value. Blank required values keep the dialog open and
render an inline `role="alert"` message. API validation failures use the same alert path. A second
modal or browser alert is not added.

## Frontend Status Behavior

- Remove the stored-to-visible status alias that maps `proposed` and `approved` to `active`.
- Status selectors render the actual API status.
- Remove `approve`, `activate`, and `activateIfNeeded` client transitions.
- Creation inserts the single active item returned by the API without a follow-up request.
- Remove proposal and approval labels from planner status grouping and frontend fixtures.

## Error Handling

- Missing Project definition: HTTP `400` / CLI validation exit with
  `Project requires definition_of_done`.
- Missing Routine recurrence: HTTP `400` / CLI validation exit with
  `Routine requires recurrence_rule`.
- Frontend client validation uses equivalent user-facing messages before issuing a request.
- Storage and internal errors keep their existing status and exit-code mapping.

## Documentation

- Update current-state README, CLI/API references, architecture overview, and verification guidance.
- Mark ADR-0003 approval gating as superseded by this design.
- Remove approval-gating language from agent guidance and examples.

## Verification

- Domain tests prove the status enum no longer parses or serializes `proposed` or `approved`.
- Service tests prove all creators produce active items and enforce Project/Routine creation fields.
- SQLite integration tests prove migration is idempotent and old statuses load as active.
- CLI/API end-to-end tests prove removed transitions are unavailable and creation returns active.
- Frontend presentation tests prove conditional fields, inline alerts, request bodies, and truthful
  status rendering.
- Full Rust and frontend format, lint, test, typecheck, and build gates pass.

## Out of Scope

- Dropping or renaming legacy SQLite provenance columns.
- Renaming existing creation commands or `/propose` routes.
- Inventing default content for migrated Project definitions.
- Changing non-approval terminal statuses.
