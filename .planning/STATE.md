---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: verifying
stopped_at: Phase 3 context gathered
last_updated: "2026-06-23T09:23:18.008Z"
last_activity: 2026-06-23 -- Phase 03 execution started
progress:
  total_phases: 5
  completed_phases: 3
  total_plans: 10
  completed_plans: 10
  percent: 60
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-22)

**Core value:** A user can set a big goal for a period (year/month/week), break it top-down into tasks, and see those tasks by date — all through the same policy-enforced engine.
**Current focus:** Phase 03 — date-view

## Current Position

Phase: 03 (date-view) — EXECUTING
Plan: 3 of 3
Status: Phase complete — ready for verification
Last activity: 2026-06-23 -- Phase 03 execution started

Progress: [████▌░░░░░] 47%

## Performance Metrics

**Velocity:**

- Total plans completed: 7
- Average duration: — min
- Total execution time: 0.0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01 | 3 | - | - |
| 02 | 4 | - | - |

**Recent Trend:**

- Last 5 plans: —
- Trend: —

*Updated after each plan completion*
| Phase 01 P01 | 8 | 2 tasks | 4 files |
| Phase 01 P02 | 6 | 2 tasks | 4 files |
| Phase 01 P03 | 4 | 2 tasks | 3 files |
| Phase 02 P01 | 4 | 2 tasks | 6 files |
| Phase 02 P02 | 18 | 2 tasks | 5 files |
| Phase 02 P03 | 3 | 2 tasks | 3 files |
| Phase 02 P04 | 1 | 2 tasks | 2 files |
| Phase 03 P01 | 2 | 2 tasks | 1 files |
| Phase 03 P02 | 3 | 2 tasks | 2 files |
| Phase 03 P03 | 4 | 2 tasks | 2 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Phase 1]: LYNCHPIN — period-anchor normalization (canonical `scheduled` per period; week-start = ISO Monday) must be established before any view phase. Lock and document week-start as a Key Decision during Phase 1.
- [Project]: `Goal` is a new `ItemType` variant (not a separate table) — reuses status lifecycle, approval gating, audit, and the reserved `horizon` field.
- [Project]: Period identity = `(horizon, scheduled)` over existing columns; schema stays additive (enum variant + indexes only, no `period_key` column).
- [Project]: Backward/forward binary compatibility is OUT OF SCOPE — always assume the latest binary; no `user_version` gating built.
- [Phase ?]: [Phase 1 Plan 01]: Week start = ISO Monday; normalization may land in the prior calendar year (2026-01-01 -> 2025-12-29); engine never clamps to Jan 1 and never auto-snaps (strict reject is Phase 2). LOCKED.
- [Phase 1 Plan 02]: `ItemType::Goal` maps to `"goal"`; the SC3 SQLite round-trip flows through `as_str`/`FromStr` via `mapping.rs` (generic over `ItemType`, no edit needed), NOT serde. Serde `snake_case` independently governs only the JSON `type` field. Zero schema added — Goal reuses the existing `type` column (CORE-02 additive).
- [Phase ?]: [Phase 1 Plan 03]: Three additive planning indexes (idx_items_parent_id, idx_items_scheduled, composite idx_items_type_horizon_scheduled) added via CREATE INDEX IF NOT EXISTS inside init_schema_inner; no ALTER TABLE, no period_key, user_version stays 1. SC4 test locks the additive-only contract on a populated copy.
- [Phase 2 Plan 02]: Goal-create policy lives in service/goal.rs; propose_goal validates anchor -> nesting -> duplicate before TodoItem::new, then stores via store_item_and_event (action "propose_goal", CORE-01). Goal anchor does NOT inherit the task "today" sentinel — explicit ISO date required (GOAL-03). Parent rule uses strict Horizon::is_coarser_than (equal rejected, no Ord). Cycle/depth DoS guard = visited HashSet + named MAX_GOAL_DEPTH=64 ancestor walk (defensive vs legacy data; new goal has no id so self-cycle impossible at create). Duplicate identity = (horizon, canonical scheduled, parent_id) triple, top-level parent_id=None. tests/integration/goal_policy.rs proves SC1/SC2/SC3a/SC3b and is the file 02-03 extends.
- [Phase 2 Plan 01]: CLI/API arg wiring for UpdateItem.parent_id and the new ListFilter fields (horizon/parent_id/scheduled) is deferred to later Phase 2 plans; struct-literal call sites set the new fields to None so this plan stays pure additive plumbing. UpdateItem.parent_id is validated as a non-terminal Goal via the existing ensure_relation helper on the audited update_item path (no bespoke bypass, CORE-01). repo.rs is untouched — list_items already delegates to apply_list_filter, so the new predicates cover the persistent path for free.
- [Phase 2 Plan 03]: Test-only plan (production code already shipped in Wave 1). SC4 link tests appended to tests/integration/goal_policy.rs prove task->goal linking via the audited update_item path (parent_id + scheduled set, update_item event emitted) plus non-Goal and terminal-parent Policy rejections via ensure_relation. New tests/integration/goal_view.rs proves VIEW-01 against the PERSISTENT SQLite store (TodoService::persistent over a temp todo.sqlite), not just in-memory, confirming repo.rs apply_list_filter parity for horizon/parent_id/(horizon,scheduled). goal_view uses tempfile::tempdir() directly (repository.rs idiom) since tests/support::TestHome is only registered in e2e.rs.
- [Phase 2 Plan 04]: SC5 docs-only deliverable. Goal ItemStatus semantics LOCKED in README (### Goal item-type subsection + ## Status lifecycle note) and ADR-0006: a Goal reuses the existing ItemStatus lifecycle unchanged (NO new states — health states on_track/at_risk deferred to v2 as derived signals); a goal is active for its period (activate has no Goal-specific precondition in v1); completed/dropped/cancelled are user-driven terminal and do NOT cascade to child goals or linked tasks in v1 (only routine->generated-tasks cascades). This resolves the Phase 2 documentation blocker so the Phase 4 rollup cannot re-litigate goal status meaning.
- [Phase ?]: [Phase 3 Plan 01]: agenda/date_range are pure side-effect-free TodoService reads composing list_items (no store branch = SC4 CLI/API parity free). agenda = scheduled==D OR due==D union deduped by id (D-02); date_range = scheduled-only inclusive range (D-03). Open-only via explicit OPEN_STATUSES allowlist, NOT list_items hidden-by-default. iso_day = leading-10-char parse_day.ok() so None/sentinel/junk = unscheduled (D-07). sort_date_view = scheduled asc, unscheduled last, created_at->id (D-08). No DateView (D-01), no due-tag (D-04), no overdue roll (D-06), no materialize (SC4).
- [Phase ?]: [Phase 3 Plan 03]: SC4 store parity proven via parity_in_memory_vs_persistent — one seed_fixture run through both in_memory and persistent stores, compared by stable (title, scheduled) key not raw ids. Side-effect-free proven via events().len() unchanged across agenda+date_range. date_view.rs registered first in integration.rs; persistent_service mirrored from goal_view.rs.

### Pending Todos

[From .planning/todos/pending/ — ideas captured during sessions]

None yet.

### Blockers/Concerns

[Issues that affect future work]

- [Phase 4]: Period-view goal-tree rollup is flagged for deeper performance research — recursive rollup collides with the pre-existing in-memory full-table-scan debt (CONCERNS.md). Decide single-load-in-memory vs. SQL-pushdown at Phase 4 planning; consider `--research-phase`.
- [RESOLVED Phase 2 Plan 04]: `ItemStatus` meaning for goals documented in README (### Goal subsection + ## Status lifecycle note) and ADR-0006 — goal is `active` for its period; `completed`/`dropped`/`cancelled` are user-driven terminal; no cascade to child goals or linked tasks in v1.

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| *(none)* | | | |

## Session Continuity

Last session: 2026-06-23T09:22:48.618Z
Stopped at: Phase 3 context gathered
Resume file: .planning/phases/03-date-view/03-CONTEXT.md
