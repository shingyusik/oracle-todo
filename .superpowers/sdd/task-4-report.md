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
