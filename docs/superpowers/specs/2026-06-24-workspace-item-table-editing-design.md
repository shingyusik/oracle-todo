# Workspace Item Table Editing Design

**Date:** 2026-06-24
**Status:** Draft for review
**Scope:** Add planning detail for editing todo-engine items from the frontend workbench. This design covers item rows, table editing, archive behavior, and row detail views. It does not add custom SQLite tables, custom item types, or schema editing.

## Goal

`ToDo > Workspace` becomes the primary place to inspect and edit todo-engine items. Each workspace tab presents one item type as a table:

- `Areas`
- `Projects`
- `Tasks`
- `Routines`
- `Events`
- `Goals`

The tables operate on existing todo-engine records. Adding a row creates a new item of the current tab type. Removing rows archives selected items through the service layer.

## Table View

Each table has a compact toolbar in the upper right:

```text
[+] [trash]
```

- `+` opens a small creation dialog for the current item type.
- `trash` is disabled until one or more rows are selected.
- `trash` archives selected rows after confirmation.

Each row starts with a checkbox:

```text
[ ] Title        Status      Area      Due      Updated
[x] ...
```

- Row checkbox selects or deselects that row.
- Header checkbox selects or deselects all visible rows.
- Clicking a row outside the checkbox opens the row detail view.
- Checkbox clicks do not open the detail view.

## Archive Flow

Deletion is represented as archive, not hard delete.

1. User selects one or more rows.
2. Trash icon becomes active.
3. User clicks trash.
4. Confirmation dialog appears.
5. Confirm archives selected items.
6. Cancel leaves items unchanged.

Dialog copy:

```text
Archive selected items?

3 items will be moved to archive. You can still find them in Archive.

[Cancel] [Archive]
```

## Row Creation

The `+` button opens a small creation dialog for the active table.

- The dialog collects the smallest required set of fields for the item type.
- Creating succeeds through the same todo-engine service/API paths as CLI mutations.
- After creation, the app opens the new row in detail view so optional properties and note can be completed.

## Inline Editing

The table allows quick edits only for frequently changed properties:

- `status`
- `due`
- `scheduled`
- `priority`
- `area`
- `project`

Long text fields stay out of inline table editing:

- `note`
- `description`
- `definition_of_done`
- `standard`

System fields are read-only:

- `id`
- `created_at`
- `updated_at`
- `approved_at`
- `last_materialized_at`
- `occurrence_key`
- `metadata`
- `second_brain_refs`

## Default Columns

| Table | Columns |
| --- | --- |
| `Areas` | `Title`, `Status`, `Review Cycle`, `Standard`, `Updated` |
| `Projects` | `Title`, `Status`, `Area`, `Due`, `Definition of Done`, `Updated` |
| `Tasks` | `Title`, `Status`, `Area`, `Project`, `Scheduled`, `Due`, `Priority`, `Updated` |
| `Routines` | `Title`, `Status`, `Area`, `Recurrence Rule`, `Materialization Policy`, `Updated` |
| `Events` | `Title`, `Status`, `Area`, `Starts At`, `Location`, `With`, `Updated` |
| `Goals` | `Title`, `Status`, `Horizon`, `Area`, `Due`, `Parent`, `Updated` |

`note` is not a default table column. It belongs in the detail view where it can be edited without crowding the table.

## Detail View

Clicking a row opens a full-row view in the main panel. The side navigation remains in place.

```text
< Back

Title

Properties
Status
Area
Project
Due
Scheduled
Priority

Note
[large textarea]
```

- `Back` returns to the previous table view.
- Properties appear at the top and are scoped to the item type.
- `Note` appears below properties as a large textarea.
- Saving note edits is explicit through a save action.

## Boundaries

- No direct SQLite writes from the frontend.
- No hard delete.
- No schema or column definition editing.
- No custom item type creation.
- No Notion-style block editor in the first version.
