# Workspace Table Views and Linked List Overflow Design

**Date:** 2026-07-29  
**Scope:** Reuse Planner-style filter, sort, group, and saved-tab behavior in
Workspace tables and detail-view linked-item lists, while limiting collapsed
linked lists to five visible items.

## Goal

Workspace data surfaces should offer the same view-management flow as Planner
tables without sharing settings across unrelated lists. Detail views should
remain compact even when an item has many direct children.

## User Experience

### Workspace tables

Each Workspace table renders the existing Planner-style controls:

- Filter
- Sort
- Group by
- Add item
- Saved view tabs

The controls, active-setting pills, tab menus, keyboard behavior, and dirty
state follow the current Planner interaction model. Areas, Projects, Goals,
Routines, Tasks, and Events each own independent view state.

Bulk selection is evaluated against the rows visible in the active view.
Select-all selects only rows that remain after the active tab's filter, sort,
and group settings are applied.

### Detail linked-item lists

Each nonempty linked-item type is an independent table-like surface. Its
filter, sort, group, and saved tabs do not affect another child type.
Settings are scoped by both parent type and child type. For example:

- Area → Tasks
- Area → Projects
- Project → Tasks

These are three independent view scopes. Items under different parent
instances of the same parent type reuse the same saved-view definitions, while
the rows and available relation values come from the currently open item.

Each linked-item type list shows at most five matching items when collapsed.
If more items remain, a `More (N)` action reveals every matching item and a
`Less` action restores the five-item limit. `N` is the number of currently
hidden items.

Changing the active tab or any filter, sort, or group setting collapses the
list again. The cap is applied after filter and sort processing and across the
whole child-type list, not separately to every subgroup. Group headings with
no visible rows are omitted from the collapsed result.

Linked-item navigation keeps the existing unsaved-detail confirmation flow.

## Architecture

### Shared table-view model

Extract the reusable parts of Planner table settings into a surface-neutral
table-view model:

- filter mode and ordered filter rules
- ordered sort rules
- group settings
- saved tabs and active tab
- dirty-state comparison and saved-view lifecycle

Planner-specific table identifiers and field restrictions remain Planner
configuration. Workspace surfaces provide their own stable scope identifiers,
field capabilities, defaults, and labels.

Stable Workspace scopes use these categories:

```text
workspace.<item-type>
detail.<parent-type>.<child-type>
```

The shared model must not import UI components or Workspace/Planner controller
implementations.

### Shared controls

Extract the current Planner table header controls and saved-tab strip into
reusable components driven by a table-view adapter. Planner supplies its
existing adapter; Workspace tables and linked-item lists supply Workspace
adapters.

The reusable components preserve the current Planner appearance,
accessibility labels, dismissal behavior, focus restoration, tab keyboard
navigation, and menu actions. Surface-specific copy may replace the word
`Planner` where it would be exposed to users or assistive technology.

### Workspace view derivation

For each Workspace surface:

1. Start with the raw rows belonging to the Workspace table or direct-child
   relationship.
2. Normalize the active saved view against the fields supported by that
   surface.
3. Apply valid filter rules.
4. Apply sort rules.
5. Build and order groups.
6. For linked-item lists only, apply the collapsed five-row presentation cap.
7. Render rows and derive selection or overflow counts from that result.

Filtering and sorting reuse the current Planner semantics where a field is
shared. Workspace-only item types expose only fields valid for those types.
Invalid persisted rules are ignored without invalidating other valid settings
in the same view.

## Persistence

Workspace view definitions are stored in a Workspace-specific preference
payload rather than the Planner preference payload. This prevents Workspace
changes from mutating existing Planner tabs or table settings.

The payload contains one independently normalized entry per stable Workspace
scope. Missing or malformed scope data falls back only that scope to its
default view. Existing Workspace column-visibility preferences remain intact.
Writes continue through the existing serialized preference-write mechanism.

The expanded/collapsed state is transient presentation state and is not
persisted.

## Empty and Error States

- A Workspace table with no matching rows shows its existing empty state,
  adjusted to describe the active view when filters are present.
- A linked-item type whose active view has no matching rows remains visible
  with an empty-view message so users can edit or remove the active filter.
- The entire Linked items section remains omitted only when the current item
  has no direct child relationships before view filtering.
- Preference loading or persistence failures use the existing controller error
  handling and must not block item loading or linked-item navigation.

## Testing

### Model tests

- Workspace scopes normalize independently.
- Filter, sort, and group processing follows the shared table-view pipeline.
- Parent-type/child-type linked scopes do not leak settings.
- Saved-view create, select, rename, save, delete, and dirty-state behavior
  matches Planner.
- Invalid persisted rules fall back locally without discarding valid scopes.

### Controller tests

- Workspace preferences load and save without changing Planner preferences.
- Workspace table selections track the active view's visible rows.
- Changing a linked-list tab or setting resets its expanded state.

### Presentation tests

- Every Workspace table exposes filter, sort, group, add, and saved-tab
  controls using the shared interaction pattern.
- Every linked-item type exposes independent controls and tabs.
- A linked list with six or more matching rows renders five rows, the correct
  `More (N)` count, all rows after expansion, and five rows after `Less`.
- Filtering changes the hidden count, grouping does not multiply the five-row
  cap, and empty collapsed groups are omitted.
- Linked-item navigation and unsaved-change confirmation remain unchanged.

## Non-Goals

- Changing backend item-query APIs or service-layer policy.
- Sharing saved views between Planner and Workspace.
- Persisting whether a linked list is expanded.
- Adding new filter operators beyond those needed to support existing
  Workspace item fields.
- Changing the direct-child relationship rules.
