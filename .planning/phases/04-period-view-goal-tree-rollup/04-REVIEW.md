---
phase: 04-period-view-goal-tree-rollup
reviewed: 2026-06-25T03:37:37Z
depth: standard
files_reviewed: 9
files_reviewed_list:
  - todo-engine/src/application/ports.rs
  - todo-engine/src/application/service/goal.rs
  - todo-engine/src/application/service/mod.rs
  - todo-engine/src/application/service/queries.rs
  - todo-engine/src/domain/mod.rs
  - todo-engine/src/domain/status.rs
  - todo-engine/src/infrastructure/sqlite/repo.rs
  - todo-engine/tests/integration.rs
  - todo-engine/tests/integration/period_view.rs
findings:
  critical: 0
  warning: 4
  info: 3
  total: 7
status: issues_found
---

# Phase 4: Code Review Report

**Reviewed:** 2026-06-25T03:37:37Z
**Depth:** standard
**Files Reviewed:** 9
**Status:** issues_found

## Summary

Reviewed the phase-04 period-view goal-tree rollup: the store-agnostic `assemble()` /
`build_node()` tree walk and InMemory loader (`queries.rs`), the SQLite `WITH RECURSIVE`
CTE loader (`repo.rs`), the shared `OPEN_STATUSES` predicate source (`status.rs`), the
`load_period_subtree` port (`ports.rs`), and the cross-store parity + anomaly fixtures
(`period_view.rs`).

Headline assessments against the called-out risk areas:

- **SQL injection (CTE): clean.** No value is interpolated. `item_select_sql` only splices a
  caller-built `suffix`, and that suffix's only dynamic content is a `?N` placeholder list
  whose length is derived from `OPEN_STATUSES.len()` (an integer count). `horizon`,
  `period_key`, and the status strings are all bound (`?1`, `?2`, `?3..`). No `BLOCKER` here.
- **Cycle / depth-cap correctness: sound on the happy and cyclic paths.** The SQL `UNION`
  (deduplicating) bounds the load against `parent_id` back-edges; the in-memory
  `visited`-set + `MAX_GOAL_DEPTH` cap in `build_node` bounds the walk. The depth boundary
  arithmetic (`depth + 1 > MAX_GOAL_DEPTH`, root at depth 1) is correct and the persistent
  65-node fixture exercises it.
- **D-07 status parity: correct for the cases the tests exercise**, but the two loaders
  diverge in *working-set construction* on adversarial `goal -> task -> goal` linkage (see
  WR-01). The rendered tree stays equal in that case, but the divergence is real and the
  parity test does not cover it.
- **Architecture boundaries: adhered.** `domain/` does no I/O; the CTE lives in
  `infrastructure/`; `assemble` is store-agnostic in `application/`. Dependencies point
  inward. No `BLOCKER`/`WARNING` on layering.

No BLOCKER-tier defects were found. Four WARNINGs (observable anomaly over-count, a
cross-store working-set divergence, an over-stated parity claim, and a parity-test coverage
gap) and three INFO items follow.

## Narrative Findings (AI reviewer)

## Warnings

### WR-01: In-memory and CTE loaders build different working sets through a task-parented goal (D-11 divergence)

**File:** `todo-engine/src/application/service/queries.rs:206-234` and `todo-engine/src/infrastructure/sqlite/repo.rs:81-94`
**Issue:** The two loaders are documented as producing the *same flat working set* so the
shared `assemble()` cannot drift (ports.rs:11-18, repo.rs:43-58, "the two stores cannot
drift"). They do not, on adversarial/legacy linkage:

- The **CTE recursive step** traverses *through tasks*: `JOIN subtree s ON i.parent_id = s.id WHERE i.type IN ('goal', 'task')`.
  Given `goal G1 (root) -> task T -> goal G2`, the subtree becomes `{G1, T, G2}` — `G2` is
  pulled in because its parent `T` is already in the subtree.
- The **in-memory frontier walk** only ever inserts *goals* into `frontier` (the expansion
  loop at queries.rs:206-222 iterates `all_goals` and tasks are appended afterward at
  queries.rs:230-234, never seeded into `frontier`). So `G2`, whose parent is a task, is
  never reachable and the in-memory working set is `{G1, T}` — `G2` absent.

The two flat working sets are therefore *not* identical, contradicting the D-11 invariant
asserted across the port docs. In this specific shape the *rendered* tree happens to stay
equal (`assemble` only descends goal→goal via `goals_by_parent.get(&Some(goal.id))`, so the
task `T` is never a node and `G2` is unreachable in both paths), but relying on that
coincidence is fragile: any future change to `assemble` that begins indexing tasks as
intermediate parents would surface the divergence as a real tree-shape difference between
stores. The "produce the SAME flat working set" contract is currently false.
**Fix:** Make the CTE recursive step stop traversing through tasks so both loaders agree on
the flat set, e.g. constrain the recursion to goal parents:
```sql
SELECT i.id FROM items i
JOIN subtree s ON i.parent_id = s.id
JOIN items p ON s.id = p.id AND p.type = 'goal'   -- only descend through goals
WHERE i.type IN ('goal', 'task')
```
Alternatively, weaken the port/doc contract to "produce the same *rendered tree*", and add a
parity fixture for the `goal -> task -> goal` shape (see WR-04) so the claim is enforced.

### WR-02: Valid D-02 sibling-root nesting is reported as an anomaly (anomaly_count over-count)

**File:** `todo-engine/src/application/service/queries.rs:322-341, 368-372`
**Issue:** `assemble` pre-marks every root as `visited` (queries.rs:325-327) so a goal that is
both a period root *and* a child of another root stays a top-level sibling (intended D-02
dedup). But in `build_node`, that same goal is encountered in its parent's `goals_by_parent`
bucket, fails `visited.insert(child.id)` (queries.rs:369), is severed, and bumps
`anomaly_count` (queries.rs:371). The result: a *structurally valid* D-02 configuration
(root R2 whose `parent_id` is another root R1, both exact period matches) reports
`anomaly_count >= 1` even though nothing is cyclic, orphaned, or over-deep. `anomaly_count`
is a public field on `PeriodView` (SC3 surfaces it to callers/UI), so this conflation is
observable: a clean tree can report a nonzero anomaly count. This shape is reachable via
raw/legacy rows (the service's strictly-coarser nesting rule prevents two same-period goals
from being parent/child, but the anomaly fixtures exist precisely to model raw data).
**Fix:** Distinguish "already a sibling root" from a genuine cycle. Skip the bump when the
re-visited child is itself a root, e.g. thread the `root_ids` set into `build_node` and
`continue` *without* incrementing `anomaly_count` when `root_ids.contains(&child.id)`:
```rust
if root_ids.contains(&child.id) {
    continue; // already emitted as a top-level sibling root (D-02), not an anomaly
}
if depth + 1 > MAX_GOAL_DEPTH || !visited.insert(child.id.clone()) {
    *anomaly_count += 1;
    continue;
}
```

### WR-03: Port/repo docs over-state the parity guarantee ("the two stores cannot drift")

**File:** `todo-engine/src/application/ports.rs:11-18`, `todo-engine/src/infrastructure/sqlite/repo.rs:43-63`
**Issue:** The docs assert the loaders are "fed unchanged to the shared `assemble()` walk, so
the Persistent and InMemory stores produce identical tree shape (D-11)" and "the two stores
cannot drift". WR-01 shows a concrete input (`goal -> task -> goal`) where the *flat working
sets* differ, so the stated mechanism ("produce the SAME flat working set") is not actually
what guarantees parity — parity currently survives only by an `assemble` implementation
detail. Doc comments that assert an invariant the code does not enforce are a maintenance
hazard: a reader will trust the contract and build on it.
**Fix:** Either implement WR-01's CTE fix (making the contract true), or revise these doc
blocks to state the *actual* guarantee (identical rendered tree, not identical working set)
and reference the `assemble` goal-only descent as the reason.

### WR-04: Parity test does not cover the working-set divergence it claims to guard

**File:** `todo-engine/tests/integration/period_view.rs:391-425`
**Issue:** `parity_in_memory_vs_persistent` is documented as the "MANDATORY cross-store
parity" guard, but its fixture (`seed_with_terminal_and_live_task`) only exercises clean
goal→goal→goal nesting plus task status visibility. It never injects the `goal -> task -> goal`
shape (or any task-as-intermediate-parent), which is exactly where WR-01's working-set
divergence lives. The test therefore cannot fail on the one cross-store difference that
actually exists, giving false confidence in the D-11 claim. (This is in-scope per the review
rules: a test gap that lets a real defect pass undetected affects test reliability.)
**Fix:** Add a raw-injection parity fixture that builds `goal(root) -> task -> goal` (via
`insert_goal_row` + a raw task insert with `parent_id` = the task) and assert
`tree_keys(mem) == tree_keys(disk)` AND `anomaly_count` equality. With the current code this
either passes (proving the rendered-tree claim) or exposes the divergence — either way the
contract becomes enforced rather than assumed.

## Info

### IN-01: `assemble` root re-collection is O(n^2) via `Vec::contains`

**File:** `todo-engine/src/application/service/queries.rs:313-318`
**Issue:** `root_ids: Vec<String>` is queried with `root_ids.contains(&goal.id)` inside a
`.filter(...)` over every goal, an O(roots * goals) scan. Performance is out of v1 review
scope, but flagged because it is a trivial clarity/robustness win and `root_ids` is already a
membership set conceptually.
**Fix:** Use a `HashSet<String>` for `root_ids` (it is only ever membership-tested), or build
`roots` directly from `root_ids` by id lookup.

### IN-02: Duplicated `sort_date_view` / `sort_child_goals` comparator

**File:** `todo-engine/src/application/service/queries.rs:251-261, 393-403`
**Issue:** `sort_date_view` and `sort_child_goals` are byte-identical comparators
(`iso_day(scheduled)` with `None` last, then `created_at`, then `id`). The duplication invites
drift if one ordering rule changes but not the other.
**Fix:** Extract a single `fn schedule_then_created_order(a, b) -> Ordering` helper and call it
from both, or have `sort_child_goals` delegate to `sort_date_view`.

### IN-03: Test-crate `MAX_GOAL_DEPTH` constant is a hand-mirrored copy of the production cap

**File:** `todo-engine/tests/integration/period_view.rs:631-635`
**Issue:** `MAX_GOAL_DEPTH` is re-declared as `64` in the test because the production constant
is `pub(super)`. The comment acknowledges the coupling, but a silent change to the production
cap would leave the test asserting against a stale bound (the depth fixture and this constant
must move together by convention, not by compiler enforcement).
**Fix:** Optionally expose the cap to the test crate (e.g. a `pub` re-export behind a
`#[cfg(test)]`/test-only accessor) so the bound is sourced from one place; or leave as-is and
accept the documented manual-sync convention.

---

_Reviewed: 2026-06-25T03:37:37Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
