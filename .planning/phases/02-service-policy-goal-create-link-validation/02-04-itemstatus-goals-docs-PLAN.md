---
phase: 02-service-policy-goal-create-link-validation
plan: 04
type: execute
wave: 2
depends_on: ["02-02"]
files_modified:
  - README.md
  - docs/architecture/decisions/adr-0006-goal-itemstatus-semantics.md
autonomous: true
requirements: [VIEW-01]
must_haves:
  truths:
    - "README documents a Goal item type (its (horizon, scheduled) anchor, parent_id nesting, and reused status lifecycle)"
    - "The documented ItemStatus meaning for goals is recorded: a goal is Active for its period; Completed/Dropped/Cancelled are user-driven and terminal; reaching a terminal status does NOT cascade to child goals or linked tasks in v1"
    - "An ADR captures the no-cascade decision and its rationale (the only existing cascade is routine→generated-tasks, which does not apply to goals)"
  artifacts:
    - path: "docs/architecture/decisions/adr-0006-goal-itemstatus-semantics.md"
      provides: "ADR recording the goal ItemStatus semantics + no-cascade-in-v1 decision"
      contains: "cascade"
    - path: "README.md"
      provides: "Goal item-type subsection under ## Item types + goal status note under ## Status lifecycle"
      contains: "Goal"
  key_links:
    - from: "README.md ## Status lifecycle"
      to: "docs/architecture/decisions/adr-0006-goal-itemstatus-semantics.md"
      via: "the no-cascade decision is summarized in README and detailed in the ADR"
      pattern: "cascade"
---

<objective>
Deliver the SC5 documentation half: record the `ItemStatus` meaning for goals so no later phase (especially the Phase 4 rollup) re-litigates it. Add a `### Goal` subsection to the README `## Item types` section (mirroring the existing `### Task`/`### Project` subsections), a goal-status note under `## Status lifecycle`, and an ADR (`adr-0006`) capturing the decision: a goal reuses the existing `ItemStatus` lifecycle unchanged; it is `Active` for its period; `Completed`/`Dropped`/`Cancelled` are user-driven and terminal; reaching terminal does NOT cascade to child goals or linked tasks in v1.

Purpose: STATE.md flags this as a Phase 2 documentation blocker. It depends on 02-02 having defined the create/status behavior so the docs are accurate. Use the `docs-tools` skill (docs follow code).
Output: Updated README and a new ADR recording the goal status semantics + no-cascade rule.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/02-service-policy-goal-create-link-validation/02-RESEARCH.md
@README.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add the Goal item-type subsection + goal status note to README</name>
  <files>README.md</files>
  <read_first>
    - README.md (the `## Item types` section starting line 104 — the `### Task` subsection at lines 152-178 and `### Project` at 128-150 are the exact subsection shape, including the "Required / useful columns" table; the `## Status lifecycle` section at line 288; the `### Routine` cascade behavior is the only existing cascade for contrast)
    - .planning/phases/02-service-policy-goal-create-link-validation/02-RESEARCH.md (the "## ItemStatus-for-Goals Decision (SC5 deliverable)" section — the exact documented semantics to record)
    - .claude/plugins/docs-tools/skills (use the docs-change-updater + readme-structure-guard skills so the README structure stays consistent)
  </read_first>
  <action>
    Use the `docs-tools` skill. Add a `### Goal` subsection under `## Item types` (place it after `### Event`, keeping the existing subsection ordering style). Describe a Goal as: a period planning item anchored by `(horizon, scheduled)` where `scheduled` must be the canonical period start (year = Jan 1, month = 1st, week = ISO Monday) and is strictly rejected if non-canonical or relative (no `today` sentinel — unlike tasks); nestable under a strictly-coarser parent goal via `parent_id`; agent-created → `proposed`, user-created → `approved`. Include a "Required / useful columns" table mirroring the Task/Project tables, with rows for `id`, `type` (always `goal`), `title`, `status`, `horizon` (`year`/`month`/`week`), `scheduled` (canonical period start), `parent_id` (optional, must point to a strictly-coarser non-terminal goal), `note`, `proposed_by`, `approved_by`/`approved_at`.
    Add a short goal-status note under `## Status lifecycle`: a goal reuses the single `ItemStatus` lifecycle unchanged (no goal-specific states — out of scope); it is meaningfully `active` for its period once activated; `completed`/`dropped`/`cancelled` are user-driven and terminal; reaching a terminal status does NOT cascade to child goals or linked tasks in v1 (the only existing cascade is routine→generated-tasks, which does not apply to goals). Link to the ADR added in Task 2.
    Do NOT invent scope beyond what 02-02 implemented (no rollup, no health states — those are v2).
  </action>
  <verify>
    <automated>cd "D:/02_Area/oracle-todo" && grep -A40 '^### Goal' README.md | grep -v '^#' | grep -qi 'horizon' && grep -A20 '^## Status lifecycle' README.md | grep -v '^#' | grep -qi 'cascade'</automated>
    <human-check>Read the new README `### Goal` subsection and the `## Status lifecycle` goal note. Confirm they match the implemented behavior (canonical anchor, strict reject, no `today`, strictly-coarser parent, no cascade in v1) and read consistently with the surrounding item-type subsections.</human-check>
  </verify>
  <acceptance_criteria>
    - README has a `### Goal` subsection under `## Item types` with a columns table covering `horizon`, `scheduled`, `parent_id`.
    - `## Status lifecycle` records the goal status semantics and the no-cascade-in-v1 rule.
    - README structure stays consistent (verified via the `readme-structure-guard` skill).
  </acceptance_criteria>
  <done>README documents the Goal item type and its ItemStatus semantics including the no-cascade rule.</done>
</task>

<task type="auto">
  <name>Task 2: Write ADR-0006 recording the goal ItemStatus + no-cascade decision</name>
  <files>docs/architecture/decisions/adr-0006-goal-itemstatus-semantics.md</files>
  <read_first>
    - docs/architecture/decisions/adr-0003-approval-gating.md (the ADR format/structure to mirror: context, decision, consequences)
    - docs/architecture/decisions/adr-0005-recurrence-pattern-parsing.md (a second recent ADR for the house style)
    - .planning/phases/02-service-policy-goal-create-link-validation/02-RESEARCH.md (the "## ItemStatus-for-Goals Decision" section — the verified semantics, including that `activate` has no Goal branch so a goal activates with no extra precondition, and that the only existing cascade is routine→generated-tasks at transitions.rs:231)
  </read_first>
  <action>
    Create `docs/architecture/decisions/adr-0006-goal-itemstatus-semantics.md`, mirroring the existing ADR structure (title/status/context/decision/consequences). Record the decision: a `Goal` reuses the existing `ItemStatus` lifecycle with NO new states (goal-specific health states like `on_track`/`at_risk` are explicitly out of scope, deferred to v2 as derived signals); a goal is `active` for its period once activated (the `activate` path has no Goal-specific precondition in v1); `completed`/`dropped`/`cancelled` are user-driven terminal states; and crucially, a goal reaching a terminal status does NOT cascade completion/drop to its child goals or linked tasks in v1 — the only cascade in the engine is routine→generated-tasks, which does not apply to goals. Note the rationale (rollup/health are v2; keeping terminal non-cascading avoids accidental mass-completion and keeps the period view structure-only in Phase 4). Set status `Accepted`, dated 2026-06-22.
  </action>
  <verify>
    <automated>cd "D:/02_Area/oracle-todo" && test -f docs/architecture/decisions/adr-0006-goal-itemstatus-semantics.md && grep -v '^#' docs/architecture/decisions/adr-0006-goal-itemstatus-semantics.md | grep -qi 'cascade'</automated>
    <human-check>Read ADR-0006 and confirm it states the no-cascade-in-v1 decision, the no-new-states decision, and the rationale, in the same structure as the other ADRs.</human-check>
  </verify>
  <acceptance_criteria>
    - `docs/architecture/decisions/adr-0006-goal-itemstatus-semantics.md` exists, follows the ADR house style, and records the reuse-lifecycle + no-new-states + no-cascade-in-v1 decisions with rationale.
    - The README `## Status lifecycle` note (Task 1) references this ADR.
  </acceptance_criteria>
  <done>ADR-0006 captures the goal ItemStatus semantics and the no-cascade-in-v1 decision.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| (none — documentation-only) | This plan modifies only README and an ADR; it introduces no code, input, or trust boundary |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-02-11 | Information Disclosure | docs accidentally over-promising behavior | accept | Docs describe only behavior implemented in 02-02 (strict reject, no cascade); the `<human-check>` confirms accuracy. No code/runtime threat — documentation-only plan. |
</threat_model>

<verification>
- `grep` confirms the README `### Goal` subsection mentions `horizon` and the `## Status lifecycle` note mentions `cascade`.
- The ADR file exists and mentions the cascade decision.
- Human-check confirms accuracy and consistency against the implemented behavior.
- `cargo test` remains green (docs-only — no code change), `cargo fmt --check`/`clippy` unaffected.
</verification>

<success_criteria>
- README documents the Goal item type (anchor, nesting, reused status lifecycle) and the goal ItemStatus semantics including no-cascade-in-v1 (SC5 doc deliverable).
- ADR-0006 records the decision with rationale, referenced from the README.
- Docs are accurate to the 02-02 implementation (no invented v2 scope).
</success_criteria>

<output>
Create `.planning/phases/02-service-policy-goal-create-link-validation/02-04-SUMMARY.md` when done.
</output>
