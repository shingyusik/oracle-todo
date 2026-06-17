# Architecture Overview

`todo-engine` is a policy-enforced, local-first personal ToDo engine for agent
workflows. It keeps areas, projects, tasks, routines, and events in one SQLite-backed
item graph. Agents may interpret and *propose* work, but the software
itself enforces the operating system: approval gates, audit events, a status state
machine, and read-only Second_Brain boundaries. Every external surface — CLI and HTTP API
— is a thin view over the same Rust service layer and the same `todo.sqlite` database.
The Rust crate lives in the `todo-engine/` workspace package (binary/lib `todo-engine`/`todo_engine`);
`frontend/` is a reserved sibling package slot for a future UI.

## Pipeline

All input paths converge on a single service; all output paths read back through it.

```text
Telegram / CLI / Future Dashboard / Agent
                  ↓
              TodoService
                  ↓
       Policy validation + state machine
                  ↓
        SQLite source of truth + events
                  ↓
        CLI Markdown / JSON / API responses
```

## Core principles

1. **SQLite is the single source of truth.** The CLI and the `axum` HTTP API are both
   *views* over `todo.sqlite`. Nothing else holds canonical state. See
   [decisions/adr-0001-sqlite-source-of-truth.md](decisions/adr-0001-sqlite-source-of-truth.md).
2. **The service layer enforces policy.** Every mutation routes through `TodoService`,
   which runs validation plus a status state machine before touching storage. CLI and API
   never bypass it. See [decisions/adr-0002-service-layer-policy.md](decisions/adr-0002-service-layer-policy.md).
3. **Approval gates agent work.** Agent-created items start as `proposed` and
   require user approval before they can become `active`; user-created items can start
   `approved`. See [decisions/adr-0003-approval-gating.md](decisions/adr-0003-approval-gating.md).
4. **Audit events are mandatory.** Every service-layer mutation writes a `TodoEvent` row
   to the SQLite `events` table, with `before`/`after` JSON snapshots. There is no mutation
   path that skips the event.
5. **Second_Brain references are read-only.** `second_brain_refs` are stored as immutable
   reference input from the ToDo side; the engine never writes back into Second_Brain.

## Where to go next

- [layers.md](layers.md) — the clean/hexagonal layer map of the refactored `todo-engine/src/` tree,
  the inward-dependency rule, and the `pub(super)` visibility convention.
- [data-model.md](data-model.md) — item types, the `ItemStatus` lifecycle, and the
  `events` audit contract (with links to the canonical column tables in `README.md`).
- [decisions/](decisions/) — Architecture Decision Records for each locked policy.
