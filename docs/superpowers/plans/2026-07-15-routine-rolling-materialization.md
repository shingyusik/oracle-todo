# Routine Rolling Materialization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make active routines automatically maintain one or a configured number of future generated tasks.

**Architecture:** Persist `future_occurrences` on routine items, then centralize all creation in a service helper that fills a routine from today or after its latest generated occurrence. Activation, completion, the global CLI sweep, and the named HTTP action call that helper; SQLite uniqueness remains the concurrency guard.

**Tech Stack:** Rust 2024, `time`, SQLite/rusqlite, axum, clap, Next.js/React, Vitest.

## Global Constraints

- SQLite remains the source of truth and every mutation routes through `TodoService` with an audit event.
- Schema initialization is additive; existing columns and rows are never rewritten or dropped.
- `future_occurrences` defaults to `7` and accepts `1..=365`.
- `single_open` maintains one open routine task; `per_occurrence` maintains `future_occurrences` open routine tasks.
- Past occurrences are never generated, and reducing the target never removes existing tasks.
- Preserve the user's existing unstaged edits in `application/service/update.rs` and `infrastructure/sqlite/mapping.rs` when staging commits.

---

### Task 1: Persist the rolling target

**Files:**
- Modify: `todo-engine/src/domain/model.rs`
- Modify: `todo-engine/src/application/service/creation.rs`
- Modify: `todo-engine/src/application/service/update.rs`
- Modify: `todo-engine/src/infrastructure/sqlite/schema.rs`
- Modify: `todo-engine/src/infrastructure/sqlite/mapping.rs`
- Modify: `todo-engine/src/infrastructure/sqlite/repo.rs`
- Test: `todo-engine/tests/unit/model.rs`
- Test: `todo-engine/tests/integration/repository.rs`

**Interfaces:**
- Produces: `TodoItem::future_occurrences: i64`, `ProposeRoutine::future_occurrences: i64`, and `UpdateItem::future_occurrences: Option<i64>`.
- Produces: domain constants `DEFAULT_FUTURE_OCCURRENCES: i64 = 7` and `MAX_FUTURE_OCCURRENCES: i64 = 365`; application and interfaces import these inward-facing definitions.

- [ ] **Step 1: Write failing model and legacy-schema tests**

Add assertions that `TodoItem::new(...).future_occurrences == 7`, that a routine target round-trips through `SqliteTodoRepository`, and that `init_schema()` adds `future_occurrences INTEGER NOT NULL DEFAULT 7` to a populated legacy `items` table.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `cargo test -p todo-engine --test unit model -- --nocapture && cargo test -p todo-engine --test integration repository -- --nocapture`

Expected: compilation or assertion failure because `future_occurrences` does not exist.

- [ ] **Step 3: Add the minimal field, validation, and persistence mapping**

Add this field and default:

```rust
pub future_occurrences: i64,
// in TodoItem::new
future_occurrences: DEFAULT_FUTURE_OCCURRENCES,
```

Validate creation and update through one helper:

```rust
pub const DEFAULT_FUTURE_OCCURRENCES: i64 = 7;
pub const MAX_FUTURE_OCCURRENCES: i64 = 365;

pub(super) fn validate_future_occurrences(value: i64) -> TodoResult<i64> {
    if !(1..=MAX_FUTURE_OCCURRENCES).contains(&value) {
        return Err(TodoError::Validation(format!(
            "future_occurrences must be between 1 and {MAX_FUTURE_OCCURRENCES}: {value}"
        )));
    }
    Ok(value)
}
```

Add `future_occurrences INTEGER NOT NULL DEFAULT 7` to table creation and `ITEM_COLUMN_ADDITIONS`, then add the field to the shared SELECT, row indices, INSERT/UPSERT, and params list.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `cargo test -p todo-engine --test unit model -- --nocapture && cargo test -p todo-engine --test integration repository -- --nocapture`

Expected: PASS.

### Task 2: Replace date windows with rolling fill behavior

**Files:**
- Modify: `todo-engine/src/domain/recurrence.rs`
- Modify: `todo-engine/src/application/service/materialization.rs`
- Modify: `todo-engine/src/application/service/transitions.rs`
- Modify: `todo-engine/src/application/service/mod.rs`
- Test: `todo-engine/tests/unit/recurrence.rs`
- Test: `todo-engine/tests/integration/materialization.rs`

**Interfaces:**
- Produces: `future_occurrences(rule: &str, anchor: Date, after: Date, count: usize) -> Result<Vec<Date>, RecurrenceError>`.
- Produces: `TodoService::materialize_routines(&mut self, today: &str) -> TodoResult<Vec<TodoItem>>`.
- Produces: `TodoService::materialize_routine(&mut self, routine_id: &str, today: &str, future_occurrences: Option<i64>) -> TodoResult<Vec<TodoItem>>`.

- [ ] **Step 1: Write failing recurrence and service tests**

Cover these exact behaviors:

```rust
assert_eq!(
    future_occurrences("RRULE:FREQ=DAILY;INTERVAL=2", date!(2026-05-31), date!(2026-06-04), 2).unwrap(),
    vec![date!(2026-06-06), date!(2026-06-08)],
);
```

- Activating a `per_occurrence` routine with target `3` creates three tasks from the activation date forward.
- Activating a `single_open` routine creates exactly one task even when its stored target is `7`.
- Completing one generated task creates one task after the latest generated occurrence and restores the open count.
- Completing an older generated task still appends after the latest occurrence.
- Completing a task while its routine is paused creates nothing.
- Reducing `future_occurrences` from `7` to `3` keeps all seven tasks and creates nothing until the open count falls below three.
- Repeating materialization is idempotent.
- Invalid recurrence rules fail activation before the routine becomes active.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `cargo test -p todo-engine --test unit recurrence -- --nocapture && cargo test -p todo-engine --test integration materialization -- --nocapture`

Expected: failures from the old date-window API and absent automatic fill.

- [ ] **Step 3: Implement the recurrence candidate helper**

Reuse the existing recurrence parser and occurrence generators. Anchor the sequence at the first generated occurrence (or today for a new routine), filter candidates to dates strictly after `after`, expand the checked date horizon only until `count` candidates exist, and return `RecurrenceError` if the supported date range cannot supply the requested count. Do not add a dependency or a second recurrence parser.

- [ ] **Step 4: Implement one centralized service fill path**

The helper must:

```rust
fn fill_routine(&mut self, routine: &mut TodoItem, today: Date) -> TodoResult<Vec<TodoItem>>
```

It loads routine-linked tasks, counts non-terminal work, computes the effective target (`1` or `future_occurrences`), returns without deleting when already at/above target, generates only dates on/after today and after the latest generated occurrence, and calls the existing `claim_occurrence` for each shortage.

Activation validates the rule before storing the active state, then fills it using `activated.updated_at.date()`. Completion stores and records the completed occurrence, reloads the active parent routine, and fills it using `completed.updated_at.date()`. Resuming a routine fills any shortage left while it was paused.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `cargo test -p todo-engine --test unit recurrence -- --nocapture && cargo test -p todo-engine --test integration materialization -- --nocapture`

Expected: PASS.

### Task 3: Update CLI, HTTP API, and frontend controls

**Files:**
- Modify: `todo-engine/src/interfaces/cli/mod.rs`
- Modify: `todo-engine/src/interfaces/cli/create.rs`
- Modify: `todo-engine/src/interfaces/cli/views.rs`
- Modify: `todo-engine/src/interfaces/cli/markdown.rs`
- Modify: `todo-engine/src/interfaces/api/dto.rs`
- Modify: `todo-engine/src/interfaces/api/handlers.rs`
- Modify: `frontend/src/features/workbench/model/workbench-model.ts`
- Modify: `frontend/src/features/workbench/hooks/useWorkbenchController.ts`
- Modify: `frontend/src/features/workbench/ui/MainPanel.tsx`
- Test: `todo-engine/tests/e2e/cli.rs`
- Test: `todo-engine/tests/e2e/api.rs`
- Test: `frontend/tests/presentation/workbench-wireframe.spec.tsx`

**Interfaces:**
- HTTP request: `{ "future_occurrences": 7 }`.
- HTTP response remains `{ "routine": TodoItem, "created": TodoItem[] }`.
- Frontend model: `MaterializeRoutineTarget = { future_occurrences: number }`.

- [ ] **Step 1: Write failing CLI/API/UI tests**

Assert that routine creation accepts and returns `future_occurrences`, activation returns an active routine with generated tasks queryable through `/items`, materialization validates `0` and `366`, and the UI sends exactly:

```ts
JSON.stringify({ future_occurrences: 3 })
```

The detail panel must show one `Future occurrences` number input and no catchup/lookahead inputs.

- [ ] **Step 2: Run the surface tests and verify RED**

Run: `cargo test -p todo-engine --test e2e -- --nocapture`

Run: `npm test --prefix frontend -- --run frontend/tests/presentation/workbench-wireframe.spec.tsx`

Expected: failures because the old request and controls still use day windows.

- [ ] **Step 3: Wire the new field through CLI and API**

- Add `--future-occurrences` with default `7` to `routine propose` and as an optional field to `update`.
- Make the global CLI `routine materialize` fill each active routine's stored target; remove `--now`, `--lookahead-days`, and `--catchup-days`.
- Add optional `future_occurrences` to routine proposal and update DTOs.
- Replace `RoutineMaterializeBody` with one required integer field and pass it to the named service action.

- [ ] **Step 4: Replace the frontend date-window control**

Use the routine's stored value as input state:

```ts
export type MaterializeRoutineTarget = { future_occurrences: number };
export const DEFAULT_FUTURE_OCCURRENCES = 7;
export const MAX_FUTURE_OCCURRENCES = 365;
```

Render one bounded number input labeled `Future occurrences`; submit the target through `materializeRoutine`, update the returned routine, and preserve the existing created-task insertion behavior.

- [ ] **Step 5: Run surface tests and verify GREEN**

Run: `cargo test -p todo-engine --test e2e -- --nocapture && npm test --prefix frontend -- --run frontend/tests/presentation/workbench-wireframe.spec.tsx && npm run typecheck --prefix frontend`

Expected: PASS.

### Task 4: Synchronize final-state docs and verify end to end

**Files:**
- Modify: `README.md`
- Modify: `docs/operations/cli-reference.md`
- Modify: `docs/operations/api-reference.md`
- Modify: `docs/operations/verification-and-smoke.md` only if smoke commands changed.

**Interfaces:**
- Documents the same `future_occurrences` name, default `7`, range `1..=365`, and non-destructive reduction rule as the code.

- [ ] **Step 1: Update current-state documentation**

Replace date-window materialization descriptions with activation/completion rolling behavior. Document `single_open`, `per_occurrence`, the manual repair action, CLI flags, API payload, and additive SQLite column without migration history prose.

- [ ] **Step 2: Run documentation and source consistency searches**

Run: `rg -n "lookahead_days|catchup_days|DEFAULT_LOOKAHEAD|DEFAULT_CATCHUP|MaterializeRoutineWindow" README.md docs todo-engine/src frontend/src todo-engine/tests frontend/tests`

Expected: no stale production/reference usage; historical design files may remain unchanged.

- [ ] **Step 3: Run full quality gates**

Run: `cargo fmt --check`

Run: `cargo test`

Run: `cargo clippy --all-targets --all-features -- -D warnings`

Run: `npm test --prefix frontend`

Run: `npm run typecheck --prefix frontend`

Expected: all commands PASS.

- [ ] **Step 4: Run a throwaway-home smoke check**

Build the binary, initialize a temporary home, create and activate a daily `per_occurrence` routine with target `2`, verify two tasks exist, complete the first task, and verify a third occurrence exists while exactly two remain non-terminal. Never point the run at `~/.todo-engine`.

- [ ] **Step 5: Inspect final repository state**

Confirm the feature diff contains no debug output or unrelated edits, the two pre-existing user hunks remain preserved, and the structured-commit safety stash is dropped only after every intended commit is present.
