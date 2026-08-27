# Weekly Group Spacing

## Goal

Keep the vertical distance above and below each group heading consistent in Weekly day cards.

## Design

- Preserve the existing `7px` gap between a group heading and its items.
- Add the same `7px` gap before every group after the first group in a day card.
- Scope the rule to direct group containers inside `.weekly-day-grid .planner-card` so nested item lists and other planner views are unchanged.

## Verification

- Add a CSS boundary check for the scoped sibling rule and its `7px` margin.
- Run the focused architecture test and frontend typecheck.
