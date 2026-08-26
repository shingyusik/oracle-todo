# Filter Dropdown and Tag Trigger Design

## Goal

Keep nested filter option lists visible outside the scrollable filter panel and make the entire tag field open its tag dropdown without an `Add` button.

## Design

### Filter options

`TableViewFilterOptionDropdown` remains inside the filter panel so the existing outside-click handling continues to treat it as part of the dialog. While open, its option list uses viewport-fixed coordinates derived from the value trigger and its measured size. The coordinates are recalculated on window resize and capture-phase scroll, using the existing viewport-margin and above/below placement rules.

This removes the list from the scroll panel's absolute-positioning boundary. The outer panel keeps its `max-height` and `overflow-y: auto`, so the filter dialog itself still fits the viewport.

### Tag input

The shared `TagsInput` component keeps the existing accessible trigger button but removes the visible `Add` label. This applies to every current consumer, including ToDo workspace table/detail/create fields and Health diet form/detail fields, as well as future consumers of the component. The tag field opens the dropdown when its background, placeholder, or a tag chip is clicked; remove buttons continue to remove only their tag. An empty field displays `Select or enter tags...`, while a populated field leaves the remaining trigger area visually empty.

No API, persistence, or tag parsing behavior changes.

## Interaction and Accessibility

- The filter value trigger keeps its current label and expanded state.
- The tag trigger keeps its current accessible label, listbox relationship, focus behavior, and disabled behavior.
- Escape, outside-click dismissal, IME handling, and tag commit behavior remain unchanged.

## Error Handling

If a trigger or dropdown cannot be measured during a render, the existing in-flow styles remain until the next layout update. No data mutation depends on positioning.

## Testing

- Add a presentation regression test that opens a filter option list with constrained geometry and verifies viewport-fixed placement.
- Add presentation regression coverage through the shared component that confirms no visible `Add` control remains and clicking the tag field opens the combobox. Existing ToDo and Health consumer tests must remain green.
- Run the focused presentation tests, frontend typecheck, and frontend test suite.

## Out of Scope

- Replacing all dropdowns with a new shared popover abstraction.
- Changing filter semantics, tag persistence, or visual styling beyond the selected empty-state hint.
