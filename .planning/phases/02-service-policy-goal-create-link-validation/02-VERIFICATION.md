---
phase: 02-service-policy-goal-create-link-validation
verified: 2026-06-22T00:00:00Z
status: passed
score: 18/18 must-haves verified
overrides_applied: 0
---

# Phase 2: Service Policy — Goal Create, Link & Validation Verification Report

**Phase Goal:** A user (or agent) can create a period goal, nest goals, and link a dated task to a goal — every path validated and audited through the single `TodoService` mutation path, and the read primitive the views will compose exists.
**Verified:** 2026-06-22
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

ROADMAP Success Criteria (SC1–SC5) are the contract. PLAN frontmatter truths are merged below them as supporting detail.

| #  | Truth | Status | Evidence |
| -- | ----- | ------ | -------- |
| SC1 | Create goal at year/month/week; agent→Proposed, user→Approved; every create writes a TodoEvent audit row | ✓ VERIFIED | `creation.rs:139-162` `propose_goal` builds via `TodoItem::new` (actor→status) and stores via `store_item_and_event(.., "propose_goal", ..)`. Test `agent_goal_is_proposed_user_goal_is_approved_and_audited` passes (asserts Proposed/Approved + `events().last().action == "propose_goal"`). |
| SC2 | Reject unparseable / `"today"` sentinel / non-canonical scheduled anchor with clear error, never silently drop | ✓ VERIFIED | `goal.rs:21-41` `validate_goal_anchor` rejects empty/"today"/unparseable/non-period-start with `TodoError::Validation`; never calls `normalize_to_period_start`. Test `goal_anchor_rejects_today_unparseable_and_non_canonical` (+empty) passes. |
| SC3 | Reject nesting cycle / horizon inversion (finer cannot parent coarser); reject duplicate (horizon, normalized_scheduled, parent_id) | ✓ VERIFIED | `goal.rs:50-103` `validate_goal_nesting` uses strict `is_coarser_than` (rejects equal/inverted) + visited-set/`MAX_GOAL_DEPTH` cycle walk; `goal.rs:109-133` `ensure_goal_not_duplicate` compares the canonical triple. Tests `goal_nesting_rejects_horizon_inversion_and_cycle` and `goal_duplicate_triple_is_rejected` pass. |
| SC4 | Link existing task to goal via `parent_id` and set `scheduled`, both through the audited update path (no bypass) | ✓ VERIFIED | `update.rs:83-86` validates `parent_id` via `ensure_relation(.., ItemType::Goal, "Goal parent")`; `update.rs:94-96` sets `scheduled`; both flow through `store_item_and_event(.., "update_item", ..)`. Tests `link_task_to_goal_sets_parent_and_scheduled_via_audited_path` (+ non-Goal/terminal negatives) pass. |
| SC5 | List goals/tasks filtered by horizon, period, parent; document ItemStatus meaning for goals (no cascade in v1) | ✓ VERIFIED | `ports.rs:18-84` `ListFilter` + `apply_list_filter` filter by horizon/parent_id/scheduled; both `repo.rs:39` (persistent) and `queries.rs:28` (in-memory) delegate. README `### Goal` subsection (line 250) + `## Status lifecycle` note + ADR-0006 record reuse-lifecycle + no-cascade-in-v1. Tests `persistent_list_items_honors_horizon_parent_and_period_filters` and `horizon_parent_and_scheduled_filters_select_expected_rows` pass. |
| T-01a | UpdateItem carries validated non-terminal Goal `parent_id` on the audited path | ✓ VERIFIED | `update.rs:18` field + `:83-86` `ensure_relation` guard. |
| T-01b | ListFilter selects by horizon, parent_id, exact scheduled | ✓ VERIFIED | `ports.rs:26-27` fields + `:73-84` predicates. |
| T-01c | Both in-memory and persistent list_items honor predicates (both delegate to apply_list_filter) | ✓ VERIFIED | `repo.rs:39` and `queries.rs:28` both call `apply_list_filter`; persistent path proven by `goal_view.rs`. |
| T-02a | propose_goal writes propose_goal audit row via store_item_and_event | ✓ VERIFIED | `creation.rs:161`. No `save_item` bypass found. |
| T-02b | Anchor strict-reject, never auto-snap | ✓ VERIFIED | `goal.rs:21-41` (no `normalize_to_period_start` call). |
| T-02c | Strict coarser-than parent + cycle/depth-cap walk | ✓ VERIFIED | `goal.rs:50-103`. |
| T-02d | Duplicate triple rejected with Policy | ✓ VERIFIED | `goal.rs:109-133`. |
| T-03a | Link via update_item{parent_id}+scheduled on audited path; non-Goal/terminal rejected | ✓ VERIFIED | `goal_policy.rs:136-255` (3 tests pass). |
| T-03b | Persistent SQLite filter parity proven | ✓ VERIFIED | `goal_view.rs:32-93` (TodoService::persistent over temp SQLite). |
| T-04a | README documents Goal item type (anchor, nesting, reused lifecycle) | ✓ VERIFIED | README `### Goal` line 250-265. |
| T-04b | Documented ItemStatus meaning for goals incl. no-cascade-in-v1 | ✓ VERIFIED | README `## Status lifecycle` note + ADR-0006. |
| T-04c | ADR captures no-cascade decision + rationale | ✓ VERIFIED | `adr-0006-goal-itemstatus-semantics.md:1,39-42` (Accepted, no-cascade documented). |
| CORE-01 | All goal/link mutations route through TodoService (no direct repo write) | ✓ VERIFIED | `propose_goal` + `update_item` both end at `store_item_and_event`; no `save_item` in either path. |

**Score:** 18/18 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `todo-engine/src/application/service/goal.rs` | anchor/nesting/duplicate helpers + MAX_GOAL_DEPTH | ✓ VERIFIED | 134 lines; 3 `pub(super)` helpers; `MAX_GOAL_DEPTH = 64`; wired by `propose_goal`. |
| `todo-engine/src/application/service/creation.rs` | ProposeGoal + propose_goal | ✓ VERIFIED | `:50-57` struct, `:139-162` method, exported via `mod.rs:18-20`. |
| `todo-engine/src/application/service/update.rs` | UpdateItem.parent_id + Goal guard | ✓ VERIFIED | `:18` field, `:83-86` apply block via `ensure_relation`. |
| `todo-engine/src/application/ports.rs` | ListFilter horizon/parent_id/scheduled + predicates | ✓ VERIFIED | `:26-27`, `:61-84`. |
| `todo-engine/tests/unit/filter.rs` | Unit coverage for new predicates | ✓ VERIFIED | `horizon_parent_and_scheduled_filters_select_expected_rows` passes. |
| `todo-engine/tests/integration/goal_policy.rs` | SC1–SC4 coverage | ✓ VERIFIED | 7 tests, all pass; registered `integration.rs:3-4`. |
| `todo-engine/tests/integration/goal_view.rs` | Persistent VIEW-01 parity | ✓ VERIFIED | 1 test passes; registered `integration.rs:7-8`. |
| `docs/architecture/decisions/adr-0006-goal-itemstatus-semantics.md` | ADR no-cascade decision | ✓ VERIFIED | Exists, 55 lines, status Accepted, cascade documented. |
| `README.md` | Goal item-type + status note | ✓ VERIFIED | `### Goal` subsection + lifecycle note referencing ADR-0006. |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | -- | --- | ------ | ------- |
| `creation.rs propose_goal` | `store_item_and_event` | action `propose_goal` | ✓ WIRED | `creation.rs:161`. |
| `goal.rs validate_goal_anchor` | `is_period_start` | strict canonical check | ✓ WIRED | `goal.rs:34`. |
| `goal.rs validate_goal_nesting` | `Horizon::is_coarser_than` | strict parent ordering | ✓ WIRED | `goal.rs:71`. |
| `update.rs parent_id` | `ensure_relation` (Goal, non-terminal) | type+terminal guard | ✓ WIRED | `update.rs:84-85`. |
| `ports.rs apply_list_filter` | TodoItem horizon/parent_id/scheduled | is_none_or equality | ✓ WIRED | `ports.rs:61-84`. |
| `repo.rs list_items` (persistent) | `apply_list_filter` | delegation | ✓ WIRED | `repo.rs:39`. |
| `queries.rs list_items` (in-memory) | `apply_list_filter` | delegation | ✓ WIRED | `queries.rs:28`. |
| README `## Status lifecycle` | ADR-0006 | no-cascade reference | ✓ WIRED | README links the ADR file. |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| Workspace builds | `cargo build` | Finished, 0 errors | ✓ PASS |
| Full test suite | `cargo test` | lib 2, e2e 29, integration 42, unit 44; 0 failed | ✓ PASS |
| Phase 2 goal tests | (within full run) | 7 goal_policy + 1 goal_view + 1 filter all ok | ✓ PASS |
| Lint gate | `cargo clippy --all-targets --all-features -- -D warnings` | clean | ✓ PASS |
| Format gate | `cargo fmt --check` | clean | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ----------- | ----------- | ------ | -------- |
| GOAL-01 | 02-02 | Create period goal via Goal item type, reusing status/approval/audit | ✓ SATISFIED | `propose_goal` + SC1 test. |
| GOAL-03 | 02-02 | Validate scheduled anchor (reject unparseable/non-canonical) | ✓ SATISFIED | `validate_goal_anchor` + SC2 test. |
| GOAL-04 | 02-02 | Nest via parent_id with level-skipping; reject cycles/inversion | ✓ SATISFIED | `validate_goal_nesting` (strict `is_coarser_than` allows level-skip via rank) + SC3a test. |
| GOAL-05 | 02-02 | Reject duplicate (horizon, scheduled, parent_id) | ✓ SATISFIED | `ensure_goal_not_duplicate` + SC3b test. |
| LINK-01 | 02-01, 02-03 | Link task to goal via parent_id | ✓ SATISFIED | `update.rs` parent_id guard + SC4 positive/negative tests. |
| LINK-02 | 02-03 | Set task scheduled date | ✓ SATISFIED | `update.rs:94-96` + SC4 positive test asserts scheduled. |
| VIEW-01 | 02-01, 02-03, 02-04 | List filtered by horizon/period/parent (+ doc ItemStatus) | ✓ SATISFIED | ListFilter predicates, both backends, persistent test + SC5 docs. |
| CORE-01 | 02-02 | All mutations route through TodoService, no direct repo write | ✓ SATISFIED | propose_goal + update_item both via store_item_and_event; no save_item. |

All 8 phase requirement IDs accounted for. REQUIREMENTS.md maps exactly GOAL-01/03/04/05, LINK-01/02, VIEW-01, CORE-01 to Phase 2 (all marked Complete) — no orphaned requirements.

### Anti-Patterns Found

None. No `TODO`/`FIXME`/`XXX`/`TBD`/`HACK`/`unimplemented!`/`todo!`/placeholder markers in the phase-modified source (`goal.rs`, `creation.rs`, `update.rs`, `ports.rs`). The `None` literals set at CLI/API call sites (02-01 SUMMARY) are intentional, roadmap-scheduled deferrals to the Phase 5 surface (SURF-01/02) — they hardcode no user-visible data and do not affect the service-layer read primitive that VIEW-01 requires.

### Human Verification Required

None. All five success criteria are verifiable programmatically and proven by passing automated tests; the SC5 documentation deliverable was content-checked directly (the planner's deferred `<human-check>` items for README/ADR readability are non-blocking copy-review of accurate, verified-against-code prose).

### Gaps Summary

No gaps. The phase goal is fully achieved: goal create, nesting (with cycle/inversion/duplicate guards), and task→goal linking all route through the single audited `TodoService` mutation path (`store_item_and_event`), with strict anchor validation that never auto-snaps. The VIEW-01 read primitive (`ListFilter` horizon/parent_id/scheduled) works against BOTH the in-memory (`queries.rs`) and persistent SQLite (`repo.rs`) list paths via the shared `apply_list_filter`, proven by an in-memory unit test and a persistent-store integration test. Build, full test suite, clippy, and fmt all green.

---

_Verified: 2026-06-22_
_Verifier: Claude (gsd-verifier)_
