# ToDo Detail Archive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a confirmed Archive action to the shared ToDo detail view that safely discards local drafts, reconciles active UI state, and returns to the originating Workspace or Planner surface.

**Architecture:** Reuse the existing `transitionWorkspaceItem(itemId, "archive")` mutation queue and ToDo archive endpoint. Teach the controller to remove successfully archived items from active collections, then let `DetailView` close only after that promise succeeds. Reuse the shared destructive confirmation dialog by making its confirm label and inline error configurable while preserving its purge defaults.

**Tech Stack:** React 18, TypeScript, Next.js 14, Vitest, Testing Library, Raven authenticated JSON API

---

## File map

- Modify `frontend/src/features/workbench/hooks/useWorkbenchController.ts`: reconcile a successful archive with active item, selection, and relation state.
- Modify `frontend/src/features/workbench/ui/DestructiveConfirmationDialog.tsx`: accept an Archive label and safe inline error without changing existing purge callers.
- Create `frontend/tests/presentation/destructive-confirmation-dialog.spec.tsx`: verify configurable confirmation copy, error output, focus, and the purge default.
- Modify `frontend/src/features/workbench/ui/MainPanel.tsx`: add the detail header action, confirmation flow, mutation exclusion, and successful return to the selected leaf.
- Modify `frontend/tests/presentation/use-workbench-controller.spec.tsx`: prove controller archive reconciliation and request coalescing.
- Modify `frontend/tests/presentation/workbench-wireframe.spec.tsx`: prove detail UX, accessibility, draft handling, failure/retry, and Workspace/Planner return behavior.

### Task 1: Reconcile archived items in the workbench controller

**Files:**
- Modify: `frontend/tests/presentation/use-workbench-controller.spec.tsx`
- Modify: `frontend/src/features/workbench/hooks/useWorkbenchController.ts:824-831,1762-1814`

- [ ] **Step 1: Write the failing controller test**

Add this test beside `transitions a workspace item and updates list state`:

```tsx
it("removes an archived detail item from active workbench state", async () => {
  const area = { id: "area-1", type: "area", title: "Work", status: "active" };
  const task = {
    id: "task-1",
    type: "task",
    title: "One",
    status: "active",
    area_id: "area-1",
  };
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url === "/api/v1/todo/items/task-1/archive") {
      expect(init).toEqual(expect.objectContaining({
        method: "POST",
        body: JSON.stringify({}),
      }));
      return Promise.resolve({
        ok: true,
        json: async () => ({ ...task, status: "archived" }),
      } as Response);
    }
    if (url === "/api/v1/todo/items") {
      return Promise.resolve({ ok: true, json: async () => [area, task] } as Response);
    }
    if (url === "/api/v1/todo/items?type=task") {
      return Promise.resolve({ ok: true, json: async () => [task] } as Response);
    }
    if (url === "/api/v1/todo/items?type=area") {
      return Promise.resolve({ ok: true, json: async () => [area] } as Response);
    }
    return Promise.resolve({ ok: true, json: async () => null } as Response);
  });
  vi.stubGlobal("fetch", fetchMock);
  const { result } = renderHook(() => useWorkbenchController());

  await act(async () => {
    result.current.selectTab("workspace");
    result.current.selectTab("tasks");
  });
  await waitFor(() => expect(result.current.workspaceItems.status).toBe("loaded"));
  act(() => {
    result.current.toggleItemSelection("task-1");
    result.current.openDetailView(task);
  });

  await act(async () => {
    await result.current.transitionWorkspaceItem("task-1", "archive");
  });

  expect(result.current.selection.leafTabId).toBe("tasks");
  expect(result.current.detailItem).toEqual(expect.objectContaining({ status: "archived" }));
  expect(result.current.workspaceItems.items).toEqual([]);
  expect(result.current.workspaceItems.allItems).toEqual([area]);
  expect(result.current.workspaceItems.relatedItems.areas).toEqual({ "area-1": "Work" });
  expect(result.current.selectedItemIds).toEqual([]);
});
```

- [ ] **Step 2: Run the focused test and verify the current replacement behavior fails**

Run:

```powershell
npm --prefix frontend test -- frontend/tests/presentation/use-workbench-controller.spec.tsx -t "removes an archived detail item"
```

Expected: FAIL because the archived item remains in `items`, `allItems`, or selection state.

- [ ] **Step 3: Add one archive reconciliation helper**

Place this beside `applySharedItem`:

```tsx
const removeArchivedItem = (itemId: string) => {
  setWorkspaceItems((current) => {
    const items = current.items.filter((item) => item.id !== itemId);
    const allItems = current.allItems.filter((item) => item.id !== itemId);
    return {
      ...current,
      items,
      allItems,
      relatedItems: buildRelatedItems(allItems),
    };
  });
  setSelectedItemIds((current) => current.filter((id) => id !== itemId));
};
```

In `transitionWorkspaceItem`, replace the unconditional `applySharedItem(updated)` with:

```tsx
if (action === "archive") {
  removeArchivedItem(updated.id);
} else {
  applySharedItem(updated);
}
```

Keep the existing detail-generation update, mutation queue, transition-state error handling,
and promise identity unchanged.

- [ ] **Step 4: Run controller transition tests**

Run:

```powershell
npm --prefix frontend test -- frontend/tests/presentation/use-workbench-controller.spec.tsx -t "workspace item|archived detail item|concurrent transitions"
```

Expected: PASS; complete/reopen still replace items, archive removes them, and duplicate requests still coalesce.

- [ ] **Step 5: Commit the controller behavior**

```powershell
git add frontend/src/features/workbench/hooks/useWorkbenchController.ts frontend/tests/presentation/use-workbench-controller.spec.tsx
git commit -m @'
[UPDATE] Reconcile archived workbench items

- 상세 Archive 성공 시 활성 목록과 선택 상태에서 항목 제거
- 관련 항목 인덱스를 남은 활성 데이터로 다시 계산
- 기존 항목별 전환 큐와 중복 요청 방지 유지
'@
```

### Task 2: Make the shared confirmation dialog Archive-capable

**Files:**
- Modify: `frontend/src/features/workbench/ui/DestructiveConfirmationDialog.tsx:10-133`
- Create: `frontend/tests/presentation/destructive-confirmation-dialog.spec.tsx`

- [ ] **Step 1: Add a focused failing test for configurable confirmation content**

```tsx
import "@testing-library/jest-dom/vitest";

import { render, screen, within } from "@testing-library/react";
import React from "react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { DestructiveConfirmationDialog } from
  "@/features/workbench/ui/DestructiveConfirmationDialog";

describe("DestructiveConfirmationDialog", () => {
it("uses caller confirmation copy and exposes a safe inline error", async () => {
  const user = userEvent.setup();
  const onConfirm = vi.fn(async () => {});
  render(
    <DestructiveConfirmationDialog
      title="Archive One?"
      description="Move this item to Archive?"
      confirmLabel="Archive"
      error="Could not archive item."
      fallbackFocusRef={{ current: document.body }}
      onCancel={() => {}}
      onConfirm={onConfirm}
    />,
  );

  const dialog = await screen.findByRole("dialog", { name: "Archive One?" });
  expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
  expect(within(dialog).getByRole("alert")).toHaveTextContent("Could not archive item.");
  await user.keyboard("{Shift>}{Tab}{/Shift}");
  expect(within(dialog).getByRole("button", { name: "Archive" })).toHaveFocus();
  await user.keyboard("{Tab}");
  expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
  await user.click(within(dialog).getByRole("button", { name: "Archive" }));
  expect(onConfirm).toHaveBeenCalledTimes(1);
});

it("keeps the permanent purge label as the default", async () => {
  render(
    <DestructiveConfirmationDialog
      title="Purge entry?"
      description="This cannot be undone."
      fallbackFocusRef={{ current: document.body }}
      onCancel={() => {}}
      onConfirm={async () => {}}
    />,
  );
  expect(await screen.findByRole("button", { name: "Purge permanently" }))
    .toBeInTheDocument();
});
});
```

- [ ] **Step 2: Run the test and verify the missing action fails**

Run:

```powershell
npm --prefix frontend test -- frontend/tests/presentation/destructive-confirmation-dialog.spec.tsx
```

Expected: FAIL at TypeScript transform because `confirmLabel` and `error` are not accepted.

- [ ] **Step 3: Generalize the existing dialog without changing purge defaults**

Extend `DestructiveConfirmationDialogProps`:

```tsx
type DestructiveConfirmationDialogProps = {
  title: string;
  description: string;
  confirmLabel?: string;
  error?: string | null;
  fallbackFocusRef: React.RefObject<HTMLElement>;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
};
```

Destructure defaults in `DestructiveDialogContent`:

```tsx
confirmLabel = "Purge permanently",
error = null,
```

Render the safe error before `.dialog-actions` and replace the hard-coded confirm text:

```tsx
{error ? <p className="items-message" role="alert">{error}</p> : null}
<div className="dialog-actions">
  <button
    ref={cancelRef}
    type="button"
    aria-disabled={pending}
    onClick={() => {
      if (!pending) onCancel();
    }}
  >
    Cancel
  </button>
  <button
    ref={confirmRef}
    type="button"
    aria-disabled={pending}
    onClick={() => void confirm()}
  >
    {confirmLabel}
  </button>
</div>
```

Do not change portal mounting, initial focus, modal isolation, Escape handling, Tab wrapping,
the in-flight guard, or the default purge label used by Ledger and Health.

- [ ] **Step 4: Run existing destructive-flow tests**

Run:

```powershell
npm --prefix frontend test -- frontend/tests/presentation/destructive-confirmation-dialog.spec.tsx frontend/tests/presentation/ledger-panel.spec.tsx frontend/tests/presentation/health-panel.spec.tsx
```

Expected: PASS with custom Archive copy and every existing `Purge permanently` assertion.

- [ ] **Step 5: Commit the reusable dialog change**

```powershell
git add frontend/src/features/workbench/ui/DestructiveConfirmationDialog.tsx frontend/tests/presentation/destructive-confirmation-dialog.spec.tsx
git diff --cached --check
git commit -m @'
[UPDATE] Generalize destructive confirmation copy

- 호출 화면이 확인 버튼 문구와 안전한 오류를 제공하도록 확장
- 기존 Ledger와 Health 영구 삭제 기본 동작 유지
'@
```

### Task 3: Add the detail Archive action and success flow

**Files:**
- Modify: `frontend/src/features/workbench/ui/MainPanel.tsx:1-86,379-795`
- Modify: `frontend/tests/presentation/workbench-wireframe.spec.tsx`

- [ ] **Step 1: Write the failing clean-detail integration test**

Add this test in `workbench-wireframe.spec.tsx` using `openWorkspaceTasks`:

```tsx
it("archives a detail item and returns to its Workspace list", async () => {
  const user = userEvent.setup();
  const task = { id: "task-1", type: "task", title: "One", status: "active" };
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url === "/api/v1/todo/items/task-1/archive") {
      expect(init).toEqual(expect.objectContaining({ method: "POST" }));
      return Promise.resolve({
        ok: true,
        json: async () => ({ ...task, status: "archived" }),
      } as Response);
    }
    return Promise.resolve({
      ok: true,
      json: async () => url === "/api/v1/todo/items"
        || url === "/api/v1/todo/items?type=task" ? [task] : [],
    } as Response);
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<WorkbenchPageClient />);
  await openWorkspaceTasks(user);
  await user.click(screen.getByRole("button", { name: "Open details for One" }));

  const header = screen.getByRole("button", { name: "< Back" }).closest(".detail-header");
  expect(within(header as HTMLElement).getAllByRole("button").map(
    (button) => button.getAttribute("aria-label"),
  )).toEqual(["< Back", "Undo", "Redo", "Save", "Archive"]);
  await user.click(screen.getByRole("button", { name: "Archive" }));
  const dialog = screen.getByRole("dialog", { name: "Archive One?" });
  expect(within(dialog).getByText("Move this item to Archive?")).toBeInTheDocument();
  expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
  await user.click(within(dialog).getByRole("button", { name: "Archive" }));

  await screen.findByRole("table", { name: "Tasks items" });
  expect(screen.queryByRole("button", { name: "Open details for One" })).toBeNull();
  expect(window.history.state.__ravenDetailItemId).toBeNull();
});
```

- [ ] **Step 2: Run the test and verify the missing action fails**

```powershell
npm --prefix frontend test -- frontend/tests/presentation/workbench-wireframe.spec.tsx -t "archives a detail item"
```

Expected: FAIL because the detail header has no Archive button.

- [ ] **Step 3: Add DetailView state and mutual-exclusion inputs**

Import the shared dialog:

```tsx
import { DestructiveConfirmationDialog } from "@/features/workbench/ui/DestructiveConfirmationDialog";
```

Inside `DetailView`, add:

```tsx
const [archiveDialogOpen, setArchiveDialogOpen] = React.useState(false);
const [archiveError, setArchiveError] = React.useState<string | null>(null);
const archiveButtonRef = React.useRef<HTMLButtonElement>(null);
const transitionState = item
  ? controller.workspaceItemTransitionState(item.id)
  : { pending: false, error: null };
```

Include the Archive dialog in existing modal/shortcut coordination:

```tsx
const pendingNavigation = pendingLinkedItem !== null || detailHistory.pendingBack;
const detailDialogOpen = pendingNavigation || archiveDialogOpen;
pendingNavigationRef.current = detailDialogOpen;
```

Pass `detailDialogOpen`, rather than only `pendingNavigation`, to
`detailHistory.setDialogOpen`. Keep the navigation confirmation rendering conditional on
`pendingNavigation` so the two dialogs remain distinct.

- [ ] **Step 4: Add the header button and confirmation handler**

Disable Save while an archive transition is pending:

```tsx
disabled={!hasDraftChanges || isSaving || transitionState.pending}
```

Append this button after Save and hide it for an already archived item:

```tsx
{item.status !== "archived" ? (
  <button
    ref={archiveButtonRef}
    type="button"
    aria-label="Archive"
    title="Archive"
    disabled={isSaving || transitionState.pending}
    onClick={() => {
      setArchiveError(null);
      setArchiveDialogOpen(true);
    }}
  >
    <Trash2 size={16} aria-hidden="true" />
  </button>
) : null}
```

Add the success-only close function before the return:

```tsx
async function confirmArchive() {
  setArchiveError(null);
  try {
    await controller.transitionWorkspaceItem(detailItem.id, "archive");
  } catch (cause) {
    setArchiveError(
      cause instanceof RavenApiError
        ? cause.message
        : "Could not archive item.",
    );
    return;
  }
  detailHistory.setDirty(false);
  detailHistory.setDialogOpen(false);
  controller.closeDetailView();
}
```

Render the dialog after the existing navigation confirmation:

```tsx
{archiveDialogOpen ? (
  <DestructiveConfirmationDialog
    title={`Archive ${detailItem.title}?`}
    description={hasDraftChanges
      ? "Move this item to Archive? Unsaved changes will be discarded."
      : "Move this item to Archive?"}
    confirmLabel="Archive"
    error={archiveError}
    fallbackFocusRef={archiveButtonRef}
    onCancel={() => {
      setArchiveError(null);
      setArchiveDialogOpen(false);
    }}
    onConfirm={confirmArchive}
  />
) : null}
```

- [ ] **Step 5: Prove archived details do not offer the action**

Add a direct `MainPanel` test using the existing `workspacePanelController` helper:

```tsx
it("does not offer Archive for an already archived detail", () => {
  const archived: WorkspaceItemsModel["items"][number] = {
    id: "task-1",
    type: "task",
    title: "Archived task",
    status: "archived",
  };
  const hook = renderHook(() => useWorkbenchController());
  const workspaceItems: WorkspaceItemsModel = {
    status: "loaded",
    items: [archived],
    allItems: [archived],
    tagOptions: [],
    relatedItems: { areas: {}, goals: {}, projects: {}, routines: {} },
  };
  render(<MainPanel controller={workspacePanelController(
    { ...hook.result.current, detailItem: archived },
    "tasks",
    "Tasks",
    workspaceItems,
  )} />);
  expect(screen.queryByRole("button", { name: "Archive" })).toBeNull();
});
```

- [ ] **Step 6: Run the detail success tests**

Run:

```powershell
npm --prefix frontend test -- frontend/tests/presentation/workbench-wireframe.spec.tsx -t "archives a detail item|already archived detail"
```

Expected: PASS.

- [ ] **Step 7: Commit the visible feature**

```powershell
git add frontend/src/features/workbench/ui/MainPanel.tsx frontend/tests/presentation/workbench-wireframe.spec.tsx
git commit -m @'
[ADD] Add Archive to ToDo detail

- Save 오른쪽에 공용 상세뷰 Archive 동작 추가
- 서버 성공 후 활성 목록에서 제거하고 기존 계획 화면으로 복귀
- 보관된 항목의 중복 Archive 진입 차단
'@
```

### Task 4: Cover dirty drafts, safe failure, retry, and Planner return

**Files:**
- Modify: `frontend/tests/presentation/workbench-wireframe.spec.tsx`
- Modify: `frontend/src/features/workbench/ui/MainPanel.tsx`

- [ ] **Step 1: Write the dirty-draft and modal keyboard test**

```tsx
it("warns about a dirty draft and isolates detail shortcuts in Archive confirmation", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.fn((url: string) => Promise.resolve({
    ok: true,
    json: async () => url.includes("/api/v1/todo/items")
      ? [{ id: "task-1", type: "task", title: "One", status: "active" }]
      : [],
  } as Response));
  vi.stubGlobal("fetch", fetchMock);
  render(<WorkbenchPageClient />);
  await openWorkspaceTasks(user);
  await user.click(screen.getByRole("button", { name: "Open details for One" }));
  await user.clear(screen.getByLabelText("Title"));
  await user.type(screen.getByLabelText("Title"), "Unsaved title");
  await user.click(screen.getByRole("button", { name: "Archive" }));

  const dialog = screen.getByRole("dialog", { name: "Archive One?" });
  expect(within(dialog).getByText(
    "Move this item to Archive? Unsaved changes will be discarded.",
  )).toBeInTheDocument();
  fireEvent.keyDown(document, { key: "z", ctrlKey: true });
  fireEvent.keyDown(document, { key: "s", ctrlKey: true });
  expect(screen.getByLabelText("Title")).toHaveValue("Unsaved title");
  expect(patchCalls(fetchMock)).toHaveLength(0);

  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog", { name: "Archive One?" })).toBeNull();
  await waitFor(() => expect(screen.getByRole("button", { name: "Archive" })).toHaveFocus());
});
```

- [ ] **Step 2: Run the dirty-draft test**

Run:

```powershell
npm --prefix frontend test -- frontend/tests/presentation/workbench-wireframe.spec.tsx -t "warns about a dirty draft"
```

Expected: PASS with the draft unchanged, no PATCH request, the dialog closed, and focus
returned to Archive.

- [ ] **Step 3: Prove an in-flight save blocks Archive**

Add a deferred PATCH test. After changing the title and clicking Save, assert Archive is
disabled and no archive POST occurs; resolve the PATCH and then verify Archive enables:

```tsx
it("blocks Archive while a detail save is in flight", async () => {
const user = userEvent.setup();
let resolveSave!: (response: Response) => void;
const pendingSave = new Promise<Response>((resolve) => { resolveSave = resolve; });
const fetchMock = vi.fn((url: string, init?: RequestInit) => {
  if (url === "/api/v1/todo/items/task-1" && init?.method === "PATCH") {
    return pendingSave;
  }
  return Promise.resolve({
    ok: true,
    json: async () => url.includes("/api/v1/todo/items")
      ? [{ id: "task-1", type: "task", title: "One", status: "active" }]
      : [],
  } as Response);
});
vi.stubGlobal("fetch", fetchMock);
render(<WorkbenchPageClient />);
await openWorkspaceTasks(user);
await user.click(screen.getByRole("button", { name: "Open details for One" }));
await user.clear(screen.getByLabelText("Title"));
await user.type(screen.getByLabelText("Title"), "Saved title");
await user.click(screen.getByRole("button", { name: "Save" }));
expect(screen.getByRole("button", { name: "Archive" })).toBeDisabled();
expect(fetchMock.mock.calls.filter(([url]) =>
  url === "/api/v1/todo/items/task-1/archive",
)).toHaveLength(0);
resolveSave({
  ok: true,
  json: async () => ({
    id: "task-1", type: "task", title: "Saved title", status: "active",
  }),
} as Response);
await waitFor(() => expect(screen.getByRole("button", { name: "Archive" })).toBeEnabled());
});
```

- [ ] **Step 4: Write the failure, retry, and duplicate-submit test**

Use a deferred first archive response and count POST calls:

```tsx
it("keeps Archive confirmation open on failure and permits one safe retry", async () => {
  const user = userEvent.setup();
  let archiveAttempt = 0;
  let releaseFailure!: () => void;
  const firstFailure = new Promise<Response>((resolve) => {
    releaseFailure = () => resolve({
      ok: false,
      status: 500,
      json: async () => ({
        code: "internal_error",
        message: "Could not archive item.",
        fields: {},
        request_id: "00000000-0000-4000-8000-000000000023",
      }),
    } as Response);
  });
  const fetchMock = vi.fn((url: string) => {
    if (url === "/api/v1/todo/items/task-1/archive") {
      archiveAttempt += 1;
      return archiveAttempt === 1
        ? firstFailure
        : Promise.resolve({
            ok: true,
            json: async () => ({
              id: "task-1", type: "task", title: "One", status: "archived",
            }),
          } as Response);
    }
    return Promise.resolve({
      ok: true,
      json: async () => url.includes("/api/v1/todo/items")
        ? [{ id: "task-1", type: "task", title: "One", status: "active" }]
        : [],
    } as Response);
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<WorkbenchPageClient />);
  await openWorkspaceTasks(user);
  await user.click(screen.getByRole("button", { name: "Open details for One" }));
  await user.clear(screen.getByLabelText("Title"));
  await user.type(screen.getByLabelText("Title"), "Unsaved title");
  expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  await user.click(screen.getByRole("button", { name: "Archive" }));
  const dialog = screen.getByRole("dialog", { name: "Archive One?" });
  const confirm = within(dialog).getByRole("button", { name: "Archive" });
  await user.click(confirm);
  await user.click(confirm);
  expect(fetchMock.mock.calls.filter(([url]) =>
    url === "/api/v1/todo/items/task-1/archive",
  )).toHaveLength(1);
  expect(within(dialog).getByRole("button", { name: "Cancel" }))
    .toHaveAttribute("aria-disabled", "true");
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  await user.keyboard("{Escape}");
  expect(screen.getByRole("dialog", { name: "Archive One?" })).toBeInTheDocument();
  expect(screen.getByLabelText("One details")).toBeInTheDocument();

  releaseFailure();
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(
    "Could not archive item.",
  );
  expect(screen.getByLabelText("One details")).toBeInTheDocument();
  await user.click(confirm);
  await screen.findByRole("table", { name: "Tasks items" });
  expect(fetchMock.mock.calls.filter(([url]) =>
    url === "/api/v1/todo/items/task-1/archive",
  )).toHaveLength(2);
});
```

- [ ] **Step 5: Add the Planner-origin success assertion**

Create a scheduled task, open it from Daily, and assert the Daily planner—not a Workspace
table or linked parent detail—is visible afterward:

```tsx
it("returns to the originating Planner view after Archive", async () => {
const user = userEvent.setup();
const task = {
  id: "task-detail",
  type: "task",
  title: "Detail task",
  status: "active",
  scheduled: testToday(),
};
const fetchMock = vi.fn((url: string) => {
  if (url === "/api/v1/todo/items/task-detail/archive") {
    return Promise.resolve({
      ok: true,
      json: async () => ({ ...task, status: "archived" }),
    } as Response);
  }
  return Promise.resolve({
    ok: true,
    json: async () => url.includes("/api/v1/todo/items") ? [task] : [],
  } as Response);
});
vi.stubGlobal("fetch", fetchMock);
render(<WorkbenchPageClient />);
await user.click(screen.getByRole("button", { name: "ToDo" }));
await user.click(screen.getByRole("button", { name: "Planner" }));
await user.click(screen.getByRole("button", { name: "Daily" }));
await user.click(await screen.findByRole("button", { name: "Detail task" }));
await user.click(screen.getByRole("button", { name: "Archive" }));
await user.click(within(
  screen.getByRole("dialog", { name: "Archive Detail task?" }),
).getByRole("button", { name: "Archive" }));
expect(await screen.findByLabelText("Daily planner")).toBeInTheDocument();
expect(screen.queryByRole("heading", { name: "Detail task" })).toBeNull();
});
```

- [ ] **Step 6: Add the linked-detail origin assertion**

Reuse `linkedAreaItemsResponse` to open Area → linked Project, archive the Project, and
verify the selected Areas leaf—not the parent detail—is restored:

```tsx
it("returns to the originating Workspace leaf after archiving a linked detail", async () => {
const user = userEvent.setup();
const fetchMock = vi.fn((url: string) => {
  if (url === "/api/v1/todo/items/project-1/archive") {
    return Promise.resolve({
      ok: true,
      json: async () => ({
        id: "project-1",
        type: "project",
        title: "Checkup",
        status: "archived",
        area_id: "area-1",
      }),
    } as Response);
  }
  return Promise.resolve({
    ok: true,
    json: async () => linkedAreaItemsResponse(url),
  } as Response);
});
vi.stubGlobal("fetch", fetchMock);
render(<WorkbenchPageClient />);
await user.click(screen.getByRole("button", { name: "ToDo" }));
await user.click(screen.getByRole("button", { name: "Workspace" }));
await user.click(screen.getByRole("button", { name: "Areas" }));
await user.click(await screen.findByRole("button", { name: "Open details for Health" }));
await user.click(screen.getByRole("button", { name: "Open Checkup details" }));
await user.click(screen.getByRole("button", { name: "Archive" }));
await user.click(within(
  screen.getByRole("dialog", { name: "Archive Checkup?" }),
).getByRole("button", { name: "Archive" }));
expect(await screen.findByRole("table", { name: "Areas items" })).toBeInTheDocument();
expect(screen.queryByLabelText("Health details")).toBeNull();
expect(screen.queryByLabelText("Checkup details")).toBeNull();
});
```

- [ ] **Step 7: Run all Archive-focused presentation tests**

Run:

```powershell
npm --prefix frontend test -- frontend/tests/presentation/workbench-wireframe.spec.tsx -t "Archive|archived detail"
```

Expected: PASS with no unhandled rejected promises.

- [ ] **Step 8: Commit edge-case coverage and any minimal correction**

```powershell
git add frontend/tests/presentation/workbench-wireframe.spec.tsx frontend/src/features/workbench/ui/MainPanel.tsx
git commit -m @'
[FIX] Harden detail Archive interaction

- 저장하지 않은 초안 경고와 단축키 격리 검증
- 실패 시 안전한 오류를 유지하고 단일 재시도 허용
- Planner에서 연 상세가 성공 후 동일 Planner 화면으로 복귀함을 보장
'@
```

### Task 5: Run the frontend quality gate

**Files:**
- Verify only; no expected source changes

- [ ] **Step 1: Run the complete frontend test suite**

```powershell
npm --prefix frontend test
```

Expected: all Vitest suites PASS.

- [ ] **Step 2: Run TypeScript validation**

```powershell
npm --prefix frontend run typecheck
```

Expected: exit code 0 with no TypeScript errors.

- [ ] **Step 3: Build the production UI artifact**

```powershell
npm --prefix frontend run build
```

Expected: Next.js static build completes and writes `frontend/out`.

- [ ] **Step 4: Inspect final scope and history**

```powershell
git status --short
git diff HEAD~4 --stat
git log --oneline -n 6
```

Expected: no unintended files, four feature commits after the plan commit, and no generated
`frontend/out` files staged.
