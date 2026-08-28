# Ledger Reports Visual Analysis Design

## Goal

Rebuild Ledger Reports as a graph-first analysis page that shows current assets and liabilities at a glance, reveals income and spending patterns over a selected period, calculates average daily spending, and explains spending by category.

The approved layout is the balanced single-page option: summary metrics first, asset and liability composition second, time-based analysis third, and category composition last.

## Scope

- Keep Reports as the detailed Ledger analysis surface.
- Defer Dashboard Ledger highlights until the redesigned Reports page establishes which insights deserve promotion.
- Keep currencies separate through the existing currency tabs. Do not introduce exchange rates or cross-currency totals.
- Include a currency when it appears in either the selected-period report or current account balances. A balance-only currency still shows its asset and liability composition while period income and spending remain zero.
- Do not add storage, schema, lifecycle, or audit changes.
- Do not add a chart dependency.
- Do not show previous-period comparisons.

## Page Structure

### Controls

- Retain Current month, Previous month, Current year, and custom date-range controls.
- Retain one selected currency at a time.
- Load Current month automatically on first entry.

### Summary

Show six metrics before the charts:

1. Total assets: sum of positive current account balances in the selected currency.
2. Total liabilities: absolute sum of negative current account balances in the selected currency.
3. Net assets: total assets minus total liabilities.
4. Income for the selected period.
5. Spending for the selected period.
6. Average daily spending: period spending divided by the inclusive number of calendar days, rounded for display to the nearest minor unit.

Assets, liabilities, and net assets describe the current state. Income, spending, and average daily spending describe the selected report period. Labels and supporting text must make this distinction explicit.

### Asset and Liability Composition

Place two equal-width cards side by side on wide screens and stack them on narrow screens.

- The Assets donut contains accounts with positive current balances.
- The Liabilities donut contains accounts with negative current balances, using their absolute values for proportions and display.
- Each donut center shows its total.
- Each legend row shows account name, percentage, and exact amount.
- Selecting an account opens the Transactions workspace filtered to that account without a date restriction because the chart represents its current balance.
- A zero-total chart shows a focused empty state instead of an empty ring.

### Income and Spending Pattern

- Use grouped bars because the horizontal axis represents time rather than part-to-whole composition.
- Show income and spending for every trend bucket returned by the existing automatic granularity rule.
- Show the average daily spending pace at the chart's bucket scale. For example, a weekly bucket compares against average daily spending multiplied by the number of calendar days in that bucket. This keeps the reference meaningful when granularity changes.
- Keep the standalone Average daily spending summary metric unchanged.
- Selecting a bar opens Transactions filtered to that bucket's date range, selected currency, and matching income or expense type.

### Spending by Category

- Use a donut because the chart explains part-to-whole composition.
- Show total period spending in the center.
- Sort categories by spending descending.
- Show the seven largest categories as individual segments and combine the remainder into Other.
- Each individual legend row shows category name, percentage, and exact amount and opens Transactions filtered to the selected period, currency, and category.
- Other is a non-interactive summary segment.
- A zero-spending period shows a focused empty state.

## Data and Components

Reuse the current Ledger controller and API responses:

- `state.balances` supplies current account balances for the asset and liability donuts.
- The current side of the existing comparison response supplies the selected range and period summary. The previous side remains unused in the UI; retaining the endpoint avoids adding a second preset-resolution path.
- Currency options are the union of currencies in the comparison and current balances, so an account funded only by its opening balance remains visible.
- The existing trend response supplies automatically bucketed income and spending.
- The existing category breakdown supplies category composition.
- The account activity breakdown is no longer rendered and its report request can be removed.

Build one presentation model that filters all inputs to the selected currency and calculates totals, proportions, daily average, bucket-scale average pace, and the Other category. Rendering components consume that model:

- `ReportSummaryCards`
- `AccountBalanceDonuts`
- `IncomeExpenseTrendChart`
- `ExpenseCategoryDonut`

Reuse the existing CSS/SVG chart approach and Ledger money formatter.

## Loading, Failure, and Empty States

- Preserve the last successful analysis while a new period loads and mark the analysis region busy.
- If a refresh fails after data has loaded, retain that data and show an inline error with Retry.
- If the first load fails, show the same inline error and Retry without rendering misleading zero values.
- Treat missing data independently per chart so an empty asset, liability, trend, or category set does not hide the other analysis.
- Prevent division by zero in all percentage and average calculations.

## Accessibility and Responsive Behavior

- Never use color as the only distinction. Every series and donut segment has a visible text label, amount, and percentage where applicable.
- Give each chart an accessible name and a textual value list for screen readers.
- Make interactive legend rows and bars keyboard reachable with visible focus styles.
- Keep Assets and Liabilities side by side when space permits and stacked on smaller screens.
- Allow chart legends to wrap or scroll without shrinking labels below the existing readable type scale.
- Respect the existing reduced-motion behavior.

## Verification

- Model tests cover positive, negative, and zero balances; total assets, total liabilities, and net assets; inclusive calendar-day averaging; currency isolation; category ordering; and Other aggregation.
- Model tests cover automatic trend buckets and bucket-scale average pace, including partial buckets.
- Presentation tests cover initial Current month loading, currency and period changes, retained data during loading, first-load and refresh failures, Retry, and per-chart empty states.
- Interaction tests cover account, time-bucket/type, and category transaction drilldowns.
- Accessibility checks cover chart names, textual values, keyboard activation, and focus visibility.
- Run the focused Ledger report tests, `npm --prefix frontend test`, `npm --prefix frontend run typecheck`, and `npm --prefix frontend run build`.
