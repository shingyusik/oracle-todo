# Planner tag, popover, and monthly navigation design

## Scope

Improve three related Planner interactions without changing the todo-engine API or item data model:

1. Make Planner creation tags use the same chip-based combobox as detail editing.
2. Make Planner table Filter, Sort, and Group by menus viewport-safe.
3. Give Monthly the same period navigation affordances as Weekly and Daily, with direct year/month selection.

## Tag creation

`CreationDialog` will hold tags as a `string[]` and render the existing `TagsInput` control instead of a comma-separated text field. The control displays selected tags as removable chips, filters known tags as the user types, and commits a new typed tag on Enter or when focus leaves the control. Creation submits the selected array unchanged. This preserves existing tag normalization and avoids a second tag interaction model.

## Viewport-safe table menus

Planner table Filter, Sort, and Group by menus will render through a shared floating-menu layer attached to `document.body`. When opened, the layer measures its trigger and menu, chooses above/below placement based on available viewport space, clamps horizontal position, and constrains menu height with internal scrolling when necessary. It recalculates on viewport resize and scrolling. Dismissal, focus behavior, and menu actions remain unchanged.

This avoids relying on ancestor `overflow` values, so horizontal table scroll containers cannot clip menus regardless of where the controls appear.

## Monthly navigation

Monthly will receive a period toolbar that includes previous month, next month, and Now controls. Its center control opens a year/month selector initialized to the visible month. Selecting a value updates the Planner monthly date anchor and closes the selector. Navigation uses existing calendar date helpers, so the rendered month, data query, filters, and default date for newly created Planner items remain synchronized.

## Validation

- Unit/component tests cover tag selection, typed tag creation, and removal in the creation dialog.
- Tests cover calculated menu placement for below, above, horizontal clamping, and constrained height.
- Monthly navigation tests cover previous, next, now, and direct year/month selection.
- Run the frontend type/lint/test suite and a production build; manually verify menus at the bottom of a narrow Planner table.
