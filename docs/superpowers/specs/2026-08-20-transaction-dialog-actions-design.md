# Ledger Creation Dialog Actions Design

## Goal

Make Ledger creation dialogs consistent, and make the selected transaction type obvious.

## Design

- Apply the action layout to Add transaction, Add account, and Add category.
- Remove the Close button from each creation-dialog header.
- Add a footer below each form with Close and Save aligned to the right.
- Give both footer buttons the same compact width; Close is secondary and Save is primary.
- Label the submit action `Save` in all three creation dialogs.
- Render Expense, Income, and Transfer as an equal-width segmented control.
- Show the selected segment with the existing Ledger accent border, stronger text, and a light background; keep unselected segments neutral.
- Keep Category type as its existing select; only Transaction has mode tabs.
- Preserve each dialog's existing keyboard navigation, focus trap, pending-state dismissal guard, error handling, and successful close behavior.

## Implementation Boundary

Keep the existing dialog and form components. Each dialog continues to own its pending state and actions. Reuse shared CSS classes for the footer and buttons, but do not add a shared React component for three short action blocks. Account settings and detail views remain unchanged.

## Verification

- The selected transaction type has a distinct visual state and retains `aria-selected`.
- Close and Save appear together at the bottom of all three creation dialogs and use equal compact widths.
- Every creation dialog uses the visible submit label `Save`.
- Close remains disabled while the corresponding save is pending.
- Existing keyboard navigation, successful close, failed-submit draft preservation, and Transaction refresh recovery continue to work.
