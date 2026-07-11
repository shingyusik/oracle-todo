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
| `Month` + calendar date pick inside July 2026 | `horizon = month`, `scheduled = 2026-07-01` |
| `Week` + calendar date pick inside Jul 6-Jul 12 | `horizon = week`, `scheduled = 2026-07-06` |

The month and week controls use a calendar grid:

- Month mode highlights the whole selected month, from the first day through the last day.
- Week mode highlights the whole selected ISO week, from Monday through Sunday.
- Clicking any day in month mode stores the first day of that day's month.
- Clicking any day in week mode stores the ISO Monday of that day's week.

The UI does not ask users to type `YYYY-MM-DD` for month or week goals. The highlighted range is the visible cue that the goal belongs to the selected month or week, not only to the clicked day.

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
