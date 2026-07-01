## Task 4 Report

- Task: Render Detail Fields from the Same Visible Set
- Scope owned:
  - `frontend/src/features/workbench/ui/MainPanel.tsx`
  - `frontend/tests/presentation/workbench-wireframe.spec.tsx`

## TDD Log

### RED

1. Added failing presentation tests:
   - `shows the same task fields in the table and detail while editing long fields only in detail`
   - `shows the same goal fields in the table and detail`
2. Ran:

```bash
cd frontend && npm test -- workbench-wireframe.spec.tsx
```

3. Observed expected failures before implementation:
   - task detail could not find `Description`
   - goal detail was missing the matching visible detail fields

### GREEN

Implemented the minimal `MainPanel` changes to:

- extend detail draft/patch coverage for `description`, goal fields, and event metadata fields
- render task detail fields from the same visible set as the task table
- render goal detail fields from the same visible set as the goal table
- move `Note` into the type-specific detail field block
- show `Created` and `Updated` inside detail properties

Re-ran:

```bash
cd frontend && npm test -- workbench-wireframe.spec.tsx
```

Result: PASS (`34 passed`)

## Verification

Ran full verification from the brief:

```bash
cargo test
cd frontend && npm test
cd frontend && npm run typecheck
```

Results:

- `cargo test` PASS
- `cd frontend && npm test` PASS (`67 passed`)
- `cd frontend && npm run typecheck` PASS

## Notes

- Kept the change inside existing `MainPanel` patterns.
- Did not introduce a new field engine or split files.
- No schema changes, no SQLite writes, no custom item types.

## Review Fix Follow-up

- Added routine detail `Last Materialized` as a readonly property row so the detail view matches the table-visible routine fields.
- Reordered project, task, and event detail fields to follow the existing table column order.
- Limited event `participants` PATCH writes to actual comma-separated draft changes so unrelated event saves do not rewrite participants metadata.
- Added focused presentation coverage for:
  - routine detail readonly `Last Materialized`
  - task detail field ordering (`Scheduled` -> `Due` -> `Priority` -> `Description`)
  - event detail save omitting unchanged `participants`

### Focused Re-Verification

Ran after the review fixes:

```bash
cd frontend && npm test -- workbench-wireframe.spec.tsx
cd frontend && npm run typecheck
```

Results:

- `cd frontend && npm test -- workbench-wireframe.spec.tsx` PASS (`36 passed`)
- `cd frontend && npm run typecheck` PASS
