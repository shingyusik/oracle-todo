# Planner Weekday Labels

## Scope

- Show English weekday abbreviations (`Mon`–`Sun`) in weekly and monthly planner views.
- Keep the existing planner periods, item grouping, sorting, and navigation unchanged.

## Weekly View

- Prefix each day card title with its weekday abbreviation.
- Format: `Mon · 2026-07-06`.
- Preserve the full ISO date already shown by the card.

## Monthly View

- Add one weekday header row above the monthly calendar weeks.
- Render `Mon`, `Tue`, `Wed`, `Thu`, `Fri`, `Sat`, and `Sun` in the same seven-column layout as the day cards.
- Keep each day card title as its existing day-of-month number.
- Place the seven-label header in the calendar-day column with an empty goal-rail spacer, matching each monthly week row.

## Implementation

- Derive weekday labels from the existing local calendar dates without adding a dependency.
- Reuse the planner model's date data and the monthly calendar's existing seven-column grid.
- Add no new component abstraction unless the existing render structure requires one.

## Verification

- Model tests verify weekly day labels pair the correct weekday with each ISO date.
- Presentation tests verify the monthly header renders Monday through Sunday in order.
- Existing planner presentation tests remain green.
