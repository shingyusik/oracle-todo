# Workspace Goal Period Input Design

**Date:** 2026-07-10
**Status:** Approved for implementation planning
**Scope:** Simplify goal period editing in the Workspace Goals table and detail view.

## Goal

Workspace Goals treat `horizon` and `scheduled` as one user-facing period.

- Users see and edit a single `Period` field.
- `Due` is not shown for goals.
- The frontend still sends the existing API shape: `horizon` plus canonical `scheduled`.
- No schema or service-layer changes.

## Goals Table

The Goals table shows:

| Column | Mode |
| --- | --- |
| `title` | inline |
| `status` | inline |
| `tags` | inline |
| `period` | inline |
| `parent_id` | inline |
| `note` | readonly summary |
| `created_at` | readonly |
| `updated_at` | readonly |

`period` replaces separate `horizon` and `scheduled` columns.

## Goal Detail

The goal detail view shows one `Period` control.

| Control value | Stored values |
| --- | --- |
| Year `2026` | `horizon = year`, `scheduled = 2026-01-01` |
| Month `2026-07` | `horizon = month`, `scheduled = 2026-07-01` |
| Week `2026-07-06` | `horizon = week`, `scheduled = 2026-07-06` |

The week value must remain an ISO Monday. Invalid combinations should use the existing backend validation error path.

## Goal Creation

Creating a goal from Workspace Goals uses:

- `title`
- `Period`

The default period is the current year. Planner screens may continue deriving the period from the selected planner tab and date.

## Boundaries

- No `due` field for goals in table, detail, or creation.
- No new API endpoint.
- No custom date picker dependency.
- No automatic period snapping in the frontend.
