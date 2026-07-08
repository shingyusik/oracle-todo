# Planner Advanced Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Planner-only Notion-style advanced filter builder with typed column rules and global And/Or matching.

**Architecture:** Add a Planner filter rule model in `planner-model.ts`, store rules in `PlannerControls`, and replace the current filter dropdown body in `MainPanel.tsx`. Existing Sort and Group code stays in place.

**Tech Stack:** React 18, Next.js 14, TypeScript, Vitest, Testing Library, existing CSS in `frontend/src/styles/globals.css`.

## Global Constraints

- Apply only to Planner views: Yearly, Monthly, Weekly, Daily.
- Do not apply this filter system to Workspace tables.
- Do not add dependencies.
- Keep Sort and Group controls unchanged.
- Use native inputs and existing local helpers before adding abstractions.

---

## File Structure

- Modify `frontend/src/features/workbench/model/planner-model.ts`
  - Owns filter rule types and matching logic.
- Modify `frontend/src/features/workbench/model/workbench-model.ts`
  - Adds Planner filter state and controller methods.
- Modify `frontend/src/features/workbench/hooks/useWorkbenchController.ts`
  - Initializes and updates Planner filter state.
- Modify `frontend/src/features/workbench/ui/MainPanel.tsx`
  - Renders field picker, rule rows, type-specific value editors, And/Or control, clear action.
- Modify `frontend/src/styles/globals.css`
  - Styles the advanced filter dropdown without changing Sort/Group.
- Modify `frontend/tests/domain/planner-model.spec.ts`
  - Covers operator semantics and And/Or behavior.
- Modify `frontend/tests/presentation/workbench-wireframe.spec.tsx`
  - Covers adding text/date/multi-select rules and clearing filters.

---

### Task 1: Planner Filter Model

**Files:**
- Modify: `frontend/src/features/workbench/model/planner-model.ts`
- Test: `frontend/tests/domain/planner-model.spec.ts`

**Interfaces:**
- Produces:
  - `PlannerFilterMode = "and" | "or"`
  - `PlannerFilterField`
  - `PlannerFilterOperator`
  - `PlannerFilterRule`
  - `PlannerFilterValue`
  - `matchesPlannerFilterRules(item, relatedItems, rules, mode, today): boolean`
- Consumes:
  - Existing `WorkspaceItemModel`
  - Existing `WorkspaceItemsModel["relatedItems"]`

- [ ] **Step 1: Add failing model tests**

Append tests to `frontend/tests/domain/planner-model.spec.ts`:

```ts
import {
  matchesPlannerFilterRules,
  type PlannerFilterRule,
} from "@/features/workbench/model/planner-model";

const relatedItems = {
  areas: { "area-1": "Work" },
  goals: {},
  projects: { "project-1": "Planner" },
  routines: { "routine-1": "Morning" },
};

it("matches text, multi-select, and relation planner filter rules with and", () => {
  const rules: PlannerFilterRule[] = [
    { id: "r1", field: "title", type: "text", operator: "contains", value: "plan" },
    { id: "r2", field: "tags", type: "multiSelect", operator: "contains", value: ["focus"] },
    { id: "r3", field: "area", type: "relation", operator: "contains", value: ["area-1"] },
  ];

  expect(
    matchesPlannerFilterRules(
      {
        id: "task-1",
        title: "Plan filter UI",
        type: "task",
        status: "active",
        tags: ["focus"],
        area_id: "area-1",
      },
      relatedItems,
      rules,
      "and",
      "2026-07-08",
    ),
  ).toBe(true);
});

it("matches at least one planner filter rule with or", () => {
  const rules: PlannerFilterRule[] = [
    { id: "r1", field: "title", type: "text", operator: "contains", value: "missing" },
    { id: "r2", field: "status", type: "select", operator: "contains", value: ["active"] },
  ];

  expect(
    matchesPlannerFilterRules(
      { id: "task-1", title: "Plan", type: "task", status: "active" },
      relatedItems,
      rules,
      "or",
      "2026-07-08",
    ),
  ).toBe(true);
});

it("matches date and empty planner filter operators", () => {
  const rules: PlannerFilterRule[] = [
    {
      id: "r1",
      field: "scheduled",
      type: "date",
      operator: "is_between",
      value: { start: "2026-07-01", end: "2026-07-31" },
    },
    { id: "r2", field: "due", type: "date", operator: "is_empty", value: null },
  ];

  expect(
    matchesPlannerFilterRules(
      {
        id: "task-1",
        title: "Plan",
        type: "task",
        status: "active",
        scheduled: "2026-07-08",
        due: null,
      },
      relatedItems,
      rules,
      "and",
      "2026-07-08",
    ),
  ).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd frontend && npm run test -- tests/domain/planner-model.spec.ts
```

Expected: FAIL because `matchesPlannerFilterRules` and filter types are not exported.

- [ ] **Step 3: Add filter types and matcher**

Add to `frontend/src/features/workbench/model/planner-model.ts`:

```ts
export type PlannerFilterMode = "and" | "or";
export type PlannerFilterField =
  | "title"
  | "scheduled"
  | "due"
  | "tags"
  | "area"
  | "project"
  | "routine"
  | "item_type"
  | "status"
  | "priority"
  | "horizon";
export type PlannerFilterType =
  | "text"
  | "date"
  | "number"
  | "select"
  | "multiSelect"
  | "relation";
export type PlannerFilterOperator =
  | "is"
  | "is_not"
  | "contains"
  | "does_not_contain"
  | "starts_with"
  | "ends_with"
  | "is_before"
  | "is_after"
  | "is_on_or_before"
  | "is_on_or_after"
  | "is_between"
  | "is_relative_to_today"
  | "greater_than"
  | "less_than"
  | "is_empty"
  | "is_not_empty";
export type PlannerFilterValue =
  | string
  | string[]
  | { start: string; end: string }
  | { amount: string; unit: "day" | "week" | "month" }
  | null;
export type PlannerFilterRule = {
  id: string;
  field: PlannerFilterField;
  type: PlannerFilterType;
  operator: PlannerFilterOperator;
  value: PlannerFilterValue;
};
```

Then add `matchesPlannerFilterRules()` using these rules:

```ts
export function matchesPlannerFilterRules(
  item: WorkspaceItemModel,
  relatedItems: WorkspaceItemsModel["relatedItems"],
  rules: PlannerFilterRule[],
  mode: PlannerFilterMode,
  today: string,
): boolean {
  if (rules.length === 0) return true;
  const results = rules.map((rule) => matchesPlannerFilterRule(item, relatedItems, rule, today));
  return mode === "and" ? results.every(Boolean) : results.some(Boolean);
}
```

Implement helpers in the same file:

```ts
function matchesPlannerFilterRule(
  item: WorkspaceItemModel,
  relatedItems: WorkspaceItemsModel["relatedItems"],
  rule: PlannerFilterRule,
  today: string,
): boolean {
  const value = plannerFilterValue(item, relatedItems, rule.field);
  if (rule.operator === "is_empty") return isFilterEmpty(value);
  if (rule.operator === "is_not_empty") return !isFilterEmpty(value);
  if (rule.type === "date") return matchesDateFilter(String(value ?? ""), rule, today);
  if (rule.type === "number") return matchesNumberFilter(value, rule);
  if (Array.isArray(value)) return matchesArrayFilter(value, rule);
  return matchesTextFilter(String(value ?? ""), rule);
}
```

- [ ] **Step 4: Run model tests**

Run:

```bash
cd frontend && npm run test -- tests/domain/planner-model.spec.ts
```

Expected: PASS.

---

### Task 2: Planner State Wiring

**Files:**
- Modify: `frontend/src/features/workbench/model/workbench-model.ts`
- Modify: `frontend/src/features/workbench/hooks/useWorkbenchController.ts`
- Test: `frontend/tests/presentation/use-workbench-controller.spec.tsx`

**Interfaces:**
- Consumes:
  - `PlannerFilterMode`
  - `PlannerFilterRule`
- Produces:
  - `planner.filterMode`
  - `planner.filterRules`
  - `setPlannerFilterMode(mode)`
  - `setPlannerFilterRules(rules)`
  - `clearPlannerFilterRules()`

- [ ] **Step 1: Write failing controller test**

Add to `frontend/tests/presentation/use-workbench-controller.spec.tsx`:

```ts
it("stores planner advanced filter rules", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) =>
      Promise.resolve({
        ok: true,
        json: async () => (url === "/todo-engine/items?type=task" ? [] : []),
      }),
    ),
  );

  const { result } = renderHook(() => useWorkbenchController());

  act(() => {
    result.current.setPlannerFilterMode("or");
    result.current.setPlannerFilterRules([
      { id: "r1", field: "title", type: "text", operator: "contains", value: "plan" },
    ]);
  });

  expect(result.current.planner.filterMode).toBe("or");
  expect(result.current.planner.filterRules).toHaveLength(1);

  act(() => result.current.clearPlannerFilterRules());

  expect(result.current.planner.filterMode).toBe("and");
  expect(result.current.planner.filterRules).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd frontend && npm run test -- tests/presentation/use-workbench-controller.spec.tsx
```

Expected: FAIL because controller methods do not exist.

- [ ] **Step 3: Add state and methods**

In `frontend/src/features/workbench/model/workbench-model.ts`, import:

```ts
PlannerFilterMode,
PlannerFilterRule,
```

Add to `PlannerControls`:

```ts
filterMode: PlannerFilterMode;
filterRules: PlannerFilterRule[];
```

Add to `WorkbenchController`:

```ts
setPlannerFilterMode: (mode: PlannerFilterMode) => void;
setPlannerFilterRules: (rules: PlannerFilterRule[]) => void;
clearPlannerFilterRules: () => void;
```

In `frontend/src/features/workbench/hooks/useWorkbenchController.ts`, add defaults:

```ts
filterMode: "and",
filterRules: [],
```

Add controller methods:

```ts
setPlannerFilterMode: (mode) =>
  setPlanner((current) => ({ ...current, filterMode: mode })),
setPlannerFilterRules: (rules) =>
  setPlanner((current) => ({ ...current, filterRules: rules })),
clearPlannerFilterRules: () =>
  setPlanner((current) => ({ ...current, filterMode: "and", filterRules: [] })),
```

- [ ] **Step 4: Run controller tests**

Run:

```bash
cd frontend && npm run test -- tests/presentation/use-workbench-controller.spec.tsx
```

Expected: PASS.

---

### Task 3: Planner Rule Application Helper

**Files:**
- Modify: `frontend/src/features/workbench/model/planner-model.ts`
- Test: `frontend/tests/domain/planner-model.spec.ts`

**Interfaces:**
- Consumes:
  - `matchesPlannerFilterRules(item, relatedItems, rules, mode, today)`
- Produces:
  - `filterPlannerItemsByRules(items, relatedItems, rules, mode, today): WorkspaceItemModel[]`

- [ ] **Step 1: Write failing model test**

Add to `frontend/tests/domain/planner-model.spec.ts`:

```ts
it("filters planner item lists through advanced rules", () => {
  const result = filterPlannerItemsByRules(
    [
      { id: "task-1", type: "task", title: "Plan API", status: "active", scheduled: "2026-07-08", tags: ["api"] },
      { id: "task-2", type: "task", title: "Write Notes", status: "active", scheduled: "2026-07-08", tags: ["writing"] },
    ],
    relatedItems,
    [{ id: "r1", field: "tags", type: "multiSelect", operator: "contains", value: ["api"] }],
    "and",
    "2026-07-08",
  );

  expect(result.map((item) => item.id)).toEqual(["task-1"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd frontend && npm run test -- tests/domain/planner-model.spec.ts -t "filters planner item lists"
```

Expected: FAIL because `filterPlannerItemsByRules` is not exported.

- [ ] **Step 3: Add list filtering helper**

In `planner-model.ts`, add:

```ts
export function filterPlannerItemsByRules(
  items: WorkspaceItemModel[],
  relatedItems: WorkspaceItemsModel["relatedItems"],
  rules: PlannerFilterRule[],
  mode: PlannerFilterMode,
  today: string,
): WorkspaceItemModel[] {
  return items.filter((item) =>
    matchesPlannerFilterRules(item, relatedItems, rules, mode, today),
  );
}
```

- [ ] **Step 4: Run focused model test**

Run:

```bash
cd frontend && npm run test -- tests/domain/planner-model.spec.ts -t "filters planner item lists"
```

Expected: PASS.

---

### Task 4: Filter Builder UI

**Files:**
- Modify: `frontend/src/features/workbench/ui/MainPanel.tsx`
- Modify: `frontend/src/styles/globals.css`
- Test: `frontend/tests/presentation/workbench-wireframe.spec.tsx`

**Interfaces:**
- Consumes:
  - `controller.planner.filterRules`
  - `controller.planner.filterMode`
  - `controller.setPlannerFilterRules`
  - `controller.setPlannerFilterMode`
  - `controller.clearPlannerFilterRules`
  - `filterPlannerItemsByRules(items, relatedItems, rules, mode, today)`
- Produces:
  - `PlannerAdvancedFilterPanel`
  - Field picker
  - Rule rows
  - Type-specific value editors
  - Daily, Weekly, Monthly, and Yearly Planner views filter through advanced rules.

- [ ] **Step 1: Add field metadata in `MainPanel.tsx`**

Add:

```ts
type PlannerFilterFieldConfig = {
  field: PlannerFilterField;
  label: string;
  type: PlannerFilterType;
  options: DailyFilterOption[];
};
```

Add `plannerFilterFieldConfigs(controller, filterOptions)` returning Daily fields and reduced Yearly/Monthly/Weekly fields from the spec.

- [ ] **Step 2: Replace `PlannerFilterRulePanel`**

Replace the current body with:

```tsx
function PlannerFilterRulePanel({ controller, filterOptions }: Props) {
  const fields = plannerFilterFieldConfigs(controller, filterOptions);
  const rules = controller.planner.filterRules;

  if (rules.length === 0) {
    return <PlannerFilterFieldPicker fields={fields} onPick={(field) => addPlannerRule(controller, field)} />;
  }

  return (
    <div className="planner-filter-rule-panel">
      {rules.length > 1 ? <PlannerFilterModeControl controller={controller} /> : null}
      {rules.map((rule, index) => (
        <PlannerAdvancedFilterRuleRow
          key={rule.id}
          controller={controller}
          fields={fields}
          rule={rule}
          prefix={index === 0 ? "Where" : controller.planner.filterMode}
        />
      ))}
      <button type="button" onClick={() => addPlannerRule(controller, fields[0])}>
        + Add filter rule
      </button>
      <button type="button" onClick={controller.clearPlannerFilterRules}>
        Delete filter
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Add value editors**

Implement:

```tsx
function PlannerFilterValueEditor({ rule, field, onChange }: ValueEditorProps) {
  if (rule.operator === "is_empty" || rule.operator === "is_not_empty") return null;
  if (field.type === "text") return <input aria-label="Filter value" value={String(rule.value ?? "")} onChange={(event) => onChange(event.target.value)} />;
  if (field.type === "date") return <input aria-label="Filter date value" type="date" value={String(rule.value ?? "")} onChange={(event) => onChange(event.target.value)} />;
  if (field.type === "number") return <input aria-label="Filter number value" type="number" value={String(rule.value ?? "")} onChange={(event) => onChange(event.target.value)} />;
  return <PlannerFilterOptionCheckboxes field={field} rule={rule} onChange={onChange} />;
}
```

- [ ] **Step 4: Style the builder**

In `globals.css`, reuse existing `.planner-control-dropdown` and add only:

```css
.planner-filter-field-picker,
.planner-advanced-filter-row,
.planner-filter-mode-menu {
  display: grid;
  gap: 6px;
}
```

Add row/button/input rules with existing colors and `var(--radius-xs)`.

- [ ] **Step 5: Update presentation tests**

Replace old filter tests that use `Filter by Tags` select-like groups with:

```ts
await user.click(screen.getByRole("button", { name: "Filter planner view" }));
await user.click(screen.getByRole("button", { name: "Add filter rule" }));
await user.click(screen.getByRole("option", { name: "Tags" }));
await user.click(screen.getByRole("checkbox", { name: "focus" }));
```

Add one test for mode:

```ts
await user.click(screen.getByRole("button", { name: "Filter mode" }));
await user.click(screen.getByRole("option", { name: "Or" }));
expect(screen.getByText("Or")).toBeInTheDocument();
```

- [ ] **Step 6: Run focused tests**

Run:

```bash
cd frontend && npm run test -- tests/presentation/workbench-wireframe.spec.tsx -t "filter"
```

Expected: PASS.

---

### Task 5: Final Verification

**Files:**
- No new files.

**Interfaces:**
- Consumes all previous tasks.
- Produces verified Planner advanced filters.

- [ ] **Step 1: Run typecheck**

```bash
cd frontend && npm run typecheck
```

Expected: PASS.

- [ ] **Step 2: Run frontend tests**

```bash
cd frontend && npm run test
```

Expected: PASS.

- [ ] **Step 3: Run production build**

```bash
cd frontend && npm run build
```

Expected: PASS.

- [ ] **Step 4: Browser smoke**

Start dev server if needed:

```bash
cd frontend && npm run dev -- --port 3001
```

Check:

- Filter dropdown opens inside viewport.
- Adding a Name contains rule filters visible Planner cards.
- Adding a Tags contains rule shows checkbox options.
- Switching mode from And to Or changes matching behavior.
- Delete filter restores all Planner cards.

---

## Self-Review

- Spec coverage: Planner-only scope, rule list, field types, operators, UI controls, matching, and tests are covered.
- Marker scan: no blocked marker strings remain.
- Type consistency: plan uses `PlannerFilterMode`, `PlannerFilterRule`, `PlannerFilterField`, `PlannerFilterType`, and `PlannerFilterOperator` consistently across tasks.
