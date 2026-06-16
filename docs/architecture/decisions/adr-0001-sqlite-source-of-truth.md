# ADR-0001: SQLite is the single source of truth

## Status

Accepted (v1).

## Context

`oracle-todo` is a local-first engine with several surfaces: a `clap` CLI, an `axum` HTTP
API, and Markdown exports. Different surfaces could each be tempted to hold their own state,
cache, or file format. If more than one of them were authoritative, they would drift, and
reconciling them would become the hard problem the engine is supposed to remove.

## Decision

A single SQLite database (`todo.sqlite`, under the data home) is the **only** canonical
store. The CLI, the API, and the Markdown exports are all *views* over it:

- The CLI and the API both open the same database through `SqliteTodoRepository` and run the
  same `TodoService`.
- Markdown exports (`exports/*.md`) are rendered on demand from the database by
  `interfaces/exports.rs`; they are output, never input.
- There is no separate config-as-state, JSON snapshot, or in-memory cache that outlives a
  command. (`TodoService::in_memory()` exists only for tests.)

## Consequences

- Any surface can be added later (dashboard, Telegram parser) without a new source of truth —
  it just becomes another caller of the service.
- Markdown files can be regenerated freely; editing them by hand has no effect on state.
- The "copied-data smoke" rule follows directly: because the DB is canonical, experiments
  must run against a *copy* of the data home, never the live `todo.sqlite`
  (see [../../operations/data-home.md](../../operations/data-home.md)).
- Schema changes must be additive so existing databases keep working
  (see [../../operations/migration.md](../../operations/migration.md)).
