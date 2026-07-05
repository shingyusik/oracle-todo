# RRULE Recurrence Design

**Date:** 2026-07-06
**Status:** Ready for review
**Scope:** Replace new routine recurrence entry with RRULE expressions while keeping existing routine data readable.

## Goal

Routine recurrence uses a compact standard expression language instead of ad hoc natural-language strings.

- New routine rules are stored as iCalendar RRULE strings.
- Existing natural-language rules remain readable for migration safety.
- Materialization still emits date-based task occurrences.
- The workbench UI builds RRULE values through condition controls, not a raw expression box.

## Rule Format

Supported RRULE values use this shape:

```text
RRULE:FREQ=<DAILY|WEEKLY|MONTHLY|YEARLY>[;INTERVAL=<n>][;BYDAY=<days>][;BYMONTHDAY=<days>][;BYMONTH=<months>]
```

Supported fields:

| Field | Meaning |
| --- | --- |
| `FREQ` | `DAILY`, `WEEKLY`, `MONTHLY`, or `YEARLY`. Required. |
| `INTERVAL` | Positive integer interval. Defaults to `1`. |
| `BYDAY` | Weekday list using `MO,TU,WE,TH,FR,SA,SU`. Weekly rules only. |
| `BYMONTHDAY` | Month day list using `1..31` or `-1` for the last day. Monthly and yearly rules. |
| `BYMONTH` | Month list using `1..12`. Yearly rules. |

Unsupported RRULE features are rejected with the existing unsupported `recurrence_rule` policy error.

## Current Rule Coverage

| Current rule | RRULE |
| --- | --- |
| `daily`, `매일`, `every day` | `RRULE:FREQ=DAILY` |
| `every 2 days` | `RRULE:FREQ=DAILY;INTERVAL=2` |
| `weekly`, `매주`, `every week` | `RRULE:FREQ=WEEKLY` |
| `every 2 weeks on mon` | `RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO` |
| `weekdays`, `평일`, `월-금` | `RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR` |
| `weekend`, `주말`, `토-일` | `RRULE:FREQ=WEEKLY;BYDAY=SA,SU` |
| `mon,wed,fri`, `월수금` | `RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR` |
| `monthly`, `매월`, `every month` | `RRULE:FREQ=MONTHLY;BYMONTHDAY=1` |
| `every month on the 15th` | `RRULE:FREQ=MONTHLY;BYMONTHDAY=15` |
| `every month on the last` | `RRULE:FREQ=MONTHLY;BYMONTHDAY=-1` |
| `yearly`, `매년`, `every year` | `RRULE:FREQ=YEARLY;BYMONTH=1;BYMONTHDAY=1` |
| `every 2 years` | `RRULE:FREQ=YEARLY;INTERVAL=2;BYMONTH=1;BYMONTHDAY=1` |

## Engine Behavior

`domain::occurrences` accepts RRULE strings first.

- RRULE parsing is case-insensitive for keys and values.
- The `RRULE:` prefix is accepted and stored by new writers.
- Date generation returns the same `Vec<Date>` shape used by routine materialization.
- Legacy natural-language parsing stays as a fallback.
- Existing occurrence keys stay ISO dates.

RRULE anchoring follows the existing materialization window start:

- `DAILY;INTERVAL=N` emits every Nth date from the window start.
- `WEEKLY;INTERVAL=N;BYDAY=...` emits matching weekdays in every Nth week from the window start.
- `MONTHLY;INTERVAL=N` emits matching month days in every Nth month from the window start month.
- `YEARLY;INTERVAL=N` emits matching month/month-day pairs in every Nth year from the window start year.

## UI Behavior

The routine detail view replaces the current interval/unit/anchor controls with RRULE condition controls.

| Control | Writes |
| --- | --- |
| Frequency | `FREQ` |
| Every N | `INTERVAL` |
| Weekdays | `BYDAY` for weekly rules |
| Month day | `BYMONTHDAY` for monthly/yearly rules |
| Last day of month | `BYMONTHDAY=-1` |
| Month | `BYMONTH` for yearly rules |

The UI shows a generated preview string for transparency, but saves only `recurrence_rule`.

## Boundaries

- No schema changes.
- No new item type.
- No raw RRULE editor in the first implementation.
- No time-of-day task materialization; routines remain date-based.
- No external recurrence dependency unless an already-installed crate covers the exact needed subset.

## Testing

- Unit tests cover RRULE daily, weekly weekdays, monthly nth day, monthly last day, and yearly interval generation.
- Integration materialization tests cover at least one RRULE routine through `TodoService`.
- Presentation tests cover saving an RRULE from the routine detail controls.
- Existing legacy recurrence tests remain green.
