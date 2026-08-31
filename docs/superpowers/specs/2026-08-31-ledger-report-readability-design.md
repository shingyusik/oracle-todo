# Ledger Report Readability Refinement Design

## Context

This refinement supersedes the affected control, empty-state, and trend-chart decisions in
`2026-08-28-ledger-reports-visual-analysis-design.md`. The report remains currency-isolated
and graph-first; no API, database, or lifecycle contract changes are required.

## Goals

- Make account balances load reliably when Reports is opened directly.
- Make both income and spending trends readable without implying that two independently
  scaled series share one axis.
- Show exact chart scale values and grouped report amounts.
- Keep the asset and liability composition layout stable when one side is zero.
- Keep custom dates hidden until requested and apply them explicitly.

## Period Controls

Current month, Previous month, Current year, and Custom range are peer controls. Selecting a
preset runs it immediately and closes an open custom editor. Selecting Custom range toggles an
inline editor with native Start and End date inputs plus an Apply button.

Changing a custom date never issues a request. Apply remains disabled until both dates are
present and `from <= to`; submitting a valid range runs the custom report. On success, the editor
closes while Custom range remains selected. On failure, it stays open with the entered dates so
the existing safe error and Retry flow can be used. Reopening the editor restores those dates.

## Account Balances

Running any report fetches all account-balance pages alongside category and trend data. This
removes the accidental dependency on visiting the Accounts workspace first.

Assets and liabilities remain filtered to the selected currency. Currencies are never mixed.
When a selected currency has no assets or no liabilities, the corresponding composition card
keeps its donut footprint and displays a neutral zero donut, a `0 <CODE>` center value, and a
short no-balances message. For example, selecting USD may show assets alongside a `0 USD`
liability donut; it must not carry the KRW credit-card balance into USD.

## Income and Spending Trend

The chart has two local tabs: Income and Spending. Spending is selected whenever the component
is mounted. The selection is not persisted in browser or Raven preferences.

Only the selected series is drawn, so its scale is unambiguous. The traditional left Y-axis
shows three grouped-money ticks: the plot maximum, half that maximum rounded to a minor unit,
and zero. The Income plot maximum is its largest bucket. The Spending plot maximum includes
both its largest bucket and the average pace marker so neither exceeds the chart. Income bars
retain income drilldown behavior; spending bars retain expense drilldown behavior. The average
daily pace marker is shown only on the Spending tab. Dates remain on the horizontal axis.

If the selected series is entirely zero, the axis remains stable at zero and the existing
period dates remain visible; no false positive-height bar is drawn.

## Money Formatting

Report-only money formatting inserts comma thousands separators while preserving currency
decimal places, signs, and the trailing currency code. Examples are `3,650,000 KRW`,
`-650,000 KRW`, and `1,250.00 USD`. The grouped formatter is used by Summary, report donuts,
their legends, the trend Y-axis, and report accessibility text. Transaction and master-data
tables remain unchanged.

## Accessibility and Responsive Behavior

- The Income and Spending selectors use tab semantics and expose the selected state.
- The chart retains a screen-reader value list for the selected series and the spending average.
- Y-axis labels are visible text and are not conveyed by color alone.
- Zero donuts retain an accessible name containing their zero total.
- The Y-axis uses a fixed label column; the date plot continues to scroll horizontally on narrow
  screens.
- Existing keyboard drilldown and visible-focus behavior remains intact.

## Error and Loading Behavior

Balance loading is part of the report request. If balance, comparison, category, or trend loading
fails, the existing safe report error and Retry flow applies while preserving the last successful
analysis. A stale report request must not overwrite a newer selection.

## Verification

- Controller tests prove that opening or changing Reports fetches paginated balances without an
  Accounts visit and retains stale-request protection.
- Presentation tests cover the Spending default tab, Income/Spending switching, selected-series
  bars, three visible Y-axis ticks, spending-only average pace, and both drilldown types.
- Presentation tests cover explicit valid custom-range application, disabled incomplete or
  inverted ranges, preset-driven collapse, successful collapse, and retained inputs on failure.
- Formatting tests cover grouped positive, negative, zero-decimal, and two-decimal report amounts.
- Composition tests cover a stable `0 USD` donut when no USD liability exists.
- Run the focused Ledger tests, the full frontend test suite, typecheck, and production build.
