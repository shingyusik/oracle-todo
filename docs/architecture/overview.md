# Architecture Overview

Raven is one executable composed from three independent policy engines. Each engine owns
its domain model, application service, repository contract, SQLite schema, and audit trail.
The outer `raven-cli` and `raven-api` crates may depend on all engines; engines never depend
on one another.

## Runtime flows

```text
raven command
  → top-level parser
  → owning service
  → validation and policy
  → SQLite record + audit event
  → structured output

Raven UI
  → authenticated /api/v1/<domain>
  → HTTP DTO validation
  → owning service
  → SQLite record + audit event
  → typed JSON
```

Domain mutations do not originate in CLI handlers, HTTP handlers, Dashboard projection
code, or preference storage.

## Workspace composition

```text
raven-cli
├── todo-engine
├── ledger-engine
├── health-engine
└── raven-api
    └── backend preference adapter

frontend → /api/v1
```

- `raven-cli` owns the executable, data-home resolution, logging, command routing, API
  startup, UI startup, and ToDo import.
- `raven-api` composes domain routers, authentication, error normalization, preferences,
  and the read-only Dashboard.
- `frontend` is one static Next.js application served with the API by `raven ui`.

## Data isolation

`todo.sqlite`, `ledger.sqlite`, and `health.sqlite` are separate sources of truth under one
Raven home. Health image bytes live under `media/health`; its database stores metadata and
relative paths. Presentation preferences live in `todo.sqlite` but cannot mutate domain
records.

The Dashboard queries all three stores independently and returns an `ok` or `error`
projection per domain. A missing, corrupt, or unsupported database is isolated to its
projection.

## Security boundary

- Standalone API mode requires one bearer token source.
- Cleartext API binding is loopback-only unless the explicit unsafe override is set.
- UI mode is loopback-only and creates an unpredictable session for each launch.
- The bootstrap response sets an HTTP-only `SameSite=Strict` cookie.
- UI requests must use the exact listener authority; API and health namespaces do not fall
  through to static SPA content.
- Error responses expose stable classifications and request IDs, not internal paths or
  storage messages.

See [layers.md](layers.md), [data-model.md](data-model.md), and the
[API reference](../operations/api-reference.md).
