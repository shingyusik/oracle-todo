# Planner Period Goal Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enrich `Yearly` and `Monthly` Planner views with period goal carousels and lower-period goal cards.

**Architecture:** Keep the feature frontend-only. Add pure planner model builders for yearly/monthly period buckets, expose the smallest controller date-navigation methods, then replace the current yearly/monthly goal list rendering with card-based views. Reuse existing goal loading, filters, sort/group helpers, creation flow, and CSS.

**Tech Stack:** Next.js 14, React 18, TypeScript, `lucide-react`, Vitest, React Testing Library, CSS in `frontend/src/styles/globals.css`.

## Global Constraints

- Reuse `/todo-engine/items?type=goal` and current related item loading.
- Do not add new backend planner endpoints.
- Do not add new dependencies or animation libraries.
- Use existing `lucide-react` icons.
- Terminal statuses stay hidden: `completed`, `archived`, `dropped`, `cancelled`.
- Year, month, and week buckets follow `todo-engine` canonical period starts.
- Week buckets use ISO Monday and never clamp to the calendar month's first day.
- Goal creation defaults must send canonical anchors: year = January 1, month = the 1st, week = ISO Monday.
- Existing Planner filters, sort, group, and add-goal behavior must keep working.
- Reduced-motion users must not require rotation animation.

---

## File Structure

- Modify `frontend/src/features/workbench/model/planner-model.ts`
  - Add pure yearly/monthly period-card model builders.
  - Add date helpers for canonical year, month, and ISO Monday week starts.
- Modify `frontend/src/features/workbench/model/workbench-model.ts`
  - Add controller methods for planner period navigation and returning to current period.
- Modify `frontend/src/features/workbench/hooks/useWorkbenchController.ts`
  - Implement period navigation on existing `planner.date` and `planner.weekStart`.
  - Fix yearly/monthly goal creation defaults to canonical selected period starts.
- Modify `frontend/src/features/workbench/ui/MainPanel.tsx`
  - Replace `GoalPlannerList` usage for `yearly` and `monthly` with richer period card views.
  - Add `Now` control to the planner toolbar.
- Modify `frontend/src/styles/globals.css`
  - Style the carousel, recessed side cards, month grid, week strip, and reduced-motion behavior.
- Modify `frontend/tests/domain/planner-model.spec.ts`
  - Cover period buckets and ISO Monday week intersections.
- Modify `frontend/tests/presentation/use-workbench-controller.spec.tsx`
  - Cover period navigation and canonical goal creation defaults.
- Modify `frontend/tests/presentation/workbench-wireframe.spec.tsx`
  - Cover yearly/monthly carousel rendering, arrows, `Now`, month cards, and week cards.

---

### Task 1: Add Pure Yearly and Monthly Period Models

**Files:**
- Modify: `frontend/src/features/workbench/model/planner-model.ts`
- Test: `frontend/tests/domain/planner-model.spec.ts`

**Interfaces:**
- Consumes: `WorkspaceItemModel[]`, planner date as `YYYY-MM-DD`.
- Produces:
  - `PeriodGoalCardModel`
  - `YearlyPeriodGoalCardsModel`
  - `MonthlyPeriodGoalCardsModel`
  - `buildYearlyPeriodGoalCardsModel(items, plannerDate): YearlyPeriodGoalCardsModel`
  - `buildMonthlyPeriodGoalCardsModel(items, plannerDate): MonthlyPeriodGoalCardsModel`

- [ ] **Step 1: Write failing yearly model tests**

Add imports in `frontend/tests/domain/planner-model.spec.ts`:

```ts
import {
  buildDailyPlannerModel,
  buildMonthlyPeriodGoalCardsModel,
  buildWeeklyPlannerModel,
  buildYearlyPeriodGoalCardsModel,
  groupPlannerItems,
  sortPlannerItems,
} from "@/features/workbench/model/planner-model";
```

Add this test inside `describe("planner model", () => { ... })`:

```ts
it("builds yearly carousel cards and twelve month buckets", () => {
  const model = buildYearlyPeriodGoalCardsModel(
    [
      item("previous-year", {
        type: "goal",
        horizon: "year",
        scheduled: "2025-01-01",
      }),
      item("selected-year", {
        type: "goal",
        horizon: "year",
        scheduled: "2026-01-01",
      }),
      item("next-year", {
        type: "goal",
        horizon: "year",
        scheduled: "2027-01-01",
      }),
      item("january", {
        type: "goal",
        horizon: "month",
        scheduled: "2026-01-01",
      }),
      item("december", {
        type: "goal",
        horizon: "month",
        scheduled: "2026-12-01",
      }),
      item("done", {
        type: "goal",
        horizon: "month",
        status: "completed",
        scheduled: "2026-02-01",
      }),
    ],
    "2026-07-08",
  );

  expect(model.carousel.map((card) => [card.position, card.periodStart, card.goals.map((goal) => goal.id)])).toEqual([
    ["previous", "2025-01-01", ["previous-year"]],
    ["selected", "2026-01-01", ["selected-year"]],
    ["next", "2027-01-01", ["next-year"]],
  ]);
  expect(model.months).toHaveLength(12);
  expect(model.months[0]).toEqual(
    expect.objectContaining({
      label: "Jan",
      periodStart: "2026-01-01",
    }),
  );
  expect(model.months[0]?.goals.map((goal) => goal.id)).toEqual(["january"]);
  expect(model.months[1]?.goals).toEqual([]);
  expect(model.months[11]?.goals.map((goal) => goal.id)).toEqual(["december"]);
});
```

- [ ] **Step 2: Write failing monthly model tests**

Add this test in the same file:

```ts
it("builds monthly carousel cards and ISO Monday week buckets intersecting the month", () => {
  const model = buildMonthlyPeriodGoalCardsModel(
    [
      item("previous-month", {
        type: "goal",
        horizon: "month",
        scheduled: "2025-12-01",
      }),
      item("selected-month", {
        type: "goal",
        horizon: "month",
        scheduled: "2026-01-01",
      }),
      item("next-month", {
        type: "goal",
        horizon: "month",
        scheduled: "2026-02-01",
      }),
      item("week-crosses-year", {
        type: "goal",
        horizon: "week",
        scheduled: "2025-12-29",
      }),
      item("week-inside-month", {
        type: "goal",
        horizon: "week",
        scheduled: "2026-01-05",
      }),
      item("archived-week", {
        type: "goal",
        horizon: "week",
        status: "archived",
        scheduled: "2026-01-12",
      }),
    ],
    "2026-01-15",
  );

  expect(model.carousel.map((card) => [card.position, card.periodStart, card.goals.map((goal) => goal.id)])).toEqual([
    ["previous", "2025-12-01", ["previous-month"]],
    ["selected", "2026-01-01", ["selected-month"]],
    ["next", "2026-02-01", ["next-month"]],
  ]);
  expect(model.weeks.map((week) => [week.label, week.periodStart])).toEqual([
    ["W1", "2025-12-29"],
    ["W2", "2026-01-05"],
    ["W3", "2026-01-12"],
    ["W4", "2026-01-19"],
    ["W5", "2026-01-26"],
  ]);
  expect(model.weeks[0]?.goals.map((goal) => goal.id)).toEqual(["week-crosses-year"]);
  expect(model.weeks[1]?.goals.map((goal) => goal.id)).toEqual(["week-inside-month"]);
  expect(model.weeks[2]?.goals).toEqual([]);
});
```

- [ ] **Step 3: Run tests to verify failure**

Run:

```bash
cd frontend
npm run test -- tests/domain/planner-model.spec.ts
```

Expected: FAIL because `buildYearlyPeriodGoalCardsModel` and `buildMonthlyPeriodGoalCardsModel` are not exported.

- [ ] **Step 4: Add model types and helpers**

In `frontend/src/features/workbench/model/planner-model.ts`, add these types after `WeeklyPlannerModel`:

```ts
export type PeriodGoalCardPosition = "previous" | "selected" | "next";

export type PeriodGoalCardModel = {
  key: string;
  label: string;
  periodStart: string;
  position: PeriodGoalCardPosition;
  goals: WorkspaceItemModel[];
};

export type PeriodGoalBucketModel = {
  key: string;
  label: string;
  periodStart: string;
  goals: WorkspaceItemModel[];
};

export type YearlyPeriodGoalCardsModel = {
  selectedYear: string;
  carousel: PeriodGoalCardModel[];
  months: PeriodGoalBucketModel[];
};

export type MonthlyPeriodGoalCardsModel = {
  selectedMonth: string;
  carousel: PeriodGoalCardModel[];
  weeks: PeriodGoalBucketModel[];
};
```

Add these helper constants near the existing status sets:

```ts
const monthLabels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
```

Add these exported builders before `buildDailyPlannerModel`:

```ts
export function buildYearlyPeriodGoalCardsModel(
  items: WorkspaceItemModel[],
  plannerDate: string,
): YearlyPeriodGoalCardsModel {
  const selectedYear = plannerDate.slice(0, 4);
  const yearStarts = [-1, 0, 1].map((offset) =>
    yearStart(addYears(`${selectedYear}-01-01`, offset)),
  );

  return {
    selectedYear,
    carousel: yearStarts.map((periodStart, index) =>
      periodCard(items, periodStart, ["previous", "selected", "next"][index] as PeriodGoalCardPosition, "year"),
    ),
    months: Array.from({ length: 12 }, (_, monthIndex) => {
      const periodStart = `${selectedYear}-${String(monthIndex + 1).padStart(2, "0")}-01`;
      return {
        key: periodStart,
        label: monthLabels[monthIndex] ?? periodStart.slice(5, 7),
        periodStart,
        goals: goalsForPeriod(items, "month", periodStart),
      };
    }),
  };
}

export function buildMonthlyPeriodGoalCardsModel(
  items: WorkspaceItemModel[],
  plannerDate: string,
): MonthlyPeriodGoalCardsModel {
  const selectedMonth = monthStart(plannerDate);
  const monthStarts = [-1, 0, 1].map((offset) => monthStart(addMonths(selectedMonth, offset)));
  const monthEnd = addDays(addMonths(selectedMonth, 1), -1);
  const firstWeekStart = isoWeekStart(selectedMonth);
  const weeks: PeriodGoalBucketModel[] = [];

  for (let current = firstWeekStart, index = 1; current <= monthEnd; current = addDays(current, 7), index += 1) {
    weeks.push({
      key: current,
      label: `W${index}`,
      periodStart: current,
      goals: goalsForPeriod(items, "week", current),
    });
  }

  return {
    selectedMonth,
    carousel: monthStarts.map((periodStart, index) =>
      periodCard(items, periodStart, ["previous", "selected", "next"][index] as PeriodGoalCardPosition, "month"),
    ),
    weeks,
  };
}
```

Add these private helpers near the existing `addDays` helper:

```ts
function periodCard(
  items: WorkspaceItemModel[],
  periodStart: string,
  position: PeriodGoalCardPosition,
  horizon: "year" | "month",
): PeriodGoalCardModel {
  return {
    key: `${position}-${periodStart}`,
    label: horizon === "year" ? periodStart.slice(0, 4) : periodStart.slice(0, 7),
    periodStart,
    position,
    goals: goalsForPeriod(items, horizon, periodStart),
  };
}

function goalsForPeriod(
  items: WorkspaceItemModel[],
  horizon: "year" | "month" | "week",
  periodStart: string,
): WorkspaceItemModel[] {
  return items.filter(
    (item) =>
      item.type === "goal" &&
      !terminalStatuses.has(item.status) &&
      item.horizon === horizon &&
      datePart(item.scheduled) === periodStart,
  );
}

export function yearStart(date: string): string {
  return `${date.slice(0, 4)}-01-01`;
}

export function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

export function isoWeekStart(date: string): string {
  const value = new Date(`${date}T00:00:00`);
  const day = value.getDay();
  value.setDate(value.getDate() + (day === 0 ? -6 : 1 - day));
  return formatLocalDate(value);
}

export function addYears(date: string, years: number): string {
  const value = new Date(`${date}T00:00:00`);
  value.setFullYear(value.getFullYear() + years);
  return formatLocalDate(value);
}

export function addMonths(date: string, months: number): string {
  const value = new Date(`${date}T00:00:00`);
  value.setMonth(value.getMonth() + months);
  return formatLocalDate(value);
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
```

- [ ] **Step 5: Run tests to verify pass**

Run:

```bash
cd frontend
npm run test -- tests/domain/planner-model.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/workbench/model/planner-model.ts frontend/tests/domain/planner-model.spec.ts
git commit -m "$(cat <<'EOF'
[UPDATE] Add planner period goal models

- Yearly와 Monthly 카드 뷰가 사용할 순수 기간 모델 추가
- todo-engine의 ISO Monday week anchor 기준을 모델 테스트로 고정
EOF
)"
```

---

### Task 2: Add Planner Period Navigation and Canonical Creation Defaults

**Files:**
- Modify: `frontend/src/features/workbench/model/workbench-model.ts`
- Modify: `frontend/src/features/workbench/hooks/useWorkbenchController.ts`
- Test: `frontend/tests/presentation/use-workbench-controller.spec.tsx`

**Interfaces:**
- Consumes: current `PlannerControls.date`, `selection.leafTabId`.
- Produces:
  - `WorkbenchController.movePlannerPeriod(direction: -1 | 1): void`
  - `WorkbenchController.resetPlannerPeriodToToday(): void`
  - Yearly add goal uses selected year January 1.
  - Monthly add goal uses selected month first day.
  - Weekly add goal keeps selected ISO Monday.

- [ ] **Step 1: Write failing controller navigation tests**

In `frontend/tests/presentation/use-workbench-controller.spec.tsx`, make the import block include:

```ts
import { renderHook, act, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
```

Add this test in the existing controller describe block:

```ts
it("moves yearly and monthly planner periods through canonical dates", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: async () => [],
      }),
    ),
  );

  const { result } = renderHook(() => useWorkbenchController());

  act(() => result.current.selectTab("todo"));
  act(() => result.current.selectTab("planner"));
  await waitFor(() => expect(result.current.panel.id).toBe("yearly"));

  const startingYear = result.current.planner.date.slice(0, 4);
  act(() => result.current.movePlannerPeriod(1));
  expect(result.current.planner.date).toBe(`${Number(startingYear) + 1}-01-01`);
  act(() => result.current.movePlannerPeriod(-1));
  expect(result.current.planner.date).toBe(`${startingYear}-01-01`);

  act(() => result.current.selectTab("monthly"));
  act(() => result.current.movePlannerPeriod(1));
  expect(result.current.planner.date.endsWith("-01")).toBe(true);
});
```

- [ ] **Step 2: Write failing canonical creation test**

Add this test in the same file:

```ts
it("creates yearly and monthly goals with canonical scheduled anchors", async () => {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url === "/todo-engine/goals/propose") {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          id: "goal-new",
          type: "goal",
          title: JSON.parse(String(init?.body)).title,
          status: "approved",
          horizon: JSON.parse(String(init?.body)).horizon,
          scheduled: JSON.parse(String(init?.body)).scheduled,
        }),
      });
    }

    return Promise.resolve({
      ok: true,
      json: async () => [],
    });
  });
  vi.stubGlobal("fetch", fetchMock);

  const { result } = renderHook(() => useWorkbenchController());

  act(() => result.current.selectTab("todo"));
  act(() => result.current.selectTab("planner"));
  await waitFor(() => expect(result.current.panel.id).toBe("yearly"));

  await act(async () => {
    await result.current.createWorkspaceItem({ title: "Year goal" });
  });
  expect(JSON.parse(String(fetchMock.mock.calls.find(([url]) => url === "/todo-engine/goals/propose")?.[1]?.body))).toEqual(
    expect.objectContaining({
      horizon: "year",
      scheduled: `${result.current.planner.date.slice(0, 4)}-01-01`,
    }),
  );

  act(() => result.current.selectTab("monthly"));
  await act(async () => {
    await result.current.createWorkspaceItem({ title: "Month goal" });
  });
  const goalBodies = fetchMock.mock.calls
    .filter(([url]) => url === "/todo-engine/goals/propose")
    .map(([, init]) => JSON.parse(String(init?.body)));
  expect(goalBodies.at(-1)).toEqual(
    expect.objectContaining({
      horizon: "month",
      scheduled: `${result.current.planner.date.slice(0, 7)}-01`,
    }),
  );
});
```

- [ ] **Step 3: Run tests to verify failure**

Run:

```bash
cd frontend
npm run test -- tests/presentation/use-workbench-controller.spec.tsx
```

Expected: FAIL because the controller methods do not exist and yearly/monthly creation still uses raw `planner.date`.

- [ ] **Step 4: Extend controller types**

In `frontend/src/features/workbench/model/workbench-model.ts`, add methods to `WorkbenchController`:

```ts
  movePlannerPeriod: (direction: -1 | 1) => void;
  resetPlannerPeriodToToday: () => void;
```

- [ ] **Step 5: Implement controller navigation**

In `frontend/src/features/workbench/hooks/useWorkbenchController.ts`, import date helpers from the planner model:

```ts
import {
  addMonths,
  addYears,
  isoWeekStart,
  monthStart,
  yearStart,
} from "@/features/workbench/model/planner-model";
```

Add these controller methods in the returned object:

```ts
    movePlannerPeriod: (direction) =>
      setPlanner((current) => {
        const date = movePlannerDate(selection.leafTabId, current.date, direction);
        return { ...current, date, weekStart: weekStartForDate(date) };
      }),
    resetPlannerPeriodToToday: () =>
      setPlanner((current) => {
        const date = todayDate();
        return { ...current, date, weekStart: weekStartForDate(date) };
      }),
```

Add this private helper near `createDefaultPlanner`:

```ts
function movePlannerDate(panelId: LeafTabId, date: string, direction: -1 | 1): string {
  if (panelId === "yearly") {
    return yearStart(addYears(yearStart(date), direction));
  }
  if (panelId === "monthly") {
    return monthStart(addMonths(monthStart(date), direction));
  }
  if (panelId === "weekly") {
    return addDays(weekStartForDate(date), direction * 7);
  }
  return addDays(date, direction);
}
```

Export or define `addDays` in this file if it is not already present:

```ts
function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00`);
  value.setDate(value.getDate() + days);
  return formatLocalDate(value);
}
```

- [ ] **Step 6: Fix canonical planner goal defaults**

In `plannerGoalDefaults` in `frontend/src/features/workbench/hooks/useWorkbenchController.ts`, replace yearly/monthly scheduled values:

```ts
  if (panelId === "monthly") {
    return {
      horizon: "month",
      scheduled: form.scheduled || monthStart(planner.date),
    };
  }
  if (panelId === "yearly") {
    return {
      horizon: "year",
      scheduled: form.scheduled || yearStart(planner.date),
    };
  }
```

Keep weekly as:

```ts
  if (panelId === "weekly") {
    return {
      horizon: "week",
      scheduled: form.scheduled || isoWeekStart(planner.weekStart),
    };
  }
```

- [ ] **Step 7: Run tests to verify pass**

Run:

```bash
cd frontend
npm run test -- tests/presentation/use-workbench-controller.spec.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/features/workbench/model/workbench-model.ts frontend/src/features/workbench/hooks/useWorkbenchController.ts frontend/tests/presentation/use-workbench-controller.spec.tsx
git commit -m "$(cat <<'EOF'
[UPDATE] Add planner period navigation

- Yearly와 Monthly의 이전/다음 기간 이동을 controller에 추가
- goal 생성 기본 날짜를 todo-engine canonical anchor 정책에 맞춤
EOF
)"
```

---

### Task 3: Render Yearly and Monthly Period Goal Cards

**Files:**
- Modify: `frontend/src/features/workbench/ui/MainPanel.tsx`
- Test: `frontend/tests/presentation/workbench-wireframe.spec.tsx`

**Interfaces:**
- Consumes:
  - `buildYearlyPeriodGoalCardsModel`
  - `buildMonthlyPeriodGoalCardsModel`
  - `controller.movePlannerPeriod`
  - `controller.resetPlannerPeriodToToday`
  - existing `filterPlannerItemsByTags`, `groupPlannerItems`, `sortPlannerItems`
- Produces:
  - `YearlyPeriodPlanner`
  - `MonthlyPeriodPlanner`
  - `PeriodGoalCarousel`
  - `PeriodGoalBucketCard`

- [ ] **Step 1: Write failing yearly presentation test**

Replace the existing `renders yearly and monthly goal lists from loaded planner goals` test in `frontend/tests/presentation/workbench-wireframe.spec.tsx` with this yearly-focused test:

```tsx
it("renders yearly period carousel and twelve month goal cards", async () => {
  const user = userEvent.setup();
  const today = testToday();
  const yearStart = testYearStart(today);
  const nextYearStart = testNextYearStart(today);
  const monthStart = testMonthStart(today);
  const responses: Record<string, unknown[]> = {
    "/todo-engine/items?type=goal": [
      { id: "goal-year", type: "goal", title: "Annual Goal", status: "active", horizon: "year", scheduled: yearStart, tags: ["annual-current"] },
      { id: "goal-other-year", type: "goal", title: "Other Year Goal", status: "active", horizon: "year", scheduled: nextYearStart, tags: ["annual-future"] },
      { id: "goal-month", type: "goal", title: "Monthly Goal", status: "active", horizon: "month", scheduled: monthStart, tags: ["month-current"] },
      { id: "goal-year-done", type: "goal", title: "Completed Annual Goal", status: "completed", horizon: "year", scheduled: yearStart, tags: ["annual-done"] },
    ],
    "/todo-engine/items?type=area": [],
    "/todo-engine/items?type=project": [],
  };
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) =>
      Promise.resolve({
        ok: true,
        json: async () => responses[url] ?? [],
      }),
    ),
  );

  render(<WorkbenchPageClient />);

  await user.click(screen.getByRole("button", { name: "ToDo" }));
  await user.click(screen.getByRole("button", { name: "Planner" }));

  expect(await screen.findByRole("region", { name: "Year goal carousel" })).toBeInTheDocument();
  expect(screen.getByText("Annual Goal")).toBeInTheDocument();
  expect(screen.getByText("Other Year Goal")).toBeInTheDocument();
  expect(screen.queryByText("Completed Annual Goal")).toBeNull();
  expect(screen.getAllByTestId("yearly-month-card")).toHaveLength(12);
  expect(screen.getByRole("region", { name: "Jan goals" })).toHaveTextContent("Monthly Goal");
  expect(screen.getByRole("button", { name: "Previous year" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Next year" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Now" })).toBeInTheDocument();
});
```

- [ ] **Step 2: Write failing monthly presentation test**

Add this test after the yearly test:

```tsx
it("renders monthly period carousel and ISO Monday week goal cards", async () => {
  const user = userEvent.setup();
  const today = testToday();
  const monthStart = testMonthStart(today);
  const nextMonthStart = testNextMonthStart(today);
  const firstWeekStart = testWeekStart(monthStart);
  const secondWeekStart = testAddDays(firstWeekStart, 7);
  const responses: Record<string, unknown[]> = {
    "/todo-engine/items?type=goal": [
      { id: "goal-month", type: "goal", title: "Monthly Goal", status: "active", horizon: "month", scheduled: monthStart, tags: ["month-current"] },
      { id: "goal-other-month", type: "goal", title: "Other Month Goal", status: "active", horizon: "month", scheduled: nextMonthStart, tags: ["month-future"] },
      { id: "goal-week-1", type: "goal", title: "First Week Goal", status: "active", horizon: "week", scheduled: firstWeekStart, tags: ["week-current"] },
      { id: "goal-week-2", type: "goal", title: "Second Week Goal", status: "active", horizon: "week", scheduled: secondWeekStart, tags: ["week-current"] },
      { id: "goal-week-done", type: "goal", title: "Done Week Goal", status: "completed", horizon: "week", scheduled: firstWeekStart, tags: ["week-done"] },
    ],
    "/todo-engine/items?type=area": [],
    "/todo-engine/items?type=project": [],
  };
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) =>
      Promise.resolve({
        ok: true,
        json: async () => responses[url] ?? [],
      }),
    ),
  );

  render(<WorkbenchPageClient />);

  await user.click(screen.getByRole("button", { name: "ToDo" }));
  await user.click(screen.getByRole("button", { name: "Planner" }));
  await user.click(screen.getByRole("button", { name: "Monthly" }));

  expect(await screen.findByRole("region", { name: "Month goal carousel" })).toBeInTheDocument();
  expect(screen.getByText("Monthly Goal")).toBeInTheDocument();
  expect(screen.getByText("Other Month Goal")).toBeInTheDocument();
  expect(screen.getAllByTestId("monthly-week-card").length).toBeGreaterThanOrEqual(4);
  expect(screen.getByRole("region", { name: "W1 goals" })).toHaveTextContent("First Week Goal");
  expect(screen.getByRole("region", { name: "W2 goals" })).toHaveTextContent("Second Week Goal");
  expect(screen.queryByText("Done Week Goal")).toBeNull();
  expect(screen.getByRole("button", { name: "Previous month" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Next month" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Now" })).toBeInTheDocument();
});
```

- [ ] **Step 3: Write failing navigation test**

Add this test:

```tsx
it("moves monthly periods with arrows and returns with Now", async () => {
  const user = userEvent.setup();
  const today = testToday();
  const monthStart = testMonthStart(today);
  const nextMonthStart = testNextMonthStart(today);
  const responses: Record<string, unknown[]> = {
    "/todo-engine/items?type=goal": [
      { id: "current", type: "goal", title: "Current Month", status: "active", horizon: "month", scheduled: monthStart },
      { id: "next", type: "goal", title: "Next Month", status: "active", horizon: "month", scheduled: nextMonthStart },
    ],
    "/todo-engine/items?type=area": [],
    "/todo-engine/items?type=project": [],
  };
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) =>
      Promise.resolve({
        ok: true,
        json: async () => responses[url] ?? [],
      }),
    ),
  );

  render(<WorkbenchPageClient />);

  await user.click(screen.getByRole("button", { name: "ToDo" }));
  await user.click(screen.getByRole("button", { name: "Planner" }));
  await user.click(screen.getByRole("button", { name: "Monthly" }));

  expect(await screen.findByText("Current Month")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Next month" }));
  expect(await screen.findByText("Next Month")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Now" }));
  expect(await screen.findByText("Current Month")).toBeInTheDocument();
});
```

- [ ] **Step 4: Run tests to verify failure**

Run:

```bash
cd frontend
npm run test -- tests/presentation/workbench-wireframe.spec.tsx
```

Expected: FAIL because the carousel regions, `Now` button, and month/week cards do not exist.

- [ ] **Step 5: Import model builders and icons**

In `frontend/src/features/workbench/ui/MainPanel.tsx`, update imports:

```tsx
import {
  ArrowDownUp,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Filter,
  Group,
  Plus,
  Save,
  Trash2,
  X,
} from "lucide-react";
```

Update planner-model imports:

```tsx
  buildDailyPlannerModel,
  buildMonthlyPeriodGoalCardsModel,
  buildWeeklyPlannerModel,
  buildYearlyPeriodGoalCardsModel,
  type PeriodGoalBucketModel,
  type PeriodGoalCardModel,
```

- [ ] **Step 6: Replace yearly/monthly list usage**

In `PlannerPanel`, replace the yearly/monthly `GoalPlannerList` branches:

```tsx
      {panel.id === "yearly" ? (
        <YearlyPeriodPlanner controller={controller} />
      ) : null}
      {panel.id === "monthly" ? (
        <MonthlyPeriodPlanner controller={controller} />
      ) : null}
```

Keep `GoalPlannerList` only if another caller still uses it; otherwise remove it after the new components compile.

- [ ] **Step 7: Add Now button to toolbar**

In `PlannerControlToolbar`, add this button before the add button:

```tsx
          <button
            className="items-toolbar-button"
            type="button"
            aria-label="Now"
            onClick={controller.resetPlannerPeriodToToday}
          >
            Now
          </button>
```

- [ ] **Step 8: Add yearly and monthly planner components**

Add these components where `GoalPlannerList` currently lives:

```tsx
function YearlyPeriodPlanner({ controller }: MainPanelProps) {
  const tags = effectivePlannerTags(controller.panel.id, controller.workspaceItems.items, controller.planner);
  const items = filterPlannerItemsByTags(controller.workspaceItems.items, tags);
  const model = buildYearlyPeriodGoalCardsModel(items, controller.planner.date);

  return (
    <div className="planner-period-panel">
      <PeriodGoalCarousel
        controller={controller}
        ariaLabel="Year goal carousel"
        previousLabel="Previous year"
        nextLabel="Next year"
        cards={model.carousel}
      />
      <div className="yearly-month-grid" aria-label="Month goals">
        {model.months.map((month) => (
          <PeriodGoalBucketCard
            controller={controller}
            bucket={month}
            testId="yearly-month-card"
            key={month.key}
          />
        ))}
      </div>
    </div>
  );
}

function MonthlyPeriodPlanner({ controller }: MainPanelProps) {
  const tags = effectivePlannerTags(controller.panel.id, controller.workspaceItems.items, controller.planner);
  const items = filterPlannerItemsByTags(controller.workspaceItems.items, tags);
  const model = buildMonthlyPeriodGoalCardsModel(items, controller.planner.date);

  return (
    <div className="planner-period-panel">
      <PeriodGoalCarousel
        controller={controller}
        ariaLabel="Month goal carousel"
        previousLabel="Previous month"
        nextLabel="Next month"
        cards={model.carousel}
      />
      <div className="monthly-week-strip" aria-label="Week goals">
        {model.weeks.map((week) => (
          <PeriodGoalBucketCard
            controller={controller}
            bucket={week}
            testId="monthly-week-card"
            key={week.key}
          />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 9: Add shared card components**

Add these components under the yearly/monthly components:

```tsx
function PeriodGoalCarousel({
  controller,
  ariaLabel,
  previousLabel,
  nextLabel,
  cards,
}: {
  controller: WorkbenchController;
  ariaLabel: string;
  previousLabel: string;
  nextLabel: string;
  cards: PeriodGoalCardModel[];
}) {
  return (
    <section className="period-carousel" aria-label={ariaLabel}>
      <button
        className="period-carousel-arrow"
        type="button"
        aria-label={previousLabel}
        onClick={() => controller.movePlannerPeriod(-1)}
      >
        <ChevronLeft size={18} aria-hidden="true" />
      </button>
      <div className="period-carousel-track">
        {cards.map((card) => (
          <article className="period-carousel-card" data-position={card.position} key={card.key}>
            <div className="period-card-kicker">{card.label}</div>
            <GoalGroupContent controller={controller} goals={card.goals} emptyText="No goals found." />
          </article>
        ))}
      </div>
      <button
        className="period-carousel-arrow"
        type="button"
        aria-label={nextLabel}
        onClick={() => controller.movePlannerPeriod(1)}
      >
        <ChevronRight size={18} aria-hidden="true" />
      </button>
    </section>
  );
}

function PeriodGoalBucketCard({
  controller,
  bucket,
  testId,
}: {
  controller: WorkbenchController;
  bucket: PeriodGoalBucketModel;
  testId: string;
}) {
  return (
    <section
      className="period-bucket-card"
      aria-label={`${bucket.label} goals`}
      data-testid={testId}
    >
      <h3>{bucket.label}</h3>
      <GoalGroupContent controller={controller} goals={bucket.goals} emptyText="No goals found." />
    </section>
  );
}

function GoalGroupContent({
  controller,
  goals,
  emptyText,
}: {
  controller: WorkbenchController;
  goals: WorkspaceItemModel[];
  emptyText: string;
}) {
  const groupedGoals = groupPlannerItems(
    sortPlannerItems(goals, plannerSortValue(controller)),
    controller.workspaceItems.relatedItems,
    plannerGroupValue(controller),
  );

  return <>{renderPlannerGroups(controller, groupedGoals, emptyText)}</>;
}
```

- [ ] **Step 10: Run tests to verify pass**

Run:

```bash
cd frontend
npm run test -- tests/presentation/workbench-wireframe.spec.tsx
```

Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add frontend/src/features/workbench/ui/MainPanel.tsx frontend/tests/presentation/workbench-wireframe.spec.tsx
git commit -m "$(cat <<'EOF'
[UPDATE] Render planner period goal cards

- Yearly와 Monthly에 이전/현재/다음 기간 goal carousel 추가
- Yearly 월 카드와 Monthly ISO Monday 주 카드 렌더링 추가
EOF
)"
```

---

### Task 4: Add Period Card Styling and Motion Safety

**Files:**
- Modify: `frontend/src/styles/globals.css`
- Test: `frontend/tests/architecture/design-boundaries.spec.ts`

**Interfaces:**
- Consumes: class names from Task 3.
- Produces:
  - `.planner-period-panel`
  - `.period-carousel`
  - `.period-carousel-track`
  - `.period-carousel-card`
  - `.yearly-month-grid`
  - `.monthly-week-strip`
  - `.period-bucket-card`

- [ ] **Step 1: Write failing CSS boundary test**

In `frontend/tests/architecture/design-boundaries.spec.ts`, add:

```ts
it("keeps planner period cards motion-safe and dependency-free", async () => {
  const css = await readSource("src/styles/globals.css");

  expect(css).toContain(".period-carousel-card");
  expect(css).toContain("@media (prefers-reduced-motion: reduce)");
  expect(css).not.toContain("animation-library");
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
cd frontend
npm run test -- tests/architecture/design-boundaries.spec.ts
```

Expected: FAIL because period card CSS is absent.

- [ ] **Step 3: Add CSS**

Append this near the existing planner styles in `frontend/src/styles/globals.css`:

```css
.planner-period-panel {
  display: grid;
  gap: 18px;
}

.period-carousel {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  perspective: 1000px;
}

.period-carousel-arrow {
  display: inline-grid;
  width: 36px;
  height: 36px;
  place-items: center;
  border: 1px solid var(--color-hairline-light);
  border-radius: var(--radius-pill);
  background: var(--color-canvas-light);
  color: var(--color-ink);
  cursor: pointer;
}

.period-carousel-track {
  display: grid;
  grid-template-columns: minmax(120px, 0.7fr) minmax(220px, 1.2fr) minmax(120px, 0.7fr);
  min-height: 188px;
  align-items: center;
  gap: 12px;
}

.period-carousel-card {
  min-height: 168px;
  border: 1px solid var(--color-hairline-light);
  border-radius: var(--radius-sm);
  background: var(--color-canvas-light);
  padding: 14px;
  box-shadow: 0 14px 28px rgb(0 0 0 / 10%);
  transform-style: preserve-3d;
  transition: transform 180ms ease, opacity 180ms ease;
}

.period-carousel-card[data-position="selected"] {
  min-height: 188px;
  transform: translateZ(28px);
}

.period-carousel-card[data-position="previous"] {
  opacity: 0.78;
  transform: rotateY(12deg) scale(0.92);
  transform-origin: right center;
}

.period-carousel-card[data-position="next"] {
  opacity: 0.78;
  transform: rotateY(-12deg) scale(0.92);
  transform-origin: left center;
}

.period-card-kicker {
  margin-bottom: 10px;
  color: var(--color-shade-60);
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
}

.yearly-month-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.monthly-week-strip {
  display: grid;
  grid-auto-columns: minmax(220px, 1fr);
  grid-auto-flow: column;
  gap: 12px;
  overflow-x: auto;
  padding-bottom: 4px;
}

.period-bucket-card {
  min-height: 148px;
  border: 1px solid var(--color-hairline-light);
  border-radius: var(--radius-xs);
  background: var(--color-canvas-light);
  padding: 14px;
  box-shadow: 0 1px 0 rgb(0 0 0 / 4%);
}

.period-bucket-card h3 {
  margin-bottom: 10px;
  color: var(--color-shade-60);
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
}

@media (prefers-reduced-motion: reduce) {
  .period-carousel-card {
    transition: none;
  }
}

@media (max-width: 760px) {
  .period-carousel-track {
    grid-template-columns: minmax(220px, 1fr);
  }

  .period-carousel-card[data-position="previous"],
  .period-carousel-card[data-position="next"] {
    display: none;
  }

  .yearly-month-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
```

- [ ] **Step 4: Run CSS boundary test**

Run:

```bash
cd frontend
npm run test -- tests/architecture/design-boundaries.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/styles/globals.css frontend/tests/architecture/design-boundaries.spec.ts
git commit -m "$(cat <<'EOF'
[UPDATE] Style planner period cards

- 기간 carousel의 중앙/좌우 카드 입체 배치를 CSS로 추가
- Monthly week strip과 Yearly 3x4 month grid 스타일 추가
- reduced-motion 환경에서 카드 전환을 비활성화
EOF
)"
```

---

### Task 5: Final Verification

**Files:**
- No source edits expected.

**Interfaces:**
- Consumes: all previous task outputs.
- Produces: verified frontend feature branch state.

- [ ] **Step 1: Run focused frontend tests**

```bash
cd frontend
npm run test -- tests/domain/planner-model.spec.ts tests/presentation/use-workbench-controller.spec.tsx tests/presentation/workbench-wireframe.spec.tsx tests/architecture/design-boundaries.spec.ts
```

Expected: PASS.

- [ ] **Step 2: Run full frontend quality gates**

```bash
cd frontend
npm run test
npm run typecheck
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 3: Inspect final diff**

```bash
git status --short
git log --oneline -n 8
```

Expected: no unstaged source changes after commits; recent commits match the task sequence.

---

## Self-Review

- Spec coverage: Yearly carousel, 12 month cards, Monthly carousel, ISO Monday week cards, arrows, `Now`, filters/sort/group reuse, terminal status hiding, canonical creation defaults, reduced-motion, and no new backend/dependency work are covered.
- Placeholder scan: no open implementation blanks remain.
- Type consistency: model builders return `PeriodGoalCardModel` and `PeriodGoalBucketModel`; UI consumes those exact types; controller methods match `WorkbenchController`.
- Scope: one frontend feature slice; no schema, backend API, persistence, drag-and-drop, calendar grid, quarter goals, or new animation library work.
