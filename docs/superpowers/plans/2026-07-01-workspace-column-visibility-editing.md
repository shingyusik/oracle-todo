# Workspace Column Visibility and Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each ToDo workspace table and detail view show the same type-specific `items` columns, while restricting some visible fields to detail-only editing.

**Architecture:** Keep the existing API and frontend flow. Extend the shared service update path only for fields the approved UI needs but cannot currently patch (`horizon`, event metadata keys). In the frontend, keep the column configuration local to `MainPanel.tsx` and reuse it for both table rows and the detail form.

**Tech Stack:** Rust 2024, axum, rusqlite, Next.js 14, React 18, TypeScript, Vitest, Testing Library.

## Global Constraints

- No schema changes.
- No direct SQLite writes from the frontend.
- No hard delete.
- No custom item types.
- No raw JSON editor for `metadata` or `second_brain_refs`.
- The table view and detail view show the same visible column set for each workspace item type.
- `detail` fields render read-only summaries in the table and editable controls in detail.

---

## File Structure

- Modify `todo-engine/src/application/service/update.rs`: add patch support for `horizon`, `location`, `participants`, and `commitment_type`.
- Modify `todo-engine/src/interfaces/api/dto.rs`: add the matching PATCH body fields.
- Modify `todo-engine/src/interfaces/api/handlers.rs`: pass the new fields into `UpdateItem`.
- Modify `todo-engine/tests/e2e/api.rs`: prove PATCH updates goal horizon and event metadata through the API.
- Modify `frontend/src/features/workbench/model/workbench-model.ts`: add frontend patch fields for `description`, `horizon`, `parent_id`, and named event metadata.
- Modify `frontend/src/features/workbench/ui/MainPanel.tsx`: define one type-specific field list and render table/detail from it.
- Modify `frontend/tests/presentation/workbench-wireframe.spec.tsx`: prove table/detail show matching fields and detail-only fields are not inline-editable.
- Modify `frontend/tests/presentation/use-workbench-controller.spec.tsx`: prove new patch payload fields flow through the controller.

---

### Task 1: Add Service/API Update Support for UI-Editable Fields

**Files:**
- Modify: `todo-engine/src/application/service/update.rs`
- Modify: `todo-engine/src/interfaces/api/dto.rs`
- Modify: `todo-engine/src/interfaces/api/handlers.rs`
- Test: `todo-engine/tests/e2e/api.rs`

**Interfaces:**
- Consumes: `TodoService::update_item(&mut self, item_id: &str, request: UpdateItem) -> TodoResult<TodoItem>`
- Produces: PATCH `/items/{id}` accepts `horizon`, `location`, `participants`, and `commitment_type`.

- [ ] **Step 1: Write the failing API test**

Add this test near the existing PATCH coverage in `todo-engine/tests/e2e/api.rs`:

```rust
#[tokio::test]
async fn api_patch_updates_goal_horizon_and_event_metadata() {
    let home = TestHome::new();
    let db_path = home.db_path();
    init_schema(&Connection::open(&db_path).unwrap()).unwrap();

    let response = json_request(
        router(&db_path).unwrap(),
        "POST",
        "/goals/propose",
        json!({
            "title":"분기 목표",
            "horizon":"month",
            "scheduled":"2026-07-01",
            "actor":"user"
        }),
    )
    .await;
    assert_eq!(response.status(), 200);
    let goal = body_json(response).await;
    let goal_id = goal["id"].as_str().unwrap();

    let response = json_request(
        router(&db_path).unwrap(),
        "PATCH",
        format!("/items/{goal_id}"),
        json!({"horizon":"year"}),
    )
    .await;
    assert_eq!(response.status(), 200);
    let goal = body_json(response).await;
    assert_eq!(goal["horizon"], "year");

    let response = json_request(
        router(&db_path).unwrap(),
        "POST",
        "/events/propose",
        json!({
            "title":"점검 미팅",
            "scheduled":"2026-07-01T09:00:00Z",
            "actor":"user",
            "commitment_type":"meeting"
        }),
    )
    .await;
    assert_eq!(response.status(), 200);
    let event = body_json(response).await;
    let event_id = event["id"].as_str().unwrap();

    let response = json_request(
        router(&db_path).unwrap(),
        "PATCH",
        format!("/items/{event_id}"),
        json!({
            "location":"회의실",
            "participants":["나", "팀"],
            "commitment_type":"review"
        }),
    )
    .await;
    assert_eq!(response.status(), 200);
    let event = body_json(response).await;
    assert_eq!(event["metadata_"]["location"], "회의실");
    assert_eq!(event["metadata_"]["participants"][0], "나");
    assert_eq!(event["metadata_"]["participants"][1], "팀");
    assert_eq!(event["metadata_"]["commitment_type"], "review");
}
```

- [ ] **Step 2: Run the API test to verify it fails**

Run:

```bash
cargo test -p todo-engine --test e2e api_patch_updates_goal_horizon_and_event_metadata
```

Expected: FAIL because PATCH ignores `horizon`, `location`, `participants`, and `commitment_type`.

- [ ] **Step 3: Add the minimal service fields**

In `todo-engine/src/application/service/update.rs`, extend `UpdateItem`:

```rust
pub horizon: Option<String>,
pub location: Option<String>,
pub participants: Option<Vec<String>>,
pub commitment_type: Option<String>,
```

In `TodoService::update_item`, after the `scheduled` block and before `priority`, add:

```rust
if let Some(horizon) = request.horizon {
    item.horizon = Some(horizon);
}
```

After the `priority` block, add:

```rust
if let Some(location) = request.location {
    item.metadata.insert(
        "location".to_string(),
        serde_json::Value::String(location),
    );
}
if let Some(participants) = request.participants {
    item.metadata.insert(
        "participants".to_string(),
        serde_json::Value::Array(
            participants
                .into_iter()
                .map(serde_json::Value::String)
                .collect(),
        ),
    );
}
if let Some(commitment_type) = request.commitment_type {
    item.metadata.insert(
        "commitment_type".to_string(),
        serde_json::Value::String(commitment_type),
    );
}
```

- [ ] **Step 4: Wire the API DTO and handler**

In `todo-engine/src/interfaces/api/dto.rs`, add to `UpdateBody`:

```rust
pub horizon: Option<String>,
pub location: Option<String>,
pub participants: Option<Vec<String>>,
pub commitment_type: Option<String>,
```

In `todo-engine/src/interfaces/api/handlers.rs`, pass those fields into `UpdateItem`:

```rust
horizon: body.horizon,
location: body.location,
participants: body.participants,
commitment_type: body.commitment_type,
```

- [ ] **Step 5: Run the API test to verify it passes**

Run:

```bash
cargo test -p todo-engine --test e2e api_patch_updates_goal_horizon_and_event_metadata
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add todo-engine/src/application/service/update.rs todo-engine/src/interfaces/api/dto.rs todo-engine/src/interfaces/api/handlers.rs todo-engine/tests/e2e/api.rs
git commit -m "$(cat <<'EOF'
[UPDATE] Extend item patch fields

- 워크스페이스 UI에서 필요한 goal horizon 및 event metadata 수정 경로 추가
- PATCH /items/{id}가 기존 서비스 계층과 감사 이벤트 경로를 그대로 사용하도록 연결
EOF
)"
```

---

### Task 2: Expand Frontend Patch Types and Controller Coverage

**Files:**
- Modify: `frontend/src/features/workbench/model/workbench-model.ts`
- Modify: `frontend/tests/presentation/use-workbench-controller.spec.tsx`

**Interfaces:**
- Consumes: `WorkspaceItemPatch`
- Produces: `WorkspaceItemPatch` supports `description`, `horizon`, `parent_id`, `location`, `participants`, and `commitment_type`.

- [ ] **Step 1: Write the failing controller test**

Add this test to `frontend/tests/presentation/use-workbench-controller.spec.tsx`:

```tsx
it("patches detail-only and metadata workspace fields", async () => {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url === "/todo-engine/items/event-1") {
      expect(init).toEqual(
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({
            description: "Bring agenda",
            note: "Confirm room",
            location: "Desk",
            participants: ["Me", "Team"],
            commitment_type: "review",
          }),
        }),
      );

      return Promise.resolve({
        ok: true,
        json: async () => ({
          id: "event-1",
          type: "event",
          title: "Review",
          status: "approved",
          description: "Bring agenda",
          note: "Confirm room",
          metadata_: {
            location: "Desk",
            participants: ["Me", "Team"],
            commitment_type: "review",
          },
        }),
      });
    }

    return Promise.resolve({
      ok: true,
      json: async () => [
        { id: "event-1", type: "event", title: "Review", status: "approved" },
      ],
    });
  });
  vi.stubGlobal("fetch", fetchMock);

  const { result } = renderHook(() => useWorkbenchController());

  await act(async () => {
    result.current.selectTab("workspace");
    result.current.selectTab("events");
  });

  await vi.waitFor(() =>
    expect(result.current.workspaceItems.status).toBe("loaded"),
  );

  act(() => result.current.openDetailView(result.current.workspaceItems.items[0]!));

  await act(async () => {
    await result.current.saveDetailItem({
      description: "Bring agenda",
      note: "Confirm room",
      location: "Desk",
      participants: ["Me", "Team"],
      commitment_type: "review",
    });
  });

  expect(result.current.detailItem?.metadata_?.location).toBe("Desk");
});
```

- [ ] **Step 2: Run the controller test to verify it fails**

Run:

```bash
cd frontend && npm run typecheck
```

Expected: FAIL at TypeScript compilation because `WorkspaceItemPatch` does not support the new fields.

- [ ] **Step 3: Extend the patch type**

In `frontend/src/features/workbench/model/workbench-model.ts`, add fields to `WorkspaceItemPatch`:

```ts
description?: string;
horizon?: string;
parent_id?: string;
location?: string;
participants?: string[];
commitment_type?: string;
```

- [ ] **Step 4: Run the controller test to verify it passes**

Run:

```bash
cd frontend && npm run typecheck && npm test -- use-workbench-controller.spec.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/workbench/model/workbench-model.ts frontend/tests/presentation/use-workbench-controller.spec.tsx
git commit -m "$(cat <<'EOF'
[UPDATE] Add workspace patch fields

- 프론트엔드 패치 타입에 상세 전용 필드와 이벤트 메타데이터 필드 추가
- 컨트롤러 저장 경로가 새 필드를 그대로 PATCH 요청에 싣는지 검증
EOF
)"
```

---

### Task 3: Render Table Columns from the Approved Field Set

**Files:**
- Modify: `frontend/src/features/workbench/ui/MainPanel.tsx`
- Modify: `frontend/tests/presentation/workbench-wireframe.spec.tsx`

**Interfaces:**
- Consumes: `WorkspaceItemModel`, `WorkspaceItemPatch`, `WorkbenchController`
- Produces: `columnsForPanel(panelId: LeafTabId): ItemColumn[]` includes the approved visible fields and marks detail-only fields as read-only table summaries.

- [ ] **Step 1: Write the failing table test**

Update the existing `"shows linked workspace item titles in item-specific columns"` test in `frontend/tests/presentation/workbench-wireframe.spec.tsx` so the fixture includes these values:

```tsx
description: "Call clinic and confirm insurance",
note: "Call before noon",
created_at: "2026-06-20T00:00:00Z",
updated_at: "2026-06-21T00:00:00Z",
```

Add assertions in the Tasks section:

```tsx
expect(
  screen.getByRole("cell", { name: "Call clinic and confirm insurance" }),
).toBeInTheDocument();
expect(screen.getByRole("cell", { name: "Call before noon" })).toBeInTheDocument();
expect(screen.getAllByRole("cell", { name: "2026-06-20" }).length).toBeGreaterThan(0);
expect(screen.getAllByRole("cell", { name: "2026-06-21" }).length).toBeGreaterThan(0);
expect(screen.queryByLabelText("Description for Book physio")).toBeNull();
expect(screen.queryByLabelText("Note for Book physio")).toBeNull();
```

In the Goals section, add:

```tsx
expect(screen.getByLabelText("Scheduled for June outcome")).toHaveValue("2026-06-01");
expect(screen.getByLabelText("Horizon for June outcome")).toHaveValue("month");
```

- [ ] **Step 2: Run the table test to verify it fails**

Run:

```bash
cd frontend && npm test -- workbench-wireframe.spec.tsx
```

Expected: FAIL because task `description`/`note`/`created_at` are not visible and goal `scheduled`/`horizon` are not inline controls.

- [ ] **Step 3: Add the missing inline select control**

In `frontend/src/features/workbench/ui/MainPanel.tsx`, add `InlineSelect` near the other inline controls:

```tsx
function InlineSelect({
  label,
  value,
  options,
  onCommit,
}: {
  label: string;
  value: string | null | undefined;
  options: string[];
  onCommit: (value: string) => void;
}) {
  const selectedValue = value ?? "";

  return (
    <select
      className="inline-cell-control"
      aria-label={label}
      value={selectedValue}
      onClick={stopRowEvent}
      onKeyDown={stopRowEvent}
      onChange={(event) => {
        const nextValue = event.target.value;

        if (nextValue === selectedValue) {
          return;
        }

        onCommit(nextValue);
      }}
    >
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
}
```

- [ ] **Step 4: Update `itemColumns` to match the approved visible set**

In `frontend/src/features/workbench/ui/MainPanel.tsx`, keep `sharedColumns`, then adjust each panel list:

```tsx
const itemColumns: Partial<Record<LeafTabId, ItemColumn[]>> = {
  areas: [
    ...sharedColumns,
    {
      label: "Review Cycle",
      value: (item, _items, controller) => (
        <InlineTextInput
          label={`Review Cycle for ${item.title}`}
          value={item.review_cycle ?? ""}
          onCommit={(review_cycle) =>
            void controller.patchWorkspaceItem(item.id, { review_cycle })
          }
        />
      ),
    },
    { label: "Standard", value: (item) => displayValue(item.standard) },
    { label: "Note", value: (item) => displayValue(item.note) },
    { label: "Created", value: (item) => formatDate(item.created_at) },
    { label: "Updated", value: (item) => formatDate(item.updated_at) },
  ],
  projects: [
    ...sharedColumns,
    areaColumn(),
    dueColumn(),
    { label: "Outcome", value: (item) => displayValue(item.outcome) },
    {
      label: "Definition of Done",
      value: (item) => displayValue(item.definition_of_done),
    },
    { label: "Note", value: (item) => displayValue(item.note) },
    { label: "Created", value: (item) => formatDate(item.created_at) },
    { label: "Updated", value: (item) => formatDate(item.updated_at) },
  ],
  tasks: [
    ...sharedColumns,
    areaColumn(),
    projectColumn(),
    routineColumn(),
    scheduledDateColumn(),
    dueColumn(),
    priorityColumn(),
    { label: "Description", value: (item) => displayValue(item.description) },
    { label: "Note", value: (item) => displayValue(item.note) },
    { label: "Created", value: (item) => formatDate(item.created_at) },
    { label: "Updated", value: (item) => formatDate(item.updated_at) },
  ],
  routines: [
    ...sharedColumns,
    areaColumn(),
    { label: "Recurrence Rule", value: (item) => displayValue(item.recurrence_rule) },
    {
      label: "Materialization Policy",
      value: (item, _items, controller) => (
        <InlineSelect
          label={`Materialization Policy for ${item.title}`}
          value={item.materialization_policy}
          options={["single_open", "per_occurrence"]}
          onCommit={(materialization_policy) =>
            void controller.patchWorkspaceItem(item.id, { materialization_policy })
          }
        />
      ),
    },
    { label: "Note", value: (item) => displayValue(item.note) },
    { label: "Last Materialized", value: (item) => formatDate(item.last_materialized_at) },
    { label: "Created", value: (item) => formatDate(item.created_at) },
    { label: "Updated", value: (item) => formatDate(item.updated_at) },
  ],
  events: [
    ...sharedColumns,
    areaColumn(),
    projectColumn(),
    startsAtColumn(),
    dueColumn(),
    priorityColumn(),
    { label: "Description", value: (item) => displayValue(item.description) },
    { label: "Note", value: (item) => displayValue(item.note) },
    locationColumn(),
    { label: "Participants", value: (item) => displayValue(item.metadata_?.participants?.join(", ")) },
    commitmentTypeColumn(),
    { label: "Created", value: (item) => formatDate(item.created_at) },
    { label: "Updated", value: (item) => formatDate(item.updated_at) },
  ],
  goals: [
    ...sharedColumns,
    horizonColumn(),
    scheduledDateColumn(),
    dueColumn(),
    parentGoalColumn(),
    { label: "Note", value: (item) => displayValue(item.note) },
    { label: "Created", value: (item) => formatDate(item.created_at) },
    { label: "Updated", value: (item) => formatDate(item.updated_at) },
  ],
};
```

Define tiny column helpers directly above `itemColumns` so repeated relation/date fields stay short:

```tsx
function areaColumn(): ItemColumn {
  return {
    label: "Area",
    value: (item, items, controller) => (
      <InlineRelationSelect
        label={`Area for ${item.title}`}
        value={item.area_id}
        options={items.relatedItems.areas}
        onCommit={(area) => void controller.patchWorkspaceItem(item.id, { area })}
      />
    ),
  };
}
```

Add these helpers with the exact patch payloads shown:

```tsx
function projectColumn(): ItemColumn {
  return {
    label: "Project",
    value: (item, items, controller) => (
      <InlineRelationSelect
        label={`Project for ${item.title}`}
        value={item.project_id}
        options={items.relatedItems.projects}
        onCommit={(project_id) =>
          void controller.patchWorkspaceItem(item.id, { project_id })
        }
      />
    ),
  };
}

function routineColumn(): ItemColumn {
  return {
    label: "Routine",
    value: (item, items, controller) => (
      <InlineRelationSelect
        label={`Routine for ${item.title}`}
        value={item.routine_id}
        options={items.relatedItems.routines}
        onCommit={(routine_id) =>
          void controller.patchWorkspaceItem(item.id, { routine_id })
        }
      />
    ),
  };
}

function dueColumn(): ItemColumn {
  return {
    label: "Due",
    value: (item, _items, controller) => (
      <InlineTextInput
        label={`Due for ${item.title}`}
        type="date"
        value={item.due ?? ""}
        onCommit={(due) => void controller.patchWorkspaceItem(item.id, { due })}
      />
    ),
  };
}

function scheduledDateColumn(): ItemColumn {
  return {
    label: "Scheduled",
    value: (item, _items, controller) => (
      <InlineTextInput
        label={`Scheduled for ${item.title}`}
        type="date"
        value={formatDateValue(item.scheduled)}
        onCommit={(scheduled) =>
          void controller.patchWorkspaceItem(item.id, { scheduled })
        }
      />
    ),
  };
}

function startsAtColumn(): ItemColumn {
  return {
    label: "Starts At",
    value: (item, _items, controller) => (
      <InlineTextInput
        label={`Scheduled for ${item.title}`}
        type="datetime-local"
        value={formatDateTimeLocalValue(item.scheduled)}
        onCommit={(scheduled) =>
          void controller.patchWorkspaceItem(item.id, {
            scheduled: formatDateTimeCommitValue(scheduled),
          })
        }
      />
    ),
  };
}

function priorityColumn(): ItemColumn {
  return {
    label: "Priority",
    value: (item, _items, controller) => (
      <InlineNumberInput
        label={`Priority for ${item.title}`}
        value={item.priority}
        onCommit={(priority) =>
          void controller.patchWorkspaceItem(item.id, { priority })
        }
      />
    ),
  };
}

function horizonColumn(): ItemColumn {
  return {
    label: "Horizon",
    value: (item, _items, controller) => (
      <InlineSelect
        label={`Horizon for ${item.title}`}
        value={item.horizon}
        options={["week", "month", "year"]}
        onCommit={(horizon) => void controller.patchWorkspaceItem(item.id, { horizon })}
      />
    ),
  };
}

function parentGoalColumn(): ItemColumn {
  return {
    label: "Parent",
    value: (item, items, controller) => (
      <InlineRelationSelect
        label={`Parent for ${item.title}`}
        value={item.parent_id}
        options={items.relatedItems.goals}
        onCommit={(parent_id) =>
          void controller.patchWorkspaceItem(item.id, { parent_id })
        }
      />
    ),
  };
}

function locationColumn(): ItemColumn {
  return {
    label: "Location",
    value: (item, _items, controller) => (
      <InlineTextInput
        label={`Location for ${item.title}`}
        value={item.metadata_?.location ?? ""}
        onCommit={(location) =>
          void controller.patchWorkspaceItem(item.id, { location })
        }
      />
    ),
  };
}

function commitmentTypeColumn(): ItemColumn {
  return {
    label: "Commitment Type",
    value: (item, _items, controller) => (
      <InlineTextInput
        label={`Commitment Type for ${item.title}`}
        value={item.metadata_?.commitment_type ?? ""}
        onCommit={(commitment_type) =>
          void controller.patchWorkspaceItem(item.id, { commitment_type })
        }
      />
    ),
  };
}
```

- [ ] **Step 5: Run the table test to verify it passes**

Run:

```bash
cd frontend && npm test -- workbench-wireframe.spec.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/workbench/ui/MainPanel.tsx frontend/tests/presentation/workbench-wireframe.spec.tsx
git commit -m "$(cat <<'EOF'
[UPDATE] Align workspace table columns

- 타입별 테이블 컬럼을 승인된 items 컬럼 세트에 맞게 정리
- 상세 전용 필드는 테이블에서 읽기 요약으로만 보여주도록 유지
EOF
)"
```

---

### Task 4: Render Detail Fields from the Same Visible Set

**Files:**
- Modify: `frontend/src/features/workbench/ui/MainPanel.tsx`
- Modify: `frontend/tests/presentation/workbench-wireframe.spec.tsx`

**Interfaces:**
- Consumes: the field behavior from Task 3.
- Produces: detail view renders the same ordered fields as the table and saves `detail` fields through `saveDetailItem`.

- [ ] **Step 1: Write the failing detail test**

Add this test to `frontend/tests/presentation/workbench-wireframe.spec.tsx`:

```tsx
it("shows the same task fields in the table and detail while editing long fields only in detail", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url === "/todo-engine/items/task-1") {
      expect(init).toEqual(
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({
            title: "Book physio",
            description: "Updated description",
            note: "Updated note",
            scheduled: "2026-07-03",
            due: "2026-07-04",
            priority: 2,
          }),
        }),
      );

      return Promise.resolve({
        ok: true,
        json: async () => ({
          id: "task-1",
          type: "task",
          title: "Book physio",
          status: "approved",
          scheduled: "2026-07-03",
          due: "2026-07-04",
          priority: 2,
          description: "Updated description",
          note: "Updated note",
          created_at: "2026-07-01T00:00:00Z",
          updated_at: "2026-07-02T00:00:00Z",
        }),
      });
    }

    return Promise.resolve({
      ok: true,
      json: async () => [
        {
          id: "task-1",
          type: "task",
          title: "Book physio",
          status: "approved",
          scheduled: "2026-07-03",
          due: "2026-07-04",
          priority: 1,
          description: "Original description",
          note: "Original note",
          created_at: "2026-07-01T00:00:00Z",
          updated_at: "2026-07-02T00:00:00Z",
        },
      ],
    });
  });
  vi.stubGlobal("fetch", fetchMock);

  render(<WorkbenchPageClient />);
  await user.click(screen.getByRole("button", { name: "ToDo" }));
  await user.click(screen.getByRole("button", { name: "Workspace" }));
  await user.click(screen.getByRole("button", { name: "Tasks" }));

  expect(await screen.findByRole("cell", { name: "Original description" })).toBeInTheDocument();
  expect(screen.getByRole("cell", { name: "Original note" })).toBeInTheDocument();
  expect(screen.queryByLabelText("Description for Book physio")).toBeNull();

  await user.click(screen.getByRole("cell", { name: "Book physio" }));

  expect(screen.getByLabelText("Title")).toHaveValue("Book physio");
  expect(screen.getByLabelText("Scheduled")).toHaveValue("2026-07-03");
  expect(screen.getByLabelText("Due")).toHaveValue("2026-07-04");
  expect(screen.getByLabelText("Priority")).toHaveValue(1);
  expect(screen.getByLabelText("Description")).toHaveValue("Original description");
  expect(screen.getByLabelText("Note")).toHaveValue("Original note");
  expect(screen.getByText("2026-07-01")).toBeInTheDocument();
  expect(screen.getByText("2026-07-02")).toBeInTheDocument();

  await user.clear(screen.getByLabelText("Description"));
  await user.type(screen.getByLabelText("Description"), "Updated description");
  await user.clear(screen.getByLabelText("Note"));
  await user.type(screen.getByLabelText("Note"), "Updated note");
  await user.clear(screen.getByLabelText("Priority"));
  await user.type(screen.getByLabelText("Priority"), "2");
  await user.click(screen.getByRole("button", { name: "Save" }));

  expect(await screen.findByDisplayValue("Updated description")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the detail test to verify it fails**

Run:

```bash
cd frontend && npm test -- workbench-wireframe.spec.tsx
```

Expected: FAIL because detail view does not render `description`, `created_at`, and shared task fields from the same column set.

- [ ] **Step 3: Extend the detail draft**

In `frontend/src/features/workbench/ui/MainPanel.tsx`, add to `DetailDraft`:

```ts
description: string;
horizon: string;
parent_id: string;
location: string;
participants: string;
commitment_type: string;
```

In `detailDraftForItem`, populate those fields:

```ts
description: item?.description ?? "",
horizon: item?.horizon ?? "month",
parent_id: item?.parent_id ?? "",
location: item?.metadata_?.location ?? "",
participants: item?.metadata_?.participants?.join(", ") ?? "",
commitment_type: item?.metadata_?.commitment_type ?? "",
```

- [ ] **Step 4: Update `detailPatchForItem`**

Add patch handling:

```ts
addStringPatch(patch, "description", draft.description, item.description);
```

For events:

```ts
addStringPatch(patch, "location", draft.location, item.metadata_?.location);
patch.participants = draft.participants
  .split(",")
  .map((participant) => participant.trim())
  .filter(Boolean);
addStringPatch(
  patch,
  "commitment_type",
  draft.commitment_type,
  item.metadata_?.commitment_type,
);
```

For goals:

```ts
addStringPatch(patch, "horizon", draft.horizon, item.horizon);
addStringPatch(patch, "scheduled", draft.scheduled, item.scheduled);
addStringPatch(patch, "parent_id", draft.parent_id, item.parent_id);
```

- [ ] **Step 5: Render the missing detail fields**

Keep `DetailTypeFields` simple and explicit. Add the fields required by the approved set:

```tsx
<DetailTextField
  label="Description"
  value={draft.description}
  onChange={(value) => setField("description", value)}
/>
```

For readonly timestamps in `DetailView`, add property rows when present:

```tsx
<div className="property-row">
  <span>Created</span>
  <span>{formatDate(item.created_at)}</span>
</div>
<div className="property-row">
  <span>Updated</span>
  <span>{formatDate(item.updated_at)}</span>
</div>
```

Remove the separate bottom `Note` block only after each item type's `Note` field is rendered in `DetailTypeFields`, so the detail view does not duplicate it.

- [ ] **Step 6: Run the detail test to verify it passes**

Run:

```bash
cd frontend && npm test -- workbench-wireframe.spec.tsx
```

Expected: PASS.

- [ ] **Step 7: Run full verification**

Run:

```bash
cargo test
cd frontend && npm test && npm run typecheck
```

Expected: all commands PASS.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/features/workbench/ui/MainPanel.tsx frontend/tests/presentation/workbench-wireframe.spec.tsx
git commit -m "$(cat <<'EOF'
[UPDATE] Align workspace detail fields

- 상세 화면이 테이블과 같은 타입별 컬럼 세트를 보여주도록 정리
- note와 description 같은 긴 필드는 상세에서만 편집되도록 검증
EOF
)"
```

---

## Self-Review

- Spec coverage: covered same table/detail field sets, `inline`, `detail`, `readonly`, hidden system fields, no schema changes, service-layer mutation path.
- Placeholder scan: no `TBD`, `TODO`, or unspecified implementation steps.
- Type consistency: frontend patch fields match backend PATCH body fields; `metadata_` remains the API response shape while PATCH uses named metadata fields.
