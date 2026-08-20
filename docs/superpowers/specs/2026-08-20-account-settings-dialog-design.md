# Account Settings Dialog Design

## Goal

Make Account settings consistent with the Ledger creation dialogs while keeping its two-column settings workflow intact.

## Design

- Remove Close from the dialog header; the header contains only `Account settings`.
- Render Account types and Currencies as an equal-width segmented control with a clearly bordered, filled, bold selected state.
- Keep the existing form-left, list-right layout and the existing stacked mobile layout.
- Add a short form heading that reflects the current mode: New or Edit account type, and New or Edit currency.
- Move the active form's submit action to the dialog footer using the native button `form` attribute.
- Place equal-width compact Close and Save buttons together at the footer's right edge.
- Use `Save` for both create and edit. While pending, show `Saving…` and disable Close, Save, tabs, fields, and row actions.
- Keep Cancel edit inside the form because it resets only that form draft rather than closing the dialog.

## Behavior

The footer Save submits only the active tab's form. Successful save keeps Account settings open, resets the editor, and refreshes through the existing controller method. Failures keep the draft and show the existing safe inline error. Tab changes continue to reset both editors and errors.

The dialog retains Escape dismissal, focus restoration, nested deactivation confirmation, and focus containment. Inactive roving tabs remain outside the normal Tab order.

## Implementation Boundary

Change only `AccountSettingsDialog`, its presentation tests, and its scoped CSS. Reuse the existing Ledger dialog action classes. Do not change Account or Category creation dialogs, detail screens, services, or APIs, and do not add a shared React component.

## Verification

- Header, segmented tabs, two-column content, form headings, and footer actions render in both tabs.
- Footer Save creates and updates the active resource with the existing payloads.
- Close and Save share the footer, remain compact and equal-width, and disable while pending.
- Cancel edit resets only the active editor.
- Errors preserve drafts; successful saves reset them without closing Account settings.
- Arrow-key tabs, natural Tab order, focus wrapping, Escape, focus restoration, and deactivation confirmation continue to work.
