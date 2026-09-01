# Dashboard Ledger Highlights Design

**Date:** 2026-09-01
**Status:** Approved

## Goal

Add a concise Ledger analysis surface below the existing ToDo analytics on the Dashboard. It should answer how the selected month's income and spending are behaving without duplicating the full Ledger Report page.

## Scope

The Dashboard adds one shared `Ledger highlights` surface with common period and currency controls. Its content uses a desktop `1:1:2` layout:

1. `Cash flow`
2. `Spending by category`
3. `Income and spending pattern`

The surface stacks those panels in the same order on narrow screens.

The Dashboard does not show asset or liability composition, custom dates, the current-year preset, exchange-rate conversion, or a duplicate top-category summary. Those remain Report concerns.

## Shared Controls

- Period options are `Current month` and `Previous month`.
- Currency options come from Report activity and account balances, so a currency with accounts but no selected-period activity remains selectable.
- Changing either control refreshes all three panels together.
- The initial selection is the current month and the first available currency.

## Cash Flow

The new Cash Flow donut shows spending as a share of income.

- When income is positive and spending does not exceed it, the filled arc is `spending / income` and the remainder stays neutral.
- The center shows the spending percentage.
- Supporting values are income, spending, remaining amount, and average daily spending.
- Average daily spending uses the same inclusive-day calculation as Ledger Reports.
- When spending exceeds income, the ring is fully red, the center shows `Over N%`, and the remaining amount is negative.
- When both income and spending are zero, the panel shows its empty state instead of a zero donut.

## Reused Report Charts

`Spending by category` and `Income and spending pattern` reuse the Ledger Report data model and chart components rather than maintaining Dashboard-only calculations.

The category panel preserves:

- total spending in the donut center;
- category amount and percentage legend;
- the Report ordering and `Other` grouping policy;
- category drilldown.

The trend panel preserves:

- independent `Income` and `Spending` tabs;
- daily granularity for the two monthly presets;
- a labeled Y axis;
- the average daily spending line on the Spending tab;
- trend drilldown to the selected entry type and report range.

Dashboard-specific props may make the reused charts fit their panel, but they must not create a second calculation path.

## Navigation

- Selecting the `Ledger highlights` title opens Ledger Reports with the Dashboard period and currency intent.
- Selecting a category opens Ledger Transactions filtered by range, currency, and category.
- Selecting a trend bar opens Ledger Transactions filtered by range, currency, and entry type.
- Navigation intent is transferred through the workbench boundary so filters are applied by the Ledger workspace controller, not by bypassing its table policy.

## Data Flow

The frontend extracts the existing Report request orchestration into one shared loader. It performs the existing comparison request, derives the selected range, then loads category breakdown, trend, and all paginated account balances. Both Ledger Reports and Dashboard Ledger highlights consume that loader and build the same `LedgerReportModel`.

Dashboard owns only presentation state for period, currency, loading, and errors. It loads when the Dashboard is visible and reloads after the Ledger mutation epoch changes. No new backend route or duplicated aggregate is required.

## Loading, Empty, and Error States

- Ledger loading and failure do not hide or fail ToDo analytics.
- The Ledger surface uses a local loading skeleton.
- A failed Ledger request replaces only the Ledger surface body with a safe error and Retry action.
- A selectable currency with no period activity keeps its tab and shows panel-level empty states.
- Raw storage errors, paths, and request internals are never exposed.

## Accessibility

- Period and currency controls expose selected state.
- Income and Spending retain tab semantics.
- Donuts include text equivalents for totals, values, and percentages.
- Bars and category rows remain keyboard reachable and have amount-aware labels.
- Responsive stacking preserves source and focus order: Cash Flow, category, then trend.

## Verification

Automated coverage must verify:

- current/previous month and currency changes refresh all panels;
- normal and overspending Cash Flow calculations;
- zero-activity currency behavior;
- Report chart reuse and amount formatting;
- category and trend drilldown intents;
- Ledger errors remain isolated from ToDo;
- reload after a Ledger mutation epoch;
- desktop `1:1:2` and narrow stacked layout contracts.

The approved visual reference is Sketch 002, Variant B in `.planning/sketches/002-dashboard-ledger-highlights/`.
