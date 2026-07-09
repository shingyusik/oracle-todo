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

| Control | Stored values |
| --- | --- |
| `Year` + year select `2026` | `horizon = year`, `scheduled = 2026-01-01` |
| `Month` + year select `2026` + month select `Jul` | `horizon = month`, `scheduled = 2026-07-01` |
| `Week` + year select `2026` + month select `Jul` + week select `W1 (Jun 29-Jul 5)` | `horizon = week`, `scheduled = 2026-06-29` |

Week options are derived from the selected year and month. Each option shows:

- `W1`, `W2`, etc. within that month view.
- The Monday-Sunday date range beside the week label.
- The stored `scheduled` value as the ISO Monday for that displayed week.

The UI does not ask users to type `YYYY-MM-DD` for month or week goals.

## Goal Creation

Creating a goal from Workspace Goals uses:

- `title`
- `Period`

The default period is the current year. Planner screens may continue deriving the period from the selected planner tab and date, but the visible Workspace Goals control still uses period selectors rather than raw dates.

## Boundaries

- No `due` field for goals in table, detail, or creation.
- No new API endpoint.
- No custom date picker dependency.
- No free-form date parsing for goal periods.
