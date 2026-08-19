# Health Bowel UX Design

## Goal

Provide fast bowel-record capture and review using the established Health Diet table,
saved-view, dialog, detail, and recovery interactions. Bowel records remain existing Health
events; this feature adds no schema, database, or generic Health UI framework.

## Table

The Bowel tab shows active records only. Default columns are:

1. Time
2. Bristol Scale
3. Blood Visible
4. Note

Blood visibility is displayed as `Yes` or `No`. The default view is ungrouped and sorted by
Time descending, with the record ID as the deterministic final tie-breaker.

The header follows the Diet layout:

- saved views on the left;
- Filter, Sort, Group, Add, and Delete on the right;
- selection and select-all apply only to visible logical rows;
- Delete is disabled when no visible row is selected.

Empty states distinguish no stored records from no records matching the current view.

## View Configuration

Bowel uses the dedicated `health.bowel` saved-view scope.

Supported filters are:

- Time or date
- Bristol Scale, with values 1 through 7
- Blood Visible, with `Yes` and `No` choices

Supported sorts are:

- Time
- Bristol Scale
- Created
- Updated

Supported groups are:

- None
- Month
- Week
- Day
- Bristol Scale
- Blood Visible

The existing shared table-view controls, persistence, dirty-view confirmation, save retry,
group ordering, and filter matching are reused. Bowel-only fields do not become valid ToDo,
Ledger, or Diet view fields.

## Creation

Add opens a modal dialog with this field order:

1. Time
2. Bristol Scale
3. Blood Visible
4. Note

Time and Bristol Scale are required. Bristol Scale is a native dropdown restricted to
integers 1 through 7. Blood Visible is a native checkbox and defaults to false. Note is
optional and blank input is stored as null.

The dialog uses the established Health modal contract:

- body portal and background isolation;
- initial focus and forward/reverse Tab trapping;
- Escape and backdrop close only while idle;
- pending submission blocks duplicate submission and closing;
- failure preserves every field and shows an actionable error;
- success closes the dialog and restores focus to Add.

If the mutation commits but a required refresh fails, the form becomes read-only and offers
Retry refresh. Retry performs reads only and never repeats the create mutation.

## Detail

Activating a row opens its detail view. The editor preserves the creation field order and
adds Created and Updated as read-only timestamps.

Detail actions are:

- Back
- Undo
- Redo
- Save
- Delete

Save sends only canonically changed fields with the opened record's `updatedAt` as
`expectedUpdatedAt`. Time converts between the local `datetime-local` value and RFC3339;
nonexistent local times are rejected rather than silently normalized. Bristol Scale remains
an integer from 1 through 7.

Undo and Redo use the bounded Health detail history. Keyboard behavior matches Diet:

- Ctrl/Cmd+S saves a valid dirty draft;
- Ctrl/Cmd+Z undoes;
- Ctrl+Y or Ctrl/Cmd+Shift+Z redoes;
- pending operations block duplicate actions and navigation.

Browser Back and Forward use the shared detail-history coordinator with a distinct Bowel
history-state key. Dirty browser navigation opens the discard confirmation. Closing a clean
detail restores focus to the originating row when it remains visible, otherwise to Add.

## Archive

Delete archives records through the existing Health event lifecycle; it never hard-deletes.
Archived records disappear from the table, view candidates, selection, and open detail.

Batch archive:

- snapshots visible selected IDs in display order;
- archives sequentially;
- removes successful IDs from selection;
- stops on the first failure and retains failed or unattempted selections;
- restores focus to Delete after cancel or failure and to Add after complete success.

When archive commits but refresh fails, the committed record is tombstoned immediately so
stale loaded data cannot make it reappear. The warning and tombstone survive Health leaf-tab
switches. Retry performs the Bowel, Timeline, and Reports reads only; authoritative Bowel
truth reconciles the tombstone.

## Data Flow

- `health.sqlite` remains the source of truth.
- Bowel records remain `HealthEvent` values with category `bowel`.
- The controller loads the complete active Bowel collection through the existing paginated
  `GET /api/v1/health/events?category=bowel` boundary.
- The Bowel table derives filtering, deterministic multi-sort, and grouping from that
  collection without mutating API data.
- Create, update, and archive use the existing Health event mutation routes and application
  service, preserving validation, optimistic concurrency, and audit history.
- Successful Bowel mutations refresh the dedicated Bowel collection plus the existing
  internal Timeline and Reports projections that depend on health events.
- Ordinary concurrent Bowel refreshes coalesce; mutation refreshes supersede older reads;
  stale success or failure cannot replace the newest outcome.

## Loading and Recovery

The Bowel tab distinguishes:

- initial loading;
- no bowel records;
- no records matching the view;
- blocking initial-load failure with Retry;
- non-blocking refresh failure while retaining the last complete table;
- committed-mutation refresh failure with reads-only Retry.

All retry actions preserve drafts, selection, detail identity, and saved-view state when
those values remain valid.

## Verification

- exact columns, labels, Yes/No rendering, and active-only rows;
- Bowel-only view scope, allowed fields, normalization, persistence, and dirty confirmation;
- filter AND/OR behavior, deterministic multi-sort, every group, hidden groups, and ordering;
- Add dialog validation, focus isolation, pending lock, failure retention, and reads-only
  recovery;
- detail minimal patch, optimistic timestamp, local-time conversion, Undo/Redo, shortcuts,
  dirty navigation, and browser Back/Forward;
- visible-only selection, sequential partial archive, committed-refresh tombstones, leaf-tab
  lifetime, and focus restoration;
- request coalescing, stale completion rejection, and mutation/read call counts;
- no regressions in Diet, ToDo, Ledger, Timeline, or Reports behavior.

## Non-Goals

- New Bowel database tables or API routes
- Archived-record browser, restore UI, purge UI, or audit-history UI
- Free-text Bristol values or user-defined bowel fields
- Symptoms, diagnosis, recommendations, or alerts
- A new generic framework for all Health record tabs
