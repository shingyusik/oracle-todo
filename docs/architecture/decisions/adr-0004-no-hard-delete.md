# ADR-0004: No hard delete in v1

## Status

Accepted (v1).

## Context

Items accumulate history that the audit log depends on. A row deleted from `items` would
orphan its `events` and erase the very trail the engine promises to keep. Users still need a
way to remove things from their active view, but "remove from view" and "destroy the record"
are different operations.

## Decision

v1 has **no hard delete**. There is no service method, CLI subcommand, or API route that
removes an item row. Instead, items leave the active flow through terminal status
transitions:

- `archive` — file the item away (terminal).
- `cancel` — cancel the item (terminal).
- `drop` — intentionally abandon the item (terminal).
- `complete` — finished work (terminal).
- `miss` / `postpone` — record scheduled work as `missed` (terminal for normal updates);
  postponement also creates an independent active follow-up.

`archived`, `dropped`, and `cancelled` are additionally hidden-by-default in list views, so a
"removed" item disappears from everyday views without losing its row or its events. `missed`
remains queryable in ordinary list results while active-work views exclude it. Every terminal
transition writes its audit event with the item mutation.

## Consequences

- The `events` audit log stays complete; no event ever points at a vanished item.
- "Removing" an item is reversible context-wise — the record and its full before/after
  history remain queryable (e.g. via `archive-list` / `GET /items/archive`).
- Storage grows monotonically in v1; pruning, if ever needed, is a deliberate future
  decision with its own ADR, not an ad-hoc delete.
- Schema initialization is additive for the same reason — existing rows and columns are
  never dropped (see [../data-model.md](../data-model.md#schema-initialization-additive)).
