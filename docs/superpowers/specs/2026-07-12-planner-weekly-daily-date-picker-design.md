# Planner Weekly And Daily Date Picker Design

**Date:** 2026-07-12
**Status:** Awaiting user review
**Scope:** Add direct date selection and period navigation to Planner `Weekly` and `Daily` views.

## Goal

Make the active Weekly or Daily period directly selectable without affecting the selected period in other Planner tabs.

## Header Layout

Weekly and Daily place a period navigator immediately after the Planner view title:

```text
Weekly | < | Jul 6 - Jul 12 | > | Now | Filter | Sort | Group | Add
Daily  | < | Jul 12, 2026 | > | Now | Filter | Sort | Group | Add
```

- Previous and next buttons move one week in Weekly and one day in Daily.
- The central date button opens the date picker.
- `Now` is adjacent to the period navigator and resets only the active tab's period.
- Filter, sort, group, and creation controls retain their existing placement after the period controls.
- On narrow screens, the toolbar may wrap while retaining the navigator as one contiguous control group.

## Date Picker

The date button opens a single-month calendar popover using the existing goal period calendar visual language.

- The popover is anchored to the date button and provides previous/next month navigation.
- Selecting a cell updates the active Planner period and closes the popover.
- Clicking outside the popover or pressing Escape closes it without changing the period.
- Closing the popover returns keyboard focus to the date button.
- The picker uses controlled calendar cells; it does not provide free-form date parsing or introduce a date-picker dependency.

### Weekly Selection

- The selected week is the ISO Monday through Sunday range containing the stored `weeklyDate`.
- Hovering or keyboard-focusing any calendar date previews the ISO week that contains it.
- The preview highlights all seven dates in that week with the existing range styling.
- The selected week remains visibly highlighted when no preview is active.
- Selecting any date canonicalizes `weeklyDate` to that ISO Monday.

### Daily Selection

- The selected day is the stored `dailyDate`.
- Hovering or keyboard-focusing a calendar date previews only that one date.
- The selected day remains visibly highlighted when no preview is active.
- Selecting a date stores that exact local `YYYY-MM-DD` value.

## State And Data Flow

`PlannerControls` continues to own independent period values for each Planner tab:

| View | Stored value | Canonical value |
| --- | --- | --- |
| Yearly | `yearlyDate` | January 1 of the selected year |
| Monthly | `monthlyDate` | First day of the selected month |
| Weekly | `weeklyDate` | ISO Monday of the selected week |
| Daily | `dailyDate` | Selected local calendar day |

The workbench controller exposes one active-period selection action for the UI. It updates only the stored value belonging to the active Planner tab, then continues deriving `planner.date` and `planner.weekStart` for existing views and creation defaults.

No backend endpoint, database schema, or item mutation behavior changes.

## Daily Content Labels

Daily sections use the selected date as their reference:

| Section | Label |
| --- | --- |
| Scheduled on the selected date | Formatted selected date |
| Scheduled before the selected date | `Before <formatted date>` |
| Scheduled after the selected date | `After <formatted date>` |
| No scheduled date | `Unscheduled` |

The underlying classification remains scheduled date before, equal to, after, or absent relative to `dailyDate`.

## Accessibility

- Navigator controls have explicit labels for previous period, choose date, next period, and return to current period.
- The date trigger reports its expanded state and controls a dialog popover.
- Calendar cells expose the represented date; Weekly cells additionally describe the week range they select.
- Pointer hover and keyboard focus produce equivalent previews.
- Escape and outside-click dismissal do not commit a tentative choice.

## Error Handling

- Period selection is local UI state and cannot fail through a network request.
- Calendar cells produce valid local dates only.
- Dismissal leaves the stored Planner period unchanged.

## Verification

Presentation and domain tests cover:

1. Weekly date selection canonicalizes an arbitrary selected date to its ISO Monday.
2. Daily date selection retains the exact selected date.
3. Weekly and Daily selection do not change Yearly or Monthly periods, and vice versa.
4. Previous, next, and `Now` affect only the active Planner tab.
5. Weekly calendar hover and keyboard focus preview a full ISO week; Daily preview highlights one day.
6. Selecting a calendar date closes the popover and restores focus to the trigger after dismissal.
7. Daily labels and scheduled-date classification use the selected date.
8. Existing Planner creation defaults continue using the active Weekly or Daily period.

Verification commands:

```bash
cd frontend
npm run test
npm run typecheck
npm run build
```

## Non-Goals

- Direct date selection for Yearly or Monthly.
- Free-form date entry.
- Persisting selected Planner periods across browser sessions.
- New calendar or date-picker dependencies.
- Backend or schema changes.
