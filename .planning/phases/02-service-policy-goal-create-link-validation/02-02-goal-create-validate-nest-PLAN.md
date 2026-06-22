---
phase: 02-service-policy-goal-create-link-validation
plan: 02
type: execute
wave: 1
depends_on: []
files_modified:
  - todo-engine/src/application/service/goal.rs
  - todo-engine/src/application/service/creation.rs
  - todo-engine/src/application/service/mod.rs
  - todo-engine/tests/integration/goal_policy.rs
  - todo-engine/tests/integration.rs
autonomous: true
requirements: [GOAL-01, GOAL-03, GOAL-04, GOAL-05, CORE-01]
must_haves:
  truths:
    - "A user (Actor::User) can create a goal at year/month/week horizon and it starts Approved; an agent-created goal starts Proposed"
    - "Every goal create writes a TodoEvent audit row with action propose_goal via store_item_and_event"
    - "The service rejects an empty, today sentinel, unparseable, or non-canonical scheduled anchor with TodoError::Validation (never auto-snaps)"
    - "The service rejects a goal parent that is not a strictly-coarser Goal (horizon inversion or equal), and rejects a parent chain that forms a cycle (visited-set + depth cap)"
    - "The service rejects a duplicate goal for the same (horizon, canonical scheduled, parent_id) with TodoError::Policy"
  artifacts:
    - path: "todo-engine/src/application/service/goal.rs"
      provides: "validate_goal_anchor, validate_goal_nesting, duplicate-check helpers + MAX_GOAL_DEPTH constant (pub(super) on impl TodoService)"
      contains: "MAX_GOAL_DEPTH"
    - path: "todo-engine/src/application/service/creation.rs"
      provides: "ProposeGoal request struct + propose_goal method"
      contains: "propose_goal"
    - path: "todo-engine/src/application/service/mod.rs"
      provides: "mod goal; wiring + ProposeGoal re-export"
      contains: "mod goal"
    - path: "todo-engine/tests/integration/goal_policy.rs"
      provides: "Integration coverage for SC1/SC2/SC3a/SC3b"
      contains: "propose_goal"
  key_links:
    - from: "creation.rs propose_goal"
      to: "store_item_and_event (service/mod.rs)"
      via: "single audited mutation path, action propose_goal"
      pattern: "store_item_and_event.*propose_goal"
    - from: "goal.rs validate_goal_anchor"
      to: "is_period_start (domain/horizon.rs)"
      via: "strict canonical check after parse_day, reject if not period start"
      pattern: "is_period_start"
    - from: "goal.rs validate_goal_nesting"
      to: "Horizon::is_coarser_than (domain/horizon.rs)"
      via: "parent must be strictly coarser than child"
      pattern: "is_coarser_than"
---

<objective>
Concentrate all goal-create policy in `TodoService`: a new `ProposeGoal` request + `propose_goal` method (mirroring `propose_project`) and a new `service/goal.rs` module holding the anchor-validation, nesting (cycle + horizon-inversion), and duplicate-detection helpers. Every create routes through the single audited `store_item_and_event` path. Phase 1 already shipped every primitive (`ItemType::Goal`, `Horizon`/`is_coarser_than`/`is_period_start`, `parse_day`, actor-driven status in `TodoItem::new`) — this plan composes them.

Purpose: This is the policy core of the phase (GOAL-01/03/04/05 + CORE-01). It also creates the `tests/integration/goal_policy.rs` file that 02-03 will extend, so it runs in Wave 1 with no file overlap with the 02-01 plumbing.
Output: `propose_goal` + `ProposeGoal`, the `goal.rs` validation helpers, the `MAX_GOAL_DEPTH` constant, module wiring, and integration tests for create/validation/nesting/duplicate.
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

<task type="auto" tdd="true">
  <name>Task 1: Create service/goal.rs with anchor, nesting, and duplicate validation helpers</name>
  <files>todo-engine/src/application/service/goal.rs</files>
  <behavior>
    - validate_goal_anchor: trims input; rejects empty and case-insensitive "today" with TodoError::Validation; parses via parse_day (Validation on unparseable); rejects a date that is not is_period_start for the horizon with Validation; on success returns the canonical scheduled string.
    - validate_goal_nesting: for a None parent returns Ok(()); for a parent that is not a Goal returns TodoError::Policy; for a parent whose horizon is not strictly coarser than the child returns Policy (equal horizon is rejected); walks the ancestor chain with a visited HashSet — returns Policy on a repeated id (cycle) and Policy when depth exceeds MAX_GOAL_DEPTH.
    - duplicate check: returns Policy when an existing goal shares the exact (horizon, canonical scheduled, parent_id) triple; top-level goals share parent_id = None.
  </behavior>
  <read_first>
    - todo-engine/src/application/service/mod.rs (`ensure_relation` lines 169-192 for the type/terminal guard idiom; `parse_day` lines 219-224 returns `TodoError::Validation`; `find_area` lines 100-108 for the `list_items(ListFilter{ item_type, ..Default::default() })`-then-filter idiom; `get` is the NotFound→404 read used to walk parents)
    - todo-engine/src/domain/horizon.rs (`is_period_start` line 90, `is_coarser_than` line 42 — STRICT, equality is false; `Horizon::from_str` line 47 returns `Err(String)`; `as_str` line 21)
    - todo-engine/src/domain/mod.rs (re-exports: `Horizon`, `is_period_start` come from `crate::domain`; `is_coarser_than` is an inherent method on the `Horizon` type)
    - todo-engine/src/application/error.rs (reuse `TodoError::Validation` for anchor parse/canonical, `TodoError::Policy` for nesting/duplicate/parent-type — do NOT add a variant; both map to CLI 2 / HTTP 400)
    - todo-engine/src/application/ports.rs (`ListFilter` for the duplicate-check list query — uses only the existing `item_type` field, so this does not depend on plan 02-01)
    - .planning/phases/02-service-policy-goal-create-link-validation/02-RESEARCH.md (Patterns 3/4/5 give the exact composed helper shapes)
  </read_first>
  <action>
    Create `todo-engine/src/application/service/goal.rs`. Add `use super::TodoService;`, the error/result types, the domain imports (`Horizon`, `ItemType`, `is_period_start`), and `std::collections::HashSet`. Define a named module-level constant `const MAX_GOAL_DEPTH: usize = 64;` (use a named constant per the `constants-config-audit` skill — no magic number).
    Implement three `pub(super)` helpers on `impl TodoService`:
    1. `validate_goal_anchor(&self, horizon: Horizon, scheduled: &str) -> TodoResult<String>` — trim; if empty or `eq_ignore_ascii_case("today")` return `TodoError::Validation` explaining a goal anchor must be an explicit ISO date (SC2 — do NOT inherit the task `"today"` sentinel); call `parse_day(trimmed)` (Validation on parse failure); if `!is_period_start(date, horizon)` return `TodoError::Validation` naming the horizon; on success return the trimmed canonical string. NEVER call `normalize_to_period_start` to silently fix a bad anchor (Phase 1 lock — strict reject only).
    2. `validate_goal_nesting(&mut self, parent_id: Option<&str>, child_horizon: Horizon) -> TodoResult<()>` — `None` → `Ok(())`. Otherwise `self.get(parent_id)?` (NotFound→404). If `parent.item_type != ItemType::Goal` return `Policy`. Parse the parent's stored `horizon` string via `Horizon::from_str` (map the `Err(String)` to `TodoError::Validation`); if parent horizon is `None` return `Policy("Goal parent missing horizon")`. Require `parent_h.is_coarser_than(child_horizon)` to be true, else `Policy` (equality is correctly rejected — do NOT use `<=`/`Ord`). Then walk ancestors: a `HashSet<String>` visited set seeded by inserting each id; on a repeat insert return `Policy` (cycle); increment a depth counter and return `Policy` if it exceeds `MAX_GOAL_DEPTH`; advance via the parent's `parent_id`. At create time the new goal has no id yet so a self-cycle is impossible — the walk is defensive against legacy/cyclic data (DoS guard).
    3. duplicate check (either a `pub(super)` helper like `ensure_goal_not_duplicate(&mut self, horizon, canonical_scheduled, parent_id) -> TodoResult<()>` or inline in `propose_goal`) — `self.list_items(ListFilter { item_type: Some(ItemType::Goal), ..Default::default() })?` then reject with `Policy` if any existing goal has `horizon.as_deref() == Some(h.as_str())` AND `scheduled.as_deref() == Some(canonical)` AND `parent_id == request_parent_id`. Compare against the CANONICAL string (Pitfall 3); `Option<String>` equality handles top-level `None` parents.
    Keep all string parsing in the service (layering: `horizon.rs` operates on already-parsed `Date`).
  </action>
  <verify>
    <automated>cd todo-engine && cargo build</automated>
  </verify>
  <acceptance_criteria>
    - `goal.rs` defines `MAX_GOAL_DEPTH` as a named constant and the three `pub(super)` helpers on `impl TodoService`.
    - Anchor validation rejects empty/"today"/unparseable/non-canonical with `TodoError::Validation` and never auto-snaps.
    - Nesting validation rejects non-Goal parents, non-strictly-coarser parents, cycles, and over-depth with `TodoError::Policy`/`Validation` as specified.
    - Duplicate check compares the canonical `(horizon, scheduled, parent_id)` triple.
    - No new `TodoError` variant; no parsing leaked into the domain. `cargo build` succeeds (helpers may be unused until Task 2 wires them — that is expected mid-plan).
  </acceptance_criteria>
  <done>service/goal.rs holds the strict anchor/nesting/duplicate policy helpers composed from verified Phase-1 primitives.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Add ProposeGoal + propose_goal, wire the module, and integration-test SC1/SC2/SC3a/SC3b</name>
  <files>todo-engine/src/application/service/creation.rs, todo-engine/src/application/service/mod.rs, todo-engine/tests/integration/goal_policy.rs, todo-engine/tests/integration.rs</files>
  <behavior>
    - SC1: propose_goal with Actor::Agent yields status Proposed; with Actor::User yields Approved; in both cases service.events().last().action == "propose_goal" (audit row written).
    - SC2: propose_goal returns Err(TodoError::Validation(..)) for scheduled "today", for an unparseable string, and for a non-canonical date (e.g. year horizon with 2026-02-01).
    - SC3a: propose_goal returns Err(TodoError::Policy(..)) when the parent horizon is equal-or-finer (e.g. a week-goal parenting a month-goal), and Policy for a manufactured parent cycle.
    - SC3b: a second propose_goal with the same (horizon, canonical scheduled, parent_id) returns Err(TodoError::Policy(..)).
  </behavior>
  <read_first>
    - todo-engine/src/application/service/creation.rs (`ProposeProject` struct lines 40-48 and `propose_project` method lines 112-128 — the exact create skeleton: build via `TodoItem::new`, set fields, `store_item_and_event`)
    - todo-engine/src/application/service/mod.rs (the `mod creation; ... mod update;` block + `pub use creation::{...}` re-export at lines 11-18 — add `mod goal;` alphabetically after `creation` and add `ProposeGoal` to the re-export)
    - todo-engine/src/domain/model.rs (`TodoItem::new` lines 95-141 — actor→status is derived for free; `TodoItem.horizon`/`.scheduled`/`.parent_id` fields)
    - todo-engine/tests/integration/service_policy.rs (assertion idioms: `TodoService::in_memory()`, `assert_eq!(item.status, ItemStatus::Proposed)`, `let error = ...unwrap_err(); assert_eq!(error, TodoError::Policy("..".to_string()))`, and the agent→approval pattern at lines 31-49)
    - todo-engine/tests/integration/goal_roundtrip.rs (how a goal row is shaped: horizon "year", scheduled "2026-01-01")
    - todo-engine/tests/integration.rs (the `#[path = "integration/<file>.rs"] mod <file>;` dispatcher list — add `goal_policy` alphabetically BEFORE the existing `goal_roundtrip` block)
  </read_first>
  <action>
    In `creation.rs`, add a `ProposeGoal` request struct mirroring `ProposeProject` (creation.rs:40-48) with fields: `pub title: String`, `pub horizon: String`, `pub scheduled: String`, `pub parent_id: Option<String>`, `pub actor: Actor`, `pub note: Option<String>`. Add a `propose_goal(&mut self, request: ProposeGoal) -> TodoResult<TodoItem>` method replicating the `propose_project` skeleton: first parse `Horizon::from_str(&request.horizon)` mapping the `Err(String)` to `TodoError::Validation`; then call the validation order from Task 1 — `let canonical = self.validate_goal_anchor(horizon, &request.scheduled)?;`, `self.validate_goal_nesting(request.parent_id.as_deref(), horizon)?;`, then the duplicate check against `(horizon, &canonical, &request.parent_id)` — ALL before building the item (early return on rejection). Then `let now = self.next_now();`, `let mut item = TodoItem::new(self.next_id("goal"), ItemType::Goal, request.title, request.actor, now);`, set `item.horizon = Some(horizon.as_str().to_string())`, `item.scheduled = Some(canonical)`, `item.parent_id = request.parent_id`, `item.note = request.note`, and finally `self.store_item_and_event(item.proposed_by, "propose_goal", None, item, None)`. Actor→status is free via `TodoItem::new` — do NOT add a status branch. Never call `save_item` directly (CORE-01).
    In `service/mod.rs`, add `mod goal;` alphabetically after `mod creation;` and add `ProposeGoal` to the existing `pub use creation::{...}` re-export so it is reachable as `todo_engine::application::service::ProposeGoal`.
    Create `tests/integration/goal_policy.rs` covering SC1/SC2/SC3a/SC3b (see `<behavior>`). Use `TodoService::in_memory()`. For the cycle case, construct a parent chain and force a cycle by updating a parent's `parent_id` to point back down (or assert the duplicate/inversion cases that are reachable without legacy data, plus a unit-style cycle if reachable). Register the file by adding `#[path = "integration/goal_policy.rs"] mod goal_policy;` in `tests/integration.rs` alphabetically BEFORE the `goal_roundtrip` block (Pitfall 5 — an unregistered file silently never runs).
  </action>
  <verify>
    <automated>cd todo-engine && cargo test --test integration goal_policy</automated>
  </verify>
  <acceptance_criteria>
    - `ProposeGoal` is exported from `todo_engine::application::service`; `propose_goal` validates anchor→nesting→duplicate before building the item and stores via `store_item_and_event` with action `"propose_goal"`.
    - `mod goal;` is wired in `service/mod.rs`; `goal_policy` is registered in `tests/integration.rs`.
    - `tests/integration/goal_policy.rs` asserts: agent→Proposed & user→Approved & audit event (SC1); Validation on today/unparseable/non-canonical (SC2); Policy on horizon inversion + cycle (SC3a); Policy on duplicate triple (SC3b).
    - `cargo test --test integration goal_policy` passes.
  </acceptance_criteria>
  <done>propose_goal creates audited, actor-gated goals with strict validation; SC1/SC2/SC3a/SC3b proven by integration tests.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| caller → TodoService::propose_goal | Untrusted `horizon`, `scheduled`, `parent_id` strings enter the service and must be strictly validated before any item is built or stored |
| propose_goal → repository | The only write is the single audited `store_item_and_event` call (no bypass) |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-02-04 | Tampering | malformed/relative date anchor silently stored | mitigate | `validate_goal_anchor` strict-rejects empty/"today"/unparseable/non-canonical with `TodoError::Validation`; never calls `normalize_to_period_start` to auto-snap (GOAL-03/SC2) |
| T-02-05 | Denial of Service | cyclic `parent_id` → infinite ancestor traversal | mitigate | `validate_goal_nesting` walks ancestors with a `HashSet` visited set and a named `MAX_GOAL_DEPTH` cap; defensive against legacy cyclic data (GOAL-04/SC3a) |
| T-02-06 | Repudiation | goal create bypassing audit | mitigate | `propose_goal` writes exclusively through `store_item_and_event` (action `"propose_goal"`); no direct `save_item` (CORE-01); architecture boundary test stays green |
| T-02-07 | Tampering | horizon-inversion / wrong-type parent accepted | mitigate | Require `parent_h.is_coarser_than(child)` (strict) and `parent.item_type == Goal`; reject with `Policy` (GOAL-04) |
</threat_model>

<verification>
- `cargo build` compiles `goal.rs`, `creation.rs`, and the `service/mod.rs` wiring.
- `cargo test --test integration goal_policy` proves SC1/SC2/SC3a/SC3b.
- `cargo test` (full suite) green — the new module and tests do not regress existing behavior.
- `cargo fmt --check` and `cargo clippy --all-targets --all-features -- -D warnings` clean.
</verification>

<success_criteria>
- A goal can be created at year/month/week horizon; agent→Proposed, user→Approved; every create writes a `propose_goal` audit event (SC1/GOAL-01).
- Unparseable, `"today"`, and non-canonical anchors are rejected with `TodoError::Validation`, never auto-snapped (SC2/GOAL-03).
- Cycles and horizon inversions are rejected with `TodoError::Policy` via a visited-set + depth-cap walk (SC3a/GOAL-04).
- Duplicate `(horizon, canonical scheduled, parent_id)` goals are rejected with `TodoError::Policy` (SC3b/GOAL-05).
- All mutations route through `store_item_and_event` (CORE-01). No new `TodoError` variant added.
</success_criteria>

<output>
Create `.planning/phases/02-service-policy-goal-create-link-validation/02-02-SUMMARY.md` when done.
</output>
