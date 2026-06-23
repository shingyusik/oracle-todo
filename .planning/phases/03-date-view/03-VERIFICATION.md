---
phase: 03-date-view
verified: 2026-06-23T09:32:06Z
status: passed
score: 4/4 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: none
  previous_score: none
---

# Phase 03: Date View Verification Report

**Phase Goal:** A user can see what is on a given day or date range, with nothing silently dropped — the cheaper, flat half of Core Value, computed in the service so CLI and API will agree.
**Verified:** 2026-06-23T09:32:06Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Tasks grouped by `scheduled` for a single day AND an arbitrary `[from, to]` range, deterministic ordering | ✓ VERIFIED | `date_range` (queries.rs:76-84) retains `iso_day(scheduled) ∈ [from,to]` inclusive then `sort_date_view` (queries.rs:113-123) orders scheduled-asc → created_at → id. Unit test `range_orders` (date_view.rs:49-63) passes with a same-day tie-break asserting exact order `[early, tie_a, tie_b, late]`. Single-day grouping covered by `agenda`. |
| 2 | Tasks with no `scheduled` appear in an explicit "unscheduled" bucket, never omitted | ✓ VERIFIED | `sort_date_view` keys `is_none()` first so unscheduled (None / "today" sentinel / junk) sort LAST, never dropped (queries.rs:117-119). `iso_day` collapses None/sentinel/junk to None without erroring (queries.rs:106-108). Unit test `unscheduled_never_dropped` (date_view.rs:71-124) asserts all 5 rows present and the 3 unscheduled rows occupy the tail — passes. |
| 3 | For a given date, agenda surfaces both scheduled-that-day and due-that-day tasks (scheduled ∪ due) | ✓ VERIFIED | `agenda` (queries.rs:60-69) retains `iso_day(scheduled)==Some(day) OR iso_day(due)==Some(day)`, single date dedups by id. Unit `agenda_union_dedup` (date_view.rs:128-149) + integration `persistent_agenda_unions_scheduled_and_due_open_tasks` (date_view.rs:90-116) both pass, including both-match-appears-once assertion. |
| 4 | View logic lives in `application/service/queries.rs`, side-effect-free (no routine materialization), identical regardless of caller | ✓ VERIFIED | All logic in `queries.rs`; composes `list_items` (queries.rs:89-98), no `materialize_routines` and no overdue-roll (`grep -c` = 0). Integration `agenda_is_side_effect_free` (date_view.rs:141-152) asserts `events().len()` unchanged; `parity_in_memory_vs_persistent` (date_view.rs:159-174) asserts identical ordered (title,scheduled) keys across in-memory and SQLite for both methods. Both pass. |

**Score:** 4/4 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
| --- | --- | --- | --- |
| `todo-engine/src/application/service/queries.rs` | agenda + date_range + iso_day/sort_date_view/open_tasks + OPEN_STATUSES | ✓ VERIFIED | All present (lines 10-14, 60-69, 76-84, 89-98, 106-108, 113-123). Substantive, wired, builds clean. |
| `todo-engine/tests/unit/date_view.rs` | SC1/SC2/SC3/D-05/D-06 oracles (≥60 lines) | ✓ VERIFIED | 224 lines, 5 tests `range_orders`/`unscheduled_never_dropped`/`agenda_union_dedup`/`open_only`/`no_overdue_roll`, all pass. |
| `todo-engine/tests/unit.rs` | `mod date_view` registration | ✓ VERIFIED | Lines 5-6 register the module; discovered by the unit binary. |
| `todo-engine/tests/integration/date_view.rs` | SC4 parity + side-effect-free (≥40 lines) | ✓ VERIFIED | 174 lines, 4 tests incl. `parity_in_memory_vs_persistent`, all pass. |
| `todo-engine/tests/integration.rs` | `mod date_view` registration | ✓ VERIFIED | Lines 1-2 register the module; discovered by the integration binary. |

### Key Link Verification

| From | To | Via | Status | Details |
| --- | --- | --- | --- | --- |
| agenda/date_range | `list_items(ListFilter{item_type: Task})` | compose-on-list_items, no store branch | ✓ WIRED | `open_tasks` (queries.rs:89-98) composes `list_items`; no InMemory/Persistent branch in date-view code. |
| agenda/date_range | `super::parse_day` | ISO param parse (Validation on junk) | ✓ WIRED | queries.rs:61, 77 call `parse_day`; verified `pub(super) fn parse_day` exists at mod.rs:222. |
| tests/integration/date_view.rs | `TodoService::persistent` over tempfile SQLite | persistent_service() mirrored from goal_view.rs | ✓ WIRED | date_view.rs:10-17. |
| tests/integration/date_view.rs | `service.events().len()` | before/after side-effect-free capture | ✓ WIRED | date_view.rs:148, 151. |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| --- | --- | --- | --- |
| Unit oracles green | `cargo test --test unit date_view` | 5 passed; 0 failed | ✓ PASS |
| Integration oracles green | `cargo test --test integration date_view` | 4 passed; 0 failed | ✓ PASS |
| No materialization / overdue roll | `grep -c 'materialize_routines\|scheduled <= ' queries.rs` | 0 | ✓ PASS |
| Lint gate | `cargo clippy --all-targets --all-features -- -D warnings` | exit 0 | ✓ PASS |
| Format gate | `cargo fmt --check` | clean | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| --- | --- | --- | --- | --- |
| VIEW-02 | 03-01, 03-02, 03-03 | Date view: tasks grouped by scheduled for single day + range; unscheduled bucket not dropped | ✓ SATISFIED | SC1 + SC2 verified; `date_range`, `sort_date_view`, `range_orders`, `unscheduled_never_dropped`. REQUIREMENTS.md maps VIEW-02 → Phase 3. |
| VIEW-05 | 03-01, 03-02, 03-03 | Agenda spanning scheduled + due for a given date | ✓ SATISFIED | SC3 verified; `agenda` union+dedup, `agenda_union_dedup`, `persistent_agenda_unions...`. REQUIREMENTS.md maps VIEW-05 → Phase 3. |
| CORE-03 | 03-01 (frontmatter only) | New view logic lives in service layer shared by CLI/API | ⚠ SATISFIED (principle), MAPPED TO PHASE 5 | The shared-service-layer principle is demonstrably met (SC4 parity proven). However REQUIREMENTS.md traceability maps CORE-03 → Phase 5, not Phase 3. Plan 03-01 lists CORE-03 in `requirements`/`requirements-completed`. Not in this phase's assigned IDs (VIEW-02, VIEW-05). See Note below — informational, not a gap. |

Assigned phase requirement IDs (VIEW-02, VIEW-05) are fully accounted for and satisfied. No orphaned Phase-3 requirements in REQUIREMENTS.md.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| --- | --- | --- | --- | --- |
| (none) | — | — | — | No debt markers (TODO/FIXME/XXX/HACK/PLACEHOLDER) in any phase-modified file; no stubs; no empty returns; no materialization call; no overdue roll. |

### Code Review Cross-Reference (03-REVIEW.md)

The standard code review reported 0 critical, 4 warnings, 2 info. None block goal achievement; all are robustness / test-coverage observations on edge cases outside the four success criteria:
- WR-01: `date_range` silently accepts inverted range (`from > to`) → returns empty Ok. Behavior is reasonable; not a goal blocker.
- WR-02: junk-date → `TodoError::Validation` contract documented but not test-covered. Implementation is correct (parse_day propagates); only the test is missing.
- WR-03: asymmetric date parsing (params strict, item fields leading-10-char) undocumented/untested. Intentional per design.
- WR-04: `date_range` inclusive-boundary (equal bounds / single-day) not directly tested. Implementation uses `<=` correctly.
- IN-01/IN-02: OPEN_STATUSES duplication; iso_day re-parse in comparator (post-v1 perf). Informational.

These are quality-improvement suggestions for the developer, not failures of the phase goal.

### Human Verification Required

None. The phase produces a service-layer read primitive with no UI, no real-time behavior, and no external integration. All behavior is deterministically asserted by the unit + integration suites, which the verifier ran (9/9 green). No `<verify><human-check>` blocks were declared in the plans.

### Gaps Summary

No gaps. All four ROADMAP success criteria are observably true in the codebase and confirmed by 9 passing tests run during verification. The implementation is substantive (not a stub), wired (composes `list_items`, no store branch), side-effect-free (events().len() unchanged), and store-agnostic (cross-store parity proven by stable key). Both assigned requirement IDs (VIEW-02, VIEW-05) are satisfied.

**Note on CORE-03 (non-blocking):** Plan 03-01 frontmatter declares and claims-complete CORE-03, but REQUIREMENTS.md traceability maps CORE-03 to Phase 5. This is a documentation/scope-attribution discrepancy, not a missing deliverable — the CORE-03 principle (shared service-layer view logic for CLI/API parity) is genuinely demonstrated here. CORE-03's formal closure belongs to Phase 5 (CLI/API surface). The verifier flags this so the developer can decide whether to (a) leave CORE-03 attributed to Phase 5 in REQUIREMENTS.md, or (b) update plan frontmatter to drop the premature `requirements-completed` claim. It does not affect this phase's pass status.

---

_Verified: 2026-06-23T09:32:06Z_
_Verifier: Claude (gsd-verifier)_
