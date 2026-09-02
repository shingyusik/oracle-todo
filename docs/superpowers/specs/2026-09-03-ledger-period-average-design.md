# Ledger Period Average Design

**Date:** 2026-09-03
**Status:** Approved

## Goal

Make average daily spending reflect the elapsed portion of the selected Ledger period in both
Reports and Dashboard highlights, and show the exact average beside the spending chart's average
line legend.

## Average Window

The average uses spending and calendar days from the same observed window:

- `Current month`: the first day of the month through today.
- `Previous month`: the complete previous month.
- `Current year`: January 1 through today.
- A past custom range: the complete selected range.
- A custom range containing today or future dates: its start through today.
- A custom range beginning after today: no observed spending and an average of zero.

Both ends are inclusive. Future-dated entries are excluded from the average numerator as well as
the day count. Period totals, category composition, and bars continue to describe the selected
report range; only the average metric and average pace line use the observed window.

## Shared Data Flow

The shared Ledger report loader determines the observed window from the browser-local current
date and the selected report range. When the selected range extends beyond today, it obtains the
spending total for the observed window through the existing report API. Past periods reuse the
already loaded selected-period total. The resulting observed spending and inclusive day count are
passed into the shared `LedgerReportModel` calculation.

Ledger Reports and Dashboard highlights consume the same model. No Dashboard-only formula or new
backend route is added.

## Presentation

Summary and Cash Flow continue to show `Average daily spending`. The supporting Summary text uses
`Elapsed calendar days` so the denominator is explicit.

On the Spending tab, the existing legend includes the formatted value:

`Average daily · 11,363 KRW`

The legend remains above the plot at the right. It is visible without horizontal scrolling and
does not compete with bars, axis labels, or the dashed marker. The Income tab does not show the
average legend or marker.

## Accessibility

- The visible legend communicates the marker meaning and exact value without relying on color.
- Screen-reader trend descriptions retain the formatted average amount.
- Zero and decimal-place formatting follow the existing report money formatter.

## Verification

- Model tests cover current month, previous month, current year, past custom, future-ending custom,
  and future-only custom windows.
- Loader tests verify that future dates are excluded from the observed spending aggregate.
- Presentation tests verify the formatted average in the Spending legend for both Reports and the
  reused Dashboard chart.
- Focused Ledger tests, the full frontend suite, typecheck, and production build pass.
