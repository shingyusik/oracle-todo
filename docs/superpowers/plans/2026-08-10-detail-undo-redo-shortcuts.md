# ToDo Detail Undo, Redo, and Save Shortcuts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add page-local Undo, Redo, and Save controls and shortcuts to the shared ToDo detail view without ever treating Undo or Redo as a server-wide operation.

**Architecture:** Keep a snapshot history beside the existing `DetailDraft` in `MainPanel.tsx`. All detail field changes pass through one reducer, while persistence continues through the existing controller only when Save is explicitly invoked. The history resets for a different detail item, survives a successful save for the same item, and remains independent from browser Back/Forward history.

**Tech Stack:** React 18, TypeScript, native keyboard events, lucide-react, Vitest, Testing Library, Next.js 14

---

## File structure

- Modify `frontend/src/features/workbench/ui/MainPanel.tsx`: own the local draft history, header controls, keyboard commands, save guard, and safe save error.
- Modify `frontend/tests/presentation/workbench-wireframe.spec.tsx`: verify real detail behavior through Workspace and Planner entry paths.
- Modify `frontend/README.md`: document the page-local boundary and supported shortcuts.

Do not create a new hook, state library, API route, controller method, or domain command. The history has one consumer and belongs next to the existing detail draft.

## Safety invariants

1. Undo and Redo dispatch only local reducer actions.
2. Undo and Redo never call `fetch`, a controller mutation, or browser history.
3. Save is the only command in this feature that can mutate the current server item.
4. Saving after Undo affects only the currently open item through existing service-backed APIs.
5. SHI-20 remains the separate server-level ToDo undo issue.

### Task 1: Add grouped page-local draft history

**Files:**
- Modify: `frontend/src/features/workbench/ui/MainPanel.tsx:373-615`
- Modify: `frontend/src/features/workbench/ui/MainPanel.tsx:2441-2510`
- Modify: `frontend/src/features/workbench/ui/MainPanel.tsx:2700-2945`
- Test: `frontend/tests/presentation/workbench-wireframe.spec.tsx:6315-6381`

- [ ] **Step 1: Write failing history and button tests**

Add a presentation test named `groups detail edits into page-local undo and redo steps`. Use the existing one-task response pattern and navigate through ToDo → Workspace → Tasks before opening `One`.

```tsx
it("groups detail edits into page-local undo and redo steps", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.fn(() =>
    Promise.resolve({
      ok: true,
      json: async () => [
        {
          id: "task-1",
          type: "task",
          title: "One",
          status: "active",
          note: "Old note",
        },
      ],
    }),
  );
  vi.stubGlobal("fetch", fetchMock);

  render(<WorkbenchPageClient />);
  await user.click(screen.getByRole("button", { name: "ToDo" }));
  await user.click(screen.getByRole("button", { name: "Workspace" }));
  await user.click(screen.getByRole("button", { name: "Tasks" }));
  await user.click(await screen.findByRole("button", { name: "Open details for One" }));

  const undo = screen.getByRole("button", { name: "Undo" });
  const redo = screen.getByRole("button", { name: "Redo" });
  const title = screen.getByLabelText("Title");
  expect(undo).toBeDisabled();
  expect(redo).toBeDisabled();

  await user.clear(title);
  await user.type(title, "Renamed");
  expect(undo).toBeEnabled();

  await user.click(screen.getByRole("button", { name: "Edit Markdown note line 1" }));
  const note = screen.getByRole("textbox", { name: "Markdown note line 1" });
  await user.clear(note);
  await user.type(note, "New note");

  await user.click(undo);
  expect(screen.getByRole("textbox", { name: "Markdown note line 1" })).toHaveValue("Old note");
  expect(title).toHaveValue("Renamed");

  await user.click(undo);
  expect(title).toHaveValue("One");
  expect(undo).toBeDisabled();
  expect(redo).toBeEnabled();

  await user.click(redo);
  expect(title).toHaveValue("Renamed");
  await user.click(redo);
  expect(screen.getByRole("textbox", { name: "Markdown note line 1" })).toHaveValue("New note");
  expect(redo).toBeDisabled();
  expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "PATCH"))
    .toBe(false);
});
```

Add `clears detail redo history after a new local edit`:

```tsx
await user.clear(title);
await user.type(title, "First edit");
await user.tab();
await user.click(screen.getByRole("button", { name: "Undo" }));
expect(screen.getByRole("button", { name: "Redo" })).toBeEnabled();
await user.clear(title);
await user.type(title, "Second edit");
expect(screen.getByRole("button", { name: "Redo" })).toBeDisabled();
```

The test setup must use the same navigation and response shape as the first test; assert the title ends as `Second edit`.

- [ ] **Step 2: Run the focused tests to verify RED**

Run:

```powershell
npm --prefix frontend test -- tests/presentation/workbench-wireframe.spec.tsx -t "groups detail edits into page-local undo and redo steps|clears detail redo history after a new local edit"
```

Expected: both tests fail because Undo and Redo buttons do not exist.

- [ ] **Step 3: Add the snapshot reducer beside `DetailDraft`**

Add these state and action shapes near `DetailDraft`:

```tsx
type DetailDraftHistory = {
  itemId: string | null;
  past: DetailDraft[];
  present: DetailDraft;
  future: DetailDraft[];
  activeGroup: keyof DetailDraft | null;
};

type DetailDraftHistoryAction =
  | { type: "sync-item"; itemId: string | null; draft: DetailDraft }
  | { type: "update"; patch: Partial<DetailDraft>; group: keyof DetailDraft | null }
  | { type: "close-group" }
  | { type: "undo" }
  | { type: "redo" };

function createDetailDraftHistory(
  itemId: string | null,
  draft: DetailDraft,
): DetailDraftHistory {
  return { itemId, past: [], present: draft, future: [], activeGroup: null };
}

function sameDetailDraft(left: DetailDraft, right: DetailDraft): boolean {
  return (Object.keys(left) as Array<keyof DetailDraft>).every(
    (field) => left[field] === right[field],
  );
}
```

Implement `detailDraftHistoryReducer` with these exact rules:

```tsx
function detailDraftHistoryReducer(
  state: DetailDraftHistory,
  action: DetailDraftHistoryAction,
): DetailDraftHistory {
  if (action.type === "sync-item") {
    return action.itemId !== state.itemId
      ? createDetailDraftHistory(action.itemId, action.draft)
      : { ...state, present: action.draft, activeGroup: null };
  }

  if (action.type === "close-group") {
    return state.activeGroup === null ? state : { ...state, activeGroup: null };
  }

  if (action.type === "update") {
    const present = { ...state.present, ...action.patch };
    if (sameDetailDraft(present, state.present)) return state;
    const coalesced = action.group !== null && action.group === state.activeGroup;
    return {
      ...state,
      past: coalesced ? state.past : [...state.past, state.present],
      present,
      future: [],
      activeGroup: action.group,
    };
  }

  if (action.type === "undo") {
    const previous = state.past.at(-1);
    return previous
      ? {
          ...state,
          past: state.past.slice(0, -1),
          present: previous,
          future: [state.present, ...state.future],
          activeGroup: null,
        }
      : { ...state, activeGroup: null };
  }

  const next = state.future[0];
  return next
    ? {
        ...state,
        past: [...state.past, state.present],
        present: next,
        future: state.future.slice(1),
        activeGroup: null,
      }
    : { ...state, activeGroup: null };
}
```

Do not cap the arrays. They live only for one open detail session and `DetailDraft` contains small strings.

- [ ] **Step 4: Route every draft mutation through the reducer**

Replace `useState` with `useReducer` in `DetailView`:

```tsx
const initialDraft = detailDraftForItem(item);
const [draftHistory, dispatchDraft] = React.useReducer(
  detailDraftHistoryReducer,
  createDetailDraftHistory(item?.id ?? null, initialDraft),
);
const draft = draftHistory.present;

React.useEffect(() => {
  dispatchDraft({
    type: "sync-item",
    itemId: item?.id ?? null,
    draft: detailDraftForItem(item),
  });
}, [item]);
```

Use a central classification for continuous text controls:

```tsx
const continuousDetailFields = new Set<keyof DetailDraft>([
  "title",
  "note",
  "outcome",
  "definition_of_done",
  "location",
  "participants",
  "commitment_type",
  "standard",
]);

function setFields(patch: Partial<DetailDraft>, group: keyof DetailDraft | null = null) {
  dispatchDraft({ type: "update", patch, group });
}

function setField(field: keyof DetailDraft, value: string) {
  setFields(
    { [field]: value } as Partial<DetailDraft>,
    continuousDetailFields.has(field) ? field : null,
  );
}
```

On the outer `.detail-view` section, add `onBlurCapture={() => dispatchDraft({ type: "close-group" })}`. Replace the Goal period's two `setField` calls with one atomic `setFields({ horizon, scheduled })`; pass `setFields` into `DetailTypeFields` alongside `setField`.

- [ ] **Step 5: Add header Undo and Redo buttons**

Import `Undo2` and `Redo2` from `lucide-react`. Place the buttons before Save:

```tsx
<button
  type="button"
  aria-label="Undo"
  title="Undo (Ctrl/Cmd+Z)"
  disabled={draftHistory.past.length === 0}
  onClick={() => dispatchDraft({ type: "undo" })}
>
  <Undo2 size={16} aria-hidden="true" />
</button>
<button
  type="button"
  aria-label="Redo"
  title="Redo (Ctrl/Cmd+Shift+Z or Ctrl+Y)"
  disabled={draftHistory.future.length === 0}
  onClick={() => dispatchDraft({ type: "redo" })}
>
  <Redo2 size={16} aria-hidden="true" />
</button>
```

Keep the existing `.detail-actions` styling. Do not add CSS unless the existing header visibly overflows in the production build.

- [ ] **Step 6: Run focused GREEN tests**

Run the command from Step 2. Expected: 2 passed.

- [ ] **Step 7: Commit the local history unit**

```powershell
git add frontend/src/features/workbench/ui/MainPanel.tsx frontend/tests/presentation/workbench-wireframe.spec.tsx
git commit -m @'
[UPDATE] Add page-local detail draft history

- 현재 열린 ToDo 상세의 드래프트만 Undo·Redo하는 스냅샷 이력을 추가
- 한 번의 입력 작업과 복합 필드 변경을 각각 하나의 이력 단계로 처리
- 서버 요청 없이 동작하는 상단 Undo·Redo 버튼과 경계 상태를 검증
'@
```

### Task 2: Add keyboard commands and guarded saving

**Files:**
- Modify: `frontend/src/features/workbench/ui/MainPanel.tsx:373-615`
- Test: `frontend/tests/presentation/workbench-wireframe.spec.tsx:6315-6420`

- [ ] **Step 1: Write failing shortcut tests**

Add `supports detail save undo and redo keyboard conventions` with a task detail fixture. Make a title edit, then dispatch and assert:

```tsx
fireEvent.keyDown(document, { key: "z", ctrlKey: true });
expect(title).toHaveValue("One");
fireEvent.keyDown(document, { key: "z", ctrlKey: true, shiftKey: true });
expect(title).toHaveValue("Renamed");
fireEvent.keyDown(document, { key: "z", metaKey: true });
expect(title).toHaveValue("One");
fireEvent.keyDown(document, { key: "y", ctrlKey: true });
expect(title).toHaveValue("Renamed");
fireEvent.keyDown(document, { key: "s", metaKey: true });
await waitFor(() =>
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/v1/todo/items/task-1",
    expect.objectContaining({ method: "PATCH" }),
  ),
);
```

The PATCH response must return the submitted title so the existing controller refreshes the current detail.

Add `prevents duplicate detail saves while a request is pending` using a deferred PATCH response:

```tsx
let resolvePatch!: (value: Response) => void;
const pendingPatch = new Promise<Response>((resolve) => {
  resolvePatch = resolve;
});
const taskItem = { id: "task-1", type: "task", title: "One", status: "active" };
const renamedTask = { ...taskItem, title: "Renamed" };
const fetchMock = vi.fn((url: string, init?: RequestInit) => {
  if (init?.method === "PATCH") return pendingPatch;
  return Promise.resolve({ ok: true, json: async () => [taskItem] });
});

fireEvent.keyDown(document, { key: "s", ctrlKey: true });
fireEvent.keyDown(document, { key: "s", ctrlKey: true, repeat: true });
expect(fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "PATCH"))
  .toHaveLength(1);
expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
resolvePatch(new Response(JSON.stringify(renamedTask), {
  status: 200,
  headers: { "Content-Type": "application/json" },
}));
await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeDisabled());
```

Add `keeps detail draft history after a failed save`. Return a 500 response with `{ code: "internal_error", message: "Could not save detail." }`, then assert the alert text, edited title, enabled Undo button, and re-enabled Save button.

- [ ] **Step 2: Run shortcut tests to verify RED**

Run:

```powershell
npm --prefix frontend test -- tests/presentation/workbench-wireframe.spec.tsx -t "supports detail save undo and redo keyboard conventions|prevents duplicate detail saves while a request is pending|keeps detail draft history after a failed save"
```

Expected: keyboard assertions fail and duplicate save calls are observed because no detail command handler or pending guard exists.

- [ ] **Step 3: Guard and report saves**

Add state and a synchronous ref guard:

```tsx
const [isSaving, setIsSaving] = React.useState(false);
const [saveError, setSaveError] = React.useState<string | null>(null);
const savePendingRef = useRef(false);
```

Wrap `saveDraft`:

```tsx
async function saveDraft() {
  if (savePendingRef.current || !hasDraftChanges) return;
  savePendingRef.current = true;
  setIsSaving(true);
  setSaveError(null);
  dispatchDraft({ type: "close-group" });
  try {
    const patch = detailPatchForItem(detailItem, draft);
    if (Object.keys(patch).length > 0) await controller.saveDetailItem(patch);
    const transition = transitionActionForStatus(
      detailItem.status,
      draft.status,
      detailItem.type,
    );
    if (transition) await controller.transitionWorkspaceItem(detailItem.id, transition);
  } catch (error) {
    setSaveError(error instanceof RavenApiError ? error.message : "Could not save detail.");
  } finally {
    savePendingRef.current = false;
    setIsSaving(false);
  }
}
```

Disable Save with `disabled={!hasDraftChanges || isSaving}`. Render `<p role="alert">{saveError}</p>` directly below the detail header when non-null. Clear the error when the detail item ID changes and before each new save attempt.

- [ ] **Step 4: Add the mounted detail keyboard handler**

Keep the latest save function in a ref so the document listener does not capture stale draft
state and does not need to re-register after every keystroke:

```tsx
const saveDraftRef = useRef(saveDraft);
saveDraftRef.current = saveDraft;
```

Register one `document` listener from `DetailView` and clean it up in the effect return:

```tsx
React.useEffect(() => {
  function handleDetailCommand(event: KeyboardEvent) {
    if (
      event.isComposing ||
      pendingNavigation ||
      event.altKey ||
      (!event.ctrlKey && !event.metaKey)
    ) return;

    const key = event.key.toLowerCase();
    if (key === "s" && !event.shiftKey) {
      event.preventDefault();
      void saveDraftRef.current();
    } else if (key === "z" && event.shiftKey) {
      event.preventDefault();
      dispatchDraft({ type: "redo" });
    } else if (key === "z") {
      event.preventDefault();
      dispatchDraft({ type: "undo" });
    } else if (key === "y" && event.ctrlKey && !event.metaKey && !event.shiftKey) {
      event.preventDefault();
      dispatchDraft({ type: "redo" });
    }
  }

  document.addEventListener("keydown", handleDetailCommand);
  return () => document.removeEventListener("keydown", handleDetailCommand);
}, [pendingNavigation]);
```

The pending ref remains the exact duplicate-request guard even if two key events occur before
React commits `isSaving`.

- [ ] **Step 5: Run shortcut GREEN tests and type checking**

```powershell
npm --prefix frontend test -- tests/presentation/workbench-wireframe.spec.tsx -t "supports detail save undo and redo keyboard conventions|prevents duplicate detail saves while a request is pending|keeps detail draft history after a failed save"
npm --prefix frontend run typecheck
```

Expected: 3 tests pass and TypeScript exits 0.

- [ ] **Step 6: Commit shortcut and save safety behavior**

```powershell
git add frontend/src/features/workbench/ui/MainPanel.tsx frontend/tests/presentation/workbench-wireframe.spec.tsx
git commit -m @'
[UPDATE] Add detail editing shortcuts

- ToDo 공용 상세에서 저장·Undo·Redo 키보드 규칙을 지원
- 저장 요청 중 키 반복을 차단하고 실패 시 현재 드래프트와 이력을 보존
- 버튼과 단축키가 같은 페이지 로컬 명령을 사용하도록 통합
'@
```

### Task 3: Lock down page boundaries and saved-history behavior

**Files:**
- Modify: `frontend/tests/presentation/workbench-wireframe.spec.tsx:6315-6550`
- Modify: `frontend/src/features/workbench/ui/MainPanel.tsx:373-615` only if a boundary test exposes a defect

- [ ] **Step 1: Add saved-history and no-request tests**

Add `keeps undo history after saving without undoing the server`. Edit `One` to `Saved title`, save, wait for Save to become disabled, click Undo, and assert:

```tsx
expect(title).toHaveValue("One");
expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
expect(patchCalls(fetchMock)).toHaveLength(1);
await user.click(screen.getByRole("button", { name: "Redo" }));
expect(title).toHaveValue("Saved title");
expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
expect(patchCalls(fetchMock)).toHaveLength(1);
```

Define this small test helper near the new tests:

```tsx
function patchCalls(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter(
    ([, init]) => (init as RequestInit | undefined)?.method === "PATCH",
  );
}
```

This assertion is the safety proof: Undo and Redo do not issue a second request.

- [ ] **Step 2: Add suppression and item-reset tests**

Add `ignores detail history shortcuts during confirmation and IME composition`:

1. Edit the title.
2. Open the existing `< Back` discard confirmation.
3. Dispatch Ctrl+Z and assert the title is unchanged and the dialog stays open.
4. Cancel the dialog.
5. Dispatch a composing Ctrl+Z event and assert the title is still unchanged.
6. Dispatch a normal Ctrl+Z and assert the title reverts.

Use:

```tsx
fireEvent.keyDown(document, { key: "z", ctrlKey: true });
fireEvent.keyDown(document, { key: "z", ctrlKey: true, isComposing: true });
```

Add `resets detail history when another item opens`. Load `One` and `Two`, edit `One`, use
header Back and confirm Discard to return to the list, then open `Two`. Assert Undo and Redo
are disabled. Return to the list, reopen `One`, and assert its original server title is shown
with both history buttons disabled; the abandoned draft is not resurrected.

- [ ] **Step 3: Verify compound Goal edits are atomic**

Extend the existing Goal period detail test. After committing a new period, click Undo once and assert both `horizon` and `scheduled` return to their original displayed values. Click Redo once and assert both return to the committed values. Do not save during this test and assert zero PATCH calls.

- [ ] **Step 4: Verify the Planner entry path uses the same detail commands**

Add `uses the shared detail shortcuts for an item opened from Planner` with this navigation
and response shape:

```tsx
const task = {
  id: "task-detail",
  type: "task",
  title: "Detail task",
  status: "active",
  scheduled: testToday(),
};
const fetchMock = vi.fn((url: string, init?: RequestInit) => {
  if (url === "/api/v1/todo/items/task-detail" && init?.method === "PATCH") {
    return Promise.resolve({
      ok: true,
      json: async () => ({ ...task, title: "Planner edit" }),
    });
  }
  return Promise.resolve({
    ok: true,
    json: async () => url === "/api/v1/todo/items?type=task" ? [task] : [],
  });
});
vi.stubGlobal("fetch", fetchMock);

render(<WorkbenchPageClient />);
await user.click(screen.getByRole("button", { name: "ToDo" }));
await user.click(screen.getByRole("button", { name: "Planner" }));
await user.click(screen.getByRole("button", { name: "Daily" }));
await user.click(await screen.findByRole("button", { name: "Detail task" }));
const title = screen.getByLabelText("Title");
await user.clear(title);
await user.type(title, "Planner edit");
fireEvent.keyDown(document, { key: "z", ctrlKey: true });
expect(title).toHaveValue("Detail task");
await user.clear(title);
await user.type(title, "Planner edit");
fireEvent.keyDown(document, { key: "s", ctrlKey: true });
await waitFor(() => expect(patchCalls(fetchMock)).toHaveLength(1));
```

This must use ToDo → Planner → Daily; do not call `controller.openDetailView` directly.

- [ ] **Step 5: Run all SHI-21 focused tests**

```powershell
npm --prefix frontend test -- tests/presentation/workbench-wireframe.spec.tsx -t "detail.*undo|detail.*redo|detail.*shortcut|shared detail shortcuts|compound Goal|failed save|duplicate detail saves"
```

Expected: all selected tests pass. If the regex misses a named test, run that test by its full name before continuing.

- [ ] **Step 6: Commit boundary regressions**

```powershell
git add frontend/src/features/workbench/ui/MainPanel.tsx frontend/tests/presentation/workbench-wireframe.spec.tsx
git commit -m @'
[FIX] Keep detail history within its page

- 저장 이후 Undo도 현재 드래프트만 바꾸고 명시적 재저장 전에는 서버를 호출하지 않도록 검증
- 확인창·IME·상세 항목 전환에서 로컬 이력이 경계를 넘지 않도록 보호
- Workspace와 Planner가 같은 상세 편집 명령을 사용하는 흐름을 고정
'@
```

If Step 2 through Step 4 pass without production changes, include only the test file in this commit and keep the `[FIX]` tag because the tests lock down the safety boundary.

### Task 4: Document and verify the finished behavior

**Files:**
- Modify: `frontend/README.md:8-25`

- [ ] **Step 1: Update the frontend behavior reference**

Add this paragraph after the existing browser detail history paragraph:

```markdown
ToDo details opened from Workspace or Planner provide page-local Undo, Redo, and Save
controls. `Ctrl/Cmd+Z` undoes, `Ctrl/Cmd+Shift+Z` or `Ctrl+Y` redoes, and `Ctrl/Cmd+S`
saves. Undo and Redo change only the open draft and never mutate the server until Save is
explicitly used.
```

- [ ] **Step 2: Run formatting and diff checks**

```powershell
git diff --check
npm --prefix frontend run typecheck
```

Expected: both commands exit 0.

- [ ] **Step 3: Run the full frontend suite and production build sequentially**

```powershell
npm --prefix frontend test
npm --prefix frontend run build
```

Expected: all frontend tests pass and Next.js reports a successful static production build. Run sequentially because `next build` rewrites `.next/types`, which can race with type checking.

- [ ] **Step 4: Inspect final scope**

```powershell
git status --short
git diff --stat HEAD~3
git diff --check HEAD~3
git log --oneline -n 8
```

Confirm there are no API, Rust, database, controller-model, package, or dependency changes. Confirm the implementation commits contain only `MainPanel.tsx`, the presentation test, and `frontend/README.md`.

- [ ] **Step 5: Commit current-state documentation**

```powershell
git add frontend/README.md
git commit -m @'
[DOCS] Document page-local detail shortcuts

- Workspace와 Planner의 공용 상세에서 지원하는 저장·Undo·Redo 키를 기록
- Undo·Redo가 Save 전에는 서버를 변경하지 않는 안전 경계를 명시
'@
```

- [ ] **Step 6: Final verification evidence**

```powershell
git status --short --branch
git diff --check origin/main..HEAD
npm --prefix frontend run typecheck
```

Expected: the worktree is clean, diff check is empty, and type checking exits 0.
