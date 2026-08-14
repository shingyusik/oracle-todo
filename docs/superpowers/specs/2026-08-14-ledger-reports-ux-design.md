# Ledger Reports UX Design

## Goal

Present an immediately useful period summary and let users drill from analysis into the
matching transactions.

## Period and Currency Controls

Reports open to the current calendar month. Period controls provide Current month, Previous
month, Current year, and Custom range.

Each currency has an independent tab. Reports never combine currencies or apply exchange
rates.

The comparison period is the immediately preceding equivalent period:

- current month compares with the previous calendar month;
- previous month compares with the month before it;
- current year compares with the previous calendar year;
- a custom range compares with the immediately preceding range of equal inclusive length.

## Summary

Four cards show Total income, Total expense, Net change, and Transaction count. Each card
also shows its change from the comparison period.

## Analysis Sections

Sections appear in this order:

1. Expense categories
2. Accounts
3. Period trend

Expense categories use a donut chart and an exact-value table. The donut defaults to expense
categories; income remains available in the tabular report data.

The Accounts table shows period income, expense, and net change.

The trend chart uses separate income and expense lines. Granularity is automatic: month-sized
ranges use daily points and year-sized ranges use monthly points. Other custom ranges choose
the coarsest daily, weekly, or monthly granularity that keeps the chart readable.

Activating a category or account result navigates to Transactions with the report's period,
currency, and selected category or account applied as filters.

## States and Errors

- Loading keeps the selected controls visible and marks report content busy.
- Empty periods show zero summary cards and section-specific empty messages.
- One failed report request displays a safe retryable error without clearing the selected
  period or currency.
- Drill-down navigation is available only for rendered category and account results.

## Verification

- the current month and correct currency tab load by default;
- presets and custom ranges derive the correct inclusive comparison period;
- summary values and comparison changes are correct;
- category chart and table represent the same expense totals;
- account rows show income, expense, and net change;
- trend granularity and points match the selected range;
- currencies remain separated without conversion;
- category and account drill-down opens the correctly filtered Transactions view;
- loading, empty, and failure states preserve the selected controls.

## Non-Goals

- Exchange-rate lookup or cross-currency totals
- Budget tracking or forecasting
- Report export
- Custom dashboard layouts
