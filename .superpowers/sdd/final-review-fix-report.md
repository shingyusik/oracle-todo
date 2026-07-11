# Workspace Goal Period Popover Final Review Fix Report

## Scope

- `frontend/src/features/workbench/ui/MainPanel.tsx`
- `frontend/src/styles/globals.css`
- `frontend/tests/presentation/workbench-wireframe.spec.tsx`

## Implemented fixes

1. Moved the Goal period popover to a `document.body` portal and switched it to fixed viewport positioning derived from the trigger rect.
2. Added open-state resize/scroll reposition wiring, viewport margin clamping, max-height, and internal vertical scrolling.
3. Replaced the native year select with explicit year buttons so clicking the already displayed year still commits.
4. Restored focus to the trigger on `Escape` and after period commit, and moved focus into the popover on open.

## RED evidence

Focused spec command:

```bash
npm test -- tests/presentation/workbench-wireframe.spec.tsx -t "submits canonical yearly and monthly planner goal anchors from the creation dialog|uses a fixed viewport popover, repositions on scroll, and restores focus on escape|commits a same-year month goal to year exactly once and returns focus to the trigger"
```

Observed failing behaviors before the fix:

- `submits canonical yearly and monthly planner goal anchors from the creation dialog`
  - failed because the dialog still exposed `Goal year` as a native `select`, so the new button-based expectation could not find `button[name="2026"]`
- `uses a fixed viewport popover, repositions on scroll, and restores focus on escape`
  - failed because focus stayed on the trigger after opening instead of moving into the popover
- `commits a same-year month goal to year exactly once and returns focus to the trigger`
  - failed because the current year could not be reselected through the native control, so the expected single PATCH path was unreachable

## GREEN evidence

Focused spec rerun:

```bash
npm test -- tests/presentation/workbench-wireframe.spec.tsx -t "submits canonical yearly and monthly planner goal anchors from the creation dialog|uses a fixed viewport popover, repositions on scroll, and restores focus on escape|commits a same-year month goal to year exactly once and returns focus to the trigger"
```

Result:

- `3 passed | 75 skipped`

Full frontend suite:

```bash
npm test
```

Result:

- `6 passed`
- `150 passed (150)`

Production build:

```bash
npm run build
```

Result:

- `Compiled successfully`
- `Generating static pages (4/4)`

Typecheck:

```bash
npm run typecheck
```

Result:

- exited successfully with no diagnostics

## Notes

- The presentation coverage verifies fixed positioning, body-level portal rendering, scroll/resize listener wiring, focus handoff, and the single-PATCH same-year conversion path.
- Exact pixel geometry is not asserted in jsdom because the environment does not provide reliable physical layout; the test instead covers the clipping fix through fixed/body rendering and viewport-recalc wiring.
