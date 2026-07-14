# Planner Event Completion Checkbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users complete and reopen events from monthly, weekly, and daily planner checkboxes with the same behavior as tasks.

**Architecture:** Broaden the existing `TodoService::reopen` policy from completed tasks to completed tasks and events, keeping the existing HTTP route and audit path. Extend the shared planner visibility predicate and completion checkbox component to events, reusing item-ID keyed transition state for request merging, duplicate-row synchronization, and error recovery.

**Tech Stack:** Rust 2024, rusqlite, Axum, TypeScript, React 18, Next.js 14, Vitest, React Testing Library.

## Global Constraints

- SQLite remains the source of truth.
- Every mutation passes through `TodoService` and writes a `TodoEvent`.
- `reopen` accepts only task or event items whose status is `completed`.
- Reopening sets status to `active`, clears `completed_at`, refreshes `updated_at`, and writes a `reopen` audit event.
- Only active and completed tasks and events render planner completion checkboxes.
- Goals, routines, areas, and projects do not render planner completion checkboxes.
- Completed tasks and events remain visible in monthly, weekly, and daily planner placement.
- Planner transitions remain non-optimistic and share pending/error state by item ID.
- No new endpoint, dependency, or database migration is introduced.

---

## File Structure

- `todo-engine/src/application/service/transitions.rs`: broadens the reopen policy to events.
- `todo-engine/tests/integration/service_policy.rs`: verifies event reopen state, timestamp, audit, and rejected cases.
- `todo-engine/tests/e2e/api.rs`: verifies the existing reopen endpoint with an event.
- `frontend/src/features/workbench/model/planner-model.ts`: retains completed events in planner buckets.
- `frontend/tests/domain/planner-model.spec.ts`: covers completed-event visibility in all planner periods.
- `frontend/src/features/workbench/ui/MainPanel.tsx`: generalizes the checkbox from task-only to task/event.
- `frontend/src/features/workbench/hooks/useWorkbenchController.ts`: makes transition fallback copy type-neutral.
- `frontend/tests/presentation/workbench-wireframe.spec.tsx`: covers event checkbox visibility and transitions.
- `README.md`: states that completed tasks and events can be reopened.
- `docs/operations/api-reference.md`: updates the reopen endpoint contract.

---

### Task 1: Event Reopen Service Policy and HTTP Contract

**Files:**
- Modify: `todo-engine/tests/integration/service_policy.rs`
- Modify: `todo-engine/tests/e2e/api.rs`
- Modify: `todo-engine/src/application/service/transitions.rs`

**Interfaces:**
- Consumes: `TodoService::propose_event(ProposeEvent)`, `TodoService::complete`, the existing `POST /items/:id/reopen` handler.
- Produces: `TodoService::reopen` accepting `ItemType::Task | ItemType::Event` when status is `ItemStatus::Completed`.

- [ ] **Step 1: Write failing service tests for event reopen**

Import `ProposeEvent`, then add:

```rust
#[test]
fn completed_event_can_be_reopened() {
    let mut service = TodoService::in_memory();
    let event = service
        .propose_event(ProposeEvent {
            title: "다시 여는 일정".to_string(),
            actor: Actor::User,
            scheduled: Some("2026-07-14T10:00:00".to_string()),
            ..Default::default()
        })
        .unwrap();
    let completed = service.complete(&event.id, None).unwrap();

    let reopened = service.reopen(&event.id, Some("체크 해제")).unwrap();

    assert_eq!(reopened.item_type, ItemType::Event);
    assert_eq!(reopened.status, ItemStatus::Active);
    assert!(reopened.completed_at.is_none());
    assert!(reopened.updated_at > completed.updated_at);
    assert_eq!(service.events().last().unwrap().action, "reopen");
    assert_eq!(
        service.events().last().unwrap().reason.as_deref(),
        Some("체크 해제")
    );
}
```

Rename `reopen_rejects_completed_non_task` to `reopen_rejects_completed_unsupported_item` and change its expected error to:

```rust
TodoError::Policy("Only completed tasks and events can be reopened".to_string())
```

Add an event invalid-source assertion:

```rust
#[test]
fn reopen_rejects_non_completed_event() {
    let mut service = TodoService::in_memory();
    let event = service
        .propose_event(ProposeEvent {
            title: "진행 중 일정".to_string(),
            actor: Actor::User,
            scheduled: Some("2026-07-14T10:00:00".to_string()),
            ..Default::default()
        })
        .unwrap();

    let error = service.reopen(&event.id, None).unwrap_err();

    assert_eq!(
        error,
        TodoError::Policy("Cannot reopen event in status approved".to_string())
    );
}
```

- [ ] **Step 2: Run focused service tests and verify RED**

Run:

```bash
cargo test -p todo-engine --test integration service_policy::completed_event_can_be_reopened -- --exact
```

Expected: FAIL with `Only completed tasks can be reopened`.

- [ ] **Step 3: Write a failing event API test**

Add to `todo-engine/tests/e2e/api.rs`:

```rust
#[tokio::test]
async fn completed_event_can_be_reopened_through_api() {
    let app = router(":memory:").unwrap();
    let response = json_request(
        app.clone(),
        "POST",
        "/events/propose",
        json!({
            "title": "팀 일정",
            "scheduled": "2026-07-14T10:00:00",
            "actor": "user"
        }),
    )
    .await;
    let event = body_json(response).await;
    let id = event["id"].as_str().unwrap();

    let response = empty_request(app.clone(), "POST", format!("/items/{id}/complete")).await;
    assert_eq!(response.status(), 200);

    let response = empty_request(app, "POST", format!("/items/{id}/reopen")).await;
    assert_eq!(response.status(), 200);
    let reopened = body_json(response).await;
    assert_eq!(reopened["type"], "event");
    assert_eq!(reopened["status"], "active");
    assert!(reopened["completed_at"].is_null());
}
```

- [ ] **Step 4: Run the API test and verify RED**

```bash
cargo test -p todo-engine --test e2e api::completed_event_can_be_reopened_through_api -- --exact
```

Expected: FAIL because the reopen response is HTTP `400` instead of `200`.

- [ ] **Step 5: Implement the minimal type policy**

Replace the task-only checks in `TodoService::reopen` with:

```rust
if !matches!(item.item_type, ItemType::Task | ItemType::Event) {
    return Err(TodoError::Policy(
        "Only completed tasks and events can be reopened".to_string(),
    ));
}
if item.status != ItemStatus::Completed {
    return Err(TodoError::Policy(format!(
        "Cannot reopen {} in status {}",
        item.item_type.as_str(),
        item.status.as_str()
    )));
}
```

Leave timestamp mutation and `store_item_and_event` unchanged.

- [ ] **Step 6: Verify service and API GREEN**

Run:

```bash
cargo test -p todo-engine --test integration service_policy
cargo test -p todo-engine --test e2e api::completed_event_can_be_reopened_through_api -- --exact
```

Expected: all service-policy tests and the focused API test pass.

- [ ] **Step 7: Format and commit the service/API behavior**

```bash
cargo fmt --check
git add todo-engine/src/application/service/transitions.rs todo-engine/tests/integration/service_policy.rs todo-engine/tests/e2e/api.rs
git commit -m "[UPDATE] Allow completed events to reopen" -m "- completed event를 active 상태로 복구하고 완료 시각을 제거합니다.
- 지원하지 않는 item과 완료 전 상태의 reopen을 계속 거절합니다.
- 기존 HTTP reopen 경로에서 event 응답을 검증합니다."
```

---

### Task 2: Completed Event Planner Visibility

**Files:**
- Modify: `frontend/tests/domain/planner-model.spec.ts`
- Modify: `frontend/src/features/workbench/model/planner-model.ts`

**Interfaces:**
- Consumes: `WorkspaceItemModel.type`, `WorkspaceItemModel.status`.
- Produces: `isVisiblePlannerWorkItem` retaining completed tasks and events.

- [ ] **Step 1: Change existing expectations to require completed events**

Rename the terminal visibility test to `keeps completed tasks and events visible while hiding other terminal items`, then add:

```ts
const visibleDailyIds = daily.sections.today.groups.flatMap((group) =>
  group.items.map((item) => item.id),
);
expect(visibleDailyIds).toEqual([
  "task-active",
  "task-completed",
  "event-completed",
]);
```

In the existing monthly test change:

```ts
expect(model.weeks[1]?.days[3]?.items.map((entry) => entry.id)).toContain("completed-event");
```

Extend the weekly assertions in the same terminal-visibility test:

```ts
expect(weekly.days[0].items.map((item) => item.id)).toEqual([
  "task-active",
  "task-completed",
  "event-completed",
]);
```

Keep the test's existing `daily` and `weekly` builders and ordering conventions rather than adding a new helper.

- [ ] **Step 2: Run the model suite and verify RED**

Run:

```bash
npm --prefix frontend test -- --run tests/domain/planner-model.spec.ts
```

Expected: completed-event assertions fail because `isVisiblePlannerWorkItem` retains only completed tasks.

- [ ] **Step 3: Generalize the visibility predicate**

Replace the completed exception with:

```ts
function isVisiblePlannerWorkItem(item: WorkspaceItemModel): boolean {
  return !terminalStatuses.has(item.status) ||
    ((item.type === "task" || item.type === "event") && item.status === "completed");
}
```

- [ ] **Step 4: Run model tests and verify GREEN**

```bash
npm --prefix frontend test -- --run tests/domain/planner-model.spec.ts
```

Expected: all planner model tests pass.

- [ ] **Step 5: Commit planner visibility**

```bash
git add frontend/src/features/workbench/model/planner-model.ts frontend/tests/domain/planner-model.spec.ts
git commit -m "[UPDATE] Keep completed events in planner views" -m "- monthly, weekly, daily 날짜 bucket에 완료된 event를 유지합니다.
- event 외 기존 terminal visibility 규칙은 보존합니다."
```

---

### Task 3: Shared Task and Event Completion Checkbox

**Files:**
- Modify: `frontend/tests/presentation/workbench-wireframe.spec.tsx`
- Modify: `frontend/src/features/workbench/ui/MainPanel.tsx`
- Modify: `frontend/src/features/workbench/hooks/useWorkbenchController.ts`

**Interfaces:**
- Consumes: `WorkbenchController::transitionWorkspaceItem`, `workspaceItemTransitionState`.
- Produces: planner checkbox behavior for active/completed task and event items.

- [ ] **Step 1: Require event checkboxes in weekly and daily presentation tests**

In the weekly fixture add a completed event:

```ts
{ id: "event-done", type: "event", title: "Completed event", status: "completed", scheduled: weekStart }
```

Replace the old no-checkbox assertion with:

```ts
expect(screen.getByRole("checkbox", { name: "Complete Team event" })).not.toBeChecked();
expect(screen.getByRole("checkbox", { name: "Reopen Completed event" })).toBeChecked();
```

Make the equivalent active-event assertion in the daily planner rendering test. These render tests cover weekly and daily; the model test covers monthly placement, and the shared `PlannerItemRow` supplies the checkbox in all three views.

- [ ] **Step 2: Add an event complete/reopen interaction test**

Add a test based on the existing daily task transition test:

```ts
it("completes and reopens a daily planner event from the checkbox", async () => {
  const user = userEvent.setup();
  let status = "active";
  const fetchMock = vi.fn((url: string) => {
    if (url === "/todo-engine/items/event-team/complete") {
      status = "completed";
      return Promise.resolve({
        ok: true,
        json: async () => ({
          id: "event-team", type: "event", title: "Team event",
          status, scheduled: testToday(),
        }),
      } as Response);
    }
    if (url === "/todo-engine/items/event-team/reopen") {
      status = "active";
      return Promise.resolve({
        ok: true,
        json: async () => ({
          id: "event-team", type: "event", title: "Team event",
          status, scheduled: testToday(), completed_at: null,
        }),
      } as Response);
    }
    return Promise.resolve({
      ok: true,
      json: async () => url === "/todo-engine/items?type=event"
        ? [{ id: "event-team", type: "event", title: "Team event", status, scheduled: testToday() }]
        : [],
    } as Response);
  });
  vi.stubGlobal("fetch", fetchMock);

  render(<WorkbenchPageClient />);
  await user.click(screen.getByRole("button", { name: "ToDo" }));
  await user.click(screen.getByRole("button", { name: "Planner" }));
  await user.click(screen.getByRole("button", { name: "Daily" }));

  await user.click(await screen.findByRole("checkbox", { name: "Complete Team event" }));
  expect(await screen.findByRole("checkbox", { name: "Reopen Team event" })).toBeChecked();
  await user.click(screen.getByRole("checkbox", { name: "Reopen Team event" }));
  expect(await screen.findByRole("checkbox", { name: "Complete Team event" })).not.toBeChecked();
  expect(fetchMock).toHaveBeenCalledWith(
    "/todo-engine/items/event-team/complete",
    expect.objectContaining({ method: "POST" }),
  );
  expect(fetchMock).toHaveBeenCalledWith(
    "/todo-engine/items/event-team/reopen",
    expect.objectContaining({ method: "POST" }),
  );
});
```

- [ ] **Step 3: Run presentation tests and verify RED**

```bash
npm --prefix frontend test -- --run tests/presentation/workbench-wireframe.spec.tsx
```

Expected: event checkbox queries fail because the component is task-only.

- [ ] **Step 4: Generalize the checkbox component and fallback copy**

Rename `PlannerTaskCompletionCheckbox` to `PlannerCompletionCheckbox` at its definition and call site. Replace its visibility condition with:

```ts
const checkableType = item.type === "task" || item.type === "event";
const visible = checkableType &&
  (item.status === "active" || item.status === "completed");
```

Keep checked state, action selection, labels, request merging, and server-response replacement unchanged. In `useWorkbenchController.ts`, replace the fallback error with:

```ts
: "Could not update item.",
```

- [ ] **Step 5: Verify frontend GREEN and static checks**

```bash
npm --prefix frontend test -- --run tests/presentation/workbench-wireframe.spec.tsx
npm --prefix frontend test -- --run tests/presentation/use-workbench-controller.spec.tsx
npm --prefix frontend run typecheck
```

Expected: every command exits `0`.

- [ ] **Step 6: Commit shared checkbox behavior**

```bash
git add frontend/src/features/workbench/ui/MainPanel.tsx frontend/src/features/workbench/hooks/useWorkbenchController.ts frontend/tests/presentation/workbench-wireframe.spec.tsx
git commit -m "[UPDATE] Add event completion checkboxes" -m "- planner task checkbox를 event에도 공유해 완료와 재개를 지원합니다.
- item ID별 pending, 오류, 중복 행 동기화 동작을 유지합니다.
- 공통 전이 실패 문구를 item 기준으로 일반화합니다."
```

---

### Task 4: Lifecycle Documentation and Full Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/operations/api-reference.md`

**Interfaces:**
- Consumes: the verified service and UI behavior from Tasks 1-3.
- Produces: current-state lifecycle and endpoint documentation for task/event reopen.

- [ ] **Step 1: Update current-state docs**

In `README.md`, replace task-only reopen language with:

```markdown
Completed tasks and events can be reopened through the dedicated `reopen` transition. Reopening changes the item to `active`, clears `completed_at`, and records a `reopen` audit event. Other completed item types remain terminal, and `activate` does not reopen terminal items.
```

In `docs/operations/api-reference.md`, rename the section to `Reopen a completed task or event` and state:

```markdown
- Accepts only an item with `type=task` or `type=event` and `status=completed`.
- Returns the item with `status=active` and `completed_at=null`.
- Writes a `reopen` audit event.
- Returns HTTP `400` with `code=policy_error` for another item type or source status.
```

- [ ] **Step 2: Run complete verification from the workspace root**

```bash
cargo test
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings
npm --prefix frontend test
npm --prefix frontend run typecheck
npm --prefix frontend run build
```

Expected: every command exits `0`, with no test failures, formatting diff, clippy warning, type error, or build error.

- [ ] **Step 3: Inspect the final diff against the design**

```bash
git diff --check
git status --short
git diff --stat
git diff
```

Confirm that task behavior is unchanged, events alone gain the same active/completed checkbox contract, and no schema or unrelated UI change is present.

- [ ] **Step 4: Commit documentation**

```bash
git add README.md docs/operations/api-reference.md
git commit -m "[DOCS] Document event reopen lifecycle" -m "- completed task와 event의 reopen 계약을 함께 명시합니다.
- API 성공 상태와 정책 오류 조건을 현재 서비스 동작에 맞춥니다."
```
