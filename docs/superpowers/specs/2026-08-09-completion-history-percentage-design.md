# Completion History Percentage Design

## Goal

Change the Dashboard Completion history from daily completion counts to daily
completion rates so the chart consistently communicates percentages from 0% to
100%.

## Completion-Rate Semantics

For each browser-local calendar date in the selected range, eligible work is a
Task or Event whose `scheduled` date or `due` date equals that date. An item that
matches both fields on the same date is counted once.

The denominator contains eligible items whose current status is one of:

- `completed`;
- `active`;
- `waiting`;
- `paused`; or
- `missed`.

The numerator contains the eligible items whose current status is `completed`.
Statuses outside the denominator, including `dropped`, `cancelled`, and
`archived`, do not affect the rate. A date with no eligible work has a 0%
completion rate.

The current item state is used because Raven does not store a historical status
snapshot for every calendar date. The previous `completed_at`-grouped count is
replaced rather than retained as a second series.

## Model and Data Flow

`buildDashboardSnapshot` continues to filter the workspace collection to Tasks
and Events before building Completion history. Each `CompletionDay` exposes:

- `date`;
- `completed`;
- `total`; and
- `percentage`, expressed on the inclusive 0-to-100 scale.

The Dashboard widget maps `percentage` to the line point value. It includes the
rounded percentage and the exact completed/total counts in the accessible label
and tooltip, for example `2026-08-09: 75% completed (3/4)`.

No API, database, or persistence change is required. The existing 7-day,
14-day, 30-day, and valid custom inclusive ranges remain component-local and
unchanged.

## Chart Presentation

Completion history uses a fixed percentage scale rather than a scale derived
from the largest observed value. The Y-axis always renders these ticks:

- `100%`;
- `75%`;
- `50%`;
- `25%`; and
- `0%`.

Point positions use the same fixed 0-to-100 scale. X-axis derivation, keyboard
focus, hover behavior, and informational-only point semantics remain unchanged.
The widget description and empty-state copy refer to scheduled or due work and
completion rate rather than completion counts.

## Empty and Boundary Behavior

- A date without eligible work produces `completed = 0`, `total = 0`, and
  `percentage = 0` so the continuous date series is preserved.
- A date with eligible work but no completions produces 0%.
- A date on which every eligible item is completed produces 100%.
- Percentage values are calculated without integer truncation; display text is
  rounded to the nearest whole percent.
- An item with matching `scheduled` and `due` dates contributes once.

## Testing

Domain tests cover mixed statuses, excluded statuses, no-work dates, 0% and
100% boundaries, fractional percentages, and scheduled/due de-duplication.
Widget tests prove that line values and labels use percentage units and retain
the exact completed/total counts. Presentation tests prove the fixed percentage
ticks, fixed point positions, consistent tooltip text, and unchanged X-axis and
focus behavior.

The focused tests run first through a red-green TDD cycle. The final gate runs
the full frontend test suite, TypeScript typecheck, and production build.

## Non-Goals

- No historical status-event reconstruction.
- No second count series or chart mode toggle.
- No change to Today's work, Area status, or Project status.
- No API, Rust engine, SQLite schema, or preference change.
- No new charting dependency.
