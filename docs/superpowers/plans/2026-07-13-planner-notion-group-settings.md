# Planner Notion Group Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give all four planner views a shared Notion-style group settings panel with view-local ordering, visibility, empty-group behavior, and browser persistence.

**Architecture:** Add a pure `planner-group-settings` model that normalizes stored values and derives the ordered visible group universe. The workbench controller owns four settings values and best-effort local-storage synchronization; planner derivation consumes normalized settings; a focused panel component owns only temporary submenu and drag interaction state.

**Tech Stack:** TypeScript 5.5, React 18, Next.js 14, Vitest, React Testing Library, lucide-react, browser `localStorage`, native HTML drag events.

## Global Constraints

- SQLite remains the source of truth for todo items; group settings remain frontend-only.
- Do not add Rust endpoints, schema columns, or npm dependencies.
- Preserve Yearly and Monthly group choices as Tag and Status only.
- Preserve Weekly and Daily group choices as Area, Project, Routine, Tag, Item type, and Status.
- Grouping must not flatten period cards, goal sections, Weekly date cards, or Daily sections.
- `Hide empty groups` defaults to `true`; empty groups never repeat inside individual time containers.
- Use `Intl.Collator` for displayed-label ordering.
- Persist settings independently with `oracle-todo.planner-group-settings.v1.<view>` keys.
- Every commit follows `[TAG] English subject` plus a Korean bullet body.

---

## File Structure

- Create `frontend/src/features/workbench/model/planner-group-settings.ts`: group setting types, defaults, storage normalization, candidate construction, ordering, and visibility.
- Create `frontend/src/features/workbench/ui/PlannerGroupPanel.tsx`: Notion-style panel, property/sort submenus, visibility, bulk actions, and manual reordering controls.
- Create `frontend/tests/domain/planner-group-settings.spec.ts`: pure setting and group-universe behavior.
- Modify `frontend/src/features/workbench/model/workbench-model.ts`: replace per-view `groupBy` scalars with per-view `PlannerGroupSettings` and expose intent-level controller actions.
- Modify `frontend/src/features/workbench/hooks/useWorkbenchController.ts`: initialize, persist, and mutate per-view settings.
- Modify `frontend/src/features/workbench/model/planner-model.ts`: accept ordered visible candidates and retain item-to-group placement.
- Modify `frontend/src/features/workbench/ui/MainPanel.tsx`: use the extracted panel and pass active settings through all planner render paths.
- Modify `frontend/src/styles/globals.css`: panel rows, switch, group list, visibility, and drag/focus styles.
- Modify `frontend/tests/domain/planner-model.spec.ts`: verify candidate-aware grouping inside time containers.
- Modify `frontend/tests/presentation/use-workbench-controller.spec.tsx`: verify independent persistence and recovery.
- Modify `frontend/tests/presentation/workbench-wireframe.spec.tsx`: verify shared panel interactions and preserved planner structures.

---

### Task 1: Pure Planner Group Settings Model

**Files:**
- Create: `frontend/src/features/workbench/model/planner-group-settings.ts`
- Create: `frontend/tests/domain/planner-group-settings.spec.ts`

**Interfaces:**
- Consumes: `PlannerGroupBy` from `planner-model.ts`; `WorkspaceItemModel` and `WorkspaceItemsModel["relatedItems"]` from `workbench-model.ts`.
- Produces: `PlannerViewId`, `PlannerGroupSort`, `PlannerGroupSettings`, `PlannerGroupCandidate`, `defaultPlannerGroupSettings()`, `normalizePlannerGroupSettings(value)`, `plannerGroupStorageKey(view)`, `buildPlannerGroupCandidates(args)`, `orderVisiblePlannerGroups(candidates, settings)`, and `moveManualGroup(order, key, direction)`.

- [ ] **Step 1: Write failing normalization and persistence-key tests**

```ts
import { describe, expect, it } from "vitest";
import {
  defaultPlannerGroupSettings,
  normalizePlannerGroupSettings,
  plannerGroupStorageKey,
} from "@/features/workbench/model/planner-group-settings";

describe("planner group settings", () => {
  it("uses independent versioned storage keys", () => {
    expect(plannerGroupStorageKey("yearly")).toBe(
      "oracle-todo.planner-group-settings.v1.yearly",
    );
    expect(plannerGroupStorageKey("daily")).toBe(
      "oracle-todo.planner-group-settings.v1.daily",
    );
  });

  it("normalizes partial or malformed stored values", () => {
    expect(normalizePlannerGroupSettings(null)).toEqual(
      defaultPlannerGroupSettings(),
    );
    expect(
      normalizePlannerGroupSettings({
        groupBy: "tag",
        sort: "alphabetical",
        hideEmpty: false,
        manualOrder: ["focus", 4, "focus"],
        hiddenGroupKeys: ["ops", null],
      }),
    ).toEqual({
      groupBy: "tag",
      sort: "alphabetical",
      hideEmpty: false,
      manualOrder: ["focus"],
      hiddenGroupKeys: ["ops"],
    });
  });
});
```

- [ ] **Step 2: Run the new test and verify the module is missing**

Run: `cd frontend && npm test -- --run tests/domain/planner-group-settings.spec.ts`

Expected: FAIL with module resolution error for `planner-group-settings`.

- [ ] **Step 3: Implement types, defaults, key generation, and defensive normalization**

```ts
export type PlannerViewId = "yearly" | "monthly" | "weekly" | "daily";
export type PlannerGroupSort =
  | "manual"
  | "alphabetical"
  | "reverse_alphabetical";

export type PlannerGroupSettings = {
  groupBy: PlannerGroupBy;
  sort: PlannerGroupSort;
  hideEmpty: boolean;
  manualOrder: string[];
  hiddenGroupKeys: string[];
};

export function defaultPlannerGroupSettings(): PlannerGroupSettings {
  return {
    groupBy: "none",
    sort: "manual",
    hideEmpty: true,
    manualOrder: [],
    hiddenGroupKeys: [],
  };
}

export function plannerGroupStorageKey(view: PlannerViewId): string {
  return `oracle-todo.planner-group-settings.v1.${view}`;
}
```

Implement `normalizePlannerGroupSettings` with enum sets and a `uniqueStrings` helper. Unknown `groupBy` and `sort` values use defaults; non-boolean `hideEmpty` uses `true`; arrays retain unique string entries only.

- [ ] **Step 4: Add failing group-universe and ordering tests**

```ts
it("builds relation, missing-value, and multi-tag candidates", () => {
  const candidates = buildPlannerGroupCandidates({
    view: "daily",
    groupBy: "tag",
    items: [
      item("a", { tags: ["focus", "ops"] }),
      item("b", { tags: [] }),
    ],
    relatedItems,
  });
  expect(candidates.map(({ key, label, count }) => ({ key, label, count }))).toEqual([
    { key: "focus", label: "focus", count: 1 },
    { key: "ops", label: "ops", count: 1 },
    { key: "untagged", label: "Untagged", count: 1 },
  ]);
});

it("orders visible groups and appends unknown manual keys", () => {
  const candidates = [candidate("b", "Beta"), candidate("a", "Alpha")];
  expect(
    orderVisiblePlannerGroups(candidates, {
      ...defaultPlannerGroupSettings(),
      groupBy: "tag",
      manualOrder: ["a"],
    }).map((group) => group.key),
  ).toEqual(["a", "b"]);
  expect(
    orderVisiblePlannerGroups(candidates, {
      ...defaultPlannerGroupSettings(),
      groupBy: "tag",
      sort: "reverse_alphabetical",
    }).map((group) => group.key),
  ).toEqual(["b", "a"]);
});
```

Define the local test helpers `item`, `candidate`, and `relatedItems` in the same test file with complete `WorkspaceItemModel` values.

- [ ] **Step 5: Implement candidate construction, visibility, sorting, and manual moves**

```ts
export type PlannerGroupCandidate = {
  key: string;
  label: string;
  count: number;
};

export function orderVisiblePlannerGroups(
  candidates: PlannerGroupCandidate[],
  settings: PlannerGroupSettings,
): PlannerGroupCandidate[] {
  const visible = candidates.filter(
    (candidate) =>
      !settings.hiddenGroupKeys.includes(candidate.key) &&
      (!settings.hideEmpty || candidate.count > 0),
  );
  const collator = new Intl.Collator(undefined, { sensitivity: "base" });
  if (settings.sort !== "manual") {
    const direction = settings.sort === "alphabetical" ? 1 : -1;
    return [...visible].sort(
      (left, right) => direction * collator.compare(left.label, right.label),
    );
  }
  const rank = new Map(settings.manualOrder.map((key, index) => [key, index]));
  return [...visible].sort(
    (left, right) =>
      (rank.get(left.key) ?? Number.MAX_SAFE_INTEGER) -
      (rank.get(right.key) ?? Number.MAX_SAFE_INTEGER),
  );
}
```

`buildPlannerGroupCandidates` must enumerate related maps for relation properties, `["task", "event", "routine"]` for item type, and `["proposed", "approved", "active", "paused"]` for non-terminal status. Tag candidates come from discovered values. Relation and tag modes append the matching missing-value candidate (`none` or `untagged`). Counts come from the selected view-period item set. `moveManualGroup` swaps a key with its previous or next key and returns a new array.

- [ ] **Step 6: Run focused tests and typecheck**

Run: `cd frontend && npm test -- --run tests/domain/planner-group-settings.spec.ts && npm run typecheck`

Expected: all new tests PASS and TypeScript exits 0.

- [ ] **Step 7: Commit the pure model**

```bash
git add frontend/src/features/workbench/model/planner-group-settings.ts frontend/tests/domain/planner-group-settings.spec.ts
git commit -m "[ADD] Add planner group settings model" -m "- 그룹 설정 정규화와 뷰별 저장 키를 정의
- 그룹 후보, 가시성, 정렬, 수동 이동을 순수 함수로 구현"
```

---

### Task 2: View-Local Controller State and Persistence

**Files:**
- Modify: `frontend/src/features/workbench/model/workbench-model.ts`
- Modify: `frontend/src/features/workbench/hooks/useWorkbenchController.ts`
- Modify: `frontend/tests/presentation/use-workbench-controller.spec.tsx`

**Interfaces:**
- Consumes: `PlannerGroupSettings`, `PlannerGroupSort`, `PlannerViewId`, `defaultPlannerGroupSettings`, `normalizePlannerGroupSettings`, and `plannerGroupStorageKey` from Task 1.
- Produces: `PlannerControls.groupSettings: Record<PlannerViewId, PlannerGroupSettings>` and controller actions `setPlannerGroupBy`, `setPlannerGroupSort`, `setPlannerHideEmptyGroups`, `togglePlannerGroupVisibility`, `setAllPlannerGroupsVisible`, `setPlannerManualGroupOrder`, and `removePlannerGrouping`.

- [ ] **Step 1: Write failing controller persistence tests**

```ts
it("persists group settings independently by planner view", () => {
  const { result, unmount } = renderHook(() => useWorkbenchController());
  act(() => {
    result.current.selectTab("daily");
    result.current.setPlannerGroupBy("tag");
    result.current.setPlannerGroupSort("alphabetical");
  });
  act(() => {
    result.current.selectTab("weekly");
    result.current.setPlannerGroupBy("status");
  });
  expect(result.current.planner.groupSettings.daily.groupBy).toBe("tag");
  expect(result.current.planner.groupSettings.weekly.groupBy).toBe("status");
  unmount();
  const restored = renderHook(() => useWorkbenchController());
  expect(restored.result.current.planner.groupSettings.daily.sort).toBe(
    "alphabetical",
  );
});

it("recovers from malformed stored settings", () => {
  localStorage.setItem(
    "oracle-todo.planner-group-settings.v1.daily",
    "{broken",
  );
  const { result } = renderHook(() => useWorkbenchController());
  expect(result.current.planner.groupSettings.daily).toEqual(
    defaultPlannerGroupSettings(),
  );
});
```

Reset `localStorage` in the test suite's existing `beforeEach` so tests remain isolated.

- [ ] **Step 2: Run controller tests and verify the new API is absent**

Run: `cd frontend && npm test -- --run tests/presentation/use-workbench-controller.spec.tsx`

Expected: FAIL because `groupSettings` and the new controller actions do not exist.

- [ ] **Step 3: Add the settings record beside the temporary scalar fields**

Add this field to `PlannerControls`:

```ts
groupSettings: Record<PlannerViewId, PlannerGroupSettings>;
```

Keep the four scalar group fields and `setDailyGroupBy` temporarily so the existing renderer remains type-safe until Task 3. Add these controller actions:

```ts
setPlannerGroupBy: (groupBy: PlannerGroupBy) => void;
setPlannerGroupSort: (sort: PlannerGroupSort) => void;
setPlannerHideEmptyGroups: (hideEmpty: boolean) => void;
togglePlannerGroupVisibility: (key: string) => void;
setAllPlannerGroupsVisible: (keys: string[], visible: boolean) => void;
setPlannerManualGroupOrder: (keys: string[]) => void;
removePlannerGrouping: () => void;
```

- [ ] **Step 4: Implement safe initialization and best-effort writes**

Add helpers in `useWorkbenchController.ts`:

```ts
const plannerViewIds: PlannerViewId[] = ["yearly", "monthly", "weekly", "daily"];

function loadPlannerGroupSettings(view: PlannerViewId): PlannerGroupSettings {
  if (typeof window === "undefined") return defaultPlannerGroupSettings();
  try {
    const stored = window.localStorage.getItem(plannerGroupStorageKey(view));
    return normalizePlannerGroupSettings(stored ? JSON.parse(stored) : null);
  } catch {
    return defaultPlannerGroupSettings();
  }
}

function persistPlannerGroupSettings(
  view: PlannerViewId,
  settings: PlannerGroupSettings,
): void {
  try {
    window.localStorage.setItem(
      plannerGroupStorageKey(view),
      JSON.stringify(settings),
    );
  } catch {
    // Browser storage is best-effort; React state remains authoritative.
  }
}
```

Initialize all four settings inside `createDefaultPlanner`. Add one `updateActiveGroupSettings` helper that only accepts planner leaf tabs, updates the matching record immutably, and calls persistence with the resulting settings. Implement every controller action through that helper. `removePlannerGrouping` assigns `defaultPlannerGroupSettings()`.

- [ ] **Step 5: Run controller tests and typecheck**

Run: `cd frontend && npm test -- --run tests/presentation/use-workbench-controller.spec.tsx && npm run typecheck`

Expected: controller tests PASS and typecheck exits 0. The temporary scalar fields still serve the old renderer and are removed atomically with its migration in Task 3.

- [ ] **Step 6: Commit controller persistence**

```bash
git add frontend/src/features/workbench/model/workbench-model.ts frontend/src/features/workbench/hooks/useWorkbenchController.ts frontend/tests/presentation/use-workbench-controller.spec.tsx
git commit -m "[ADD] Persist planner group settings per view" -m "- 네 Planner 뷰의 그룹 상태를 독립적으로 관리
- 손상되거나 사용할 수 없는 브라우저 저장소를 기본값으로 안전하게 처리"
```

---

### Task 3: Candidate-Aware Planner Grouping Pipeline

**Files:**
- Modify: `frontend/src/features/workbench/model/planner-model.ts`
- Modify: `frontend/src/features/workbench/ui/MainPanel.tsx`
- Modify: `frontend/tests/domain/planner-model.spec.ts`

**Interfaces:**
- Consumes: `PlannerGroupSettings`, `PlannerGroupCandidate`, `buildPlannerGroupCandidates`, and `orderVisiblePlannerGroups` from Task 1; `PlannerControls.groupSettings` from Task 2.
- Produces: `groupPlannerItems(items, relatedItems, settings, candidates): PlannerGroup[]` and one active-settings lookup used by all planner render paths.

- [ ] **Step 1: Write failing candidate-aware grouping tests**

```ts
it("uses visible candidate order and keeps multi-tag duplication", () => {
  const settings = {
    ...defaultPlannerGroupSettings(),
    groupBy: "tag" as const,
    manualOrder: ["ops", "focus"],
    hiddenGroupKeys: ["admin"],
  };
  const candidates = buildPlannerGroupCandidates({
    view: "daily",
    groupBy: "tag",
    items,
    relatedItems,
  });
  const groups = groupPlannerItems(items, relatedItems, settings, candidates);
  expect(groups.map((group) => group.key).slice(0, 2)).toEqual(["ops", "focus"]);
  expect(groups.find((group) => group.key === "focus")?.items).toContainEqual(
    expect.objectContaining({ id: "task-focus" }),
  );
  expect(groups.find((group) => group.key === "ops")?.items).toContainEqual(
    expect.objectContaining({ id: "task-focus" }),
  );
  expect(groups.some((group) => group.key === "admin")).toBe(false);
});
```

- [ ] **Step 2: Run model tests and verify the signature mismatch**

Run: `cd frontend && npm test -- --run tests/domain/planner-model.spec.ts`

Expected: FAIL because `groupPlannerItems` does not accept settings and candidates.

- [ ] **Step 3: Update group derivation to follow candidate order**

Change `groupPlannerItems` to compute item buckets with the existing `groupKeys` behavior, then map `orderVisiblePlannerGroups(candidates, settings)` into `PlannerGroup` values. Omit candidates with no items from rendered time containers. Keep the special ungrouped output `{ key: "all", label: "All", items }` when `settings.groupBy === "none"`.

Update `buildDailyPlannerModel` options from `groupBy` to:

```ts
groupSettings: PlannerGroupSettings;
groupCandidates: PlannerGroupCandidate[];
```

Pass both values through each Daily `section` call.

- [ ] **Step 4: Replace old MainPanel group lookups**

Add focused helpers:

```ts
function plannerViewId(controller: WorkbenchController): PlannerViewId {
  return controller.panel.id as PlannerViewId;
}

function plannerGroupSettings(
  controller: WorkbenchController,
): PlannerGroupSettings {
  return controller.planner.groupSettings[plannerViewId(controller)];
}

function plannerGroupCandidates(
  controller: WorkbenchController,
  items: WorkspaceItemModel[],
): PlannerGroupCandidate[] {
  const settings = plannerGroupSettings(controller);
  return buildPlannerGroupCandidates({
    view: plannerViewId(controller),
    groupBy: settings.groupBy,
    items,
    relatedItems: controller.workspaceItems.relatedItems,
  });
}
```

Use one candidate universe derived from the filtered active view-period items and reuse it for every Yearly/Monthly goal list, Weekly goal/date container, or Daily section. Replace `plannerGroupValue`, `effectivePlannerGroupValue`, and the Daily special setter. Remove the four scalar group fields from `PlannerControls`, their defaults, and the legacy `setDailyGroupBy` action after all render paths use `groupSettings`. Keep `plannerGroupOptions` until Task 4 moves it to the panel.

- [ ] **Step 5: Run model and presentation regression tests**

Run: `cd frontend && npm test -- --run tests/domain/planner-model.spec.ts tests/presentation/workbench-wireframe.spec.tsx && npm run typecheck`

Expected: all selected tests PASS and typecheck exits 0 after updating existing group test setup to use default settings.

- [ ] **Step 6: Commit grouping pipeline integration**

```bash
git add frontend/src/features/workbench/model/planner-model.ts frontend/src/features/workbench/ui/MainPanel.tsx frontend/tests/domain/planner-model.spec.ts
git commit -m "[UPDATE] Apply planner group settings to view models" -m "- 공통 그룹 후보 순서와 가시성을 모든 Planner 렌더 경로에 적용
- 기간 카드와 날짜 및 일일 섹션 구조를 유지하면서 그룹만 재배치"
```

---

### Task 4: Shared Notion-Style Group Panel

**Files:**
- Create: `frontend/src/features/workbench/ui/PlannerGroupPanel.tsx`
- Modify: `frontend/src/features/workbench/ui/MainPanel.tsx`
- Modify: `frontend/src/styles/globals.css`
- Modify: `frontend/tests/presentation/workbench-wireframe.spec.tsx`

**Interfaces:**
- Consumes: active `PlannerGroupSettings`, ordered `PlannerGroupCandidate[]`, and Task 2 controller actions.
- Produces: `PlannerGroupPanel({ controller, candidates, onClose }): JSX.Element`; removes the old inline `PlannerGroupPanel` and `plannerGroupOptions` from `MainPanel.tsx`.

- [ ] **Step 1: Write failing shared-panel interaction test**

```ts
it.each(["Yearly", "Monthly", "Weekly", "Daily"])(
  "opens the Notion group settings panel in %s",
  async (view) => {
    const user = userEvent.setup();
    render(<WorkbenchPageClient />);
    await openPlannerView(user, view);
    await user.click(screen.getByRole("button", { name: "Group planner view" }));
    expect(screen.getByRole("dialog", { name: "Group settings" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose group property" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Hide empty groups" })).toBeChecked();
  },
);

it("sorts, hides, reorders, and removes groups", async () => {
  const user = userEvent.setup();
  render(<WorkbenchPageClient />);
  await openPlannerView(user, "Daily");
  await user.click(screen.getByRole("button", { name: "Group planner view" }));
  await user.click(screen.getByRole("button", { name: "Choose group property" }));
  await user.click(screen.getByRole("option", { name: "Tag" }));
  await user.click(screen.getByRole("button", { name: "Choose group sort" }));
  await user.click(screen.getByRole("option", { name: "Alphabetical" }));
  await user.click(screen.getByRole("button", { name: "Hide focus" }));
  expect(screen.queryByRole("heading", { name: "focus" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Remove grouping" }));
  expect(screen.getByRole("button", { name: "Choose group property" })).toHaveTextContent("None");
});
```

Use the suite's existing fetch fixtures and add `openPlannerView` locally if it does not exist.

- [ ] **Step 2: Run the presentation test and verify panel semantics are absent**

Run: `cd frontend && npm test -- --run tests/presentation/workbench-wireframe.spec.tsx`

Expected: FAIL because the current menu has no dialog, switch, sort, or visibility controls.

- [ ] **Step 3: Implement the extracted panel and submenus**

The component keeps:

```ts
type GroupPanelPage = "settings" | "property" | "sort";
const [page, setPage] = useState<GroupPanelPage>("settings");
```

Render `role="dialog" aria-label="Group settings"`. The settings page contains `Choose group property`, `Choose group sort`, the native checkbox with `role="switch"`, group rows, bulk visibility, and `Remove grouping`. Property options are:

```ts
const compact = [
  { value: "tag", label: "Tag" },
  { value: "status", label: "Status" },
];
const full = [
  { value: "area", label: "Area" },
  { value: "project", label: "Project" },
  { value: "routine", label: "Routine" },
  { value: "tag", label: "Tag" },
  { value: "item_type", label: "Item type" },
  { value: "status", label: "Status" },
];
```

Yearly and Monthly use `compact`; Weekly and Daily use `full`. The sort submenu exposes exactly Manual, Alphabetical, and Reverse alphabetical. Back returns to settings. Close calls `onClose`.

- [ ] **Step 4: Add pointer and keyboard manual ordering**

Each Manual group row is `draggable`. Store the dragged key, and on drop create the reordered complete key array before calling `setPlannerManualGroupOrder`. Add icon buttons with `Move <label> up` and `Move <label> down` labels that call `moveManualGroup` and the same controller action. Hide drag and move controls for alphabetical modes.

- [ ] **Step 5: Integrate dropdown focus and dismissal**

Change `PlannerControlToolbar` so the Group branch passes its candidates and a close callback. Add `aria-expanded` and `aria-controls` to the toolbar trigger. Escape closes the group panel, and the existing trigger ref regains focus. Clicking outside follows the existing planner dropdown dismissal pattern; do not introduce a menu library.

- [ ] **Step 6: Add focused visual and interaction styles**

Add CSS classes for a 360-420px group dialog, row buttons, separators, native switch, visible/hidden group rows, focus outlines, disabled drag handles, and compact mobile width. Reuse existing colors, borders, radii, and spacing variables from `globals.css`; do not add design-token literals when an existing token matches.

- [ ] **Step 7: Run presentation tests, typecheck, and build**

Run: `cd frontend && npm test -- --run tests/presentation/workbench-wireframe.spec.tsx && npm run typecheck && npm run build`

Expected: presentation tests PASS, typecheck exits 0, and Next.js build completes successfully.

- [ ] **Step 8: Commit the panel**

```bash
git add frontend/src/features/workbench/ui/PlannerGroupPanel.tsx frontend/src/features/workbench/ui/MainPanel.tsx frontend/src/styles/globals.css frontend/tests/presentation/workbench-wireframe.spec.tsx
git commit -m "[UPDATE] Add Notion-style planner group panel" -m "- 네 Planner 뷰에 공통 그룹 설정 화면과 하위 선택 화면을 제공
- 그룹 숨김, 전체 토글, 수동 순서와 키보드 이동을 접근 가능하게 구현"
```

---

### Task 5: Full Regression and Documentation Sync

**Files:**
- Modify if required by verified behavior: `docs/superpowers/specs/2026-07-13-planner-notion-group-settings-design.md`
- Modify if user-visible control descriptions are stale: `docs/superpowers/specs/2026-07-07-planner-notion-controls-design.md`

**Interfaces:**
- Consumes: completed Tasks 1-4.
- Produces: a verified frontend and documentation that describes the implemented final state without implementation history.

- [ ] **Step 1: Run the complete frontend test suite**

Run: `cd frontend && npm run test`

Expected: all Vitest test files PASS with no unhandled errors.

- [ ] **Step 2: Run static and production gates**

Run: `cd frontend && npm run typecheck && npm run build`

Expected: TypeScript exits 0 and Next.js reports a successful production build.

- [ ] **Step 3: Inspect the final diff for scope and stale names**

Run:

```bash
git status --short
git diff --stat HEAD~4
rg -n "dailyGroupBy|yearlyGroupBy|monthlyGroupBy|weeklyGroupBy" frontend
rg -n "Group by uses one selected group key|Group Dropdown" docs/superpowers/specs
```

Expected: no old scalar group state remains in frontend code; the only changed files belong to group settings; any stale approved design statement is identified for correction.

- [ ] **Step 4: Synchronize final-state docs only when inspection finds drift**

If the second `rg` reports the old simple-menu contract, update `2026-07-07-planner-notion-controls-design.md` so its Group section points to the shared settings behavior: per-view property scope, three group sort modes, empty-group toggle, group visibility/manual order, and browser-local persistence. State the resulting behavior directly; do not add migration history or completion notes.

- [ ] **Step 5: Re-run the documentation and repository checks**

Run:

```bash
rg -n "dailyGroupBy|yearlyGroupBy|monthlyGroupBy|weeklyGroupBy" docs/superpowers frontend/src frontend/tests
git diff --check
```

Expected: no removed scalar names appear; `git diff --check` exits 0.

- [ ] **Step 6: Commit documentation sync if a doc changed**

```bash
git add docs/superpowers/specs/2026-07-07-planner-notion-controls-design.md docs/superpowers/specs/2026-07-13-planner-notion-group-settings-design.md
git commit -m "[DOCS] Sync planner grouping documentation" -m "- 구현된 그룹 설정 범위와 저장 및 정렬 동작을 최종 상태로 정리"
```

Skip this commit when neither document required a change.

- [ ] **Step 7: Verify final repository state**

Run: `git status --short && git log --oneline -n 8`

Expected: no unintended files remain; the group model, controller, view integration, panel, and optional docs appear as separate logical commits.
