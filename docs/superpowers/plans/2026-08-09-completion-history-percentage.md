# Completion History Percentage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Dashboard Completion history counts with daily scheduled-or-due completion rates on a fixed 0% to 100% chart scale.

**Architecture:** Derive `completed`, `total`, and raw 0-to-100 `percentage` values in the Dashboard domain model so completion-rate semantics stay outside React. Map those values into the existing informational line-chart specification, then render the line chart with a fixed percentage scale and percentage-formatted ticks while preserving its X-axis, focus, and tooltip behavior.

**Tech Stack:** TypeScript, React 18, CSS, Vitest, Testing Library, Next.js 14

## Global Constraints

- Eligible work is a Task or Event whose browser-local `scheduled` or `due` date equals the chart date.
- The denominator includes only `completed`, `active`, `waiting`, `paused`, and `missed` items.
- The numerator includes only eligible `completed` items.
- An item whose `scheduled` and `due` fields match the same date contributes once.
- A date without eligible work has `completed = 0`, `total = 0`, and `percentage = 0`.
- Raw percentage values retain fractional precision; visible text rounds to the nearest whole percent.
- The Y-axis always renders `100%`, `75%`, `50%`, `25%`, and `0%`.
- Existing range controls, X-axis derivation, focus behavior, and informational-only point semantics remain unchanged.
- Add no dependency and make no API, Rust, SQLite, or preference change.

---

### Task 1: Derive and expose daily completion rates

**Files:**
- Modify: `frontend/src/features/dashboard/model/dashboard-model.ts:16-21,282-299`
- Modify: `frontend/src/features/dashboard/model/dashboard-widgets.ts:29-37,165-184`
- Modify: `frontend/src/features/dashboard/ui/DashboardPanel.tsx:267-339`
- Test: `frontend/tests/domain/dashboard-model.spec.ts:268-286`
- Test: `frontend/tests/domain/dashboard-widgets.spec.ts:5-41,130-158`
- Test: `frontend/tests/presentation/dashboard-panel.spec.tsx:278-371,815-960`

**Interfaces:**
- Consumes: `buildDashboardSnapshot(items: WorkspaceItemModel[], today: string, completionRange?: DashboardDateRange): DashboardSnapshot`.
- Produces: `CompletionDay = { date: string; completed: number; total: number; percentage: number }`.
- Produces: `LineChartSpec.total` as the sum of eligible work across displayed dates.
- Produces: `LineChartSpec.points[].value` as a raw 0-to-100 percentage and `ariaLabel` as `YYYY-MM-DD: N% completed (completed/total)`.

- [ ] **Step 1: Replace the count-history domain test with failing completion-rate cases**

In `frontend/tests/domain/dashboard-model.spec.ts`, replace the existing completion-history count test with cases that assert mixed eligible statuses, excluded statuses, scheduled/due de-duplication, fractional precision, and no-work continuity:

```ts
it("builds daily scheduled-or-due completion percentages", () => {
  const range = { start: "2026-07-22", end: "2026-07-24" };
  const snapshot = buildDashboardSnapshot([
    { id: "done", type: "task", title: "Done", status: "completed", scheduled: "2026-07-23", due: "2026-07-23" },
    { id: "active", type: "task", title: "Active", status: "active", due: "2026-07-23" },
    { id: "missed", type: "event", title: "Missed", status: "missed", scheduled: "2026-07-23" },
    { id: "cancelled", type: "event", title: "Cancelled", status: "cancelled", scheduled: "2026-07-23" },
    { id: "other-day", type: "task", title: "Other", status: "completed", scheduled: "2026-07-24" },
  ], today, range);

  expect(snapshot.completionHistory.days).toEqual([
    { date: "2026-07-22", completed: 0, total: 0, percentage: 0 },
    { date: "2026-07-23", completed: 1, total: 3, percentage: 100 / 3 },
    { date: "2026-07-24", completed: 1, total: 1, percentage: 100 },
  ]);
});
```

The production change that makes this test pass is replacing `completed_at` grouping with per-date scheduled-or-due eligibility and adding `total` and `percentage` to `CompletionDay`.

- [ ] **Step 2: Run the focused domain test and verify RED**

Run:

```bash
npm --prefix frontend test -- tests/domain/dashboard-model.spec.ts
```

Expected: FAIL because Completion history still returns `{ date, completed }` grouped by `completed_at` and does not expose `total` or `percentage`.

- [ ] **Step 3: Implement the minimal domain calculation**

In `frontend/src/features/dashboard/model/dashboard-model.ts`, change the type and builder to:

```ts
export type CompletionDay = {
  date: string;
  completed: number;
  total: number;
  percentage: number;
};

function buildCompletionHistory(
  work: WorkspaceItemModel[],
  range: DashboardDateRange,
): CompletionHistory {
  return {
    range,
    days: dateRange(range).map((date) => {
      const eligible = work.filter((item) =>
        (localCalendarDate(item.scheduled) === date
          || localCalendarDate(item.due) === date)
        && statusKey(item.status) !== null,
      );
      const completed = countStatus(eligible, "completed");
      const total = eligible.length;
      return { date, completed, total, percentage: percent(completed, total) };
    }),
  };
}
```

The single `filter` call naturally de-duplicates an item whose two date fields match the same date.

- [ ] **Step 4: Run the focused domain test and verify GREEN**

Run:

```bash
npm --prefix frontend test -- tests/domain/dashboard-model.spec.ts
```

Expected: all tests in `dashboard-model.spec.ts` PASS.

- [ ] **Step 5: Write failing widget mapping and empty-state tests**

Update `sampleDashboardSnapshot.completionHistory.days` in `frontend/tests/domain/dashboard-widgets.spec.ts` and replace the count assertion with:

```ts
days: [
  { date: "2026-07-22", completed: 0, total: 0, percentage: 0 },
  { date: "2026-07-23", completed: 2, total: 3, percentage: 200 / 3 },
],
```

```ts
it("maps completion percentages and exact ratios to informational line points", () => {
  expect(widget("completion-history")).toMatchObject({
    id: "completion-history",
    title: "Completion history",
    description: "Completion rate for Tasks and Events scheduled or due by browser-local calendar date.",
    emptyMessage: "No Tasks or Events are scheduled or due in this range.",
    chart: {
      kind: "line",
      ariaLabel: "Completion history",
      total: 3,
      points: [
        {
          id: "2026-07-22",
          label: "2026-07-22",
          value: 0,
          ariaLabel: "2026-07-22: 0% completed (0/0)",
        },
        {
          id: "2026-07-23",
          label: "2026-07-23",
          value: 200 / 3,
          ariaLabel: "2026-07-23: 67% completed (2/3)",
        },
      ],
    },
  });
});
```

The production change that makes this test pass is mapping `day.percentage`, rounding only the label, exposing the sum of daily eligible work as `chart.total`, and updating Completion history copy.

Before changing production code, update direct `LineChartSpec` fixtures in
`frontend/tests/presentation/dashboard-panel.spec.tsx` with the intended
`total`. Change loaded Dashboard expectations from count labels to
`N% completed (completed/total)` and replace the old completion-count empty copy
with `No Tasks or Events are scheduled or due in this range.`. Add a focused
case proving scheduled or due work at 0% renders the chart without the empty
message, while an all-zero-total range keeps the empty message.

- [ ] **Step 6: Run the focused widget test and verify RED**

Run:

```bash
npm --prefix frontend test -- tests/domain/dashboard-widgets.spec.ts tests/presentation/dashboard-panel.spec.tsx
```

Expected: FAIL because the widget still maps `day.completed`, has no line-chart `total`, and treats every all-zero line as empty.

- [ ] **Step 7: Implement the minimal widget mapping**

In `frontend/src/features/dashboard/model/dashboard-widgets.ts`, map each day as follows:

```ts
const points = snapshot.completionHistory.days.map((day) => ({
  id: day.date,
  label: day.date,
  value: day.percentage,
  ariaLabel:
    `${day.date}: ${Math.round(day.percentage)}% completed (${day.completed}/${day.total})`,
}));
const total = snapshot.completionHistory.days.reduce(
  (sum, day) => sum + day.total,
  0,
);
```

Add `total: number` to `LineChartSpec` and include `total` next to `points` in
the Completion history chart object.

Set the widget copy exactly to:

```ts
description:
  "Completion rate for Tasks and Events scheduled or due by browser-local calendar date.",
emptyMessage: "No Tasks or Events are scheduled or due in this range.",
```

In `frontend/src/features/dashboard/ui/DashboardPanel.tsx`, distinguish a real
0% series from a no-work series:

```ts
case "line":
  return chart.total === 0;
```

- [ ] **Step 8: Run both focused model tests and verify GREEN**

Run:

```bash
npm --prefix frontend test -- tests/domain/dashboard-model.spec.ts tests/domain/dashboard-widgets.spec.ts tests/presentation/dashboard-panel.spec.tsx
```

Expected: all three test files PASS with raw fractional point values, rounded visible labels, and correct zero-rate empty-state behavior.

- [ ] **Step 9: Commit the model and widget behavior**

```bash
git add frontend/src/features/dashboard/model/dashboard-model.ts \
  frontend/src/features/dashboard/model/dashboard-widgets.ts \
  frontend/src/features/dashboard/ui/DashboardPanel.tsx \
  frontend/tests/domain/dashboard-model.spec.ts \
  frontend/tests/domain/dashboard-widgets.spec.ts \
  frontend/tests/presentation/dashboard-panel.spec.tsx
git diff --cached --check
git commit -m "[UPDATE] Calculate daily completion percentages" \
  -m "- 예정·마감된 Task와 Event를 날짜별 완료율 분모로 집계
- 원시 퍼센트 정밀도와 완료/전체 비율을 위젯 모델에 전달
- 대상이 없는 날짜와 제외 상태의 경계 동작을 테스트"
```

---

### Task 2: Render a fixed percentage chart scale

**Files:**
- Modify: `frontend/src/features/dashboard/ui/DashboardLineChart.tsx:9-61`
- Modify: `frontend/tests/presentation/dashboard-panel.spec.tsx:291-366,815-960`

**Interfaces:**
- Consumes: `LineChartSpec.total`, `LineChartSpec.points[].value` on the inclusive 0-to-100 scale, and preformatted `ariaLabel` text.
- Produces: fixed percentage Y-axis ticks and point positions calculated against `100`, without further changing the `LineChartSpec` interface.

- [ ] **Step 1: Write failing presentation tests for percentage ticks and tooltip consistency**

Replace the count-axis test in `frontend/tests/presentation/dashboard-panel.spec.tsx` with:

```tsx
it("renders a fixed zero-to-one-hundred percentage axis", () => {
  const { container } = render(
    <DashboardChart
      chart={{
        kind: "line",
        ariaLabel: "Completion history",
        total: 6,
        points: [
          {
            id: "2026-07-01",
            label: "2026-07-01",
            value: 0,
            ariaLabel: "2026-07-01: 0% completed (0/2)",
          },
          {
            id: "2026-07-02",
            label: "2026-07-02",
            value: 75,
            ariaLabel: "2026-07-02: 75% completed (3/4)",
          },
        ],
      }}
      onNavigate={vi.fn()}
    />,
  );

  expect(
    Array.from(
      container.querySelectorAll(".dashboard-line-y-tick"),
      (tick) => tick.textContent,
    ),
  ).toEqual(["100%", "75%", "50%", "25%", "0%"]);
  expect(
    screen.getByRole("img", { name: "2026-07-02: 75% completed (3/4)" }),
  ).toHaveStyle({ top: "31%" });
  expect(screen.getByText("2026-07-02: 75% completed (3/4)"))
    .toBeInTheDocument();
});
```

The production change that makes this test pass is replacing maximum-derived scaling and integer tick labels with the fixed percentage scale.

- [ ] **Step 2: Run the focused presentation test and verify RED**

Run:

```bash
npm --prefix frontend test -- tests/presentation/dashboard-panel.spec.tsx
```

Expected: FAIL because the Y-axis is derived from the observed maximum and its labels omit `%`.

- [ ] **Step 3: Implement the fixed scale**

In `frontend/src/features/dashboard/ui/DashboardLineChart.tsx`, replace maximum derivation with:

```tsx
const maximum = 100;
const yTicks = [100, 75, 50, 25, 0];
```

Keep coordinate placement based on `point.value / maximum`. Render tick text with:

```tsx
{tick}%
```

Retain the existing X-axis selection algorithm and all point roles, focusability, and tooltip markup.

- [ ] **Step 4: Run the focused presentation test and verify GREEN**

Run:

```bash
npm --prefix frontend test -- tests/presentation/dashboard-panel.spec.tsx
```

Expected: all tests in `dashboard-panel.spec.tsx` PASS.

- [ ] **Step 5: Run the full frontend verification gate**

Run sequentially so the Next.js build cannot race TypeScript's `.next/types` reads:

```bash
npm --prefix frontend test
npm --prefix frontend run typecheck
npm --prefix frontend run build
git diff --check
```

Expected: all frontend tests PASS, TypeScript exits 0, the static build exits 0, and `git diff --check` reports no whitespace errors.

- [ ] **Step 6: Commit the chart presentation**

```bash
git add frontend/src/features/dashboard/ui/DashboardLineChart.tsx \
  frontend/tests/presentation/dashboard-panel.spec.tsx
git diff --cached --check
git commit -m "[UPDATE] Show completion history percentages" \
  -m "- Completion history Y축을 0~100% 고정 눈금으로 표시
- 퍼센트 좌표와 완료/전체 툴팁 단위를 일치
- 기존 기간 X축과 키보드 포커스 동작을 회귀 검증"
```

---

### Task 3: Verify completion and update issue evidence

**Files:**
- No repository file changes.
- Linear issue: `SHI-53`.

**Interfaces:**
- Consumes: the verified feature branch commits and test output from Tasks 1 and 2.
- Produces: a clean feature branch and a Linear completion comment after integration and deployment.

- [ ] **Step 1: Inspect the final branch state**

Run:

```bash
git status --short --branch
git log -5 --oneline --decorate
git diff main...HEAD --stat
```

Expected: only the intended model, widget, chart, and test changes are present; the worktree is clean.

- [ ] **Step 2: Merge according to the user's selected finish option and verify the merged result**

Use `superpowers:finishing-a-development-branch`. If merging locally, rerun:

```bash
npm --prefix frontend test
npm --prefix frontend run typecheck
npm --prefix frontend run build
```

Expected: all commands exit 0 on the integrated commit.

- [ ] **Step 3: Update Linear only after verified integration**

Move `SHI-53` to `Done` and add a comment containing the integrated commit, test totals, build result, release tag, and deployment URL. If deployment is not requested or has not completed, leave deployment evidence out rather than claiming it.
