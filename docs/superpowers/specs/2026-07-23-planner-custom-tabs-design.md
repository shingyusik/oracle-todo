# Planner Custom Tabs Design

**Date:** 2026-07-23
**Status:** Approved for implementation planning

## Goal

Give every Planner table one or more named tabs that save and restore that
table's filter, sort, and group settings. Tabs belong to exactly one stable
Planner table ID and never change another table or the selected Planner date.

## Tab Boundaries

Each table from `PlannerTableId` owns an independent ordered tab list:

- `daily.today`
- `daily.overdue`
- `daily.unscheduled`
- `weekly.month-goals`
- `weekly.week-goals`
- `weekly.day-grid`
- `monthly.period-goals`
- `monthly.calendar`
- `monthly.week-goals`
- `yearly.period-goals`
- `yearly.month-goals`

Every table always has at least one tab. The initial tab is named `Table`, but
it has no permanent default status: it can be renamed, edited, saved, and
deleted whenever another tab remains.

## Persisted Model

The existing `planner.v1` preference document stores ordered tab collections:

```ts
type PlannerTableTab = {
  id: string;
  name: string;
  settings: PlannerTableSettings;
};

type PlannerTableTabs = {
  tabs: PlannerTableTab[];
};

type PlannerPreferenceValue = {
  tableTabs: Record<PlannerTableId, PlannerTableTabs>;
};
```

Tab IDs are stable, opaque frontend-generated identifiers. Tab names are
trimmed, non-empty, and unique within one table using case-insensitive
comparison. Name collisions gain a numeric suffix such as `새 보기 2`.

The active tab and unsaved draft are runtime state. They are not persisted.
The backend API and SQLite schema remain unchanged because
`workspace_preferences.value` already accepts an arbitrary JSON object.

## Migration and Normalization

Preference loading normalizes each table independently:

1. If `tableTabs[tableId]` contains valid entries, retain their order and
   normalize every entry's settings through the existing table-specific
   `normalizePlannerTableSettings` rules.
2. If `tableTabs` is absent, create one `Table` tab per table from the existing
   normalized `tableSettings[tableId]`.
3. If neither representation supplies usable settings, create one `Table` tab
   with `defaultPlannerTableSettings(tableId)`.
4. If a stored table has no usable tabs, recover only that table with one
   default `Table` tab.
5. Resolve duplicate IDs and names during normalization while preserving tab
   order and all otherwise valid entries.

Legacy `tableSettings` remains readable for migration but new writes persist
`tableTabs` as the canonical representation.

## Runtime State and Data Flow

For each table, the Workbench controller owns:

- the persisted ordered tab collection;
- the active tab ID;
- the current editable `PlannerTableSettings` draft.

The active tab starts as the first entry in the table's ordered list. Rendering
uses the draft settings. A deep semantic comparison between the draft and the
active tab's saved settings determines whether the tab is dirty.

The controller applies these transitions:

- **Select tab:** replace the draft with a copy of the selected tab's settings.
- **Edit controls:** update only the draft; keep the same active tab.
- **Save current settings:** replace the active tab's saved settings with the
  draft and persist the preference document.
- **Create tab:** copy the current draft into a new tab, append it, select it,
  and persist immediately.
- **Rename tab:** normalize the name, resolve collisions with a numeric suffix,
  and persist immediately.
- **Delete inactive tab:** remove it and preserve the current active tab.
- **Delete active tab:** remove it, then activate the right neighbor when one
  exists or the left neighbor otherwise.

Deletion is available for any tab position while the table has at least two
tabs. When only one tab remains, deletion is disabled and rejected by the
controller even if called outside the UI.

## Re-entry and Unsaved Changes

Leaving a Planner screen discards which tabs were active. On entry to a Planner
screen, each visible table selects its first tab and loads that tab's saved
settings.

If the active tab has an unsaved draft, selecting another tab opens a
discard-confirmation dialog for that table. Navigating away when any visible
table is dirty opens one discard-confirmation dialog for the screen:

- **Cancel:** keep the current tab and draft; do not navigate.
- **Discard changes:** replace the draft with the destination tab's settings or
  discard every dirty draft on the departing screen and continue navigation.

The confirmation applies to in-app Planner navigation. Browser refresh and
window-close protection are outside this feature.

## UI

Each Planner table header has two rows:

1. the existing table title and table-local filter, sort, group, and create
   controls;
2. an ordered tab row directly below the title row.

The tab row renders:

- all tabs from left to right;
- a `•` after the active tab name when its draft is dirty;
- a `+` button after the final tab;
- an overflow menu for each tab.

Clicking `+` opens an anchored name input initialized to `새 보기` with the text
selected. Enter creates the tab, Escape cancels, and a collision automatically
uses the next numeric suffix.

The active tab's overflow menu provides:

- **Save current settings**, enabled only when the active tab is dirty;
- **Rename**;
- **Delete**, disabled when the table has only one tab.

An inactive tab's menu provides Rename and Delete without a save action. Rename
and Delete operate on the tab whose menu was opened. Deleting a tab requires
confirmation; when the active tab is dirty, that confirmation also states that
its unsaved changes will be discarded.

## Accessibility

- The tab container uses `tablist`; tab triggers use `tab` and expose
  `aria-selected`.
- Left and Right Arrow move focus between tabs. Enter and Space select the
  focused tab.
- The dirty indicator is included in the active tab's accessible name as
  "저장되지 않은 변경사항".
- The add input, overflow menu, and confirmation dialogs support Escape,
  predictable initial focus, and focus return to their trigger.
- Disabled save and delete actions expose their disabled state to assistive
  technology.

## Persistence Failures

Planner preference writes remain best-effort:

- a failed write does not discard the current session's tabs or draft;
- the next mutation retries persistence by writing the complete normalized
  `planner.v1` document;
- malformed persisted data is isolated to the affected table during the next
  load.

Existing Todo mutations, status policy, and audit events are unaffected.

## Verification

### Model tests

- Normalize valid per-table tab collections without cross-table leakage.
- Migrate legacy `tableSettings` into one `Table` tab per table.
- Recover missing, malformed, and empty collections with one valid tab.
- Normalize duplicate IDs and names deterministically.
- Enforce the one-tab minimum in controller-level mutations.

### Controller tests

- Create, rename, save, and delete tabs and persist the full document.
- Keep the active tab selected while its draft changes.
- Mark semantic draft differences dirty and clear the marker after saving.
- Activate the correct neighbor after deleting the active tab.
- Block tab switching and Planner navigation until dirty changes are discarded.
- Select the first tab after leaving and re-entering a Planner screen.
- Preserve complete isolation between all `PlannerTableId` values.

### Presentation tests

- Render the tab row below every Planner table title.
- Create a tab from the current draft through the `+` input.
- Expose the dirty `•`, overflow actions, disabled states, and confirmation
  dialogs.
- Cover keyboard tab navigation, Escape behavior, focus placement, focus
  return, and accessible names.
- Preserve existing table-local filter, sort, group, and contextual-create
  behavior.

## Out of Scope

- Dragging or otherwise reordering tabs
- Copying a tab to another Planner table
- A separate duplicate-tab menu action
- Tab-specific columns or table layout
- Persisting the last active tab
- Browser refresh or window-close warnings for unsaved drafts
