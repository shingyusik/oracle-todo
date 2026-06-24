# Task 6 Report: Add Minimal Inline Editing

## What you implemented

- Added `patchWorkspaceItem` and `transitionWorkspaceItem` to the workbench controller model and hook.
- Added minimal inline table controls using native `input` and `select` elements.
- Wired inline status transitions to existing POST transition endpoints.
- Wired inline quick-field PATCH updates for the existing table flow without opening detail rows.
- Stopped click and key propagation from inline controls so row detail navigation does not fire while editing.

## Files changed

- `frontend/src/features/workbench/model/workbench-model.ts`
- `frontend/src/features/workbench/hooks/useWorkbenchController.ts`
- `frontend/src/features/workbench/ui/MainPanel.tsx`
- `frontend/src/styles/globals.css`
- `frontend/tests/presentation/use-workbench-controller.spec.tsx`
- `frontend/tests/presentation/workbench-wireframe.spec.tsx`

## TDD Evidence

### RED command/output

Command:

```bash
cd frontend
npm run test -- tests/presentation/use-workbench-controller.spec.tsx tests/presentation/workbench-wireframe.spec.tsx
```

Output:

```text
❯ tests/presentation/workbench-wireframe.spec.tsx (25 tests | 2 failed)
× WorkbenchPageClient > patches an inline due edit without opening details
  → Unable to find a label with the text of: Due for One
× WorkbenchPageClient > transitions inline status without opening details
  → Unable to find a label with the text of: Status for One
```

### GREEN command/output

Command:

```bash
cd frontend
npm run test -- tests/presentation/use-workbench-controller.spec.tsx tests/presentation/workbench-wireframe.spec.tsx
npm run typecheck
```

Output:

```text
✓ tests/presentation/workbench-wireframe.spec.tsx (25 tests)
✓ tests/presentation/use-workbench-controller.spec.tsx (12 tests)
Test Files  2 passed (2)
Tests  37 passed (37)

> todo-engine-frontend@0.1.0 typecheck
> tsc --noEmit
```

## Self-review findings

- Kept the change local to the existing workbench controller and table UI.
- Reused existing PATCH and transition endpoints; no new dependency or form layer added.
- Preserved archive behavior as trash-confirm only; archive is not part of the status select.
- Confirmed inline controls do not open detail rows while clicked or keyboard-used.

## Concerns if any

- Relation clearing to blank is not implemented as a special case; this stays minimal and follows the current optional PATCH shape.
