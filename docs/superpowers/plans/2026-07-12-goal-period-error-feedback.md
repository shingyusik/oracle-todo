# Goal Period Error Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Return structured Goal policy errors from Rust and show a Korean modal instead of an unhandled 400 error for rejected inline period changes.

**Architecture:** The API adds a stable error `code` without removing `detail`. The frontend parses API errors into a typed error and `GoalPeriodControl` renders a modal only when its table PATCH rejects; detail and creation drafts retain their current local-only behavior.

**Tech Stack:** Rust, Axum, React 18, TypeScript, Testing Library, Vitest.

## Global Constraints

- Preserve existing HTTP statuses and the `detail` response field.
- Do not change the Goal nesting policy, database schema, or period canonicalization.
- Frontend behavior must branch on API `code`, never on `detail` text.
- The Parent-horizon rejection modal preserves the current period and returns focus to the trigger.
- Detail and creation period drafts do not show this inline PATCH modal.

---

## File Structure

- Modify `todo-engine/src/interfaces/api/mod.rs`: serialize API errors as `{ code, detail }`.
- Modify `todo-engine/src/application/error.rs`: expose stable error-code classification.
- Modify `todo-engine/tests/e2e/api.rs`: verify Goal error codes and existing detail text.
- Modify `frontend/src/features/workbench/hooks/useWorkbenchController.ts`: parse non-OK JSON into a typed API error.
- Modify `frontend/src/features/workbench/ui/MainPanel.tsx`: catch period commit rejection and render the modal.
- Modify `frontend/tests/presentation/workbench-wireframe.spec.tsx`: assert the inline Goal Parent-horizon modal.

### Task 1: Add Stable Rust API Error Codes

**Files:**
- Modify: `todo-engine/src/application/error.rs`
- Modify: `todo-engine/src/interfaces/api/mod.rs:145-155`
- Modify: `todo-engine/tests/e2e/api.rs:680-775`

**Interfaces:**
- Produces: `TodoError::api_code() -> &'static str`.
- Produces: non-success JSON bodies shaped as `{ "code": string, "detail": string }`.

- [ ] **Step 1: Write failing API assertions**

Extend the invalid canonical-year anchor test and add a parent-horizon PATCH case. Assert both the new code and the existing detail:

```rust
assert_eq!(body["code"], "goal_invalid_anchor");
assert!(body["detail"].as_str().unwrap().contains("canonical start"));

assert_eq!(body["code"], "goal_parent_horizon_not_coarser");
assert!(body["detail"].as_str().unwrap().contains("strictly coarser"));
```

- [ ] **Step 2: Run the focused API test and confirm failure**

```bash
cargo test -p todo-engine --test e2e api_patch_rejects_invalid_goal_parent
```

Expected: FAIL because `code` is absent.

- [ ] **Step 3: Classify errors and serialize the code**

Add `api_code` to `TodoError`. Map generic variants to `policy_error`, `validation_error`, `not_found`, and `internal_error`. In `ApiError::into_response`, classify Goal policy details without changing the service error text:

```rust
let code = match self.0.downcast_ref::<TodoError>() {
    Some(TodoError::Policy(detail))
        if detail.starts_with("Goal parent horizon") => "goal_parent_horizon_not_coarser",
    Some(TodoError::Policy(detail)) if detail.starts_with("Goal already exists") =>
        "goal_duplicate_period",
    Some(TodoError::Validation(detail)) if detail.contains("canonical start") =>
        "goal_invalid_anchor",
    Some(error) => error.api_code(),
    None => "internal_error",
};
(status, Json(json!({"code": code, "detail": self.0.to_string()}))).into_response()
```

- [ ] **Step 4: Run focused and full Rust tests**

```bash
cargo test -p todo-engine --test e2e api_patch_rejects_invalid_goal_parent
cargo test
```

Expected: both pass.

- [ ] **Step 5: Commit the API contract**

```bash
git add todo-engine/src/application/error.rs todo-engine/src/interfaces/api/mod.rs todo-engine/tests/e2e/api.rs
git diff --cached --check
git commit -m $'[UPDATE] Add structured API error codes\n\n- Goal 정책 위반을 안정적인 오류 코드로 반환\n- 기존 detail 메시지와 HTTP 상태를 유지해 진단 호환성 보존'
```

### Task 2: Surface Goal Period Rejections In The UI

**Files:**
- Modify: `frontend/src/features/workbench/hooks/useWorkbenchController.ts:426-441`
- Modify: `frontend/src/features/workbench/ui/MainPanel.tsx:2400-2610`
- Modify: `frontend/tests/presentation/workbench-wireframe.spec.tsx`

**Interfaces:**
- Consumes: API JSON `{ code, detail }` from Task 1.
- Produces: `TodoEngineApiError` with `status`, `code`, and `detail`.
- Produces: `GoalPeriodControl` modal state and `onCommit` rejection handling.

- [ ] **Step 1: Write a failing inline rejection test**

Mock the Goal PATCH to return:

```tsx
{
  ok: false,
  status: 400,
  json: async () => ({
    code: "goal_parent_horizon_not_coarser",
    detail: "Goal parent horizon (month) must be strictly coarser than child horizon (year)",
  }),
}
```

Select Year for a Week Goal. Assert the modal title, Korean explanation, unchanged trigger text, and focus restoration after clicking `확인`:

```tsx
expect(screen.getByRole("dialog", { name: "Year로 변경할 수 없음" })).toBeInTheDocument();
expect(screen.getByText("현재 Parent가 Month 기간입니다. Goal은 Parent보다 더 작은 기간만 사용할 수 있습니다.")).toBeInTheDocument();
await user.click(screen.getByRole("button", { name: "확인" }));
expect(trigger).toHaveTextContent("Week");
expect(trigger).toHaveFocus();
```

- [ ] **Step 2: Run the focused presentation test and confirm failure**

```bash
cd frontend && npm test -- workbench-wireframe.spec.tsx -t "shows a parent horizon error when an inline goal period change is rejected"
```

Expected: FAIL because the rejected promise is unhandled and no modal exists.

- [ ] **Step 3: Parse the API error without inspecting detail text**

Add a local error class and response parser in `useWorkbenchController.ts`:

```tsx
class TodoEngineApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly detail: string,
  ) {
    super(detail);
  }
}

async function throwApiError(response: Response): Promise<never> {
  const body = await response.json().catch(() => null) as
    | { code?: unknown; detail?: unknown }
    | null;
  throw new TodoEngineApiError(
    response.status,
    typeof body?.code === "string" ? body.code : "internal_error",
    typeof body?.detail === "string" ? body.detail : `todo-engine returned ${response.status}`,
  );
}
```

Use `return throwApiError(response);` in `patchItem` and leave unrelated request helpers unchanged.

- [ ] **Step 4: Add the modal boundary to `GoalPeriodControl`**

Change `onCommit` to return `void | Promise<void>`. Await it in `commit`, catch `TodoEngineApiError`, and store its code. Render a portal modal with a single confirmation button. Map only `goal_parent_horizon_not_coarser` to the approved Korean title and body; all other codes use the generic retry message. Do not call `onCommit` for detail or creation drafts beyond their existing synchronous updates.

- [ ] **Step 5: Run frontend verification**

```bash
cd frontend && npm test -- workbench-wireframe.spec.tsx
npm test
npm run build
npm run typecheck
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit the feedback UI**

```bash
git add frontend/src/features/workbench/hooks/useWorkbenchController.ts frontend/src/features/workbench/ui/MainPanel.tsx frontend/tests/presentation/workbench-wireframe.spec.tsx
git diff --cached --check
git commit -m $'[FIX] Show goal period policy feedback\n\n- 기간 PATCH 거절 시 서버 오류 코드를 사용자 팝업으로 변환\n- Parent 기간 규칙 위반의 원인과 해결 방향을 안내\n- 기존 기간과 키보드 포커스를 유지'
```

## Plan Self-Review

- Task 1 adds codes while retaining the existing status and detail contract.
- Task 2 consumes only codes, preserves inline/table commit boundaries, and covers the approved Parent-horizon modal.
- The plan excludes schema, Goal policy, and text-parsing changes.
