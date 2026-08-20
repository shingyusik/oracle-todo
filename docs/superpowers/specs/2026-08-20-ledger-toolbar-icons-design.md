# Ledger Toolbar Icons Design

## Goal

Render Ledger table actions as compact icon-only buttons while preserving their behavior,
accessible names, and focus restoration.

## Scope

The shared Ledger table header uses these controls:

| Action | Icon | Accessible name and tooltip |
| --- | --- | --- |
| Add transaction | `Plus` | `Add transaction` |
| Archive selected transactions | `Trash2` | `Archive selected transactions` |
| Account settings | `Settings` | `Account settings` |
| Add account | `Plus` | `Add account` |
| Delete selected accounts | `Trash2` | `Delete selected` |
| Add category | `Plus` | `Add category` |
| Delete selected categories | `Trash2` | `Delete selected` |

All icons come from the installed `lucide-react` package. The existing
`items-toolbar-button` sizing and visual states remain unchanged.

## Interaction and Accessibility

- Buttons contain only their icon; no visible text label is rendered.
- Each button keeps its current `aria-label` and exposes the same text through `title`.
- Icons use `aria-hidden="true"` because the button supplies the accessible name.
- Dialog behavior, disabled states, confirmation flows, and focus restoration are unchanged.

## Verification

- Presentation tests locate every action by its existing accessible name.
- Header tests confirm the expected icon is rendered without a visible text label.
- Frontend type checking and the relevant Ledger presentation tests pass.

## Non-Goals

- Changing ToDo or Health toolbar actions
- Introducing a shared icon-button abstraction
- Changing toolbar spacing, colors, or button dimensions
