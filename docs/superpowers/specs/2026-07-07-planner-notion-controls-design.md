# Planner Notion Controls Design

**Date:** 2026-07-07
**Status:** Approved for implementation planning
**Scope:** Replace planner filter, sort, and group controls with a Notion-style icon toolbar and dropdown editors across all planner tabs.

## Goal

Planner controls should feel compact, direct, and consistent across `Yearly`, `Monthly`, `Weekly`, and `Daily`.

- Keep planner content focused on time-based planning.
- Move filter, sort, and group settings behind icon buttons.
- Show active view settings as compact pills.
- Reuse existing frontend planner state and model logic where possible.
- Avoid new dependencies beyond the existing `lucide-react` icon package.

## Toolbar Pattern

Every planner tab has a shared toolbar:

```text
View pill                                  Filter  Sort  Group by  New
Active setting pills, when present         3 rules Sorted by priority Grouped by area
```

Rules:

- `Filter`, `Sort`, and `Group by` render as icon-first buttons.
- Buttons use accessible labels and tooltips.
- Active buttons use the planner accent treatment.
- Clicking a button opens one dropdown panel and closes the others.
- The active setting row appears only when at least one filter, sort, or group setting is active.
- The `New` button remains visible at the end of the toolbar.

## Filter Dropdown

Filters use a compact rule-builder panel.

```text
Filter
Status  is        active        x
Tag     contains  focus, ops    x
Area    is        Work          x
+ Add filter rule
```

Rules:

- The first implementation supports the existing filter fields only.
- `Daily` supports tags, area, project, routine, item type, and status.
- `Yearly`, `Monthly`, and `Weekly` start with tag filtering.
- Filter categories combine with `AND`.
- Multiple values inside one category combine with `OR`.
- Removing a rule clears that category.
- Empty categories are not shown as active rules.
- Invalid selected values are ignored when the current tab no longer exposes them.

## Sort Dropdown

Sort uses one selected sort key per planner tab.

Daily sort options:

- Priority
- Scheduled
- Updated
- Title

Yearly, monthly, and weekly sort options:

- Scheduled
- Priority
- Updated
- Title

Rules:

- The default sort stays unchanged for `Daily`: priority, then scheduled, then updated, then title.
- Other planner tabs default to their current date-oriented order.
- The dropdown shows the active sort key.
- Sort state is planner-local frontend state.
- Direction controls are out of scope for the first implementation.

## Group Settings Panel

Group controls use a shared Notion-style settings panel for each planner tab. The panel stores settings independently for `Yearly`, `Monthly`, `Weekly`, and `Daily` in browser-local storage with `oracle-todo.planner-group-settings.v1.<view>` keys.

Daily and weekly group options:

- None
- Area
- Project
- Routine
- Tag
- Item type
- Status

Yearly and monthly group options:

- None
- Tag
- Status

Panel controls:

- Group property selection.
- Group sort: `Manual`, `Alphabetical`, and `Reverse alphabetical`.
- `Hide empty groups`, enabled by default.
- Per-group visibility toggles.
- Bulk `Hide all` and `Show all` actions.
- `Remove grouping`, which resets group-specific settings for the active planner tab.

Rules:

- Grouping never replaces the planner's time structure.
- `Daily` keeps `Today`, `Overdue`, `Upcoming`, and `Unscheduled` as top-level sections; groups render inside each section.
- `Weekly` keeps the month goals, week goals, and day cards; groups render inside each goal strip or day card.
- `Yearly` and `Monthly` group inside the goal list.
- Ungrouped content renders without a visible `All` group header.
- Multi-tag items appear in every matching tag group.
- Empty groups are managed from the settings panel and are not repeated inside individual time containers.

## Data Flow

Use the existing workbench controller and planner model pattern.

- Store planner sort state and planner group settings as frontend-only controller state.
- Keep filter application in pure model/helper functions.
- Keep loaded data sources unchanged.
- Keep API calls unchanged.
- Preserve terminal-status filtering before filter options are built.
- Derive dropdown option labels from existing related item maps.

## Component Shape

The first implementation can stay in the current workbench UI module unless extraction clearly reduces duplication.

Expected reusable pieces:

- Planner toolbar shell.
- Icon dropdown button.
- Filter rule panel.
- Sort option panel.
- Group settings panel.

Implementation constraints:

- Use `lucide-react` icons.
- Use native buttons, lists, and form controls.
- Do not add a menu library.
- Keep dropdowns keyboard reachable and dismissible.
- Keep mobile layout wrapped and readable.

## Testing Strategy

Use existing Vitest and React Testing Library coverage.

- Planner presentation tests verify all tabs render the icon controls.
- Filter tests verify rule-builder interactions update visible items.
- Sort tests verify selected sort options reorder visible items.
- Group tests verify groups appear inside existing time sections.
- Accessibility tests use roles and labels rather than icon text.
- Existing workspace table and detail tests remain unchanged.

Verification commands:

```bash
cd frontend
npm run test
npm run typecheck
npm run build
```

## Out of Scope

- Persisting planner view settings.
- New Rust planner endpoints.
- Arbitrary nested filter logic.
- `AND` and `OR` toggles inside a filter category.
- Sort direction controls.
- Drag-and-drop scheduling.
- Tag colors, tag management, or saved views.

## Success Criteria

- All planner tabs share one recognizable filter, sort, and group toolbar pattern.
- Active settings are visible without opening dropdowns.
- Filters use rule-builder editing.
- Sort and group controls no longer use always-visible select fields.
- Grouping preserves planner time sections and day cards.
- Existing planner data loading and creation flows keep working.
