# Planner UI Design

**Date:** 2026-07-06
**Status:** Approved for implementation planning
**Scope:** Add planner views to the existing frontend workbench. The planner reuses current todo-engine item APIs and creation flows; it does not add new Rust planner endpoints.

## Goal

Make the existing `Planner` navigation useful:

- `Yearly` and `Monthly` focus on goals.
- `Weekly` shows month goals, week goals, and a Monday-Sunday task board.
- `Daily` focuses on today's runnable work.
- Task, goal, routine, and event creation stays fast from planner screens.
- Tags can be assigned in workspace tables and used as planner filters.

## Product Shape

Planner remains under `ToDo > Planner` with four leaf tabs:

| Tab | Primary Content | Fast Add |
| --- | --- | --- |
| `Yearly` | Year-horizon goals | Goal |
| `Monthly` | Month-horizon goals for the selected month | Goal |
| `Weekly` | Month goals, week goals, and Monday-Sunday cards | Task, Goal, Routine, Event |
| `Daily` | Sectioned runnable work for the selected day | Task, Routine, Event |

## Weekly Layout

The weekly planner is the main new surface:

```text
Weekly Planner
  week header + fast-add buttons
  month goals section
  week goals section
  Monday | Tuesday | Wednesday | Thursday | Friday | Saturday | Sunday
    date card
      scheduled tasks
      scheduled events
      routine-derived or routine-linked work
```

Rules:

- Month goals come from goals whose `horizon` is `month` and whose date fields place them in the week owner month.
- Week goals come from goals whose `horizon` is `week` and whose date fields place them in the selected week.
- Day cards show tasks/events scheduled for that date.
- Routines appear as routine items until materialized task behavior is available in the UI.
- Cards are horizontally arranged on desktop and may overflow horizontally rather than compressing into unreadable columns.

## Daily Layout

Daily is a sectioned execution view rather than a table:

```text
Daily Planner
  day header + filter controls + group-by control + sort control + fast-add buttons
  Today
    tasks/events/routines scheduled for today
  Overdue
    unfinished tasks/events scheduled before today
  Upcoming
    near-future work that is useful to see while planning today
  Unscheduled
    active tasks without a scheduled date
```

Rules:

- Completed and archived items are hidden.
- Daily filters include tags, area, project, routine, item type, and status.
- Daily filters use `AND` between filter categories and `OR` inside a multi-select category.
- Daily group-by options include none, area, project, routine, tag, item type, and status.
- Section buckets remain the top-level structure when group-by is active; groups render inside each bucket.
- The default sort is by priority, then scheduled time, then updated time.
- Sort controls may include priority, scheduled time, updated time, and title.
- Compact fast-add controls default the scheduled date to today.
- Daily does not need a full calendar grid.

## Tags and Filtering

Tags are a common item field, not planner-only metadata:

- SQLite stores item tags in an additive `items.tags` column as a JSON string array.
- The domain/API shape exposes tags as `string[]`.
- Workspace table views show tags as an editable column for areas, projects, goals, routines, tasks, and events.
- The item detail view also exposes tags.
- Planner views show tag filter chips above the content.
- Multiple selected tags use `OR` matching.
- Tag filters apply after hidden terminal statuses are removed.
- Daily also filters by area, project, routine, item type, and status.

The first implementation does not need a separate tags table, tag colors, rename flows, or a tag management screen.

## Data Flow

Use the existing frontend controller pattern:

- Keep `src/domain/workbench/navigation.ts` as the tab policy owner.
- Extend the workbench controller to load planner data when `yearly`, `monthly`, `weekly`, or `daily` is selected.
- Reuse `WorkspaceItemModel` for planner item rendering.
- Extend `WorkspaceItemModel`, create requests, and patch requests with `tags: string[]`.
- Reuse existing POST flows for creation:
  - `/todo-engine/tasks/propose`
  - `/todo-engine/goals/propose`
  - `/todo-engine/routines/propose`
  - `/todo-engine/events/propose`
- Reuse existing detail view for item editing.

The first implementation may fetch by item type and filter in the frontend:

- goals for `yearly`, `monthly`, and weekly goal strips.
- tasks, events, and routines for `weekly` and `daily`.
- daily sections are derived in the frontend from scheduled dates and status.
- daily filtering, grouping, and sorting are derived in the frontend from loaded items and related item titles.

## Error Handling

- Loading failures show the existing table-style error state or a compact planner error state.
- A failed fast-add leaves the current planner data unchanged.
- Date defaults are applied in the frontend before sending the existing create request.

## Testing Strategy

Use the existing Vitest and React Testing Library setup:

1. Hook tests prove planner tabs load the needed item types.
2. Presentation tests prove weekly renders month goals, week goals, and seven day cards.
3. Presentation tests prove daily renders sectioned runnable work and hides completed items.
4. Creation tests prove planner fast-add calls the existing create endpoints with the selected date.
5. Sorting tests prove daily can order visible items by priority and scheduled time.
6. Workspace tests prove tags can be edited from table and detail views.
7. Planner tests prove tag filters hide non-matching visible items.
8. Daily tests prove area/project filters and group-by controls reorganize visible items without showing completed items.

Verification commands:

```bash
cd frontend
npm run test
npm run typecheck
npm run build
```

## Out of Scope

- New Rust planner API endpoints.
- Separate tag management tables or screens.
- Tag colors and rename flows.
- Drag-and-drop scheduling.
- Calendar recurrence expansion beyond currently exposed items.
- Persisted selected week/month navigation.
- Multi-user or sync behavior.

## Success Criteria

- Selecting each planner tab shows real todo-engine data instead of a blank table.
- `Yearly` and `Monthly` are goal-centered.
- `Weekly` shows month goals, week goals, and Monday-Sunday task cards.
- `Daily` shows active runnable work in sections for today, overdue, upcoming, and unscheduled items.
- `Daily` hides completed and archived items.
- `Daily` can filter visible items by tag, area, project, routine, item type, and status.
- `Daily` can group visible items by area, project, routine, tag, item type, and status.
- `Daily` can sort visible items by priority, scheduled time, updated time, and title.
- Workspace table rows can edit item tags.
- Planner views can filter visible items by selected tags.
- Fast add can create task, goal, routine, and event items from planner screens where those types are expected.
- Existing workspace tables and detail editing keep working.
