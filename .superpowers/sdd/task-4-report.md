# Task 4 Report: Filter Builder UI

## Status

DONE

## Summary

- Replaced the old dailyFilters-based planner filter dropdown with a rule builder backed by `planner.filterRules` and `planner.filterMode`.
- Added field picking, rule rows, operator selection, native date/number/text inputs, and checkbox editors for select, multi-select, and relation fields.
- Applied advanced filter rules to Daily, Weekly, Monthly, and Yearly planner rendering through `filterPlannerItemsByRules`.
- Preserved Sort and Group controls unchanged.
- Kept cross-view behavior sane by ignoring empty rule values and option values that are not valid for the current planner view.

## Verification

- `cd frontend && npm run test -- tests/presentation/workbench-wireframe.spec.tsx -t "filter"`: PASS
- `cd frontend && npm run typecheck`: PASS
- `cd frontend && npm run test -- tests/presentation/workbench-wireframe.spec.tsx`: PASS

## Concerns

- None.

## Fix Evidence: Unsupported Rules Across Views

- Fixed unsupported planner rules so the filter dropdown only renders rules valid for the current planner view.
- Updated the active filter pill to count visible rules for the current view instead of raw stored rules.
- Added a regression test for creating a Daily Area rule, switching to Monthly, hiding the unsupported row/count, and adding a supported Tags rule.
- `cd frontend && npm run test -- tests/presentation/workbench-wireframe.spec.tsx -t "filter"`: PASS
- `cd frontend && npm run typecheck`: PASS
- `cd frontend && npm run test -- tests/presentation/workbench-wireframe.spec.tsx`: PASS
