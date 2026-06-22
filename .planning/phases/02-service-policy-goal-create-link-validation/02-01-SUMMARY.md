---
phase: 02-service-policy-goal-create-link-validation
plan: 01
subsystem: application
tags: [plumbing, update-path, list-filter, goal-link, view-primitive]
requires:
  - "ItemType::Goal variant (Phase 01 Plan 02)"
  - "ensure_relation helper (service/mod.rs)"
  - "TodoItem.parent_id / .horizon / .scheduled fields (existing model)"
provides:
  - "UpdateItem.parent_id field validated as non-terminal Goal on the audited update path (LINK-01 plumbing)"
  - "ListFilter.horizon / .parent_id / .scheduled fields + apply_list_filter predicates (VIEW-01 read primitive)"
affects:
  - "02-03 (task linking + VIEW-01 tests) consumes both additions"
tech-stack:
  added: []
  patterns:
    - "Additive Option<String> struct fields with is_none_or equality filter predicates"
    - "Relation validation via ensure_relation (type + non-terminal guard) on the audited update_item path"
key-files:
  created: []
  modified:
    - todo-engine/src/application/service/update.rs
    - todo-engine/src/application/ports.rs
    - todo-engine/tests/unit/filter.rs
    - todo-engine/src/interfaces/api/handlers.rs
    - todo-engine/src/interfaces/cli/views.rs
    - todo-engine/src/interfaces/cli/lifecycle.rs
decisions:
  - "CLI/API arg wiring for parent_id and the new filters is deferred to later Phase 2 plans; call sites set the new fields to None to keep this plan strictly additive plumbing."
metrics:
  duration_min: 4
  completed: 2026-06-22
  tasks: 2
  files: 6
---

# Phase 2 Plan 01: Plumbing — UpdateItem.parent_id + ListFilter Predicates Summary

Additive plumbing for Phase 2: a validated `parent_id` on `UpdateItem` (task→goal link through the existing audited update path, LINK-01) and three optional `ListFilter` fields (`horizon`, `parent_id`, `scheduled`) with matching `apply_list_filter` predicates (the VIEW-01 read primitive), proven by unit tests and covering both store backends for free.

## What Was Built

### Task 1 — UpdateItem.parent_id with Goal parent guard (commit `0d287b1`)
- Added `pub parent_id: Option<String>` to `UpdateItem` (still derives `Default`).
- Added an apply block in `update_item` mirroring the `project_id` block:
  `item.parent_id = self.ensure_relation(Some(parent_id), ItemType::Goal, "Goal parent")?;`
  This reuses `ensure_relation`, which rejects non-Goal and terminal parents with `TodoError::Policy` (LINK-01 parent guard, T-02-01 mitigation).
- The update stays on the audited `store_item_and_event` path (action `"update_item"`) — no bespoke repository write (CORE-01, T-02-02 mitigation).

### Task 2 — ListFilter horizon/parent_id/scheduled predicates (commit `a84319d`)
- Added `horizon`, `parent_id`, `scheduled` `Option<String>` fields to `ListFilter` (still derives `Default`).
- Added three `is_none_or` equality `.filter(...)` predicates in `apply_list_filter`, mirroring the `project_id` predicate.
- `scheduled` provides exact `(horizon, scheduled)` period matching; range filtering is deferred to Phase 3 per RESEARCH assumption A2.
- `infrastructure/sqlite/repo.rs` is unchanged — its `list_items` already delegates to `apply_list_filter`, so the persistent path is covered for free.
- Filtering stays in-Rust (no SQL built from filter strings — T-02-03 accept, no injection surface introduced).
- Added `horizon_parent_and_scheduled_filters_select_expected_rows` to `tests/unit/filter.rs` proving each new predicate selects the expected rows.

## Verification

- `cargo build` — passes.
- `cargo test --test unit filter` — 3 passed.
- `cargo test` (full suite, all binaries) — all green (2 + 0 + 29 + 34 + 44 + 0 passed; 0 failed).
- `cargo fmt --check` — clean (after applying rustfmt to the Task 1 apply block).
- `cargo clippy --all-targets --all-features -- -D warnings` — clean.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Add new fields to existing UpdateItem / ListFilter struct-literal call sites**
- **Found during:** Task 1 (UpdateItem) and Task 2 (ListFilter)
- **Issue:** Adding fields to `UpdateItem` and `ListFilter` broke compilation at call sites that use full struct literals (no `..Default::default()`): `interfaces/api/handlers.rs` and `interfaces/cli/lifecycle.rs` (UpdateItem); `interfaces/api/handlers.rs` and `interfaces/cli/views.rs` (ListFilter). The plan scoped the edits to `update.rs` / `ports.rs` and did not anticipate these literal sites.
- **Fix:** Set the new fields to `None` at each affected call site. This is the minimal blocking fix — surfacing CLI/API arguments for `parent_id` and the new filters is later-plan work; this plan stays pure additive plumbing.
- **Files modified:** `todo-engine/src/interfaces/api/handlers.rs`, `todo-engine/src/interfaces/cli/lifecycle.rs`, `todo-engine/src/interfaces/cli/views.rs`
- **Commits:** `0d287b1` (UpdateItem sites), `a84319d` (ListFilter sites)

Other call sites (`materialization.rs`, `service/mod.rs`, `cli/markdown.rs`, `service/queries.rs`) already use `..ListFilter::default()` and required no change.

**2. [Rule 3 - Blocking] Apply rustfmt to Task 1 apply block**
- **Found during:** verification (`cargo fmt --check`)
- **Issue:** The hand-written `parent_id` apply block formatted onto one line; rustfmt wanted it wrapped to match the surrounding `ensure_relation` blocks.
- **Fix:** Ran `cargo fmt`; the reformatted `update.rs` was folded into the Task 2 commit.
- **Commit:** `a84319d`

## Known Stubs

The `None` literals set at CLI/API call sites are intentional, scoped deferrals (not data-flow stubs): they hardcode no user-visible content and are documented above as later-plan wiring. No UI-rendering stubs introduced.

## Self-Check: PASSED

- Files modified exist: confirmed via git (all 6 files present and committed).
- Commits exist: `0d287b1` (Task 1), `a84319d` (Task 2) — both in `git log`.
- `infrastructure/sqlite/repo.rs` verified untouched across both commits.
- No file deletions in either commit.
