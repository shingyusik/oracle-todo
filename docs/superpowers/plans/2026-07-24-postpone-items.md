# Postpone Items Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users postpone task and event work without losing the original daily record or altering routine recurrence.

**Architecture:** A `TodoService::postpone` operation atomically changes the source item to `someday` and creates a linked, active follow-up. SQLite persists the paired item/event writes in one transaction. HTTP and CLI expose the service operation; the Planner uses a dedicated controller method so it can replace the source and insert the follow-up in client state.

**Tech Stack:** Rust 2024, rusqlite, axum, clap, React, TypeScript, Vitest, Testing Library.

## Global Constraints

- Support only `task` and `event`; routine templates and terminal items are rejected.
- Preserve the original item's scheduled date; use existing `someday` status without renaming it.
- Default to the local next calendar day; explicit targets must be ISO dates later than the local current day.
- Copy title, description, note, tags, priority, area, project, parent, and due date to the follow-up.
- A follow-up keeps the source item type, stores `postponed_from`, and the source stores `postponed_to`.
- A routine-generated source records its occurrence and refills its configured materialization target; its follow-up is an independent task.
- Every persisted mutation writes a `TodoEvent`; source and follow-up writes are atomic.
- Planner status labels remain English. Do not add a special postponed-items view.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `todo-engine/src/application/ports.rs` | Add the batch item/event persistence port needed by a two-item atomic mutation. |
| `todo-engine/src/infrastructure/sqlite/repo.rs` | Implement the batch port with one SQLite transaction. |
| `todo-engine/src/application/service/mod.rs` | Build and persist a batch of item/event audit writes while keeping in-memory behavior consistent. |
| `todo-engine/src/application/service/transitions.rs` | Validate, clone, link, defer, and replenish postponed items. |
| `todo-engine/src/interfaces/api/{dto.rs,handlers.rs,mod.rs}` | Define and serve `POST /items/:id/postpone`. |
| `todo-engine/src/interfaces/cli/{mod.rs,lifecycle.rs}` | Add `postpone <item_id> [--scheduled YYYY-MM-DD] [--reason ...]`. |
| `frontend/src/features/workbench/{model/workbench-model.ts,hooks/useWorkbenchController.ts,ui/MainPanel.tsx}` | Add controller state/API handling plus Planner and detail-panel controls. |
| `frontend/src/styles/globals.css` | Style the compact Planner postpone control. |
| `todo-engine/tests/{integration/service_policy.rs,integration/repository.rs,e2e/api.rs,e2e/cli.rs}` | Cover service semantics, transaction behavior, and public adapters. |
| `frontend/tests/presentation/{use-workbench-controller.spec.tsx,workbench-wireframe.spec.tsx}` | Cover client state updates and the shared Daily/Weekly/Monthly Planner control. |
| `README.md`, `docs/operations/cli-reference.md`, `docs/operations/api-reference.md` | Document the completed public behavior. |

### Task 1: Add atomic paired persistence

**Files:**
- Modify: `todo-engine/src/application/ports.rs`
- Modify: `todo-engine/src/application/service/mod.rs`
- Modify: `todo-engine/src/infrastructure/sqlite/repo.rs`
- Test: `todo-engine/tests/integration/repository.rs`

**Interfaces:**
- Consumes: existing `TodoStore::save_item_and_event(&TodoItem, &TodoEvent)`.
- Produces: `TodoStore::save_items_and_events(&[(TodoItem, TodoEvent)]) -> TodoResult<()>` and `TodoService::store_items_and_events(...) -> TodoResult<Vec<TodoItem>>`.

- [ ] **Step 1: Write a failing SQLite batch-transaction test**

  Add a repository integration test that creates two items and two audit events, persists them through `save_items_and_events`, then verifies both items and both events are visible. Add a second case with a duplicate event ID in the batch and assert the call returns `TodoError::Storage` and neither item is visible afterward.

  ```rust
  let error = store.save_items_and_events(&[
      (first_item, first_event),
      (second_item, duplicate_id_event),
  ]).unwrap_err();
  assert!(matches!(error, TodoError::Storage(_)));
  assert!(store.get_item("task_first").unwrap().is_none());
  ```

- [ ] **Step 2: Run the focused test and verify it fails**

  Run: `cargo test -p todo-engine --test integration repository -- --nocapture`

  Expected: compilation failure because `save_items_and_events` does not exist.

- [ ] **Step 3: Add the batch storage API and implementation**

  Extend `TodoStore` with `save_items_and_events`. In `SqliteTodoRepository`, begin one `rusqlite::Transaction`, call the existing `save_item_on` and `save_event_on` for every pair, then commit only after the loop completes.

  Add a service helper that constructs every `TodoEvent` before persistence, delegates one batch to persistent storage, and only then pushes the events into `TodoService.events`. For `InMemory`, insert all final item values and append all events after successful event construction; it has no fallible store operation.

  ```rust
  fn save_items_and_events(&mut self, writes: &[(TodoItem, TodoEvent)]) -> TodoResult<()> {
      let transaction = self.conn.transaction().map_err(storage_error)?;
      for (item, event) in writes {
          save_item_on(&transaction, item)?;
          save_event_on(&transaction, event)?;
      }
      transaction.commit().map_err(storage_error)
  }
  ```

- [ ] **Step 4: Run focused persistence tests**

  Run: `cargo test -p todo-engine --test integration repository -- --nocapture`

  Expected: PASS, including the rollback assertion.

- [ ] **Step 5: Commit the atomic persistence primitive**

  ```bash
  git add todo-engine/src/application/ports.rs todo-engine/src/application/service/mod.rs todo-engine/src/infrastructure/sqlite/repo.rs todo-engine/tests/integration/repository.rs
  git commit -m $'[ADD] Persist item batches atomically\n\n- 복수 항목과 감사 이벤트를 하나의 SQLite 트랜잭션으로 저장\n- 중간 저장 실패 시 부분 항목이 남지 않도록 보장'
  ```

### Task 2: Implement service-level postponement

**Files:**
- Modify: `todo-engine/src/application/service/transitions.rs`
- Modify: `todo-engine/src/application/service/mod.rs`
- Test: `todo-engine/tests/integration/service_policy.rs`
- Test: `todo-engine/tests/integration/materialization.rs`

**Interfaces:**
- Consumes: `TodoService::store_items_and_events`, `record_generated_task_occurrence`, and `fill_routine_to_target`.
- Produces: `TodoService::postpone(&mut self, item_id: &str, target_date: &str, today: &str, reason: Option<&str>) -> TodoResult<(TodoItem, TodoItem)>`, returning `(source, follow_up)`.

- [ ] **Step 1: Write failing service tests for ordinary task and event postponement**

  Add tests that create an active task and an event, postpone them from `2026-05-31` to `2026-06-01`, then assert the source is `someday`, keeps its original schedule, and has `metadata["postponed_to"]`. Assert the follow-up has the same type, copied business fields (including `due`), an active status, the target schedule, no terminal timestamp, and `metadata["postponed_from"]`.

  ```rust
  let (source, follow_up) = service.postpone(&task.id, "2026-06-01", "2026-05-31", None)?;
  assert_eq!(source.status, ItemStatus::Someday);
  assert_eq!(follow_up.scheduled.as_deref(), Some("2026-06-01"));
  assert_eq!(follow_up.metadata["postponed_from"], task.id);
  ```

  Add cases for a second postponement (a three-item chain), a `paused` source, invalid dates, today/past targets, terminal sources, and unsupported types. Assert two postpone-specific audit actions are emitted for each successful postpone.

- [ ] **Step 2: Write a failing routine-generated-task test**

  In `materialization.rs`, create a daily `single_open` routine, materialize its occurrence, postpone that generated task, and assert the source occurrence is recorded as `someday`. Assert the follow-up has no `routine_id`, no `occurrence_key`, and no `generated_by` marker; assert a newly materialized routine task restores the routine's open target.

- [ ] **Step 3: Run the focused service tests and verify they fail**

  Run: `cargo test -p todo-engine --test integration service_policy materialization -- --nocapture`

  Expected: compilation failure because `TodoService::postpone` does not exist.

- [ ] **Step 4: Implement `TodoService::postpone`**

  Parse both dates using `parse_day`; reject targets not later than `today`. Fetch the source, require `Task` or `Event`, and allow only `Active`, `Waiting`, or `Paused` statuses. Generate the follow-up ID before mutating the source, copy the approved fields, set the follow-up to `Active`, clear `completed_at`/`archived_at`, set its target schedule, clear routine provenance, and install the bidirectional metadata IDs.

  Set the source status to `Someday`, set `archived_at` and `updated_at`, create both audit snapshots with actions `postpone` and `postpone_follow_up`, then persist the two writes through the Task 1 batch helper. When the source is routine-generated, call `record_generated_task_occurrence` and `fill_routine_to_target` after the paired write, using the parsed `today` date.

  ```rust
  if !matches!(source.item_type, ItemType::Task | ItemType::Event) {
      return Err(TodoError::Policy("Only tasks and events can be postponed".to_string()));
  }
  if !matches!(source.status, ItemStatus::Active | ItemStatus::Waiting | ItemStatus::Paused) {
      return Err(TodoError::Policy(format!("Cannot postpone item in status {}", source.status.as_str())));
  }
  ```

- [ ] **Step 5: Run service and full Rust quality gates**

  Run: `cargo test -p todo-engine --test integration service_policy materialization -- --nocapture && cargo fmt --check && cargo clippy --all-targets --all-features -- -D warnings`

  Expected: all commands PASS.

- [ ] **Step 6: Commit the service behavior**

  ```bash
  git add todo-engine/src/application/service/mod.rs todo-engine/src/application/service/transitions.rs todo-engine/tests/integration/service_policy.rs todo-engine/tests/integration/materialization.rs
  git commit -m $'[ADD] Postpone task and event work\n\n- 원본을 someday로 보존하고 연결된 후속 항목을 생성\n- 루틴 발생 회차 기록과 생성 목표 보충을 유지'
  ```

### Task 3: Expose postpone through HTTP, CLI, and references

**Files:**
- Modify: `todo-engine/src/interfaces/api/dto.rs`
- Modify: `todo-engine/src/interfaces/api/handlers.rs`
- Modify: `todo-engine/src/interfaces/api/mod.rs`
- Modify: `todo-engine/src/interfaces/cli/mod.rs`
- Modify: `todo-engine/src/interfaces/cli/lifecycle.rs`
- Modify: `todo-engine/tests/e2e/api.rs`
- Modify: `todo-engine/tests/e2e/cli.rs`
- Modify: `README.md`
- Modify: `docs/operations/cli-reference.md`
- Modify: `docs/operations/api-reference.md`

**Interfaces:**
- Consumes: `TodoService::postpone` from Task 2 and `local_today_string()`.
- Produces: `POST /items/:id/postpone` returning `{"source": TodoItem, "follow_up": TodoItem}` and `todo-engine postpone <item_id> [--scheduled <ISO_DATE>] [--reason <TEXT>]`.

- [ ] **Step 1: Write failing API and CLI end-to-end tests**

  Add API cases for an omitted target date (assert tomorrow relative to `local_today_string()`), an explicit target, an event, a routine-generated task, and a today/past-date rejection with HTTP 400. Assert the API response contains both `source` and `follow_up` and that a subsequent `GET /items?status=someday` returns the source.

  Add a CLI scenario that initializes a temporary home, creates a scheduled task, runs `postpone <id> --scheduled 2099-01-02`, and asserts JSON includes a `someday` source plus an active follow-up with that date. Add `postpone --help` coverage for `--scheduled`.

- [ ] **Step 2: Run adapter tests and verify they fail**

  Run: `cargo test -p todo-engine --test e2e api cli -- --nocapture`

  Expected: route and subcommand are unavailable.

- [ ] **Step 3: Add the HTTP endpoint**

  Add `PostponeBody { scheduled: Option<String>, reason: Option<String> }`. Register `POST /items/:id/postpone`. In its handler, resolve a missing date as `parse_day(&local_today_string())?.next_day()` and pass an ISO date plus local today to the service. Return:

  ```rust
  Ok(Json(json!({"source": source, "follow_up": follow_up})))
  ```

  Do not accept malformed JSON as an implicit default; map it with the existing `validation_rejection` path.

- [ ] **Step 4: Add the CLI command**

  Add a `PostponeArgs` struct with `item_id`, optional `--scheduled`, and optional `--reason`; add the `Postpone` command and command-label match arm. In `lifecycle::postpone`, derive tomorrow from `today_string()` when `scheduled` is absent, call the service, and print the same `{source, follow_up}` JSON shape as the API.

- [ ] **Step 5: Update public documentation**

  Add `postpone` to the lifecycle command list and document its default, explicit date restriction, source/follow-up behavior, and routine detachment. Add the HTTP endpoint and response shape to `README.md` and `docs/operations/api-reference.md`. State that `someday` remains filterable and keeps its original scheduled date.

- [ ] **Step 6: Run adapter tests and Rust gates**

  Run: `cargo test -p todo-engine --test e2e api cli -- --nocapture && cargo test && cargo fmt --check && cargo clippy --all-targets --all-features -- -D warnings`

  Expected: all commands PASS.

- [ ] **Step 7: Commit adapters and docs**

  ```bash
  git add todo-engine/src/interfaces todo-engine/tests/e2e README.md docs/operations/cli-reference.md docs/operations/api-reference.md
  git commit -m $'[ADD] Expose postponed item workflow\n\n- HTTP와 CLI에서 기본 내일 미루기 및 날짜 지정 미루기 제공\n- 공개 사용법과 상태 기반 회고 방법을 문서화'
  ```

### Task 4: Add Planner postpone controls and client-state handling

**Files:**
- Modify: `frontend/src/features/workbench/model/workbench-model.ts`
- Modify: `frontend/src/features/workbench/hooks/useWorkbenchController.ts`
- Modify: `frontend/src/features/workbench/ui/MainPanel.tsx`
- Modify: `frontend/src/styles/globals.css`
- Test: `frontend/tests/presentation/use-workbench-controller.spec.tsx`
- Test: `frontend/tests/presentation/workbench-wireframe.spec.tsx`

**Interfaces:**
- Consumes: `POST /todo-engine/items/:id/postpone` returning `{ source, follow_up }`.
- Produces: `WorkbenchController.postponeWorkspaceItem(itemId: string, scheduled?: string): Promise<void>` and a Planner `Postpone <title>` button for active task/event rows.

- [ ] **Step 1: Write failing controller tests**

  Stub a postpone response with a `someday` source and active follow-up. Assert `postponeWorkspaceItem("task-1")` posts `{}` to the endpoint, replaces the source in both loaded collections, and adds the follow-up without duplicating it. Add an explicit-date request assertion and an API-error assertion that exposes the existing per-item transition error state.

  ```tsx
  await act(async () => {
    await result.current.postponeWorkspaceItem("task-1");
  });
  expect(fetchMock).toHaveBeenCalledWith(
    "/todo-engine/items/task-1/postpone",
    expect.objectContaining({ body: JSON.stringify({}) }),
  );
  ```

- [ ] **Step 2: Write failing Planner interaction tests**

  In the shared Planner wireframe suite, assert active task and event rows in Daily, Weekly, and Monthly expose an accessible `Postpone <title>` button beside the completion checkbox. Click it, assert one request to `/todo-engine/items/<id>/postpone`, verify duplicate rendered instances disable while pending, and assert the button is absent on completed, waiting, paused, routine, and goal rows.

- [ ] **Step 3: Run the focused frontend tests and verify they fail**

  Run: `npm --prefix frontend test -- --run frontend/tests/presentation/use-workbench-controller.spec.tsx frontend/tests/presentation/workbench-wireframe.spec.tsx`

  Expected: TypeScript compile/test failure because the controller method and button do not exist.

- [ ] **Step 4: Implement the controller method and API helper**

  Add a `PostponeResult` type and `postponeWorkspaceItem`. Reuse the existing per-item promise map and transition-state map so completion and postponement cannot race for the same item. Post `{}` for the immediate Planner action or `{ scheduled }` for an explicit date. On success replace the source in `items`/`allItems`, append the follow-up only if its ID is absent, merge tags, and refresh `detailItem` when it was the source.

  ```ts
  type PostponeResult = {
    source: WorkspaceItemModel;
    follow_up: WorkspaceItemModel;
  };

  const result = await postPostponeItem(itemId, scheduled);
  setWorkspaceItems((current) => ({
    ...current,
    items: appendWorkspaceItem(replaceWorkspaceItem(current.items, result.source), result.follow_up),
    allItems: appendWorkspaceItem(replaceWorkspaceItem(current.allItems, result.source), result.follow_up),
  }));
  ```

- [ ] **Step 5: Implement Planner and detail controls**

  Extend `PlannerItemRow` with an icon-only button labelled `Postpone ${item.title}` for active task/event items, immediately calling `postponeWorkspaceItem(item.id)`. Disable it with the shared transition state and render its error using the existing alert pattern. Add a `Postpone to…` date input/button in the task/event detail panel, set `min` to tomorrow, and call `postponeWorkspaceItem(item.id, selectedDate)`; close or replace the detail state with the returned source on success.

  Add compact button styles next to `.planner-task-checkbox`, including focus-visible, disabled, and compact-monthly behavior. Preserve the row title's remaining flexible width.

- [ ] **Step 6: Run frontend verification**

  Run: `npm --prefix frontend test -- --run frontend/tests/presentation/use-workbench-controller.spec.tsx frontend/tests/presentation/workbench-wireframe.spec.tsx && npm --prefix frontend run lint && npm --prefix frontend run build`

  Expected: all commands PASS.

- [ ] **Step 7: Commit the Planner experience**

  ```bash
  git add frontend/src/features/workbench/model/workbench-model.ts frontend/src/features/workbench/hooks/useWorkbenchController.ts frontend/src/features/workbench/ui/MainPanel.tsx frontend/src/styles/globals.css frontend/tests/presentation/use-workbench-controller.spec.tsx frontend/tests/presentation/workbench-wireframe.spec.tsx
  git commit -m $'[ADD] Postpone Planner work items\n\n- Daily·Weekly·Monthly 행에서 내일로 즉시 미루기 제공\n- 상세 화면의 날짜 지정 미루기와 후속 항목 상태 동기화 추가'
  ```

### Task 5: Run end-to-end verification and inspect the final contract

**Files:**
- Verify only: all files changed in Tasks 1-4.

**Interfaces:**
- Consumes: complete postpone workflow.
- Produces: evidence that Rust adapters, Planner behavior, formatting, linting, and documentation agree.

- [ ] **Step 1: Run the complete automated suite**

  Run: `cargo test && cargo fmt --check && cargo clippy --all-targets --all-features -- -D warnings && npm --prefix frontend test -- --run && npm --prefix frontend run lint && npm --prefix frontend run build`

  Expected: every command exits 0.

- [ ] **Step 2: Smoke test in an isolated data home**

  Run the engine with a temporary `--home`, create a routine and a normal event, postpone each, inspect `today`, `list --status someday`, the returned follow-up JSON, and the routine's generated tasks. Do not use the live data home.

  Expected: original rows retain their source date and `someday`; follow-ups are active at their target date; the routine has an independently generated occurrence.

- [ ] **Step 3: Inspect documentation and staged changes**

  Run: `git diff HEAD~4..HEAD -- README.md docs/operations/cli-reference.md docs/operations/api-reference.md && git status --short`

  Expected: documented command and endpoint match the implementation; no unintended working-tree changes.

## Plan Self-Review

- **Spec coverage:** Tasks 1-2 cover atomic source/follow-up persistence, status, links, copied fields, repeated postponement, audit events, and routine replenishment. Task 3 covers API, CLI, default/explicit dates, errors, and public docs. Task 4 covers shared Daily/Weekly/Monthly controls, detail date selection, pending/error behavior, and client-state updates. Task 5 validates the completed system.
- **Placeholder scan:** No unfinished markers or unspecified test assertions remain.
- **Type consistency:** `TodoService::postpone` returns `(TodoItem, TodoItem)`; adapters serialize them as `source` and `follow_up`; the frontend `PostponeResult` uses the same names; planner callers use `postponeWorkspaceItem`.
