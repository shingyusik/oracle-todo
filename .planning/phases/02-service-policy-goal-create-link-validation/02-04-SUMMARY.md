---
phase: 02-service-policy-goal-create-link-validation
plan: 04
subsystem: docs
tags: [docs, adr, goal, itemstatus, planning-layer]
dependency_graph:
  requires: ["02-02"]
  provides: ["goal-itemstatus-docs", "adr-0006"]
  affects: ["phase-4-period-view-rollup"]
tech_stack:
  added: []
  patterns: ["ADR house style (status/context/decision/consequences)", "README item-type subsection + status-lifecycle note"]
key_files:
  created:
    - docs/architecture/decisions/adr-0006-goal-itemstatus-semantics.md
  modified:
    - README.md
decisions:
  - "Goal reuses the ItemStatus lifecycle unchanged; no goal-specific states (health states deferred to v2 as derived signals)"
  - "Goal is active for its period once activated; activate has no Goal-specific precondition in v1"
  - "Terminal goal status (completed/dropped/cancelled) does NOT cascade to child goals or linked tasks in v1; only routine->generated-tasks cascades"
metrics:
  duration_min: 1
  completed: 2026-06-22
  tasks: 2
  files: 2
requirements: [VIEW-01]
---

# Phase 2 Plan 04: Goal ItemStatus & Goals Docs Summary

Recorded the SC5 documentation deliverable: a README `### Goal` item-type subsection plus a `## Status lifecycle` goal note, and ADR-0006 capturing the goal `ItemStatus` semantics and the no-cascade-in-v1 decision, so no later phase (especially the Phase 4 rollup) re-litigates goal status meaning.

## What Was Built

- **README `### Goal` subsection** (under `## Item types`, after `### Event`): describes a goal as a period plan anchored by `(horizon, scheduled)`; canonical period start required (Jan 1 / the 1st / ISO Monday) with strict reject and no auto-snap; no `today` sentinel (unlike tasks); strictly-coarser `parent_id` nesting with level-skipping allowed; agent → `proposed`, user → `approved`. Includes a "Required / useful columns" table mirroring the Task/Project tables (`id`, `type`, `title`, `status`, `horizon`, `scheduled`, `parent_id`, `note`, `proposed_by`, `approved_by`/`approved_at`).
- **README `## Status lifecycle` goal note**: a goal reuses the single `ItemStatus` lifecycle unchanged (no goal-specific states); `active` for its period; `completed`/`dropped`/`cancelled` user-driven and terminal; reaching terminal does NOT cascade to child goals or linked tasks in v1 (only cascade is routine → generated tasks). Links to ADR-0006.
- **ADR-0006** (`docs/architecture/decisions/adr-0006-goal-itemstatus-semantics.md`): mirrors the existing ADR house style (Status / Context / Decision / Consequences). Records reuse-lifecycle + no-new-states + no-cascade-in-v1 with rationale (rollup/health are v2; non-cascading terminal avoids accidental mass-completion and keeps the Phase 4 period view structure-only). Status `Accepted`, dated 2026-06-22.

## Tasks Completed

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | Add Goal item-type subsection + goal status note to README | 8f253f4 | README.md |
| 2 | Write ADR-0006 (goal ItemStatus + no-cascade decision) | addeaba | docs/architecture/decisions/adr-0006-goal-itemstatus-semantics.md |

## Verification

- Task 1 automated: `grep` confirms the README `### Goal` subsection mentions `horizon` and the `## Status lifecycle` note mentions `cascade`. PASS.
- Task 2 automated: ADR-0006 file exists and mentions `cascade` (outside headings). PASS.
- key_links: README `## Status lifecycle` references `docs/architecture/decisions/adr-0006-goal-itemstatus-semantics.md` (`grep -c` = 1). PASS.
- `cargo test` / `cargo fmt --check` / `clippy` unaffected — this plan changed only Markdown (README + ADR), no Rust source.

## Deviations from Plan

None - plan executed exactly as written.

## Notes

- Docs describe only behavior implemented in 02-02 (strict canonical reject, no `today` for goals, strictly-coarser `parent_id`, no cascade). No v2 scope (rollup, health states) was invented — consistent with threat T-02-11 (accept: docs must not over-promise).
- The `readme-structure-guard` skill SKILL.md in this repo currently describes a different project template (CAE Agent), not the todo-engine README. Its core rule was still honored: no new top-level `##` heading was added — the Goal content lives inside the existing `## Item types` section and the status note inside the existing `## Status lifecycle` section, current-state prose only.

## Self-Check: PASSED

- FOUND: docs/architecture/decisions/adr-0006-goal-itemstatus-semantics.md
- FOUND: .planning/phases/02-service-policy-goal-create-link-validation/02-04-SUMMARY.md
- FOUND: commit 8f253f4 (Task 1 README)
- FOUND: commit addeaba (Task 2 ADR-0006)
