# Task 3 Report: Add Row Selection and Archive Confirmation

## What you implemented

- Added workspace row selection state to the workbench controller with per-row toggles, select-all-visible support, and selection reset on workspace leaf-tab changes.
- Added archive confirmation flow with `requestArchiveSelected`, `cancelArchiveSelected`, and `confirmArchiveSelected`.
- Wired archive requests to `POST /todo-engine/items/:id/archive` with a small JSON reason payload.
- Updated the workspace table UI to render header/row checkboxes, an icon-based toolbar with accessible `Add item` and `Archive selected items` buttons, and a confirmation dialog.
- Added controller and UI tests that cover the archive flow end to end.

## Files changed

- `frontend/src/features/workbench/model/workbench-model.ts`
- `frontend/src/features/workbench/hooks/useWorkbenchController.ts`
- `frontend/src/features/workbench/ui/WorkbenchWireframe.tsx`
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
> todo-engine-frontend@0.1.0 test
> vitest run --no-file-parallelism tests/presentation/use-workbench-controller.spec.tsx tests/presentation/workbench-wireframe.spec.tsx

RUN  v3.2.6 /Users/singyusig/Desktop/02_Coding/oracle-todo/frontend

× WorkbenchPageClient > enables trash only for selected rows and confirms archive
  → Unable to find role="button" and name "Archive selected items"

Test Files  2 failed (2)
Tests  2 failed | 19 passed (21)
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
> todo-engine-frontend@0.1.0 test
> vitest run --no-file-parallelism tests/presentation/use-workbench-controller.spec.tsx tests/presentation/workbench-wireframe.spec.tsx

✓ tests/presentation/workbench-wireframe.spec.tsx (14 tests)
✓ tests/presentation/use-workbench-controller.spec.tsx (7 tests)

Test Files  2 passed (2)
Tests  21 passed (21)

> todo-engine-frontend@0.1.0 typecheck
> tsc --noEmit
```

## Self-review findings

- Selection state is scoped to the current workspace table and clears when the visible workspace tab changes, preventing stale cross-tab selection.
- Archive removal updates local table state immediately after successful POST responses and closes the confirmation dialog.
- Toolbar icons use `lucide-react` while accessible names remain on the buttons.
- No row-level trash action was added.

## Concerns if any

- No inline error UI exists yet for partial or failed archive requests; current behavior leaves error handling to the thrown promise path.
