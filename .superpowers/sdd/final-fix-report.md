# Final Fix Report

## Scope

Closed the final whole-branch review blockers for workspace column visibility/editing with minimal changes in the existing service update path and workbench detail UI.

## Fix Details

### Backend

- Revalidated goal policy in `TodoService::update_item` whenever a goal patch changes any of `parent_id`, `horizon`, or `scheduled`.
- Built policy checks from candidate post-patch values before mutating the item, so duplicate and nesting validation now see the requested parent.
- Kept the mutation on the existing `TodoService` + audit event path.
- Added API regression coverage that rejects an invalid goal `parent_id` PATCH which would create a duplicate `(horizon, scheduled, parent_id)` goal identity.

### Frontend

- Made detail `Status` editable by reusing the existing `StatusSelect` transition control.
- Removed the hidden-by-design `Type` field from detail.
- Made detail relation fields editable wherever the table already offered inline relation selects:
  - project/routine `Area`
  - task `Area`, `Project`, `Routine`
  - event `Area`, `Project`
  - goal `Parent`
- Kept long-form/detail-save behavior intact for text fields; relation/status changes use the existing immediate update paths.

### Presentation Coverage

- Added a focused workbench presentation test asserting:
  - detail status is editable,
  - detail hides `Type`,
  - detail exposes an editable relation select.

## TDD Evidence

### RED

- `cargo test -p todo-engine --test e2e api_patch_rejects_invalid_goal_parent`
  - failed with `left: 200 right: 400`
- `cd frontend && npm test -- workbench-wireframe.spec.tsx`
  - failed because detail view had no editable `Status for One` control

### GREEN

- `cargo test -p todo-engine --test e2e api_patch_rejects_invalid_goal_parent`
  - passed
- `cd frontend && npm test -- workbench-wireframe.spec.tsx`
  - passed

## Final Verification

- `cargo test -p todo-engine --test e2e api_patch_`
  - passed (`5 passed`)
- `cd frontend && npm test -- workbench-wireframe.spec.tsx`
  - passed (`37 passed`)
- `cd frontend && npm run typecheck`
  - passed
