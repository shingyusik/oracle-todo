# Postpone Date Selection Design

## Purpose

Allow users to choose the follow-up date when marking Planner work as missed
and postponed. The existing next-day behavior remains the default.

This design updates only the Planner interaction described in
`2026-07-24-postpone-items-design.md`. Existing miss and postpone domain,
service, API, and routine semantics remain unchanged.

## Interaction

The existing `Miss` dialog in Daily, Weekly, and Monthly Planner views shows a
native date input labeled `Postpone date`.

- The input opens with the browser-local next calendar day selected.
- Its minimum selectable date is that same next calendar day.
- Users may select a later date before submitting.
- `Miss and postpone` marks the source as missed and passes the selected ISO
  date to the existing postpone controller action.
- `Mark missed` ignores the input and retains its current behavior.
- Closing and reopening the dialog resets the input to the browser-local next
  calendar day.

The item detail panel continues to have no miss or postpone control.

## Implementation Boundaries

Use the browser's native `<input type="date">`; do not add a date-picker
dependency or a second dialog step. Reuse the existing browser-local tomorrow
helper and the existing controller method that already accepts an explicit
scheduled date.

No API, application-service, domain-model, database, or CLI change is needed.

## Validation and Errors

The native input sets its `min` value to browser-local tomorrow. `Miss and
postpone` is disabled when the date is empty or earlier than that minimum. The
existing dialog error presentation handles a failed postpone request.

## Accessibility

The date input has a visible label associated with the control. Existing
dialog focus and keyboard behavior remain intact, and the native control
provides platform date-picker behavior on desktop and mobile.

## Verification

Frontend tests verify that:

- the dialog initializes the date and minimum to browser-local tomorrow;
- a user-selected future date is sent to the postpone controller action;
- `Mark missed` still performs only the miss action;
- reopening the dialog restores tomorrow rather than the previous selection;
- an empty or invalid date cannot be submitted.
