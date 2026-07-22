# Workspace Linked Items Design

## Goal

Each Workspace detail panel exposes its direct child relationships as typed lists. Users can open a linked item directly while preserving the existing parent-relation selectors.

## Scope

- Keep existing selectors for parent relationships such as an item's Area, Project, Routine, or Goal parent.
- Render only direct child relationships.
- Group child items by item type and hide empty groups.
- Open a selected child in the existing Workspace detail panel.
- Require confirmation before discarding unsaved detail-form edits to navigate to a linked item.

## Relationship Rules

| Current item | Direct child predicate | Child types |
| --- | --- | --- |
| Area | `child.area_id === area.id` | Project, Routine, Task, Event |
| Project | `child.project_id === project.id` | Routine, Task, Event |
| Routine | `child.routine_id === routine.id` | Task |
| Goal | `child.parent_id === goal.id` | Goal, Task |
| Task or Event | none | none |

The lists do not traverse multiple relationship levels. For example, an Area lists its directly assigned Tasks but not Tasks reached through one of its Projects.

## Data and Components

- Preserve the existing all-item response in `workspaceItems.allItems` and derive linked items from that collection.
- Keep `workspaceItems.items` limited to the active table or planner view.
- Add a pure relation helper that filters direct children and groups them by item type.
- Render a `Linked items` section in the existing detail view below the editable fields.
- Each nonempty type group displays its localized type name and item count.
- A linked-item row uses the existing detail-opening controller action; no new backend route or persistence behavior is required.

## Navigation Safety

- A clean form opens the selected linked item's detail immediately.
- A dirty form opens a confirmation dialog before navigation.
- Confirming navigation discards the local draft and opens the selected linked item.
- Cancelling preserves the current draft and detail panel.

## Empty and Error Behavior

- Omit the entire `Linked items` section when no direct child items exist.
- Child-list calculation is local and cannot introduce a network loading or error state.
- Existing detail loading, save, and transition errors keep their current behavior.

## Tests

- Relation helper tests cover each parent type, direct-only filtering, and type grouping.
- Detail-view tests cover nonempty groups, omitted empty sections, and linked-item navigation.
- Navigation tests cover immediate clean-form navigation plus dirty-form confirmation and cancellation.
