# Dashboard Single-Row Mini Donuts Design

## Goal

Fit Today's work, Completion history, and combined status analytics on one wide-screen row while making abandoned Projects easy to spot.

## Layout

- At `1440px` and wider, use three columns: Today's work `22fr`, Completion history `43fr`, and Status `35fr`.
- From `768px` through `1439px`, retain Today's work and Completion history on the first row and place Status across the next row.
- Below `768px`, stack all cards in one column.
- Loading skeletons mirror the same layout.

## Status Card

- Replace the separate Area status and Project status cards with one `Status` card.
- Provide accessible `Project` and `Area` tabs; `Project` is selected initially.
- Preserve separate navigation targets and empty states for each scope.
- Show four mini-donut tiles by default and reuse the existing expand/collapse interaction for additional items.

### Project Tab

- One tile represents one active Project.
- Donut segments show Completed, Incomplete, Paused, and Miss percentages from the existing Project status projection.
- The donut center shows Project progress, or `—` when unavailable.
- Tile borders and visible labels show `Risk`, `Attention`, or normal state using the existing due-date and inactivity rules.
- Tile metadata shows Miss count and total linked work.
- Order tiles by `Risk`, `Attention`, then normal; retain the existing Miss, incomplete, and name ordering within each tier.
- Selecting a tile navigates to the Project detail.

### Area Tab

- One tile represents one active or paused Area.
- Donut segments show Completed, Incomplete, Paused, and Miss percentages.
- The donut center shows total linked work.
- Tile metadata shows Completed percentage and total linked work without adding a new Area risk rule.
- Selecting a tile navigates to the Area detail.

## Data and Components

- Keep the current Area and Project snapshot calculations and widget builders as the data source.
- Add numeric Project progress to the existing status row presentation model instead of parsing display text.
- Add a focused mini-donut grid component that consumes existing status cells and destinations.
- Add a combined Status card component that owns tab and per-scope expansion state.
- Do not add API, storage, dependency, or lifecycle changes.

## Accessibility and Interaction

- Use tablist, tab, and tabpanel semantics; Left, Right, Home, and End move and select tabs.
- Include status names and values in donut and tile accessible labels; color is not the only signal.
- Preserve reduced-motion behavior and visible focus styles.
- Keep the selected scope when expanding or collapsing its tile list.

## Verification

- Model tests cover numeric progress and Risk-first Project ordering.
- Widget tests cover the unchanged status counts and destinations.
- Presentation tests cover default Project selection, Area switching, empty states, expansion, and navigation.
- CSS contract tests cover wide, medium, and mobile layouts.
- Run focused Dashboard tests, the frontend type checker, and the full frontend suite.
