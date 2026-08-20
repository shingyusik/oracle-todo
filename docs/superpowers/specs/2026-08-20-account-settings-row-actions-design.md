# Account Settings Row Actions Design

## Goal

Make editing and removing an existing Account type clear without changing the current Account settings dialog structure or Ledger lifecycle rules.

## Layout

- Keep the existing segmented tabs and form-left, list-right desktop layout.
- Move `Cancel edit` into a form-heading row beside `Edit account type` or `Edit currency`.
- Keep the Liability checkbox below the Parent account type field as one compact inline control.
- Give Account settings tables scoped column sizing so their complete action column fits without desktop horizontal scrolling.
- Preserve the existing stacked mobile layout; allow the table region to scroll only when the mobile viewport cannot fit its minimum content.

## Row Actions

- Replace visible action text with compact Lucide icon buttons.
- Use `Pencil` for Edit, `CircleOff` for Deactivate, and `Trash2` for permanent Delete.
- Give every icon button a hover/focus tooltip and a contextual accessible name such as `Edit Cash`, `Deactivate Cash`, or `Delete Cash`.
- Keep Deactivate available as the reversible option. Add permanent Delete only to Account type rows in this change.

## Permanent Delete Flow

The backend and API already support previewing and purging an Account category. Add the missing controller methods that delegate to the existing `account-categories` preview and purge endpoints.

Selecting Delete first requests the purge preview. If the Account type is referenced by an Account or child type, the backend rejects the preview and the dialog shows a safe inline error without opening confirmation. If preview succeeds, open a destructive confirmation dialog that states the deletion is permanent and cannot be undone. Confirm with the preview's confirmation ID, then refresh through the controller's existing mutation boundary.

While preview or deletion is pending, prevent duplicate actions and disable dialog dismissal and other mutations. Cancelling confirmation restores focus to the originating Delete button. Successful deletion removes the row; if that row was being edited, reset the form to `New account type` mode.

## Error Handling

- Convert preview and purge failures through `safeLedgerErrorMessage` so storage details are never exposed.
- Keep the Account settings dialog open after failures.
- Clear stale delete errors when the user retries, changes tabs, edits another row, deactivates, or cancels a confirmation.
- Preserve the existing safe save and deactivation behavior.

## Implementation Boundary

Change only the Ledger controller, Account settings dialog, scoped CSS, and their existing tests. Reuse the current Ledger API methods, destructive confirmation dialog, icons, modal isolation, and refresh boundary. Do not change Rust services, routes, schemas, or introduce a shared component.

## Verification

- Cancel edit appears in the editor heading and resets the correct draft.
- Account type actions render as accessible Pencil, CircleOff, and Trash2 icon buttons with tooltips.
- Desktop Account settings tables expose their complete action columns without horizontal overflow caused by the global fixed-width table defaults.
- Referenced Account types cannot be permanently deleted and display a safe error.
- Unreferenced Account types preview, confirm, purge, refresh, and reset a matching editor.
- Pending preview and purge paths reject duplicate actions and block dismissal.
- Confirmation cancel restores focus; tab, Escape, and dialog focus containment behavior remain intact.
- Currency editing receives the corrected Cancel placement but no new permanent Delete action.
