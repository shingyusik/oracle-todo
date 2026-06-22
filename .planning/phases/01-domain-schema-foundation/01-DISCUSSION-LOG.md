# Phase 1: Domain + Schema Foundation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-22
**Phase:** 1-Domain + Schema Foundation
**Areas discussed:** Horizon levels, Non-canonical dates, Week year-boundary, Same-horizon nesting

---

## Horizon levels

| Option | Description | Selected |
|--------|-------------|----------|
| Year/month/week only | Lock to the 3 requirement levels; quarter/day deferred; enum variant is additive later; coarser-than ordering defined now | ✓ |
| Include quarter | year>quarter>month>week; OKR-style; needs quarter-start normalization now; beyond requirements | |
| Include day | Day-level goals; overlaps with task `scheduled` + date view; beyond requirements | |

**User's choice:** Year/month/week only (recommended)
**Notes:** Stored as `"year"`/`"month"`/`"week"`. Strict ordering year > month > week.

---

## Non-canonical dates

| Option | Description | Selected |
|--------|-------------|----------|
| Reject (strict) | Phase 2 service rejects non-canonical anchor with a clear validation error; helper exposes normalize + is-canonical; matches GOAL-03 | ✓ |
| Auto-snap (forgiving) | 15th → 1st silently; conflicts with GOAL-03 "no silent drop"; helper only needs normalize | |
| Snap + warning return | Snap to 1st but return a "reinterpreted" message; middle ground; raises Phase 2 return-value + CLI/API channel complexity | |

**User's choice:** Reject (strict) (recommended)
**Notes:** Phase 1 helper must report is-canonical so Phase 2 can reject rather than rewrite.

---

## Week year-boundary

| Option | Description | Selected |
|--------|-------------|----------|
| True ISO Monday | Anchor = Monday of the date's week, may fall in previous calendar year (2026-01-01 → 2025-12-29); single consistent rule; matches `time` weekday math; ISO 8601 | ✓ |
| Clamp to Jan 1 | Early-year week anchors clamp to 1/1; splits the week in two; not ISO | |
| ISO week-year | Membership by ISO week-year; needs ISO week API; effectively same result as Monday-snap | |

**User's choice:** True ISO Monday (recommended)
**Notes:** Drives the W01/W53/Dec-31/Jan-1 boundary unit tests in Roadmap SC1.

---

## Same-horizon nesting

| Option | Description | Selected |
|--------|-------------|----------|
| Allow | month→month, week→week OK; Horizon method allows equal; more flexible real-world sub-grouping | |
| Forbid (strict hierarchy) | Parent must be strictly coarser (year>month>week strict); month→month rejected; `is_coarser_than` strict method; cleaner tree | ✓ |

**User's choice:** Forbid (strict hierarchy)
**Notes:** Level-skipping still allowed (year → week). Strict ordering method confirms the Horizon-levels decision (D-02).

---

## Claude's Discretion

- Helper module location/name (`domain/horizon.rs` vs. extend `model.rs`), exact method names, `time::Date` wrapper shape.
- String→`Date` parsing location (Phase 2 mutation boundary; Phase 1 helper takes parsed `Date`).

## Deferred Ideas

- `quarter` horizon (OKR-style) — additive later, out of v1.
- `day` horizon for goals — overlaps task scheduling + date view; likely unnecessary.
- Auto-snap with warning — rejected for v1; reconsider only if UX friction emerges.
