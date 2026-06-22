---
phase: 01-domain-schema-foundation
plan: 02
type: execute
wave: 1
depends_on: []
files_modified:
  - todo-engine/src/domain/model.rs
  - todo-engine/src/infrastructure/sqlite/mapping.rs
  - todo-engine/tests/unit/model.rs
  - todo-engine/tests/integration/goal_roundtrip.rs
  - todo-engine/tests/integration.rs
autonomous: true
requirements: [GOAL-02]
must_haves:
  truths:
    - "The engine recognizes a `Goal` item type: `ItemType::Goal` exists and maps to the string \"goal\". The SQLite round-trip (SC3) flows through `as_str`/`FromStr` via `mapping.rs` (NOT serde); serde `snake_case` independently yields \"goal\" only for the separate JSON path (D-01 pattern; supports GOAL-02's `Goal`-as-ItemType anchoring)."
    - "A `goal`-typed item round-trips through the SQLite mapping (write then read) without error on the current binary (SC3)."
    - "The `as_str` match stays exhaustive with no wildcard, so the compiler forces every future variant to be handled."
  artifacts:
    - path: "todo-engine/src/domain/model.rs"
      provides: "ItemType::Goal variant + as_str + FromStr arms"
      contains: "Goal"
    - path: "todo-engine/tests/integration/goal_roundtrip.rs"
      provides: "SC3 SQLite round-trip test for a goal-typed item via SqliteTodoRepository"
      contains: "ItemType::Goal"
      min_lines: 20
    - path: "todo-engine/tests/integration.rs"
      provides: "registration of the goal_roundtrip integration module"
      contains: "goal_roundtrip"
  key_links:
    - from: "todo-engine/src/infrastructure/sqlite/mapping.rs"
      to: "ItemType::Goal"
      via: "item_type_sqlite_value -> as_str / parse_item_type -> FromStr (generic over ItemType)"
      pattern: "ItemType::from_str|as_str"
    - from: "todo-engine/tests/integration/goal_roundtrip.rs"
      to: "todo_engine::infrastructure::sqlite::SqliteTodoRepository"
      via: "save_item then get_item asserts type == Goal"
      pattern: "SqliteTodoRepository"
    - from: "todo-engine/tests/integration.rs"
      to: "todo-engine/tests/integration/goal_roundtrip.rs"
      via: "#[path = ...] mod goal_roundtrip;"
      pattern: "integration/goal_roundtrip.rs"
---

<objective>
Make the engine recognize a `Goal` item type. Add `ItemType::Goal` to the domain enum following the existing exact string-mapping idiom (`as_str` / `FromStr` / serde `snake_case`), and prove a `goal`-typed item round-trips (write then read) through the SQLite mapping without error on the current binary.

This supports GOAL-02 (a goal is a new `Goal` item type anchored via `(horizon, scheduled)`) and satisfies Phase 1 Success Criterion SC3. The `Goal` variant reuses the existing status lifecycle, approval gating, and audit machinery — no new table, no new column (CORE-02 stays additive; this plan adds zero schema).

Purpose: `Goal` must exist as a first-class `ItemType` before Phase 2 can create or validate goals. The round-trip test locks the storage contract so later phases trust that a goal persists and reloads identically.
Output: `ItemType::Goal` in `model.rs`; a confirmed (likely no-edit) `mapping.rs` round-trip path; an SC3 integration test in `tests/integration/goal_roundtrip.rs`, registered in `tests/integration.rs`; optional extension of the existing variant-round-trip unit test.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/01-domain-schema-foundation/01-CONTEXT.md
@.planning/phases/01-domain-schema-foundation/01-PATTERNS.md

# Analogs to mirror exactly (read before writing):
@todo-engine/src/domain/model.rs
@todo-engine/src/infrastructure/sqlite/mapping.rs
@todo-engine/tests/integration/repository.rs
@todo-engine/tests/integration.rs
@todo-engine/tests/unit/model.rs
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add the Goal variant to ItemType (model.rs) and confirm the mapping round-trip path</name>
  <files>todo-engine/src/domain/model.rs, todo-engine/src/infrastructure/sqlite/mapping.rs, todo-engine/tests/unit/model.rs</files>
  <read_first>
    - todo-engine/src/domain/model.rs:7-17 (enum), :143-155 (`as_str`), :157-172 (`FromStr`) — the exact three places to extend. The enum already carries `#[serde(rename_all = "snake_case")]`, so serde emits/accepts `"goal"` for free.
    - todo-engine/src/infrastructure/sqlite/mapping.rs:10-12 (`item_type_sqlite_value` -> `as_str`) and :107-109 (`parse_item_type` -> `ItemType::from_str`) — already generic over `ItemType`; CONFIRM, do not edit unless a build/round-trip failure proves an edit is needed.
    - todo-engine/tests/unit/model.rs:46-60 — the existing `item_type_round_trips_every_variant` test that iterates a literal variant list.
  </read_first>
  <behavior>
    - ItemType::Goal.as_str() == "goal"
    - "goal".parse::<ItemType>().unwrap() == ItemType::Goal
    - "  goal  ".parse::<ItemType>().unwrap() == ItemType::Goal   # value.trim() already applied
    - serde_json::to_value emits "goal" for a Goal item's `type` field; deserializing "goal" yields ItemType::Goal
    - item_type_round_trips_every_variant still passes with Goal added to its iteration list
  </behavior>
  <action>
    Add `Goal` in three places in `model.rs`, mirroring the existing variants exactly (per D-01 string-mapping idiom):
    (1) Add `Goal,` to the `ItemType` enum variant list (model.rs:9-17). The enum-level `#[serde(rename_all = "snake_case")]` makes serde round-trip `"goal"` automatically — add no per-variant serde attribute.
    (2) Add `ItemType::Goal => "goal",` to the `as_str` match (model.rs:144-153). This match has NO wildcard — the compiler now forces this arm; do NOT add a `_ =>` arm.
    (3) Add `"goal" => Ok(ItemType::Goal),` to the `FromStr` match (model.rs:161-169), preserving the lowercase-key contract and the existing `_ => Err(format!("unknown item type: {value}"))` fallthrough.

    Then CONFIRM (do not edit) the `mapping.rs` round-trip path: `item_type_sqlite_value` calls `as_str()` and `parse_item_type` calls `ItemType::from_str` — both are generic over `ItemType`, so adding the enum arms makes the SQLite `type` column round-trip for free (PATTERNS.md flags this as a "confirm, don't edit" file). Only edit `mapping.rs` if `cargo build`/`cargo test` proves a gap; if so, note exactly why in the SUMMARY.

    Extend the existing unit test `item_type_round_trips_every_variant` (tests/unit/model.rs:47-60) by adding `ItemType::Goal` to the iterated variant list so the as_str<->FromStr round-trip is asserted for `Goal` at the domain layer.
  </action>
  <verify>
    <automated>cargo build -p todo-engine && cargo clippy --all-targets --all-features -- -D warnings && cargo test -p todo-engine --test unit model</automated>
  </verify>
  <done>`ItemType::Goal` exists and maps to `"goal"`. The SQLite round-trip (SC3) is carried by `as_str`/`FromStr` through `mapping.rs`, not serde; serde `snake_case` only governs the separate JSON `type` field. The exhaustive `as_str` match compiles (compiler-enforced, no wildcard); clippy is clean; the unit round-trip test passes with `Goal` included. `mapping.rs` is confirmed (or minimally edited with a recorded reason).</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: SC3 — goal-typed row round-trips through SQLite (integration test)</name>
  <files>todo-engine/tests/integration/goal_roundtrip.rs, todo-engine/tests/integration.rs</files>
  <read_first>
    - todo-engine/tests/integration/repository.rs:74-104 (`saving_item_and_event_persists_to_sqlite`) — the exact pattern: `connect(":memory:")`, `init_schema`, `SqliteTodoRepository::new`, build a `TodoItem`, `save_item`, then `get_item` and assert fields. Imports come from `todo_engine::infrastructure::sqlite::{connect, init_schema, SqliteTodoRepository}` and `todo_engine::domain::{...}`.
    - todo-engine/src/domain/model.rs:94-141 (`TodoItem::new`) — constructs an item of a given `ItemType` for an actor; use it to build a `Goal` item.
    - todo-engine/tests/integration.rs — the `#[path = "integration/<file>.rs"] mod <name>;` registration list.
  </read_first>
  <behavior>
    - A Goal item built via TodoItem::new(id, ItemType::Goal, title, actor, now), saved with save_item then reloaded with get_item, returns Some(item) with item_type == ItemType::Goal and the same id/title.
    - The reloaded item's `type` column survives as "goal" (round-trip through item_type_sqlite_value -> parse_item_type) with no Storage error.
    - Setting the item's `horizon` to Some("year".to_string()) and `scheduled` to Some("2026-01-01".to_string()) before save and reading them back unchanged confirms the reserved columns carry goal anchoring data (these are plain TEXT columns; no validation in Phase 1).
  </behavior>
  <action>
    Create `todo-engine/tests/integration/goal_roundtrip.rs` mirroring `tests/integration/repository.rs:74-104`. In a `#[test]`:
    - `connect(":memory:")`, `init_schema(&conn).unwrap()`, `SqliteTodoRepository::new(conn)`.
    - Build a goal: `let mut item = TodoItem::new("goal_1", ItemType::Goal, "2026 plan", Actor::User, datetime!(2026-06-01 00:00 UTC));` then set `item.horizon = Some("year".to_string()); item.scheduled = Some("2026-01-01".to_string());` to exercise the reserved anchoring columns alongside the `Goal` type.
    - `repo.save_item(&item).unwrap();` then `let fetched = repo.get_item(&item.id).unwrap().unwrap();`.
    - Assert `fetched.item_type == ItemType::Goal`, `fetched.id == "goal_1"`, `fetched.title == "2026 plan"`, `fetched.horizon.as_deref() == Some("year")`, `fetched.scheduled.as_deref() == Some("2026-01-01")`. This proves SC3: a goal-typed row round-trips without error on the current binary.

    Register the file in `tests/integration.rs`: add `#[path = "integration/goal_roundtrip.rs"] mod goal_roundtrip;` alongside the existing entries (keep alphabetical ordering to match the file's convention).

    NOTE on file ownership: this plan owns the `tests/integration.rs` registration list for this wave. Plan 01-03 (schema indexes) depends on this plan so its own `tests/integration.rs` edit applies after this one — no concurrent edit to the harness file.
  </action>
  <verify>
    <automated>cargo test -p todo-engine --test integration goal_roundtrip</automated>
  </verify>
  <done>The integration binary builds with `goal_roundtrip` registered, and the test passes: a `Goal`-typed item with `horizon`/`scheduled` set survives a save_item/get_item round-trip through the SQLite mapping with no error. SC3 satisfied.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| domain <-> SQLite TEXT `type` column | `ItemType` is serialized to / parsed from the `type` TEXT column via mapping.rs. The only "input" is a string already produced by `as_str` (write) or an existing DB value (read). No external untrusted input at this layer — string parsing of user input is Phase 2. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-01-03 | Tampering | `parse_item_type` reading a corrupt/unknown `type` value | accept | `FromStr` already returns `Err(format!("unknown item type: {value}"))` mapped to `TodoError::Storage` — an unknown `type` value fails loudly rather than silently mis-typing a row. Adding `Goal` does not weaken this; no new handling needed. |
| T-01-04 | Spoofing | A `Goal` row bypassing approval gating | accept | Out of scope for Phase 1 — `Goal` reuses the existing `proposed`/`approved` lifecycle; approval-gating policy is enforced in Phase 2's `TodoService`. This plan adds a type variant and a storage round-trip only, no mutation policy. |
</threat_model>

<verification>
- `cargo build -p todo-engine` — the exhaustive `as_str` match compiles with `Goal` (compiler-enforced completeness).
- `cargo clippy --all-targets --all-features -- -D warnings` — clean.
- `cargo test -p todo-engine --test unit model` — domain variant round-trip passes with `Goal`.
- `cargo test -p todo-engine --test integration goal_roundtrip` — SC3 SQLite round-trip passes.
- `cargo fmt --check` — formatted.
</verification>

<success_criteria>
- SC3: A `goal`-typed row round-trips through the SQLite mapping (write then read) without error on the current binary, with `horizon`/`scheduled` carried intact.
- `ItemType::Goal` is a first-class variant on the public `todo_engine::domain::ItemType` path, ready for Phase 2 goal creation.
</success_criteria>

<output>
Create `.planning/phases/01-domain-schema-foundation/01-02-SUMMARY.md` when done. Record artifacts: `ItemType::Goal` (string `"goal"`). State explicitly whether `mapping.rs` required an edit (expected: no — round-trip is generic over `ItemType`) and why. Note that `Goal` adds zero schema (reuses existing `type` column), keeping CORE-02 additive.
</output>
