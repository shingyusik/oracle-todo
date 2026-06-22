---
phase: 01-domain-schema-foundation
plan: 03
type: execute
wave: 2
depends_on: ["01-02"]
files_modified:
  - todo-engine/src/infrastructure/sqlite/schema.rs
  - todo-engine/tests/integration/schema_indexes.rs
  - todo-engine/tests/integration.rs
autonomous: true
requirements: [CORE-02]
must_haves:
  truths:
    - "`init_schema()` adds three planning indexes — idx_items_parent_id on parent_id, idx_items_scheduled on scheduled, and a composite idx_items_type_horizon_scheduled on (type, horizon, scheduled) (D-08, CORE-02)."
    - "The migration is additive ONLY: no dropped or rewritten columns, no new `period_key` column, and `PRAGMA user_version` stays at 1 (no version gating) (CORE-02, locked OUT)."
    - "`init_schema()` is idempotent on an EXISTING data-home copy — re-running over a DB that already has data and the legacy indexes succeeds via CREATE INDEX IF NOT EXISTS and preserves every existing column (SC4)."
  artifacts:
    - path: "todo-engine/src/infrastructure/sqlite/schema.rs"
      provides: "three CREATE INDEX IF NOT EXISTS statements added to the existing init_schema_inner index batch"
      contains: "idx_items_type_horizon_scheduled"
    - path: "todo-engine/tests/integration/schema_indexes.rs"
      provides: "SC4 test — indexes appear on a populated, pre-existing data-home copy with columns intact and no period_key / user_version bump"
      contains: "idx_items_parent_id"
      min_lines: 30
    - path: "todo-engine/tests/integration.rs"
      provides: "registration of the schema_indexes integration module"
      contains: "schema_indexes"
  key_links:
    - from: "todo-engine/src/infrastructure/sqlite/schema.rs"
      to: "items table"
      via: "CREATE INDEX IF NOT EXISTS ... ON items(...)"
      pattern: "CREATE INDEX IF NOT EXISTS idx_items_(parent_id|scheduled|type_horizon_scheduled)"
    - from: "todo-engine/tests/integration/schema_indexes.rs"
      to: "sqlite_master"
      via: "query index names after re-running init_schema on a populated copy"
      pattern: "sqlite_master"
    - from: "todo-engine/tests/integration.rs"
      to: "todo-engine/tests/integration/schema_indexes.rs"
      via: "#[path = ...] mod schema_indexes;"
      pattern: "integration/schema_indexes.rs"
---

<objective>
Add the three additive planning indexes to `init_schema()` and prove the migration is purely additive on an existing, populated data home. Add `idx_items_parent_id` on `parent_id`, `idx_items_scheduled` on `scheduled`, and a composite `idx_items_type_horizon_scheduled` on `(type, horizon, scheduled)` inside the existing `init_schema_inner` index batch — all via `CREATE INDEX IF NOT EXISTS`, with no dropped/rewritten columns, no `period_key` column, and no `user_version` bump.

This implements CORE-02 (schema changes are additive only: enum variant plus indexes; no dropped/rewritten columns and no new `period_key` column) and satisfies Phase 1 Success Criterion SC4. The `horizon` column already exists (reserved, schema.rs:42 and in `ITEM_COLUMN_ADDITIONS`) — no `ALTER TABLE` is needed for it.

Purpose: the period views in Phases 3-4 will query items by `parent_id`, by `scheduled` date range, and by `(type, horizon, scheduled)`. These indexes pre-pave those access paths now, additively, so no later phase needs a risky schema change. Locking the additive-only contract here protects every existing data home.
Output: three index DDL lines in `schema.rs`; an SC4 integration test in `tests/integration/schema_indexes.rs` that verifies indexes-on-existing-copy with columns intact, registered in `tests/integration.rs`.

Depends on 01-02 because both edit the shared `tests/integration.rs` harness registration file; this plan's edit applies after 01-02's (Wave 2) to avoid a concurrent edit to that file.
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
@todo-engine/src/infrastructure/sqlite/schema.rs
@todo-engine/tests/integration/repository.rs
@todo-engine/tests/integration.rs
# Data-home safety procedure for the SC4 copy verification:
@docs/operations/verification-and-smoke.md
@docs/operations/data-home.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add the three additive planning indexes to init_schema_inner</name>
  <files>todo-engine/src/infrastructure/sqlite/schema.rs</files>
  <read_first>
    - todo-engine/src/infrastructure/sqlite/schema.rs:72-91 — the existing `CREATE INDEX IF NOT EXISTS` batch ending with `PRAGMA user_version = 1; COMMIT;`. Add the three new index lines INSIDE this batch (between the routine-occurrence unique index at :79-81 and the events indexes at :83), keeping `PRAGMA user_version = 1; COMMIT;` last.
    - todo-engine/src/infrastructure/sqlite/schema.rs:93-122 (`ITEM_COLUMN_ADDITIONS`) and :124-143 (`ensure_item_columns`) — DO NOT touch these. `horizon` already exists at :113, so no `ALTER TABLE` is needed. The whole batch is rollback-wrapped by `init_schema` (schema.rs:5-13) and errors map to `TodoError::Migration` (schema.rs:90).
  </read_first>
  <action>
    Inside the existing index `execute_batch` block in `init_schema_inner` (schema.rs:72-91), add exactly three statements per D-08 / CORE-02, between the `idx_items_routine_occurrence` unique index and the `idx_events_*` lines:
      CREATE INDEX IF NOT EXISTS idx_items_parent_id ON items(parent_id);
      CREATE INDEX IF NOT EXISTS idx_items_scheduled ON items(scheduled);
      CREATE INDEX IF NOT EXISTS idx_items_type_horizon_scheduled ON items(type, horizon, scheduled);

    Locked constraints (CORE-02, restated):
      - Additive only: no `ALTER TABLE`, no dropped or rewritten columns. Do NOT modify `ensure_item_columns` or `ITEM_COLUMN_ADDITIONS` — `horizon` already exists.
      - Do NOT add a `period_key` column or a separate goals table (locked OUT upstream).
      - Do NOT bump `PRAGMA user_version` — leave it at `1`. No `user_version` gating this phase.
      - `IF NOT EXISTS` keeps this idempotent on existing data homes (SC4). Keep `PRAGMA user_version = 1; COMMIT;` as the final two statements of the batch.
  </action>
  <verify>
    <automated>cargo build -p todo-engine && cargo clippy --all-targets --all-features -- -D warnings && cargo test -p todo-engine --test integration repository</automated>
  </verify>
  <done>The three indexes are present in the `init_schema_inner` batch, the crate builds, clippy is clean, and the existing repository integration tests (which call `init_schema` and assert `user_version == 1`) still pass — confirming `user_version` is untouched and the batch is well-formed.</done>
</task>

<task type="auto">
  <name>Task 2: SC4 — additive migration verified on a populated, pre-existing data-home copy</name>
  <files>todo-engine/tests/integration/schema_indexes.rs, todo-engine/tests/integration.rs</files>
  <read_first>
    - todo-engine/tests/integration/repository.rs:1-24,44-72 — patterns for `connect`, `init_schema`, `user_version`, and constructing a pre-existing `items` table with rows via `execute_batch` (the `failed_schema_init...` test shows the older-table-with-data idiom).
    - docs/operations/verification-and-smoke.md + docs/operations/data-home.md — the copy-to-temp-home safety rule: NEVER touch the live `~/.todo-engine/todo.sqlite`. This test uses an in-memory or tempfile DB only; it must not reference the real data home.
    - todo-engine/tests/integration.rs — the `#[path = ...] mod <name>;` registration list (already includes `goal_roundtrip` from plan 01-02; add `schema_indexes` alongside, alphabetical).
  </read_first>
  <action>
    Create `todo-engine/tests/integration/schema_indexes.rs`. Write `#[test]` cases that simulate an EXISTING data home (a copy, never the live DB) and prove additive-only migration (SC4):

    (1) Idempotent-on-existing test: `connect(":memory:")`, run `init_schema` once, insert a couple of `items` rows via `execute_batch` (mirror repository.rs:60-64 INSERT shape). Re-run `init_schema(&conn).unwrap()` (simulating an existing populated data home being re-opened by the current binary). Then query `sqlite_master`:
        SELECT name FROM sqlite_master WHERE type='index' AND name IN
          ('idx_items_parent_id','idx_items_scheduled','idx_items_type_horizon_scheduled')
      Assert all three index names are present. Assert the inserted rows still exist (count unchanged). Assert `user_version(&conn).unwrap() == 1` (no version bump).

    (2) No-dropped/rewritten-columns + no-period_key test: capture `PRAGMA table_info(items)` column names BEFORE the (re-)migration into a set, run `init_schema` again, capture AFTER, and assert the BEFORE set is a subset of AFTER (nothing removed/renamed) and that `"period_key"` is NOT in AFTER. This pins CORE-02's "no dropped/rewritten columns, no period_key" guarantee.

    Use only in-memory or `tempfile::tempdir()` databases — do not open or copy the real `~/.todo-engine/todo.sqlite` (data-home safety, D-08). Register the file in `tests/integration.rs`: add `#[path = "integration/schema_indexes.rs"] mod schema_indexes;` (keep the list alphabetical; this edit lands after 01-02's `goal_roundtrip` registration).
  </action>
  <verify>
    <automated>cargo test -p todo-engine --test integration schema_indexes</automated>
  </verify>
  <done>The integration binary builds with `schema_indexes` registered. Re-running `init_schema` over a populated DB adds all three planning indexes idempotently, preserves existing rows and all existing columns, introduces no `period_key` column, and leaves `user_version` at 1. SC4 satisfied, verified on a copy (never the live data home).</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| current binary <-> existing local data home | `init_schema` runs against a user's existing `todo.sqlite`. The risk surface is destructive/lossy migration of pre-existing data, NOT network or untrusted input. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-01-05 | Tampering / Denial of service | `init_schema_inner` migration over an existing data home | mitigate | Additive-only contract: `CREATE INDEX IF NOT EXISTS` (idempotent), no `ALTER`/`DROP`/column rewrite, no `period_key`, `user_version` untouched. SC4 test (Task 2) asserts indexes-added + rows-preserved + columns-superset + no period_key on a populated copy. The whole batch is rollback-wrapped (schema.rs:5-13). |
| T-01-06 | Tampering (operator error) | SC4 verification touching the live `~/.todo-engine/todo.sqlite` | mitigate | Test uses only in-memory / `tempfile` DBs; the action and `read_first` explicitly forbid opening the live data home (D-08, data-home safety). |
</threat_model>

<verification>
- `cargo build -p todo-engine` — index DDL is well-formed.
- `cargo clippy --all-targets --all-features -- -D warnings` — clean.
- `cargo test -p todo-engine --test integration` — existing repository tests still pass (user_version == 1 intact) and the new `schema_indexes` SC4 tests pass.
- `cargo fmt --check` — formatted.
</verification>

<success_criteria>
- SC4: `init_schema()` adds the planning indexes (`parent_id`, `scheduled`, composite `(type, horizon, scheduled)`) on an existing data-home copy with no dropped or rewritten columns and no new `period_key` column, and `user_version` stays at 1 — all verified on a copy, never the live data home.
- CORE-02 additive-only invariant is locked by an executable test.
</success_criteria>

<output>
Create `.planning/phases/01-domain-schema-foundation/01-03-SUMMARY.md` when done. Record artifacts: the three index names (`idx_items_parent_id`, `idx_items_scheduled`, `idx_items_type_horizon_scheduled`). Confirm explicitly: no `ALTER TABLE`, no `period_key`, `user_version` unchanged (stays 1), verified on a copied/in-memory DB (never the live data home).
</output>
