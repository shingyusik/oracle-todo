# Workspace Goal Period Picker Options Design

**Date:** 2026-07-12
**Status:** Approved for implementation planning
**Scope:** Improve the Workspace Goal `Period` popover value pickers without changing stored period semantics.

## Goal

Make each Goal period type feel like a period selector rather than a raw date selector.

- `Year` supports broad scrolling selection.
- `Month` uses a year-scoped 12-month grid.
- `Week` keeps the calendar view but highlights whole ISO weeks.
- Stored values remain `horizon` plus canonical `scheduled`.

## Existing Boundaries

The existing `GoalPeriodControl` remains the shared control for:

- Goals table inline period cell
- Goal detail view
- Workspace Goal creation dialog

The popover shell, period type selector, outside-click dismissal, Escape behavior, commit boundary, and inline patch error handling stay unchanged.

## Year Picker

`Year` replaces the limited year button list with a scrollable year dropdown.

- The dropdown includes the current local year through a wide range: current year minus 50 through current year plus 50.
- If the stored selected year falls outside that range, the dropdown includes it too.
- Selecting a year commits immediately.
- The committed value is canonicalized to `YYYY-01-01`.

The control is intentionally plain: users can scroll up or down until they find the target year.

## Month Picker

`Month` replaces the date calendar with a year navigation header and 12-month grid.

Layout:

```text
< 2026 >

Jan  Feb  Mar  Apr
May  Jun  Jul  Aug
Sep  Oct  Nov  Dec
```

Behavior:

- The header year starts from the current candidate month.
- Previous and next buttons move the month grid by one year.
- The selected month has a visible selected state.
- Selecting a month commits immediately.
- The committed value is canonicalized to `YYYY-MM-01`.

The range summary continues to show the selected month start and end dates.

## Week Picker

`Week` keeps the existing calendar month view and month navigation, but changes the selection feedback.

- Hovering any date highlights that date's full ISO week from Monday through Sunday.
- Selecting any date highlights the selected ISO week from Monday through Sunday.
- The highlight reads as one horizontal week bar across the calendar row, not as unrelated selected day buttons.
- Dates from adjacent months still participate in the same ISO week highlight when visible in the calendar grid.
- Clicking any date commits immediately.
- The committed value is canonicalized to the ISO Monday for that date.

If hover and selected weeks differ, hover is a temporary preview and selected remains the committed-period indication.

## Accessibility

- The year dropdown has an accessible label of `Goal year`.
- Month buttons expose month and year in their accessible names.
- Week calendar day labels continue to describe the week that will be selected.
- Hover styling is visual only; keyboard focus and `aria-pressed` still expose the selected week.
- Escape and outside click keep their current non-commit behavior.

## Data Flow

No API, service, or database changes are required.

| Horizon | User selection | Stored `scheduled` |
| --- | --- | --- |
| `year` | Year dropdown option | January 1 of selected year |
| `month` | Month grid button | First day of selected month |
| `week` | Calendar date | ISO Monday of selected week |

All three pickers continue to call the existing `onCommit({ horizon, scheduled })` callback once per committed selection.

## Error Handling

The existing inline Goal period error path remains unchanged.

- Table commits that fail leave the persisted trigger value unchanged.
- Detail and creation commits update local drafts only.
- Goal policy errors still use the current modal feedback.

## Verification

Presentation tests cover:

- Year dropdown renders a broad year range and commits `YYYY-01-01`.
- A selected year outside the default range is still available.
- Month picker renders previous/next year navigation and a 12-month grid.
- Month selection commits `YYYY-MM-01`.
- Week hover previews a full ISO week row.
- Week selection marks the full ISO week and commits the ISO Monday anchor.
- Existing popover dismissal, type switching, and error feedback behavior still pass.

## Non-Goals

- New Goal horizons such as quarter or day.
- Free-form period parsing.
- A new date-picker dependency.
- Backend validation or schema changes.
- Changing non-goal date controls.
