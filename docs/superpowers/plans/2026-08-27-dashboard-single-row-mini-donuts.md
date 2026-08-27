# Dashboard Single-Row Mini Donuts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace separate Area and Project heatmaps with one tabbed mini-donut Status card and fit all three Dashboard cards on one wide-screen row.

**Architecture:** Preserve the existing Dashboard snapshot calculations and two status widget builders, but replace their heatmap presentation contract with a status-row contract containing explicit segments, totals, attention, and numeric progress. A focused donut-grid renderer and tabbed Status card consume those models; DashboardPanel coordinates scope-specific expansion and the responsive three-card layout.

**Tech Stack:** React 18, TypeScript, CSS Grid, Vitest, Testing Library

---

### Task 1: Replace the heatmap presentation model with status rows

**Files:**
- Modify: `frontend/src/features/dashboard/model/dashboard-widgets.ts`
- Modify: `frontend/tests/domain/dashboard-widgets.spec.ts`

- [ ] **Step 1: Write failing status-model expectations**

Update the Area and Project widget expectations to require `chart.kind: "status"`, `scope`, `total`, and explicit segments. Reorder the Project fixture to normal, attention, risk and expect Risk-first output:

```ts
expect(areaModel).toMatchObject({
  chart: {
    kind: "status",
    scope: "area",
    rows: [{
      label: "Health",
      total: 4,
      segments: [
        { id: "completed", value: 2, percentage: 50 },
        { id: "incomplete", value: 1, percentage: 25 },
        { id: "paused", value: 1, percentage: 25 },
        { id: "missed", value: 0, percentage: 0 },
      ],
    }],
  },
});

expect(projectModel).toMatchObject({
  chart: {
    kind: "status",
    scope: "project",
    rows: [
      { label: "Release", progressPercent: 82, attention: "risk" },
      { label: "Watch", progressPercent: 50, attention: "attention" },
      { label: "Unplanned", progressPercent: null, attention: "normal" },
    ],
  },
});
```

- [ ] **Step 2: Run the domain test and confirm RED**

Run: `npm --prefix frontend test -- tests/domain/dashboard-widgets.spec.ts`

Expected: FAIL because both status widgets still expose `kind: "heatmap"` and string-only progress.

- [ ] **Step 3: Add the status chart contract**

Replace `HeatmapChartSpec` with these presentation types and include `StatusChartSpec` in `DashboardChartSpec`:

```ts
export type StatusChartSpec = {
  kind: "status";
  scope: "area" | "project";
  ariaLabel: string;
  rows: Array<{
    id: string;
    label: string;
    total: number;
    progressPercent?: number | null;
    attention?: ProjectAttention;
    destination: DashboardDestination;
    segments: Array<{
      id: DashboardStatusKey;
      label: string;
      value: number;
      percentage: number;
      tone: "success" | "primary" | "secondary" | "warning";
      ariaLabel: string;
    }>;
  }>;
};
```

Rename `heatmapColumns` to `statusSegments` and `heatmapRows` to `statusRows`. Map existing values without recalculation:

```ts
function statusRows(
  sourceRows: DashboardHeatmapRow[],
  destination: (row: DashboardHeatmapRow) => DashboardDestination,
): StatusChartSpec["rows"] {
  return sourceRows.map((row) => ({
    id: row.id,
    label: row.title,
    total: row.total,
    destination: destination(row),
    segments: statusSegments.map((segment) => ({
      ...segment,
      value: row.values[segment.id],
      percentage: row.percentages[segment.id],
      ariaLabel: `${row.title}: ${row.values[segment.id]} ${segment.label.toLowerCase()}`,
    })),
  }));
}
```

Build Area charts with `scope: "area"`. Build Project rows from a stable Risk-first ordering and add numeric progress:

```ts
const attentionRank: Record<ProjectAttention, number> = {
  risk: 0,
  attention: 1,
  normal: 2,
};

const projects = [...snapshot.projects].sort(
  (left, right) => attentionRank[left.attention] - attentionRank[right.attention],
);
const rows: StatusChartSpec["rows"] = statusRows(
  projects,
  (project) => ({ kind: "project-detail", itemId: project.id }),
).map((row, index) => ({
  ...row,
  progressPercent: projects[index].progress === null
    ? null
    : Math.round(projects[index].progress * 100),
  attention: projects[index].attention,
}));
```

- [ ] **Step 4: Run the focused model test**

Run: `npm --prefix frontend test -- tests/domain/dashboard-widgets.spec.ts`

Expected: PASS.

Leave these model changes uncommitted until Task 2 replaces the renderer, so every commit remains type-correct.

### Task 2: Replace the heatmap renderer with a mini-donut grid

**Files:**
- Delete: `frontend/src/features/dashboard/ui/DashboardHeatmap.tsx`
- Create: `frontend/src/features/dashboard/ui/DashboardStatusDonutGrid.tsx`
- Modify: `frontend/src/features/dashboard/ui/DashboardChart.tsx`
- Modify: `frontend/tests/presentation/dashboard-panel.spec.tsx`

- [ ] **Step 1: Replace the direct heatmap test with a failing donut-grid test**

Replace the semantic heatmap test with a `kind: "status"` chart containing Area and Project rows. Assert:

```ts
expect(screen.getByRole("button", {
  name: "Release: Progress 50%, Risk, 2 completed, 1 incomplete, 0 paused, 1 miss",
})).toBeInTheDocument();
expect(screen.getByText("50%", { selector: ".dashboard-status-donut-center" }))
  .toBeInTheDocument();
expect(screen.getByText("Risk / Miss 1 / Total 4")).toBeInTheDocument();
```

Click the Release tile and expect `{ kind: "project-detail", itemId: "project-release" }`. Preserve the controlled preview test with limit `4`, six rows, and expand/collapse callbacks.

- [ ] **Step 2: Run the presentation test and confirm RED**

Run: `npm --prefix frontend test -- tests/presentation/dashboard-panel.spec.tsx`

Expected: FAIL because `DashboardStatusDonutGrid` and the `status` chart branch do not exist.

- [ ] **Step 3: Implement the focused renderer**

Create `DashboardStatusDonutGrid.tsx` with this public contract:

```ts
export type DashboardStatusVisibility = {
  limit: number;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
};

type DashboardStatusDonutGridProps = {
  chart: StatusChartSpec;
  onNavigate: (destination: DashboardDestination) => void;
  visibility?: DashboardStatusVisibility;
};
```

For each visible row, derive cumulative segment stops and render one button:

```tsx
const completedEnd = segmentPercentage(row, "completed");
const incompleteEnd = completedEnd + segmentPercentage(row, "incomplete");
const pausedEnd = incompleteEnd + segmentPercentage(row, "paused");
const center = chart.scope === "project"
  ? row.progressPercent === null ? "—" : `${row.progressPercent}%`
  : String(row.total);
const attention = row.attention ?? "normal";

<button
  type="button"
  className={`dashboard-status-tile attention-${attention}`}
  aria-label={statusTileAriaLabel(chart.scope, row)}
  onClick={() => onNavigate(row.destination)}
>
  <span
    className="dashboard-status-donut"
    style={{
      "--dashboard-status-completed-end": `${completedEnd}%`,
      "--dashboard-status-incomplete-end": `${incompleteEnd}%`,
      "--dashboard-status-paused-end": `${pausedEnd}%`,
    } as React.CSSProperties}
  >
    <span className="dashboard-status-donut-center">{center}</span>
  </span>
  <span className="dashboard-status-tile-copy">
    <strong>{row.label}</strong>
    <span>{chart.scope === "project"
      ? `${attentionLabel(attention)} / Miss ${segmentValue(row, "missed")} / Total ${row.total}`
      : `Completed ${Math.round(segmentPercentage(row, "completed"))}% / Total ${row.total}`}
    </span>
  </span>
</button>
```

Reuse the previous controlled preview behavior: slice to the limit, show an accessible expand button only when needed, and request collapse in an effect when row count falls to the limit or below. Keep all helper functions file-local.

Update `DashboardChart` to import the new component and render it for `case "status"`, forwarding `statusVisibility`. Remove all heatmap imports and branches.

- [ ] **Step 4: Run renderer tests and commit**

Run: `npm --prefix frontend test -- tests/presentation/dashboard-panel.spec.tsx`

Expected: the direct status renderer and controlled-preview tests PASS; DashboardPanel integration tests may still fail until Task 3.

Run: `npm --prefix frontend run typecheck`

Expected: PASS.

Commit:

```powershell
git add -- frontend/src/features/dashboard/model/dashboard-widgets.ts frontend/src/features/dashboard/ui/DashboardHeatmap.tsx frontend/src/features/dashboard/ui/DashboardStatusDonutGrid.tsx frontend/src/features/dashboard/ui/DashboardChart.tsx frontend/tests/domain/dashboard-widgets.spec.ts frontend/tests/presentation/dashboard-panel.spec.tsx
git commit -m "[UPDATE] Render dashboard status mini donuts"
```

### Task 3: Combine status widgets into an accessible tabbed card

**Files:**
- Create: `frontend/src/features/dashboard/ui/DashboardStatusCard.tsx`
- Modify: `frontend/src/features/dashboard/ui/DashboardPanel.tsx`
- Modify: `frontend/tests/presentation/dashboard-panel.spec.tsx`

- [ ] **Step 1: Write failing Status card integration tests**

Update DashboardPanel expectations from four regions to three: Today's work, Completion history, and Status. Add a test that:

```ts
const status = screen.getByRole("region", { name: "Status" });
const projectTab = within(status).getByRole("tab", { name: "Project" });
const areaTab = within(status).getByRole("tab", { name: "Area" });
expect(projectTab).toHaveAttribute("aria-selected", "true");
expect(within(status).getByRole("button", { name: /Release: Progress 25%, Risk/ }))
  .toBeVisible();

await user.click(areaTab);
expect(areaTab).toHaveAttribute("aria-selected", "true");
expect(within(status).getByRole("button", { name: /Health: 4 total/ }))
  .toBeVisible();
```

Add ArrowLeft/ArrowRight/Home/End assertions, separate empty messages by selected scope, four-tile preview behavior, scope-specific expansion persistence, and detail navigation. Change loading skeleton count from four to three.

- [ ] **Step 2: Run DashboardPanel tests and confirm RED**

Run: `npm --prefix frontend test -- tests/presentation/dashboard-panel.spec.tsx`

Expected: FAIL because the status models still render as separate cards.

- [ ] **Step 3: Implement DashboardStatusCard**

Create a component that accepts the two narrowed status models, navigation, and scope-specific visibility. Keep the type local because this is its only consumer:

```ts
type StatusScope = "project" | "area";

type DashboardStatusModel = DashboardWidgetModel & {
  id: "area-status" | "project-status";
  chart: StatusChartSpec;
};

type DashboardStatusCardProps = {
  models: Record<StatusScope, DashboardStatusModel>;
  onNavigate: (destination: DashboardDestination) => void;
  visibility: Record<StatusScope, DashboardStatusVisibility>;
};
```

Use local `scope` state initialized to `"project"`. Keep refs for both tab buttons. ArrowRight/ArrowLeft wrap, Home selects Project, End selects Area; each keyboard change calls `setScope(nextScope)` and `tabRefs.current[nextScope]?.focus()`. Render:

```tsx
<section className="dashboard-widget dashboard-widget-status" aria-label="Status">
  <header className="dashboard-widget-header">
    <div className="dashboard-widget-heading">
      <h2>Status</h2>
      <p>Task and Event status by Project or Area.</p>
    </div>
  </header>
  <div className="dashboard-status-tabs" role="tablist" aria-label="Status scope">
    {(["project", "area"] as const).map((candidate) => (
      <button
        key={candidate}
        id={`dashboard-status-tab-${candidate}`}
        role="tab"
        aria-selected={scope === candidate}
        aria-controls={`dashboard-status-panel-${candidate}`}
        tabIndex={scope === candidate ? 0 : -1}
        onClick={() => setScope(candidate)}
        onKeyDown={(event) => onTabKeyDown(event, candidate)}
      >
        {candidate === "project" ? "Project" : "Area"}
      </button>
    ))}
  </div>
  <div
    id={`dashboard-status-panel-${scope}`}
    role="tabpanel"
    aria-labelledby={`dashboard-status-tab-${scope}`}
  >
    {selected.chart.rows.length === 0
      ? <p className="dashboard-widget-empty">{selected.emptyMessage}</p>
      : <DashboardStatusDonutGrid
          chart={selected.chart}
          onNavigate={onNavigate}
          visibility={visibility[scope]}
        />}
  </div>
</section>
```

- [ ] **Step 4: Integrate the card in DashboardPanel**

Set `DASHBOARD_STATUS_PREVIEW_LIMIT = 4`. Keep filtering the two existing status models, but render one `DashboardStatusCard` instead of mapping two `DashboardWidget` cards. Preserve the existing per-scope expansion record and row-count collapse effect. Remove heatmap props from generic `DashboardWidget`.

In loading state, render the two primary skeletons plus one `dashboard-skeleton-status` card.

- [ ] **Step 5: Run and commit Status card behavior**

Run: `npm --prefix frontend test -- tests/presentation/dashboard-panel.spec.tsx`

Expected: PASS.

Run: `npm --prefix frontend run typecheck`

Expected: PASS.

Commit:

```powershell
git add -- frontend/src/features/dashboard/ui/DashboardStatusCard.tsx frontend/src/features/dashboard/ui/DashboardPanel.tsx frontend/tests/presentation/dashboard-panel.spec.tsx
git commit -m "[UPDATE] Combine dashboard status cards"
```

### Task 4: Apply the selected single-row responsive layout

**Files:**
- Modify: `frontend/src/styles/globals.css`
- Modify: `frontend/tests/architecture/design-boundaries.spec.ts`

- [ ] **Step 1: Replace old CSS contract expectations**

Expect the wide-screen ratio and the two fallbacks:

```ts
expect(source).toMatch(
  /@media \(min-width: 1440px\)[\s\S]*?\.dashboard-panel,\n  \.dashboard-loading \{[\s\S]*?grid-template-columns: minmax\(0, 22fr\) minmax\(0, 43fr\) minmax\(0, 35fr\);/,
);
expect(source).toMatch(
  /@media \(min-width: 768px\) and \(max-width: 1439px\)[\s\S]*?\.dashboard-widget-status[\s\S]*?grid-column: 1 \/ -1;/,
);
expect(source).toMatch(
  /@media \(max-width: 767px\)[\s\S]*?\.dashboard-widget-status[\s\S]*?grid-column: 1;/,
);
```

Also expect mini-donut conic-gradient, attention border classes, two-column tile grid, focus-visible styling, and the reduced-motion selector.

- [ ] **Step 2: Run the architecture test and confirm RED**

Run: `npm --prefix frontend test -- tests/architecture/design-boundaries.spec.ts`

Expected: FAIL on the old four/eight-column and two-card status layout.

- [ ] **Step 3: Implement the layout and selected visual styling**

At `1440px` and wider, set both loaded and loading containers to the approved ratio and assign Today, History, and Status to columns 1, 2, and 3. At medium width, retain the current 4/8 split for Today and History and span Status across all columns. At mobile, stack all three.

Add component styles using existing color tokens:

```css
.dashboard-status-tile-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.dashboard-status-donut {
  background: conic-gradient(
    var(--color-accent-strong) 0 var(--dashboard-status-completed-end),
    var(--color-ink) var(--dashboard-status-completed-end) var(--dashboard-status-incomplete-end),
    var(--color-shade-30) var(--dashboard-status-incomplete-end) var(--dashboard-status-paused-end),
    var(--color-danger-text) var(--dashboard-status-paused-end) 100%
  );
}

.dashboard-status-tile.attention-risk { border-color: var(--color-danger-text); }
.dashboard-status-tile.attention-attention { border-color: var(--color-chart-secondary); }
```

Use text labels in addition to borders, keep visible focus styles, and include all new interactive selectors in the existing reduced-motion rule.

- [ ] **Step 4: Run CSS and focused Dashboard verification**

Run: `npm --prefix frontend test -- tests/architecture/design-boundaries.spec.ts tests/domain/dashboard-widgets.spec.ts tests/presentation/dashboard-panel.spec.tsx`

Expected: PASS.

Run: `npm --prefix frontend run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit the layout**

```powershell
git add -- frontend/src/styles/globals.css frontend/tests/architecture/design-boundaries.spec.ts
git commit -m "[UPDATE] Fit dashboard cards on one wide row"
```

### Task 5: Verify the complete Dashboard change

**Files:**
- Verify only

- [ ] **Step 1: Run focused tests**

Run: `npm --prefix frontend test -- tests/domain/dashboard-model.spec.ts tests/domain/dashboard-widgets.spec.ts tests/presentation/dashboard-panel.spec.tsx tests/architecture/design-boundaries.spec.ts`

Expected: PASS.

- [ ] **Step 2: Run static and full verification**

Run: `npm --prefix frontend run typecheck`

Expected: exits with code 0.

Run: `npm --prefix frontend test`

Expected: every frontend test passes.

- [ ] **Step 3: Inspect final scope**

Run: `git status --short`, `git diff --check`, and `git log --oneline main..HEAD`.

Expected: clean worktree, no whitespace errors, and only the planned Dashboard commits.
