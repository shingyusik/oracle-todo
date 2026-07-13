# Multiple Goals per Period Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow independently identified Goals to share a period and Parent, and keep creation failures inside the creation dialog instead of the Next.js runtime overlay.

**Architecture:** `TodoService` continues to own Goal anchor and nesting policy but no longer treats period fields as identity. The API drops the unreachable duplicate-period error contract. The frontend routes every JSON mutation failure through `TodoEngineApiError`, while `CreationDialog` owns retryable submission feedback.

**Tech Stack:** Rust 2024, axum, rusqlite, Next.js 14, React 18, TypeScript, Vitest, Testing Library

## Global Constraints

- SQLite remains the source of truth; every mutation continues through `TodoService` and writes an audit event.
- Goal identity is the engine-generated `id`; `(horizon, scheduled, parent_id)` is a grouping key.
- Canonical period anchors and strictly-coarser Parent horizons remain mandatory.
- Status lifecycle, approval gates, and terminal behavior remain unchanged.
- No SQLite schema migration or new Goal field is permitted.
- Keep historical planning artifacts unchanged; update current reference documentation only.
- Follow the NFLOW commit format: English `[TAG]` subject plus Korean bullet body.

## File Structure

- `todo-engine/tests/integration/goal_policy.rs`: service-level acceptance tests for same-period siblings and collision updates.
- `todo-engine/tests/e2e/api.rs`: HTTP acceptance test proving repeated same-period Goal creation succeeds.
- `todo-engine/src/application/service/creation.rs`: Goal creation validation sequence without duplicate lookup.
- `todo-engine/src/application/service/update.rs`: Goal period/Parent update validation without sibling collision lookup.
- `todo-engine/src/application/service/goal.rs`: canonical-anchor and nesting helpers only.
- `todo-engine/src/application/error.rs`: active service/API error variants and metadata.
- `todo-engine/tests/integration/period_view.rs`: comments that describe valid same-period sibling fixtures accurately.
- `frontend/src/features/workbench/hooks/useWorkbenchController.ts`: shared structured error parsing for JSON POST mutations.
- `frontend/src/features/workbench/ui/MainPanel.tsx`: retryable creation error state and active Goal period error copy.
- `frontend/tests/presentation/workbench-wireframe.spec.tsx`: creation failure/retry behavior and occupied-period creation coverage.
- `README.md`: current Goal identity and grouping policy.

---

### Task 1: Allow Same-Period Goals in the Service and API

**Files:**
- Modify: `todo-engine/tests/integration/goal_policy.rs:139-158`
- Modify: `todo-engine/tests/e2e/api.rs:620-670`
- Modify: `todo-engine/src/application/service/creation.rs:213-224`
- Modify: `todo-engine/src/application/service/update.rs:1-4,107-133`
- Modify: `todo-engine/src/application/service/goal.rs:1-5,103-132`
- Modify: `todo-engine/src/application/error.rs:24-34,49-124`
- Modify: `todo-engine/tests/integration/period_view.rs:100-115,620-715`

**Interfaces:**
- Consumes: `TodoService::propose_goal(ProposeGoal) -> TodoResult<TodoItem>` and `TodoService::update_item(&str, UpdateItem) -> TodoResult<TodoItem>`.
- Produces: Goal mutations that use `id` as identity and permit repeated `(horizon, scheduled, parent_id)` group values.
- Preserves: `goal_invalid_anchor` and `goal_parent_horizon_not_coarser` structured API errors.

- [ ] **Step 1: Replace the service duplicate-rejection test with same-period acceptance tests**

Replace `goal_duplicate_triple_is_rejected` in `todo-engine/tests/integration/goal_policy.rs` with:

```rust
#[test]
fn goals_with_the_same_period_and_parent_are_allowed_and_audited() {
    let mut service = TodoService::in_memory();

    let first_root = service
        .propose_goal(goal(Actor::User, "year", "2026-01-01", None))
        .unwrap();
    let second_root = service
        .propose_goal(goal(Actor::User, "year", "2026-01-01", None))
        .unwrap();
    assert_ne!(first_root.id, second_root.id);

    let first_child = service
        .propose_goal(goal(
            Actor::User,
            "month",
            "2026-06-01",
            Some(&first_root.id),
        ))
        .unwrap();
    let second_child = service
        .propose_goal(goal(
            Actor::User,
            "month",
            "2026-06-01",
            Some(&first_root.id),
        ))
        .unwrap();

    assert_ne!(first_child.id, second_child.id);
    assert_eq!(first_child.parent_id, second_child.parent_id);
    assert_eq!(service.events().len(), 4);
    assert!(service.events().iter().all(|event| event.action == "propose_goal"));
}

#[test]
fn goal_update_can_join_an_occupied_period_and_parent() {
    let mut service = TodoService::in_memory();
    service
        .propose_goal(goal(Actor::User, "year", "2026-01-01", None))
        .unwrap();
    let moving = service
        .propose_goal(goal(Actor::User, "month", "2026-06-01", None))
        .unwrap();

    let updated = service
        .update_item(
            &moving.id,
            UpdateItem {
                horizon: Some("year".to_string()),
                scheduled: Some("2026-01-01".to_string()),
                ..Default::default()
            },
        )
        .unwrap();

    assert_eq!(updated.horizon.as_deref(), Some("year"));
    assert_eq!(updated.scheduled.as_deref(), Some("2026-01-01"));
    assert_eq!(service.events().last().unwrap().action, "update_item");
}
```

- [ ] **Step 2: Add an API acceptance test for repeated root periods**

Add this test near the existing Goal patch tests in `todo-engine/tests/e2e/api.rs`:

```rust
#[tokio::test]
async fn api_allows_multiple_goals_for_the_same_period_and_parent() {
    let home = TestHome::new();
    let db_path = home.db_path();
    init_schema(&rusqlite::Connection::open(&db_path).unwrap()).unwrap();

    let first = json_request(
        router(&db_path).unwrap(),
        "POST",
        "/goals/propose",
        json!({
            "title": "건강",
            "horizon": "year",
            "scheduled": "2026-01-01",
            "actor": "user"
        }),
    )
    .await;
    assert_eq!(first.status(), 200);
    let first = body_json(first).await;

    let second = json_request(
        router(&db_path).unwrap(),
        "POST",
        "/goals/propose",
        json!({
            "title": "커리어",
            "horizon": "year",
            "scheduled": "2026-01-01",
            "actor": "user"
        }),
    )
    .await;
    assert_eq!(second.status(), 200);
    let second = body_json(second).await;

    assert_ne!(first["id"], second["id"]);
    assert_eq!(first["horizon"], second["horizon"]);
    assert_eq!(first["scheduled"], second["scheduled"]);
}
```

- [ ] **Step 3: Run the focused tests and verify the current policy rejects them**

Run:

```bash
cargo test -p todo-engine --test integration goals_with_the_same_period_and_parent_are_allowed_and_audited
cargo test -p todo-engine --test integration goal_update_can_join_an_occupied_period_and_parent
cargo test -p todo-engine --test e2e api_allows_multiple_goals_for_the_same_period_and_parent
```

Expected: all three fail because creation or update returns `GoalDuplicatePeriod`.

- [ ] **Step 4: Remove duplicate-period enforcement and its obsolete contract**

In `creation.rs`, retain only anchor and nesting validation:

```rust
let canonical = self.validate_goal_anchor(horizon, &request.scheduled)?;
self.validate_goal_nesting(request.parent_id.as_deref(), horizon)?;
```

In `update.rs`, delete the `ListFilter` import and the sibling `list_items`/`GoalDuplicatePeriod` block. Continue directly from nesting validation to assigning the resolved Parent and canonical period:

```rust
let canonical_scheduled = self.validate_goal_anchor(next_horizon, next_scheduled)?;
self.validate_goal_nesting(resolved_parent_id.as_deref(), next_horizon)?;

next_goal_parent_id = Some(resolved_parent_id);
item.horizon = Some(next_horizon.as_str().to_string());
item.scheduled = Some(canonical_scheduled);
```

In `goal.rs`, delete `ensure_goal_not_duplicate` and its `ListFilter` import. In `application/error.rs`, delete `GoalDuplicatePeriod` and every match arm that maps its code, exit status, HTTP status, or metadata. Keep every other error mapping unchanged.

Update `period_view.rs` comments that cite GOAL-05 so they describe same-period sibling fixtures without claiming a uniqueness invariant. Do not change fixture behavior.

- [ ] **Step 5: Format and rerun the focused Rust tests**

Run:

```bash
cargo fmt --all
cargo test -p todo-engine --test integration goals_with_the_same_period_and_parent_are_allowed_and_audited
cargo test -p todo-engine --test integration goal_update_can_join_an_occupied_period_and_parent
cargo test -p todo-engine --test e2e api_allows_multiple_goals_for_the_same_period_and_parent
cargo test -p todo-engine --test integration goal_anchor_rejects_today_unparseable_and_non_canonical
cargo test -p todo-engine --test integration goal_nesting_rejects_horizon_inversion_and_parent_updates
```

Expected: all focused tests pass.

- [ ] **Step 6: Confirm no active code references the obsolete error**

Run:

```bash
rg -n 'GoalDuplicatePeriod|goal_duplicate_period|ensure_goal_not_duplicate' todo-engine/src todo-engine/tests
```

Expected: no matches.

- [ ] **Step 7: Commit the engine behavior change**

```bash
git add todo-engine/src/application/error.rs todo-engine/src/application/service/creation.rs todo-engine/src/application/service/goal.rs todo-engine/src/application/service/update.rs todo-engine/tests/integration/goal_policy.rs todo-engine/tests/integration/period_view.rs todo-engine/tests/e2e/api.rs
git commit -m '[UPDATE] Allow multiple Goals per period' -m '- Goal ID를 유일한 식별자로 사용하고 기간·Parent 중복 제한 제거
- 생성과 수정 경로에서 동일 기간 형제 Goal 허용
- 폐기된 중복 오류 계약을 제거하고 서비스·API 회귀 테스트 추가'
```

---

### Task 2: Keep Creation Failures Inside the Dialog

**Files:**
- Modify: `frontend/tests/presentation/workbench-wireframe.spec.tsx:2860-2960`
- Modify: `frontend/src/features/workbench/hooks/useWorkbenchController.ts:583-595,786-798`
- Modify: `frontend/src/features/workbench/ui/MainPanel.tsx:3073-3097,3948-4088`

**Interfaces:**
- Consumes: API error JSON `{ code, detail, parent_horizon?, child_horizon?, horizon?, scheduled?, parent_id? }`.
- Produces: `postJson(url, body) -> Promise<WorkspaceItemModel>` rejecting with `TodoEngineApiError` for non-2xx responses.
- Produces: `CreationDialog` inline `role="alert"` feedback with preserved form state and retry support.

- [ ] **Step 1: Make the existing creation test cover an occupied period**

In `creates workspace goals through one period control`, make the non-POST branch return an existing July Goal only for the Goal and all-item queries:

```tsx
if (url === "/todo-engine/items?type=goal" || url === "/todo-engine/items") {
  return Promise.resolve({
    ok: true,
    json: async () => [
      {
        id: "goal-existing",
        type: "goal",
        title: "Existing July goal",
        status: "approved",
        horizon: "month",
        scheduled: "2026-07-01",
      },
    ],
  });
}

return Promise.resolve({ ok: true, json: async () => [] });
```

Keep the expected POST body and successful `goal-new` response unchanged. This proves the creation UI does not preemptively block another Goal in an occupied period.

- [ ] **Step 2: Add a failing creation error and retry test**

Add this test after `creates workspace goals through one period control` in `frontend/tests/presentation/workbench-wireframe.spec.tsx`:

```tsx
it("keeps a failed Goal creation in the dialog and allows retry", async () => {
  const user = userEvent.setup();
  let attempts = 0;
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url === "/todo-engine/goals/propose" && init?.method === "POST") {
      attempts += 1;
      if (attempts === 1) {
        return Promise.resolve({
          ok: false,
          status: 400,
          json: async () => ({
            code: "goal_invalid_anchor",
            detail: "Goal anchor is invalid",
            horizon: "year",
            scheduled: "2026-01-01",
          }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () => ({
          id: "goal-retry",
          type: "goal",
          title: "Career",
          status: "approved",
          horizon: "year",
          scheduled: "2026-01-01",
        }),
      });
    }

    return Promise.resolve({ ok: true, json: async () => [] });
  });
  vi.stubGlobal("fetch", fetchMock);

  render(<WorkbenchPageClient />);
  await user.click(screen.getByRole("button", { name: "ToDo" }));
  await user.click(screen.getByRole("button", { name: "Workspace" }));
  await user.click(screen.getByRole("button", { name: "Goals" }));
  await user.click(screen.getByRole("button", { name: "Add item" }));
  await user.type(screen.getByLabelText("Title"), "Career");

  await user.click(screen.getByRole("button", { name: "Create" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("Goal anchor is invalid");
  expect(screen.getByRole("dialog", { name: "Create Goals item" })).toBeInTheDocument();
  expect(screen.getByLabelText("Title")).toHaveValue("Career");

  await user.click(screen.getByRole("button", { name: "Create" }));
  expect(await screen.findByRole("heading", { name: "Career" })).toBeInTheDocument();
  expect(attempts).toBe(2);
});
```

- [ ] **Step 3: Run the focused frontend test and verify the uncaught failure**

Run:

```bash
npm --prefix frontend test -- --testNamePattern='keeps a failed Goal creation in the dialog and allows retry' tests/presentation/workbench-wireframe.spec.tsx
```

Expected: fail because `postJson` throws a generic `Error` and no dialog alert is rendered.

- [ ] **Step 4: Route POST failures through the structured parser**

Change the non-success branches in both `postArchiveItem` and `postJson`:

```ts
if (!response.ok) {
  return throwApiError(response);
}
```

This routes every JSON mutation helper through the same `TodoEngineApiError` contract as `patchItem` without adding another parser. Read-only list failures retain their existing loading-state handling.

- [ ] **Step 5: Add retryable submission state to `CreationDialog`**

Add state beside the existing form state:

```tsx
const [submitError, setSubmitError] = React.useState("");
const [isSubmitting, setIsSubmitting] = React.useState(false);
```

Add a submit handler:

```tsx
async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
  event.preventDefault();
  setSubmitError("");
  setIsSubmitting(true);
  try {
    await controller.createWorkspaceItem({
      title,
      itemType,
      scheduled,
      horizon,
    });
  } catch (error) {
    setSubmitError(
      error instanceof TodoEngineApiError
        ? error.detail
        : "항목을 생성하지 못했습니다. 다시 시도해 주세요.",
    );
  } finally {
    setIsSubmitting(false);
  }
}
```

Set `onSubmit={handleSubmit}`, render feedback immediately before `.dialog-actions`, and prevent duplicate submissions:

```tsx
{submitError ? (
  <p className="items-message" role="alert">
    {submitError}
  </p>
) : null}
<div className="dialog-actions">
  <button type="button" onClick={controller.closeCreationDialog}>
    Cancel
  </button>
  <button type="submit" disabled={isSubmitting}>
    Create
  </button>
</div>
```

Delete only the `goal_duplicate_period` branch from `goalPeriodCommitErrorMessage`; retain Parent-horizon, invalid-anchor, and generic feedback.

- [ ] **Step 6: Run the focused presentation tests and type checker**

Run:

```bash
npm --prefix frontend test -- --testNamePattern='creates workspace goals|keeps a failed Goal creation|shows a parent horizon error' tests/presentation/workbench-wireframe.spec.tsx
npm --prefix frontend run typecheck
```

Expected: all selected tests pass and TypeScript reports no errors.

- [ ] **Step 7: Confirm active frontend code no longer references duplicate-period errors**

Run:

```bash
rg -n 'goal_duplicate_period|같은 Parent와 기간' frontend/src frontend/tests
```

Expected: no matches.

- [ ] **Step 8: Commit the frontend error handling change**

```bash
git add frontend/src/features/workbench/hooks/useWorkbenchController.ts frontend/src/features/workbench/ui/MainPanel.tsx frontend/tests/presentation/workbench-wireframe.spec.tsx
git commit -m '[FIX] Keep creation errors inside dialog' -m '- POST 오류 응답을 구조화된 TodoEngineApiError로 통일
- 생성 실패 시 입력값과 다이얼로그를 유지하고 재시도 지원
- 폐기된 Goal 기간 중복 오류 메시지 제거'
```

---

### Task 3: Synchronize Current Documentation and Run Quality Gates

**Files:**
- Modify: `README.md:273-281`

**Interfaces:**
- Consumes: the final service behavior from Task 1 and dialog behavior from Task 2.
- Produces: current reference text that identifies Goal `id` as identity and period fields as grouping values.

- [ ] **Step 1: Update the Goal policy reference**

Add this bullet to the `README.md` Goal section after the anchor rule:

```markdown
- Multiple goals may share the same `(horizon, scheduled, parent_id)` values. These fields group goals into a period and hierarchy; the engine-generated `id` is the goal identity.
```

Do not rewrite historical files under `docs/superpowers/specs/` or `docs/superpowers/plans/`.

- [ ] **Step 2: Run the complete Rust quality gates**

Run:

```bash
cargo fmt --check
cargo test
cargo clippy --all-targets --all-features -- -D warnings
```

Expected: every command exits 0 with no formatting, test, or lint failures.

- [ ] **Step 3: Run the complete frontend quality gates**

Run:

```bash
npm --prefix frontend test
npm --prefix frontend run typecheck
npm --prefix frontend run build
```

Expected: all Vitest tests pass, TypeScript reports no errors, and the Next.js production build succeeds.

- [ ] **Step 4: Verify the active policy surface and worktree**

Run:

```bash
rg -n 'GoalDuplicatePeriod|goal_duplicate_period|ensure_goal_not_duplicate' todo-engine/src todo-engine/tests frontend/src frontend/tests README.md docs/operations
git diff --check
git status --short
```

Expected: the policy search has no matches in active code/reference paths, `git diff --check` exits 0, and only the intended README change remains uncommitted.

- [ ] **Step 5: Commit the final-state documentation**

```bash
git add README.md
git commit -m '[DOCS] Document Goal period grouping' -m '- 동일 기간과 Parent 아래 복수 Goal을 허용하는 현재 정책 명시
- 기간 필드는 그룹 기준이고 Goal ID가 식별자임을 구분'
```

- [ ] **Step 6: Perform final verification before completion**

Run:

```bash
git status
git log --oneline -n 8
```

Expected: the worktree is clean and the engine, frontend, and documentation commits are present in order.
