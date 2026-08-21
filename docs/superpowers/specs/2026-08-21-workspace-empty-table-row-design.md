# Workspace Empty Table Row Design

## Goal

Render workspace empty-state messages across the full table row instead of constraining them to the first column.

## Design

- Add an explicit `columnCount` input to the shared `WorkspaceGroupedRows` component.
- Apply `columnCount` as the empty cell's native `colSpan`.
- Pass `columns.length + 1` from workspace tables because they include the selection column.
- Pass `1` from linked-item tables.
- Keep the existing message copy, left alignment, table semantics, grouping behavior, and noninteractive empty row.
- Leave dedicated Ledger and Health tables unchanged because they already provide correct `colSpan` values.

## Verification

- A shared-component test proves empty rows receive the requested `colSpan` and grouped rows retain their heading span.
- Workbench presentation coverage proves Projects and other workspace tables render full-width empty rows.
- Linked-item coverage proves its single-column empty row remains valid.
- Frontend tests, type checking, production build, and diff checks pass.

## Non-Goals

- Changing empty-state wording or alignment
- Moving empty messages outside their tables
- Changing dedicated Ledger or Health table components
- Inferring column counts from the DOM or CSS
