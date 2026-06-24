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

---

## Focus trap fix

### Fix implemented

- Moved creation-dialog initial focus from `Cancel` to the `Title` input.
- Reworked the creation-dialog Tab trap so it walks the form's actual focusable controls and wraps only at the ends.
- Kept `Escape` closing the dialog.

### Files changed

- `frontend/src/features/workbench/ui/MainPanel.tsx`
- `frontend/tests/presentation/workbench-wireframe.spec.tsx`

### TDD Evidence for the fix

**RED**

Command:

```bash
cd frontend
npm run test -- tests/presentation/workbench-wireframe.spec.tsx -t "focuses and traps the creation dialog through every control, and closes it on escape"
```

Output:

```text
Expected element with focus:
  <input ... />
Received element with focus:
  <button type="button">Cancel</button>
```

**GREEN**

Command:

```bash
cd frontend
npm run test -- tests/presentation/use-workbench-controller.spec.tsx tests/presentation/workbench-wireframe.spec.tsx
npm run typecheck
```

Output:

```text
✓ tests/presentation/workbench-wireframe.spec.tsx (18 tests)
✓ tests/presentation/use-workbench-controller.spec.tsx (8 tests)
> tsc --noEmit
```

### Self-review

- The trap now follows actual form order instead of a hard-coded button pair, so Title/Scheduled/Horizon stay reachable by keyboard.
- The fix stays local to the dialog and does not add a new abstraction or dependency.
- The test exercises open, forward tabbing, wraparound, and Escape close in one focused path.

---

## Goal horizon and scheduled-date fix

### Fix implemented

- Removed the unsupported `quarter` option from the goal creation horizon select.
- Stopped inventing a fallback scheduled date for goals in the controller; the form now passes through the user-provided scheduled value.
- Marked the goal Scheduled field as required so the native date input blocks empty goal submissions.

### Files changed

- `frontend/src/features/workbench/hooks/useWorkbenchController.ts`
- `frontend/src/features/workbench/ui/MainPanel.tsx`
- `frontend/tests/presentation/use-workbench-controller.spec.tsx`
- `frontend/tests/presentation/workbench-wireframe.spec.tsx`

### TDD Evidence for the fix

**RED**

Command:

```bash
cd frontend
npm run test -- tests/presentation/use-workbench-controller.spec.tsx tests/presentation/workbench-wireframe.spec.tsx
```

Output:

```text
FAIL  tests/presentation/workbench-wireframe.spec.tsx > WorkbenchPageClient > shows only supported goal horizons and requires a scheduled date
Expected element not to have text content: quarter

FAIL  tests/presentation/use-workbench-controller.spec.tsx > useWorkbenchController > does not invent a fallback scheduled date for goals
Expected body to omit generated scheduled fallback
Received body:
{"title":"New goal","horizon":"year","scheduled":"2026-06-01","actor":"user"}
```

**GREEN**

Command:

```bash
cd frontend
npm run test -- tests/presentation/use-workbench-controller.spec.tsx tests/presentation/workbench-wireframe.spec.tsx
npm run typecheck
```

Output:

```text
✓ tests/presentation/workbench-wireframe.spec.tsx (19 tests)
✓ tests/presentation/use-workbench-controller.spec.tsx (9 tests)

> tsc --noEmit
```

### Self-review

- The fix is narrowly scoped to the goal creation path and leaves event scheduling untouched.
- The controller now sends the user-entered scheduled date verbatim instead of manufacturing a period start.
- The UI test covers both the supported horizon list and the required scheduled field, so the regression stays pinned down.

---

## Event scheduled required fix

### Fix implemented

- Removed the event creation fallback that invented today's date when `scheduled` was blank.
- Marked the event `Scheduled` field as required in the native date input.
- Added focused regression tests for the event controller payload and event creation dialog requirement.

### Files changed

- `frontend/src/features/workbench/hooks/useWorkbenchController.ts`
- `frontend/src/features/workbench/ui/MainPanel.tsx`
- `frontend/tests/presentation/use-workbench-controller.spec.tsx`
- `frontend/tests/presentation/workbench-wireframe.spec.tsx`

### TDD Evidence for the fix

**RED**

Command:

```bash
cd frontend
npm run test -- tests/presentation/use-workbench-controller.spec.tsx tests/presentation/workbench-wireframe.spec.tsx
```

Output:

```text
FAIL  tests/presentation/use-workbench-controller.spec.tsx > useWorkbenchController > posts the user-provided scheduled value for events
expected "spy" to be called with arguments: [ '/todo-engine/events/propose', …(1) ]
Received body: {"title":"New event","scheduled":"2026-06-24","actor":"user"}

FAIL  tests/presentation/workbench-wireframe.spec.tsx > WorkbenchPageClient > requires scheduled for event creation
Received element is not required:
  <input type="date" value="" />
```

**GREEN**

Command:

```bash
cd frontend
npm run test -- tests/presentation/use-workbench-controller.spec.tsx tests/presentation/workbench-wireframe.spec.tsx
npm run typecheck
```

Output:

```text
✓ tests/presentation/workbench-wireframe.spec.tsx (20 tests)
✓ tests/presentation/use-workbench-controller.spec.tsx (10 tests)
> tsc --noEmit
```

### Self-review

- The fix is minimal and keeps event creation aligned with the API contract.
- The UI now blocks empty scheduled dates before submit instead of relying on controller fallback.
- The regression tests pin both the payload and the required attribute, so this specific bug should stay closed.
