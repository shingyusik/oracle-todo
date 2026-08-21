# Health Bowel Checkbox Layout Design

## Goal

Render the Bowel `Blood Visible` checkbox as a compact, left-aligned form control instead of a full-width input.

## Design

- Add a neutral `.field-checkbox` form class using the existing Ledger checkbox layout: inline flex alignment, an 8px gap, and a 16×16 checkbox.
- Apply the class only to the Bowel `Blood Visible` label.
- Keep the checkbox before its text so the accessible label and visual reading order remain `checkbox → Blood Visible`.
- Preserve the current checked state, pending/recovery fieldset lock, payload, validation, and focus behavior.

## Verification

- A presentation test proves the real Bowel form uses `.field-checkbox` and retains the accessible name.
- A design-boundary test proves the shared class keeps the checkbox at 16×16 with no inherited full-width sizing.
- Relevant Health form and Bowel panel tests, frontend type checking, and the production build pass.

## Non-Goals

- Changing other checkbox controls
- Changing Bowel data or mutation behavior
- Introducing a checkbox component or dependency
