---
phase: 02-service-policy-goal-create-link-validation
plan: 03
subsystem: testing
tags: [link, view, list-filter, integration-tests, tdd, persistent-store]
requires:
  - "02-01: UpdateItem.parent_id (Goal-validated via ensure_relation), UpdateItem.scheduled, ListFilter horizon/parent_id/scheduled + apply_list_filter"
  - "02-02: TodoService::propose_goal, tests/integration/goal_policy.rs"
provides:
  - "SC4 link tests (positive task->goal link via audited update_item; negative non-Goal + terminal parent)"
  - "VIEW-01 persistent list-filter parity test (goal_view.rs) against a real SQLite home"
affects:
  - "todo-engine/tests/integration/goal_policy.rs"
  - "todo-engine/tests/integration/goal_view.rs"
  - "todo-engine/tests/integration.rs"
tech-stack:
  added: []
  patterns:
    - "Persistent integration setup mirrors goal_roundtrip.rs/repository.rs: tempfile::tempdir -> connect -> init_schema -> SqliteTodoRepository -> TodoService::persistent"
    - "Error-shape assertions via match on TodoError::Policy with substring checks on the policy message"
key-files:
  created:
    - "todo-engine/tests/integration/goal_view.rs"
  modified:
    - "todo-engine/tests/integration/goal_policy.rs"
    - "todo-engine/tests/integration.rs"
decisions:
  - "goal_view.rs uses tempfile::tempdir() directly (the established integration-test idiom in repository.rs) rather than tests/support::TestHome, since the support module is only registered in e2e.rs, not integration.rs — a temp SQLite home is functionally equivalent and avoids registering support across two binaries."
  - "Terminal-parent negative test drives the goal terminal via service.drop() (goals start Approved for Actor::User; drop accepts any non-terminal non-Area item)."
  - "Horizon filter returns BOTH the top-level week goal and the week child nested under the month goal; the test asserts the full expected id set rather than a count, proving parent_id and horizon are independent predicates."
metrics:
  duration_min: 3
  completed: "2026-06-22"
  tasks: 2
  files: 3
---

# Phase 2 Plan 03: Link + Task View Tests Summary

Test-only plan closing LINK-01/LINK-02/VIEW-01: SC4 task->goal linking proven through the audited `update_item` path (with non-Goal and terminal-parent rejections), plus a persistent SQLite parity test for the new `horizon`/`parent_id`/`scheduled` list filters.

## What Was Built

Task 1 appended three SC4 tests to `tests/integration/goal_policy.rs`:

- `link_task_to_goal_sets_parent_and_scheduled_via_audited_path` — creates an Approved user goal and task, calls `update_item { parent_id, scheduled }`, asserts the returned item carries `parent_id == Some(goal.id)` and `scheduled == Some("2026-06-08")` (LINK-01/LINK-02), and that `service.events().last().action == "update_item"` (audited path, CORE-01).
- `link_task_to_non_goal_parent_is_rejected` — linking a task to a Project parent returns `TodoError::Policy` containing "Goal parent must be goal" (via `ensure_relation`).
- `link_task_to_terminal_goal_parent_is_rejected` — dropping a goal then linking to it returns `TodoError::Policy` containing "terminal".

Task 2 created `tests/integration/goal_view.rs` and registered it in `tests/integration.rs` (alphabetical: after `goal_roundtrip`):

- `persistent_list_items_honors_horizon_parent_and_period_filters` — stands up a `TodoService::persistent` over a temp SQLite home, creates year/month/week goals plus a week child nested under the month goal, then asserts `list_items` filtering by `horizon`, by `parent_id`, and by exact `(horizon, scheduled)` each returns exactly the expected goals. Proves the persistent `repo.rs` path honors the new `apply_list_filter` predicates (RESEARCH A3), not just the in-memory unit path.

## How It Works

The production code for both behaviors already existed after Wave 1 (02-01 plumbing + 02-02 `propose_goal`); this plan is executable proof. The link tests use `TodoService::in_memory()`; the view test uses `TodoService::persistent(SqliteTodoRepository::new(connect(db)))` so the assertions hit the real SQLite-backed `list_items`, which delegates to `apply_list_filter`.

## Deviations from Plan

None functionally. One documented choice: `goal_view.rs` uses `tempfile::tempdir()` directly instead of `tests/support::TestHome`, because the `support` module is registered only in `e2e.rs` and not in `integration.rs`. The temp SQLite home is functionally identical to `TestHome` (same `tempfile::TempDir` + `todo.sqlite` join) and matches the existing integration-test idiom in `repository.rs`, avoiding a cross-binary support registration. The plan's intent (persistent SQLite store, not in-memory) is fully satisfied.

## Threat Model Coverage

- T-02-08 (Repudiation, link bypassing audit) — mitigated: positive test asserts the link emits an `update_item` event; no bespoke link method used.
- T-02-09 (Tampering, wrong-type/terminal parent) — mitigated: both negative tests prove `Policy` rejection via `ensure_relation`.
- T-02-10 (SQLi on persistent filtering) — accept (per plan): persistent `list_items` loads rows then filters in Rust; the parity test confirms behavior with no SQL built from filter strings.

## Verification

- `cargo test --test integration goal_policy` — 7 passed.
- `cargo test --test integration goal_view` — 1 passed.
- `cargo test` (full suite) — lib 2, e2e 29, integration 42, unit 44; all green.
- `cargo fmt --check` — clean.
- `cargo clippy --all-targets --all-features -- -D warnings` — clean.

## Commits

- `191000c` test(02-03): prove task->goal link via audited update_item (SC4)
- `4b18f46` test(02-03): prove persistent VIEW-01 list filtering (goal_view)

## Self-Check: PASSED

- FOUND: todo-engine/tests/integration/goal_view.rs
- FOUND: commit 191000c
- FOUND: commit 4b18f46
