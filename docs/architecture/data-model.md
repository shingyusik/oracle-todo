# Data Model

`todo-engine` stores everything in one SQLite `items` table plus an `events` audit table.
This page describes the item types, their invariants, the `ItemStatus` lifecycle, and the
event contract. The **canonical column tables** (every column, its type, and meaning) live
in [`README.md`](../../README.md) — see its "Shared item columns", per-type column tables,
and "Event log" sections. This page does not duplicate them; it explains the semantics the
service layer enforces on top of them.

## Item types

The `type` column (Rust enum `ItemType`, serialized in `snake_case`) is one of:
`area`, `project`, `routine`, `task`, `event`, `review`, `archive_item`, `goal`. The actively
created/managed types and their invariants:

- **`area`** — a long-lived responsibility domain (e.g. `재정`, `건강`). Created `active`
  immediately. Areas are *not* completed as ordinary work; they are paused or archived.
  Owns standards and a review rhythm.
- **`project`** — finite, outcome-oriented work inside an area. Cannot become `active`
  without a `definition_of_done`. Should represent outcomes, not single actions.
- **`routine`** — a recurring work template. Cannot become `active`/materialize without a
  `recurrence_rule`. Active routines materialize task instances through the service layer;
  generated tasks link back via `routine_id` and are de-duplicated by `occurrence_key`.
  `materialization_policy` is `single_open` (default — at most one open generated task per
  routine) or `per_occurrence` (one task per occurrence in the window).
- **`task`** — a concrete action item. Agent-created tasks start `proposed`; user-created
  tasks start `approved`. May belong to an area, a (non-terminal) project, or a
  (non-terminal) routine.
- **`event`** — an external commitment / scheduled appointment. Requires `scheduled`. Uses
  `metadata` for location, participants, and commitment type. Listed separately from tasks.
- **`review`** — a scheduled review/checkpoint item (reserved type).
- **`archive_item`** — a historical/terminal item type (reserved type).
- **`goal`** — a period-scoped planning goal (reserved type). Recognized and persisted with
  an optional `horizon` (`year` / `month` / `week`) and round-trips through SQLite; there is
  no dedicated creation command — the service-layer create/link/validation path is a separate
  planning-layer concern.

`ItemType` round-trips through `ItemType::as_str()` / `FromStr` using these exact canonical
lowercase strings (with `archive_item` snake-cased). Unknown strings are rejected.

## Actor

The `proposed_by` / `approved_by` columns use the `Actor` enum: `user`, `agent`, `system`
(serialized lowercase). At creation, an item authored by `user` is auto-approved
(`status = approved`, `approved_by = user`, `approved_at = now`); any other actor leaves the
item `proposed` with no approval markers. This is the mechanism behind approval gating —
see [decisions/adr-0003-approval-gating.md](decisions/adr-0003-approval-gating.md).
SQLite reads treat legacy `oracle` actor values as `agent`; new writes use only the canonical
`user`, `agent`, and `system` values.

## Status lifecycle

The `status` column is the Rust enum `ItemStatus` (serialized lowercase). It has **11
variants**, verified against `todo-engine/src/domain/status.rs`:

| Phase | Statuses |
| --- | --- |
| Proposal | `proposed`, `rejected` |
| Live work | `approved`, `active`, `waiting`, `paused` |
| Terminal | `completed`, `cancelled`, `dropped`, `archived`, `someday`, `rejected` |

- `proposed` → suggested item awaiting a user decision.
- `approved` → accepted but not necessarily active.
- `active` → current work or a maintained routine/project.
- `waiting` → blocked/waiting; used for generated routine tasks when a routine is paused.
- `paused` → temporarily stopped.
- `completed` / `cancelled` / `dropped` / `archived` / `someday` / `rejected` → terminal.

**Terminal set** (`terminal_status()` returns `true`): `completed`, `cancelled`, `dropped`,
`archived`, `someday`, `rejected`. A terminal item is the end of the line for normal updates;
v1 has no hard delete (see [decisions/adr-0004-no-hard-delete.md](decisions/adr-0004-no-hard-delete.md)).

**Hidden-by-default set** (`hidden_by_default_status()` returns `true`): `archived`,
`dropped`, `cancelled`. The list view (`apply_list_filter`) omits these unless
`include_archived` is set or an explicit `status` filter is supplied.

`ItemStatus::from_str` is **case-sensitive lowercase** (it trims surrounding whitespace).
`"Active"` is rejected; `"  active  "` parses to `Active`. App paths reject unknown status
values rather than silently coercing them.

## Recurrence rules

Routine `recurrence_rule` strings are parsed by `domain::occurrences`. New rules use RRULE
strings such as `RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR`; legacy natural-language strings
remain readable for existing data. The supported RRULE subset is documented in
[decisions/adr-0005-recurrence-pattern-parsing.md](decisions/adr-0005-recurrence-pattern-parsing.md)
and in `README.md`'s "Supported recurrence examples" table.

## Event log (audit contract)

Every service-layer mutation writes one `TodoEvent` row to the SQLite `events` table — this
is an invariant, not a best-effort. Each event captures `id`, `at` (timestamp), `actor`,
`action` (e.g. `propose_task`, `approve`, `materialize_routine_task`), `object_type`,
`object_id`, a `before` JSON snapshot, an `after` JSON snapshot, and an optional `reason`.
The `before`/`after` snapshots are produced by serializing the `TodoItem`, so the event log
is a complete change history. See `README.md`'s "Event log" table for the column reference,
and [decisions/adr-0002-service-layer-policy.md](decisions/adr-0002-service-layer-policy.md)
for why the event is written atomically with the item.

## Schema initialization (additive)

`init_schema` runs whenever the engine opens the database (via `init`, the CLI service
factory, and the API service factory). It is **additive and idempotent** — verified against
`todo-engine/src/infrastructure/sqlite/schema.rs`:

- `CREATE TABLE IF NOT EXISTS items (...)` and `CREATE TABLE IF NOT EXISTS events (...)` —
  never drops or rewrites existing tables.
- `ensure_item_columns` reads `PRAGMA table_info(items)` and `ALTER TABLE items ADD COLUMN`
  for any column from the canonical set that an older database is missing (e.g. `note`,
  `materialization_policy`, `occurrence_key`, `last_materialized_at`). Existing columns are
  left untouched.
- Indexes are created with `IF NOT EXISTS`, including a unique index on
  `(routine_id, occurrence_key)` (where both are non-null) that guards routine occurrence
  de-duplication, and the planning indexes `idx_items_parent_id` (`parent_id`),
  `idx_items_scheduled` (`scheduled`), and composite `idx_items_type_horizon_scheduled`
  (`type, horizon, scheduled`).
- `PRAGMA user_version = 1` marks the schema baseline (reported by `health`).
- The whole thing runs in a transaction; on error it rolls back.

An older `items` table is upgraded in place on the next open — no separate "create then
migrate" step is needed. Columns are only added, never dropped or rewritten.
