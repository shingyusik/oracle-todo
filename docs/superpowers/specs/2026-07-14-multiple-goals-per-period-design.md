# Multiple Goals per Period Design

**Date:** 2026-07-14

**Scope:** Allow multiple Goals to share the same period and Parent while keeping Goal creation failures inside the creation dialog.

## Goal

Treat each Goal as an independently identified planning item. A year, month, or week may contain any number of sibling Goals, including Goals with the same Parent.

Examples of valid sibling Goals for `(year, 2026-01-01, <root>)`:

- Health
- Career
- Finance

## Policy

- Goal identity is the engine-generated `id`.
- `(horizon, scheduled, parent_id)` is a grouping key, not a uniqueness key.
- Goal creation accepts an existing sibling with the same period and Parent.
- Goal updates may move an item into a period and Parent already used by another Goal.
- Canonical period anchors remain mandatory: Jan 1 for `year`, the first day for `month`, and ISO Monday for `week`.
- A child Goal still requires a strictly coarser Parent horizon.
- Status policy, approval gates, audit events, and terminal-state behavior remain unchanged.

## Engine Changes

The service layer does not perform sibling-period duplicate checks during Goal creation or update.

The obsolete duplicate-period error contract is not part of the target API:

- `TodoError::GoalDuplicatePeriod`
- `goal_duplicate_period`
- duplicate-period API metadata and status mapping

No schema migration is required because SQLite does not enforce a unique constraint for the period grouping fields.

## Frontend Error Handling

All JSON mutation requests parse the structured API error body through the existing `TodoEngineApiError` path.

The creation dialog owns a submission error state:

1. Submit the form and keep the dialog open while the request is pending.
2. On success, add the created item, open its detail view, and close the dialog.
3. On a known API error, keep the entered values and show an inline message in the dialog.
4. On an unknown failure, show a generic creation failure message in the dialog.
5. Clear the message before a retry and when the dialog closes.

The UI has no `goal_duplicate_period` message because the engine cannot emit that error. Existing feedback for invalid anchors and invalid Parent horizons remains available where those policies apply.

## Tests

### Rust service and API

- Creating two root Goals with the same horizon and scheduled anchor succeeds and produces distinct IDs.
- Creating two sibling Goals under the same Parent and period succeeds.
- Updating a Goal into another Goal's period and Parent succeeds.
- Each successful mutation still writes its own audit event.
- Canonical-anchor and Parent-horizon rejection tests remain green.

### Frontend

- Workspace Goal creation submits and renders another Goal for an occupied period.
- A structured 400 response does not escape to the Next.js runtime error overlay.
- The creation dialog remains open, preserves the form, and displays the failure message.
- Retrying after a failed submission can succeed.

## Documentation

Current reference documentation describes a Goal period as a grouping dimension and does not claim uniqueness for `(horizon, scheduled, parent_id)`. Historical planning artifacts remain unchanged unless they are used as current reference material.

## Non-Goals

- Deduplicating Goals by title.
- Adding Goal categories, slots, or new identity columns.
- Changing Goal nesting, period canonicalization, lifecycle, approval, or audit policy.
- Automatically parenting newly created Goals.
