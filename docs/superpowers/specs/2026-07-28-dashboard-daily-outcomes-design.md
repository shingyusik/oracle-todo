# Dashboard Daily Outcomes Design

**Date:** 2026-07-28
**Status:** Approved for implementation planning

## Goal

Refocus the Dashboard on daily execution outcomes and make problem areas
visible at a glance. Replace the existing Workspace summary and weekly Planner
widgets with:

1. today's work distribution as a donut chart;
2. daily completion history as an adjustable line chart;
3. Area status distribution as a heatmap; and
4. Project status distribution and progress as a heatmap.

The Dashboard continues to aggregate the existing all-items response in the
frontend. This change does not add an analytics endpoint, database column, or
stored Dashboard preference.

## Layout and Information Order

The desktop layout places today's donut and the completion line chart side by
side at the top. The Area heatmap and Project heatmap follow as full-width
sections. On narrow screens, every section becomes a single-column sequence in
the same order.

The existing `Workspace summary` and `Planner weekly schedule` widgets are
removed. Their space is intentionally given to daily outcomes and status
concentration rather than preserving secondary summary cards.

## Work Scope

All Dashboard outcome and status calculations use `task` and `event` items
only.

A `routine` is a work definition that materializes Tasks. Counting both the
Routine and its generated Task would duplicate the same intended work.
Routine-generated Tasks therefore participate exactly once as ordinary Tasks;
the Routine definition itself never participates in the donut, completion
line, Area heatmap, Project heatmap, or Project progress calculation.

## Today's Work Donut

Today's work is the union of Tasks and Events whose `scheduled` or `due`
calendar date equals today in the browser's local timezone. An item whose
`scheduled` and `due` values are both today is counted once.

The donut partitions today's eligible work into three mutually exclusive
segments:

| Segment | Included statuses |
| --- | --- |
| Completed | `completed` |
| Incomplete | `active`, `waiting`, `paused` |
| Miss | `missed` |

Items with `dropped`, `cancelled`, or `archived` status are excluded. The
center of the donut shows the total, so `total = completed + incomplete +
miss`.

Every segment exposes its label, count, and percentage in visible text and its
accessible name. Selecting a segment navigates to the Daily Planner anchored
to today. No new status-filtered Planner destination is introduced.

If no eligible work exists, the widget displays a concise empty message
instead of an invented zero-distribution donut.

## Completion History

Completion history counts Tasks and Events by the browser-local calendar date
of `completed_at`. It does not group by their scheduled or due dates. The
frontend `WorkspaceItemModel` is extended to expose the `completed_at` value
already returned by the engine API.

The line chart defaults to the latest 14 calendar days, including today. Its
controls offer:

- latest 7 days;
- latest 14 days;
- latest 30 days; and
- a custom inclusive start and end date.

Preset and custom ranges are component-local state and are not persisted. A
custom range is inclusive and may contain at most 366 calendar days. A start
date after the end date or a longer valid range is rejected inline, leaving
the last valid range and chart unchanged. Days without completions remain
present as zero values so the line represents a continuous calendar range.

Each point exposes its date and completion count through visible hover/focus
feedback and an accessible name. Completion points are informational because
the existing Daily Planner is organized by scheduled and due dates, not by
completion date; clicking a point therefore does not create a misleading
navigation action.

If the selected range has no completions, the widget renders the continuous
zero line with an explanatory empty-state message.

## Area Status Heatmap

Each active or paused Area receives one row. The row includes directly linked
Tasks and Events only, using `area_id`; Project or hierarchy traversal does not
add indirect work.

Columns are:

- Completed: `completed`;
- Incomplete: `active` and `waiting`;
- Paused: `paused`; and
- Miss: `missed`.

Tasks and Events with `dropped`, `cancelled`, or `archived` status do not
contribute to a heatmap row or its total.

Each cell displays its exact count. Color intensity represents that cell's
percentage of the row total, allowing differently sized Areas to be compared
by their internal status distribution. A zero-total Area displays zero values
without color intensity.

Selecting a row or cell opens the existing Area detail panel. Color is never
the only status signal.

## Project Status Heatmap and Progress

Each active or paused Project receives one row. The row uses directly linked
Tasks and Events only, using `project_id`, and applies the same four status
columns, excluded terminal statuses, and per-row intensity rule as the Area
heatmap.

Project progress is:

```text
completed / (completed + incomplete + paused + missed)
```

Missed work remains in the denominator because it was part of the Project's
tracked execution. A Project without tracked work displays `—`, not `0%`.

The existing Project attention rules remain unchanged:

- Risk when overdue or inactive for at least 14 days;
- Attention when due within 7 days or inactive for at least 7 days;
- Normal otherwise; and
- Risk takes precedence.

The Project name and progress value visibly expose non-normal attention state.
Selecting a row or cell opens the existing Project detail panel.

## Frontend Architecture

The implementation extends the existing Dashboard module boundaries:

| Module | Responsibility |
| --- | --- |
| `workbench-model.ts` | Expose optional `completed_at` from the existing item response |
| `dashboard-model.ts` | Pure work-scope, date, status, heatmap, progress, and completion-series aggregation |
| `dashboard-widgets.ts` | Declarative donut, line, and heatmap view models plus destinations and empty copy |
| `DashboardPanel.tsx` | Layout, range state, range validation, and widget composition |
| `DashboardChart.tsx` | Generic donut, line, and heatmap rendering without domain counting rules |
| `globals.css` | Responsive layout, chart visuals, focus states, and intensity tokens |

The Dashboard continues to build from `workspaceItems.allItems`. No mutation
bypasses `TodoService`, and the feature performs no data writes.

## Loading, Error, and Accessibility Behavior

- Initial loading retains card-shaped skeletons matching the new four-widget
  layout.
- A failed all-items request retains the inline Dashboard error and retry
  action.
- Each widget owns its specific no-data message rather than hiding the whole
  Dashboard.
- Donut segments, line points, and heatmap cells provide labels and numerical
  values independently of color.
- Interactive Area and Project cells are native buttons with visible keyboard
  focus.
- The line chart's informational points are keyboard-focusable so their
  date/count feedback is available without a pointer.
- Reduced-width layouts preserve reading order and allow wide heatmaps to
  scroll horizontally without shrinking labels into unreadable text.

## Verification

Domain-model tests cover:

- Task/Event-only work scope and Routine exclusion;
- Routine-generated Tasks counted once;
- scheduled/due union deduplication for today;
- completed, incomplete, Miss, and excluded terminal classifications;
- browser-local `completed_at` day grouping;
- 7-, 14-, 30-day and custom inclusive ranges;
- continuous zero days, invalid custom ranges, and the inclusive 366-day
  maximum;
- direct Area and Project relationship selection;
- per-row heatmap intensity;
- Miss inclusion in Project progress; and
- zero-work Project progress.

Widget and presentation tests cover:

- the new widget registry and removal of the old summary/Planner widgets;
- donut labels, totals, segment navigation, and empty state;
- line range controls, point feedback, and zero-completion state;
- heatmap counts, accessible names, attention indicators, and detail
  navigation;
- loading, error, and retry behavior; and
- responsive and keyboard-accessible rendering contracts.

The complete frontend unit test, typecheck, and production build gates must
pass.

## Out of Scope

- A backend analytics endpoint or cached aggregate table;
- persisted Dashboard date-range preferences;
- filtered Planner navigation for donut segments;
- Routine-definition analytics;
- historical snapshots of Area or Project membership; and
- changing engine status or audit-event policy.
