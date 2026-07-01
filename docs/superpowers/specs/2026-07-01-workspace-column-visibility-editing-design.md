# Workspace Column Visibility and Editing Design

**Date:** 2026-07-01
**Status:** Approved for implementation planning
**Scope:** Define which SQLite `items` columns appear in each ToDo workspace table and detail view, and where each visible column can be edited.

## Goal

The ToDo workspace uses the real `items` table shape as its source for column decisions.

For each workspace item type:

- The table view and detail view show the same visible column set.
- Editing capability is column-specific.
- Long-form fields appear in the table as read-only summaries and are edited only in detail.
- System and integration fields stay hidden unless they support ordinary item review.

## Editing Modes

| Mode | Meaning |
| --- | --- |
| `inline` | Editable in the table and in detail. |
| `detail` | Visible in the table and detail; editable only in detail. |
| `readonly` | Visible in the table and detail; never edited by the workspace UI. |
| `hidden` | Hidden from both table and detail. |

## Hidden Columns

These columns are not part of the default workspace table or detail view:

| Column | Reason |
| --- | --- |
| `id` | Internal stable identifier. |
| `type` | Already implied by the selected workspace tab. |
| `occurrence_key` | Routine materialization internals. |
| `second_brain_refs` | Read-only integration input, not workspace editing content. |
| raw `metadata` | JSON storage shape; supported metadata keys are exposed as named fields. |

## Common Readonly Columns

These columns can appear when included in a type-specific visible set:

| Column | Mode |
| --- | --- |
| `created_at` | `readonly` |
| `updated_at` | `readonly` |
| `proposed_by` | `readonly` |
| `approved_by` | `readonly` |
| `approved_at` | `readonly` |
| `completed_at` | `readonly` |
| `archived_at` | `readonly` |
| `last_materialized_at` | `readonly` |

## Type Columns

### Areas

| Column | Mode |
| --- | --- |
| `title` | `inline` |
| `status` | `inline` |
| `review_cycle` | `inline` |
| `standard` | `detail` |
| `note` | `detail` |
| `created_at` | `readonly` |
| `updated_at` | `readonly` |

### Projects

| Column | Mode |
| --- | --- |
| `title` | `inline` |
| `status` | `inline` |
| `area_id` | `inline` |
| `due` | `inline` |
| `outcome` | `detail` |
| `definition_of_done` | `detail` |
| `note` | `detail` |
| `created_at` | `readonly` |
| `updated_at` | `readonly` |

### Tasks

| Column | Mode |
| --- | --- |
| `title` | `inline` |
| `status` | `inline` |
| `area_id` | `inline` |
| `project_id` | `inline` |
| `routine_id` | `inline` |
| `scheduled` | `inline` |
| `due` | `inline` |
| `priority` | `inline` |
| `description` | `detail` |
| `note` | `detail` |
| `created_at` | `readonly` |
| `updated_at` | `readonly` |

### Routines

| Column | Mode |
| --- | --- |
| `title` | `inline` |
| `status` | `inline` |
| `area_id` | `inline` |
| `recurrence_rule` | `detail` |
| `materialization_policy` | `inline` |
| `note` | `detail` |
| `last_materialized_at` | `readonly` |
| `created_at` | `readonly` |
| `updated_at` | `readonly` |

### Events

| Column | Mode |
| --- | --- |
| `title` | `inline` |
| `status` | `inline` |
| `area_id` | `inline` |
| `project_id` | `inline` |
| `scheduled` | `inline` |
| `due` | `inline` |
| `priority` | `inline` |
| `description` | `detail` |
| `note` | `detail` |
| `metadata.location` | `inline` |
| `metadata.participants` | `detail` |
| `metadata.commitment_type` | `inline` |
| `created_at` | `readonly` |
| `updated_at` | `readonly` |

### Goals

| Column | Mode |
| --- | --- |
| `title` | `inline` |
| `status` | `inline` |
| `horizon` | `inline` |
| `scheduled` | `inline` |
| `due` | `inline` |
| `parent_id` | `inline` |
| `note` | `detail` |
| `created_at` | `readonly` |
| `updated_at` | `readonly` |

## Detail View Behavior

The detail view renders the same ordered fields as the active table.

- `inline` fields use editable controls in both table and detail.
- `detail` fields render read-only summaries in the table and editable controls in detail.
- `readonly` fields render formatted values in both table and detail.
- Empty values render as `-` in read-only table cells.

## Boundaries

- No schema changes.
- No direct SQLite writes from the frontend.
- No hard delete.
- No custom item types.
- No raw JSON editor for `metadata` or `second_brain_refs`.
