# Planner Notion Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Notion-style planner filter, sort, and group controls across `Yearly`, `Monthly`, `Weekly`, and `Daily`.

**Architecture:** Keep the current frontend-only planner data flow. Extend pure planner model helpers first, then replace the visible select controls in `MainPanel.tsx` with icon dropdown panels that call the existing controller setters plus the smallest new planner setters needed for non-daily tabs.

**Tech Stack:** Next.js 14, React 18, TypeScript, `lucide-react`, Vitest, React Testing Library, CSS in `frontend/src/styles/globals.css`.

## Global Constraints

- Use existing loaded planner data and existing todo-engine APIs.
- Do not add new dependencies.
- Use `lucide-react` icons.
- Use native buttons, lists, and form controls.
- Preserve planner time structure when grouping.
- Filter categories combine with `AND`.
- Multiple values inside one category combine with `OR`.
- Direction controls are out of scope.
- Persisting planner view settings is out of scope.
- Keep unrelated dirty changes in `frontend/src/features/workbench/ui/MainPanel.tsx`, `frontend/src/styles/globals.css`, and `frontend/tests/presentation/workbench-wireframe.spec.tsx`.

---

## File Structure

- Modify `frontend/src/features/workbench/model/planner-model.ts`
  - Add shared sort/group option types for non-daily planner tabs.
  - Add pure helpers for sorting and grouping yearly/monthly/weekly item lists without changing fetch behavior.
- Modify `frontend/src/features/workbench/model/workbench-model.ts`
  - Extend `PlannerControls` with non-daily sort/group state and setter signatures.
- Modify `frontend/src/features/workbench/hooks/useWorkbenchController.ts`
  - Add default non-daily planner state and setter implementations.
- Modify `frontend/src/features/workbench/ui/MainPanel.tsx`
  - Replace always-visible planner selects with one shared icon toolbar and dropdown panels.
  - Keep current `DailyFilterSelect` behavior only as internal dropdown content or remove it after replacement.
- Modify `frontend/src/styles/globals.css`
  - Style the toolbar, icon buttons, active setting pills, dropdown panels, and mobile wrapping.
- Modify `frontend/tests/domain/planner-model.spec.ts`
  - Cover pure sort/group behavior.
- Modify `frontend/tests/presentation/workbench-wireframe.spec.tsx`
  - Cover visible toolbar controls and dropdown interactions.

---

### Task 1: Extend Planner Model State and Pure Helpers

**Files:**
- Modify: `frontend/src/features/workbench/model/planner-model.ts`
- Modify: `frontend/src/features/workbench/model/workbench-model.ts`
- Modify: `frontend/src/features/workbench/hooks/useWorkbenchController.ts`
- Test: `frontend/tests/domain/planner-model.spec.ts`

**Interfaces:**
- Consumes: `WorkspaceItemModel`, `WorkspaceItemsModel["relatedItems"]`.
- Produces:
  - `PlannerSortBy = "priority" | "scheduled" | "updated" | "title"`
  - `PlannerGroupBy = "none" | "area" | "project" | "routine" | "tag" | "item_type" | "status"`
  - `groupPlannerItems(items, relatedItems, groupBy): PlannerGroup[]`
  - `sortPlannerItems(items, sortBy): WorkspaceItemModel[]`
  - `PlannerControls.plannerSortBy`
  - `PlannerControls.plannerGroupBy`
  - `WorkbenchController.setPlannerSortBy(sortBy)`
  - `WorkbenchController.setPlannerGroupBy(groupBy)`

- [ ] **Step 1: Write failing pure model tests**

Add these tests to `frontend/tests/domain/planner-model.spec.ts`:

```ts
import {
  groupPlannerItems,
  sortPlannerItems,
} from "@/features/workbench/model/planner-model";
import type {
  WorkspaceItemModel,
  WorkspaceItemsModel,
} from "@/features/workbench/model/workbench-model";

const relatedItems: WorkspaceItemsModel["relatedItems"] = {
  areas: { "area-1": "Work" },
  goals: {},
  projects: { "project-1": "Launch" },
  routines: { "routine-1": "Morning" },
};

function item(
  id: string,
  patch: Partial<WorkspaceItemModel>,
): WorkspaceItemModel {
  return {
    id,
    title: id,
    type: "task",
    status: "active",
    ...patch,
  };
}

it("sorts planner items by scheduled with unscheduled first matching existing compare behavior", () => {
  const result = sortPlannerItems(
    [
      item("late", { scheduled: "2026-07-09T10:00:00", priority: 3 }),
      item("none", { scheduled: null, priority: 1 }),
      item("early", { scheduled: "2026-07-07T09:00:00", priority: 2 }),
    ],
    "scheduled",
  );

  expect(result.map((entry) => entry.id)).toEqual(["none", "early", "late"]);
});

it("groups planner items by tag and keeps untagged items visible", () => {
  const result = groupPlannerItems(
    [
      item("focus", { tags: ["focus"] }),
      item("ops", { tags: ["ops", "focus"] }),
      item("empty", { tags: [] }),
    ],
    relatedItems,
    "tag",
  );

  expect(result.map((group) => [group.label, group.items.map((entry) => entry.id)])).toEqual([
    ["focus", ["focus", "ops"]],
    ["ops", ["ops"]],
    ["Untagged", ["empty"]],
  ]);
});

it("groups planner items by related area labels", () => {
  const result = groupPlannerItems(
    [
      item("work", { area_id: "area-1" }),
      item("none", { area_id: null }),
    ],
    relatedItems,
    "area",
  );

  expect(result.map((group) => group.label)).toEqual(["Work", "No value"]);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
cd frontend
npm run test -- tests/domain/planner-model.spec.ts
```

Expected: FAIL because `groupPlannerItems` and `sortPlannerItems` are not exported.

- [ ] **Step 3: Implement minimal model exports**

In `frontend/src/features/workbench/model/planner-model.ts`, replace the sort/group type declarations with shared aliases and export the helpers:

```ts
export type PlannerGroupBy =
  | "none"
  | "area"
  | "project"
  | "routine"
  | "tag"
  | "item_type"
  | "status";

export type PlannerSortBy = "priority" | "scheduled" | "updated" | "title";

export type DailyGroupBy = PlannerGroupBy;
export type DailySortBy = PlannerSortBy;
```

Add these exports near the existing private sort/group helpers:

```ts
export function sortPlannerItems(
  items: WorkspaceItemModel[],
  sortBy: PlannerSortBy,
): WorkspaceItemModel[] {
  return [...items].sort((left, right) => compareDailyItems(left, right, sortBy));
}

export function groupPlannerItems(
  items: WorkspaceItemModel[],
  relatedItems: WorkspaceItemsModel["relatedItems"],
  groupBy: PlannerGroupBy,
): PlannerGroup[] {
  return groupItems(items, relatedItems, groupBy);
}
```

- [ ] **Step 4: Extend controller model types**

In `frontend/src/features/workbench/model/workbench-model.ts`, import the new aliases:

```ts
import type {
  DailyFilterState,
  DailyGroupBy,
  DailySortBy,
  PlannerGroupBy,
  PlannerSortBy,
} from "@/features/workbench/model/planner-model";
```

Extend `PlannerControls`:

```ts
export type PlannerControls = {
  date: string;
  weekStart: string;
  dailyFilters: DailyFilterState;
  dailyGroupBy: DailyGroupBy;
  dailySortBy: DailySortBy;
  plannerGroupBy: PlannerGroupBy;
  plannerSortBy: PlannerSortBy;
};
```

Extend `WorkbenchController`:

```ts
  setPlannerGroupBy: (groupBy: PlannerGroupBy) => void;
  setPlannerSortBy: (sortBy: PlannerSortBy) => void;
```

- [ ] **Step 5: Extend controller defaults and setters**

In `frontend/src/features/workbench/hooks/useWorkbenchController.ts`, update `createDefaultPlanner()`:

```ts
    dailyGroupBy: "none",
    dailySortBy: "priority",
    plannerGroupBy: "none",
    plannerSortBy: "scheduled",
```

Add returned controller setters after the existing daily setters:

```ts
    setPlannerGroupBy: (groupBy) =>
      setPlanner((current) => ({ ...current, plannerGroupBy: groupBy })),
    setPlannerSortBy: (sortBy) =>
      setPlanner((current) => ({ ...current, plannerSortBy: sortBy })),
```

- [ ] **Step 6: Run tests and typecheck**

Run:

```bash
cd frontend
npm run test -- tests/domain/planner-model.spec.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

Stage only Task 1 files:

```bash
git add frontend/src/features/workbench/model/planner-model.ts frontend/src/features/workbench/model/workbench-model.ts frontend/src/features/workbench/hooks/useWorkbenchController.ts frontend/tests/domain/planner-model.spec.ts
git diff --cached --stat
git commit -m "$(cat <<'EOF'
[UPDATE] Extend planner view model controls

- Planner 공통 정렬과 그룹 상태를 프론트엔드 모델에 추가
- 기존 Daily 정렬과 그룹 로직을 재사용 가능한 순수 헬퍼로 노출
EOF
)"
```

---

### Task 2: Add Shared Planner Toolbar UI

**Files:**
- Modify: `frontend/src/features/workbench/ui/MainPanel.tsx`
- Modify: `frontend/src/styles/globals.css`
- Test: `frontend/tests/presentation/workbench-wireframe.spec.tsx`

**Interfaces:**
- Consumes: `WorkbenchController`, `DailyFilterOption`, `filterValuesByOptions`.
- Produces:
  - `PlannerControlToolbar`
  - `PlannerDropdownButton`
  - `PlannerControlDropdown`
  - accessible buttons named `Filter planner view`, `Sort planner view`, and `Group planner view`.

- [ ] **Step 1: Write failing presentation test for all tabs**

Add this test near existing planner presentation tests in `frontend/tests/presentation/workbench-wireframe.spec.tsx`:

```tsx
it("renders shared planner view controls on every planner tab", async () => {
  const user = userEvent.setup();
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: async () => [],
      }),
    ),
  );

  render(<WorkbenchPageClient />);

  await user.click(screen.getByRole("button", { name: "ToDo" }));
  await user.click(screen.getByRole("button", { name: "Planner" }));

  for (const tab of ["Yearly", "Monthly", "Weekly", "Daily"]) {
    if (tab !== "Yearly") {
      await user.click(screen.getByRole("button", { name: tab }));
    }

    expect(screen.getByRole("button", { name: "Filter planner view" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sort planner view" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Group planner view" })).toBeInTheDocument();
  }
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
cd frontend
npm run test -- tests/presentation/workbench-wireframe.spec.tsx -t "renders shared planner view controls"
```

Expected: FAIL because the icon controls do not exist.

- [ ] **Step 3: Add toolbar state and icon imports**

In `frontend/src/features/workbench/ui/MainPanel.tsx`, extend the `lucide-react` import without removing existing dirty-work imports:

```ts
import {
  ArrowDownUp,
  ArrowLeft,
  Filter,
  Group,
  Plus,
  Trash2,
  X,
} from "lucide-react";
```

Add this type near `MainPanelProps`:

```ts
type PlannerDropdownKind = "filter" | "sort" | "group";
```

- [ ] **Step 4: Replace planner toolbar content with shared toolbar**

In `PlannerPanel`, replace the current `plannerTagOptions` and toolbar block with:

```tsx
  const filterOptions = buildPlannerFilterOptions(controller);
  const effectiveFilters =
    panel.id === "daily"
      ? effectiveDailyFilters(controller.planner.dailyFilters, filterOptions.daily)
      : {
          ...controller.planner.dailyFilters,
          tags: filterValuesByOptions(
            controller.planner.dailyFilters.tags,
            filterOptions.tags,
          ),
        };

  return (
    <section
      className="items-section planner-panel"
      aria-label={`${panel.title} planner`}
    >
      <PlannerControlToolbar
        controller={controller}
        filterOptions={filterOptions}
        effectiveFilters={effectiveFilters}
      />
```

Keep the existing planner body below the toolbar unchanged.

- [ ] **Step 5: Add toolbar components**

Add these components below `DailyPlanner`:

```tsx
function PlannerControlToolbar({
  controller,
  filterOptions,
  effectiveFilters,
}: {
  controller: WorkbenchController;
  filterOptions: PlannerFilterOptions;
  effectiveFilters: WorkbenchController["planner"]["dailyFilters"];
}) {
  const [openDropdown, setOpenDropdown] =
    React.useState<PlannerDropdownKind | null>(null);
  const activeFilterCount = plannerFilterRuleCount(controller.panel.id, effectiveFilters);
  const sortBy = plannerSortValue(controller);
  const groupBy = plannerGroupValue(controller);

  function toggleDropdown(kind: PlannerDropdownKind) {
    setOpenDropdown((current) => (current === kind ? null : kind));
  }

  return (
    <div className="planner-view-controls">
      <div className="planner-view-control-bar">
        <div className="planner-view-pill">{controller.panel.title}</div>
        <div className="planner-view-actions">
          <PlannerDropdownButton
            active={activeFilterCount > 0}
            ariaLabel="Filter planner view"
            title="Filter"
            onClick={() => toggleDropdown("filter")}
          >
            <Filter size={16} aria-hidden="true" />
          </PlannerDropdownButton>
          <PlannerDropdownButton
            active={sortBy !== defaultPlannerSortValue(controller)}
            ariaLabel="Sort planner view"
            title="Sort"
            onClick={() => toggleDropdown("sort")}
          >
            <ArrowDownUp size={16} aria-hidden="true" />
          </PlannerDropdownButton>
          <PlannerDropdownButton
            active={groupBy !== "none"}
            ariaLabel="Group planner view"
            title="Group by"
            onClick={() => toggleDropdown("group")}
          >
            <Group size={16} aria-hidden="true" />
          </PlannerDropdownButton>
          <button
            className="items-toolbar-button"
            type="button"
            aria-label="Add planner item"
            onClick={controller.openCreationDialog}
          >
            <Plus size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
      <PlannerActiveControlPills
        filterCount={activeFilterCount}
        sortBy={sortBy}
        groupBy={groupBy}
      />
      {openDropdown === "filter" ? (
        <PlannerControlDropdown title="Filter">
          <PlannerFilterRulePanel
            controller={controller}
            filterOptions={filterOptions}
            effectiveFilters={effectiveFilters}
          />
        </PlannerControlDropdown>
      ) : null}
      {openDropdown === "sort" ? (
        <PlannerControlDropdown title="Sort">
          <PlannerSortPanel controller={controller} />
        </PlannerControlDropdown>
      ) : null}
      {openDropdown === "group" ? (
        <PlannerControlDropdown title="Group by">
          <PlannerGroupPanel controller={controller} />
        </PlannerControlDropdown>
      ) : null}
    </div>
  );
}

function PlannerDropdownButton({
  active,
  ariaLabel,
  title,
  onClick,
  children,
}: {
  active: boolean;
  ariaLabel: string;
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      className="planner-view-icon-button"
      type="button"
      aria-label={ariaLabel}
      title={title}
      data-active={active}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function PlannerControlDropdown({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="planner-control-dropdown" role="dialog" aria-label={title}>
      <div className="planner-control-dropdown-title">{title}</div>
      {children}
    </div>
  );
}
```

- [ ] **Step 6: Add active pill component and helpers**

Add below the toolbar components:

```tsx
function PlannerActiveControlPills({
  filterCount,
  sortBy,
  groupBy,
}: {
  filterCount: number;
  sortBy: string;
  groupBy: string;
}) {
  if (filterCount === 0 && groupBy === "none") {
    return null;
  }

  return (
    <div className="planner-active-control-row" aria-label="Active planner controls">
      {filterCount > 0 ? (
        <span className="planner-active-pill">{filterCount} rules</span>
      ) : null}
      {groupBy !== "none" ? (
        <span className="planner-active-pill">Grouped by {plannerControlLabel(groupBy)}</span>
      ) : null}
    </div>
  );
}

function plannerControlLabel(value: string): string {
  return value.replaceAll("_", " ");
}
```

Use `sortBy` in this component in Task 4 when sort UI is wired.

- [ ] **Step 7: Add minimal CSS**

Append near existing planner CSS in `frontend/src/styles/globals.css`:

```css
.planner-view-controls {
  position: relative;
  display: grid;
  gap: 8px;
}

.planner-view-control-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  border-bottom: 1px solid var(--color-hairline-light);
  padding-bottom: 8px;
}

.planner-view-pill,
.planner-active-pill {
  display: inline-flex;
  min-height: 28px;
  align-items: center;
  border-radius: var(--radius-pill);
  background: var(--color-canvas-cream);
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 700;
}

.planner-view-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px;
}

.planner-view-icon-button {
  display: inline-flex;
  width: 32px;
  height: 32px;
  align-items: center;
  justify-content: center;
  border: 1px solid transparent;
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--color-shade-60);
}

.planner-view-icon-button:hover,
.planner-view-icon-button[data-active="true"] {
  border-color: var(--color-blue-strong, #2383e2);
  background: var(--color-canvas-cream);
  color: var(--color-blue-strong, #2383e2);
}

.planner-active-control-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.planner-control-dropdown {
  width: min(360px, 100%);
  border: 1px solid var(--color-hairline-light);
  border-radius: var(--radius-xs);
  background: var(--color-canvas-light);
  padding: 10px;
  box-shadow: 0 12px 30px rgb(0 0 0 / 12%);
}

.planner-control-dropdown-title {
  margin-bottom: 8px;
  color: var(--color-shade-60);
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
}
```

- [ ] **Step 8: Run targeted test**

Run:

```bash
cd frontend
npm run test -- tests/presentation/workbench-wireframe.spec.tsx -t "renders shared planner view controls"
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/features/workbench/ui/MainPanel.tsx frontend/src/styles/globals.css frontend/tests/presentation/workbench-wireframe.spec.tsx
git diff --cached --stat
git commit -m "$(cat <<'EOF'
[UPDATE] Add planner icon control toolbar

- Planner 탭 공통 필터, 정렬, 그룹 아이콘 버튼을 추가
- 활성 설정 pill과 드롭다운 컨테이너 스타일을 추가
EOF
)"
```

---

### Task 3: Implement Rule-Builder Filter Dropdown

**Files:**
- Modify: `frontend/src/features/workbench/ui/MainPanel.tsx`
- Modify: `frontend/src/styles/globals.css`
- Test: `frontend/tests/presentation/workbench-wireframe.spec.tsx`

**Interfaces:**
- Consumes:
  - `controller.setDailyFilter(field, values)`
  - `buildDailyFilterOptions(controller)`
  - `filterValuesByOptions(values, options)`
- Produces:
  - `PlannerFilterRulePanel`
  - `PlannerFilterOptions`
  - visible rule remove buttons named `Remove <label> filter`

- [ ] **Step 1: Write failing filter interaction test**

Add this test near the existing daily planner filter test:

```tsx
it("filters daily planner items through the rule builder dropdown", async () => {
  const user = userEvent.setup();
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) =>
      Promise.resolve({
        ok: true,
        json: async () =>
          url === "/todo-engine/items?type=task"
            ? [
                {
                  id: "task-1",
                  type: "task",
                  title: "Focus Task",
                  status: "active",
                  tags: ["focus"],
                  area_id: "area-1",
                  scheduled: testToday(),
                },
                {
                  id: "task-2",
                  type: "task",
                  title: "Ops Task",
                  status: "active",
                  tags: ["ops"],
                  area_id: "area-2",
                  scheduled: testToday(),
                },
              ]
            : url === "/todo-engine/items?type=area"
              ? [
                  { id: "area-1", type: "area", title: "Work", status: "active" },
                  { id: "area-2", type: "area", title: "Ops", status: "active" },
                ]
              : [],
      }),
    ),
  );

  render(<WorkbenchPageClient />);

  await user.click(screen.getByRole("button", { name: "ToDo" }));
  await user.click(screen.getByRole("button", { name: "Planner" }));
  await user.click(screen.getByRole("button", { name: "Daily" }));

  await screen.findByText("Focus Task");
  await user.click(screen.getByRole("button", { name: "Filter planner view" }));
  await user.selectOptions(screen.getByLabelText("Filter by Tags"), "focus");

  expect(screen.getByText("Focus Task")).toBeInTheDocument();
  expect(screen.queryByText("Ops Task")).toBeNull();
  expect(screen.getByText("1 rules")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Remove Tags filter" }));

  expect(screen.getByText("Focus Task")).toBeInTheDocument();
  expect(screen.getByText("Ops Task")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
cd frontend
npm run test -- tests/presentation/workbench-wireframe.spec.tsx -t "filters daily planner items through the rule builder dropdown"
```

Expected: FAIL because `Filter by Tags` and remove-rule buttons do not exist.

- [ ] **Step 3: Add filter option types and builder**

In `MainPanel.tsx`, add near `DailyFilterOption`:

```ts
type PlannerFilterOptions = {
  tags: DailyFilterOption[];
  daily: ReturnType<typeof buildDailyFilterOptions>;
};
```

Add helper:

```ts
function buildPlannerFilterOptions(
  controller: WorkbenchController,
): PlannerFilterOptions {
  if (controller.panel.id === "daily") {
    const daily = buildDailyFilterOptions(controller);
    return { tags: daily.tags, daily };
  }

  const tags = buildPlannerTagFilterOptions(
    controller.panel.id,
    controller.workspaceItems.items,
    controller.planner,
  );
  return {
    tags,
    daily: {
      tags,
      areas: [],
      projects: [],
      routines: [],
      itemTypes: [],
      statuses: [],
    },
  };
}
```

- [ ] **Step 4: Add rule panel component**

Add below `PlannerControlDropdown`:

```tsx
function PlannerFilterRulePanel({
  controller,
  filterOptions,
  effectiveFilters,
}: {
  controller: WorkbenchController;
  filterOptions: PlannerFilterOptions;
  effectiveFilters: WorkbenchController["planner"]["dailyFilters"];
}) {
  const rules = plannerFilterRules(controller.panel.id, filterOptions, effectiveFilters);

  return (
    <div className="planner-filter-rule-panel">
      {rules.map((rule) => (
        <div className="planner-filter-rule" key={rule.field}>
          <span>{rule.label}</span>
          <span>{rule.operator}</span>
          <DailyFilterSelect
            label={`Filter by ${rule.label}`}
            displayLabel={rule.label}
            options={rule.options}
            value={rule.value}
            onChange={(values) => controller.setDailyFilter(rule.field, values)}
          />
          <button
            type="button"
            aria-label={`Remove ${rule.label} filter`}
            onClick={() => controller.setDailyFilter(rule.field, [])}
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Add rule helper**

Add below filter option helpers:

```ts
type PlannerFilterRule = {
  field: keyof WorkbenchController["planner"]["dailyFilters"];
  label: string;
  operator: string;
  options: DailyFilterOption[];
  value: string[];
};

function plannerFilterRules(
  panelId: WorkbenchController["panel"]["id"],
  filterOptions: PlannerFilterOptions,
  filters: WorkbenchController["planner"]["dailyFilters"],
): PlannerFilterRule[] {
  const rules: PlannerFilterRule[] = [
    {
      field: "tags",
      label: "Tags",
      operator: "contains",
      options: filterOptions.tags,
      value: filters.tags,
    },
  ];

  if (panelId !== "daily") {
    return rules;
  }

  return [
    ...rules,
    {
      field: "areaIds",
      label: "Area",
      operator: "is",
      options: filterOptions.daily.areas,
      value: filters.areaIds,
    },
    {
      field: "projectIds",
      label: "Project",
      operator: "is",
      options: filterOptions.daily.projects,
      value: filters.projectIds,
    },
    {
      field: "routineIds",
      label: "Routine",
      operator: "is",
      options: filterOptions.daily.routines,
      value: filters.routineIds,
    },
    {
      field: "itemTypes",
      label: "Item type",
      operator: "is",
      options: filterOptions.daily.itemTypes,
      value: filters.itemTypes,
    },
    {
      field: "statuses",
      label: "Status",
      operator: "is",
      options: filterOptions.daily.statuses,
      value: filters.statuses,
    },
  ];
}

function plannerFilterRuleCount(
  panelId: WorkbenchController["panel"]["id"],
  filters: WorkbenchController["planner"]["dailyFilters"],
): number {
  if (panelId !== "daily") {
    return filters.tags.length > 0 ? 1 : 0;
  }

  return [
    filters.tags,
    filters.areaIds,
    filters.projectIds,
    filters.routineIds,
    filters.itemTypes,
    filters.statuses,
  ].filter((values) => values.length > 0).length;
}
```

- [ ] **Step 6: Remove old visible daily filter row**

In `DailyPlanner`, delete the first `.planner-control-row` that renders six `DailyFilterSelect` controls. Keep `filterOptions`, `filters`, and `model` creation.

- [ ] **Step 7: Style rule rows**

Add to `globals.css`:

```css
.planner-filter-rule-panel {
  display: grid;
  gap: 8px;
}

.planner-filter-rule {
  display: grid;
  grid-template-columns: 82px 70px minmax(0, 1fr) 28px;
  gap: 6px;
  align-items: end;
}

.planner-filter-rule > span {
  min-height: 32px;
  display: inline-flex;
  align-items: center;
  color: var(--color-shade-60);
  font-size: 12px;
  font-weight: 700;
}

.planner-filter-rule button {
  width: 28px;
  height: 32px;
  border: 1px solid var(--color-hairline-light);
  border-radius: var(--radius-xs);
  background: var(--color-canvas-cream);
}
```

- [ ] **Step 8: Run targeted tests**

Run:

```bash
cd frontend
npm run test -- tests/presentation/workbench-wireframe.spec.tsx -t "filters daily planner items through the rule builder dropdown"
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/features/workbench/ui/MainPanel.tsx frontend/src/styles/globals.css frontend/tests/presentation/workbench-wireframe.spec.tsx
git diff --cached --stat
git commit -m "$(cat <<'EOF'
[UPDATE] Move planner filters into rule dropdown

- Planner 필터를 공통 rule builder 드롭다운으로 이동
- Daily 필터와 비일간 태그 필터가 기존 AND/OR 규칙을 유지하도록 연결
EOF
)"
```

---

### Task 4: Wire Sort and Group Dropdowns Across Planner Tabs

**Files:**
- Modify: `frontend/src/features/workbench/ui/MainPanel.tsx`
- Modify: `frontend/src/styles/globals.css`
- Test: `frontend/tests/presentation/workbench-wireframe.spec.tsx`

**Interfaces:**
- Consumes:
  - `controller.setDailyGroupBy`
  - `controller.setDailySortBy`
  - `controller.setPlannerGroupBy`
  - `controller.setPlannerSortBy`
  - `groupPlannerItems`
  - `sortPlannerItems`
- Produces:
  - `PlannerSortPanel`
  - `PlannerGroupPanel`
  - `plannerSortValue(controller)`
  - `plannerGroupValue(controller)`

- [ ] **Step 1: Write failing sort/group interaction test**

Add:

```tsx
it("sorts and groups daily planner items from dropdown controls", async () => {
  const user = userEvent.setup();
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) =>
      Promise.resolve({
        ok: true,
        json: async () =>
          url === "/todo-engine/items?type=task"
            ? [
                {
                  id: "task-b",
                  type: "task",
                  title: "B Task",
                  status: "active",
                  tags: ["ops"],
                  priority: 2,
                  scheduled: testToday(),
                },
                {
                  id: "task-a",
                  type: "task",
                  title: "A Task",
                  status: "active",
                  tags: ["focus"],
                  priority: 1,
                  scheduled: testToday(),
                },
              ]
            : [],
      }),
    ),
  );

  render(<WorkbenchPageClient />);

  await user.click(screen.getByRole("button", { name: "ToDo" }));
  await user.click(screen.getByRole("button", { name: "Planner" }));
  await user.click(screen.getByRole("button", { name: "Daily" }));
  await screen.findByText("A Task");

  await user.click(screen.getByRole("button", { name: "Sort planner view" }));
  await user.click(screen.getByRole("button", { name: "Title" }));

  const today = screen.getByLabelText("Today");
  expect(within(today).getAllByRole("button").map((button) => button.textContent)).toEqual([
    "A Task",
    "B Task",
  ]);

  await user.click(screen.getByRole("button", { name: "Group planner view" }));
  await user.click(screen.getByRole("button", { name: "Tag" }));

  expect(within(today).getByRole("heading", { name: "focus" })).toBeInTheDocument();
  expect(within(today).getByRole("heading", { name: "ops" })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
cd frontend
npm run test -- tests/presentation/workbench-wireframe.spec.tsx -t "sorts and groups daily planner items from dropdown controls"
```

Expected: FAIL because sort/group dropdown buttons have no option panels.

- [ ] **Step 3: Import model helpers**

In `MainPanel.tsx`, extend imports from `planner-model`:

```ts
  groupPlannerItems,
  sortPlannerItems,
  type PlannerGroupBy,
  type PlannerSortBy,
```

- [ ] **Step 4: Add sort/group panel components**

Add below `PlannerFilterRulePanel`:

```tsx
function PlannerSortPanel({ controller }: { controller: WorkbenchController }) {
  const value = plannerSortValue(controller);

  return (
    <div className="planner-menu-option-list">
      {plannerSortOptions(controller.panel.id).map((option) => (
        <button
          type="button"
          key={option.value}
          aria-pressed={option.value === value}
          onClick={() => setPlannerSortValue(controller, option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function PlannerGroupPanel({ controller }: { controller: WorkbenchController }) {
  const value = plannerGroupValue(controller);

  return (
    <div className="planner-menu-option-list">
      {plannerGroupOptions(controller.panel.id).map((option) => (
        <button
          type="button"
          key={option.value}
          aria-pressed={option.value === value}
          onClick={() => setPlannerGroupValue(controller, option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Add sort/group helpers**

Add near planner helper functions:

```ts
function plannerSortValue(controller: WorkbenchController): PlannerSortBy {
  return controller.panel.id === "daily"
    ? controller.planner.dailySortBy
    : controller.planner.plannerSortBy;
}

function defaultPlannerSortValue(controller: WorkbenchController): PlannerSortBy {
  return controller.panel.id === "daily" ? "priority" : "scheduled";
}

function setPlannerSortValue(
  controller: WorkbenchController,
  value: PlannerSortBy,
) {
  if (controller.panel.id === "daily") {
    controller.setDailySortBy(value);
    return;
  }
  controller.setPlannerSortBy(value);
}

function plannerGroupValue(controller: WorkbenchController): PlannerGroupBy {
  return controller.panel.id === "daily"
    ? controller.planner.dailyGroupBy
    : controller.planner.plannerGroupBy;
}

function setPlannerGroupValue(
  controller: WorkbenchController,
  value: PlannerGroupBy,
) {
  if (controller.panel.id === "daily") {
    controller.setDailyGroupBy(value);
    return;
  }
  controller.setPlannerGroupBy(value);
}

function plannerSortOptions(
  panelId: WorkbenchController["panel"]["id"],
): { value: PlannerSortBy; label: string }[] {
  return panelId === "daily"
    ? [
        { value: "priority", label: "Priority" },
        { value: "scheduled", label: "Scheduled" },
        { value: "updated", label: "Updated" },
        { value: "title", label: "Title" },
      ]
    : [
        { value: "scheduled", label: "Scheduled" },
        { value: "priority", label: "Priority" },
        { value: "updated", label: "Updated" },
        { value: "title", label: "Title" },
      ];
}

function plannerGroupOptions(
  panelId: WorkbenchController["panel"]["id"],
): { value: PlannerGroupBy; label: string }[] {
  if (panelId === "yearly" || panelId === "monthly") {
    return [
      { value: "none", label: "None" },
      { value: "tag", label: "Tag" },
      { value: "status", label: "Status" },
    ];
  }

  return [
    { value: "none", label: "None" },
    { value: "area", label: "Area" },
    { value: "project", label: "Project" },
    { value: "routine", label: "Routine" },
    { value: "tag", label: "Tag" },
    { value: "item_type", label: "Item type" },
    { value: "status", label: "Status" },
  ];
}
```

- [ ] **Step 6: Remove old daily sort/group select row**

In `DailyPlanner`, delete the second `.planner-control-row` containing `Group by` and `Sort by` native selects.

- [ ] **Step 7: Apply non-daily sort/group in planner views**

In `GoalPlannerList`, replace the `goals` constant with:

```tsx
  const visibleGoals = filterPlannerItemsByTags(
    controller.workspaceItems.items,
    tags,
  ).filter(
    (item) =>
      item.type === "goal" &&
      !isTerminalPlannerItem(item) &&
      item.horizon === horizon &&
      goalMatchesPlannerPeriod(item, horizon, controller.planner.date),
  );
  const goals = groupPlannerItems(
    sortPlannerItems(visibleGoals, controller.planner.plannerSortBy),
    controller.workspaceItems.relatedItems,
    controller.planner.plannerGroupBy,
  );
```

Then render grouped goals:

```tsx
      {goals.length === 0 ? (
        <p className="items-message">No goals found.</p>
      ) : (
        goals.map((group) => (
          <div className="planner-card-list" key={group.key}>
            {group.label !== "All" ? <h3>{group.label}</h3> : null}
            <ul className="planner-card-list">
              {group.items.map((item) => (
                <li key={item.id}>
                  <button
                    className="planner-item"
                    type="button"
                    onClick={() => controller.openDetailView(item)}
                  >
                    {item.title}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
```

In `WeeklyPlanner`, sort each `model.days` item list before rendering:

```tsx
const sortedDayItems = sortPlannerItems(day.items, controller.planner.plannerSortBy);
const dayGroups = groupPlannerItems(
  sortedDayItems,
  controller.workspaceItems.relatedItems,
  controller.planner.plannerGroupBy,
);
```

Render `dayGroups` with the same `PlannerGroup` loop used by `DailyPlannerSectionView`.

- [ ] **Step 8: Add menu option CSS**

Add:

```css
.planner-menu-option-list {
  display: grid;
  gap: 4px;
}

.planner-menu-option-list button {
  min-height: 32px;
  border: 0;
  border-radius: var(--radius-xs);
  background: transparent;
  padding: 6px 8px;
  color: inherit;
  text-align: left;
}

.planner-menu-option-list button:hover,
.planner-menu-option-list button[aria-pressed="true"] {
  background: var(--color-canvas-cream);
}
```

- [ ] **Step 9: Run tests**

Run:

```bash
cd frontend
npm run test -- tests/presentation/workbench-wireframe.spec.tsx -t "sorts and groups daily planner items from dropdown controls"
npm run typecheck
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/features/workbench/ui/MainPanel.tsx frontend/src/styles/globals.css frontend/tests/presentation/workbench-wireframe.spec.tsx
git diff --cached --stat
git commit -m "$(cat <<'EOF'
[UPDATE] Wire planner sort and group dropdowns

- Daily 정렬과 그룹 select를 드롭다운 메뉴로 교체
- Yearly, Monthly, Weekly에도 기존 시간 구조를 유지하는 정렬과 그룹을 연결
EOF
)"
```

---

### Task 5: Final Verification and Polish

**Files:**
- Modify only if checks reveal a defect:
  - `frontend/src/features/workbench/ui/MainPanel.tsx`
  - `frontend/src/styles/globals.css`
  - `frontend/tests/presentation/workbench-wireframe.spec.tsx`
  - `frontend/tests/domain/planner-model.spec.ts`

**Interfaces:**
- Consumes: All components and helpers from Tasks 1-4.
- Produces: Passing frontend verification and no accidental unrelated staged changes.

- [ ] **Step 1: Run full frontend checks**

Run:

```bash
cd frontend
npm run test
npm run typecheck
npm run build
```

Expected: all commands pass.

- [ ] **Step 2: Inspect planner UI manually**

Run the dev server:

```bash
cd frontend
npm run dev
```

Open the app and verify:

- `Yearly`, `Monthly`, `Weekly`, and `Daily` show Filter, Sort, Group by icon buttons.
- Filter dropdown shows rule rows.
- Sort dropdown shows one selected sort option.
- Group dropdown shows one selected group option.
- Daily keeps `Today`, `Overdue`, `Upcoming`, and `Unscheduled` as top-level sections.
- Weekly keeps day cards.
- Text does not overlap at mobile width.

- [ ] **Step 3: Stop the dev server**

Stop `npm run dev` with `Ctrl-C`. Do not leave the dev server running.

- [ ] **Step 4: Inspect git state**

Run:

```bash
git status --short
git diff --stat
git diff --cached --stat
```

Expected:

- No accidental `.superpowers/` files are tracked.
- Existing unrelated dirty files are either incorporated because they were part of the implementation or intentionally left unstaged.
- Staged changes are empty before the final commit.

- [ ] **Step 5: Commit any final polish**

Only if Step 1 or Step 2 required small fixes:

```bash
git add frontend/src/features/workbench/ui/MainPanel.tsx frontend/src/styles/globals.css frontend/tests/presentation/workbench-wireframe.spec.tsx frontend/tests/domain/planner-model.spec.ts
git diff --cached --stat
git commit -m "$(cat <<'EOF'
[FIX] Polish planner Notion controls

- 최종 검증에서 발견한 Planner 컨트롤 표시와 접근성 문제를 정리
EOF
)"
```

Skip this commit when no final fixes were needed.

---

## Self-Review

- Spec coverage: toolbar, rule-builder filter, sort dropdown, group dropdown, time-structure preservation, no new dependencies, and verification commands are covered.
- Placeholder scan: no red-flag placeholder text or unspecified implementation steps are intentionally left.
- Type consistency: `PlannerSortBy`, `PlannerGroupBy`, `plannerSortBy`, and `plannerGroupBy` are introduced in Task 1 and consumed by later tasks with the same names.
