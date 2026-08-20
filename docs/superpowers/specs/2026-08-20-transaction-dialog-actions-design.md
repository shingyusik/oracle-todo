# Transaction Dialog Actions Design

## Goal

Make the selected transaction type obvious and keep the dialog actions compact and grouped.

## Design

- Remove the Close button from the dialog header.
- Add a footer below the form with Close and Save aligned to the right.
- Give both footer buttons the same compact width; Close is secondary and Save is primary.
- Label the submit action `Save` for expense, income, and transfer.
- Render Expense, Income, and Transfer as an equal-width segmented control.
- Show the selected segment with the existing Ledger accent border, stronger text, and a light background; keep unselected segments neutral.
- Preserve the existing tab semantics, keyboard navigation, focus trap, pending-state dismissal guard, and error/retry behavior.

## Implementation Boundary

Keep the existing dialog and form components. Pass the Close action into the form only for the creation dialog, then render the shared footer there so Save and Close remain adjacent without duplicating submit state.

## Verification

- The selected transaction type has a distinct visual state and retains `aria-selected`.
- Close and Save appear together at the bottom, use equal compact widths, and Close remains disabled while saving.
- Every creation mode uses the visible label `Save`.
- Existing keyboard navigation, successful close, failed-submit draft preservation, and refresh recovery continue to work.
