# Dashboard Area and Project Card Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display Area and Project status as separate side-by-side cards when space permits, while limiting each preview to the five most urgent rows with an accessible expand/collapse control.

**Architecture:** Keep status aggregation and urgency ordering in the pure Dashboard model. Extend the generic heatmap renderer with controlled row visibility, then let `DashboardPanel` own independent Area and Project expansion state and group those widgets in a responsive nested grid. No backend, persistence, or status-counting changes are needed.

**Tech Stack:** React 18, TypeScript, Next.js 14, Vitest, Testing Library, CSS Grid

## Global Constraints

- Dashboard status calculations continue to use `task` and `event` items only.
- Row priority is Miss count descending, incomplete count descending, then localized name ascending.
- Each card initially renders at most five rows.
- Area and Project expansion state is independent and is not persisted.
- The controls use the visible copy `전체 보기 (총 N개)` and `접기`.
- The status cards remain separate regions and preserve existing row/cell navigation.
- No backend API, SQLite schema, TodoService, Project progress, or Project attention rule changes.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `frontend/src/features/dashboard/model/dashboard-model.ts` | Sort Area and Project aggregate rows by operational urgency |
| `frontend/tests/domain/dashboard-model.spec.ts` | Prove Miss/incomplete/name ordering for both row types |
| `frontend/src/features/dashboard/ui/DashboardChart.tsx` | Forward optional controlled heatmap visibility props |
| `frontend/src/features/dashboard/ui/DashboardHeatmap.tsx` | Define heatmap visibility props and render a five-row slice with an accessible expand/collapse footer |
| `frontend/src/features/dashboard/ui/DashboardPanel.tsx` | Own independent expansion state and group both cards in one responsive row |
| `frontend/src/styles/globals.css` | Style the nested status grid, footer control, focus state, and matching skeletons |
| `frontend/tests/presentation/dashboard-panel.spec.tsx` | Verify bounded rows, independent controls, layout structure, reset behavior, and navigation |

### Task 1: Add urgency ordering to Dashboard status rows

**Files:**
- Modify: `frontend/src/features/dashboard/model/dashboard-model.ts:100-138`
- Test: `frontend/tests/domain/dashboard-model.spec.ts:20-119`

**Interfaces:**
- Consumes: existing `DashboardHeatmapRow` and `DashboardProjectRow` values from `statusValues`
- Produces: `compareDashboardStatusRows(left, right): number`, used by both Area and Project builders

- [ ] **Step 1: Write the failing Area and Project ordering tests**

Add two tests inside `describe("dashboard model", ...)`. Build each container
with direct Task/Event work so ordering is asserted from real aggregates, not
from a standalone comparator.

```ts
it("orders Area rows by Miss, incomplete, then localized name", () => {
  const snapshot = buildDashboardSnapshot([
    { id: "area-name-z", type: "area", title: "Zulu", status: "active" },
    { id: "area-name-a", type: "area", title: "Alpha", status: "active" },
    { id: "area-incomplete", type: "area", title: "Incomplete", status: "active" },
    { id: "area-miss", type: "area", title: "Miss", status: "active" },
    { id: "miss", type: "task", title: "Miss", status: "missed", area_id: "area-miss" },
    { id: "open-1", type: "task", title: "Open 1", status: "active", area_id: "area-incomplete" },
    { id: "open-2", type: "event", title: "Open 2", status: "waiting", area_id: "area-incomplete" },
  ], today);

  expect(snapshot.areas.map((row) => row.title)).toEqual([
    "Miss",
    "Incomplete",
    "Alpha",
    "Zulu",
  ]);
});

it("orders Project rows by Miss, incomplete, then localized name", () => {
  const snapshot = buildDashboardSnapshot([
    { id: "project-name-z", type: "project", title: "Zulu", status: "active" },
    { id: "project-name-a", type: "project", title: "Alpha", status: "active" },
    { id: "project-incomplete", type: "project", title: "Incomplete", status: "active" },
    { id: "project-miss", type: "project", title: "Miss", status: "active" },
    { id: "miss", type: "event", title: "Miss", status: "missed", project_id: "project-miss" },
    { id: "open-1", type: "task", title: "Open 1", status: "active", project_id: "project-incomplete" },
    { id: "open-2", type: "event", title: "Open 2", status: "waiting", project_id: "project-incomplete" },
  ], today);

  expect(snapshot.projects.map((row) => row.title)).toEqual([
    "Miss",
    "Incomplete",
    "Alpha",
    "Zulu",
  ]);
});
```

- [ ] **Step 2: Run the model tests and verify the new assertions fail**

Run:

```bash
npm --prefix frontend test -- tests/domain/dashboard-model.spec.ts
```

Expected: both new tests fail because `buildAreaStats` and
`buildProjectStats` still preserve source item order.

- [ ] **Step 3: Implement one shared comparator and sort both collections**

Append `.sort(compareDashboardStatusRows)` after the `.map(...)` chain in
both builders. Add this pure helper near `statusValues`:

```ts
function compareDashboardStatusRows(
  left: DashboardHeatmapRow,
  right: DashboardHeatmapRow,
): number {
  return (
    right.values.missed - left.values.missed
    || right.values.incomplete - left.values.incomplete
    || left.title.localeCompare(right.title)
  );
}
```

`DashboardProjectRow` is structurally compatible with
`DashboardHeatmapRow`, so the same comparator covers both arrays. Do not
include completed, paused, progress, or Project attention in the priority.

- [ ] **Step 4: Run the focused model suite**

Run:

```bash
npm --prefix frontend test -- tests/domain/dashboard-model.spec.ts
```

Expected: all Dashboard model tests pass.

- [ ] **Step 5: Commit the ordering change**

```bash
git add frontend/src/features/dashboard/model/dashboard-model.ts \
  frontend/tests/domain/dashboard-model.spec.ts
git commit -m $'[UPDATE] Prioritize Dashboard status rows\n\n- Miss와 미완료가 많은 Area 및 Project를 먼저 표시\n- 동률 항목은 이름순으로 안정적으로 정렬\n- Task와 Event만 집계하는 기존 규칙 유지'
```

### Task 2: Add controlled five-row heatmap previews

**Files:**
- Modify: `frontend/src/features/dashboard/ui/DashboardChart.tsx:9-31`
- Modify: `frontend/src/features/dashboard/ui/DashboardHeatmap.tsx:6-105`
- Test: `frontend/tests/presentation/dashboard-panel.spec.tsx:662-728`

**Interfaces:**
- Consumes: existing `HeatmapChartSpec.rows`
- Produces from `DashboardHeatmap.tsx`: `DashboardHeatmapVisibility` with exact type
  `{ limit: number; expanded: boolean; onExpandedChange(expanded: boolean): void }`
- Produces from `DashboardChart.tsx`: optional
  `heatmapVisibility?: DashboardHeatmapVisibility` forwarding prop
- Produces: `.dashboard-heatmap-footer` and
  `.dashboard-heatmap-toggle` styling hooks

- [ ] **Step 1: Write failing generic heatmap visibility tests**

Extend the existing semantic heatmap presentation test area with a six-row
chart factory and these assertions:

```ts
function heatmapRows(count: number): Extract<
  DashboardChartSpec,
  { kind: "heatmap" }
>["rows"] {
  return Array.from({ length: count }, (_, index) => ({
    id: `area-${index + 1}`,
    label: `Area ${index + 1}`,
    destination: { kind: "area-detail", itemId: `area-${index + 1}` },
    cells: [{
      id: `area-${index + 1}-completed`,
      columnId: "completed",
      value: index,
      intensityPercent: 0,
      ariaLabel: `Area ${index + 1}: ${index} completed`,
    }],
  }));
}
```

Render a heatmap with `limit: 5`, `expanded: false`, and a spy callback, then
assert:

```ts
expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(6);
const toggle = screen.getByRole("button", {
  name: "Area status 전체 보기",
});
expect(toggle).toHaveTextContent("전체 보기 (총 6개)");
expect(toggle).toHaveAttribute("aria-expanded", "false");
await user.click(toggle);
expect(onExpandedChange).toHaveBeenCalledWith(true);
```

Add a separate render with exactly five rows and assert:

```ts
expect(
  screen.queryByRole("button", { name: "Area status 전체 보기" }),
).toBeNull();
```

- [ ] **Step 2: Run the focused presentation test and verify it fails**

Run:

```bash
npm --prefix frontend test -- tests/presentation/dashboard-panel.spec.tsx
```

Expected: TypeScript compilation or the new assertions fail because
`DashboardChart` does not accept `heatmapVisibility` and every row is rendered.

- [ ] **Step 3: Forward controlled visibility through `DashboardChart`**

Export this type from `DashboardHeatmap.tsx`:

```ts
export type DashboardHeatmapVisibility = {
  limit: number;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
};
```

Import that type into `DashboardChart.tsx` alongside `DashboardHeatmap`, then
extend its props:

```ts
type DashboardChartProps = {
  chart: DashboardChartSpec;
  onNavigate: (destination: DashboardDestination) => void;
  heatmapVisibility?: DashboardHeatmapVisibility;
};
```

In the heatmap branch, pass
`visibility={props.heatmapVisibility}`. Donut and line behavior must remain
unchanged.

- [ ] **Step 4: Render the bounded slice and accessible control**

In `DashboardHeatmap`, accept
`visibility?: DashboardHeatmapVisibility` and derive:

```ts
const canExpand = visibility !== undefined
  && chart.rows.length > visibility.limit;
const visibleRows = canExpand && !visibility.expanded
  ? chart.rows.slice(0, visibility.limit)
  : chart.rows;
```

Change the table body to map `visibleRows`. After the horizontal-scroll
wrapper, render:

```tsx
{canExpand ? (
  <footer className="dashboard-heatmap-footer">
    <button
      type="button"
      className="dashboard-heatmap-toggle"
      aria-expanded={visibility.expanded}
      aria-label={`${chart.ariaLabel} ${
        visibility.expanded ? "접기" : "전체 보기"
      }`}
      onClick={() =>
        visibility.onExpandedChange(!visibility.expanded)}
    >
      {visibility.expanded
        ? "접기"
        : `전체 보기 (총 ${chart.rows.length}개)`}
    </button>
  </footer>
) : null}
```

Do not add internal vertical scrolling. Without `heatmapVisibility`, the
generic chart continues to render all rows and no footer, preserving existing
call sites.

- [ ] **Step 5: Run the focused presentation suite**

Run:

```bash
npm --prefix frontend test -- tests/presentation/dashboard-panel.spec.tsx
```

Expected: all Dashboard presentation tests pass, including the new generic
five-row behavior.

- [ ] **Step 6: Commit the generic heatmap behavior**

```bash
git add frontend/src/features/dashboard/ui/DashboardChart.tsx \
  frontend/src/features/dashboard/ui/DashboardHeatmap.tsx \
  frontend/tests/presentation/dashboard-panel.spec.tsx
git commit -m $'[UPDATE] Bound Dashboard heatmap previews\n\n- Heatmap 행을 지정된 개수로 제한하는 제어형 인터페이스 추가\n- 전체 보기와 접기 버튼에 확장 상태 및 카드 식별자 제공\n- 기존 셀 탐색과 범용 전체 행 렌더링 유지'
```

### Task 3: Integrate independent status cards and responsive layout

**Files:**
- Modify: `frontend/src/features/dashboard/ui/DashboardPanel.tsx:22-188`
- Modify: `frontend/src/styles/globals.css:2532-2547`
- Modify: `frontend/src/styles/globals.css:2915-3035`
- Modify: `frontend/src/styles/globals.css:3060-3142`
- Test: `frontend/tests/presentation/dashboard-panel.spec.tsx:150-493`

**Interfaces:**
- Consumes: `DashboardHeatmapVisibility` from `DashboardHeatmap.tsx`
- Produces: `.dashboard-status-grid` containing separate Area and Project
  region cards
- Produces: `.dashboard-status-skeleton-grid` matching the loaded layout
- Uses: `DASHBOARD_STATUS_PREVIEW_LIMIT = 5`

- [ ] **Step 1: Add failing panel integration tests**

Add a helper that produces six Areas and six Projects with distinct names and
direct work. Then add a test that loads those items and asserts:

```ts
const statusGrid = document.querySelector(".dashboard-status-grid");
const area = screen.getByRole("region", { name: "Area status" });
const project = screen.getByRole("region", { name: "Project status" });

expect(statusGrid).toContainElement(area);
expect(statusGrid).toContainElement(project);
expect(area).not.toBe(project);
expect(within(area).getAllByRole("row")).toHaveLength(6);
expect(within(project).getAllByRole("row")).toHaveLength(6);
```

The six rows include one table header plus five data rows. Then click only the
Area control and assert independence:

```ts
await user.click(within(area).getByRole("button", {
  name: "Area status 전체 보기",
}));

expect(within(area).getAllByRole("row")).toHaveLength(7);
expect(within(project).getAllByRole("row")).toHaveLength(6);
expect(within(area).getByRole("button", {
  name: "Area status 접기",
})).toHaveAttribute("aria-expanded", "true");
expect(within(project).getByRole("button", {
  name: "Project status 전체 보기",
})).toHaveAttribute("aria-expanded", "false");
```

Add a rerender-level test for an expanded controlled heatmap whose rows shrink
from six to five. Assert that `onExpandedChange(false)` is emitted exactly
once. This proves refreshed data returns the parent-owned state to collapsed
without needing to exercise the fetch controller.

- [ ] **Step 2: Run the presentation suite and verify the integration fails**

Run:

```bash
npm --prefix frontend test -- tests/presentation/dashboard-panel.spec.tsx
```

Expected: the shared grid is absent, all six rows render, and no independent
Area/Project controls exist.

- [ ] **Step 3: Own expansion state and group the two widgets**

Add:

```ts
const DASHBOARD_STATUS_PREVIEW_LIMIT = 5;
type DashboardStatusWidgetId = "area-status" | "project-status";
```

In `DashboardPanel`, create:

```ts
const [expandedStatus, setExpandedStatus] = React.useState<
  Record<DashboardStatusWidgetId, boolean>
>({ "area-status": false, "project-status": false });
```

Build the four widget models once. Render Today's work and Completion history
as direct grid children. Render Area and Project inside:

```tsx
type DashboardStatusWidgetModel = DashboardWidgetModel & {
  id: DashboardStatusWidgetId;
};

function isDashboardStatusWidget(
  model: DashboardWidgetModel,
): model is DashboardStatusWidgetModel {
  return model.id === "area-status" || model.id === "project-status";
}

const models = dashboardWidgets.map((widget) => widget.build(snapshot));
const primaryModels = models.filter((model) =>
  !isDashboardStatusWidget(model));
const statusModels = models.filter(isDashboardStatusWidget);

<div className="dashboard-status-grid">
  {statusModels.map((model) => (
    <DashboardWidget
      key={model.id}
      model={model}
      onNavigate={controller.navigateDashboard}
      heatmapVisibility={{
        limit: DASHBOARD_STATUS_PREVIEW_LIMIT,
        expanded: expandedStatus[model.id],
        onExpandedChange: (expanded) =>
          setExpandedStatus((current) => ({
            ...current,
            [model.id]: expanded,
          })),
      }}
    />
  ))}
</div>
```

Map `primaryModels` with the existing completion-range controls before the
status grid. Extend `DashboardWidgetProps` and forward `heatmapVisibility` to
`DashboardChart`.

In `DashboardHeatmap`, add an effect that requests collapse only when the
controlled value is expanded and the row count is at or below the limit:

```ts
const expanded = visibility?.expanded ?? false;
const limit = visibility?.limit ?? chart.rows.length;
const onExpandedChange = visibility?.onExpandedChange;

React.useEffect(() => {
  if (expanded && chart.rows.length <= limit) {
    onExpandedChange?.(false);
  }
}, [chart.rows.length, expanded, limit, onExpandedChange]);
```

The effect must not run for an already collapsed card. In the integration
test, rerender the controlled chart with `expanded: false` after receiving the
collapse request, matching the parent state update.

- [ ] **Step 4: Mirror the loaded grouping in the skeleton**

Keep four skeleton cards and render the two status skeletons inside:

```tsx
<div className="dashboard-status-skeleton-grid">
  {dashboardWidgets
    .filter((widget) =>
      widget.id === "area-status" || widget.id === "project-status")
    .map((widget) => (
      <div
        className={`dashboard-skeleton-card dashboard-skeleton-${widget.id}`}
        data-testid="dashboard-skeleton-card"
        aria-hidden="true"
        key={widget.id}
      >
        <span />
        <span />
        <span />
      </div>
    ))}
</div>
```

The existing test must continue to find exactly four
`dashboard-skeleton-card` elements.

- [ ] **Step 5: Add responsive grid and footer styling**

Replace the full-width Area/Project selectors with:

```css
.dashboard-status-grid,
.dashboard-status-skeleton-grid {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns:
    repeat(auto-fit, minmax(min(100%, 760px), 1fr));
  gap: 16px;
}

.dashboard-widget-area-status,
.dashboard-widget-project-status,
.dashboard-skeleton-area-status,
.dashboard-skeleton-project-status {
  min-width: 0;
}
```

This produces two equal cards when the available content width can support
both readable tables and automatically collapses to one column before either
card becomes too narrow.

Add footer styles:

```css
.dashboard-heatmap-footer {
  display: flex;
  justify-content: center;
  border-top: 1px solid var(--color-hairline-light);
  padding-top: 12px;
}

.dashboard-heatmap-toggle {
  border: 1px solid var(--color-hairline-light);
  border-radius: var(--radius-pill);
  background: var(--color-canvas-light);
  padding: 7px 12px;
  color: var(--color-ink);
  font-size: 12px;
  font-weight: 700;
}
```

Include `.dashboard-heatmap-toggle` in the existing hover/focus-visible and
reduced-motion selector groups. Add a hover rule that changes its border to
`var(--color-ink)`. At the 767px mobile breakpoint, assign only the two group
wrappers to `grid-column: 1`; their inner auto-fit grid already collapses to
one column.

- [ ] **Step 6: Run the complete frontend verification gates**

Run:

```bash
npm --prefix frontend test
npm --prefix frontend run typecheck
npm --prefix frontend run build
```

Expected: all Vitest suites pass, TypeScript reports no errors, and Next.js
finishes a production build.

- [ ] **Step 7: Perform a browser smoke check**

Start the existing local frontend/API workflow if it is not already running:

```bash
npm --prefix frontend run dev:with-api
```

At a wide viewport, verify Area and Project are separate equal-width cards on
one row. Narrow the viewport until they become a vertical sequence. With more
than five entries, verify only five appear initially, each card expands
independently, table horizontal scrolling still works, and row/cell
navigation still opens the matching detail panel.

- [ ] **Step 8: Commit the panel integration and styling**

```bash
git add frontend/src/features/dashboard/ui/DashboardPanel.tsx \
  frontend/src/features/dashboard/ui/DashboardHeatmap.tsx \
  frontend/src/styles/globals.css \
  frontend/tests/presentation/dashboard-panel.spec.tsx
git commit -m $'[UPDATE] Arrange Dashboard status cards\n\n- Area와 Project를 공간에 따라 한 행 또는 세로로 배치\n- 카드별 5개 미리보기와 독립적인 전체 보기 상태 연결\n- 로딩 스켈레톤과 키보드 포커스 스타일을 동일 구조로 정렬'
```

### Task 4: Final regression and documentation check

**Files:**
- Verify: `docs/superpowers/specs/2026-07-29-dashboard-area-project-card-layout-design.md`
- Verify: all files changed by Tasks 1-3

**Interfaces:**
- Consumes: completed model, heatmap, panel, CSS, and test changes
- Produces: a clean, verified implementation matching the approved design

- [ ] **Step 1: Compare the implementation with every design requirement**

Confirm all of the following directly in code and tests:

```text
separate Area and Project cards
wide two-column / narrow one-column layout
Miss -> incomplete -> localized name ordering
five-row preview
전체 보기 (총 N개) / 접기
independent expansion
collapse request after row count falls to five
aria-expanded and card-specific accessible names
unchanged Task/Event-only counts and detail navigation
```

- [ ] **Step 2: Run formatting and repository diff checks**

Run:

```bash
git diff --check
git status --short
git log --oneline -n 6
```

Expected: no whitespace errors; only intended implementation changes remain;
the three task commits are clear and ordered.

- [ ] **Step 3: Decide whether stable documentation needs synchronization**

Invoke the project `docs-change-updater` skill against the landed code diff.
The design is Dashboard presentation behavior; update stable docs only if an
existing current-state Dashboard section promises the old full-width,
unbounded layout. Do not duplicate the design spec into README or operational
documentation.

- [ ] **Step 4: Re-run the final verification gate after any documentation-only change**

If documentation changed, run:

```bash
git diff --check
npm --prefix frontend test
npm --prefix frontend run typecheck
npm --prefix frontend run build
```

Expected: all checks still pass.
