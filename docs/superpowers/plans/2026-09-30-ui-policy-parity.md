# UI Policy Parity Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans to implement the approved domain changes. No commits without a user request.

**Goal:** Every exposed domain mutation follows the reachable UI model; changed records remain visible and understandable in UI.

**Architecture:** Keep application services authoritative. Restrict inputs in services, wire existing policy through CLI/HTTP/UI, retain stored compatibility, delete obsolete exposed paths and orphan callers. Never probe live homes or erase existing records.

## Health ownership

- [x] Restrict generic creates to bowel/medication; remove ordinary metric add/update and generic symptom/custom metric input paths.
- [x] Canonical five daily identities, names, units and nonnegative lab values; same predicates in table/reports. Reject identity/date changes through generic updates.
- [x] Align daily date convention, version checks, condition notes, saved-photo reads/previews and committed cleanup UI outcomes.
- [x] Expose archive browsing/restore with guarded actions. Limit public purge to UI-backed paths.
- [x] Delete unused timeline/trends public adapters, orphan helpers/types/tests; retain used Reports/audit infrastructure.
- [x] Add regressions and report removed-symbol searches.

## ToDo ownership

- [x] Type/relationship field matrix, priority 1..10, canonical review cycles, date/time and recurrence validation on create/update.
- [x] Remove manual routine linking, public drop/cancel/task pause; keep stored compatibility and legitimate cascade states.
- [x] HTTP/UI version checks, goal parent control for tasks, terminal transition controls, description-to-note compatibility without destructive migration.
- [x] Single-routine CLI materialization, target policy, creation tags, preserved audit reasons, archive inspection.
- [x] Delete obsolete adapters/branches/types/tests and add policy regressions.

## Ledger ownership

- [x] Restrict public adjustment input and written_at/source/actor overrides while preserving existing historical data display.
- [x] UI inactive/archive browsing, restore/reactivate, audit inspection; only UI-backed confirmed purge operations remain public.
- [x] Remove unused briefing/account report/public redundant query flexibility and resulting dead code; keep report consumers.
- [x] Add regressions and prove removed-symbol references are gone.

## Root integration ownership

- [x] HTTP domain reads use read-only repositories/media; remove legacy settings routes/callers.
- [x] Review shared CLI/API contracts and safe error mapping; coordinate workers' edits to shared parser files.
- [x] Synchronize current-state docs, README, and agent context as applicable.
- [x] Run Rust fmt/workspace tests/Clippy, frontend tests/typecheck/build, npm wrapper tests, temp-home API/CLI/UI smoke; review regressions and repair.
- [x] Complete changed-scope dead-code searches and cross-domain policy parity review.
