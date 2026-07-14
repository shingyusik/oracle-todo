# Planner Work Item Visibility and Monthly Overflow Design

**Date:** 2026-07-14
**Status:** Approved for implementation planning
**Scope:** Limit planner work lists to tasks and events, while preserving period Goal surfaces and exposing monthly calendar overflow in an anchored popover.

## Goal

Keep period Goals visually separate from actionable calendar work.

- Weekly, Daily, and Monthly work lists show only `task` and `event` items.
- Weekly and Monthly Goal surfaces remain visible.
- A Monthly calendar day exposes every hidden task and event through its overflow control.

## Planner Visibility

The planner model owns the work-item visibility invariant. It filters list and calendar collections before grouping, sorting, counting, or rendering.

| Planner surface | Visible item types |
| --- | --- |
| Weekly month and week Goal sections | `goal` |
| Weekly day cards | `task`, `event` |
| Daily current, overdue, and unscheduled sections | `task`, `event` |
| Monthly Goal carousel and week Goal rails | `goal` |
| Monthly calendar day cells | `task`, `event` |

The existing status rules remain unchanged. Completed tasks remain visible and reopenable; terminal events remain hidden. Filters, sorting, grouping, and task completion controls continue to operate on the resulting visible items.

`routine`, `area`, `project`, and other item types do not appear in these work lists. This rule affects display collections only; creation choices, API behavior, storage, and Goal hierarchy are unchanged.

## Monthly Day Cells

Each Monthly calendar day cell keeps the compact layout:

- Show up to two sorted task or event rows.
- Show `No items.` when the date has no visible work.
- Show a `+N more` button when additional visible items exist.
- Calculate `N` from hidden task and event items only.

The compact rows retain their existing item-detail and task-transition behavior.

## Monthly Overflow Popover

Selecting `+N more` opens a popover anchored near that date cell.

- The popover identifies the selected date in its accessible name or heading.
- It lists all visible task and event items for the date, including the two already shown in the cell.
- Items use the active Monthly filters and sort rules.
- Selecting an item opens the existing item detail view.
- Only one date popover is open at a time.
- Selecting the active `+N more` button closes its popover.
- Escape and an outside pointer press close the popover.
- Dismissal restores focus to the `+N more` trigger when the trigger remains mounted.
- The popover is rendered through a portal and positioned from the trigger bounds so calendar overflow does not clip it.

The popover is a detail expansion of the day cell, not a separate planner route or data request.

## Data Flow

1. The controller loads the existing planner item collections.
2. Planner rule filters run as they do for the active Monthly view.
3. The planner model keeps only visible `task` and `event` work items for each calendar date.
4. Monthly sorting determines both compact cell order and popover order.
5. The cell renders the first two items and derives the overflow count from the remainder.
6. The open date state selects which complete day list is rendered in the popover.

No API, Rust service, or SQLite schema change is required.

## Accessibility

- `+N more` is a button with `aria-haspopup="dialog"` and an expanded state.
- The popover uses `role="dialog"` and a date-specific accessible label.
- Escape closes the popover without opening an item.
- Outside dismissal returns keyboard focus to the trigger.
- Existing task completion checkboxes and item buttons retain their accessible names and behavior.

## Verification

Model tests cover:

- Weekly day cards exclude Goals and routines while retaining tasks and events.
- Daily sections exclude Goals and routines while retaining tasks and events.
- Monthly calendar days exclude Goals and routines while retaining tasks and events.
- Weekly and Monthly Goal collections remain unchanged.

Presentation tests cover:

- Monthly cells count only hidden tasks and events.
- Selecting `+N more` opens a date-specific popover containing the complete ordered list.
- Escape and outside pointer dismissal close the popover and restore trigger focus.
- Selecting an overflow item uses the existing detail flow.

The frontend test suite, type check, and production build remain green.

## Non-Goals

- Removing Weekly or Monthly Goal surfaces.
- Changing Yearly planner content.
- Changing planner item creation options.
- Adding a new backend endpoint for date-specific work.
- Changing planner status visibility or transition policy.
- Introducing a date-picker or popover dependency.
