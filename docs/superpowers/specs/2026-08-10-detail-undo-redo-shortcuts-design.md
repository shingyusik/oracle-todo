# ToDo Detail Undo, Redo, and Save Shortcuts Design

## Goal

Add page-local editing history and keyboard shortcuts to the shared ToDo detail view used
from both Workspace and Planner. Users can save, undo, and redo without confusing these
actions with server-wide or cross-item rollback.

## Scope and safety boundary

- The feature applies only while a ToDo detail view is open.
- Undo and redo change only the current detail page's in-memory `DetailDraft`.
- Undo and redo never mutate the server, audit history, another item, or another page.
- After a successful save, history remains available. Undo changes only the visible draft
  and makes it dirty; the user must press Save again to persist that draft to the current item.
- Server-level ToDo undo remains separate work under SHI-20.
- Ledger, Health, Planner tables, Workspace tables, and other Raven forms are out of scope.

## Draft history model

The detail view owns a local snapshot history with `past`, `present`, and `future` draft
states. A draft update records the previous complete `DetailDraft`, which keeps multi-field
changes atomic and avoids field-specific inverse commands.

One focused editing session is one history step:

- consecutive changes to the same focused text control are coalesced;
- leaving the control, saving, undoing, or redoing closes the current editing session;
- discrete controls such as selects and relation pickers produce a step for each committed
  interaction;
- compound controls such as Goal period selection update all affected fields in one step;
- editing after Undo clears `future` because the old Redo branch is no longer reachable.

Opening a different detail item resets the local history. A successful save updates the
server baseline used by dirty-state comparison but does not clear `past` or `future`. A
failed save preserves the draft and all history.

## Header controls and keyboard behavior

The detail header actions are ordered as Back, Undo, Redo, and Save.

- `Ctrl+S` and `Cmd+S` save the current dirty draft.
- `Ctrl+Z` and `Cmd+Z` undo the latest page-local edit.
- `Ctrl+Shift+Z` and `Cmd+Shift+Z` redo it.
- `Ctrl+Y` also performs Redo for the common Windows convention.

The handler prevents the browser default only for a recognized detail command. It ignores
commands during IME composition and while the unsaved-changes confirmation dialog is open.
Save is ignored while another save is pending so key repeat cannot submit duplicate
requests.

Undo and Redo buttons are disabled at their respective history boundaries. Save is disabled
when the draft is clean or a save is pending. All icon buttons have accessible names and
tooltips.

## Integration

History stays inside the existing detail presentation layer. All draft mutations continue
through one update path so title, type-specific properties, relations, status, tags, and the
Markdown note participate consistently. Existing controller methods remain the only route
for persistence and status transitions; no API, database, domain, or audit policy changes
are required.

The browser Back/Forward coordinator remains independent. It reads only the dirty flag from
the current draft and does not share or replay the page-local Undo/Redo history.

## Error handling

The detail view catches a rejected patch or status transition and displays a safe inline
error using the existing `RavenApiError` message pattern. The current draft, dirty state,
and Undo/Redo history remain intact, and the pending save guard is always released after
success or failure.

## Verification

Presentation tests will cover:

- the shared detail opened from Workspace and Planner;
- save shortcuts on Windows and macOS and duplicate-save prevention;
- one focused typing session producing one Undo step;
- ordered cross-field Undo and Redo;
- both Redo keyboard conventions;
- Undo/Redo button enabled and disabled states;
- compound Goal period changes as one step;
- Undo followed by a new edit clearing Redo;
- successful save followed by local Undo becoming dirty and Redo returning to the saved value;
- failed save preserving the draft and history;
- confirmation dialogs and IME composition suppressing shortcuts;
- navigation to another detail item resetting history;
- proof that Undo/Redo makes no request until the user explicitly saves.

Type checking, the full frontend test suite, and a production frontend build complete the
verification.
