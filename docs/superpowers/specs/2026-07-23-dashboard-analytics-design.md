# Dashboard Analytics Design

**Date:** 2026-07-23
**Status:** Approved for implementation planning

## Goal

Replace the empty Dashboard view with a responsive, graph-led analytical
overview. It must make the distribution and status of Area, Project, and
Planner work visible without introducing a new backend API or database schema.

The Dashboard is an analysis and navigation surface. Every summary or chart
element that represents a concrete Area, Project, or Planner period must lead
to the relevant existing work view.

## Dashboard Layout

The Dashboard contains four compact summary cards followed by three analytical
widgets:

| Section | Content | Visual treatment |
| --- | --- | --- |
| Summary | Active Areas, active Projects, active work items, and Projects needing attention | Numeric cards |
| Area | Per-Area completed, active, and paused work | Horizontal stacked bars |
| Project | Per-Project completed versus remaining linked work | Paired vertical bars; an at-risk Project uses the warning color |
| Planner | Scheduled and due work by day for the current Monday-to-Sunday week, plus Today, This week, and overdue summaries | Grouped daily bars plus three numeric buckets |

The graph rows remain the primary content. Summary cards provide a fast entry
point but do not replace the analytical widgets.

## Scope and Counting Rules

### Work scope

Area and Project work distributions use directly linked `task`, `event`, and
`routine` items. Area, Project, and Goal records are structural entities and
are never counted as work themselves. Direct links prevent a task assigned to
both an Area and a Project from being counted twice inside a single widget.

Project progress is `completed linked work / all linked work`, where all work
means active, paused, or completed direct work. A Project without linked work
renders a progress value of `—` rather than a misleading zero percent.

### Project attention state

An active Project is:

| State | Rule |
| --- | --- |
| Risk | Its due date is before today, or it has not been updated for 14 days or more |
| Attention | Its due date is within the next 7 calendar days, or it has not been updated for 7 days or more |
| Normal | Neither Risk nor Attention applies |

Risk wins when more than one rule applies. Paused and completed Projects do
not contribute to the attention summary.

### Planner rules

Planner analytics use active or paused `task` and `event` items only.

- **Today** is the union of items scheduled today and items due today.
- **This week** is the union of items scheduled or due between the current
  Monday and Sunday, inclusive.
- **Overdue** is the union of items with a scheduled or due date before today.
- A work item having both `scheduled` and `due` dates is counted once in each
  summary bucket, even when both values match.
- The weekly graph has two series: scheduled and due. An item appears in each
  relevant series if its scheduled and due dates fall on different days; this
  preserves the meaning of both dates.

All dates use the browser's local calendar date, matching the existing Planner
controls.

## Navigation

Dashboard interactions use explicit navigation actions rather than component
specific state mutations.

| Interaction | Destination |
| --- | --- |
| Active-Area summary or Area widget heading | Areas Workspace list |
| Individual Area bar | That Area's existing detail panel |
| Active-Project summary or Project widget heading | Projects Workspace list |
| Individual Project bar | That Project's existing detail panel |
| Planner date bar | Daily Planner anchored to that date |
| Today planner summary | Daily Planner anchored to today |
| This-week planner summary | Weekly Planner anchored to the current week |
| Overdue planner summary | Daily Planner anchored to today, where the existing Before/overdue table shows the relevant items |

Navigating from a Dashboard never creates, mutates, archives, or completes an
item. Existing detail dirty-draft navigation safeguards continue to apply.

## Modular Frontend Design

No user-facing Dashboard customization or preference persistence is included.
Instead, the code is deliberately modular so developers can replace a metric or
visualization without changing unrelated cards.

| Module | Responsibility |
| --- | --- |
| `dashboard-model.ts` | Pure date, relationship, status, and aggregation functions operating on `WorkspaceItemModel[]` |
| `dashboard-widgets.ts` | Declarative widget registry: identifier, title, selector, aggregation, chart specification, empty copy, and navigation action factory |
| `DashboardPanel.tsx` | Dashboard loading, error, and empty states; layout composition by widget identifier only |
| `DashboardChart.tsx` | Reusable summary, stacked-bar, and grouped-bar renderers driven by chart specifications, not domain logic |
| `dashboard-navigation.ts` | Typed dashboard destination actions and their translation to existing controller navigation |

Each widget produces a view model, not JSX. The chart renderer receives stable
generic values such as labels, series, values, colors, and click destinations.
Adding or changing a statistic therefore consists of extending one domain
calculator and one registry entry, while the panel and other widgets stay
unchanged.

The Dashboard extends the existing controller so selecting the `dashboard`
leaf loads `allItems`, which are already fetched for the other workbench
views. It does not add an endpoint, persistence setting, or server-side
aggregation.

## States and Accessibility

- While the all-items request is pending, the Dashboard renders card-shaped
  skeletons rather than a blank main panel.
- A failed request shows an inline explanatory error and a retry action.
- A successful empty response shows concise creation guidance and no invented
  zero-value chart.
- Graphs provide text labels, numerical values, and button semantics for every
  clickable visual element; color is never the only status signal.
- The layout reduces from a multi-column desktop grid to a single-column
  sequence on narrow screens.

## Verification

- Unit tests cover direct relationship selection, Area state totals, Project
  progress, Project attention precedence, Planner date boundaries, and
  scheduled/due deduplication rules.
- Widget-registry tests prove every registered widget has a renderable chart
  specification and a valid typed navigation destination.
- Controller tests prove Dashboard selection loads all items and preserves the
  existing non-Dashboard fetch behavior.
- Presentation tests cover loading, error, empty, populated graphs, accessible
  labels, and each navigation interaction.
- Existing frontend architecture tests continue to enforce the domain/model/UI
  boundary.
