# Detail Browser History Design

## Purpose

Make browser Back and Forward navigation follow Raven's Workspace detail visits.
Users can leave a detail view with either the browser Back action or the existing
header Back button without silently losing an edited draft.

The change applies to Workspace item details and linked-item detail navigation.
It does not add deep links, URL parameters, or reload-time detail restoration.

## History Model

The UI stores a Raven-namespaced detail marker in `window.history.state` while
leaving the current URL unchanged. The marker contains the open item ID; list
entries have no detail item ID. Existing unrelated fields in `history.state`
remain intact.

Opening a detail from a list pushes one detail entry. Opening a linked item
pushes another. Back and Forward therefore traverse the actual visit order:

```text
list <-> parent detail <-> linked detail
```

The history coordinator remains mounted while the main panel shows either a
list or a detail so Forward can restore a detail after returning to the list.
It resolves stored IDs from the controller's loaded Workspace items. If a
stored item no longer exists, navigation falls back to the current list.

When another Raven tab closes the detail outside a history action, the current
entry is replaced with a list marker. This prevents a stale detail marker from
reopening an item unexpectedly.

## Back Actions and Unsaved Drafts

The existing header Back button requests `history.back()` instead of clearing
the detail directly. It therefore behaves exactly like browser Back.

When the draft is unchanged, Back immediately restores the preceding detail or
list. When the draft has changes, the coordinator keeps the current detail
visible and opens the existing `Discard unsaved changes?` confirmation pattern:

- `Cancel` keeps the current detail and draft;
- `Discard changes` performs the originally requested history navigation once.

The dialog retains the existing initial focus on `Cancel`, Tab focus trap, and
Escape-to-cancel behavior. Linked-item navigation continues to use the same
confirmation wording and interaction. A linked detail entry is pushed only
after the user confirms discarding a dirty draft.

## Components and State Flow

`MainPanel` owns the browser-history coordinator because it remains mounted on
both list and detail screens. `DetailView` reports whether its draft differs
from the loaded item and delegates its header Back action to the coordinator.

The coordinator distinguishes user-opened details from details restored by a
`popstate` event so restoration does not push a duplicate entry. It also holds
the pending Back destination while the discard dialog is open. No API,
controller mutation, persistence, or domain-model change is required.

## Error and Edge Handling

- Repeated Back requests are ignored while the discard dialog is open.
- Canceling a browser Back restores the current detail history marker without
  duplicating the visible visit.
- Confirming discard replays the pending navigation once and bypasses the dirty
  guard for that replay only.
- Unknown or unavailable stored item IDs resolve to the list rather than an
  empty detail screen.
- A history event without Raven's namespaced marker is treated as a list
  destination.

## Verification

Frontend presentation tests verify:

- list to detail to list navigation with browser Back;
- the header Back button follows the same history path;
- linked details traverse parent detail and list in order;
- Forward restores previously visited details;
- clean drafts navigate without confirmation;
- dirty drafts preserve their values after Cancel or Escape;
- dirty drafts navigate only after `Discard changes`;
- missing stored item IDs fall back to the list;
- unrelated `history.state` fields are preserved.
