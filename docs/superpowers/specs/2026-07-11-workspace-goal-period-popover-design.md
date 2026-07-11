# Workspace Goal Period Popover Design

**Date:** 2026-07-11
**Status:** Awaiting user review
**Scope:** Replace the always-visible Workspace Goal period picker with a shared popover control.

## Goal

Keep period editing compact until requested while allowing users to choose the period type and its value in one selection surface.

The control is used in all three Workspace Goal surfaces:

- Goals table inline period cell
- Goal detail view
- Workspace Goal creation dialog

## Closed State

The control renders as one button showing the current period:

```text
Month · July 2026
```

Activating the button opens the period popover. The calendar is never visible while the control is closed.

## Popover Layout

The popover contains, in order:

1. A four-option type selector: Year, Month, Week, Day.
2. A value picker for the selected type.
3. A range summary for the candidate period.

Year uses the existing year selection list. Month, Week, and Day use the existing calendar grid with month navigation.

The type selector stays visible with the value picker so users can change both parts of a period without leaving the popover.

## Interaction

- Opening the popover initializes a local candidate from the current stored period.
- Choosing a type updates only the local candidate and swaps the value picker. The popover remains open.
- Choosing a year or calendar day commits the type and canonical scheduled value together, then closes the popover.
- Clicking outside the popover or pressing Escape closes it without committing a candidate type change.
- The trigger text updates only after a committed period selection.

Existing canonicalization remains unchanged:

| Type | Canonical stored scheduled value |
| --- | --- |
| Year | January 1 of the selected year |
| Month | First day of the selected month |
| Week | ISO Monday of the selected day |
| Day | Selected day |

## State And Persistence

`GoalPeriodControl` owns popover visibility and the uncommitted candidate type. Its existing consumer callback remains the single commit boundary.

| Surface | Behavior after a value selection |
| --- | --- |
| Goals table | Invoke the existing inline patch flow once with horizon and canonical scheduled values. |
| Goal detail | Update the existing detail draft only. |
| Creation dialog | Update the existing creation draft only. |

No API endpoint, request shape, database schema, or service behavior changes.

## Accessibility

- The trigger exposes its current period and expanded state.
- The popover can be dismissed with Escape and an outside click.
- Existing calendar day labels and keyboard focus behavior remain available.
- Type controls use buttons with a visible selected state rather than a second native select.

## Error Handling

The table continues using the existing inline patch error path. A failed patch does not leave a locally committed trigger value that disagrees with the persisted item. Detail and creation flows retain their existing validation and submission behavior.

## Verification

Presentation tests cover:

- Closed-by-default rendering in table, detail, and creation contexts.
- Opening the popover from its trigger.
- Switching type without committing or closing.
- Dismissing a type change with Escape or outside click.
- Selecting a value applies the candidate type and closes the popover.
- Table selection invokes one existing patch flow.
- Detail and creation selections update only their local drafts.
- Week selection persists the ISO Monday anchor.

## Non-Goals

- A new date-picker dependency.
- Free-form date entry or parsing.
- Separate Apply or Cancel actions.
- Changes to non-goal period controls.
