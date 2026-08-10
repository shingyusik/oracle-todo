# Detail Browser History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make browser Back/Forward and the Workspace detail Back button traverse detail visits while protecting unsaved drafts.

**Architecture:** Keep browser-history coordination in `MainPanel.tsx`, which stays mounted for both list and detail screens. Store only a namespaced item ID in `history.state`, reuse the existing detail discard dialog, and resolve history destinations from already-loaded Workspace items.

**Tech Stack:** React 18, TypeScript, native History API, Vitest, Testing Library

---

## File Structure

- Modify `frontend/src/features/workbench/ui/MainPanel.tsx`: synchronize detail state with browser history and guard dirty Back navigation.
- Modify `frontend/tests/presentation/workbench-wireframe.spec.tsx`: verify Back/Forward order, missing-item fallback, state preservation, and dirty-draft confirmation.
- Modify `frontend/README.md`: document the shipped Workspace detail navigation behavior.

### Task 1: Specify browser detail navigation with failing tests

**Files:**
- Test: `frontend/tests/presentation/workbench-wireframe.spec.tsx:6290-6630`

- [ ] **Step 1: Add the clean nested-history test**

Add this test near the existing detail-view tests:

```tsx
it("traverses nested detail visits with browser history", async () => {
  const user = userEvent.setup();
  window.history.replaceState({ preserved: "keep" }, "", window.location.href);
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) =>
      Promise.resolve({
        ok: true,
        json: async () => linkedAreaItemsResponse(url),
      }),
    ),
  );

  render(<WorkbenchPageClient />);
  await user.click(screen.getByRole("button", { name: "ToDo" }));
  await user.click(screen.getByRole("button", { name: "Workspace" }));
  await user.click(screen.getByRole("button", { name: "Areas" }));
  await user.click(await screen.findByRole("button", { name: "Open details for Health" }));
  await user.click(screen.getByRole("button", { name: "Open Checkup details" }));

  act(() => window.history.back());
  expect(await screen.findByLabelText("Health details")).toBeInTheDocument();
  act(() => window.history.back());
  expect(await screen.findByRole("table", { name: "Areas items" })).toBeInTheDocument();
  act(() => window.history.forward());
  expect(await screen.findByLabelText("Health details")).toBeInTheDocument();
  act(() => window.history.forward());
  expect(await screen.findByLabelText("Checkup details")).toBeInTheDocument();
  expect(window.history.state).toMatchObject({ preserved: "keep" });

  await user.click(screen.getByRole("button", { name: "Tasks" }));
  expect(await screen.findByRole("table", { name: "Tasks items" })).toBeInTheDocument();
  await waitFor(() =>
    expect(window.history.state).toMatchObject({
      preserved: "keep",
      __ravenDetailItemId: null,
    }),
  );
});
```

- [ ] **Step 2: Add the dirty browser-Back test**

```tsx
it("confirms browser Back before discarding a dirty detail draft", async () => {
  const user = userEvent.setup();
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) =>
      Promise.resolve({
        ok: true,
        json: async () => linkedAreaItemsResponse(url),
      }),
    ),
  );

  render(<WorkbenchPageClient />);
  await user.click(screen.getByRole("button", { name: "ToDo" }));
  await user.click(screen.getByRole("button", { name: "Workspace" }));
  await user.click(screen.getByRole("button", { name: "Areas" }));
  await user.click(await screen.findByRole("button", { name: "Open details for Health" }));
  await user.clear(screen.getByLabelText("Title"));
  await user.type(screen.getByLabelText("Title"), "Health draft");

  act(() => window.history.back());
  expect(await screen.findByRole("dialog", { name: "Discard unsaved changes?" }))
    .toBeInTheDocument();
  expect(screen.getByLabelText("Title")).toHaveValue("Health draft");
  act(() => window.history.back());
  expect(screen.getByRole("dialog", { name: "Discard unsaved changes?" }))
    .toBeInTheDocument();
  expect(screen.getByLabelText("Title")).toHaveValue("Health draft");
  await user.keyboard("{Escape}");
  expect(screen.getByLabelText("Health details")).toBeInTheDocument();
  expect(screen.getByLabelText("Title")).toHaveValue("Health draft");

  act(() => window.history.back());
  await user.click(await screen.findByRole("button", { name: "Discard changes" }));
  expect(await screen.findByRole("table", { name: "Areas items" })).toBeInTheDocument();
});
```

- [ ] **Step 3: Extend the existing header Back test**

In `opens a detail view and saves note edits`, edit the title after the save assertion, click the header Back button, and require the same confirmation before returning to the list:

```tsx
await waitFor(() => expect(saveButton).toBeDisabled());
await user.clear(screen.getByLabelText("Title"));
await user.type(screen.getByLabelText("Title"), "Unsaved title");
await user.click(screen.getByRole("button", { name: "< Back" }));
expect(await screen.findByRole("dialog", { name: "Discard unsaved changes?" }))
  .toBeInTheDocument();
await user.click(screen.getByRole("button", { name: "Cancel" }));
expect(screen.getByLabelText("Title")).toHaveValue("Unsaved title");
await user.click(screen.getByRole("button", { name: "< Back" }));
await user.click(await screen.findByRole("button", { name: "Discard changes" }));
expect(await screen.findByRole("table", { name: "Tasks items" })).toBeInTheDocument();
```

- [ ] **Step 4: Extend the existing dirty linked-detail test**

At the end of `confirms before discarding a dirty detail draft to open a linked
item`, verify that the confirmed linked visit created its history entry:

```tsx
act(() => window.history.back());
expect(await screen.findByLabelText("Health details")).toBeInTheDocument();
```

- [ ] **Step 5: Run the focused tests and confirm RED**

Run:

```powershell
npm --prefix frontend test -- tests/presentation/workbench-wireframe.spec.tsx -t "browser history|browser Back|opens a detail view and saves note edits"
```

Expected: the new tests fail because browser history does not restore details and the header Back button does not confirm dirty drafts.

### Task 2: Synchronize detail state with browser history

**Files:**
- Modify: `frontend/src/features/workbench/ui/MainPanel.tsx:90-395`
- Test: `frontend/tests/presentation/workbench-wireframe.spec.tsx:6290-6630`

- [ ] **Step 1: Add the history state helpers and controller type**

Place these definitions after `MainPanelProps`:

```tsx
const detailHistoryStateKey = "__ravenDetailItemId";

type DetailHistoryController = {
  pendingBack: boolean;
  setDirty: (dirty: boolean) => void;
  requestBack: () => void;
  cancelBack: () => void;
  discardBack: () => void;
};

function detailIdFromHistoryState(state: unknown): string | null {
  if (!state || typeof state !== "object") return null;
  const value = (state as Record<string, unknown>)[detailHistoryStateKey];
  return typeof value === "string" ? value : null;
}

function withDetailHistoryState(state: unknown, itemId: string | null) {
  const existing = state && typeof state === "object" && !Array.isArray(state)
    ? state as Record<string, unknown>
    : {};
  return { ...existing, [detailHistoryStateKey]: itemId };
}
```

- [ ] **Step 2: Add the always-mounted history coordinator**

Place this hook before `MainPanel`:

```tsx
function useDetailHistory(controller: WorkbenchController): DetailHistoryController {
  const controllerRef = useRef(controller);
  controllerRef.current = controller;
  const currentDetailIdRef = useRef(controller.detailItem?.id ?? null);
  const dirtyRef = useRef(false);
  const applyingHistoryRef = useRef(false);
  const bypassDirtyRef = useRef(false);
  const pendingBackRef = useRef(false);
  const [pendingBack, setPendingBack] = React.useState(false);

  useEffect(() => {
    window.history.replaceState(
      withDetailHistoryState(window.history.state, currentDetailIdRef.current),
      "",
    );

    function applyHistoryState(state: unknown) {
      const currentId = currentDetailIdRef.current;
      const requestedId = detailIdFromHistoryState(state);
      const item = requestedId
        ? controllerRef.current.workspaceItems.allItems.find(({ id }) => id === requestedId)
        : null;
      const nextId = item?.id ?? null;
      if (nextId === currentId) return;

      applyingHistoryRef.current = true;
      if (item) {
        controllerRef.current.openDetailView(item);
      } else {
        controllerRef.current.closeDetailView();
      }
    }

    function handlePopState(event: PopStateEvent) {
      const currentId = currentDetailIdRef.current;
      if (pendingBackRef.current) {
        window.history.pushState(
          withDetailHistoryState(window.history.state, currentId),
          "",
        );
        return;
      }

      if (currentId && dirtyRef.current && !bypassDirtyRef.current) {
        window.history.pushState(
          withDetailHistoryState(window.history.state, currentId),
          "",
        );
        pendingBackRef.current = true;
        setPendingBack(true);
        return;
      }

      bypassDirtyRef.current = false;
      applyHistoryState(event.state);
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    const nextId = controller.detailItem?.id ?? null;
    const previousId = currentDetailIdRef.current;
    if (nextId === previousId) return;
    currentDetailIdRef.current = nextId;

    if (applyingHistoryRef.current) {
      applyingHistoryRef.current = false;
      return;
    }

    if (nextId) {
      window.history.pushState(
        withDetailHistoryState(window.history.state, nextId),
        "",
      );
    } else if (previousId) {
      window.history.replaceState(
        withDetailHistoryState(window.history.state, null),
        "",
      );
    }
  }, [controller.detailItem?.id]);

  const setDirty = React.useCallback((dirty: boolean) => {
    dirtyRef.current = dirty;
  }, []);

  return {
    pendingBack,
    setDirty,
    requestBack: () => {
      if (!pendingBackRef.current) window.history.back();
    },
    cancelBack: () => {
      pendingBackRef.current = false;
      setPendingBack(false);
    },
    discardBack: () => {
      if (!pendingBackRef.current) return;
      pendingBackRef.current = false;
      setPendingBack(false);
      dirtyRef.current = false;
      bypassDirtyRef.current = true;
      window.history.back();
    },
  };
}
```

- [ ] **Step 3: Keep the coordinator mounted and report draft dirtiness**

At the start of `MainPanel`, call the hook and pass it to the detail:

```tsx
export function MainPanel({ controller }: MainPanelProps) {
  const detailHistory = useDetailHistory(controller);
  if (controller.detailItem) {
    return (
      <main className="main-panel">
        <DetailView controller={controller} detailHistory={detailHistory} />
      </main>
    );
  }
```

Update the detail signature. Move the `hasDraftChanges` calculation above the
existing `if (!item) return null` guard, then report it from an unconditional
effect:

```tsx
function DetailView({
  controller,
  detailHistory,
}: MainPanelProps & { detailHistory: DetailHistoryController }) {
  // existing state and effects remain
  const hasDraftChanges = item ? hasDetailChanges(item, draft) : false;
  React.useEffect(() => {
    detailHistory.setDirty(hasDraftChanges);
    return () => detailHistory.setDirty(false);
  }, [detailHistory.setDirty, hasDraftChanges]);

  if (!item) return null;
```

Remove the former `const hasDraftChanges = hasDetailChanges(detailItem, draft);`
below the null guard.

- [ ] **Step 4: Reuse one confirmation path for linked navigation and Back**

Derive one pending flag, remove the existing `pendingLinkedItem`-only focus
effect, focus the combined flag, and replace the linked-only handlers:

```tsx
const pendingNavigation = pendingLinkedItem !== null || detailHistory.pendingBack;

React.useEffect(() => {
  if (pendingNavigation) cancelLinkedItemNavigationRef.current?.focus();
}, [pendingNavigation]);

function cancelPendingNavigation() {
  if (pendingLinkedItem) {
    setPendingLinkedItem(null);
  } else {
    detailHistory.cancelBack();
  }
}

function discardPendingNavigation() {
  if (pendingLinkedItem) {
    controller.openDetailView(pendingLinkedItem);
    setPendingLinkedItem(null);
  } else {
    detailHistory.discardBack();
  }
}
```

Use `cancelPendingNavigation` from Escape and Cancel, use `discardPendingNavigation` from `Discard changes`, render the dialog when `pendingNavigation`, and change its explanatory copy to:

```tsx
<p>Your changes will be lost if you leave this detail.</p>
```

Change the header Back button to:

```tsx
onClick={detailHistory.requestBack}
```

- [ ] **Step 5: Run the focused tests and confirm GREEN**

Run:

```powershell
npm --prefix frontend test -- tests/presentation/workbench-wireframe.spec.tsx -t "browser history|browser Back|opens a detail view and saves note edits|confirms before discarding a dirty detail draft"
```

Expected: all selected detail navigation tests pass.

### Task 3: Cover missing history items and document the behavior

**Files:**
- Modify: `frontend/tests/presentation/workbench-wireframe.spec.tsx`
- Modify: `frontend/README.md:10-25`

- [ ] **Step 1: Add the missing-item fallback assertion**

Add this test next to the nested-history test:

```tsx
it("falls back to the list for an unavailable detail history item", async () => {
  const user = userEvent.setup();
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) =>
      Promise.resolve({ ok: true, json: async () => linkedAreaItemsResponse(url) }),
    ),
  );

  render(<WorkbenchPageClient />);
  await user.click(screen.getByRole("button", { name: "ToDo" }));
  await user.click(screen.getByRole("button", { name: "Workspace" }));
  await user.click(screen.getByRole("button", { name: "Areas" }));
  await user.click(await screen.findByRole("button", { name: "Open details for Health" }));
  window.history.pushState(
    { ...window.history.state, __ravenDetailItemId: "missing-item" },
    "",
  );
  act(() => window.history.back());
  expect(await screen.findByLabelText("Health details")).toBeInTheDocument();
  act(() => window.history.forward());
  expect(await screen.findByRole("table", { name: "Areas items" })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the missing-item test**

Run:

```powershell
npm --prefix frontend test -- tests/presentation/workbench-wireframe.spec.tsx -t "unavailable detail history item"
```

Expected: PASS and the list remains usable.

- [ ] **Step 3: Update the frontend current-state documentation**

Add this paragraph after the Planner Miss paragraph in `frontend/README.md`:

```markdown
Workspace detail visits participate in browser Back and Forward navigation, including linked
details. Browser Back and the detail header Back button require confirmation before discarding
unsaved edits.
```

### Task 4: Verify and commit the implementation

**Files:**
- Modify: `frontend/src/features/workbench/ui/MainPanel.tsx`
- Modify: `frontend/tests/presentation/workbench-wireframe.spec.tsx`
- Modify: `frontend/README.md`

- [ ] **Step 1: Run frontend type checking**

Run:

```powershell
npm --prefix frontend run typecheck
```

Expected: exit code 0 with no TypeScript errors.

- [ ] **Step 2: Run the complete frontend test suite**

Run:

```powershell
npm --prefix frontend test
```

Expected: all frontend tests pass.

- [ ] **Step 3: Build the static frontend**

Run:

```powershell
npm --prefix frontend run build
```

Expected: Next.js static export completes successfully.

- [ ] **Step 4: Inspect and commit one logical change**

Run:

```powershell
git status --short
git diff --check
git diff -- frontend/src/features/workbench/ui/MainPanel.tsx frontend/tests/presentation/workbench-wireframe.spec.tsx frontend/README.md
git add -- frontend/src/features/workbench/ui/MainPanel.tsx frontend/tests/presentation/workbench-wireframe.spec.tsx frontend/README.md
git diff --cached
git commit -m @'
[UPDATE] Navigate detail views with browser history

- 디테일 방문 순서를 브라우저 뒤로가기와 앞으로가기에 연결
- 저장하지 않은 수정은 Back 버튼과 브라우저 이동 모두 확인 후 폐기
- 중첩 디테일과 누락 항목 폴백을 프런트엔드 테스트로 보호
'@
```

Expected: one `[UPDATE]` commit containing only the UI, presentation tests, and matching frontend documentation.
