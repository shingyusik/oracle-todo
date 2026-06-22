---
phase: 02-service-policy-goal-create-link-validation
reviewed: 2026-06-22T10:46:14Z
depth: deep
files_reviewed: 11
files_reviewed_list:
  - todo-engine/src/application/service/goal.rs
  - todo-engine/src/application/service/creation.rs
  - todo-engine/src/application/service/update.rs
  - todo-engine/src/application/service/mod.rs
  - todo-engine/src/application/ports.rs
  - todo-engine/src/interfaces/api/handlers.rs
  - todo-engine/src/interfaces/cli/lifecycle.rs
  - todo-engine/src/interfaces/cli/views.rs
  - todo-engine/tests/integration/goal_policy.rs
  - todo-engine/tests/integration/goal_view.rs
  - todo-engine/tests/unit/filter.rs
findings:
  critical: 0
  warning: 4
  info: 4
  total: 8
status: issues
---

# Phase 02: Code Review Report

**Reviewed:** 2026-06-22T10:46:14Z
**Depth:** deep
**Files Reviewed:** 11
**Status:** issues_found

## Summary

Phase 02 adds the `Goal` item type's create/validate/link/view behavior at the
service layer: `propose_goal` with anchor canonicalization, strictly-coarser
parent nesting (with a depth-capped, visited-set ancestor walk), duplicate-triple
rejection, and three new `ListFilter` predicates (`parent_id`, `horizon`,
`scheduled`). The core validation logic is well-structured and the audit/approval
invariants are respected on the create path: every `propose_goal` routes through
`store_item_and_event` and actor-driven status is correct (agent → `proposed`,
user → `approved`). The test suite passes (9 goal tests green) and the new
predicates are proven against the real SQLite-backed `list_items`.

The defects cluster on the **mutation path that is not `propose_goal`**:
`update_item` accepts `parent_id` and `scheduled` for goals but applies none of
the goal invariants (`update_item` only checks parent *type*/non-terminality via
`ensure_relation`). This lets the update path write the exact states
`propose_goal` is designed to forbid — horizon inversion, nesting cycles, and
non-canonical anchors — directly into the canonical store. The phase summary and
the cycle test both lean on this gap deliberately, which makes it an accepted but
under-documented invariant hole rather than an accident. A secondary cluster is
the interface layer: the three new filter fields and `UpdateItem.parent_id` are
hard-wired to `None` at all CLI/API call sites and `propose_goal` is unwired, so
the documented goal surface is currently unreachable from any shipped interface
(deferred to a follow-up sub-phase by plan, but worth tracking).

No critical (security/data-loss-on-normal-path) findings. The warnings are
correctness/invariant gaps that should be closed before the goal surface is wired
to interfaces.

## Warnings

### WR-01: `update_item` lets the goal tree be corrupted — bypasses nesting + anchor invariants

**File:** `todo-engine/src/application/service/update.rs:83-96`
**Issue:** `propose_goal` enforces three invariants (canonical anchor, strictly-coarser
parent horizon, no nesting cycle). `update_item` enforces *none* of them when it
mutates a goal:
- Line 83-86: `parent_id` is validated only by `ensure_relation(.., ItemType::Goal, ..)`,
  which checks the parent is a non-terminal Goal but **not** that the parent horizon
  is strictly coarser, nor that the resulting chain is acyclic. So a user/agent can
  set a `year` goal's parent to a `week` goal, or close a cycle (A→B→A), directly in
  the canonical store. The phase's own test
  (`goal_policy.rs:104-112`) exploits exactly this to manufacture a cyclic edge, and
  `02-02-SUMMARY.md` documents it as intended. The cycle is only ever caught later,
  lazily, if a *new* goal happens to be proposed beneath the bad chain — an already
  cyclic/inverted tree persists undetected.
- Line 94-96 (pre-existing `scheduled` assignment): a goal's `scheduled` can be
  overwritten with a non-canonical or relative value (`"today"`, `2026-02-01` for a
  year goal), violating the GOAL-03 invariant that `propose_goal` strictly rejects.
  README (`README.md:253`) documents this as an engine-wide goal invariant, but the
  update path does not hold it.

This is the highest-value finding: the README and ADR present these as engine
invariants, but they hold only on the create path.

**Fix:** Gate goal-specific re-validation in `update_item` when the target item is a
goal (or when `parent_id`/`scheduled` change on a goal). Reuse the existing helpers:
```rust
let item = self.get(item_id)?;
// ... after applying scheduled/parent_id but before persisting:
if item.item_type == ItemType::Goal {
    let horizon = item.horizon.as_deref()
        .ok_or_else(|| TodoError::Policy("Goal missing horizon".into()))?
        .parse::<Horizon>().map_err(TodoError::Validation)?;
    if let Some(scheduled) = item.scheduled.as_deref() {
        item.scheduled = Some(self.validate_goal_anchor(horizon, scheduled)?);
    }
    self.validate_goal_nesting(item.parent_id.as_deref(), horizon)?;
}
```
If keeping the gap is a deliberate scope deferral, the README/ADR invariant
statements should be qualified ("enforced on create; update re-validation deferred")
so the docs do not over-promise — see also IN-04.

### WR-02: Goal surface is unreachable — new filter fields and `propose_goal` unwired at all interfaces

**File:** `todo-engine/src/interfaces/cli/views.rs:16,18-19`, `todo-engine/src/interfaces/cli/lifecycle.rs:80`, `todo-engine/src/interfaces/api/handlers.rs:170,172-173,212`
**Issue:** Every new field added this phase is hard-coded to `None` at the interface
boundary:
- CLI `list` (`views.rs`): `parent_id: None`, `horizon: None`, `scheduled: None`.
- CLI `update` (`lifecycle.rs:80`) and API `update_item` (`handlers.rs:212`):
  `parent_id: None`.
- API `list_items` (`handlers.rs:170,172-173`): `parent_id/horizon/scheduled: None`.

And `propose_goal`/`ProposeGoal` are not referenced anywhere under
`src/interfaces/` (grep: no matches). Net effect: the goal create surface and all
three new list filters documented in `README.md` (`### Goal`) cannot be exercised
from the CLI or HTTP API. The predicates and struct fields are dead at runtime.
Plans show CLI/API goal-create was deferred to a separate sub-phase, so this is a
known plumbing-ahead state — but it is a real gap between shipped behavior and the
documentation merged in the same phase.

**Fix:** Either (a) wire the CLI/API to populate these fields from request args/query
params and add a goal-create subcommand/handler that calls `propose_goal`, or
(b) until that lands, add a `status:` / "not yet exposed" note next to the README
`### Goal` section so the docs match the shipped surface (the existing status note at
`README.md:332` covers cascade semantics, not interface availability).

### WR-03: Defensive ancestor walk does not re-check horizon monotonicity of ancestors

**File:** `todo-engine/src/application/service/goal.rs:54-88`
**Issue:** `validate_goal_nesting` checks `is_coarser_than` only for the *direct*
parent (line 72-77), then walks the ancestor chain solely for cycle/depth detection
(line 79-88). It does not re-assert that each ancestor edge is strictly coarser.
Combined with WR-01 (update_item can inject an inverted ancestor edge), a new child
goal can be successfully created beneath a chain that already contains a horizon
inversion higher up — the walk traverses it without complaint as long as there is no
cycle and depth ≤ 64. The comment calls the walk a guard "against legacy/cyclic
data," but it only guards cycles, not the inversion class of corrupt data that
WR-01's update path can produce.

**Fix:** During the ancestor walk, carry the previous node's horizon and assert each
step stays strictly coarser as you ascend; reject with a `Policy` error on the first
inverted edge. Lower priority than WR-01 (closing WR-01 removes the primary source of
inverted ancestors), but it hardens the defensive guard to actually cover what its
doc-comment claims.

### WR-04: Duplicate check silently ignores archived/terminal goals — re-create can collide on reactivation

**File:** `todo-engine/src/application/service/goal.rs:108-132`
**Issue:** `ensure_goal_not_duplicate` lists with `ListFilter { item_type:
Some(Goal), ..Default::default() }`, i.e. `include_archived: false`, so the
uniqueness check on the `(horizon, scheduled, parent_id)` triple only considers
non-terminal goals. This is defensible (you can re-plan a period after dropping its
goal), but it is undocumented and has a sharp edge: you can create goal G2 for a
period whose terminal goal G1 already occupies the same triple, then if any later
flow resurrects G1 (or a view joins terminal + active goals by triple), two goals
collide on what README calls the period's identity triple. There is no test covering
the archived-duplicate boundary, so the intended semantics are unverified.

**Fix:** Decide and document the intent. If duplicates against terminal goals are
intentionally allowed, add a one-line code comment plus a test asserting a
new goal for a *dropped* period's triple succeeds. If not, pass
`include_archived: true` to the filter so the triple is globally unique.

## Info

### IN-01: Cycle/inversion validation lives on the create path only, not behind a single reusable guard

**File:** `todo-engine/src/application/service/goal.rs:46-89`, `todo-engine/src/application/service/update.rs:83-86`
**Issue:** The nesting invariant is implemented once in `validate_goal_nesting` but
invoked only from `propose_goal`. Because `update_item` re-implements parent handling
via the generic `ensure_relation`, the two mutation paths have diverged invariant
strength (root cause of WR-01/WR-03). This is a maintainability smell: a future
"reparent goal" feature will repeat the same omission.
**Fix:** Route all goal parent mutations through a single `set_goal_parent`-style
helper that always calls `validate_goal_nesting`, so create and update cannot drift.

### IN-02: `propose_goal` does not trim/validate `title` (consistent with siblings, but noted)

**File:** `todo-engine/src/application/service/creation.rs:139-162`
**Issue:** `propose_goal` accepts an empty/whitespace `title` (no validation), matching
`propose_task`/`propose_project`. Not a regression — flagged only because the anchor
gets careful trim+validation while the user-facing title does not, which is a slight
inconsistency a future validation pass may want to unify across all `propose_*`.
**Fix:** Optional: add shared non-empty `title` validation across `propose_*` if/when
a validation sweep is done. Do not fix in isolation (would diverge from siblings).

### IN-03: Cycle test asserts only the error variant, not the message — weak coverage of which cycle is reported

**File:** `todo-engine/tests/integration/goal_policy.rs:114-117`
**Issue:** `goal_nesting_rejects_horizon_inversion_and_cycle` asserts
`matches!(cycle, TodoError::Policy(_))` but does not assert the message mentions a
cycle. The same test would pass if the rejection came from the unrelated horizon
check or any other `Policy` error, so it does not actually prove the cycle branch
(`goal.rs:63-66`) fired. The terminal/non-goal parent tests (lines 206-212, 248-254)
correctly assert on message substrings — apply the same rigor here.
**Fix:** Assert the message contains `"cycle"`:
```rust
match cycle {
    TodoError::Policy(m) => assert!(m.contains("cycle"), "unexpected: {m}"),
    other => panic!("expected Policy cycle error, got {other:?}"),
}
```

### IN-04: README/ADR present create-path invariants as engine-wide without the update caveat

**File:** `README.md:253-269`, `docs/architecture/decisions/adr-0006-goal-itemstatus-semantics.md`
**Issue:** README states a goal's `scheduled` "is strictly rejected if non-canonical
or relative" and `parent_id` "must point to a strictly-coarser, non-terminal goal"
as flat invariants. Given WR-01, these hold only via `propose_goal`; `update_item`
does not enforce them. Docs over-promise relative to the shipped service behavior.
**Fix:** Add a short caveat ("enforced on goal creation; `update_item` re-validation
is deferred to a follow-up") or — preferred — close WR-01 so the docs become true as
written.

---

_Reviewed: 2026-06-22T10:46:14Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
