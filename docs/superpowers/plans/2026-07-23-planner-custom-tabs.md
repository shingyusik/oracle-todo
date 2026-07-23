# Planner Custom Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every Planner table one or more persisted named tabs that explicitly save and restore that table's filter, sort, and group settings.

**Architecture:** Add a pure `planner-tabs` model that owns normalization and immutable tab transitions, then replace `PlannerControls.tableSettings` with per-table persisted tabs plus runtime active/draft state. Keep the existing Planner preference API and SQLite schema, expose tab commands through `WorkbenchController`, and render a focused tab-row component below each existing `PlannerTableHeader` title row. Route dirty tab switches and Planner navigation through one controller-owned confirmation state.

**Tech Stack:** React 18, Next.js 14, TypeScript 5.5, Vitest 3, Testing Library, existing SQLite-backed `/todo-engine/settings/planner` preference API, CSS in `frontend/src/styles/globals.css`.

## Global Constraints

- Every exact `PlannerTableId` owns an independent ordered tab collection.
- Every table always has at least one tab.
- The initial tab name is exactly `Table`; it has no permanent default status.
- `+` copies the current draft, uses `새 보기` as the selected initial name, appends the tab, and activates it.
- Tab names are trimmed, non-empty, and case-insensitively unique within one table; collisions gain ` 2`, ` 3`, and later numeric suffixes.
- Editing filter, sort, or group settings changes only the active tab's draft and keeps that tab active.
- A dirty active tab displays `•`; only **Save current settings** writes its draft into the saved tab.
- Switching tabs or leaving a dirty Planner screen requires explicit discard confirmation.
- Entering a Planner screen always activates the first tab for each visible table.
- A tab can be deleted from any position when at least two tabs exist; deletion is rejected when one tab remains.
- Do not add tab reordering, cross-table copying, duplicate-tab menu actions, tab-specific columns, persisted active-tab state, or browser unload warnings.
- Keep `planner.v1`, `GET /settings/planner`, and `PUT /settings/planner`; do not change Rust routes, SQLite schema, Todo policy, or audit events.
- Planner preference reads and writes remain serialized and best-effort.
- Follow red-green-refactor: write the focused failing test, observe the expected failure, implement the smallest complete behavior, rerun the focused suite, then commit one logical unit.
- Commit subjects use the repository's valid NFLOW tags: `[ADD]`, `[UPDATE]`, `[FIX]`, `[REFACTOR]`, `[DOCS]`, or `[RELEASE]`.

---

## File Structure

- Create `frontend/src/features/workbench/model/planner-tabs.ts`
  - Persisted/runtime tab types, normalization, name/ID repair, cloning, dirty comparison, and immutable tab transitions.
- Create `frontend/tests/domain/planner-tabs.spec.ts`
  - Pure migration, normalization, minimum-count, neighbor-selection, and dirty-state tests.
- Modify `frontend/src/features/workbench/model/planner-model.ts`
  - Export a complete deep clone for `PlannerTableSettings`.
- Modify `frontend/src/features/workbench/model/workbench-model.ts`
  - Store `tableTabs` in `PlannerControls` and expose typed controller tab commands and confirmation state.
- Modify `frontend/src/features/workbench/hooks/useWorkbenchController.ts`
  - Load/migrate/persist `tableTabs`, update drafts without auto-save, execute tab commands, and guard Planner navigation.
- Create `frontend/src/features/workbench/ui/PlannerTableTabs.tsx`
  - Accessible tab row, dirty marker, add/rename popovers, overflow actions, and keyboard behavior.
- Create `frontend/src/features/workbench/ui/PlannerTabConfirmationDialog.tsx`
  - One confirmation surface for dirty switching, dirty navigation, and deletion.
- Modify `frontend/src/features/workbench/ui/MainPanel.tsx`
  - Render `PlannerTableTabs` directly below every table title row.
- Modify `frontend/src/features/workbench/ui/WorkbenchWireframe.tsx`
  - Render the single global tab confirmation dialog.
- Modify `frontend/src/styles/globals.css`
  - Notion-like tab row, active/dirty states, popovers, overflow menu, responsive scrolling, and confirmation layout reuse.
- Modify `frontend/tests/presentation/use-workbench-controller.spec.tsx`
  - Controller migration, persistence, CRUD, dirty-state, navigation, and re-entry tests.
- Modify `frontend/tests/presentation/workbench-wireframe.spec.tsx`
  - End-to-end presentation, keyboard, focus, menu, and confirmation tests.
- Modify `README.md`
  - Document that `planner.v1` contains table-local ordered tabs and saved filter/sort/group snapshots.
- Move `.planning/todos/pending/2026-07-21-add-planner-custom-tabs.md` to `.planning/todos/completed/2026-07-21-add-planner-custom-tabs.md`
  - Close the captured todo only after all verification gates pass.
- Modify `.planning/STATE.md`
  - Remove the completed custom-tabs entry from Pending Todos.

### Task 1: Define the Pure Planner Tab Model

**Files:**
- Create: `frontend/src/features/workbench/model/planner-tabs.ts`
- Modify: `frontend/src/features/workbench/model/planner-model.ts:210`
- Test: `frontend/tests/domain/planner-tabs.spec.ts`

**Interfaces:**
- Consumes `PlannerTableId`, `PlannerTableSettings`, `LegacyPlannerControls`, `defaultPlannerTableSettings()`, `normalizePlannerTableSettings()`, and `clonePlannerTableSettings()`.
- Produces `PlannerTableTab`, `StoredPlannerTableTabs`, `PlannerTableTabsState`, `PlannerTabsState`, `buildPlannerTabsState()`, `plannerTabIsDirty()`, `selectPlannerTab()`, `updatePlannerTabDraft()`, `savePlannerTabDraft()`, `createPlannerTab()`, `renamePlannerTab()`, `deletePlannerTab()`, `discardPlannerTabDraft()`, and `resetPlannerTabsToFirst()`.

- [ ] **Step 1: Write failing pure-model tests.**

  Create `frontend/tests/domain/planner-tabs.spec.ts` with focused cases for legacy migration, invalid persisted data, duplicate names/IDs, dirty detection, save, create, rename, deletion, and first-tab reset:

  ```ts
  import { describe, expect, it } from "vitest";

  import {
    buildPlannerTabsState,
    createPlannerTab,
    deletePlannerTab,
    plannerTabIsDirty,
    resetPlannerTabsToFirst,
    savePlannerTabDraft,
    updatePlannerTabDraft,
  } from "@/features/workbench/model/planner-tabs";
  import { defaultPlannerTableSettings } from "@/features/workbench/model/planner-model";

  const legacy = {
    filterMode: "and" as const,
    filterRules: [],
    groupSettings: {
      yearly: { groupBy: "none" as const, sort: "manual" as const, hideEmpty: false, manualOrder: [], hiddenGroupKeys: [] },
      monthly: { groupBy: "none" as const, sort: "manual" as const, hideEmpty: false, manualOrder: [], hiddenGroupKeys: [] },
      weekly: { groupBy: "none" as const, sort: "manual" as const, hideEmpty: false, manualOrder: [], hiddenGroupKeys: [] },
      daily: { groupBy: "none" as const, sort: "manual" as const, hideEmpty: false, manualOrder: [], hiddenGroupKeys: [] },
    },
    dailySortRules: [],
    yearlySortRules: [],
    monthlySortRules: [],
    weeklySortRules: [],
  };

  describe("planner table tabs", () => {
    it("migrates each legacy table setting into one editable Table tab", () => {
      const today = {
        ...defaultPlannerTableSettings("daily.today"),
        filterMode: "or" as const,
      };
      const state = buildPlannerTabsState(
        undefined,
        { "daily.today": today },
        legacy,
      );

      expect(state["daily.today"]).toMatchObject({
        activeTabId: "daily.today-table",
        tabs: [{ id: "daily.today-table", name: "Table", settings: today }],
        draftSettings: today,
      });
      expect(state["daily.overdue"].tabs).toHaveLength(1);
    });

    it("keeps at least one tab and repairs duplicate names and ids", () => {
      const settings = defaultPlannerTableSettings("daily.today");
      const state = buildPlannerTabsState({
        "daily.today": {
          tabs: [
            { id: "same", name: "Focus", settings },
            { id: "same", name: "focus", settings },
          ],
        },
        "daily.overdue": { tabs: [] },
      }, undefined, legacy);

      expect(state["daily.today"].tabs.map(({ name }) => name)).toEqual(["Focus", "focus 2"]);
      expect(new Set(state["daily.today"].tabs.map(({ id }) => id)).size).toBe(2);
      expect(state["daily.overdue"].tabs).toHaveLength(1);
      expect(state["daily.overdue"].tabs[0]?.name).toBe("Table");
    });

    it("keeps edits in the draft until explicitly saved", () => {
      const initial = buildPlannerTabsState(undefined, undefined, legacy)["daily.today"];
      const edited = updatePlannerTabDraft(initial, {
        ...initial.draftSettings,
        filterMode: "or",
      });

      expect(plannerTabIsDirty(edited)).toBe(true);
      expect(edited.tabs[0]?.settings.filterMode).toBe("and");
      expect(savePlannerTabDraft(edited).tabs[0]?.settings.filterMode).toBe("or");
      expect(plannerTabIsDirty(savePlannerTabDraft(edited))).toBe(false);
    });

    it("copies the current draft and protects the one-tab minimum", () => {
      const initial = buildPlannerTabsState(undefined, undefined, legacy)["daily.today"];
      const created = createPlannerTab(initial, "new-id", "새 보기");

      expect(created?.tabs).toHaveLength(2);
      expect(created?.activeTabId).toBe("new-id");
      expect(created?.tabs[1]?.settings).toEqual(initial.draftSettings);
      expect(deletePlannerTab(initial, initial.activeTabId)).toBeNull();
      expect(deletePlannerTab(created!, "new-id")?.tabs).toHaveLength(1);
    });

    it("resets re-entry to the saved first tab", () => {
      const initial = buildPlannerTabsState(undefined, undefined, legacy)["daily.today"];
      const created = createPlannerTab(initial, "second", "Second")!;
      const edited = updatePlannerTabDraft(created, {
        ...created.draftSettings,
        filterMode: "or",
      });
      const reset = resetPlannerTabsToFirst(edited);

      expect(reset.activeTabId).toBe(reset.tabs[0]?.id);
      expect(reset.draftSettings).toEqual(reset.tabs[0]?.settings);
      expect(plannerTabIsDirty(reset)).toBe(false);
    });
  });
  ```

- [ ] **Step 2: Run the focused test and verify the expected failure.**

  ```bash
  cd frontend && npm run test -- tests/domain/planner-tabs.spec.ts
  ```

  Expected: FAIL because `planner-tabs.ts` and `clonePlannerTableSettings()` do not exist.

- [ ] **Step 3: Export the settings clone and implement the complete pure tab model.**

  Add this export to `planner-model.ts`, reusing the module's existing filter-value clone:

  ```ts
  export function clonePlannerTableSettings(
    settings: PlannerTableSettings,
  ): PlannerTableSettings {
    return {
      filterMode: settings.filterMode,
      filterRules: settings.filterRules.map((rule) => ({
        ...rule,
        value: clonePlannerFilterValue(rule.value),
      })),
      sortRules: settings.sortRules.map((rule) => ({ ...rule })),
      groupSettings: {
        ...settings.groupSettings,
        manualOrder: [...settings.groupSettings.manualOrder],
        hiddenGroupKeys: [...settings.groupSettings.hiddenGroupKeys],
      },
    };
  }
  ```

  Implement `planner-tabs.ts` with these exact public types and signatures:

  ```ts
  export type PlannerTableTab = {
    id: string;
    name: string;
    settings: PlannerTableSettings;
  };

  export type StoredPlannerTableTabs = {
    tabs: PlannerTableTab[];
  };

  export type PlannerTableTabsState = StoredPlannerTableTabs & {
    activeTabId: string;
    draftSettings: PlannerTableSettings;
  };

  export type PlannerTabsState = Record<PlannerTableId, PlannerTableTabsState>;

  export function buildPlannerTabsState(
    storedTabs: unknown | undefined,
    storedTableSettings: unknown | undefined,
    legacy: LegacyPlannerControls,
  ): PlannerTabsState;

  export function plannerTabIsDirty(state: PlannerTableTabsState): boolean;
  export function selectPlannerTab(
    state: PlannerTableTabsState,
    tabId: string,
  ): PlannerTableTabsState;
  export function updatePlannerTabDraft(
    state: PlannerTableTabsState,
    settings: PlannerTableSettings,
  ): PlannerTableTabsState;
  export function savePlannerTabDraft(
    state: PlannerTableTabsState,
  ): PlannerTableTabsState;
  export function createPlannerTab(
    state: PlannerTableTabsState,
    id: string,
    requestedName: string,
  ): PlannerTableTabsState | null;
  export function renamePlannerTab(
    state: PlannerTableTabsState,
    tabId: string,
    requestedName: string,
  ): PlannerTableTabsState | null;
  export function deletePlannerTab(
    state: PlannerTableTabsState,
    tabId: string,
  ): PlannerTableTabsState | null;
  export function discardPlannerTabDraft(
    state: PlannerTableTabsState,
  ): PlannerTableTabsState;
  export function resetPlannerTabsToFirst(
    state: PlannerTableTabsState,
  ): PlannerTableTabsState;
  ```

  Use `plannerTableIds` as the only map keys. When `storedTabs` is present,
  normalize only `tableTabs`; when it is absent and `storedTableSettings` is
  present, create one `Table` tab from each normalized table setting; when both
  are absent, pass `undefined` to `normalizePlannerTableSettings()` for legacy
  migration. A present but malformed map falls back to fresh table defaults
  rather than importing unrelated legacy values.

  `plannerTabIsDirty()` must compare the active saved settings with the draft.
  Array order is meaningful for filters, sorts, manual group order, and hidden
  group keys, so a deterministic `JSON.stringify()` comparison of cloned
  settings is sufficient.

  `deletePlannerTab()` must return `null` when one tab remains or the requested
  ID is absent. If it deletes the active tab, activate the right neighbor at
  the deleted index when present, otherwise the left neighbor.

- [ ] **Step 4: Rerun the pure model suites.**

  ```bash
  cd frontend && npm run test -- tests/domain/planner-tabs.spec.ts tests/domain/planner-model.spec.ts
  ```

  Expected: PASS with no regression in existing table-setting normalization.

- [ ] **Step 5: Commit the pure tab model.**

  ```bash
  git add frontend/src/features/workbench/model/planner-tabs.ts frontend/src/features/workbench/model/planner-model.ts frontend/tests/domain/planner-tabs.spec.ts
  git commit -m "[ADD] Define planner table tabs model" -m "- 테이블별 탭 정규화와 기존 설정 마이그레이션을 순수 모델로 분리
  - 초안 저장·생성·이름 변경·삭제·재진입 전환 규칙을 테스트로 고정"
  ```

### Task 2: Wire Controller State, CRUD, and Persistence

**Files:**
- Modify: `frontend/src/features/workbench/model/workbench-model.ts:81`
- Modify: `frontend/src/features/workbench/hooks/useWorkbenchController.ts:113`
- Test: `frontend/tests/presentation/use-workbench-controller.spec.tsx:380`

**Interfaces:**
- Consumes every Task 1 tab type and transition.
- Replaces `PlannerControls.tableSettings` with `PlannerControls.tableTabs: PlannerTabsState`.
- Preserves `plannerTableSettings(tableId)` for all existing rendering and creation callers by returning the active draft.
- Produces controller methods `plannerTableTabs()`, `selectPlannerTableTab()`, `savePlannerTableTab()`, `createPlannerTableTab()`, `renamePlannerTableTab()`, `requestDeletePlannerTableTab()`, `confirmPlannerTabAction()`, and `cancelPlannerTabAction()`.

- [ ] **Step 1: Add failing controller tests for migration, drafts, CRUD, and persistence.**

  Extend `use-workbench-controller.spec.tsx` with tests using the existing
  serialized fetch mock:

  ```ts
  it("migrates tableSettings into one Table tab and persists only saved tabs", async () => {
    const writes: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      if (url !== "/todo-engine/settings/planner") {
        return Promise.resolve({ ok: true, json: async () => [] });
      }
      if (!init) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            tableSettings: {
              "daily.today": {
                ...defaultPlannerTableSettings("daily.today"),
                filterMode: "or",
              },
            },
          }),
        });
      }
      writes.push(JSON.parse(String(init.body)).value);
      return Promise.resolve({ ok: true, json: async () => null });
    }));

    const { result } = renderHook(() => useWorkbenchController());
    await waitFor(() =>
      expect(result.current.plannerTableTabs("daily.today").tabs[0]?.name).toBe("Table"),
    );

    act(() => result.current.updatePlannerTableSettings("daily.today", (settings) => ({
      ...settings,
      filterMode: "and",
    })));
    expect(result.current.plannerTableIsDirty("daily.today")).toBe(true);
    expect(writes).toHaveLength(0);

    act(() => result.current.savePlannerTableTab("daily.today"));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(
      (writes[0] as {
        tableTabs: Record<string, { tabs: Array<{ name: string }> }>;
      }).tableTabs["daily.today"]?.tabs[0]?.name,
    ).toBe("Table");
    expect(
      (writes[0] as { tableTabs: Record<string, Record<string, unknown>> })
        .tableTabs["daily.today"],
    ).not.toHaveProperty("activeTabId");
    expect(
      (writes[0] as { tableTabs: Record<string, Record<string, unknown>> })
        .tableTabs["daily.today"],
    ).not.toHaveProperty("draftSettings");
    expect(writes[0]).not.toHaveProperty("tableSettings");
  });

  it("creates, renames, and deletes tabs without crossing table boundaries", async () => {
    const { result } = renderHook(() => useWorkbenchController());
    const overdueBefore = result.current.plannerTableTabs("daily.overdue");

    act(() => {
      expect(result.current.createPlannerTableTab("daily.today", "새 보기")).toBe(true);
    });
    const created = result.current.plannerTableTabs("daily.today");
    expect(created.tabs).toHaveLength(2);
    expect(created.tabs[1]?.name).toBe("새 보기");
    expect(result.current.plannerTableTabs("daily.overdue")).toBe(overdueBefore);

    act(() => {
      expect(result.current.renamePlannerTableTab(
        "daily.today",
        created.activeTabId,
        "Table",
      )).toBe(true);
    });
    expect(result.current.plannerTableTabs("daily.today").tabs[1]?.name).toBe("Table 2");

    act(() => result.current.requestDeletePlannerTableTab(
      "daily.today",
      created.activeTabId,
    ));
    expect(result.current.plannerTabConfirmation?.kind).toBe("delete");
    act(() => result.current.confirmPlannerTabAction());
    expect(result.current.plannerTableTabs("daily.today").tabs).toHaveLength(1);
  });
  ```

  Retain and update the existing out-of-order write test so two persisted tab
  mutations still serialize PUT requests and the last full `tableTabs` document
  wins.

  Add a best-effort failure test whose first PUT rejects and whose second PUT
  succeeds:

  ```ts
  it("keeps session tabs after a failed write and retries the full document", async () => {
    const bodies: unknown[] = [];
    let putCount = 0;
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      if (url !== "/todo-engine/settings/planner") {
        return Promise.resolve({ ok: true, json: async () => [] });
      }
      if (!init) {
        return Promise.resolve({ ok: true, json: async () => null });
      }
      putCount += 1;
      bodies.push(JSON.parse(String(init.body)).value);
      return putCount === 1
        ? Promise.reject(new Error("offline"))
        : Promise.resolve({ ok: true, json: async () => null });
    }));

    const { result } = renderHook(() => useWorkbenchController());
    act(() => {
      expect(result.current.createPlannerTableTab("daily.today", "Focus")).toBe(true);
    });
    await waitFor(() => expect(putCount).toBe(1));
    expect(result.current.plannerTableTabs("daily.today").tabs).toHaveLength(2);

    const activeId = result.current.plannerTableTabs("daily.today").activeTabId;
    act(() => {
      expect(result.current.renamePlannerTableTab(
        "daily.today",
        activeId,
        "Deep focus",
      )).toBe(true);
    });
    await waitFor(() => expect(putCount).toBe(2));
    expect(
      (bodies[1] as {
        tableTabs: Record<string, { tabs: Array<{ name: string }> }>;
      }).tableTabs["daily.today"]?.tabs.map(({ name }) => name),
    ).toEqual(["Table", "Deep focus"]);
  });
  ```

- [ ] **Step 2: Run the focused controller suite and verify it fails.**

  ```bash
  cd frontend && npm run test -- tests/presentation/use-workbench-controller.spec.tsx
  ```

  Expected: FAIL because `PlannerControls` and `WorkbenchController` do not expose tab state or commands.

- [ ] **Step 3: Replace controller table settings with tab state and exact commands.**

  In `workbench-model.ts`, define:

  ```ts
  export type PlannerTabConfirmation =
    | { kind: "select"; tableId: PlannerTableId; targetTabId: string }
    | { kind: "delete"; tableId: PlannerTableId; targetTabId: string }
    | { kind: "navigate"; targetSelection: WorkbenchSelection };

  export type PlannerControls = {
    date: string;
    weekStart: string;
    yearlyDate: string;
    monthlyDate: string;
    weeklyDate: string;
    dailyDate: string;
    tableTabs: PlannerTabsState;
  };
  ```

  Add these exact members to `WorkbenchController`:

  ```ts
  plannerTabConfirmation: PlannerTabConfirmation | null;
  plannerTableTabs: (tableId: PlannerTableId) => PlannerTableTabsState;
  plannerTableSettings: (tableId: PlannerTableId) => PlannerTableSettings;
  plannerTableIsDirty: (tableId: PlannerTableId) => boolean;
  updatePlannerTableSettings: (
    tableId: PlannerTableId,
    updater: (settings: PlannerTableSettings) => PlannerTableSettings,
  ) => void;
  selectPlannerTableTab: (tableId: PlannerTableId, tabId: string) => void;
  savePlannerTableTab: (tableId: PlannerTableId) => void;
  createPlannerTableTab: (tableId: PlannerTableId, name: string) => boolean;
  renamePlannerTableTab: (
    tableId: PlannerTableId,
    tabId: string,
    name: string,
  ) => boolean;
  requestDeletePlannerTableTab: (
    tableId: PlannerTableId,
    tabId: string,
  ) => void;
  confirmPlannerTabAction: () => void;
  cancelPlannerTabAction: () => void;
  ```

  In `useWorkbenchController.ts`:

  - Parse both `candidate.tableTabs` and legacy `candidate.tableSettings`.
  - Construct `tableTabs` with `buildPlannerTabsState()`.
  - Persist only `{ value: { tableTabs: storedOnlyMap } }`, stripping
    `activeTabId` and `draftSettings`.
  - Return `state.draftSettings` from `plannerTableSettings(tableId)`.
  - Make `updatePlannerTableSettings()` update only `draftSettings` and set the
    async-load protection ref without issuing PUT.
  - Persist after save, create, rename, and confirmed delete.
  - Generate opaque IDs with `crypto.randomUUID()` and a module-local
    timestamp/counter fallback for test environments without `randomUUID`.
  - Return `false` from create/rename when `name.trim()` is empty.
  - Open `{ kind: "delete" }` for every valid delete request; reject requests
    when only one tab remains before opening confirmation.

  Use one immutable helper inside the hook for all table updates:

  ```ts
  function updateTableTabs(
    planner: PlannerControls,
    tableId: PlannerTableId,
    updater: (state: PlannerTableTabsState) => PlannerTableTabsState,
  ): PlannerControls {
    return {
      ...planner,
      tableTabs: {
        ...planner.tableTabs,
        [tableId]: updater(planner.tableTabs[tableId]),
      },
    };
  }
  ```

  `confirmPlannerTabAction()` handles Task 2's delete action. Task 4 extends
  the same switch for select and navigation without changing these signatures.

- [ ] **Step 4: Rerun controller and type tests.**

  ```bash
  cd frontend && npm run test -- tests/presentation/use-workbench-controller.spec.tsx
  cd frontend && npm run typecheck
  ```

  Expected: PASS; existing `plannerTableSettings()` consumers continue to compile, edits do not PUT, and explicit tab mutations do.

- [ ] **Step 5: Commit controller tab persistence.**

  ```bash
  git add frontend/src/features/workbench/model/workbench-model.ts frontend/src/features/workbench/hooks/useWorkbenchController.ts frontend/tests/presentation/use-workbench-controller.spec.tsx
  git commit -m "[UPDATE] Persist planner table tabs" -m "- 기존 테이블 설정을 탭 하나로 마이그레이션하고 저장 문서를 tableTabs로 전환
  - 편집 초안과 명시적 저장을 분리하고 탭 CRUD를 컨트롤러에 추가"
  ```

### Task 3: Render Accessible Table Tabs and CRUD UI

**Files:**
- Create: `frontend/src/features/workbench/ui/PlannerTableTabs.tsx`
- Create: `frontend/src/features/workbench/ui/PlannerTabConfirmationDialog.tsx`
- Modify: `frontend/src/features/workbench/ui/MainPanel.tsx:1105`
- Modify: `frontend/src/features/workbench/ui/WorkbenchWireframe.tsx:31`
- Modify: `frontend/src/styles/globals.css:1044`
- Test: `frontend/tests/presentation/workbench-wireframe.spec.tsx:398`

**Interfaces:**
- Consumes the Task 2 controller methods without mutating Planner settings directly.
- Produces `PlannerTableTabs({ controller, tableId, title })` and `PlannerTabConfirmationDialog({ controller })`.
- Keeps the existing filter/sort/group/add controls and `PlannerActiveControlPills` unchanged.

- [ ] **Step 1: Add failing presentation tests for layout, creation, save, rename, deletion, keyboard, and focus.**

  Extend `workbench-wireframe.spec.tsx` with a Daily view test:

  ```ts
  it("manages named tabs below each Planner table title", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: true, json: async () => [] })),
    );
    render(<WorkbenchPageClient />);

    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));
    await user.click(screen.getByRole("button", { name: "Daily" }));

    const todayTabs = screen.getByRole("tablist", { name: "Today views" });
    expect(within(todayTabs).getByRole("tab", { name: "Table" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await user.click(within(todayTabs).getByRole("button", { name: "Add Today view" }));
    const nameInput = screen.getByRole("textbox", { name: "View name" });
    expect(nameInput).toHaveValue("새 보기");
    expect(nameInput).toHaveFocus();
    expect(nameInput).toHaveProperty("selectionStart", 0);
    expect(nameInput).toHaveProperty("selectionEnd", "새 보기".length);
    await user.keyboard("{Enter}");

    expect(within(todayTabs).getByRole("tab", { name: "새 보기" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await user.click(screen.getByRole("button", { name: "Filter Today" }));
    await user.click(screen.getByRole("button", { name: "Add filter rule" }));
    expect(within(todayTabs).getByRole("tab", {
      name: "새 보기, 저장되지 않은 변경사항",
    })).toHaveTextContent("•");

    await user.click(within(todayTabs).getByRole("button", {
      name: "Open 새 보기 view menu",
    }));
    await user.click(screen.getByRole("menuitem", { name: "Save current settings" }));
    expect(within(todayTabs).getByRole("tab", { name: "새 보기" })).not.toHaveTextContent("•");
  });
  ```

  Add separate tests that:

  - press Escape in add/rename popovers and verify focus returns to the trigger;
  - press Left/Right Arrow to move focus without selecting, then Enter to select;
  - rename `Table` to `새 보기` and verify the collision becomes `새 보기 2`;
  - verify inactive menus omit **Save current settings**;
  - verify **Delete** is disabled at one tab and enabled at two;
  - confirm deletion and verify the right neighbor activates, falling back left
    when the deleted tab had no right neighbor.

- [ ] **Step 2: Run the focused wireframe suite and verify it fails.**

  ```bash
  cd frontend && npm run test -- tests/presentation/workbench-wireframe.spec.tsx
  ```

  Expected: FAIL because no Planner table renders a tablist or tab CRUD controls.

- [ ] **Step 3: Implement the focused tab components and integrate every table header.**

  `PlannerTableTabs.tsx` exports:

  ```ts
  export function PlannerTableTabs({
    controller,
    tableId,
    title,
  }: {
    controller: WorkbenchController;
    tableId: PlannerTableId;
    title: string;
  }): React.JSX.Element;
  ```

  The component must:

  - render `role="tablist"` with `aria-label={`${title} views`}`;
  - render one `role="tab"` per saved tab and set `aria-selected`, roving
    `tabIndex`, and the dirty accessible name;
  - move focus with Left/Right Arrow and call
    `selectPlannerTableTab(tableId, tabId)` only on click, Enter, or Space;
  - place an overflow button next to each tab;
  - show **Save current settings** only for the active tab and disable it when
    clean;
  - open controlled add and rename popovers with `View name`, selected
    `새 보기`, Enter submit, Escape cancel, blank-name inline error, and focus
    return;
  - call controller create/rename commands, allowing the model to apply numeric
    suffixes;
  - call `requestDeletePlannerTableTab()` instead of deleting directly.

  `PlannerTabConfirmationDialog.tsx` exports:

  ```ts
  export function PlannerTabConfirmationDialog({
    controller,
  }: {
    controller: WorkbenchController;
  }): React.JSX.Element | null;
  ```

  For Task 3, render delete copy:

  ```text
  Delete this view?
  The saved view will be removed. This cannot be undone.
  Cancel | Delete
  ```

  When the deleted tab is active and dirty, append:

  ```text
  Its unsaved filter, sort, and group changes will also be discarded.
  ```

  Add Escape handling, initial focus on Cancel, and a two-control Tab focus
  trap. In `useLayoutEffect`, capture `document.activeElement` before moving
  focus to Cancel. Keep the initiating tab/menu/sidebar control mounted while
  confirmation is open; after cancel, focus the captured element when it is
  still connected. After a confirmed action removes that element, focus the
  resulting active tab or selected sidebar leaf as the deterministic fallback.

  Insert `<PlannerTableTabs controller={controller} tableId={tableId} title={title} />`
  between `.planner-table-header-row` and `PlannerActiveControlPills` in
  `PlannerTableHeader`. Render `<PlannerTabConfirmationDialog
  controller={controller} />` once in `WorkbenchWireframe`, after `MainPanel`.

  Add scoped CSS classes:

  ```css
  .planner-table-tabs {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 2px;
    overflow-x: auto;
    border-bottom: 1px solid var(--color-hairline-light);
    padding: 4px 0;
  }

  .planner-table-tab {
    display: inline-flex;
    min-height: 28px;
    align-items: center;
    gap: 4px;
    border: 0;
    border-radius: var(--radius-pill);
    background: transparent;
    padding: 4px 8px;
    color: var(--color-shade-60);
    white-space: nowrap;
  }

  .planner-table-tab[aria-selected="true"] {
    background: var(--color-canvas-cream);
    color: var(--color-ink);
    font-weight: 700;
  }

  .planner-table-tab-dirty {
    color: var(--color-blue-strong, #2383e2);
  }
  ```

  Keep popover/menu selectors under `.planner-table-tabs` so Workspace tables
  and existing Planner dropdowns do not change.

- [ ] **Step 4: Rerun focused presentation and accessibility coverage.**

  ```bash
  cd frontend && npm run test -- tests/presentation/workbench-wireframe.spec.tsx
  cd frontend && npm run typecheck
  ```

  Expected: PASS; every Planner table has an independent tab row and all existing table controls remain green.

- [ ] **Step 5: Commit the tab UI.**

  ```bash
  git add frontend/src/features/workbench/ui/PlannerTableTabs.tsx frontend/src/features/workbench/ui/PlannerTabConfirmationDialog.tsx frontend/src/features/workbench/ui/MainPanel.tsx frontend/src/features/workbench/ui/WorkbenchWireframe.tsx frontend/src/styles/globals.css frontend/tests/presentation/workbench-wireframe.spec.tsx
  git commit -m "[ADD] Render planner table tabs" -m "- 테이블 제목 아래에 접근 가능한 탭 행과 추가·이름 변경·저장·삭제 메뉴를 배치
  - 미저장 표시와 키보드 이동·포커스 복귀 동작을 검증"
  ```

### Task 4: Guard Dirty Switching and Planner Re-entry

**Files:**
- Modify: `frontend/src/features/workbench/hooks/useWorkbenchController.ts:501`
- Modify: `frontend/src/features/workbench/ui/PlannerTabConfirmationDialog.tsx`
- Test: `frontend/tests/presentation/use-workbench-controller.spec.tsx:540`
- Test: `frontend/tests/presentation/workbench-wireframe.spec.tsx:478`

**Interfaces:**
- Extends Task 2's existing `PlannerTabConfirmation` union; no new controller method names.
- Uses `discardPlannerTabDraft()`, `resetPlannerTabsToFirst()`, and the current `WorkbenchSelection`.
- Keeps Dashboard and Workspace navigation unchanged when the current Planner screen is clean.

- [ ] **Step 1: Add failing controller and wireframe tests for dirty switching and navigation.**

  Add controller tests that:

  ```ts
  it("requires discard confirmation before switching a dirty tab", () => {
    const { result } = renderHook(() => useWorkbenchController());
    act(() => {
      result.current.createPlannerTableTab("daily.today", "Second");
      result.current.updatePlannerTableSettings("daily.today", (settings) => ({
        ...settings,
        filterMode: "or",
      }));
    });
    const firstId = result.current.plannerTableTabs("daily.today").tabs[0]!.id;

    act(() => result.current.selectPlannerTableTab("daily.today", firstId));
    expect(result.current.plannerTabConfirmation).toEqual({
      kind: "select",
      tableId: "daily.today",
      targetTabId: firstId,
    });
    expect(result.current.plannerTableTabs("daily.today").activeTabId).not.toBe(firstId);

    act(() => result.current.cancelPlannerTabAction());
    expect(result.current.plannerTabConfirmation).toBeNull();

    act(() => result.current.selectPlannerTableTab("daily.today", firstId));
    act(() => result.current.confirmPlannerTabAction());
    expect(result.current.plannerTableTabs("daily.today").activeTabId).toBe(firstId);
    expect(result.current.plannerTableIsDirty("daily.today")).toBe(false);
  });
  ```

  Add a controller test that dirties two visible Daily tables, requests Weekly
  navigation, verifies one `{ kind: "navigate" }` confirmation, confirms it,
  and proves both Daily drafts were discarded:

  ```ts
  it("discards every dirty table on the departing Planner screen", () => {
    const { result } = renderHook(() => useWorkbenchController());
    act(() => result.current.selectTab("daily"));
    act(() => {
      result.current.updatePlannerTableSettings("daily.today", (settings) => ({
        ...settings,
        filterMode: "or",
      }));
      result.current.updatePlannerTableSettings("daily.overdue", (settings) => ({
        ...settings,
        filterMode: "or",
      }));
    });

    act(() => result.current.selectTab("weekly"));
    expect(result.current.selection.leafTabId).toBe("daily");
    expect(result.current.plannerTabConfirmation?.kind).toBe("navigate");

    act(() => result.current.confirmPlannerTabAction());
    expect(result.current.selection.leafTabId).toBe("weekly");
    expect(result.current.plannerTableIsDirty("daily.today")).toBe(false);
    expect(result.current.plannerTableIsDirty("daily.overdue")).toBe(false);
  });
  ```

  Add a re-entry test that selects a non-first Weekly tab, navigates to Daily,
  returns to Weekly, and proves every `weekly.*` table activates its first tab:

  ```ts
  it("activates the first table tabs whenever a Planner screen is entered", () => {
    const { result } = renderHook(() => useWorkbenchController());
    act(() => result.current.selectTab("weekly"));
    act(() => {
      result.current.createPlannerTableTab("weekly.day-grid", "Second");
    });
    expect(result.current.plannerTableTabs("weekly.day-grid").activeTabId).toBe(
      result.current.plannerTableTabs("weekly.day-grid").tabs[1]?.id,
    );

    act(() => result.current.selectTab("daily"));
    act(() => result.current.selectTab("weekly"));

    for (const tableId of [
      "weekly.month-goals",
      "weekly.week-goals",
      "weekly.day-grid",
    ] as const) {
      const tableTabs = result.current.plannerTableTabs(tableId);
      expect(tableTabs.activeTabId).toBe(tableTabs.tabs[0]?.id);
      expect(tableTabs.draftSettings).toEqual(tableTabs.tabs[0]?.settings);
    }
  });
  ```

  Add a wireframe test that presses Escape in the discard dialog, verifies the
  current Planner tab and sidebar leaf remain selected, then confirms discard
  and verifies navigation completes.

- [ ] **Step 2: Run the focused controller and wireframe tests and verify failure.**

  ```bash
  cd frontend && npm run test -- tests/presentation/use-workbench-controller.spec.tsx tests/presentation/workbench-wireframe.spec.tsx
  ```

  Expected: FAIL because dirty selection switches immediately and `selectTab()` bypasses tab draft state.

- [ ] **Step 3: Route tab switches and Planner navigation through one pending action.**

  In `useWorkbenchController.ts`, add:

  ```ts
  const plannerLeafTabIds = new Set<LeafTabId>([
    "yearly",
    "monthly",
    "weekly",
    "daily",
  ]);

  function tableIdsForPlannerLeaf(leafTabId: LeafTabId): PlannerTableId[] {
    return plannerLeafTabIds.has(leafTabId)
      ? plannerTableIds.filter((tableId) => tableId.startsWith(`${leafTabId}.`))
      : [];
  }
  ```

  Implement `selectPlannerTableTab()` as follows:

  - return when the requested tab is already active or absent;
  - when the active tab is dirty, store `{ kind: "select" }` without changing
    state;
  - otherwise call `selectPlannerTab()` immediately.

  Replace direct `setSelection()` inside `selectTab()` with a
  `requestSelection(nextSelection)` helper. If the leaf ID changes and any
  table in the departing Planner leaf is dirty, store `{ kind: "navigate" }`
  and keep the current selection. Otherwise:

  1. reset every table in the destination Planner leaf with
     `resetPlannerTabsToFirst()`;
  2. clear pending Dashboard detail state using the existing rule;
  3. set the destination selection.

  Extend `confirmPlannerTabAction()`:

  ```tsx
  switch (confirmation.kind) {
    case "select": {
      setPlanner((current) =>
        updateTableTabs(current, confirmation.tableId, (tableTabs) =>
          selectPlannerTab(
            discardPlannerTabDraft(tableTabs),
            confirmation.targetTabId,
          ),
        ),
      );
      break;
    }
    case "delete": {
      setPlanner((current) => {
        const deleted = deletePlannerTab(
          current.tableTabs[confirmation.tableId],
          confirmation.targetTabId,
        );
        if (!deleted) return current;
        const next = updateTableTabs(
          current,
          confirmation.tableId,
          () => deleted,
        );
        persistChangedPlannerSettings(next);
        return next;
      });
      break;
    }
    case "navigate": {
      setPlanner((current) => {
        let next = current;
        for (const tableId of tableIdsForPlannerLeaf(selection.leafTabId)) {
          next = updateTableTabs(next, tableId, discardPlannerTabDraft);
        }
        for (const tableId of tableIdsForPlannerLeaf(
          confirmation.targetSelection.leafTabId,
        )) {
          next = updateTableTabs(next, tableId, resetPlannerTabsToFirst);
        }
        return next;
      });
      setSelection(confirmation.targetSelection);
      break;
    }
  }
  setPlannerTabConfirmation(null);
  ```

  Clear the confirmation after every confirm/cancel. A confirmed discard changes
  runtime state only and must not issue a preference PUT.

  Extend `PlannerTabConfirmationDialog` with exact copy:

  - Select: `Discard unsaved view changes?`
  - Navigate: `Discard unsaved Planner changes?`
  - Body: `Your unsaved filter, sort, and group changes will be lost.`
  - Actions: `Cancel` and `Discard changes`

  Reuse the same Escape, focus trap, and focus-return behavior from Task 3.

- [ ] **Step 4: Run navigation regression tests and the complete frontend gates.**

  ```bash
  cd frontend && npm run test -- tests/presentation/use-workbench-controller.spec.tsx tests/presentation/workbench-wireframe.spec.tsx
  cd frontend && npm run test
  cd frontend && npm run typecheck
  cd frontend && npm run build
  ```

  Expected: all commands PASS. Existing Dashboard, Workspace, Planner period navigation, filter/sort/group, contextual creation, and linked-detail tests remain green.

- [ ] **Step 5: Commit navigation guards.**

  ```bash
  git add frontend/src/features/workbench/hooks/useWorkbenchController.ts frontend/src/features/workbench/ui/PlannerTabConfirmationDialog.tsx frontend/tests/presentation/use-workbench-controller.spec.tsx frontend/tests/presentation/workbench-wireframe.spec.tsx
  git commit -m "[UPDATE] Guard planner tab navigation" -m "- 미저장 탭 전환과 플래너 화면 이동을 하나의 폐기 확인 흐름으로 보호
  - 플래너 화면 재진입 시 각 테이블의 첫 탭을 복원"
  ```

### Task 5: Synchronize Documentation and Close the Captured Todo

**Files:**
- Modify: `README.md:431`
- Move: `.planning/todos/pending/2026-07-21-add-planner-custom-tabs.md`
- Create: `.planning/todos/completed/2026-07-21-add-planner-custom-tabs.md`
- Modify: `.planning/STATE.md:114`

**Interfaces:**
- Consumes the final persisted `tableTabs` schema and verified UI behavior.
- Produces current-state documentation and a GSD pending count of zero.

- [ ] **Step 1: Update the README with the final preference shape and behavior.**

  Replace the generic Planner preference sentence with current-state wording:

  ```markdown
  Planner preferences are stored as the `planner.v1` JSON document in the workspace's
  `todo.sqlite`. They are workspace-wide because the local server has no user or profile
  identity. Each stable Planner table ID owns an ordered, non-empty tab list. Every tab
  stores a name plus a filter, sort, and group settings snapshot; active tabs and unsaved
  drafts remain frontend runtime state and are not persisted.
  ```

  Keep the existing endpoint and best-effort read/write documentation unchanged.

- [ ] **Step 2: Rerun final format and verification gates from the repository root.**

  ```bash
  cargo fmt --check
  cargo test
  cargo clippy --all-targets --all-features -- -D warnings
  cd frontend && npm run test
  cd frontend && npm run typecheck
  cd frontend && npm run build
  ```

  Expected: every command PASS. If a pre-existing unrelated failure appears,
  record the exact failing command and evidence; do not weaken or skip the
  Planner custom-tabs tests.

- [ ] **Step 3: Move the captured todo to completed and update GSD state.**

  Move:

  ```text
  .planning/todos/pending/2026-07-21-add-planner-custom-tabs.md
  ```

  to:

  ```text
  .planning/todos/completed/2026-07-21-add-planner-custom-tabs.md
  ```

  Remove `Add planner custom tabs` from `.planning/STATE.md` under
  `### Pending Todos`. Re-run:

  ```bash
  node "$HOME/.codex/gsd-core/bin/gsd-tools.cjs" query init.todos
  ```

  Expected: JSON contains `"todo_count": 0`.

- [ ] **Step 4: Inspect the final documentation-only diff.**

  ```bash
  git status --short
  git diff -- README.md .planning/STATE.md .planning/todos
  git diff --check
  ```

  Expected: README describes the final tab schema, the todo appears as a
  100%-similarity move after staging, and no unrelated working-tree changes are
  included.

- [ ] **Step 5: Commit final documentation and todo completion.**

  ```bash
  git add README.md .planning/STATE.md .planning/todos/pending/2026-07-21-add-planner-custom-tabs.md .planning/todos/completed/2026-07-21-add-planner-custom-tabs.md
  git commit -m "[DOCS] Document planner table tabs" -m "- planner.v1의 테이블별 탭 저장 구조와 런타임 초안 경계를 문서화
  - 검증을 통과한 사용자 정의 탭 할 일을 완료 처리"
  ```

## Final Verification

After all five task commits:

```bash
git status --short
git log --oneline -n 8
node "$HOME/.codex/gsd-core/bin/gsd-tools.cjs" query init.todos
```

Expected:

- no unintended working-tree changes;
- five focused commits for model, controller, UI, navigation, and docs;
- `todo_count` is `0`;
- the Planner custom tabs design, implementation, tests, README, and GSD state agree.
