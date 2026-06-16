# ADR-0003: Approval gates agent/Oracle-created work

## Status

Accepted (v1).

## Context

Oracle and other agents can propose work on the user's behalf. The whole point of the engine
is that the *software* — not the agent, and not a UI convention — decides what actually
enters the user's active workload. Proposed work must be visible but inert until the user
accepts it.

## Decision

Creation actor determines the starting status, and activation is gated on approval:

- An item created by `Actor::User` is auto-approved at construction: `status = approved`,
  `approved_by = user`, `approved_at = now` (`TodoItem::new`).
- An item created by any other actor (`oracle`, `system`) starts `proposed` with no approval
  markers. Agent-facing CLI subcommands (`task propose`, `project propose`, …) and the API
  propose endpoints default the actor to `oracle`, so agent-created work is `proposed` by
  default.
- An agent-created item cannot become `active` until it has been approved. Approval is an
  explicit transition (`approve` CLI subcommand / `POST /items/{id}/approve`).

This is **policy enforced in code**, not a presentation choice — the rule lives in the
domain/service layer and applies identically to the CLI, the API, and any future surface.

## Consequences

- Proposed items are surfaced (e.g. `pending`, `proposed.md` export) so the user can review
  and approve them, but they never silently become active work.
- A user operating the CLI directly with `--actor user` can create already-approved items,
  matching the intent that the user is the authority.
- Rejection is a first-class terminal state (`rejected`) for proposals the user declines.
- Because gating is in the service, no new surface can accidentally let an agent activate its
  own proposals.
