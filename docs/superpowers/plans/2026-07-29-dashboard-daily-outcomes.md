# Dashboard Daily Outcomes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current Dashboard summary and weekly Planner widgets with a Task/Event-only today donut, adjustable completion line chart, and Area/Project status heatmaps.

**Architecture:** Keep analytics frontend-only and derive every view model from `workspaceItems.allItems`. Extend the pure Dashboard aggregation model first, then replace the widget registry with discriminated donut/line/heatmap chart specifications rendered by focused UI components behind `DashboardChart`; keep date-range draft and validation state in `DashboardPanel`.

**Tech Stack:** TypeScript, React 18, Next.js 14, Vitest, Testing Library, CSS/SVG without a chart dependency

## Global Constraints

- Count only `task` and `event` items in every outcome, heatmap, and progress metric.
- Count a Routine-generated Task once as an ordinary Task; never count the Routine definition.
- Use the browser-local calendar for today and `completed_at` grouping.
- Default completion history to the inclusive latest 14 days and support 7-day, 14-day, 30-day, and custom inclusive ranges.
- Keep Dashboard range selection component-local and do not add persistence, a backend analytics API, or a database change.
- Preserve existing Project attention rules and existing Dashboard navigation destinations.
- Do not add a chart library.
- Do not modify or stage unrelated Planner/tag work already present in the working tree.

---

## File Structure

| File | Responsibility after this plan |
| --- | --- |
| `frontend/src/features/workbench/model/workbench-model.ts` | Expose the engine's optional `completed_at` field |
| `frontend/src/features/dashboard/model/dashboard-model.ts` | Pure Task/Event scope, local-date conversion, today outcomes, completion series, heatmap rows, and Project progress |
| `frontend/src/features/dashboard/model/dashboard-widgets.ts` | Declare the four Dashboard widgets and their donut/line/heatmap presentation data |
| `frontend/src/features/dashboard/ui/DashboardChart.tsx` | Dispatch each chart-spec discriminant to the focused renderer |
| `frontend/src/features/dashboard/ui/DashboardDonutChart.tsx` | Render donut total, legend/segment actions, values, and accessible labels |
| `frontend/src/features/dashboard/ui/DashboardLineChart.tsx` | Render dependency-free SVG line geometry and keyboard-focusable point feedback |
| `frontend/src/features/dashboard/ui/DashboardHeatmap.tsx` | Render scrollable status cells, progress, attention, and detail actions |
| `frontend/src/features/dashboard/ui/CompletionRangeControls.tsx` | Own presentational preset/custom inputs and emit validated-intent callbacks |
| `frontend/src/features/dashboard/ui/DashboardPanel.tsx` | Own applied/draft range state, validation message, loading/error/empty states, and widget composition |
| `frontend/src/styles/globals.css` | Define the responsive two-up top row, full-width heatmaps, chart tones, focus states, and mobile overflow |
| `frontend/tests/domain/dashboard-model.spec.ts` | Verify pure date, status, relationship, progress, and Routine-exclusion rules |
| `frontend/tests/domain/dashboard-widgets.spec.ts` | Verify chart specifications, labels, percentages, and destinations |
| `frontend/tests/presentation/dashboard-panel.spec.tsx` | Verify rendering, range interaction, accessibility, navigation, loading/error, and empty states |

---

### Task 1: Today Outcomes and Completion History Model

**Files:**
- Modify: `frontend/src/features/workbench/model/workbench-model.ts`
- Modify: `frontend/src/features/dashboard/model/dashboard-model.ts`
- Modify: `frontend/tests/domain/dashboard-model.spec.ts`

**Interfaces:**
- Consumes: `WorkspaceItemModel[]`, browser-local `today: string`, and optional `DashboardDateRange`
- Produces:

```ts
export type DashboardDateRange = { start: string; end: string };
export type TodayOutcomes = {
  date: string;
  completed: number;
  incomplete: number;
  missed: number;
  total: number;
};
export type CompletionDay = { date: string; completed: number };
export type CompletionHistory = {
  range: DashboardDateRange;
  days: CompletionDay[];
};
export function completionRangeEndingOn(
  today: string,
  dayCount: 7 | 14 | 30,
): DashboardDateRange;
export function isValidDashboardDateRange(
  range: DashboardDateRange,
): boolean;
export function buildDashboardSnapshot(
  items: WorkspaceItemModel[],
  today: string,
  completionRange?: DashboardDateRange,
): DashboardSnapshot;
```

- [ ] **Step 1: Write failing model tests for Task/Event scope and today partitioning**

Add focused fixtures that include an ordinary Task, Event, Routine definition,
Routine-generated Task, same-day scheduled/due duplication, and excluded
terminal status:

```ts
it("partitions today's Task and Event work without counting Routine definitions", () => {
  const snapshot = buildDashboardSnapshot([
    { id: "task-done", type: "task", title: "Done", status: "completed", scheduled: today },
    { id: "event-open", type: "event", title: "Meet", status: "active", due: today },
    { id: "task-paused", type: "task", title: "Wait", status: "paused", scheduled: today, due: today },
    { id: "task-missed", type: "task", title: "Miss", status: "missed", scheduled: today },
    { id: "routine", type: "routine", title: "Template", status: "active", scheduled: today },
    { id: "generated", type: "task", title: "Generated", status: "waiting", routine_id: "routine", scheduled: today },
    { id: "cancelled", type: "event", title: "No longer", status: "cancelled", scheduled: today },
  ], today);

  expect(snapshot.todayOutcomes).toEqual({
    date: today,
    completed: 1,
    incomplete: 3,
    missed: 1,
    total: 5,
  });
});
```

- [ ] **Step 2: Write failing range and local completion-date tests**

Use a helper that computes the expected local date through the same browser
primitive, without hard-coding the test runner's timezone:

```ts
function localDateOf(value: string): string {
  const date = new Date(value);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

it("builds a continuous inclusive completion history in browser-local dates", () => {
  const completedAt = "2026-07-22T23:30:00-07:00";
  const completionDate = localDateOf(completedAt);
  const range = { start: addDays(completionDate, -1), end: addDays(completionDate, 1) };
  const snapshot = buildDashboardSnapshot([
    { id: "task", type: "task", title: "Done", status: "completed", completed_at: completedAt },
    { id: "routine", type: "routine", title: "Template", status: "completed", completed_at: completedAt },
  ], today, range);

  expect(snapshot.completionHistory.days).toEqual([
    { date: range.start, completed: 0 },
    { date: completionDate, completed: 1 },
    { date: range.end, completed: 0 },
  ]);
});

it("creates exact 7, 14, and 30 day inclusive presets", () => {
  expect(completionRangeEndingOn(today, 7)).toEqual({
    start: addDays(today, -6),
    end: today,
  });
  expect(completionRangeEndingOn(today, 14)).toEqual({
    start: addDays(today, -13),
    end: today,
  });
  expect(completionRangeEndingOn(today, 30)).toEqual({
    start: addDays(today, -29),
    end: today,
  });
});

it("rejects reversed and invalid custom ranges", () => {
  expect(isValidDashboardDateRange({ start: "2026-07-29", end: "2026-07-28" })).toBe(false);
  expect(isValidDashboardDateRange({ start: "not-a-date", end: "2026-07-28" })).toBe(false);
});
```

- [ ] **Step 3: Run the focused model tests and verify failure**

Run:

```bash
cd frontend
npm test -- tests/domain/dashboard-model.spec.ts
```

Expected: FAIL because `completed_at`, `todayOutcomes`,
`completionHistory`, and the range helpers do not exist.

- [ ] **Step 4: Extend the workspace item and Dashboard model types**

Add the API field:

```ts
// WorkspaceItemModel
completed_at?: string | null;
```

Add the exported interfaces above and extend `DashboardSnapshot` with:

```ts
todayOutcomes: TodayOutcomes;
completionHistory: CompletionHistory;
```

Keep the legacy `summary` and `planner` fields temporarily so the existing
widget registry continues to typecheck until Task 3 replaces it.

- [ ] **Step 5: Implement local-date normalization and range helpers**

Use date-only values as calendar dates and timestamp values through `Date`:

```ts
function localCalendarDate(value: string | null | undefined): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return dateFromDateOnly(value) === null ? null : value;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : formatDateOnly(parsed);
}

export function completionRangeEndingOn(
  today: string,
  dayCount: 7 | 14 | 30,
): DashboardDateRange {
  return { start: addDays(today, 1 - dayCount), end: today };
}

export function isValidDashboardDateRange(range: DashboardDateRange): boolean {
  return dateFromDateOnly(range.start) !== null
    && dateFromDateOnly(range.end) !== null
    && range.start <= range.end;
}
```

- [ ] **Step 6: Implement today and completion aggregations**

Filter once to `task` and `event`, use the `scheduled`/`due` union predicate,
and fill every date in the range:

```ts
const dashboardExecutionTypes = new Set(["task", "event"]);
const incompleteStatuses = new Set(["active", "waiting", "paused"]);

function buildTodayOutcomes(
  work: WorkspaceItemModel[],
  today: string,
): TodayOutcomes {
  const todayWork = work.filter((item) =>
    localCalendarDate(item.scheduled) === today
    || localCalendarDate(item.due) === today
  );
  const completed = countStatus(todayWork, "completed");
  const incomplete = todayWork.filter((item) => incompleteStatuses.has(item.status)).length;
  const missed = countStatus(todayWork, "missed");
  return { date: today, completed, incomplete, missed, total: completed + incomplete + missed };
}

function buildCompletionHistory(
  work: WorkspaceItemModel[],
  range: DashboardDateRange,
): CompletionHistory {
  const counts = new Map<string, number>();
  for (const item of work) {
    if (item.status !== "completed") continue;
    const date = localCalendarDate(item.completed_at);
    if (date !== null && date >= range.start && date <= range.end) {
      counts.set(date, (counts.get(date) ?? 0) + 1);
    }
  }
  return {
    range,
    days: dateRange(range).map((date) => ({
      date,
      completed: counts.get(date) ?? 0,
    })),
  };
}
```

`dateRange` must iterate with local calendar `Date#setDate`, include both
endpoints, and return `[]` only for an invalid range. Default
`buildDashboardSnapshot` to `completionRangeEndingOn(today, 14)`.

- [ ] **Step 7: Run model tests and typecheck**

Run:

```bash
cd frontend
npm test -- tests/domain/dashboard-model.spec.ts
npm run typecheck
```

Expected: both commands PASS.

- [ ] **Step 8: Commit the model increment**

```bash
git add frontend/src/features/workbench/model/workbench-model.ts \
  frontend/src/features/dashboard/model/dashboard-model.ts \
  frontend/tests/domain/dashboard-model.spec.ts
git commit -m "[UPDATE] Add Dashboard daily outcome model" \
  -m "- Task와 Event만 오늘 상태와 완료 추이에 포함
- 브라우저 로컬 날짜 기준 완료 시각과 연속 기간을 집계
- 7일·14일·30일 및 직접 기간 검증 계약을 추가"
```

---

### Task 2: Area and Project Heatmap Aggregation

**Files:**
- Modify: `frontend/src/features/dashboard/model/dashboard-model.ts`
- Modify: `frontend/tests/domain/dashboard-model.spec.ts`

**Interfaces:**
- Consumes: Task/Event-only work collection from Task 1
- Produces:

```ts
export type DashboardStatusKey =
  | "completed"
  | "incomplete"
  | "paused"
  | "missed";
export type DashboardStatusValues = Record<DashboardStatusKey, number>;
export type DashboardHeatmapRow = {
  id: string;
  title: string;
  values: DashboardStatusValues;
  percentages: DashboardStatusValues;
  total: number;
};
export type DashboardProjectRow = DashboardHeatmapRow & {
  progress: number | null;
  attention: ProjectAttention;
};
```

- [ ] **Step 1: Replace legacy Area assertions with failing heatmap tests**

```ts
it("builds Area heatmap rows from direct Task and Event work only", () => {
  const snapshot = buildDashboardSnapshot([
    { id: "area", type: "area", title: "Health", status: "active" },
    { id: "active", type: "task", title: "Run", status: "active", area_id: "area" },
    { id: "waiting", type: "event", title: "Book", status: "waiting", area_id: "area" },
    { id: "paused", type: "task", title: "Rest", status: "paused", area_id: "area" },
    { id: "done", type: "event", title: "Check", status: "completed", area_id: "area" },
    { id: "missed", type: "task", title: "Skip", status: "missed", area_id: "area" },
    { id: "routine", type: "routine", title: "Template", status: "active", area_id: "area" },
    { id: "cancelled", type: "task", title: "Ignore", status: "cancelled", area_id: "area" },
  ], today);

  expect(snapshot.areas[0]).toMatchObject({
    values: { completed: 1, incomplete: 2, paused: 1, missed: 1 },
    percentages: { completed: 20, incomplete: 40, paused: 20, missed: 20 },
    total: 5,
  });
});
```

- [ ] **Step 2: Write failing Project progress and zero-row tests**

```ts
it("keeps Missed work in Project progress denominator", () => {
  const snapshot = buildDashboardSnapshot([
    { id: "project", type: "project", title: "Release", status: "active" },
    { id: "done", type: "task", title: "Done", status: "completed", project_id: "project" },
    { id: "missed", type: "event", title: "Miss", status: "missed", project_id: "project" },
    { id: "waiting", type: "task", title: "Wait", status: "waiting", project_id: "project" },
  ], today);

  expect(snapshot.projects[0]).toMatchObject({
    values: { completed: 1, incomplete: 1, paused: 0, missed: 1 },
    progress: 1 / 3,
  });
});

it("uses zero intensities and unavailable progress for containers without work", () => {
  const snapshot = buildDashboardSnapshot([
    { id: "area", type: "area", title: "Health", status: "paused" },
    { id: "project", type: "project", title: "Release", status: "active" },
  ], today);

  expect(snapshot.areas[0]?.percentages).toEqual({
    completed: 0, incomplete: 0, paused: 0, missed: 0,
  });
  expect(snapshot.projects[0]?.progress).toBeNull();
});
```

- [ ] **Step 3: Run the model tests and verify failure**

Run:

```bash
cd frontend
npm test -- tests/domain/dashboard-model.spec.ts
```

Expected: FAIL because Area and Project rows still expose the legacy
`active`/`remaining` shape.

- [ ] **Step 4: Implement one shared status classifier**

```ts
function statusKey(status: string): DashboardStatusKey | null {
  switch (status) {
    case "completed": return "completed";
    case "active":
    case "waiting": return "incomplete";
    case "paused": return "paused";
    case "missed": return "missed";
    default: return null;
  }
}

function statusValues(items: WorkspaceItemModel[]): {
  values: DashboardStatusValues;
  percentages: DashboardStatusValues;
  total: number;
} {
  const values = { completed: 0, incomplete: 0, paused: 0, missed: 0 };
  for (const item of items) {
    const key = statusKey(item.status);
    if (key !== null) values[key] += 1;
  }
  const total = Object.values(values).reduce((sum, value) => sum + value, 0);
  return {
    values,
    percentages: {
      completed: percent(values.completed, total),
      incomplete: percent(values.incomplete, total),
      paused: percent(values.paused, total),
      missed: percent(values.missed, total),
    },
    total,
  };
}
```

- [ ] **Step 5: Rebuild Area and Project rows**

Filter containers to `active` or `paused`. Select direct Task/Event work by
`area_id` or `project_id`, spread the shared status aggregation, and compute:

```ts
const progress = row.total === 0
  ? null
  : row.values.completed / row.total;
```

Retain `projectAttention(project, today)` without changing its Risk,
Attention, or precedence thresholds.

- [ ] **Step 6: Run focused model tests and typecheck**

Run:

```bash
cd frontend
npm test -- tests/domain/dashboard-model.spec.ts
npm run typecheck
```

Expected: PASS. If legacy widget types still consume `active`, `remaining`, or
legacy summary fields, the Task 2 implementation must retain those
compatibility properties alongside the new heatmap fields. Task 3 removes
them after replacing every consumer; do not weaken the new heatmap
assertions.

- [ ] **Step 7: Commit the heatmap aggregation**

```bash
git add frontend/src/features/dashboard/model/dashboard-model.ts \
  frontend/tests/domain/dashboard-model.spec.ts
git commit -m "[UPDATE] Add Dashboard status heatmap model" \
  -m "- Area와 Project의 직접 연결 Task·Event 상태를 공통 분류
- Miss를 포함한 Project 진행률과 행 내부 비율을 계산
- Routine과 제외 상태가 통계에 섞이지 않도록 검증"
```

---

### Task 3: Declarative Donut, Line, and Heatmap Renderers

**Files:**
- Modify: `frontend/src/features/dashboard/model/dashboard-widgets.ts`
- Modify: `frontend/src/features/dashboard/model/dashboard-model.ts`
- Modify: `frontend/src/features/dashboard/ui/DashboardChart.tsx`
- Create: `frontend/src/features/dashboard/ui/DashboardDonutChart.tsx`
- Create: `frontend/src/features/dashboard/ui/DashboardLineChart.tsx`
- Create: `frontend/src/features/dashboard/ui/DashboardHeatmap.tsx`
- Modify: `frontend/tests/domain/dashboard-widgets.spec.ts`
- Modify: `frontend/tests/presentation/dashboard-panel.spec.tsx`

**Interfaces:**
- Consumes: `DashboardSnapshot` from Tasks 1 and 2, and existing `DashboardDestination`
- Produces:

```ts
type DonutChartSpec = {
  kind: "donut";
  ariaLabel: string;
  total: number;
  segments: Array<{
    id: "completed" | "incomplete" | "missed";
    label: string;
    value: number;
    percentage: number;
    tone: "success" | "primary" | "warning";
    ariaLabel: string;
    destination: DashboardDestination;
  }>;
};

type LineChartSpec = {
  kind: "line";
  ariaLabel: string;
  points: Array<{
    id: string;
    label: string;
    value: number;
    ariaLabel: string;
  }>;
};

type HeatmapChartSpec = {
  kind: "heatmap";
  ariaLabel: string;
  columns: Array<{
    id: DashboardStatusKey;
    label: string;
    tone: "success" | "primary" | "secondary" | "warning";
  }>;
  rows: Array<{
    id: string;
    label: string;
    progressLabel?: string;
    attention?: ProjectAttention;
    destination: DashboardDestination;
    cells: Array<{
      id: string;
      columnId: DashboardStatusKey;
      value: number;
      intensityPercent: number;
      ariaLabel: string;
    }>;
  }>;
};

export type DashboardChartSpec =
  | DonutChartSpec
  | LineChartSpec
  | HeatmapChartSpec;
```

- [ ] **Step 1: Rewrite widget-registry tests for the four new widget IDs**

```ts
expect(dashboardWidgets.map((widget) => widget.id)).toEqual([
  "today-outcomes",
  "completion-history",
  "area-status",
  "project-status",
]);
expect(dashboardWidgets.map((widget) => widget.id)).not.toEqual(
  expect.arrayContaining(["summary", "planner-week"]),
);
```

Assert the today spec total and Daily destination, continuous line points
without destinations, exact heatmap cell values/intensities, Project
`Progress —`, and visible `Risk`/`Attention` text.

- [ ] **Step 2: Add failing renderer tests for all discriminants**

Replace the old stacked/grouped-bar fixture in
`dashboard-panel.spec.tsx` with one focused assertion per renderer:

```tsx
render(
  <DashboardChart
    chart={{
      kind: "line",
      ariaLabel: "Completion history",
      points: [
        { id: "2026-07-28", label: "2026-07-28", value: 2, ariaLabel: "2026-07-28: 2 completed" },
      ],
    }}
    onNavigate={vi.fn()}
  />,
);
expect(screen.getByRole("img", { name: "2026-07-28: 2 completed" })).toHaveAttribute("tabindex", "0");
```

For donut and heatmap, assert native segment/cell buttons call
`onNavigate` with `{ kind: "daily", date }` and the correct Area/Project
detail destination.

- [ ] **Step 3: Run widget and renderer tests and verify failure**

Run:

```bash
cd frontend
npm test -- tests/domain/dashboard-widgets.spec.ts tests/presentation/dashboard-panel.spec.tsx
```

Expected: FAIL because the registry and renderer still use
`stacked-bar`/`grouped-bar`.

- [ ] **Step 4: Replace the widget registry and remove legacy snapshot fields**

Build the four declarative specs. Use `percent(value, total)` for donut
segments, map line days one-to-one, and create heatmap cells from the fixed
column order:

```ts
const heatmapColumns = [
  { id: "completed", label: "Completed", tone: "success" },
  { id: "incomplete", label: "Incomplete", tone: "primary" },
  { id: "paused", label: "Paused", tone: "secondary" },
  { id: "missed", label: "Miss", tone: "warning" },
] as const;
```

Use these exact widget titles and empty messages:

```ts
[
  ["today-outcomes", "Today's work", "No Tasks or Events are scheduled or due today."],
  ["completion-history", "Completion history", "No Tasks or Events were completed in this range."],
  ["area-status", "Area status", "Create an active or paused Area to view status distribution."],
  ["project-status", "Project status", "Create an active or paused Project to view status distribution."],
]
```

After no consumer needs them, delete legacy `summary`, `planner`,
`active`/`remaining` compatibility fields and their helper functions from
`dashboard-model.ts`.

- [ ] **Step 5: Implement the DashboardChart dispatcher**

```tsx
export function DashboardChart(props: DashboardChartProps) {
  switch (props.chart.kind) {
    case "donut":
      return <DashboardDonutChart chart={props.chart} onNavigate={props.onNavigate} />;
    case "line":
      return <DashboardLineChart chart={props.chart} />;
    case "heatmap":
      return <DashboardHeatmap chart={props.chart} onNavigate={props.onNavigate} />;
  }
}
```

- [ ] **Step 6: Implement the dependency-free donut renderer**

Render a CSS-driven ring with the total in its center and segment buttons in
the visible legend. Put cumulative percentages into typed CSS custom
properties; invoke `onNavigate(segment.destination)` from each legend button.
When `total === 0`, render the widget-provided empty message through the panel
instead of dividing by zero.

- [ ] **Step 7: Implement SVG line geometry and focusable points**

Calculate coordinates from the provided values only:

```ts
const maximum = Math.max(1, ...chart.points.map((point) => point.value));
const coordinates = chart.points.map((point, index) => ({
  ...point,
  x: chart.points.length === 1 ? 50 : (index / (chart.points.length - 1)) * 100,
  y: 94 - (point.value / maximum) * 84,
}));
```

Render a `viewBox="0 0 100 100"` SVG polyline and an absolutely positioned
`<span role="img" tabIndex={0}>` for every point. Its `aria-label` and visible
focus/hover tooltip must contain the provided date and count. Do not attach a
navigation callback.

- [ ] **Step 8: Implement the scrollable heatmap renderer**

Render column headings and one row per Area/Project. Each cell is a button
using the row destination and a CSS custom property:

```tsx
style={{
  "--dashboard-heatmap-intensity": cell.intensityPercent / 100,
} as React.CSSProperties}
```

Keep value text inside the button. Add `Risk` or `Attention` text beside the
Project label, and show `progressLabel` as the final column. Clicking the row
label or any cell uses the same detail destination.

- [ ] **Step 9: Run focused tests and typecheck**

Run:

```bash
cd frontend
npm test -- tests/domain/dashboard-model.spec.ts \
  tests/domain/dashboard-widgets.spec.ts \
  tests/presentation/dashboard-panel.spec.tsx
npm run typecheck
```

Expected: PASS.

- [ ] **Step 10: Commit chart contracts and renderers**

```bash
git add frontend/src/features/dashboard/model/dashboard-model.ts \
  frontend/src/features/dashboard/model/dashboard-widgets.ts \
  frontend/src/features/dashboard/ui/DashboardChart.tsx \
  frontend/src/features/dashboard/ui/DashboardDonutChart.tsx \
  frontend/src/features/dashboard/ui/DashboardLineChart.tsx \
  frontend/src/features/dashboard/ui/DashboardHeatmap.tsx \
  frontend/tests/domain/dashboard-model.spec.ts \
  frontend/tests/domain/dashboard-widgets.spec.ts \
  frontend/tests/presentation/dashboard-panel.spec.tsx
git commit -m "[UPDATE] Replace Dashboard analytics charts" \
  -m "- 기존 요약·주간 막대 위젯을 도넛·선·히트맵 명세로 교체
- 차트별 렌더러를 분리하고 키보드·텍스트 접근성을 제공
- Area와 Project 셀에서 기존 상세 화면 이동을 유지"
```

---

### Task 4: Range Controls, Responsive Layout, and Full Verification

**Files:**
- Create: `frontend/src/features/dashboard/ui/CompletionRangeControls.tsx`
- Modify: `frontend/src/features/dashboard/ui/DashboardPanel.tsx`
- Modify: `frontend/src/styles/globals.css`
- Modify: `frontend/tests/presentation/dashboard-panel.spec.tsx`

**Interfaces:**
- Consumes: `DashboardDateRange`, `completionRangeEndingOn`,
  `isValidDashboardDateRange`, four widget specs, and existing controller
  navigation/retry callbacks
- Produces:

```ts
type CompletionRangeControlsProps = {
  today: string;
  appliedRange: DashboardDateRange;
  draftRange: DashboardDateRange;
  selectedPreset: 7 | 14 | 30 | "custom";
  error: string | null;
  onPresetSelect: (preset: 7 | 14 | 30) => void;
  onDraftChange: (field: "start" | "end", value: string) => void;
  onCustomApply: () => void;
};
```

- [ ] **Step 1: Write failing preset and custom-range presentation tests**

Use fake time and a loaded controller. Assert the 14-day button starts pressed,
7/30 rebuild the line labels, custom controls reject a reversed range, and a
valid range applies:

```tsx
expect(screen.getByRole("button", { name: "14 days" })).toHaveAttribute("aria-pressed", "true");
await user.click(screen.getByRole("button", { name: "7 days" }));
expect(screen.getByRole("button", { name: "7 days" })).toHaveAttribute("aria-pressed", "true");

await user.click(screen.getByRole("button", { name: "Custom range" }));
await user.clear(screen.getByLabelText("Completion start date"));
await user.type(screen.getByLabelText("Completion start date"), "2026-07-29");
await user.clear(screen.getByLabelText("Completion end date"));
await user.type(screen.getByLabelText("Completion end date"), "2026-07-28");
await user.click(screen.getByRole("button", { name: "Apply completion range" }));
expect(screen.getByRole("alert")).toHaveTextContent(
  "Start date must be on or before end date.",
);
```

Also assert the last valid line-point count remains unchanged after invalid
Apply.

- [ ] **Step 2: Rewrite Dashboard integration tests for new behavior**

Cover:

- four skeleton cards;
- global empty response;
- populated donut total and all three segment values;
- donut segment navigation to today's Daily Planner;
- line zero-range explanatory text;
- Area and Project heatmap cell accessible names and detail navigation;
- Project Risk text and unavailable progress;
- retry after failed all-items request; and
- Routine definitions absent from all displayed counts.

Use `completed_at?: string` and `routine_id?: string` in the local `TestItem`
type. Remove assertions for Workspace summary, Active Work, grouped weekly
bars, and Planner-week navigation.

- [ ] **Step 3: Run the presentation tests and verify failure**

Run:

```bash
cd frontend
npm test -- tests/presentation/dashboard-panel.spec.tsx
```

Expected: FAIL because `DashboardPanel` has no range state or new layout.

- [ ] **Step 4: Implement controlled range inputs**

`CompletionRangeControls` renders preset buttons with `aria-pressed`, a
`Custom range` button, two native date inputs, an Apply button, and the passed
error as `role="alert"`. It must not perform date math itself.

- [ ] **Step 5: Implement applied and draft range state in DashboardPanel**

Anchor one `today` value per render, initialize to 14 days, and keep invalid
drafts from replacing the applied range:

```tsx
const today = dashboardToday();
const [selectedPreset, setSelectedPreset] =
  React.useState<7 | 14 | 30 | "custom">(14);
const [appliedRange, setAppliedRange] = React.useState<DashboardDateRange>(
  () => completionRangeEndingOn(today, 14),
);
const [draftRange, setDraftRange] = React.useState(appliedRange);
const [rangeError, setRangeError] = React.useState<string | null>(null);

const applyPreset = (preset: 7 | 14 | 30) => {
  const next = completionRangeEndingOn(today, preset);
  setSelectedPreset(preset);
  setAppliedRange(next);
  setDraftRange(next);
  setRangeError(null);
};

const applyCustom = () => {
  if (!isValidDashboardDateRange(draftRange)) {
    setRangeError("Start date must be on or before end date.");
    return;
  }
  setSelectedPreset("custom");
  setAppliedRange(draftRange);
  setRangeError(null);
};
```

Build the snapshot with `appliedRange`. Insert the controls only in the
Completion history widget header. Update chart-data detection by discriminant:
donut renders only when `total > 0`; line always renders its continuous points
and additionally shows the no-completion message when every value is zero;
heatmap uses row presence while still rendering zero-total rows.

- [ ] **Step 6: Replace Dashboard CSS with the approved responsive layout**

Define:

- a 12-column Dashboard grid;
- `today-outcomes` spanning 4 columns and `completion-history` spanning 8;
- both heatmaps spanning all 12 columns;
- a minimum readable heatmap width inside horizontal overflow;
- CSS-variable driven donut segments and heatmap intensity;
- visible `:focus-visible` outlines for segment buttons, line points, range
  controls, row labels, and cells;
- no transition under `@media (prefers-reduced-motion: reduce)`; and
- a single-column layout below the existing `767px` breakpoint.

Use existing design tokens only. Do not add raw hex values to feature
components.

- [ ] **Step 7: Run focused tests, typecheck, and architecture tests**

Run:

```bash
cd frontend
npm test -- tests/domain/dashboard-model.spec.ts \
  tests/domain/dashboard-widgets.spec.ts \
  tests/presentation/dashboard-panel.spec.tsx \
  tests/architecture/design-boundaries.spec.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Run complete frontend verification**

Run:

```bash
cd frontend
npm test
npm run typecheck
npm run build
```

Expected: all tests PASS, TypeScript reports no errors, and Next.js completes
the static production build.

- [ ] **Step 9: Review the final diff for scope and generated files**

Run:

```bash
git status --short
git diff --check
git diff --stat
git diff -- frontend/src/features/dashboard \
  frontend/src/features/workbench/model/workbench-model.ts \
  frontend/src/styles/globals.css \
  frontend/tests/domain/dashboard-model.spec.ts \
  frontend/tests/domain/dashboard-widgets.spec.ts \
  frontend/tests/presentation/dashboard-panel.spec.tsx
```

Confirm no unrelated Planner/tag files, `.next/`, `out/`, or mockup files are
staged.

- [ ] **Step 10: Commit the completed Dashboard UI**

```bash
git add frontend/src/features/dashboard/ui/CompletionRangeControls.tsx \
  frontend/src/features/dashboard/ui/DashboardPanel.tsx \
  frontend/src/styles/globals.css \
  frontend/tests/presentation/dashboard-panel.spec.tsx
git commit -m "[UPDATE] Complete daily outcomes Dashboard" \
  -m "- 완료 추이 프리셋과 검증되는 직접 기간 입력을 제공
- 오늘 도넛과 상태 히트맵을 반응형 레이아웃으로 구성
- 빈 상태·재시도·키보드 탐색과 전체 프런트 검증을 보강"
```
