---
phase: 02-service-policy-goal-create-link-validation
plan: 03
type: execute
wave: 2
depends_on: ["02-01", "02-02"]
files_modified:
  - todo-engine/tests/integration/goal_policy.rs
  - todo-engine/tests/integration/goal_view.rs
  - todo-engine/tests/integration.rs
autonomous: true
requirements: [LINK-01, LINK-02, VIEW-01]
must_haves:
  truths:
    - "A user can link an existing task to a goal via update_item{ parent_id } and set the task's scheduled date, both through the audited update path (action update_item)"
    - "Linking a task to a non-Goal or terminal parent is rejected with TodoError::Policy"
    - "A user can list goals/tasks filtered by horizon, by exact period (scheduled), and by parent — proven against the persistent SQLite store, not just in-memory"
  artifacts:
    - path: "todo-engine/tests/integration/goal_policy.rs"
      provides: "SC4 link tests (positive link + negative non-Goal/terminal parent)"
      contains: "parent_id"
    - path: "todo-engine/tests/integration/goal_view.rs"
      provides: "VIEW-01 list-filter parity test against a persistent TestHome SQLite store"
      contains: "ListFilter"
  key_links:
    - from: "tests/integration/goal_policy.rs"
      to: "TodoService::update_item with parent_id + scheduled"
      via: "audited update path, asserts item.parent_id, item.scheduled, and update_item event"
      pattern: "update_item"
    - from: "tests/integration/goal_view.rs"
      to: "persistent list_items via apply_list_filter"
      via: "TestHome SQLite home + ListFilter horizon/parent/scheduled"
      pattern: "ListFilter"
---

<objective>
Prove the linking and read-primitive behaviors end-to-end through `TodoService`: SC4 (link an existing task to a goal via `update_item{ parent_id, scheduled }` on the audited path, plus the negative non-Goal/terminal-parent rejection) and the VIEW-01 list filter proven against the persistent SQLite store (not just in-memory), confirming both `list_items` backends honor the new `horizon`/`parent_id`/`scheduled` predicates.

Purpose: This plan consumes the 02-01 plumbing (`UpdateItem.parent_id`, `ListFilter` fields) and the 02-02 create method (`propose_goal`). It is test-only — the production code already exists after Wave-1 plans — so it closes LINK-01/LINK-02/VIEW-01 with executable proof and proves persistent-store parity (RESEARCH A3).
Output: SC4 link tests appended to `goal_policy.rs`, a new persistent `goal_view.rs` integration test for VIEW-01, and its dispatcher registration.
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
@.planning/phases/02-service-policy-goal-create-link-validation/02-PATTERNS.md
@.planning/phases/02-service-policy-goal-create-link-validation/02-VALIDATION.md
@.planning/phases/02-service-policy-goal-create-link-validation/02-01-plumbing-update-listfilter-PLAN.md
@.planning/phases/02-service-policy-goal-create-link-validation/02-02-goal-create-validate-nest-PLAN.md
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Integration-test task→goal linking (SC4) in goal_policy.rs</name>
  <files>todo-engine/tests/integration/goal_policy.rs</files>
  <behavior>
    - Positive: create an approved goal and an approved task; call update_item with parent_id = goal.id and a valid scheduled date; assert the returned item has parent_id == Some(goal.id), scheduled == Some(date), and service.events().last().action == "update_item".
    - Negative (non-Goal parent): update_item linking a task to a non-Goal item (e.g. a project or area) returns Err(TodoError::Policy(..)) (ensure_relation "Goal parent must be goal: ..").
    - Negative (terminal parent): update_item linking to a terminal goal returns Err(TodoError::Policy(..)).
  </behavior>
  <read_first>
    - todo-engine/src/application/service/update.rs (the `UpdateItem.parent_id` field + apply block added in plan 02-01; the `scheduled` apply block at lines 89-91 used by LINK-02; the audited path call at lines 98-104 with action "update_item")
    - todo-engine/src/application/service/mod.rs (`ensure_relation` lines 169-192 — its `Policy` messages: "{label} must be {type}: {id}" and "{label} is terminal: {status}")
    - todo-engine/tests/integration/goal_policy.rs (created in plan 02-02 — append the SC4 tests; reuse its imports/helpers)
    - todo-engine/tests/integration/service_policy.rs (assertion idioms, error-equality, building a project/area + driving an item to terminal status via complete/drop/cancel for the negative cases)
  </read_first>
  <action>
    Append SC4 tests to `tests/integration/goal_policy.rs` (the file plan 02-02 created). Use `TodoService::in_memory()`.
    Positive link test: create a goal via `propose_goal` with `Actor::User` (starts Approved) and a task via `propose_task` with `Actor::User`; call `service.update_item(&task.id, UpdateItem { parent_id: Some(goal.id.clone()), scheduled: Some("2026-06-08".to_string()), ..Default::default() })`; assert `item.parent_id.as_deref() == Some(goal.id.as_str())`, `item.scheduled.as_deref() == Some("2026-06-08")` (LINK-02), and `service.events().last().unwrap().action == "update_item"` (audited path — CORE-01).
    Negative non-Goal test: create a project (or area) and a task; `update_item { parent_id: Some(project.id), .. }` must return `Err(TodoError::Policy(..))` (assert the message contains "Goal parent must be goal").
    Negative terminal test: create a goal, drive it to a terminal status (e.g. drop/cancel/complete via the existing transition methods), then `update_item { parent_id: Some(terminal_goal.id), .. }` returns `Err(TodoError::Policy(..))` containing "terminal".
    No new dispatcher line needed (goal_policy already registered by 02-02).
  </action>
  <verify>
    <automated>cd todo-engine && cargo test --test integration goal_policy</automated>
  </verify>
  <acceptance_criteria>
    - Positive test proves `update_item` sets `parent_id` + `scheduled` and emits an `update_item` audit event (LINK-01, LINK-02, CORE-01).
    - Negative tests prove a non-Goal parent and a terminal parent are both rejected with `TodoError::Policy`.
    - `cargo test --test integration goal_policy` passes (existing 02-02 tests still green).
  </acceptance_criteria>
  <done>Task→goal linking + scheduled-set is proven through the audited update path, with parent-type/terminal guards.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Persistent VIEW-01 list-filter parity test (goal_view.rs)</name>
  <files>todo-engine/tests/integration/goal_view.rs, todo-engine/tests/integration.rs</files>
  <behavior>
    - Against a real SQLite home (TestHome): create goals at different horizons / scheduled / parent via propose_goal, then list_items with ListFilter { horizon: Some("week"), .. } returns only week goals; ListFilter { parent_id: Some(parent.id), .. } returns only that parent's children; ListFilter { horizon: Some("month"), scheduled: Some("2026-06-01"), .. } returns the exact period match. Proves the persistent path honors the new predicates (RESEARCH A3), not just the in-memory unit test in 02-01.
  </behavior>
  <read_first>
    - todo-engine/tests/support/mod.rs (`TestHome::new()` + `db_path()` — temp SQLite home helper)
    - todo-engine/tests/integration/goal_roundtrip.rs (how to stand up a persistent repo: `connect(..)`, `init_schema(..)`, `SqliteTodoRepository::new(..)` — and how the service is constructed persistently via `TodoService::persistent(..)`)
    - todo-engine/src/application/service/mod.rs (`TodoService::persistent` constructor lines 44-52)
    - todo-engine/src/application/ports.rs (the `ListFilter` fields added in plan 02-01 and `apply_list_filter`; both `queries.rs::list_items` and `repo.rs::list_items` delegate to it)
    - todo-engine/src/infrastructure/sqlite (the `connect` / `init_schema` / `SqliteTodoRepository` public surface used by goal_roundtrip.rs)
  </read_first>
  <action>
    Create `tests/integration/goal_view.rs`. Stand up a persistent service over a `TestHome` SQLite database (mirror `goal_roundtrip.rs`'s `connect`/`init_schema`/`SqliteTodoRepository` setup, then wrap with `TodoService::persistent(..)`). Create several goals via `propose_goal` with `Actor::User`: e.g. a year goal (2026-01-01), a month goal (2026-06-01), and a week goal (2026-06-08) plus a child goal nested under the month goal. Then assert:
    - `list_items(ListFilter { horizon: Some("week".to_string()), ..Default::default() })` returns only the week goal(s).
    - `list_items(ListFilter { parent_id: Some(<month goal id>), ..Default::default() })` returns only the child nested under that parent.
    - `list_items(ListFilter { horizon: Some("month".to_string()), scheduled: Some("2026-06-01".to_string()), ..Default::default() })` returns exactly the month goal (exact `(horizon, scheduled)` period match).
    Register `#[path = "integration/goal_view.rs"] mod goal_view;` in `tests/integration.rs` (alphabetical placement among the `goal_*` entries: `goal_policy`, then `goal_roundtrip`, then `goal_view`).
  </action>
  <verify>
    <automated>cd todo-engine && cargo test --test integration goal_view</automated>
  </verify>
  <acceptance_criteria>
    - `goal_view.rs` exercises the PERSISTENT `list_items` path (TestHome SQLite), not in-memory.
    - Filtering by `horizon`, by `parent_id`, and by `(horizon, scheduled)` each returns exactly the expected goals.
    - `goal_view` is registered in `tests/integration.rs`; `cargo test --test integration goal_view` passes.
  </acceptance_criteria>
  <done>VIEW-01 list filtering is proven against the persistent store, confirming repo.rs parity for free.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| caller → update_item (link) | Untrusted `parent_id` resolved + type/terminal-checked before assignment (validated in 02-01; re-asserted here) |
| caller → list_items filter | Untrusted filter strings used only for in-Rust equality; persistent path proven here |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-02-08 | Repudiation | task→goal link bypassing audit | mitigate | Test asserts the link goes through `update_item` and emits an `update_item` event (CORE-01); no bespoke link method |
| T-02-09 | Tampering | wrong-type/terminal parent accepted on link | mitigate | Negative tests prove non-Goal and terminal parents are rejected with `Policy` (via `ensure_relation`) |
| T-02-10 | Tampering (SQLi) | persistent list filtering | accept | Persistent `list_items` loads rows then filters in Rust via `apply_list_filter`; no SQL built from filter strings — the parity test confirms behavior without introducing a SQL injection surface |
</threat_model>

<verification>
- `cargo test --test integration goal_policy` proves SC4 (link positive + negatives).
- `cargo test --test integration goal_view` proves VIEW-01 against the persistent store.
- `cargo test` (full suite, all three binaries) green at wave merge.
- `cargo fmt --check` and `cargo clippy --all-targets --all-features -- -D warnings` clean.
</verification>

<success_criteria>
- A task can be linked to a goal via `update_item{ parent_id }` and have its `scheduled` set, both on the audited path; non-Goal and terminal parents are rejected (SC4/LINK-01/LINK-02).
- Goals/tasks can be listed filtered by horizon, exact period (`scheduled`), and parent — proven against the persistent SQLite store (SC5a/VIEW-01).
- Full suite + fmt + clippy green.
</success_criteria>

<output>
Create `.planning/phases/02-service-policy-goal-create-link-validation/02-03-SUMMARY.md` when done.
</output>
