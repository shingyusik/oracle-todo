---
phase: 02-service-policy-goal-create-link-validation
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - todo-engine/src/application/service/update.rs
  - todo-engine/src/application/ports.rs
  - todo-engine/tests/unit/filter.rs
autonomous: true
requirements: [LINK-01, VIEW-01]
must_haves:
  truths:
    - "UpdateItem carries a parent_id that is validated as a non-terminal Goal before being applied through the audited update path"
    - "ListFilter can select items by horizon, by parent_id, and by exact scheduled (period) value"
    - "Both the in-memory and persistent list_items paths honor the new filter predicates (both delegate to apply_list_filter)"
  artifacts:
    - path: "todo-engine/src/application/service/update.rs"
      provides: "UpdateItem.parent_id field + apply block reusing ensure_relation for a non-terminal Goal parent"
      contains: "parent_id"
    - path: "todo-engine/src/application/ports.rs"
      provides: "ListFilter.horizon / .parent_id / .scheduled fields + matching apply_list_filter predicates"
      contains: "horizon"
    - path: "todo-engine/tests/unit/filter.rs"
      provides: "Unit coverage for the new apply_list_filter predicates"
  key_links:
    - from: "todo-engine/src/application/service/update.rs"
      to: "ensure_relation (service/mod.rs)"
      via: "parent_id apply block validates ItemType::Goal, non-terminal"
      pattern: "ensure_relation.*Goal"
    - from: "todo-engine/src/application/ports.rs apply_list_filter"
      to: "TodoItem.horizon / .parent_id / .scheduled"
      via: "is_none_or equality predicate per field"
      pattern: "filter\\.(horizon|parent_id|scheduled)"
---

<objective>
Add the additive plumbing the rest of Phase 2 builds on: a `parent_id` field on `UpdateItem` (so a task can be linked to a goal through the existing audited update path — LINK-01) and three new optional filter fields on `ListFilter` (`horizon`, `parent_id`, `scheduled`) plus matching `apply_list_filter` predicates (the VIEW-01 read primitive). Both `list_items` paths delegate to `apply_list_filter`, so one `ports.rs` edit covers in-memory and persistent.

Purpose: This is the foundation layer — 02-03 (task linking + VIEW-01 tests) consumes both of these additions. Keeping it isolated lets the goal-policy core (02-02) run in parallel.
Output: Extended `UpdateItem` and `ListFilter` structs, new `apply_list_filter` predicates, and unit coverage for the filter predicates.
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
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add parent_id to UpdateItem and validate it as a non-terminal Goal</name>
  <files>todo-engine/src/application/service/update.rs</files>
  <read_first>
    - todo-engine/src/application/service/update.rs (the `UpdateItem` struct and its `project_id` field + apply block at lines 17 and 78-81 — this is the exact analog)
    - todo-engine/src/application/service/mod.rs (the `ensure_relation` helper at lines 169-192 — reuse it; it already rejects wrong-type and terminal parents with `TodoError::Policy`)
    - todo-engine/src/domain/model.rs (confirm `TodoItem.parent_id` already exists as `Option<String>` at line 38 — no model change)
  </read_first>
  <action>
    In `UpdateItem` (update.rs:5-23, which is `#[derive(Default)]`), add a `pub parent_id: Option<String>,` field. Mirror the existing `pub project_id: Option<String>,` field — purely additive, default `None`.
    In `update_item` (update.rs:26-105), add an apply block mirroring the `project_id` apply block (update.rs:78-81): `if let Some(parent_id) = request.parent_id { item.parent_id = self.ensure_relation(Some(parent_id), ItemType::Goal, "Goal parent")?; }`. Place it adjacent to the `project_id` apply block. Reuse `ensure_relation` (do NOT hand-roll the type/terminal check) — it returns `TodoError::Policy` for a non-Goal or terminal parent, which is exactly LINK-01's parent guard. The whole `update_item` path already calls `store_item_and_event` with action `"update_item"` (update.rs:98-104), so the audit row is automatic — do NOT add any direct repository write (CORE-01).
    Do NOT touch the existing `scheduled` apply block (update.rs:89-91) — LINK-02 (set scheduled) already works through it; its test lives in 02-03.
  </action>
  <verify>
    <automated>cd todo-engine && cargo build</automated>
  </verify>
  <acceptance_criteria>
    - `UpdateItem` has a `parent_id: Option<String>` field; the struct still derives `Default`.
    - `update_item` validates `request.parent_id` via `ensure_relation(.., ItemType::Goal, "Goal parent")` before assigning `item.parent_id`.
    - No direct `save_item`/repository call is introduced; the update still flows through `store_item_and_event`.
    - `cargo build` succeeds.
  </acceptance_criteria>
  <done>UpdateItem carries parent_id, applied through the audited update path with a Goal/non-terminal parent guard.</done>
</task>

<task type="auto">
  <name>Task 2: Add horizon / parent_id / scheduled filters to ListFilter and apply_list_filter, with unit coverage</name>
  <files>todo-engine/src/application/ports.rs, todo-engine/tests/unit/filter.rs</files>
  <read_first>
    - todo-engine/src/application/ports.rs (the `ListFilter` struct at lines 18-27 and `apply_list_filter` at lines 29-78 — the `project_id` field at line 23 and its predicate at lines 52-57 are the exact analog)
    - todo-engine/src/infrastructure/sqlite/repo.rs (VERIFY ONLY — `list_items` at lines 29-40 loads all rows then calls `apply_list_filter`; it builds NO SQL WHERE clause, so the new fields work for the persistent path with zero repo.rs changes. Do not edit this file.)
    - todo-engine/tests/unit/filter.rs (the `item(...)` helper at lines 8-12 and `type_and_query_filters_select_expected_rows` at lines 40-69 — the exact test shape to replicate; this file is already registered in tests/unit.rs)
    - todo-engine/src/domain/model.rs (confirm `TodoItem.horizon`, `.parent_id`, `.scheduled` all exist as `Option<String>` at lines 51, 38, 50)
  </read_first>
  <action>
    In `ListFilter` (ports.rs:18-27, `#[derive(Clone, Debug, Default)]`), add three optional fields mirroring `project_id`: `pub horizon: Option<String>,`, `pub parent_id: Option<String>,`, `pub scheduled: Option<String>,`. The `scheduled` field gives "period" filtering as an exact `(horizon, scheduled)` match — per RESEARCH assumption A2, range filtering is deferred to Phase 3 (Date View). All purely additive (default `None`).
    In `apply_list_filter` (ports.rs:29-78), add three `.filter(...)` predicates, each mirroring the `project_id` predicate (ports.rs:52-57): for `horizon` compare `item.horizon.as_ref()`, for `parent_id` compare `item.parent_id.as_ref()`, for `scheduled` compare `item.scheduled.as_ref()`, each guarded by `filter.<field>.as_ref().is_none_or(|v| item.<field>.as_ref() == Some(v))`. Filtering stays in Rust (no SQL string building, so the SQL-injection threat does not apply to the filter path).
    Do NOT edit `infrastructure/sqlite/repo.rs` — its `list_items` (repo.rs:39) already delegates to this shared `apply_list_filter`, so the new predicates cover the persistent path for free.
    In `tests/unit/filter.rs`, extend (do not replace) with a test that builds a few `TodoItem`s with `.horizon`, `.parent_id`, and `.scheduled` set (use the existing `item(...)` helper, then set the fields), and asserts `apply_list_filter` with `ListFilter { horizon: Some(..), .. }`, with `{ parent_id: Some(..), .. }`, and with `{ horizon: Some(..), scheduled: Some(..), .. }` selects exactly the expected ids. Follow the `type_and_query_filters_select_expected_rows` assertion idiom.
  </action>
  <verify>
    <automated>cd todo-engine && cargo test --test unit filter</automated>
  </verify>
  <acceptance_criteria>
    - `ListFilter` has `horizon`, `parent_id`, and `scheduled` `Option<String>` fields; the struct still derives `Default`.
    - `apply_list_filter` filters by each of the three new fields using the `is_none_or` equality idiom.
    - `infrastructure/sqlite/repo.rs` is unchanged.
    - The extended `tests/unit/filter.rs` proves each new predicate selects the expected rows; `cargo test --test unit filter` passes.
  </acceptance_criteria>
  <done>ListFilter + apply_list_filter support horizon/parent/period filtering for both store backends, proven by unit tests.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| caller → TodoService::update_item | Untrusted `parent_id` string enters the service; must be resolved and type/terminal-checked before assignment |
| caller → list_items filter | Untrusted filter strings (`horizon`, `parent_id`, `scheduled`) used only for in-Rust equality comparison |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-02-01 | Tampering | `update_item` parent_id assignment | mitigate | Route `parent_id` through `ensure_relation(.., ItemType::Goal, ..)` — rejects non-Goal/terminal parents with `Policy`; never assigns an unvalidated id |
| T-02-02 | Repudiation | task→goal link write | mitigate | LINK stays on the audited `update_item` path (`store_item_and_event`, action `"update_item"`); no bespoke bypass (CORE-01) |
| T-02-03 | Tampering (SQLi) | list filter strings | accept | Filtering is in-Rust `apply_list_filter` equality; no SQL is built from filter strings (repo.rs writes use bound params, unchanged). No injection surface introduced. |
</threat_model>

<verification>
- `cargo build` compiles the extended `UpdateItem` and `ListFilter`.
- `cargo test --test unit filter` proves the new `apply_list_filter` predicates.
- `cargo test` (full suite) stays green — no existing test regresses from the additive fields.
- `cargo fmt --check` and `cargo clippy --all-targets --all-features -- -D warnings` clean.
</verification>

<success_criteria>
- `UpdateItem.parent_id` exists and is validated as a non-terminal `Goal` through `ensure_relation` on the audited path (LINK-01 plumbing).
- `ListFilter` and `apply_list_filter` support `horizon`, `parent_id`, and `scheduled` (exact period) filtering for both in-memory and persistent stores (VIEW-01 read primitive).
- `infrastructure/sqlite/repo.rs` is untouched (verified-parametric).
- Filter unit tests pass; full suite + fmt + clippy green.
</success_criteria>

<output>
Create `.planning/phases/02-service-policy-goal-create-link-validation/02-01-SUMMARY.md` when done.
</output>
