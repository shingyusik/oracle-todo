# ADR-0002: All mutations route through TodoService

## Status

Accepted (v1).

## Context

The engine has policy that must hold no matter who calls it: agent-created work needs
approval, projects need a `definition_of_done` before activation, routines need a
`recurrence_rule`, areas cannot be completed, and every change must be auditable. If the CLI
and the API each re-implemented these rules — or if either wrote to SQLite directly — the
rules would diverge and the audit trail would have gaps.

## Decision

Every mutation goes through `TodoService` (in `application/service/`). The service is the
single place that:

1. **Validates and enforces policy** before any write (the `creation`, `transitions`,
   `update`, and `materialization` submodules each enforce their slice of the state machine —
   e.g. `ensure_relation` rejects terminal/parent-type-mismatch links, project activation
   checks `definition_of_done`, routine activation checks `recurrence_rule`).
2. **Writes the item and its audit event atomically.** `store_item_and_event` constructs a
   `TodoEvent` (with `before`/`after` snapshots) and persists item + event together via
   `TodoStore::save_item_and_event`. There is no code path that saves an item without also
   recording the event.

The CLI handlers (`interfaces/cli/`) and the API handlers (`interfaces/api/handlers.rs`)
are thin adapters: they parse input, call a service method, and render the result. They hold
no policy of their own. The repository traits (`TodoRepository`/`EventRepository`/`TodoStore`
in `application/ports.rs`) are the only contract between the service and storage.

## Consequences

- Policy is defined exactly once and is identical across CLI, API, and tests — the
  `tests/integration/service_policy.rs` and `tests/integration/events.rs` suites guard it.
- Audit completeness is structural, not a discipline: you cannot mutate an item without an
  event because the only save method takes both.
- **Never bypass the service with direct repository writes** — doing so skips validation,
  the state machine, and the mandatory event, breaking the core invariant.
- Storage can be swapped (the in-memory store backs unit/integration tests; SQLite backs
  production) without changing any policy code.
