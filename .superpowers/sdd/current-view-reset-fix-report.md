# Goal Period Current View Reset Fix Report

## Status

Completed the test-only stabilization for the Goal Period current view reset tests.

## Change

- Updated the `This year` reset test to derive the runtime current year and choose a navigation direction that leaves the scheduled year view before asserting the reset button is enabled.
- Updated the `This month` reset test to derive the runtime current month and choose a navigation direction that leaves the scheduled month view before asserting the reset button is enabled.
- Preserved assertions that reset changes only the visible picker view, leaves the dialog open, disables the reset control afterward, and makes no `PATCH` calls.
- Added a test helper for calculating the previous month.

## Scope

Only `frontend/tests/presentation/workbench-wireframe.spec.tsx` and this report were changed. No production behavior, API, service, database, dependency, or date-control code was modified.

## Verification

- `cd frontend && npx vitest run --no-file-parallelism tests/presentation/workbench-wireframe.spec.tsx -t "returns the month picker|returns the week calendar"` - passed: 2 tests.
- `npm --prefix frontend test` - passed: 159 tests across 6 files.
- `git diff --check` - passed.
