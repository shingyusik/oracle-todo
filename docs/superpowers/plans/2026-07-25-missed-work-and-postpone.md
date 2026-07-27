# Missed Work and Postpone Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Replace the obsolete `someday` status with visible terminal `missed` work, and make the Planner’s compact **Miss** action distinguish between recording an uncompleted item and recording it while scheduling a detached copy for tomorrow.

**Architecture:** Keep policy in `TodoService`. The service performs all source, follow-up, routine-materialization, and audit writes in one SQLite transaction. HTTP/CLI remain thin adapters. The frontend sends its browser-local tomorrow explicitly, owns the confirmation dialog, and reconciles both returned records into the Planner/Workspace collections.

**Tech Stack:** Rust 2024, rusqlite, axum, clap, React, TypeScript, Vitest/Testing Library.

## Global Constraints

- `ItemStatus::Missed` is terminal but **not hidden by default**. `someday` is removed from the enum, parsing, UI, docs, and new writes; schema initialization migrates existing `someday` rows to `missed`.
- Only an `active` task or event is eligible for the Miss UI and miss/postpone service actions. Completed, terminal, containers, and routines themselves are rejected.
- `miss` marks the source `missed` and creates no detached copy. If the source is routine-generated, it atomically replenishes the routine’s next occurrence.
- `postpone` marks the source `missed`, creates one detached active task/event at the supplied future date, and (for a routine-generated source) atomically replenishes the routine occurrence too. The detached copy has no `routine_id`, `occurrence_key`, or `generated_by`; links are audit metadata only.
- The browser computes and sends tomorrow as `YYYY-MM-DD`; the Planner must never depend on API/server timezone to choose a date.
- Do not force-hide missed rows. Make them eligible for Planner visibility and expose `missed` in status filters/groups; the user controls hiding through filters.
- Preserve existing audit-event and `TodoService` invariants. A failure in any write must leave no partial source/follow-up/routine state.

---

### Task 1: Replace the status model and migrate persisted `someday` data

**Files:**
- Modify: `todo-engine/src/domain/status.rs`
- Modify: `todo-engine/src/infrastructure/sqlite/schema.rs`
- Modify: `todo-engine/tests/unit/status.rs` (or the existing status-focused unit module registered by `todo-engine/tests/unit.rs`)
- Modify: `todo-engine/tests/integration/schema_indexes.rs`
- Modify: `todo-engine/tests/integration/repository.rs`

**Step 1: Add failing domain and migration tests.**

Cover these contracts before implementation:

```rust
assert_eq!(ItemStatus::Missed.as_str(), "missed");
assert!(terminal_status(ItemStatus::Missed));
assert!(!hidden_by_default_status(ItemStatus::Missed));
assert!("someday".parse::<ItemStatus>().is_err());
// A pre-existing DB row with status='someday' is status='missed' after init_schema.
```

Also retain the legacy `proposed`/`approved` normalization assertion and add a list/filter round-trip for a stored `missed` item so SQLite decoding is covered.

**Step 2: Implement the status replacement.**

- Replace `Someday` with `Missed` everywhere in `ItemStatus`, `terminal_status`, `as_str`, and `FromStr`.
- Keep `Missed` out of `hidden_by_default_status` and out of `OPEN_STATUSES`; it is historical/terminal, not active date-view work.
- In additive schema initialization, normalize legacy rows with a single safe update (or two ordered updates): `proposed`/`approved → active` and `someday → missed`.

**Step 3: Run focused tests.**

Run: `cargo test -p todo-engine --test unit` and `cargo test -p todo-engine --test integration`

**Step 4: Commit.**

```text
[CHANGE] Replace someday with missed status
```

### Task 2: Make Miss and Postpone policy-enforced, atomic service operations

**Files:**
- Modify: `todo-engine/src/application/service/transitions.rs`
- Modify: `todo-engine/src/application/service/mod.rs` (only if shared helpers/types need module exposure)
- Modify: `todo-engine/src/application/service/routines.rs` (only if the existing routine write helper belongs there)
- Modify: `todo-engine/tests/integration/service_policy.rs`
- Modify: `todo-engine/tests/integration/materialization.rs`

**Step 1: Add failing service tests.**

Cover normal task/event and routine-generated task paths:

```rust
let missed = service.miss("task_1", "2026-07-25", Some("..."))?;
assert_eq!(missed.status, ItemStatus::Missed);

let (source, follow_up) = service.postpone("event_1", "2026-07-26", "2026-07-25", None)?;
assert_eq!(source.status, ItemStatus::Missed);
assert_eq!(follow_up.status, ItemStatus::Active);
assert_eq!(follow_up.scheduled.as_deref(), Some("2026-07-26"));
assert_eq!(follow_up.routine_id, None);
assert_eq!(follow_up.occurrence_key, None);
assert_ne!(follow_up.metadata.get("generated_by"), Some(&json!("routine")));
```

Assert that both actions reject non-task/event and non-active inputs; postpone rejects malformed, same-day, and past dates. For a routine-generated source, assert the source is missed, the appropriate next routine occurrence exists, and only postpone has an additional detached follow-up. Add an injected persistence failure assertion that no partial writes survive.

**Step 2: Refactor transition preparation around one missed-source helper.**

- Add `TodoService::miss(item_id, today, reason) -> TodoResult<TodoItem>`.
- Centralize eligibility, before-snapshot, timestamping, source mutation (`status = Missed`, no artificial archive), audit metadata, and optional routine replenishment preparation so `miss` and `postpone` cannot drift.
- Change `postpone` to compose that preparation plus a detached active follow-up and persist the complete write batch once.
- Preserve meaningful audit actions: source `miss`, source `postpone`, detached `postpone_follow_up`, and the existing routine materialization events. Set reciprocal `missed_to`/`postponed_from` metadata only as traceability; do not use metadata to drive visibility.
- Ensure routine replenishment is prepared from the missed occurrence and committed in the same `store_items_and_events` batch.

**Step 3: Run service tests.**

Run: `cargo test -p todo-engine --test integration service_policy materialization`

**Step 4: Commit.**

```text
[ADD] Record missed and postponed work atomically
```

### Task 3: Align CLI/HTTP adapters, external contracts, and engine documentation

**Files:**
- Modify: `todo-engine/src/interfaces/api/dto.rs`
- Modify: `todo-engine/src/interfaces/api/mod.rs`
- Modify: `todo-engine/src/interfaces/api/handlers.rs`
- Modify: `todo-engine/src/interfaces/cli/mod.rs`
- Modify: `todo-engine/src/interfaces/cli/lifecycle.rs`
- Modify: `todo-engine/tests/e2e/api.rs`
- Modify: `todo-engine/tests/e2e/cli.rs`
- Modify: `README.md`
- Modify: `docs/operations/cli-reference.md`
- Modify: `docs/operations/api-reference.md`

**Step 1: Add failing adapter tests.**

Test `POST /items/:id/miss` returns the missed source, and `POST /items/:id/postpone` requires an explicit future `scheduled` date and returns `{ source, follow_up }` with source status `missed`. Verify invalid/missing scheduling input gets the documented policy/validation response. Add CLI tests for `miss ITEM_ID`, explicit `postpone ITEM_ID --scheduled YYYY-MM-DD`, and the documented CLI-local default when the flag is omitted.

**Step 2: Implement thin adapters.**

- Add `MissBody { reason: Option<String> }`, the `POST /items/:id/miss` route, and its handler.
- Make `PostponeBody.scheduled` required for HTTP. Remove the handler’s server-derived fallback so frontend scheduling cannot shift at a UTC/KST boundary.
- Add the `miss` CLI command. Preserve CLI convenience by allowing its existing local-process tomorrow default only when `--scheduled` is omitted; document that it is a CLI-local default. The browser never uses this fallback.
- Map all calls directly to `TodoService`; do not replicate status or routine policy in adapters.
- Replace public `someday` references with `missed` and document the two actions, routine behavior, visibility, and explicit HTTP schedule requirement.

**Step 3: Run adapter and documentation checks.**

Run: `cargo test -p todo-engine --test e2e` and `rg -n "someday" README.md docs todo-engine/src todo-engine/tests`

**Step 4: Commit.**

```text
[CHANGE] Expose missed work lifecycle
```

### Task 4: Replace Planner Postpone UI with a browser-local Miss dialog

**Files:**
- Modify: `frontend/src/features/workbench/model/workbench-model.ts`
- Modify: `frontend/src/features/workbench/hooks/useWorkbenchController.ts`
- Modify: `frontend/src/features/workbench/model/planner-model.ts`
- Modify: `frontend/src/features/workbench/model/planner-group-settings.ts`
- Modify: `frontend/src/features/workbench/ui/MainPanel.tsx`
- Modify: `frontend/src/styles/globals.css`
- Modify: `frontend/tests/presentation/use-workbench-controller.spec.tsx`
- Modify: `frontend/tests/presentation/workbench-wireframe.spec.tsx`

**Step 1: Add failing UI/controller tests.**

Test each Planner table (monthly, weekly, daily) exposes one compact **Miss** action only for active tasks/events. It opens an accessible confirmation dialog with **Mark missed**, **Miss and postpone**, and **Cancel**.

Mock the API and assert:

```ts
// Browser-local date, not an empty body / server default.
expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/postpone"), expect.objectContaining({
  body: JSON.stringify({ scheduled: "2026-07-26" }),
}));
```

Verify Mark missed replaces the source with `missed`; Miss and postpone replaces the source and inserts/updates the returned follow-up without losing the current Planner collection/context. Verify no postpone date UI remains in the detail panel. Verify `missed` is available in status filters/groups and remains visible until the user’s own filter excludes it.

**Step 2: Extend controller contracts and collection reconciliation.**

- Add a `missWorkspaceItem` API helper/controller operation and retain `postponeWorkspaceItem` only as the modal’s second action.
- Pass `browserTomorrow()` (a local calendar-date helper, not `toISOString()`) to postpone explicitly.
- Generalize the current collection-update helper so both source and optional follow-up are reconciled in `items`, `allItems`, selected detail state, and any related-item cache without assuming that a terminal item should be removed.
- Surface pending/error state in the dialog and prevent duplicate submission.

**Step 3: Replace visual controls.**

- Remove the detail-panel postponement date/button and all associated draft/pending state.
- Replace `PlannerPostponeButton` with a compact `Miss` button beside the existing completion control; it opens the dialog rather than performing an immediate mutation.
- Reuse the app’s existing portal/backdrop/focus conventions for an accessible confirmation dialog, including Escape/Cancel and focus restoration.
- Expand task/work-item status option lists and Planner status label/candidate lists with English `missed`.
- Update Planner terminal visibility logic: `missed` is terminal for transitions but task/event rows remain eligible in their scheduled Planner day; do not add it to default hidden filtering.
- Rename/delete obsolete postpone-specific CSS so only the Miss button/dialog styles remain.

**Step 4: Run frontend tests and checks.**

Run: `cd frontend && npm test -- --run`, then `npm run lint` (or the repository’s established frontend check command) and `rg -n "someday|Postpone to|planner-postpone" frontend/src frontend/tests`.

**Step 5: Commit.**

```text
[CHANGE] Add Planner missed-work dialog
```

### Task 5: End-to-end verification and final documentation sync

**Files:**
- Modify only if verification reveals a real gap: files from Tasks 1–4
- Review: `docs/superpowers/specs/2026-07-24-postpone-items-design.md`

**Step 1: Build and run the full automated gates.**

```bash
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test
cd frontend && npm test -- --run
```

**Step 2: Smoke-test with a throwaway data home.**

- Create a normal task and event scheduled today; exercise miss and postpone.
- Confirm missed source rows stay listable/filterable and do not appear as active date-view work.
- Confirm postponed detached copies appear on the supplied next-day agenda.
- Create a routine occurrence and verify Miss replenishes the routine, while Miss and postpone also produces exactly one detached next-day copy.
- Confirm schema initialization leaves no persisted `someday` rows and that user-facing text contains no obsolete `someday` status.

**Step 3: Sync any wording discovered during verification and commit fixes only if needed.**

```text
[FIX] Verify missed work lifecycle
```
