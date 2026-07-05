# ADR-0005: Recurrence parsing uses RRULE

## Status

Accepted (v1).

## Context

Routines need a `recurrence_rule` to materialize tasks. The engine needs intervals,
weekday sets, monthly day-of-month, month-end, and yearly schedules without growing a
literal string table for every cadence or language variant.

RRULE is a compact iCalendar expression format that fits these routine schedules better
than cron because it has interval, weekday, month-day, month, and last-day concepts.

## Decision

Routine recurrence is parsed by `domain::occurrences` using an RRULE subset first.
Legacy natural-language rules remain readable for existing data.

Supported RRULE shape:

```text
RRULE:FREQ=<DAILY|WEEKLY|MONTHLY|YEARLY>[;INTERVAL=<n>][;BYDAY=<days>][;BYMONTHDAY=<days>][;BYMONTH=<months>]
```

Supported fields:

- `FREQ` is required and accepts `DAILY`, `WEEKLY`, `MONTHLY`, or `YEARLY`.
- `INTERVAL` is a positive integer and defaults to `1`.
- `BYDAY` accepts `MO,TU,WE,TH,FR,SA,SU` for weekly rules.
- `BYMONTHDAY` accepts `1..31` or `-1` for the last day of the month.
- `BYMONTH` accepts `1..12` for yearly rules.

Unsupported RRULE keys, duplicate keys, invalid values, or fields used with the wrong
frequency return `RecurrenceError::unsupported(rule)` with the original rule string.

Date generation remains date-based:

- `DAILY;INTERVAL=N` emits every Nth date from the materialization window start.
- `WEEKLY;INTERVAL=N;BYDAY=...` emits matching weekdays in every Nth week from the
  materialization window start.
- `MONTHLY;INTERVAL=N;BYMONTHDAY=...` emits matching month days in every Nth month from
  the materialization window start month.
- `YEARLY;INTERVAL=N;BYMONTH=...;BYMONTHDAY=...` emits matching month/month-day pairs in
  every Nth year from the materialization window start year.

Legacy compatibility still accepts the previous pattern grammar:

- aliases such as `daily`, `매일`, `weekly`, `monthly`, and `yearly`
- weekday sets such as `weekdays`, `월-금`, `weekend`, `월수금`, and `mon,wed,fri`
- interval strings such as `every 2 weeks on mon`, `every month on the 15th`, and
  `every month on the last`

## Consequences

- New routine writers can store one standard expression format in `recurrence_rule`.
- Existing routine rows keep materializing without a migration.
- The workbench can expose condition controls that generate RRULE without requiring raw
  RRULE input.
- `per_occurrence` materialization can keep relying on deterministic date occurrence keys
  over any `[start, end]` window.
