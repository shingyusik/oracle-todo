# Health Journal Action Styles Design

## Goal

Match Health Journal table actions and creation dialogs to the established Ledger presentation
without changing Health behavior.

## Table And Detail Actions

- Render each Health table Add action as the installed Lucide `Plus` icon.
- Render each Health table selected-row archive action as the installed Lucide `Trash2` icon.
- Keep the existing accessible names and expose the same text through `title` tooltips.
- Mark icons `aria-hidden="true"`; button state and focus behavior remain unchanged.
- Keep the existing icon-only Delete action in Diet, Bowel, Medication, and Health Metrics
  detail headers.
- Keep confirmation-dialog actions as text so the final destructive choice remains explicit.

## Creation Dialogs

Apply the Ledger creation-dialog action layout to Diet, Bowel, Medication, and Health Metrics:

- keep only the dialog title in the header;
- place `Close` and `Save` together in a footer below the form;
- use the existing Ledger compact secondary and primary button classes;
- use the existing shared `.field-label` input, select, and textarea presentation;
- keep each form's validation, draft, pending, retry-only recovery, keyboard trap, dismissal guard,
  and focus restoration unchanged.

The Health forms may accept an optional dialog-close callback so their existing standalone and
Quick Add callers retain their current layout. No shared React action component or new CSS class
is introduced.

## Accessibility

- Icon-only actions retain stable accessible names and visible tooltips.
- `Close` remains disabled while a save or refresh recovery is pending.
- `Save` retains the form's native submit behavior and pending label.
- Dialog focus trapping, modal isolation, Escape/backdrop handling, and trigger focus restoration
  remain unchanged.

## Verification

- Presentation tests prove Health table actions render `Plus` and `Trash2` without visible labels.
- Detail tests continue to prove icon-only Delete actions.
- Dialog tests prove the header has no Close action and the footer contains equal-width Close and
  Save actions using the Ledger classes.
- Existing Health creation, failure-draft, pending, recovery, focus, and Quick Add regressions pass.
- Frontend type checking and build pass.

## Non-Goals

- Changing mutation, archive, retry, or focus behavior
- Iconizing destructive confirmation buttons
- Restyling detail editors or Quick Add
- Adding a new icon-button or dialog-action abstraction
