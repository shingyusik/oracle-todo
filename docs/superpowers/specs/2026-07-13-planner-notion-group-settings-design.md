# Planner Notion Group Settings Design

**Date:** 2026-07-13
**Status:** Approved for implementation planning
**Scope:** Replace the planner group menu with a shared Notion-style group settings panel and persist settings independently for Yearly, Monthly, Weekly, and Daily views.

## Goal

Planner grouping should support the same management flow in every planner view while preserving each view's time structure and existing group-by choices.

- Use one recognizable group settings panel across all planner views.
- Support group ordering, empty-group visibility, and per-group visibility.
- Persist settings per view without changing the Rust API or SQLite schema.
- Keep Yearly and Monthly goal-focused and keep Weekly and Daily time sections intact.

## View Scope

| View | Group choices | Grouping location |
| --- | --- | --- |
| Yearly | Tag, Status | Goal lists inside year and month periods |
| Monthly | Tag, Status | Goal lists inside month and week periods |
| Weekly | Area, Project, Routine, Tag, Item type, Status | Month/week goal sections and date cards |
| Daily | Area, Project, Routine, Tag, Item type, Status | Today, overdue, and unscheduled sections |

Grouping does not replace or flatten planner time structures. Monthly calendar items remain outside grouping because the existing Monthly group control applies to its goal lists.

## Group Settings Panel

The planner toolbar keeps its existing Group icon. Activating it opens a Notion-style settings panel with:

- Header with back, `Group`, and close actions.
- `Group by` property selector.
- `Sort` selector with `Manual`, `Alphabetical`, and `Reverse alphabetical`.
- `Hide empty groups` toggle, enabled by default.
- `Groups` list with drag handles and per-group visibility buttons.
- `Hide all` or `Show all` bulk action.
- `Remove grouping` action.

Selecting a group property updates the panel in place rather than dismissing it. Drag handles are enabled only for Manual sorting. Changes apply to planner content immediately.

If every group is hidden, the planner retains its time sections and cards and shows their normal empty state. `Remove grouping` clears the group property, manual order, and hidden group keys. It does not change filters or item sort rules.

## Settings Model

Each planner view owns an independent settings value:

```ts
type PlannerGroupSort =
  | "manual"
  | "alphabetical"
  | "reverse_alphabetical";

type PlannerGroupSettings = {
  groupBy: PlannerGroupBy;
  sort: PlannerGroupSort;
  hideEmpty: boolean;
  manualOrder: string[];
  hiddenGroupKeys: string[];
};
```

Defaults are:

```ts
{
  groupBy: "none",
  sort: "manual",
  hideEmpty: true,
  manualOrder: [],
  hiddenGroupKeys: [],
}
```

## Group Universe

The selected view and period determine the group universe shown in the settings panel.

- Area, Project, and Routine use the loaded related-item maps.
- Item type and Status use the values supported by the current planner view.
- Tag uses distinct tags discovered in the loaded planner data.
- Missing relations use `No area`, `No project`, and `No routine` groups.
- Items without tags use `Untagged`.

Group keys remain stable identifiers. Labels are presentation values and may change without losing manual ordering or visibility state.

When `Hide empty groups` is enabled, the panel omits groups with no items anywhere in the selected view and period. When disabled, known empty relation and fixed-value groups also appear in the panel. Empty groups are not repeated inside individual Daily sections or Weekly date cards.

## Grouping Pipeline

Planner derivation follows this order:

1. Exclude terminal items and apply existing planner filters.
2. Apply existing item sort rules.
3. Build the group universe for the active view and period.
4. Remove group keys listed in `hiddenGroupKeys`.
5. Order the remaining groups using the selected group sort.
6. Place items into the resulting groups inside the existing time containers.

Tag grouping places an item with multiple tags in every matching tag group. Other grouping properties place each item in exactly one group.

### Group Sorting

- `Manual` uses `manualOrder`. Known keys absent from the saved order append to the end.
- `Alphabetical` sorts by the displayed label with `Intl.Collator`.
- `Reverse alphabetical` reverses the same label comparison.
- Dragging a group updates `manualOrder` and is unavailable for alphabetical modes.

## Persistence

Settings use versioned browser-local keys:

```text
oracle-todo.planner-group-settings.v1.yearly
oracle-todo.planner-group-settings.v1.monthly
oracle-todo.planner-group-settings.v1.weekly
oracle-todo.planner-group-settings.v1.daily
```

The controller loads settings when initialized and writes them after changes. Persistence is best-effort:

- Missing or malformed data resolves to defaults.
- Unsupported enum values and invalid field shapes are discarded during normalization.
- Saved keys that no longer exist are ignored during derivation.
- Newly discovered group keys append after saved manual keys.
- Storage read or write failures do not block the planner; session state remains usable.

No API, service-layer, or SQLite changes are required.

## Component Boundaries

### Group settings model

A focused frontend module owns:

- Types and defaults.
- Stored-value normalization.
- Group-universe construction.
- Group visibility and ordering functions.

These operations remain pure and independently testable.

### Workbench controller

The controller owns the four view-specific settings values and local-storage synchronization. It exposes intent-level actions for selecting a property, changing sort mode, toggling empty groups, changing group visibility, reordering groups, and removing grouping.

### Group panel

The panel owns only temporary navigation state such as whether the property or sort selector is open. It renders controller state and invokes controller actions.

### Planner model and renderer

The planner model accepts normalized settings and produces ordered visible groups. The renderer preserves existing period cards, goal sections, day cards, and Daily sections.

## Accessibility

- The Group trigger exposes its current expanded state.
- Panel controls use buttons, switches, and list semantics with accessible names.
- Escape closes the panel and restores focus to the Group trigger.
- Back returns from property and sort selectors to the group settings screen.
- Keyboard users can reorder Manual groups with explicit move-up and move-down actions even when pointer dragging is available.
- Visibility icons expose `Hide <group>` or `Show <group>` labels.

## Testing Strategy

### Pure model tests

- Normalize valid, partial, malformed, and obsolete stored settings.
- Build relation, fixed-value, missing-value, and tag groups.
- Duplicate multi-tag items into every matching tag group.
- Apply Manual, Alphabetical, and Reverse alphabetical ordering.
- Append newly discovered keys after saved Manual keys.
- Apply individual and bulk visibility changes.
- Include or exclude globally empty groups based on the toggle.

### Controller tests

- Keep settings independent across all four planner views.
- Restore each view after controller remount.
- Continue with session state when storage access fails.
- Remove only grouping-related settings.

### Presentation tests

- Render the shared Notion-style panel in every planner view.
- Limit Yearly and Monthly properties to Tag and Status.
- Expose all supported properties in Weekly and Daily.
- Update content immediately after settings changes.
- Preserve Yearly and Monthly goal periods, Weekly date cards, and Daily sections.
- Hide, show, bulk-toggle, and reorder groups.
- Verify keyboard navigation, close behavior, and focus restoration.

Verification commands:

```bash
cd frontend
npm run test
npm run typecheck
npm run build
```

## Out of Scope

- Nested grouping or more than one group property.
- Server-side or cross-browser settings synchronization.
- New planner endpoints or database tables.
- Grouping Monthly calendar items.
- Custom group colors, renaming, or creation.
- Dragging planner items between groups.

## Success Criteria

- All four planner views use the same group settings interaction.
- Group settings persist independently per view after a reload.
- Group ordering and visibility update content without changing its time structure.
- Yearly and Monthly retain their current Tag and Status scope.
- Weekly and Daily retain their current property scope and time containers.
- Invalid stored settings never prevent planner rendering.
