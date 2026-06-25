---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: verifying
stopped_at: Completed 04.1-02-PLAN.md
last_updated: "2026-06-25T07:05:31.103Z"
last_activity: 2026-06-25
progress:
  total_phases: 6
  completed_phases: 5
  total_plans: 16
  completed_plans: 16
  percent: 83
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-22)

**Core value:** A user can set a big goal for a period (year/month/week), break it top-down into tasks, and see those tasks by date — all through the same policy-enforced engine.
**Current focus:** Phase 04.1 — fix-period-view-code-review-findings

## Current Position

Phase: 5
Plan: Not started
Status: Phase complete — ready for verification
Last activity: 2026-06-25

Progress: [████████░░] 80%

## Performance Metrics

**Velocity:**

- Total plans completed: 16
- Average duration: — min
- Total execution time: 0.0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01 | 3 | - | - |
| 02 | 4 | - | - |
| 03 | 3 | - | - |
| 04 | 3 | - | - |
| 04.1 | 3 | - | - |

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
| Phase 04 P01 | 18 | 2 tasks | 5 files |
| Phase 04 P02 | 12 | 2 tasks | 5 files |
| Phase 04 P03 | 9 | 2 tasks | 2 files |
| Phase 04.1 P01 | 6 | 2 tasks | 2 files |
| Phase 04.1 P02 | 9 | 2 tasks | 2 files |
| Phase 04.1 P03 | 9 | 3 tasks | 2 files |

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
- [Phase 4 Plan 01]: PeriodView/GoalNode is the single shared serde nested type in queries.rs (D-01), fed by both stores; loaders diverge only in producing the flat working set. period_view(horizon, period) accepts ANY in-period date and normalizes via normalize_to_period_start (no caller math). assemble() builds the tree store-agnostically: roots = exact (horizon, period_key) matches (D-02, siblings all roots — two same-anchor roots need DISTINCT parent_id per GOAL-05), descent follows parent_id across periods (D-03), tasks sorted unscheduled-last (D-05), child_goals scheduled-asc (D-06); visited-set + reused goal.rs MAX_GOAL_DEPTH (now pub(super)) sever cycle/over-depth into anomaly_count, NEVER Err (SC3/D-09). D-07 status policy (MUST be applied identically in the Plan 02 CTE): terminal GOALS kept + traversed THROUGH (ADR-0006 no-cascade); TASKS filtered to OPEN_STATUSES; InMemory loader loads goals with include_archived:true (not list_items hidden-by-default). Persistent loader arm is exactly unimplemented!("Plan 02: persistent CTE loader") for Plan 02 to remove. tree_keys()/seed_goal_tree() reusable by Plan 03 parity; true over-depth/cyclic anomaly fixtures deferred to Plan 03 (service API cannot build >64/cyclic chains).
- [Phase 4 Plan 02]: OPEN_STATUSES promoted to domain/status.rs as the single cross-ring source of truth (re-exported via domain/mod.rs); both the application-ring InMemory loader and the infrastructure-ring CTE loader derive their task-status predicate from it (no literal drift — the Plan 03 parity test's invariant). New TodoRepository::load_period_subtree(horizon: &str, period_key: &str) trait method (ports.rs); SqliteTodoRepository impl uses ONE WITH RECURSIVE CTE: seed `type='goal' AND horizon=?1 AND scheduled=?2` (idx_items_type_horizon_scheduled), recursive `JOIN subtree ON i.parent_id=s.id WHERE i.type IN('goal','task')` (idx_items_parent_id), UNION (not UNION ALL) as SQL cycle guard. Outer WHERE applies the asymmetric D-07 predicate: goals at ANY status (terminal traversed through), tasks `status IN(<OPEN_STATUSES placeholders>)`, tasks NOT filtered by scheduled (VIEW-04). All inputs bound as params (no interpolation, V5.3/T-04-04). Persistent arm of period_view now calls store.load_period_subtree(horizon.as_str(), &period_key); both store arms feed the single shared assemble() (D-11). list_items + schema.rs untouched (D-10 fence). 7 in-memory period_view tests green; clippy clean.
- [Phase 4 Plan 03]: Phase 4 COMPLETE (VIEW-03/VIEW-04 done). Test-only plan locking the Persistent CTE path + cross-store parity + SC3 anomaly safety. persistent_service() copied verbatim from date_view.rs. parity_in_memory_vs_persistent (D-11, MANDATORY): identical seed (live + terminal task under same goal) through both stores -> equal tree_keys() (title,depth,kind, NEVER raw ids) + equal anomaly_count; terminal task absent in BOTH, live present in BOTH (D-07 absence-parity). SC3 anomaly fixtures injected as RAW SQLite rows bypassing validate_goal_nesting: cycle = insert A,B with parent_id NULL then two UPDATEs to form A<->B (UPDATE after both exist satisfies the forward FK a self/mutual insert cannot); orphan = PRAGMA foreign_keys=OFF around a dangling-parent INSERT; over-depth = 65-node chain > MAX_GOAL_DEPTH(64, mirrored as test const). All three return Ok + anomaly_count>=1 (orphan: Ok+no-panic, unreachable so absent, no count), suite TERMINATES (non-hang proof). anomaly_count = one severed child-goal branch in build_node (re-visit cycle OR depth>cap). No InMemory-side anomaly fixture: ServiceStore::InMemory(HashMap) is pub(super)/not test-constructible; raw-SQLite fixture exercises the SAME shared assemble() guard. 13/13 period_view tests green; 60/60 integration; 49/49 unit; clippy clean. Pre-existing repo.rs fmt debt + cli dotenv e2e failure logged to deferred-items (out of scope).
- [Phase 04.1 Plan 01]: anomaly_count over-count fixed (WR-02/IN-01) — root_ids migrated Vec->HashSet (kills O(roots x goals) scan); build_node gains a root_ids: &HashSet param and a `if root_ids.contains(&child.id) { continue; }` short-circuit placed FIRST in the child loop (before visited/depth), so two same-period (D-02 sibling) roots no longer bump the count. Genuine over-depth still counts (depth_cap fixtures). The two byte-identical sort closures collapsed into one free fn schedule_then_created_order; sort_date_view/sort_child_goals delegate via sort_by (byte-identical order). DEVIATION [Rule 1]: cycle_is_severed_no_error fixture asserted the OLD over-count (its "cycle" is two same-period roots); under D-04 a single-parent cycle is only loadable if a cycle node is a period root, and re-visiting a root is correctly not an anomaly — so it now correctly yields anomaly_count==0; the fixture assertion was updated to match the plan's own must-have. period_view 13/13, integration 60/60, unit 49/49, clippy clean.
- [Phase ?]: [Phase 3 Plan 03]: SC4 store parity proven via parity_in_memory_vs_persistent — one seed_fixture run through both in_memory and persistent stores, compared by stable (title, scheduled) key not raw ids. Side-effect-free proven via events().len() unchanged across agenda+date_range. date_view.rs registered first in integration.rs; persistent_service mirrored from goal_view.rs.
- [Phase ?]: [Phase 04.1 Plan 02]: D-01/WR-01 — period-view recursive CTE constrained to goal-parent descent via JOIN items p ON s.id = p.id AND p.type = 'goal' (tests the PARENT row s.id, not child i). For goal->task->goal the CTE working set becomes {G1, T} (G2 dropped, parent is a task), identical to the InMemory frontier walk — D-11 parity now true by construction in SQL, not by an assemble coincidence. Kept WHERE i.type IN('goal','task') (direct-under-goal tasks still load) + the deduplicating UNION cycle guard; no new bound parameter. D-03/WR-03: ports.rs + repo.rs parity docs kept the same-flat-working-set wording (now literally true) and tightened to cite the goal-only descent as enforcement; Path B doc-weakening rejected. D-02 verify-only: rendered output unchanged (G2 was never a rendered node). DEVIATION [Rule 3]: ran cargo fmt on ports.rs/repo.rs to clear pre-existing fmt debt blocking the Task 2 gate. period_view 13/13, integration 60/60, unit 49/49, clippy clean; pre-existing dotenv e2e failure left deferred.
- [Phase 04.1 Plan 03]: Phase 04.1 COMPLETE — Wave-1 fixes regression-locked. MAX_GOAL_DEPTH single-sourced via a `pub const MAX_GOAL_DEPTH = goal::MAX_GOAL_DEPTH;` accessor in service/mod.rs (DEVIATION [Rule 3]: `pub use` of a pub(super) const fails E0364 in Rust 2024; a #[cfg(test)] gate would not reach the integration test crate which links the non-cfg(test) lib — so an ungated accessor binding, NOT a hand-mirrored 64; threat T-04.1-05 accept). Hand-mirrored test const deleted, accessor imported. insert_task_row raw helper added (type='task', open status 'active', no horizon). parity_goal_task_goal_cross_store (D-07/WR-04): raw G1->T->G2 persistent vs in-memory goal->task equivalent — proves G2 (goal under task) does NOT leak under D-01, anomaly parity 0; resolved RESEARCH Open Question 1 via loader-level comparison (option b), no production InMemory test hook (pub(super) ServiceStore boundary unchanged). sibling_root_nesting_is_not_an_anomaly (D-08/WR-02): raw R1(parent None)+R2(parent R1) both (month,2026-06-01) asserts anomaly_count==0 — D-04 over-count regression guard. DEVIATION [Rule 3]: cargo fmt on new fixtures. period_view 15/15, integration 62/62, unit 49/49, lib 2/2, clippy+fmt clean. Pre-existing CLI dotenv e2e failure (init resolves default home not .env TODO_ENGINE_HOME) left deferred (out of scope, logged to deferred-items.md).

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

Last session: 2026-06-25T06:53:58.572Z
Stopped at: Completed 04.1-02-PLAN.md
Resume file: None
