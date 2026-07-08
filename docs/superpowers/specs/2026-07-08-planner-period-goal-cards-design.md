# Planner Period Goal Cards Design

**Date:** 2026-07-08
**Status:** Draft for implementation planning
**Scope:** Enrich the existing Planner `Yearly` and `Monthly` views with period navigation cards and lower-period goal cards. Reuse current todo-engine goal APIs and frontend planner state.

## Goal

Make high-level planning useful at a glance:

- `Yearly` shows the selected year goal and all month goals inside that year.
- `Monthly` shows the selected month goal and all week goals inside that month.
- Both views use the same period carousel pattern for previous, current, and next periods.
- A `Now` action returns the view to the real current year or month.
- Navigation feels spatial, with inward rotating card transitions instead of a flat list swap.

## Current State

- `Yearly` loads goals and shows only `horizon = year` goals for `planner.date`.
- `Monthly` loads goals and shows only `horizon = month` goals for `planner.date`.
- Planner creation already defaults goal `horizon` and `scheduled` by active planner tab.
- Planner date state already exists as `planner.date`; weekly state already uses ISO Monday week anchors.
- `todo-engine` requires canonical goal anchors: year = January 1, month = the 1st, week = ISO Monday.
- No new Rust endpoint is required for this feature.

## Shared Period Carousel

`Yearly` and `Monthly` share one visual pattern:

- Center card: selected period goal.
- Left card: previous period goal.
- Right card: next period goal.
- Left and right cards are partially recessed with rounded corners, scale, depth, and inward perspective.
- Previous and next arrow buttons sit at the horizontal edges of the carousel.
- Arrow navigation changes the selected period by one year or one month.
- The transition rotates cards toward the inside of the screen and replaces the visible period cards.
- The carousel keeps working when a neighboring period has no goal; the empty state remains card-shaped.
- Clicking a visible neighboring card may select that period, but arrow buttons are the required interaction.

## Header Controls

Each view header includes:

- Planner view title.
- Existing filter, sort, group, and add controls.
- `Now` button.

`Now` behavior:

- In `Yearly`, set `planner.date` to today's local date so the selected period is the current year.
- In `Monthly`, set `planner.date` to today's local date so the selected period is the current month.
- If the selected period is already current, `Now` remains visible and disabled or visually inactive.

## Yearly View

Yearly layout:

```text
Yearly
  header controls + Now
  period carousel
    previous year goal | selected year goal | next year goal
  month goal grid
    Jan | Feb | Mar
    Apr | May | Jun
    Jul | Aug | Sep
    Oct | Nov | Dec
```

Rules:

- The selected period is the year represented by `planner.date`.
- Year cards show goals where `type = goal`, `horizon = year`, and `scheduled` is inside that year.
- Month cards show goals where `type = goal`, `horizon = month`, and `scheduled` is inside each month of the selected year.
- Month cards render in a `3 x 4` grid on desktop.
- Month cards keep chronological order from January through December.
- Empty months still render a month card with an empty-state body.
- Existing Planner filters, sort, and group controls apply to visible goal content without changing the 12-month layout order.
- Add goal from Yearly continues to default `horizon = year` and the selected year date.

## Monthly View

Monthly layout:

```text
Monthly
  header controls + Now
  period carousel
    previous month goal | selected month goal | next month goal
  week goal strip
    W1 | W2 | W3 | W4 | W5 | W6 when needed
```

Rules:

- The selected period is the month represented by `planner.date`.
- Month cards show goals where `type = goal`, `horizon = month`, and `scheduled` is inside that month.
- Week cards show goals where `type = goal`, `horizon = week`, and `scheduled` falls inside that week.
- Weeks use the `todo-engine` canonical week anchor: ISO Monday.
- `W1` starts at the ISO Monday for the week containing the selected month's first day, even when that Monday is in the previous month.
- Include every ISO Monday anchored week that intersects the selected month, usually `W1` through `W5`, with `W6` only when the calendar shape requires it.
- Week cards render as a horizontal card strip.
- Week cards are visually substantial: wider and taller than a table row, with enough padding to show goal title, status, tags, and scheduled date when present.
- Empty weeks still render a week card with an empty-state body.
- Existing Planner filters, sort, and group controls apply to visible goal content without changing week order.
- Add goal from Monthly continues to default `horizon = month` and the selected month date.

## Data Rules

- Reuse `/todo-engine/items?type=goal` and current related item loading.
- Do not add new backend planner endpoints.
- Do not write directly to storage; all mutations keep using existing create and update flows.
- Terminal statuses stay hidden: `completed`, `archived`, `dropped`, `cancelled`.
- Goal period matching uses local `YYYY-MM-DD` date parts from `scheduled`.
- Year, month, and week buckets follow `todo-engine` canonical period starts; week buckets never clamp to the calendar month's first day.
- If multiple goals match the same period card, render them in the card using the active Planner sort and group settings.

## Visual Requirements

- Cards use restrained workbench styling, not a landing-page hero treatment.
- The selected period card is the strongest visual element in the view.
- Neighboring period cards are visibly secondary but still readable.
- Carousel depth is created with CSS transforms, shadows, scale, and border radius.
- The rotation animation must be optional through `prefers-reduced-motion`.
- Month and week cards have stable dimensions so hover states, empty states, and dynamic goal counts do not shift the layout.
- Mobile layouts may stack or horizontally scroll where needed, but the selected period remains obvious.

## Accessibility

- Arrow buttons have explicit labels such as `Previous year`, `Next year`, `Previous month`, and `Next month`.
- `Now` has a stable accessible name.
- Carousel transition does not trap focus.
- After arrow or `Now` navigation, keyboard focus remains on the activated control.
- Reduced-motion users get an immediate or fade-only card replacement.
- Empty period cards expose useful text to assistive technology.

## Tests

Use the existing Vitest and React Testing Library setup:

1. Yearly renders previous, selected, and next year goal cards.
2. Yearly arrow navigation changes the selected year and updates month cards.
3. Yearly `Now` returns to the current year.
4. Yearly renders 12 month cards in chronological order.
5. Monthly renders previous, selected, and next month goal cards.
6. Monthly arrow navigation changes the selected month and updates week cards.
7. Monthly `Now` returns to the current month.
8. Monthly renders ISO Monday anchored `W1...Wn` week cards for the selected month.
9. Terminal goal statuses remain hidden in carousel and lower-period cards.
10. Reduced-motion mode does not require the rotation animation to run.

Verification commands:

```bash
cd frontend
npm run test
npm run typecheck
npm run build
```

## Out of Scope

- New Rust planner API endpoints.
- New goal hierarchy fields or schema changes.
- Drag-and-drop goal rescheduling.
- Persisting the selected year or month across sessions.
- A separate calendar grid.
- Quarter goals.
- Custom animation libraries.

## Success Criteria

- `Yearly` shows a prominent selected year goal with previous and next year context.
- `Yearly` shows all 12 month goal cards for the selected year.
- `Monthly` shows a prominent selected month goal with previous and next month context.
- `Monthly` shows all week goal cards intersecting the selected month.
- Arrow navigation and `Now` work in both views.
- Existing Planner filters, sort, group, and add-goal behavior still work.
- The feature works without backend changes or new frontend dependencies.
