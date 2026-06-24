# Workspace Item Table Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `ToDo > Workspace` into an editable todo-engine item workbench with typed tables, row selection, archive confirmation, row creation, and a Notion-like detail view.

**Architecture:** Keep SQLite behind todo-engine only. Frontend mutations call the existing Rust HTTP API through the Next.js `/todo-engine/*` proxy. Keep state in `useWorkbenchController`; keep `MainPanel` presentational and pass explicit callbacks from the controller.

**Tech Stack:** Rust 2024, axum, todo-engine service layer, Next.js App Router, React, TypeScript, Vitest, React Testing Library, lucide-react.

## Global Constraints

- No direct SQLite writes from the frontend.
- No hard delete; trash archives selected items through `POST /items/:id/archive`.
- No schema or column definition editing.
- No custom item type creation.
- No Notion-style block editor in the first version.
- Use native inputs and existing dependencies only.
- Every mutation goes through todo-engine API/service paths so validation and audit events stay intact.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `todo-engine/src/interfaces/api/dto.rs` | Add goal propose request DTO. |
| `todo-engine/src/interfaces/api/handlers.rs` | Add goal propose handler using `TodoService::propose_goal`. |
| `todo-engine/src/interfaces/api/mod.rs` | Add `POST /goals/propose`. |
| `todo-engine/tests/e2e/api.rs` | Lock the goal API route. |
| `docs/operations/api-reference.md` | Document the added goal route. |
| `frontend/src/domain/workbench/navigation.ts` | Add `events` and `goals` workspace tabs. |
| `frontend/src/design/copy.ts` | Add panel copy for `Events` and `Goals`. |
| `frontend/src/features/workbench/model/workbench-model.ts` | Expand item fields and controller interface. |
| `frontend/src/features/workbench/hooks/useWorkbenchController.ts` | Own selection, detail mode, archive flow, creation, and save actions. |
| `frontend/src/features/workbench/ui/WorkbenchWireframe.tsx` | Pass the full controller to `MainPanel`. |
| `frontend/src/features/workbench/ui/MainPanel.tsx` | Render toolbar, selectable table, create dialog, archive dialog, inline editors, and detail view. |
| `frontend/src/styles/globals.css` | Style toolbar, checkboxes, dialogs, row hover, inline inputs, and detail view. |
| `frontend/tests/domain/workbench-navigation.spec.ts` | Lock new workspace tabs. |
| `frontend/tests/presentation/use-workbench-controller.spec.tsx` | Lock controller API calls and state transitions. |
| `frontend/tests/presentation/workbench-wireframe.spec.tsx` | Lock visible UX: selection, archive confirmation, creation, detail view, and columns. |

---

### Task 1: Add Goal Creation API

**Files:**
- Modify: `todo-engine/src/interfaces/api/dto.rs`
- Modify: `todo-engine/src/interfaces/api/handlers.rs`
- Modify: `todo-engine/src/interfaces/api/mod.rs`
- Modify: `todo-engine/tests/e2e/api.rs`
- Modify: `docs/operations/api-reference.md`

**Interfaces:**
- Consumes: `TodoService::propose_goal(ProposeGoal) -> TodoResult<TodoItem>`
- Produces: `POST /goals/propose` with body `{ title, horizon, scheduled, parent_id?, actor?, note? }`

- [ ] **Step 1: Write the failing API test**

Append this assertion block inside `operational_propose_routes_return_persisted_items` after the event assertions in `todo-engine/tests/e2e/api.rs`:

```rust
    let response = json_request(
        router(&db_path).unwrap(),
        "POST",
        "/goals/propose",
        json!({
            "title":"6월 운영 목표",
            "horizon":"month",
            "scheduled":"2026-06-01",
            "actor":"user",
            "note":"월간 운영 안정화"
        }),
    )
    .await;
    assert_eq!(response.status(), 200);
    let goal = body_json(response).await;
    assert_eq!(goal["type"], "goal");
    assert_eq!(goal["status"], "approved");
    assert_eq!(goal["horizon"], "month");
    assert_eq!(goal["scheduled"], "2026-06-01");
    assert_eq!(goal["note"], "월간 운영 안정화");
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
cargo test -p todo-engine --test e2e operational_propose_routes_return_persisted_items
```

Expected: FAIL with a 404 or route-not-found status for `/goals/propose`.

- [ ] **Step 3: Add the goal DTO**

In `todo-engine/src/interfaces/api/dto.rs`, add:

```rust
#[derive(Deserialize)]
pub(super) struct GoalProposeBody {
    pub title: String,
    pub horizon: String,
    pub scheduled: String,
    pub parent_id: Option<String>,
    pub actor: Option<String>,
    pub note: Option<String>,
}
```

- [ ] **Step 4: Add the handler**

In `todo-engine/src/interfaces/api/handlers.rs`, add `GoalProposeBody` to the DTO import and `ProposeGoal` to the service import. Then add:

```rust
pub(super) async fn propose_goal(
    State(state): State<ApiState>,
    body: std::result::Result<Json<GoalProposeBody>, JsonRejection>,
) -> ApiResult<Json<TodoItem>> {
    let Json(body) = body.map_err(validation_rejection)?;
    let actor = parse_actor_or_default(body.actor.as_deref())?;
    let item = with_service(&state, |service| {
        service.propose_goal(ProposeGoal {
            title: body.title,
            horizon: body.horizon,
            scheduled: body.scheduled,
            parent_id: body.parent_id,
            actor,
            note: body.note,
        })
    })?;
    Ok(Json(item))
}
```

- [ ] **Step 5: Add the route**

In `todo-engine/src/interfaces/api/mod.rs`, add:

```rust
.route("/goals/propose", post(propose_goal))
```

Place it beside the other propose routes.

- [ ] **Step 6: Update API reference**

In `docs/operations/api-reference.md`, add one route row:

```markdown
| `POST` | `/goals/propose` | `propose_goal` | `GoalProposeBody` |
```

Add body text near the other request-body descriptions:

```markdown
- **`GoalProposeBody`** - `title` (required), `horizon` (required: `year`, `month`, or `week`), `scheduled` (required canonical period start date), `parent_id?`, `actor?`, `note?`.
```

- [ ] **Step 7: Verify and commit**

Run:

```bash
cargo test -p todo-engine --test e2e operational_propose_routes_return_persisted_items
cargo fmt --check
```

Expected: PASS.

Commit:

```bash
git add todo-engine/src/interfaces/api/dto.rs todo-engine/src/interfaces/api/handlers.rs todo-engine/src/interfaces/api/mod.rs todo-engine/tests/e2e/api.rs docs/operations/api-reference.md
git commit -m "[ADD] Add goal propose API route"
```

---

### Task 2: Add Events and Goals to Workspace Tables

**Files:**
- Modify: `frontend/src/domain/workbench/navigation.ts`
- Modify: `frontend/src/design/copy.ts`
- Modify: `frontend/src/features/workbench/model/workbench-model.ts`
- Modify: `frontend/src/features/workbench/hooks/useWorkbenchController.ts`
- Modify: `frontend/src/features/workbench/ui/MainPanel.tsx`
- Modify: `frontend/tests/domain/workbench-navigation.spec.ts`
- Modify: `frontend/tests/presentation/workbench-wireframe.spec.tsx`

**Interfaces:**
- Produces: Workspace tabs `events` and `goals`.
- Produces: Default columns from the design spec, with `note` removed from tables.

- [ ] **Step 1: Write failing navigation tests**

In `frontend/tests/domain/workbench-navigation.spec.ts`, update the workspace tab assertion:

```ts
expect(workbenchNavigation.workspaceTabs.map((tab) => tab.id)).toEqual([
  "areas",
  "projects",
  "routines",
  "tasks",
  "events",
  "goals",
]);
```

Add:

```ts
it("resolves events and goals under workspace", () => {
  expect(resolveSelection("events")).toEqual({
    mainTabId: "todo",
    leafTabId: "events",
    workspaceExpanded: true,
    plannerExpanded: false,
  });
  expect(resolveSelection("goals")).toEqual({
    mainTabId: "todo",
    leafTabId: "goals",
    workspaceExpanded: true,
    plannerExpanded: false,
  });
});
```

- [ ] **Step 2: Write failing rendering tests**

In `frontend/tests/presentation/workbench-wireframe.spec.tsx`, add to the linked item test response map:

```ts
"/todo-engine/items?type=event": [
  {
    id: "event-1",
    type: "event",
    title: "Planning review",
    status: "approved",
    area_id: "area-1",
    scheduled: "2026-06-24T10:00:00Z",
    metadata_: { location: "Desk", participants: ["Me"] },
    updated_at: "2026-06-21T00:00:00Z",
  },
],
"/todo-engine/items?type=goal": [
  {
    id: "goal-1",
    type: "goal",
    title: "June outcome",
    status: "approved",
    horizon: "month",
    scheduled: "2026-06-01",
    due: "2026-06-30",
    parent_id: null,
    updated_at: "2026-06-21T00:00:00Z",
  },
],
```

Then add clicks and assertions:

```ts
await user.click(screen.getByRole("button", { name: "Events" }));
await waitFor(() =>
  expect(screen.getByRole("cell", { name: "Planning review" })).toBeInTheDocument(),
);
expect(screen.getByRole("cell", { name: "Desk" })).toBeInTheDocument();
expect(screen.getByRole("cell", { name: "Me" })).toBeInTheDocument();

await user.click(screen.getByRole("button", { name: "Goals" }));
await waitFor(() =>
  expect(screen.getByRole("cell", { name: "June outcome" })).toBeInTheDocument(),
);
expect(screen.getByRole("cell", { name: "month" })).toBeInTheDocument();
expect(screen.getByRole("cell", { name: "2026-06-30" })).toBeInTheDocument();
```

- [ ] **Step 3: Run failing tests**

Run:

```bash
cd frontend
npm run test -- tests/domain/workbench-navigation.spec.ts tests/presentation/workbench-wireframe.spec.tsx
```

Expected: FAIL because `events` and `goals` are not valid tab ids.

- [ ] **Step 4: Update navigation and copy**

In `frontend/src/domain/workbench/navigation.ts`, change:

```ts
export type WorkspaceChildTabId = "areas" | "projects" | "routines" | "tasks";
```

to:

```ts
export type WorkspaceChildTabId =
  | "areas"
  | "projects"
  | "routines"
  | "tasks"
  | "events"
  | "goals";
```

Add tabs:

```ts
{ id: "events", label: "Events" },
{ id: "goals", label: "Goals" },
```

Add both ids to `workspaceLeafTabIds`.

In `frontend/src/design/copy.ts`, add:

```ts
events: {
  title: "Events",
},
goals: {
  title: "Goals",
},
```

- [ ] **Step 5: Expand frontend item model and fetching**

In `frontend/src/features/workbench/model/workbench-model.ts`, add fields:

```ts
parent_id?: string | null;
horizon?: string | null;
created_at?: string | null;
metadata_?: {
  location?: string;
  participants?: string[];
  commitment_type?: string;
};
```

Add `goals` to `relatedItems`:

```ts
goals: Record<string, string>;
```

In `frontend/src/features/workbench/hooks/useWorkbenchController.ts`, expand:

```ts
type WorkspaceItemType = "area" | "project" | "routine" | "task" | "event" | "goal";
```

Add:

```ts
events: "event",
goals: "goal",
```

Keep related fetches small:

```ts
events: ["area", "project"],
goals: ["goal"],
```

Add `goals: titlesById(items, "goal")` to `buildRelatedItems`.

- [ ] **Step 6: Update default columns**

In `frontend/src/features/workbench/ui/MainPanel.tsx`, remove `Note` from existing default table columns. Add:

```ts
events: [
  ...sharedColumns,
  { label: "Area", value: (item, items) => relatedTitle(items.relatedItems.areas, item.area_id) },
  { label: "Starts At", value: (item) => displayValue(item.scheduled) },
  { label: "Location", value: (item) => displayValue(item.metadata_?.location) },
  { label: "With", value: (item) => displayValue(item.metadata_?.participants?.join(", ")) },
  { label: "Updated", value: (item) => formatDate(item.updated_at) },
],
goals: [
  ...sharedColumns,
  { label: "Horizon", value: (item) => displayValue(item.horizon) },
  { label: "Area", value: (item, items) => relatedTitle(items.relatedItems.areas, item.area_id) },
  { label: "Due", value: (item) => displayValue(item.due) },
  { label: "Parent", value: (item, items) => relatedTitle(items.relatedItems.goals, item.parent_id) },
  { label: "Updated", value: (item) => formatDate(item.updated_at) },
],
```

- [ ] **Step 7: Verify and commit**

Run:

```bash
cd frontend
npm run test -- tests/domain/workbench-navigation.spec.ts tests/presentation/workbench-wireframe.spec.tsx
npm run typecheck
```

Expected: PASS.

Commit:

```bash
git add frontend/src/domain/workbench/navigation.ts frontend/src/design/copy.ts frontend/src/features/workbench/model/workbench-model.ts frontend/src/features/workbench/hooks/useWorkbenchController.ts frontend/src/features/workbench/ui/MainPanel.tsx frontend/tests/domain/workbench-navigation.spec.ts frontend/tests/presentation/workbench-wireframe.spec.tsx
git commit -m "[UPDATE] Show event and goal workspace tables"
```

---

### Task 3: Add Row Selection and Archive Confirmation

**Files:**
- Modify: `frontend/src/features/workbench/model/workbench-model.ts`
- Modify: `frontend/src/features/workbench/hooks/useWorkbenchController.ts`
- Modify: `frontend/src/features/workbench/ui/WorkbenchWireframe.tsx`
- Modify: `frontend/src/features/workbench/ui/MainPanel.tsx`
- Modify: `frontend/src/styles/globals.css`
- Modify: `frontend/tests/presentation/use-workbench-controller.spec.tsx`
- Modify: `frontend/tests/presentation/workbench-wireframe.spec.tsx`

**Interfaces:**
- Produces: `selectedItemIds: string[]`
- Produces: `toggleItemSelection(id: string)`, `toggleVisibleSelection()`, `requestArchiveSelected()`, `cancelArchiveSelected()`, `confirmArchiveSelected()`
- Produces: archive requests to `/todo-engine/items/:id/archive`

- [ ] **Step 1: Write failing controller test**

In `frontend/tests/presentation/use-workbench-controller.spec.tsx`, add:

```ts
it("archives selected workspace rows after confirmation", async () => {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (String(url).endsWith("/archive")) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ id: "task-1", status: "archived" }),
      });
    }

    return Promise.resolve({
      ok: true,
      json: async () => [
        { id: "task-1", type: "task", title: "One", status: "approved" },
        { id: "task-2", type: "task", title: "Two", status: "approved" },
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

  act(() => result.current.toggleItemSelection("task-1"));
  expect(result.current.selectedItemIds).toEqual(["task-1"]);

  act(() => result.current.requestArchiveSelected());
  expect(result.current.archiveConfirmationOpen).toBe(true);

  await act(async () => result.current.confirmArchiveSelected());

  expect(fetchMock).toHaveBeenCalledWith(
    "/todo-engine/items/task-1/archive",
    expect.objectContaining({ method: "POST" }),
  );
  expect(result.current.selectedItemIds).toEqual([]);
  expect(result.current.archiveConfirmationOpen).toBe(false);
});
```

- [ ] **Step 2: Write failing UI test**

In `frontend/tests/presentation/workbench-wireframe.spec.tsx`, add:

```ts
it("enables trash only for selected rows and confirms archive", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (String(url).endsWith("/archive")) {
      return Promise.resolve({ ok: true, json: async () => ({}) });
    }

    return Promise.resolve({
      ok: true,
      json: async () => [
        { id: "task-1", type: "task", title: "One", status: "approved" },
        { id: "task-2", type: "task", title: "Two", status: "approved" },
      ],
    });
  });
  vi.stubGlobal("fetch", fetchMock);

  render(<WorkbenchPageClient />);
  await user.click(screen.getByRole("button", { name: "ToDo" }));
  await user.click(screen.getByRole("button", { name: "Workspace" }));
  await user.click(screen.getByRole("button", { name: "Tasks" }));

  const trash = await screen.findByRole("button", { name: "Archive selected items" });
  expect(trash).toBeDisabled();

  await user.click(screen.getByRole("checkbox", { name: "Select One" }));
  expect(trash).toBeEnabled();

  await user.click(trash);
  expect(screen.getByRole("dialog", { name: "Archive selected items?" })).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Archive" }));
  expect(fetchMock).toHaveBeenCalledWith(
    "/todo-engine/items/task-1/archive",
    expect.objectContaining({ method: "POST" }),
  );
});
```

- [ ] **Step 3: Run failing tests**

Run:

```bash
cd frontend
npm run test -- tests/presentation/use-workbench-controller.spec.tsx tests/presentation/workbench-wireframe.spec.tsx
```

Expected: FAIL because the controller lacks selection/archive actions.

- [ ] **Step 4: Extend controller model**

In `frontend/src/features/workbench/model/workbench-model.ts`, add to `WorkbenchController`:

```ts
selectedItemIds: string[];
archiveConfirmationOpen: boolean;
toggleItemSelection: (itemId: string) => void;
toggleVisibleSelection: () => void;
requestArchiveSelected: () => void;
cancelArchiveSelected: () => void;
confirmArchiveSelected: () => Promise<void>;
```

- [ ] **Step 5: Implement selection and archive in the hook**

In `frontend/src/features/workbench/hooks/useWorkbenchController.ts`, add state:

```ts
const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
const [archiveConfirmationOpen, setArchiveConfirmationOpen] = useState(false);
```

Clear selection when `selection.leafTabId` changes.

Add helpers:

```ts
function postArchiveItem(itemId: string): Promise<WorkspaceItemModel> {
  return fetch(`/todo-engine/items/${itemId}/archive`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason: "Archived from workspace table" }),
  }).then((response) => {
    if (!response.ok) {
      throw new Error(`todo-engine returned ${response.status}`);
    }

    return response.json();
  });
}
```

Return actions:

```ts
toggleItemSelection: (itemId) =>
  setSelectedItemIds((current) =>
    current.includes(itemId)
      ? current.filter((id) => id !== itemId)
      : [...current, itemId],
  ),
toggleVisibleSelection: () =>
  setSelectedItemIds((current) => {
    const visibleIds = workspaceItems.items.map((item) => item.id);
    return visibleIds.every((id) => current.includes(id)) ? [] : visibleIds;
  }),
requestArchiveSelected: () => setArchiveConfirmationOpen(selectedItemIds.length > 0),
cancelArchiveSelected: () => setArchiveConfirmationOpen(false),
confirmArchiveSelected: async () => {
  await Promise.all(selectedItemIds.map(postArchiveItem));
  setWorkspaceItems((current) => ({
    ...current,
    items: current.items.filter((item) => !selectedItemIds.includes(item.id)),
  }));
  setSelectedItemIds([]);
  setArchiveConfirmationOpen(false);
},
```

- [ ] **Step 6: Render toolbar, checkboxes, and dialog**

In `frontend/src/features/workbench/ui/WorkbenchWireframe.tsx`, pass the full controller:

```tsx
<MainPanel controller={controller} />
```

In `frontend/src/features/workbench/ui/MainPanel.tsx`, change props to:

```ts
type MainPanelProps = {
  controller: WorkbenchController;
};
```

Render toolbar above the table:

```tsx
<div className="items-toolbar">
  <button className="items-toolbar-button" type="button" aria-label="Add item">
    +
  </button>
  <button
    className="items-toolbar-button"
    type="button"
    aria-label="Archive selected items"
    disabled={controller.selectedItemIds.length === 0}
    onClick={controller.requestArchiveSelected}
  >
    trash
  </button>
</div>
```

Add header checkbox and row checkboxes:

```tsx
<th scope="col">
  <input
    type="checkbox"
    aria-label="Select all visible items"
    checked={
      workspaceItems.items.length > 0 &&
      workspaceItems.items.every((item) => controller.selectedItemIds.includes(item.id))
    }
    onChange={controller.toggleVisibleSelection}
  />
</th>
```

```tsx
<td>
  <input
    type="checkbox"
    aria-label={`Select ${item.title}`}
    checked={controller.selectedItemIds.includes(item.id)}
    onClick={(event) => event.stopPropagation()}
    onChange={() => controller.toggleItemSelection(item.id)}
  />
</td>
```

Render confirmation when `archiveConfirmationOpen` is true:

```tsx
{controller.archiveConfirmationOpen ? (
  <div className="confirmation-backdrop">
    <section className="confirmation-dialog" role="dialog" aria-modal="true" aria-label="Archive selected items?">
      <h2>Archive selected items?</h2>
      <p>{controller.selectedItemIds.length} items will be moved to archive. You can still find them in Archive.</p>
      <div className="dialog-actions">
        <button type="button" onClick={controller.cancelArchiveSelected}>Cancel</button>
        <button type="button" onClick={controller.confirmArchiveSelected}>Archive</button>
      </div>
    </section>
  </div>
) : null}
```

- [ ] **Step 7: Add minimal styles**

In `frontend/src/styles/globals.css`, add:

```css
.items-toolbar {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-bottom: 12px;
}

.items-toolbar-button {
  min-width: 36px;
  min-height: 36px;
  border: 1px solid var(--color-hairline-light);
  border-radius: var(--radius-xs);
  background: var(--color-canvas-light);
}

.items-toolbar-button:disabled {
  cursor: not-allowed;
  color: var(--color-shade-40);
}

.confirmation-backdrop {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  background: rgb(0 0 0 / 28%);
}

.confirmation-dialog {
  width: min(420px, calc(100vw - 32px));
  border: 1px solid var(--color-hairline-light);
  border-radius: var(--radius-md);
  background: var(--color-canvas-light);
  padding: 20px;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
```

- [ ] **Step 8: Verify and commit**

Run:

```bash
cd frontend
npm run test -- tests/presentation/use-workbench-controller.spec.tsx tests/presentation/workbench-wireframe.spec.tsx
npm run typecheck
```

Expected: PASS.

Commit:

```bash
git add frontend/src/features/workbench/model/workbench-model.ts frontend/src/features/workbench/hooks/useWorkbenchController.ts frontend/src/features/workbench/ui/WorkbenchWireframe.tsx frontend/src/features/workbench/ui/MainPanel.tsx frontend/src/styles/globals.css frontend/tests/presentation/use-workbench-controller.spec.tsx frontend/tests/presentation/workbench-wireframe.spec.tsx
git commit -m "[ADD] Add workspace row archive selection"
```

---

### Task 4: Add Row Creation Dialog

**Files:**
- Modify: `frontend/src/features/workbench/model/workbench-model.ts`
- Modify: `frontend/src/features/workbench/hooks/useWorkbenchController.ts`
- Modify: `frontend/src/features/workbench/ui/MainPanel.tsx`
- Modify: `frontend/src/styles/globals.css`
- Modify: `frontend/tests/presentation/use-workbench-controller.spec.tsx`
- Modify: `frontend/tests/presentation/workbench-wireframe.spec.tsx`

**Interfaces:**
- Produces: `creationDialogOpen`, `openCreationDialog()`, `closeCreationDialog()`, `createWorkspaceItem(form)`
- Produces: create calls to `/areas`, `/projects/propose`, `/tasks/propose`, `/routines/propose`, `/events/propose`, `/goals/propose`
- Produces: detail mode opens for the newly created item.

- [ ] **Step 1: Write failing controller test**

In `frontend/tests/presentation/use-workbench-controller.spec.tsx`, add:

```ts
it("creates a task from the active workspace table and opens it", async () => {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url === "/todo-engine/tasks/propose") {
      expect(init).toEqual(expect.objectContaining({ method: "POST" }));
      return Promise.resolve({
        ok: true,
        json: async () => ({
          id: "task-new",
          type: "task",
          title: "New task",
          status: "approved",
        }),
      });
    }

    return Promise.resolve({ ok: true, json: async () => [] });
  });
  vi.stubGlobal("fetch", fetchMock);

  const { result } = renderHook(() => useWorkbenchController());

  await act(async () => {
    result.current.selectTab("workspace");
    result.current.selectTab("tasks");
  });

  act(() => result.current.openCreationDialog());
  expect(result.current.creationDialogOpen).toBe(true);

  await act(async () => {
    await result.current.createWorkspaceItem({ title: "New task" });
  });

  expect(fetchMock).toHaveBeenCalledWith(
    "/todo-engine/tasks/propose",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ title: "New task", actor: "user" }),
    }),
  );
  expect(result.current.detailItem?.id).toBe("task-new");
});
```

- [ ] **Step 2: Write failing UI test**

In `frontend/tests/presentation/workbench-wireframe.spec.tsx`, add:

```ts
it("opens a creation dialog and creates a row", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url === "/todo-engine/tasks/propose") {
      return Promise.resolve({
        ok: true,
        json: async () => ({ id: "task-new", type: "task", title: "New task", status: "approved" }),
      });
    }

    return Promise.resolve({ ok: true, json: async () => [] });
  });
  vi.stubGlobal("fetch", fetchMock);

  render(<WorkbenchPageClient />);
  await user.click(screen.getByRole("button", { name: "ToDo" }));
  await user.click(screen.getByRole("button", { name: "Workspace" }));
  await user.click(screen.getByRole("button", { name: "Tasks" }));
  await user.click(screen.getByRole("button", { name: "Add item" }));

  expect(screen.getByRole("dialog", { name: "Create Tasks item" })).toBeInTheDocument();

  await user.type(screen.getByLabelText("Title"), "New task");
  await user.click(screen.getByRole("button", { name: "Create" }));

  expect(await screen.findByRole("heading", { name: "New task" })).toBeInTheDocument();
});
```

- [ ] **Step 3: Run failing tests**

Run:

```bash
cd frontend
npm run test -- tests/presentation/use-workbench-controller.spec.tsx tests/presentation/workbench-wireframe.spec.tsx
```

Expected: FAIL because creation state/actions do not exist.

- [ ] **Step 4: Add controller types**

In `frontend/src/features/workbench/model/workbench-model.ts`, add:

```ts
export type CreateWorkspaceItemForm = {
  title: string;
  scheduled?: string;
  horizon?: string;
};
```

Add to `WorkbenchController`:

```ts
creationDialogOpen: boolean;
detailItem: WorkspaceItemModel | null;
openCreationDialog: () => void;
closeCreationDialog: () => void;
createWorkspaceItem: (form: CreateWorkspaceItemForm) => Promise<void>;
closeDetailView: () => void;
```

- [ ] **Step 5: Implement create routing in the hook**

In `frontend/src/features/workbench/hooks/useWorkbenchController.ts`, add:

```ts
function createItemRequest(panelId: LeafTabId, form: CreateWorkspaceItemForm) {
  const title = form.title.trim();

  if (panelId === "areas") {
    return postJson("/todo-engine/areas", { title });
  }
  if (panelId === "projects") {
    return postJson("/todo-engine/projects/propose", { title, actor: "user" });
  }
  if (panelId === "tasks") {
    return postJson("/todo-engine/tasks/propose", { title, actor: "user" });
  }
  if (panelId === "routines") {
    return postJson("/todo-engine/routines/propose", {
      title,
      actor: "user",
      materialization_policy: "single_open",
    });
  }
  if (panelId === "events") {
    return postJson("/todo-engine/events/propose", {
      title,
      scheduled: form.scheduled || new Date().toISOString().slice(0, 10),
      actor: "user",
    });
  }
  if (panelId === "goals") {
    return postJson("/todo-engine/goals/propose", {
      title,
      horizon: form.horizon || "month",
      scheduled: form.scheduled || new Date().toISOString().slice(0, 8) + "01",
      actor: "user",
    });
  }

  throw new Error(`Cannot create item from ${panelId}`);
}

function postJson(url: string, body: unknown): Promise<WorkspaceItemModel> {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((response) => {
    if (!response.ok) {
      throw new Error(`todo-engine returned ${response.status}`);
    }

    return response.json();
  });
}
```

Return:

```ts
openCreationDialog: () => setCreationDialogOpen(true),
closeCreationDialog: () => setCreationDialogOpen(false),
createWorkspaceItem: async (form) => {
  const item = await createItemRequest(selection.leafTabId, form);
  setWorkspaceItems((current) => ({
    ...current,
    items: [item, ...current.items],
  }));
  setDetailItem(item);
  setCreationDialogOpen(false);
},
closeDetailView: () => setDetailItem(null),
```

- [ ] **Step 6: Render the creation dialog**

In `frontend/src/features/workbench/ui/MainPanel.tsx`, wire the existing `Add item` button to `controller.openCreationDialog`.

Add a small form component:

```tsx
function CreationDialog({ controller }: { controller: WorkbenchController }) {
  const [title, setTitle] = React.useState("");
  const [scheduled, setScheduled] = React.useState("");
  const [horizon, setHorizon] = React.useState("month");
  const needsScheduled = controller.panel.id === "events" || controller.panel.id === "goals";
  const needsHorizon = controller.panel.id === "goals";

  return (
    <div className="confirmation-backdrop">
      <form
        className="confirmation-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`Create ${controller.panel.title} item`}
        onSubmit={(event) => {
          event.preventDefault();
          void controller.createWorkspaceItem({ title, scheduled, horizon });
        }}
      >
        <h2>Create {controller.panel.title} item</h2>
        <label className="field-label">
          Title
          <input value={title} onChange={(event) => setTitle(event.target.value)} required />
        </label>
        {needsScheduled ? (
          <label className="field-label">
            Scheduled
            <input type="date" value={scheduled} onChange={(event) => setScheduled(event.target.value)} required />
          </label>
        ) : null}
        {needsHorizon ? (
          <label className="field-label">
            Horizon
            <select value={horizon} onChange={(event) => setHorizon(event.target.value)}>
              <option value="year">year</option>
              <option value="month">month</option>
              <option value="week">week</option>
            </select>
          </label>
        ) : null}
        <div className="dialog-actions">
          <button type="button" onClick={controller.closeCreationDialog}>Cancel</button>
          <button type="submit">Create</button>
        </div>
      </form>
    </div>
  );
}
```

Render it when `controller.creationDialogOpen` is true.

- [ ] **Step 7: Verify and commit**

Run:

```bash
cd frontend
npm run test -- tests/presentation/use-workbench-controller.spec.tsx tests/presentation/workbench-wireframe.spec.tsx
npm run typecheck
```

Expected: PASS.

Commit:

```bash
git add frontend/src/features/workbench/model/workbench-model.ts frontend/src/features/workbench/hooks/useWorkbenchController.ts frontend/src/features/workbench/ui/MainPanel.tsx frontend/src/styles/globals.css frontend/tests/presentation/use-workbench-controller.spec.tsx frontend/tests/presentation/workbench-wireframe.spec.tsx
git commit -m "[ADD] Add workspace row creation dialog"
```

---

### Task 5: Add Detail View with Explicit Save

**Files:**
- Modify: `frontend/src/features/workbench/model/workbench-model.ts`
- Modify: `frontend/src/features/workbench/hooks/useWorkbenchController.ts`
- Modify: `frontend/src/features/workbench/ui/MainPanel.tsx`
- Modify: `frontend/src/styles/globals.css`
- Modify: `frontend/tests/presentation/use-workbench-controller.spec.tsx`
- Modify: `frontend/tests/presentation/workbench-wireframe.spec.tsx`

**Interfaces:**
- Produces: row click opens detail view.
- Produces: `< Back` returns to table view.
- Produces: `saveDetailItem(patch)` sends `PATCH /todo-engine/items/:id`.

- [ ] **Step 1: Write failing UI test**

In `frontend/tests/presentation/workbench-wireframe.spec.tsx`, add:

```ts
it("opens a detail view and saves note edits", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (String(url).includes("/items/task-1") && init?.method === "PATCH") {
      expect(init.body).toBe(JSON.stringify({ title: "One", note: "Saved note" }));
      return Promise.resolve({
        ok: true,
        json: async () => ({ id: "task-1", type: "task", title: "One", status: "approved", note: "Saved note" }),
      });
    }

    return Promise.resolve({
      ok: true,
      json: async () => [
        { id: "task-1", type: "task", title: "One", status: "approved", note: "Old note" },
      ],
    });
  });
  vi.stubGlobal("fetch", fetchMock);

  render(<WorkbenchPageClient />);
  await user.click(screen.getByRole("button", { name: "ToDo" }));
  await user.click(screen.getByRole("button", { name: "Workspace" }));
  await user.click(screen.getByRole("button", { name: "Tasks" }));

  await user.click(await screen.findByRole("cell", { name: "One" }));
  expect(screen.getByRole("heading", { name: "One" })).toBeInTheDocument();
  expect(screen.getByText("Properties")).toBeInTheDocument();

  await user.clear(screen.getByLabelText("Note"));
  await user.type(screen.getByLabelText("Note"), "Saved note");
  await user.click(screen.getByRole("button", { name: "Save" }));

  expect(fetchMock).toHaveBeenCalledWith(
    "/todo-engine/items/task-1",
    expect.objectContaining({ method: "PATCH" }),
  );

  await user.click(screen.getByRole("button", { name: "Back" }));
  expect(screen.getByRole("table", { name: "Tasks items" })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run failing test**

Run:

```bash
cd frontend
npm run test -- tests/presentation/workbench-wireframe.spec.tsx
```

Expected: FAIL because rows do not open a detail view.

- [ ] **Step 3: Add save action to controller**

In `frontend/src/features/workbench/model/workbench-model.ts`, add:

```ts
export type WorkspaceItemPatch = {
  title?: string;
  note?: string;
  due?: string;
  scheduled?: string;
  priority?: number;
  area?: string;
  project_id?: string;
  routine_id?: string;
};
```

Add to `WorkbenchController`:

```ts
openDetailView: (item: WorkspaceItemModel) => void;
saveDetailItem: (patch: WorkspaceItemPatch) => Promise<void>;
```

In the hook, add:

```ts
function patchItem(itemId: string, patch: WorkspaceItemPatch): Promise<WorkspaceItemModel> {
  return fetch(`/todo-engine/items/${itemId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  }).then((response) => {
    if (!response.ok) {
      throw new Error(`todo-engine returned ${response.status}`);
    }

    return response.json();
  });
}
```

Return:

```ts
openDetailView: (item) => setDetailItem(item),
saveDetailItem: async (patch) => {
  if (!detailItem) {
    return;
  }

  const updated = await patchItem(detailItem.id, patch);
  setDetailItem(updated);
  setWorkspaceItems((current) => ({
    ...current,
    items: current.items.map((item) => (item.id === updated.id ? updated : item)),
  }));
},
```

- [ ] **Step 4: Render detail view**

In `frontend/src/features/workbench/ui/MainPanel.tsx`, if `controller.detailItem` exists, render:

```tsx
function DetailView({ controller }: { controller: WorkbenchController }) {
  const item = controller.detailItem;
  const [title, setTitle] = React.useState(item?.title ?? "");
  const [note, setNote] = React.useState(item?.note ?? "");

  if (!item) {
    return null;
  }

  return (
    <section className="detail-view">
      <button type="button" className="detail-back" onClick={controller.closeDetailView}>
        Back
      </button>
      <h1>{item.title}</h1>
      <div className="detail-properties">
        <h2>Properties</h2>
        <label className="field-label">
          Title
          <input value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <div className="property-row">
          <span>Status</span>
          <span>{item.status}</span>
        </div>
        <div className="property-row">
          <span>Type</span>
          <span>{item.type}</span>
        </div>
        <div className="property-row">
          <span>Updated</span>
          <span>{formatDate(item.updated_at)}</span>
        </div>
      </div>
      <label className="field-label detail-note">
        Note
        <textarea value={note} onChange={(event) => setNote(event.target.value)} />
      </label>
      <button type="button" onClick={() => void controller.saveDetailItem({ title, note })}>
        Save
      </button>
    </section>
  );
}
```

Add `onClick={() => controller.openDetailView(item)}` to each table row. Keep checkbox `stopPropagation()`.

- [ ] **Step 5: Add detail styles**

In `frontend/src/styles/globals.css`, add:

```css
.detail-view {
  max-width: 880px;
}

.detail-back {
  margin-bottom: 18px;
}

.detail-properties {
  display: grid;
  gap: 12px;
  margin-bottom: 24px;
}

.property-row {
  display: grid;
  grid-template-columns: 160px minmax(0, 1fr);
  gap: 12px;
  border-bottom: 1px solid var(--color-hairline-light);
  padding-bottom: 8px;
}

.field-label {
  display: grid;
  gap: 6px;
}

.field-label input,
.field-label select,
.field-label textarea {
  min-height: 38px;
  border: 1px solid var(--color-hairline-light);
  border-radius: var(--radius-xs);
  padding: 8px 10px;
}

.detail-note textarea {
  min-height: 280px;
  resize: vertical;
}
```

- [ ] **Step 6: Verify and commit**

Run:

```bash
cd frontend
npm run test -- tests/presentation/use-workbench-controller.spec.tsx tests/presentation/workbench-wireframe.spec.tsx
npm run typecheck
```

Expected: PASS.

Commit:

```bash
git add frontend/src/features/workbench/model/workbench-model.ts frontend/src/features/workbench/hooks/useWorkbenchController.ts frontend/src/features/workbench/ui/MainPanel.tsx frontend/src/styles/globals.css frontend/tests/presentation/use-workbench-controller.spec.tsx frontend/tests/presentation/workbench-wireframe.spec.tsx
git commit -m "[ADD] Add workspace item detail view"
```

---

### Task 6: Add Minimal Inline Editing

**Files:**
- Modify: `frontend/src/features/workbench/model/workbench-model.ts`
- Modify: `frontend/src/features/workbench/hooks/useWorkbenchController.ts`
- Modify: `frontend/src/features/workbench/ui/MainPanel.tsx`
- Modify: `frontend/src/styles/globals.css`
- Modify: `frontend/tests/presentation/use-workbench-controller.spec.tsx`
- Modify: `frontend/tests/presentation/workbench-wireframe.spec.tsx`

**Interfaces:**
- Produces: inline edits for `due`, `scheduled`, `priority`, `area`, `project_id`, `routine_id`.
- Produces: status transition control using existing transition endpoints.

- [ ] **Step 1: Write failing inline patch test**

In `frontend/tests/presentation/workbench-wireframe.spec.tsx`, add:

```ts
it("patches an inline due edit", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (String(url).includes("/items/task-1") && init?.method === "PATCH") {
      expect(init.body).toBe(JSON.stringify({ due: "2026-06-30" }));
      return Promise.resolve({
        ok: true,
        json: async () => ({ id: "task-1", type: "task", title: "One", status: "approved", due: "2026-06-30" }),
      });
    }

    return Promise.resolve({
      ok: true,
      json: async () => [
        { id: "task-1", type: "task", title: "One", status: "approved", due: "2026-06-20" },
      ],
    });
  });
  vi.stubGlobal("fetch", fetchMock);

  render(<WorkbenchPageClient />);
  await user.click(screen.getByRole("button", { name: "ToDo" }));
  await user.click(screen.getByRole("button", { name: "Workspace" }));
  await user.click(screen.getByRole("button", { name: "Tasks" }));

  const due = await screen.findByLabelText("Due for One");
  await user.clear(due);
  await user.type(due, "2026-06-30");
  await user.tab();

  expect(fetchMock).toHaveBeenCalledWith(
    "/todo-engine/items/task-1",
    expect.objectContaining({ method: "PATCH" }),
  );
});
```

- [ ] **Step 2: Add controller patch helper**

In `frontend/src/features/workbench/model/workbench-model.ts`, add:

```ts
patchWorkspaceItem: (itemId: string, patch: WorkspaceItemPatch) => Promise<void>;
transitionWorkspaceItem: (itemId: string, action: "approve" | "activate" | "pause" | "resume" | "complete") => Promise<void>;
```

In the hook, return:

```ts
patchWorkspaceItem: async (itemId, patch) => {
  const updated = await patchItem(itemId, patch);
  setWorkspaceItems((current) => ({
    ...current,
    items: current.items.map((item) => (item.id === updated.id ? updated : item)),
  }));
},
transitionWorkspaceItem: async (itemId, action) => {
  const updated = await postJson(`/todo-engine/items/${itemId}/${action}`, {});
  setWorkspaceItems((current) => ({
    ...current,
    items: current.items.map((item) => (item.id === updated.id ? updated : item)),
  }));
},
```

- [ ] **Step 3: Render native inline controls**

In `MainPanel.tsx`, keep text columns as text. For editable date/number/link columns, render native controls in the relevant column definitions:

```tsx
function InlineTextInput({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = React.useState(value);

  return (
    <input
      aria-label={label}
      value={draft}
      onClick={(event) => event.stopPropagation()}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => onCommit(draft)}
    />
  );
}
```

Use it for due:

```tsx
{
  label: "Due",
  value: (item, _items, controller) => (
    <InlineTextInput
      label={`Due for ${item.title}`}
      value={item.due ?? ""}
      onCommit={(due) => void controller.patchWorkspaceItem(item.id, { due })}
    />
  ),
}
```

Adjust `ItemColumn.value` to return `React.ReactNode` and receive `controller`.

- [ ] **Step 4: Add status transition select**

Use a small select that maps target statuses to existing endpoints:

```tsx
function StatusSelect({ item, controller }: { item: WorkspaceItemModel; controller: WorkbenchController }) {
  return (
    <select
      aria-label={`Status for ${item.title}`}
      value={item.status}
      onClick={(event) => event.stopPropagation()}
      onChange={(event) => {
        const action = event.target.value;
        if (action === "approved") void controller.transitionWorkspaceItem(item.id, "approve");
        if (action === "active") void controller.transitionWorkspaceItem(item.id, item.status === "paused" ? "resume" : "activate");
        if (action === "paused") void controller.transitionWorkspaceItem(item.id, "pause");
        if (action === "completed") void controller.transitionWorkspaceItem(item.id, "complete");
      }}
    >
      <option value={item.status}>{item.status}</option>
      <option value="approved">approved</option>
      <option value="active">active</option>
      <option value="paused">paused</option>
      <option value="completed">completed</option>
    </select>
  );
}
```

This keeps archive out of the status select because archive is handled by the trash confirmation.

- [ ] **Step 5: Verify and commit**

Run:

```bash
cd frontend
npm run test -- tests/presentation/use-workbench-controller.spec.tsx tests/presentation/workbench-wireframe.spec.tsx
npm run typecheck
```

Expected: PASS.

Commit:

```bash
git add frontend/src/features/workbench/model/workbench-model.ts frontend/src/features/workbench/hooks/useWorkbenchController.ts frontend/src/features/workbench/ui/MainPanel.tsx frontend/src/styles/globals.css frontend/tests/presentation/use-workbench-controller.spec.tsx frontend/tests/presentation/workbench-wireframe.spec.tsx
git commit -m "[ADD] Add workspace inline item editing"
```

---

## Final Verification

- [ ] Run frontend tests:

```bash
cd frontend
npm run test
npm run typecheck
npm run build
```

- [ ] Run backend gates:

```bash
cargo test
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings
```

- [ ] Smoke the app:

```bash
cd frontend
npm run dev:with-api
```

Expected:

- Workspace tabs include `Areas`, `Projects`, `Routines`, `Tasks`, `Events`, and `Goals`.
- Table `trash` is disabled until rows are selected.
- Archive confirmation appears before selected rows are archived.
- `+` creates an item through the correct API endpoint and opens detail view.
- Row click opens detail view.
- `Back` returns to table view.
- Note edits save through `PATCH /todo-engine/items/:id`.

## Self-Review

- Spec coverage: table view, row selection, archive confirmation, row creation, inline editing, default columns, detail view, explicit save, and no-hard-delete boundary are covered.
- Placeholder scan: no unfinished marker strings or deferred implementation steps are present.
- Type consistency: controller actions introduced in model are consumed by hook and UI tasks with the same names.
