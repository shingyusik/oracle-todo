# Task 1 + 2 Report: Workspace Goal Period Popover

## Scope
- Branch: `codex/workspace-goal-period-popover`
- Worktree: `/Users/shinggyusik/Desktop/01_Project/oracle-todo/.worktrees/workspace-goal-period-popover`
- Code files changed:
  - `frontend/tests/presentation/workbench-wireframe.spec.tsx`
  - `frontend/src/features/workbench/ui/MainPanel.tsx`

## RED
Updated the presentation spec first to define the closed trigger + transient popover contract, then ran:

```bash
cd frontend
npm test -- workbench-wireframe.spec.tsx
```

Observed failure summary:
- `submits canonical yearly and monthly planner goal anchors from the creation dialog`
- `focuses and traps the creation dialog through every control, and closes it on escape`
- `creates workspace goals through one period control`
- `shows the same goal fields in the table and detail`
- `patches a goal period through the inline calendar with an ISO week anchor`

Representative RED evidence:
- `Unable to find an accessible element with the role "button" and name "Period"`
- `Unable to find role="button" and name "Period for Goal"`

## GREEN
Implemented the shared `GoalPeriodControl` popover in `MainPanel.tsx` and removed `commitOnChange` plus its existing call sites.

Focused verification:

```bash
cd frontend
npm test -- workbench-wireframe.spec.tsx
```

Result:
- `tests/presentation/workbench-wireframe.spec.tsx` passed
- `76 passed`

Full frontend verification:

```bash
cd frontend
npm test
```

Result:
- `6` test files passed
- `148 passed`

## Functional Notes
- Closed state now renders a trigger button with `aria-haspopup="dialog"` and `aria-expanded`.
- Period type changes are local until the user selects a year or calendar date.
- Escape and outside dismissal close without commit.
- Value selection commits exactly once through existing consumers:
  - table inline control PATCHes immediately after selection
  - detail and creation update local drafts only
- Canonical scheduling remains:
  - year -> `YYYY-01-01`
  - month -> month start
  - week -> ISO Monday
- Planner Goal creation remains functional through the shared control.

## Self-review
- Kept horizon choices fixed at `year`, `month`, `week`.
- Did not touch CSS, API, schema, Rust, or dependency surface.
- Preserved existing row-event boundaries and calendar selection behavior.
- Preserved the year-to-calendar creation affordance by showing the current month/week view when switching from a yearly anchor before commit.

## Commit
- SHA: `7007310`
- Message: `[UPDATE] implement workspace goal period popover`
