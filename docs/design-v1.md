# oracle-todo v1 Design

## Goal

Build a local-first ToDo engine where Oracle can interpret and propose, but the software enforces the operating system: approval gates, PARA-like execution concepts, audit events, and Second_Brain read-only boundaries.

## Canonical architecture

```text
Telegram / CLI / Future Dashboard / Oracle
                  ↓
              TodoService
                  ↓
       Policy validation + state machine
                  ↓
        SQLite source of truth + events
                  ↓
        Markdown / JSON / API exports
```

## Object types

- `area`: ongoing life/operation domain; does not require completion criteria.
- `project`: finite outcome; requires `definition_of_done` before activation.
- `routine`: recurring management; requires `recurrence_rule` before activation.
- `task`: actionable unit; Oracle-created tasks start as `proposed`.
- routine-generated `task`: generated only from `active` routines; linked by `routine_id` and protected from duplicates by `occurrence_key`.
- `review`: scheduled review/checkpoint.
- `archive_item`: completed/dropped/someday historical item.

## Status model

- proposal: `proposed`, `rejected`
- live work: `approved`, `active`, `waiting`, `paused`
- terminal: `completed`, `cancelled`, `dropped`, `archived`, `someday`

## Policies enforced in code

1. Agent-created tasks/projects/routines default to `proposed`.
2. `active` is only allowed after approval for agent-created items.
3. Projects cannot become `active` without `definition_of_done`.
4. Routines cannot become `active` without `recurrence_rule`.
5. Areas cannot be completed; they can be paused or archived.
6. Hard delete is not part of v1; archive/cancel/drop instead.
7. Every mutation records an event.
8. Second_Brain references are stored as immutable read-only references from the ToDo side.
9. Markdown exports are views, not source of truth.
10. Routine materialization supports `single_open` and `per_occurrence`; `rolling` is intentionally excluded from v1.
11. `single_open` allows at most one open task per routine.
12. `per_occurrence` creates bounded task instances from `now - catchup_days` through `now + lookahead_days`, skipping existing `routine_id + occurrence_key` pairs.
13. Recurrence parsing supports daily/weekly/monthly basics plus migrated Obsidian-style rules: `every week on Monday`, `every 5 weeks on Friday`, `every month on the 5th`, `every month on the last`, and `every year`.
14. Only `active` routines materialize tasks; generated tasks are `approved` because the routine itself was user-approved before activation.

## v1 scope

- SQLite schema and migrations via SQLModel create_all.
- Service methods: create area, propose project/task/routine, approve, activate, complete, archive, list, export, materialize routine tasks.
- CLI for local operations and Oracle tool calls.
- FastAPI skeleton for future dashboard.
- Tests for policy rules and export shape.

## Later phases

- Second_Brain note-created/modified/deleted impact review queue.
- Recurrence materialization scheduling/cron integration.
- Telegram command parser.
- HTMX dashboard: Today, Week, Projects, Areas, Routines, Proposed, Archive, Events.
- Git-backed encrypted backup/export if needed.
