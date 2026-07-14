# Planner Task Completion Checkbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users complete and reopen active/completed tasks directly from monthly, weekly, and daily planner views while preserving service policy and audit events.

**Architecture:** Add a task-only `TodoService::reopen` transition and expose it through the existing Axum item-transition API pattern. Keep completed tasks in planner models with a shared visibility predicate, then render a reusable stateful checkbox beside task title controls and update list state from the service response.

**Tech Stack:** Rust 2024, rusqlite, Axum, TypeScript, React 19, Next.js, Vitest, React Testing Library.

## Global Constraints

- SQLite remains the source of truth.
- Every mutation passes through `TodoService` and writes a `TodoEvent`.
- `activate` continues to reject terminal items.
- `reopen` accepts only tasks whose current status is `completed`.
- Reopening sets status to `active`, clears `completed_at`, and refreshes `updated_at`.
- Only active and completed tasks render planner completion checkboxes.
- Proposed, approved, waiting, and paused tasks do not render planner completion checkboxes.
- Goals, projects, routines, events, and areas do not render planner completion checkboxes.
- Completed tasks remain visible in monthly, weekly, and daily planner placement.
- Planner transition requests are non-optimistic and disable the affected checkbox while pending.

---

## File Structure

- `todo-engine/src/application/service/transitions.rs`: owns the new task-only reopen policy and audit mutation.
- `todo-engine/src/interfaces/api/mod.rs`: registers the additive `/items/:id/reopen` route.
- `todo-engine/src/interfaces/api/handlers.rs`: adapts the reopen HTTP request to `TodoService`.
- `todo-engine/tests/integration/service_policy.rs`: verifies reopen state policy and timestamps.
- `todo-engine/tests/integration/events.rs`: verifies reopen audit-event persistence.
- `todo-engine/tests/e2e/api.rs`: verifies HTTP success and policy-error mapping.
- `frontend/src/features/workbench/model/planner-model.ts`: centralizes planner visibility so completed tasks remain visible without exposing other terminal items.
- `frontend/tests/domain/planner-model.spec.ts`: verifies monthly, weekly, and daily visibility rules.
- `frontend/src/features/workbench/model/workbench-model.ts`: adds `reopen` to the transition action contract.
- `frontend/src/features/workbench/ui/MainPanel.tsx`: renders and controls planner task completion checkboxes.
- `frontend/src/styles/globals.css`: styles task rows, completed titles, checkbox controls, pending state, and inline errors.
- `frontend/tests/presentation/use-workbench-controller.spec.tsx`: verifies reopen request routing and response replacement.
- `frontend/tests/presentation/workbench-wireframe.spec.tsx`: verifies checkbox visibility, interaction, pending behavior, error behavior, and detail navigation.
- `README.md`: documents completed-task reopening in the status lifecycle and endpoint list.
- `docs/operations/api-reference.md`: documents the reopen endpoint contract.

---

### Task 1: Task Reopen Service Policy

**Files:**
- Modify: `todo-engine/tests/integration/service_policy.rs`
- Modify: `todo-engine/src/application/service/transitions.rs`

**Interfaces:**
- Consumes: `TodoService::get`, `TodoService::next_now`, `TodoService::store_item_and_event`, `ItemStatus`, `ItemType`.
- Produces: `pub fn reopen(&mut self, item_id: &str, reason: Option<&str>) -> TodoResult<TodoItem>`.

- [ ] **Step 1: Write failing service-policy tests**

Add imports for `ProposeProject`, then add:

```rust
#[test]
fn completed_task_can_be_reopened() {
    let mut service = TodoService::in_memory();
    let task = service
        .propose_task(
            "다시 할 일",
            ProposeTask {
                actor: Actor::User,
                ..Default::default()
            },
        )
        .unwrap();
    let completed = service.complete(&task.id, None).unwrap();
    assert!(completed.completed_at.is_some());

    let reopened = service.reopen(&task.id, Some("체크 해제")).unwrap();

    assert_eq!(reopened.status, ItemStatus::Active);
    assert!(reopened.completed_at.is_none());
    assert!(reopened.updated_at > completed.updated_at);
    assert_eq!(service.events().last().unwrap().action, "reopen");
    assert_eq!(service.events().last().unwrap().reason.as_deref(), Some("체크 해제"));
}

#[test]
fn reopen_rejects_non_completed_task() {
    let mut service = TodoService::in_memory();
    let task = service
        .propose_task(
            "진행 중",
            ProposeTask {
                actor: Actor::User,
                ..Default::default()
            },
        )
        .unwrap();

    let error = service.reopen(&task.id, None).unwrap_err();

    assert_eq!(
        error,
        TodoError::Policy("Cannot reopen task in status approved".to_string())
    );
}

#[test]
fn reopen_rejects_completed_non_task() {
    let mut service = TodoService::in_memory();
    let project = service
        .propose_project(ProposeProject {
            title: "완료된 프로젝트".to_string(),
            area: None,
            definition_of_done: None,
            outcome: None,
            due: None,
            actor: Actor::User,
            note: None,
            tags: Vec::new(),
        })
        .unwrap();
    service.complete(&project.id, None).unwrap();

    let error = service.reopen(&project.id, None).unwrap_err();

    assert_eq!(
        error,
        TodoError::Policy("Only completed tasks can be reopened".to_string())
    );
}
```

- [ ] **Step 2: Run the focused test binary and verify RED**

Run:

```bash
cargo test -p todo-engine --test integration service_policy::completed_task_can_be_reopened -- --exact
```

Expected: compilation fails because `TodoService::reopen` does not exist.

- [ ] **Step 3: Implement the minimal reopen transition**

Add to `impl TodoService` in `transitions.rs`:

```rust
pub fn reopen(&mut self, item_id: &str, reason: Option<&str>) -> TodoResult<TodoItem> {
    let mut item = self.get(item_id)?;
    let before = Some(serde_json::to_value(&item).map_err(|error| {
        TodoError::Internal(format!("failed to snapshot item before reopen: {error}"))
    })?);
    if item.item_type != ItemType::Task {
        return Err(TodoError::Policy(
            "Only completed tasks can be reopened".to_string(),
        ));
    }
    if item.status != ItemStatus::Completed {
        return Err(TodoError::Policy(format!(
            "Cannot reopen task in status {}",
            item.status.as_str()
        )));
    }

    let now = self.next_now();
    item.status = ItemStatus::Active;
    item.completed_at = None;
    item.updated_at = now;
    self.store_item_and_event(Actor::User, "reopen", before, item, reason)
}
```

- [ ] **Step 4: Run all service-policy tests and verify GREEN**

Run:

```bash
cargo test -p todo-engine --test integration service_policy
```

Expected: all `service_policy` tests pass.

- [ ] **Step 5: Commit the service policy**

```bash
git add todo-engine/src/application/service/transitions.rs todo-engine/tests/integration/service_policy.rs
git commit -m "[ADD] Add completed task reopen policy" -m "- completed task를 active로 복구하고 completed_at을 제거합니다.
- task 외 item과 completed 외 상태의 reopen 요청을 정책 오류로 거절합니다.
- reopen 변경을 서비스 감사 이벤트로 기록합니다."
```

---

### Task 2: Reopen HTTP API and Audit Event Coverage

**Files:**
- Modify: `todo-engine/tests/e2e/api.rs`
- Modify: `todo-engine/tests/integration/events.rs`
- Modify: `todo-engine/src/interfaces/api/mod.rs`
- Modify: `todo-engine/src/interfaces/api/handlers.rs`

**Interfaces:**
- Consumes: `TodoService::reopen(&str, Option<&str>)` from Task 1.
- Produces: `POST /items/:id/reopen -> Json<TodoItem>` and `reopen` in the every-mutation audit contract.

- [ ] **Step 1: Write failing API and persistence tests**

Extend `approve_and_complete_items_return_mutated_items` after the complete assertions:

```rust
let app = router(&db_path).unwrap();
let response = empty_request(app, "POST", format!("/items/{id}/reopen")).await;
assert_eq!(response.status(), 200);
let item = body_json(response).await;
assert_eq!(item["id"], id);
assert_eq!(item["status"], "active");
assert!(item["completed_at"].is_null());

let app = router(&db_path).unwrap();
let response = empty_request(app, "POST", format!("/items/{id}/reopen")).await;
assert_eq!(response.status(), 400);
let error = body_json(response).await;
assert_eq!(error["code"], "policy_error");
assert_eq!(error["detail"], "policy error: Cannot reopen task in status active");
```

In `events.rs`, reopen the completed task after the existing complete call:

```rust
let completed = service.complete(&active.id, None).unwrap();
service
    .reopen(&completed.id, Some("planner checkbox"))
    .unwrap();
```

Append `"reopen".to_string()` to the exact expected `actions` vector. The API test uses a file-backed router, so its successful response also exercises the repository `save_item_and_event` path.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
cargo test -p todo-engine --test e2e api::approve_and_complete_items_return_mutated_items -- --exact
cargo test -p todo-engine --test integration events::every_mutation_records_event -- --exact
```

Expected: API test returns `404 Not Found` for `/reopen`; the audit test fails because the expected action sequence does not yet include the newly exercised `reopen` action until its expectation is updated.

- [ ] **Step 3: Register the route and handler**

Add beside the complete route in `api/mod.rs`:

```rust
.route("/items/:id/reopen", post(reopen_item))
```

Add beside `complete_item` in `api/handlers.rs`:

```rust
pub(super) async fn reopen_item(
    State(state): State<ApiState>,
    AxumPath(id): AxumPath<String>,
) -> ApiResult<Json<TodoItem>> {
    let item = with_service(&state, |service| service.reopen(&id, None))?;
    Ok(Json(item))
}
```

- [ ] **Step 4: Run API, event, and formatting gates**

Run:

```bash
cargo test -p todo-engine --test e2e api::approve_and_complete_items_return_mutated_items -- --exact
cargo test -p todo-engine --test integration events
cargo fmt --check
```

Expected: all commands pass.

- [ ] **Step 5: Commit the API adapter**

```bash
git add todo-engine/src/interfaces/api/mod.rs todo-engine/src/interfaces/api/handlers.rs todo-engine/tests/e2e/api.rs todo-engine/tests/integration/events.rs
git commit -m "[ADD] Expose completed task reopen API" -m "- item reopen HTTP 경로를 TodoService 전이에 연결합니다.
- 성공 응답과 중복 reopen 정책 오류 매핑을 검증합니다.
- persistent 저장소의 reopen 감사 이벤트를 검증합니다."
```

---

### Task 3: Planner Visibility for Completed Tasks

**Files:**
- Modify: `frontend/tests/domain/planner-model.spec.ts`
- Modify: `frontend/src/features/workbench/model/planner-model.ts`

**Interfaces:**
- Consumes: `WorkspaceItemModel.type` and `.status`.
- Produces: internal `isVisiblePlannerWorkItem(item: WorkspaceItemModel): boolean`, used by monthly, weekly, and daily item buckets.

- [ ] **Step 1: Change planner-model expectations to retain completed tasks only**

Rename the existing terminal-visibility test to `keeps completed tasks visible while hiding other terminal items`. The shared fixture already contains completed task `done`; change its assertion to:

```ts
expect(visibleDailyIds).toContain("done");
expect(visibleDailyIds).not.toContain("archived");
expect(weekly.monthGoals.map((item) => item.id)).toEqual(["month-goal-active"]);
expect(weekly.weekGoals.map((item) => item.id)).toEqual(["week-goal-active"]);
expect(weekly.days[0].items.map((item) => item.id)).toEqual([
  "task-active",
  "task-completed",
]);
```

In the monthly model test, include:

```ts
item("completed-task", {
  type: "task",
  status: "completed",
  scheduled: "2026-01-08",
}),
item("completed-event", {
  type: "event",
  status: "completed",
  scheduled: "2026-01-08",
}),
```

Then assert the January 8 day contains `completed-task` and not `completed-event`.

- [ ] **Step 2: Run the planner model test and verify RED**

Run:

```bash
cd frontend && npm test -- --run tests/domain/planner-model.spec.ts
```

Expected: completed-task visibility assertions fail because terminal statuses are filtered unconditionally.

- [ ] **Step 3: Add one shared visibility predicate and use it in all three planners**

Add near `terminalStatuses`:

```ts
function isVisiblePlannerWorkItem(item: WorkspaceItemModel): boolean {
  return !terminalStatuses.has(item.status) ||
    (item.type === "task" && item.status === "completed");
}
```

Replace only the work-item terminal checks in monthly days, daily items, and weekly days:

```ts
isVisiblePlannerWorkItem(item)
```

Keep goal bucket filters on `!terminalStatuses.has(item.status)` so completed goals remain hidden.

- [ ] **Step 4: Run planner-model tests and verify GREEN**

Run:

```bash
cd frontend && npm test -- --run tests/domain/planner-model.spec.ts
```

Expected: all planner-model tests pass.

- [ ] **Step 5: Commit planner visibility**

```bash
git add frontend/src/features/workbench/model/planner-model.ts frontend/tests/domain/planner-model.spec.ts
git commit -m "[UPDATE] Keep completed tasks in planner models" -m "- completed task만 planner 날짜와 section bucket에 유지합니다.
- 다른 terminal item과 완료된 goal은 기존처럼 숨깁니다.
- 월간·주간·일간 모델이 동일한 visibility 규칙을 공유합니다."
```

---

### Task 4: Frontend Reopen Transition Contract

**Files:**
- Modify: `frontend/tests/presentation/use-workbench-controller.spec.tsx`
- Modify: `frontend/src/features/workbench/model/workbench-model.ts`

**Interfaces:**
- Consumes: generic `transitionWorkspaceItem(itemId, action)` controller implementation.
- Produces: `WorkspaceItemTransitionAction` including literal `"reopen"`.

- [ ] **Step 1: Write a failing controller reopen test**

Add beside the existing transition test:

```ts
it("reopens a completed workspace item and replaces list state", async () => {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url === "/todo-engine/items/task-1/reopen") {
      expect(init).toEqual(expect.objectContaining({
        method: "POST",
        body: JSON.stringify({}),
      }));
      return Promise.resolve({
        ok: true,
        json: async () => ({
          id: "task-1",
          type: "task",
          title: "One",
          status: "active",
          completed_at: null,
        }),
      });
    }
    return Promise.resolve({
      ok: true,
      json: async () => [
        { id: "task-1", type: "task", title: "One", status: "completed" },
      ],
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  const { result } = renderHook(() => useWorkbenchController());

  await act(async () => {
    result.current.selectTab("workspace");
    result.current.selectTab("tasks");
  });
  await vi.waitFor(() => expect(result.current.workspaceItems.status).toBe("loaded"));

  await act(async () => {
    await result.current.transitionWorkspaceItem("task-1", "reopen");
  });

  expect(result.current.workspaceItems.items[0]?.status).toBe("active");
});
```

In the existing `loads planner item sets for %s` table, replace the monthly row with the complete calendar dependency set already declared by `plannerItemTypes`:

```ts
["monthly", ["goal", "task", "event", "routine", "area", "project"]],
```

This assertion locks the monthly task-loading requirement used by Task 5.

- [ ] **Step 2: Run typecheck and verify RED**

Run:

```bash
cd frontend && npm run typecheck
```

Expected: TypeScript rejects `"reopen"` because it is not a `WorkspaceItemTransitionAction`.

- [ ] **Step 3: Add the transition literal**

Update the union in `workbench-model.ts`:

```ts
export type WorkspaceItemTransitionAction =
  | "approve"
  | "activate"
  | "pause"
  | "resume"
  | "complete"
  | "reopen"
  | "archive";
```

No controller branch is needed because `transitionWorkspaceItem` already derives the endpoint from the action and replaces the returned item.

- [ ] **Step 4: Run the focused controller test and typecheck**

Run:

```bash
cd frontend && npm test -- --run tests/presentation/use-workbench-controller.spec.tsx
cd frontend && npm run typecheck
```

Expected: both commands pass.

- [ ] **Step 5: Commit the transition contract**

```bash
git add frontend/src/features/workbench/model/workbench-model.ts frontend/tests/presentation/use-workbench-controller.spec.tsx
git commit -m "[ADD] Add frontend task reopen transition" -m "- frontend 전이 계약에 reopen action을 추가합니다.
- generic controller가 reopen endpoint 응답으로 list state를 교체하는 동작을 검증합니다."
```

---

### Task 5: Planner Task Checkbox Interaction

**Files:**
- Modify: `frontend/tests/presentation/workbench-wireframe.spec.tsx`
- Modify: `frontend/src/features/workbench/ui/MainPanel.tsx`
- Modify: `frontend/src/styles/globals.css`

**Interfaces:**
- Consumes: `controller.transitionWorkspaceItem(item.id, "complete" | "reopen")` and the Task 3 visibility behavior.
- Produces: internal `PlannerItemRow` and `PlannerTaskCompletionCheckbox` React components shared by monthly, weekly, and daily planner rendering.

- [ ] **Step 1: Write failing presentation tests for visibility and actions**

In the existing monthly presentation test, add these task fixtures to the `task` response:

```ts
{ id: "task-active", type: "task", title: "Active task", status: "active", scheduled: firstWeekStart },
{ id: "task-completed", type: "task", title: "Completed task", status: "completed", scheduled: firstWeekStart },
{ id: "task-approved", type: "task", title: "Approved task", status: "approved", scheduled: firstWeekStart },
{ id: "task-waiting", type: "task", title: "Waiting task", status: "waiting", scheduled: firstWeekStart },
```

Keep the existing `Month Event` fixture as the non-task case. Add the same five status/type cases to the existing weekly and daily presentation fixtures using each test's current selected date. In each of the three tests, assert:

```ts
expect(await screen.findByRole("checkbox", { name: "Complete Active task" })).not.toBeChecked();
expect(screen.getByRole("checkbox", { name: "Reopen Completed task" })).toBeChecked();
expect(screen.queryByRole("checkbox", { name: /Approved task/ })).toBeNull();
expect(screen.queryByRole("checkbox", { name: /Waiting task/ })).toBeNull();
expect(screen.queryByRole("checkbox", { name: /Team event/ })).toBeNull();
```

Add one daily interaction test whose fetch stub holds the `/complete` response promise with a locally captured resolver:

```ts
let resolveComplete!: (value: Response) => void;
const completeResponse = new Promise<Response>((resolve) => {
  resolveComplete = resolve;
});
const fetchMock = vi.fn((url: string) => {
  if (url === "/todo-engine/items/task-active/complete") return completeResponse;
  return Promise.resolve({
    ok: true,
    json: async () => url === "/todo-engine/items?type=task"
      ? [{ id: "task-active", type: "task", title: "Active task", status: "active", scheduled: testToday() }]
      : [],
  });
});
vi.stubGlobal("fetch", fetchMock);
```

Open `ToDo` → `Planner` → `Daily`, click the active checkbox, and assert it is disabled before resolving:

```ts
const checkbox = await screen.findByRole("checkbox", { name: "Complete Active task" });
await user.click(checkbox);
expect(checkbox).toBeDisabled();
expect(screen.queryByRole("button", { name: "Active task" })).toBeInTheDocument();
```

Resolve with a completed task, then assert the accessible name changes to `Reopen Active task` and the control is checked. Click the title before and after checkbox interaction and assert only title clicks open the detail view.

Resolve the pending request with:

```ts
resolveComplete({
  ok: true,
  json: async () => ({
    id: "task-active",
    type: "task",
    title: "Active task",
    status: "completed",
    scheduled: testToday(),
  }),
} as Response);
```

Add a separate daily test with completed task `task-completed`. Return this response for `/todo-engine/items/task-completed/reopen`:

```ts
{
  ok: false,
  status: 400,
  json: async () => ({
    code: "policy_error",
    detail: "Cannot reopen task in status active",
  }),
}
```

Click its checkbox and assert:

```ts
expect(await screen.findByRole("alert")).toHaveTextContent(
  "Cannot reopen task in status active",
);
expect(screen.getByRole("checkbox", { name: "Reopen Completed task" })).toBeChecked();
```

- [ ] **Step 2: Run the presentation test and verify RED**

Run:

```bash
cd frontend && npm test -- --run tests/presentation/workbench-wireframe.spec.tsx
```

Expected: checkbox queries fail because planner items render title buttons only.

- [ ] **Step 3: Implement reusable planner row and checkbox components**

Add near `renderPlannerGroups` in `MainPanel.tsx`:

```tsx
function PlannerItemRow({
  controller,
  item,
  compact = false,
}: {
  controller: WorkbenchController;
  item: WorkspaceItemModel;
  compact?: boolean;
}) {
  return (
    <div
      className={`planner-item-row${item.status === "completed" ? " is-completed" : ""}${compact ? " is-compact" : ""}`}
    >
      <PlannerTaskCompletionCheckbox controller={controller} item={item} />
      <button
        className={compact ? "monthly-day-item" : "planner-item"}
        type="button"
        title={compact ? item.title : undefined}
        onClick={() => controller.openDetailView(item)}
      >
        {item.title}
      </button>
    </div>
  );
}

function PlannerTaskCompletionCheckbox({
  controller,
  item,
}: {
  controller: WorkbenchController;
  item: WorkspaceItemModel;
}) {
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const visible = item.type === "task" &&
    (item.status === "active" || item.status === "completed");

  if (!visible) return null;

  const checked = item.status === "completed";
  const action: WorkspaceItemTransitionAction = checked ? "reopen" : "complete";
  const label = `${checked ? "Reopen" : "Complete"} ${item.title}`;

  const transition = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await controller.transitionWorkspaceItem(item.id, action);
    } catch (cause) {
      setError(cause instanceof TodoEngineApiError ? cause.detail : "Could not update task.");
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <input
        aria-label={label}
        checked={checked}
        className="planner-task-checkbox"
        disabled={pending}
        type="checkbox"
        onChange={() => void transition()}
      />
      {error ? <span className="planner-task-error" role="alert">{error}</span> : null}
    </>
  );
}
```

Replace the monthly title button with:

```tsx
<PlannerItemRow controller={controller} item={item} compact />
```

Replace the title button inside `renderPlannerGroups` with:

```tsx
<PlannerItemRow controller={controller} item={item} />
```

The error element should be positioned by CSS without changing title-button click behavior.

- [ ] **Step 4: Add focused planner checkbox styling**

Add to `globals.css`:

```css
.planner-item-row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.planner-item-row .planner-item,
.planner-item-row .monthly-day-item {
  min-width: 0;
  flex: 1;
}

.planner-task-checkbox {
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
  accent-color: var(--color-aloe-strong);
  cursor: pointer;
}

.planner-task-checkbox:disabled {
  cursor: wait;
  opacity: 0.55;
}

.planner-item-row.is-completed .planner-item,
.planner-item-row.is-completed .monthly-day-item {
  color: var(--color-shade-60);
  text-decoration: line-through;
}

.planner-task-error {
  position: absolute;
  top: 100%;
  left: 24px;
  z-index: 1;
  color: var(--color-danger-text);
  font-size: 11px;
}
```

- [ ] **Step 5: Run presentation tests, typecheck, and build**

Run:

```bash
cd frontend && npm test -- --run tests/presentation/workbench-wireframe.spec.tsx
cd frontend && npm run typecheck
cd frontend && npm run build
```

Expected: all commands pass and no React state-update warnings appear.

- [ ] **Step 6: Commit planner checkbox behavior**

```bash
git add frontend/src/features/workbench/ui/MainPanel.tsx frontend/src/styles/globals.css frontend/tests/presentation/workbench-wireframe.spec.tsx
git commit -m "[ADD] Add planner task completion checkboxes" -m "- 월간·주간·일간 task에 active/completed 체크박스를 표시합니다.
- 요청 중 중복 전이를 막고 실패 시 기존 상태와 inline 오류를 유지합니다.
- 체크박스와 title 상세 열기 동작을 분리하고 완료 task를 구분해 표시합니다."
```

---

### Task 6: Final Documentation and Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/operations/api-reference.md`

**Interfaces:**
- Consumes: final service and API behavior from Tasks 1-5.
- Produces: stable status-lifecycle and API documentation for task reopening.

- [ ] **Step 1: Update final-state documentation**

In `README.md`, keep `completed` terminal for normal activation and add this explicit task exception below the status table:

```markdown
Completed tasks can be reopened through the dedicated `reopen` transition. Reopening changes the task to `active`, clears `completed_at`, and records a `reopen` audit event. Other completed item types remain terminal, and `activate` does not reopen terminal items.
```

Add to the HTTP endpoint list:

```markdown
- `POST /items/{id}/reopen`: reopen a completed task as active.
```

In `docs/operations/api-reference.md`, add:

```markdown
### Reopen a completed task

`POST /items/{id}/reopen`

- Accepts only an item with `type=task` and `status=completed`.
- Returns the task with `status=active` and `completed_at=null`.
- Writes a `reopen` audit event.
- Returns HTTP `400` with `code=policy_error` for another item type or source status.
```

- [ ] **Step 2: Run the complete verification suite**

Run:

```bash
cargo test
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings
cd frontend && npm test
cd frontend && npm run typecheck
cd frontend && npm run build
```

Expected: every command exits successfully with no warnings treated as errors.

- [ ] **Step 3: Inspect the complete change set**

Run:

```bash
git status --short
git diff --check
git log --oneline -n 10
```

Expected: only the two documentation files remain uncommitted, `git diff --check` has no output, and Tasks 1-5 appear as separate commits.

- [ ] **Step 4: Commit final documentation**

```bash
git add README.md docs/operations/api-reference.md
git commit -m "[DOCS] Document completed task reopening" -m "- task 전용 reopen 상태 전이와 completed_at 초기화 규칙을 설명합니다.
- reopen HTTP endpoint의 성공 및 정책 오류 계약을 기록합니다."
```

- [ ] **Step 5: Verify clean completion state**

Run:

```bash
git status --short
git log --oneline -n 10
```

Expected: `git status --short` is empty and the implementation plus documentation commits are present.
