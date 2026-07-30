# Completion History Axes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add readable date and completion-count axes to the Dashboard completion-history chart.

**Architecture:** Keep axis derivation and rendering inside the existing `DashboardLineChart`; the chart already owns point positioning and has every required label and value. Derive X-axis ticks from range length rather than preset names, derive integer Y-axis ticks from the observed maximum, and style the labels around the existing plot without changing the model or API.

**Tech Stack:** React 18, TypeScript, CSS, Vitest, Testing Library

## Global Constraints

- Show every X-axis date for ranges containing seven or fewer points.
- Use the same evenly spaced X-axis algorithm for longer preset and custom ranges.
- Always include the first and last dates on the X-axis.
- Show integer Y-axis ticks from zero through the observed maximum.
- Preserve existing point tooltips, keyboard focus, and accessible point labels.
- Add no dependency and no dashboard model or API field.

---

### Task 1: Render and style derived chart axes

**Files:**
- Modify: `frontend/src/features/dashboard/ui/DashboardLineChart.tsx`
- Modify: `frontend/src/styles/globals.css`
- Test: `frontend/tests/presentation/dashboard-panel.spec.tsx`

**Interfaces:**
- Consumes: `LineChartSpec.points`, where each point has `id`, `label`, `value`, and `ariaLabel`.
- Produces: visible `.dashboard-line-x-tick` date labels and `.dashboard-line-y-tick` integer labels; no exported interface changes.

- [ ] **Step 1: Write failing presentation tests**

Extend the existing `"renders informational line points as focusable images without navigation"` area with focused chart cases:

```tsx
it("shows every date for a seven-point completion range", () => {
  const points = Array.from({ length: 7 }, (_, index) => ({
    id: `2026-07-${String(index + 1).padStart(2, "0")}`,
    label: `2026-07-${String(index + 1).padStart(2, "0")}`,
    value: index,
    ariaLabel: `2026-07-${String(index + 1).padStart(2, "0")}: ${index} completed`,
  }));

  const { container } = render(
    <DashboardChart
      chart={{
        kind: "line",
        ariaLabel: "Completion history",
        points,
      }}
      onNavigate={vi.fn()}
    />,
  );

  expect(
    Array.from(container.querySelectorAll(".dashboard-line-x-tick"),
      (tick) => tick.textContent),
  ).toEqual(points.map((point) => point.label));
});

it("derives sparse endpoint-inclusive dates and integer counts", () => {
  const points = Array.from({ length: 30 }, (_, index) => ({
    id: `2026-07-${String(index + 1).padStart(2, "0")}`,
    label: `2026-07-${String(index + 1).padStart(2, "0")}`,
    value: index === 12 ? 7 : 0,
    ariaLabel: `Day ${index + 1}`,
  }));

  const { container } = render(
    <DashboardChart
      chart={{
        kind: "line",
        ariaLabel: "Completion history",
        points,
      }}
      onNavigate={vi.fn()}
    />,
  );

  const dates = Array.from(
    container.querySelectorAll(".dashboard-line-x-tick"),
    (tick) => tick.textContent,
  );
  const counts = Array.from(
    container.querySelectorAll(".dashboard-line-y-tick"),
    (tick) => Number(tick.textContent),
  );

  expect(dates).toHaveLength(7);
  expect(dates.at(0)).toBe(points.at(0)?.label);
  expect(dates.at(-1)).toBe(points.at(-1)?.label);
  expect(counts.at(0)).toBe(7);
  expect(counts.at(-1)).toBe(0);
  expect(counts.every(Number.isInteger)).toBe(true);
});
```

- [ ] **Step 2: Run the focused tests and verify failure**

Run:

```bash
cd frontend
npx vitest run --no-file-parallelism tests/presentation/dashboard-panel.spec.tsx
```

Expected: FAIL because `.dashboard-line-x-tick` and `.dashboard-line-y-tick` do not exist.

- [ ] **Step 3: Implement minimal tick derivation and markup**

In `DashboardLineChart.tsx`, retain the current `maximum` and `coordinates`, then derive ticks locally:

```tsx
const maximumXAxisTicks = 7;
const xTickStep = Math.max(
  1,
  Math.ceil((coordinates.length - 1) / (maximumXAxisTicks - 1)),
);
const xTicks = coordinates.filter(
  (_, index) =>
    coordinates.length <= maximumXAxisTicks ||
    index === 0 ||
    index === coordinates.length - 1 ||
    index % xTickStep === 0,
);
const yTickStep = Math.max(1, Math.ceil(maximum / 4));
const yTicks = [
  ...Array.from(
    { length: Math.ceil(maximum / yTickStep) },
    (_, index) => index * yTickStep,
  ),
  maximum,
].filter((tick, index, ticks) => ticks.indexOf(tick) === index).reverse();
```

Wrap the existing plot in `.dashboard-line-frame`. Add a hidden-from-screen-readers Y-axis before the plot and an X-axis after it; accessible point labels continue to describe the complete data:

```tsx
<div className="dashboard-line-frame">
  <div className="dashboard-line-y-axis" aria-hidden="true">
    {yTicks.map((tick) => (
      <span
        key={tick}
        className="dashboard-line-y-tick"
        style={{ top: `${94 - (tick / maximum) * 84}%` }}
      >
        {tick}
      </span>
    ))}
  </div>

  <div className="dashboard-line-plot">
    <svg
      className="dashboard-line-svg"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <polyline
        className="dashboard-line-path"
        points={coordinates
          .map((point) => `${point.x},${point.y}`)
          .join(" ")}
      />
    </svg>
    {coordinates.map((point) => (
      <span
        key={point.id}
        className="dashboard-line-point"
        role="img"
        tabIndex={0}
        aria-label={point.ariaLabel}
        style={{ left: `${point.x}%`, top: `${point.y}%` }}
      >
        <span className="dashboard-line-marker" aria-hidden="true" />
        <span className="dashboard-line-tooltip">{point.ariaLabel}</span>
      </span>
    ))}
  </div>

  <div className="dashboard-line-x-axis" aria-hidden="true">
    {xTicks.map((tick, index) => (
      <time
        key={tick.id}
        className="dashboard-line-x-tick"
        dateTime={tick.label}
        data-edge={
          index === 0 ? "start" : index === xTicks.length - 1 ? "end" : undefined
        }
        style={{ left: `${tick.x}%` }}
      >
        {tick.label}
      </time>
    ))}
  </div>
</div>
```

- [ ] **Step 4: Style the axes around the existing plot**

Replace the plot width/margin workaround and add the following layout in `globals.css`:

```css
.dashboard-line-frame {
  display: grid;
  grid-template:
    "y plot" 210px
    ". x" auto / 28px minmax(0, 1fr);
  gap: 6px 8px;
}

.dashboard-line-plot {
  grid-area: plot;
  position: relative;
  width: 100%;
  height: 210px;
  border-bottom: 1px solid var(--color-hairline-light);
  background:
    linear-gradient(
      to bottom,
      transparent 49%,
      var(--color-hairline-light) 50%,
      transparent 51%
    );
}

.dashboard-line-x-axis,
.dashboard-line-y-axis {
  position: relative;
  color: var(--color-text-muted);
  font-size: 11px;
  line-height: 1;
}

.dashboard-line-x-axis {
  grid-area: x;
  min-height: 12px;
}

.dashboard-line-y-axis {
  grid-area: y;
}

.dashboard-line-x-tick,
.dashboard-line-y-tick {
  position: absolute;
  white-space: nowrap;
}

.dashboard-line-x-tick {
  transform: translateX(-50%);
}

.dashboard-line-x-tick[data-edge="start"] {
  transform: none;
}

.dashboard-line-x-tick[data-edge="end"] {
  transform: translateX(-100%);
}

.dashboard-line-y-tick {
  right: 0;
  transform: translateY(-50%);
}
```

- [ ] **Step 5: Run focused and complete frontend verification**

Run:

```bash
cd frontend
npx vitest run --no-file-parallelism tests/presentation/dashboard-panel.spec.tsx
npm test
npm run typecheck
```

Expected: all commands PASS.

- [ ] **Step 6: Commit the implementation**

```bash
git add frontend/src/features/dashboard/ui/DashboardLineChart.tsx \
  frontend/src/styles/globals.css \
  frontend/tests/presentation/dashboard-panel.spec.tsx
git commit -m "[UPDATE] Show completion history chart axes" \
  -m "- 7일 범위의 모든 날짜와 장기 범위의 균등 날짜 눈금을 표시
- 완료 수에 따라 정수 Y축 눈금을 자동 계산
- 기존 포인트 툴팁과 키보드 접근성을 유지"
```
