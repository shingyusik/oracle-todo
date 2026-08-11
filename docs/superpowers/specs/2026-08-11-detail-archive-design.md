# ToDo Detail Archive Design

## Goal

Add an Archive action to the shared ToDo detail view used from Workspace and Planner.
The action removes an item from active planning surfaces through Raven's existing ToDo
lifecycle policy; it does not hard-delete data or bypass audit history.

## Scope and terminology

- The user-facing action is named **Archive**, not Delete.
- It applies to every ToDo item type while the item's current persisted status is not
  `archived`.
- An already archived detail does not show the Archive button. This prevents a repeated
  archive request from writing a duplicate lifecycle event.
- The feature reuses `POST /api/v1/todo/items/:id/archive` and the application service.
  No API, database, domain, or audit-policy change is required.
- Restore, hard delete, bulk archive behavior, and Ledger or Health lifecycle controls are
  out of scope.

## Detail header and confirmation

The detail header actions remain Back, Undo, Redo, and Save, followed by Archive. Archive
uses the existing trash icon with an accessible `Archive` name and tooltip. Save and
Archive are disabled while either a save or archive request is pending so the two
mutations cannot race.

Selecting Archive always opens a confirmation dialog; it never sends the request directly.
The dialog identifies the item and explains that it will move to Archive. When the local
detail draft is dirty, the same dialog additionally states that unsaved changes will be
discarded. There is no save-then-archive branch: confirmation archives the last persisted
item state and discards the local draft.

The dialog initially focuses Cancel, traps Tab focus, closes on Escape, and exposes Cancel
and Archive actions. While the request is pending, confirmation cannot be submitted again
and navigation controls remain unavailable.

## Mutation and state flow

Confirmation calls the existing controller transition path with the `archive` action. The
controller's per-item mutation queue and detail-generation check continue to prevent stale
responses from overwriting a different detail page.

On success, the controller removes the archived item from both the visible Workspace
collection and the shared active-item collection, matching the existing bulk Archive
behavior. Selection state drops the archived ID, and related-item projections rebuild from
the remaining active items so the result is immediately reflected without a reload.

The detail then closes. The currently selected Raven leaf tab and all Planner or Workspace
view settings remain unchanged, so the user returns to the exact planning surface from
which the detail session began. This remains true after navigating through linked-item
details because opening a detail does not change the selected leaf tab. Closing outside a
browser Back action lets the existing history coordinator replace the current detail marker
with a list marker, avoiding a stale archived detail on Forward navigation.

## Failure and concurrency behavior

If the archive request fails, the detail and its draft remain unchanged. The confirmation
dialog stays open and renders the safe `RavenApiError` message within the dialog. The user
may retry or cancel after the pending state clears; raw storage errors, paths, or response
internals are never exposed.

Archive cannot start during an active save, and Save cannot start during an active archive.
Keyboard save, Undo, and Redo commands are suppressed while the Archive dialog is open.
Closing or navigating the detail during an in-flight archive is disabled, keeping the
request outcome attached to the page that initiated it.

## Verification

Frontend presentation and controller tests cover:

- Archive placement after Save and accessible button naming;
- button visibility for non-archived items and absence for archived items;
- confirmation for clean drafts;
- the additional discard warning for dirty drafts;
- Cancel, Escape, initial focus, and Tab focus trapping;
- one archive request despite repeated confirmation attempts;
- Save and Archive mutual exclusion and shortcut suppression while the dialog is open;
- successful removal from visible, shared, selected, and related-item state;
- return to the originating Workspace and Planner views with their settings intact;
- successful close after linked-detail navigation returning to the original planning leaf;
- failed requests keeping the dialog and draft open with a safe error and retry path;
- no close or collection removal before the server confirms success.

Type checking, the full frontend test suite, and a production frontend build complete the
verification.
