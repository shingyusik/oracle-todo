# Task 4 Report

## What you implemented

- Added `creationDialogOpen`, `detailItem`, `openCreationDialog()`, `closeCreationDialog()`, `createWorkspaceItem()`, and `closeDetailView()` to the workbench controller model and hook.
- Added create routing for workspace tables to the existing todo-engine endpoints:
  - `/todo-engine/areas`
  - `/todo-engine/projects/propose`
  - `/todo-engine/tasks/propose`
  - `/todo-engine/routines/propose`
  - `/todo-engine/events/propose`
  - `/todo-engine/goals/propose`
- Reused the Task 3 dialog interaction pattern for the creation dialog:
  - initial focus on open
  - Escape closes
  - tab loop stays inside the dialog
- Kept the Task 4 detail view minimal: after successful create, the newly created item opens in a simple detail state that renders its heading and a close action.
- Changed the main panel so the toolbar still renders when a workspace table is empty, allowing row creation from empty states.

## Files changed

- `frontend/src/features/workbench/model/workbench-model.ts`
- `frontend/src/features/workbench/hooks/useWorkbenchController.ts`
- `frontend/src/features/workbench/ui/MainPanel.tsx`
- `frontend/src/styles/globals.css`
- `frontend/tests/presentation/use-workbench-controller.spec.tsx`
- `frontend/tests/presentation/workbench-wireframe.spec.tsx`

## TDD Evidence

### RED

Command:

```bash
cd frontend
npm run test -- tests/presentation/use-workbench-controller.spec.tsx tests/presentation/workbench-wireframe.spec.tsx
```

Output:

```text
FAIL  tests/presentation/use-workbench-controller.spec.tsx > creates a task from the active workspace table and opens it
TypeError: result.current.openCreationDialog is not a function

FAIL  tests/presentation/workbench-wireframe.spec.tsx > opens a creation dialog and creates a row
TestingLibraryElementError: Unable to find an accessible element with the role "button" and name "Add item"
```

### GREEN

Command:

```bash
cd frontend
npm run test -- tests/presentation/use-workbench-controller.spec.tsx tests/presentation/workbench-wireframe.spec.tsx
npm run typecheck
```

Output:

```text
✓ tests/presentation/workbench-wireframe.spec.tsx (17 tests)
✓ tests/presentation/use-workbench-controller.spec.tsx (8 tests)

Test Files  2 passed (2)
Tests  25 passed (25)

> tsc --noEmit
```

## Self-review findings

- The create flow is intentionally minimal and scoped to Task 4.
- Detail mode only renders the created item heading plus a close action, which satisfies the task without pre-building Task 5 UI.
- Dialog behavior reuses the existing archive-dialog accessibility pattern instead of introducing a new abstraction or dependency.

## Concerns if any

- Create failures currently bubble as thrown promise errors without dedicated inline error UI; that appears acceptable for Task 4 but will likely want follow-up polish when Task 5 expands the detail flow.
