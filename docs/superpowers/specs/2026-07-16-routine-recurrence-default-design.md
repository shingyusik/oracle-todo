# Routine Recurrence Default Design

**Date:** 2026-07-16
**Status:** Approved
**Scope:** Keep the routine recurrence editor's visible default synchronized with its saved draft value.

## Problem

A routine with no stored `recurrence_rule` is rendered as `Every 1 / Daily` with preview
`RRULE:FREQ=DAILY`. The detail draft remains empty, so saving another change does not send the
visible recurrence rule. Resuming a paused routine then fails service validation because the stored
rule is still absent.

## Design

- Initialize a routine detail draft with `RRULE:FREQ=DAILY` when its stored `recurrence_rule` is
  absent.
- Preserve every existing non-empty recurrence rule unchanged.
- Keep the existing save order: persist the detail patch before requesting the status transition.
- Do not change Rust service validation, schema defaults, or routine creation policy.

## Verification

A presentation test opens a paused routine without a recurrence rule, selects `active`, and saves.
It verifies that the frontend first patches `recurrence_rule: "RRULE:FREQ=DAILY"` and then calls the
resume endpoint.

## Success Criteria

- The recurrence rule displayed in the editor is included in the next save.
- A paused routine with the visible Daily default can resume in one save action.
- Existing stored recurrence rules are not replaced.
