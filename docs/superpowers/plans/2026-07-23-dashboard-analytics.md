# Dashboard Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a graph-led Dashboard that analyzes Area, Project, and Planner work and navigates to the corresponding existing views.

**Architecture:** Derive all analytics locally from the existing all-items response through pure Dashboard model functions and a declarative widget registry. Keep rendering in reusable, data-driven chart components; translate widget clicks through typed Dashboard destinations handled by the existing workbench controller.

**Tech Stack:** Next.js 14, React 18, TypeScript, Vitest, Testing Library, existing CSS design tokens, Lucide React.

## Global Constraints

- Do not add a backend route, database migration, persistence preference, or charting dependency.
- Use the browser local calendar date, matching existing Planner controls.
- Area and Project work calculations use only directly linked `task`, `event`, and `routine` items.
- Planner calculations use active or paused `task` and `event` items only.
- A Planner summary deduplicates an item with both `scheduled` and `due`; the weekly chart keeps scheduled and due as separate series.
- A Project is Risk for overdue due date or 14+ inactive days; Attention for due within 7 days or 7+ inactive days; Risk wins. A Project without `updated_at` has no inactivity signal.
- Every clickable chart element must be a labelled button and expose its numeric value in text; color alone cannot convey status.
- Keep feature components free of raw hex colors; add any new color through existing CSS custom properties.

---

## Target File Structure

| File | Responsibility |
| --- | --- |
| `frontend/src/features/dashboard/model/dashboard-model.ts` | Pure work selection, date, Project state, and graph-stat calculations |
| `frontend/src/features/dashboard/model/dashboard-widgets.ts` | Typed widget registry and data-driven chart specifications |
| `frontend/src/features/dashboard/model/dashboard-navigation.ts` | Typed destinations emitted by Dashboard interactions |
| `frontend/src/features/dashboard/ui/DashboardChart.tsx` | Generic summary, stacked-bar, and grouped-bar renderers |
| `frontend/src/features/dashboard/ui/DashboardPanel.tsx` | State rendering and Dashboard layout composition |
| `frontend/src/features/workbench/model/workbench-model.ts` | Dashboard navigation method on `WorkbenchController` |
| `frontend/src/features/workbench/hooks/useWorkbenchController.ts` | Dashboard all-item loading and typed destination handling |
| `frontend/src/features/workbench/ui/MainPanel.tsx` | Dashboard panel routing before generic Workspace table rendering |
| `frontend/src/styles/globals.css` | Responsive dashboard layout and chart styles using design variables |
| `frontend/tests/domain/dashboard-model.spec.ts` | Domain calculation and date-boundary regression tests |
| `frontend/tests/domain/dashboard-widgets.spec.ts` | Registry completeness and chart-spec tests |
| `frontend/tests/presentation/dashboard-panel.spec.tsx` | Loading, empty/error, accessibility, and navigation tests |
| `frontend/tests/presentation/use-workbench-controller.spec.tsx` | Dashboard data-fetch and controller destination tests |

## Task 1: Define Dashboard domain calculations and destinations

**Files:**
- Create: `frontend/src/features/dashboard/model/dashboard-navigation.ts`
- Create: `frontend/src/features/dashboard/model/dashboard-model.ts`
- Create: `frontend/tests/domain/dashboard-model.spec.ts`

**Interfaces:**
- Consumes: `WorkspaceItemModel` from `@/features/workbench/model/workbench-model`.
- Produces: `DashboardSnapshot`, `ProjectAttention`, `PlannerSummary`, `PlannerDay`, and `DashboardDestination` for Tasks 2 and 3.

- [ ] **Step 1: Write failing domain tests for direct relationships, Project attention, and Planner date unions**

```ts
import { describe, expect, it } from "vitest";
import { buildDashboardSnapshot } from "@/features/dashboard/model/dashboard-model";

const today = "2026-07-23";

it("counts only direct Area work by status", () => {
  const snapshot = buildDashboardSnapshot([
    { id: "area", type: "area", title: "Health", status: "active" },
    { id: "task", type: "task", title: "Run", status: "active", area_id: "area" },
    { id: "project", type: "project", title: "Plan", status: "active", area_id: "area" },
    { id: "nested", type: "task", title: "Nested", status: "completed", project_id: "project" },
  ], today);

  expect(snapshot.areas[0]).toMatchObject({ active: 1, completed: 0, paused: 0 });
});

it("gives Risk precedence over Attention", () => {
  const snapshot = buildDashboardSnapshot([
    { id: "project", type: "project", title: "Release", status: "active", due: "2026-07-20", updated_at: "2026-07-17T00:00:00Z" },
  ], today);

  expect(snapshot.projects[0]?.attention).toBe("risk");
});

it("deduplicates a same-day scheduled and due item in Planner summaries", () => {
  const snapshot = buildDashboardSnapshot([
    { id: "task", type: "task", title: "Ship", status: "active", scheduled: today, due: today },
  ], today);

  expect(snapshot.planner).toMatchObject({ today: 1, thisWeek: 1, overdue: 0 });
  expect(snapshot.planner.days.find((day) => day.date === today)).toMatchObject({ scheduled: 1, due: 1 });
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npm test -- tests/domain/dashboard-model.spec.ts`

Expected: FAIL because `dashboard-model` does not exist.

- [ ] **Step 3: Define typed destinations and pure snapshot contracts**

```ts
// dashboard-navigation.ts
export type DashboardDestination =
  | { kind: "areas" }
  | { kind: "area-detail"; itemId: string }
  | { kind: "projects" }
  | { kind: "project-detail"; itemId: string }
  | { kind: "daily"; date: string }
  | { kind: "weekly"; weekStart: string }
  | { kind: "daily-overdue"; date: string };

// dashboard-model.ts
export type ProjectAttention = "normal" | "attention" | "risk";
export type PlannerDay = { date: string; scheduled: number; due: number };
export type PlannerSummary = { today: number; thisWeek: number; overdue: number; days: PlannerDay[] };
export type DashboardSnapshot = {
  summary: { activeAreas: number; activeProjects: number; activeWork: number; attentionProjects: number };
  areas: Array<{ id: string; title: string; active: number; paused: number; completed: number }>;
  projects: Array<{ id: string; title: string; completed: number; remaining: number; progress: number | null; attention: ProjectAttention }>;
  planner: PlannerSummary;
};

export function buildDashboardSnapshot(
  items: WorkspaceItemModel[],
  today: string,
): DashboardSnapshot {
  const work = items.filter(isDashboardWorkItem);
  const week = weekDates(today);
  return {
    summary: buildSummary(items, work, today),
    areas: buildAreaStats(items, work),
    projects: buildProjectStats(items, work, today),
    planner: buildPlannerStats(work, today, week),
  };
}
```

Implement date-only comparison helpers, Monday calculation, direct `area_id` / `project_id` selection, work-type predicates, and set-based Planner summary unions. Parse timestamps only through a local `YYYY-MM-DD` helper so an ISO timestamp cannot shift its comparison date through UTC formatting.

- [ ] **Step 4: Expand the failing tests to cover all locked boundaries**

```ts
it.each([
  ["2026-07-16", "attention"],
  ["2026-07-09", "risk"],
])("uses %s updated_at boundary for %s", (updatedDate, expected) => {
  const snapshot = buildDashboardSnapshot([
    { id: "project", type: "project", title: "Plan", status: "active", updated_at: `${updatedDate}T12:00:00Z` },
  ], today);
  expect(snapshot.projects[0]?.attention).toBe(expected);
});

it("includes an item in separate weekly series on its distinct scheduled and due days", () => {
  const snapshot = buildDashboardSnapshot([
    { id: "task", type: "task", title: "Plan", status: "active", scheduled: "2026-07-21", due: "2026-07-25" },
  ], today);
  expect(snapshot.planner.days.find((day) => day.date === "2026-07-21")?.scheduled).toBe(1);
  expect(snapshot.planner.days.find((day) => day.date === "2026-07-25")?.due).toBe(1);
});
```

- [ ] **Step 5: Implement the minimum calculations and pass the domain suite**

Run: `npm test -- tests/domain/dashboard-model.spec.ts`

Expected: PASS with direct-only Area/Project work, `normal` / `attention` / `risk` attention state, seven Planner days, and exact summary deduplication.

- [ ] **Step 6: Commit the independently tested domain layer**

```bash
git add frontend/src/features/dashboard/model/dashboard-model.ts \
  frontend/src/features/dashboard/model/dashboard-navigation.ts \
  frontend/tests/domain/dashboard-model.spec.ts
git commit -m "[ADD] Define dashboard analytics model"
```

Commit body must explain the Korean data-boundary and deduplication rules.

## Task 2: Register independently replaceable Dashboard widgets

**Files:**
- Create: `frontend/src/features/dashboard/model/dashboard-widgets.ts`
- Create: `frontend/tests/domain/dashboard-widgets.spec.ts`

**Interfaces:**
- Consumes: `DashboardSnapshot` and `DashboardDestination` from Task 1.
- Produces: `dashboardWidgets` and generic `DashboardWidget` / `DashboardChartSpec` values used by Task 3.

- [ ] **Step 1: Write failing registry tests**

```ts
import { describe, expect, it } from "vitest";
import { dashboardWidgets } from "@/features/dashboard/model/dashboard-widgets";

const sampleDashboardSnapshot = {
  summary: { activeAreas: 1, activeProjects: 1, activeWork: 2, attentionProjects: 0 },
  areas: [],
  projects: [],
  planner: {
    today: 1,
    thisWeek: 1,
    overdue: 0,
    days: [{ date: "2026-07-21", scheduled: 1, due: 0 }],
  },
};

it("registers the summary, Area, Project, and Planner widgets with unique IDs", () => {
  expect(dashboardWidgets.map((widget) => widget.id)).toEqual([
    "summary", "area-status", "project-progress", "planner-week",
  ]);
  expect(new Set(dashboardWidgets.map((widget) => widget.id)).size).toBe(dashboardWidgets.length);
});

it("emits an accessible chart specification and typed destination for every data point", () => {
  const widget = dashboardWidgets.find(({ id }) => id === "planner-week");
  const model = widget?.build(sampleDashboardSnapshot);
  expect(model?.chart?.series).toHaveLength(2);
  expect(model?.chart?.series[0]?.points[0]?.destination).toEqual({ kind: "daily", date: "2026-07-21" });
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npm test -- tests/domain/dashboard-widgets.spec.ts`

Expected: FAIL because the widget registry does not exist.

- [ ] **Step 3: Introduce declarative widget and chart contracts**

```ts
export type DashboardPoint = {
  id: string;
  label: string;
  value: number;
  displayValue?: string;
  ariaLabel?: string;
  sizePercent?: number;
  destination: DashboardDestination;
};
export type DashboardChartSpec = {
  kind: "stacked-bar" | "grouped-bar";
  ariaLabel: string;
  series: Array<{ id: string; label: string; tone: "primary" | "secondary" | "warning"; points: DashboardPoint[] }>;
};
export type DashboardWidgetModel = {
  id: string;
  title: string;
  description: string;
  emptyMessage: string;
  destination?: DashboardDestination;
  chart?: DashboardChartSpec;
  stats?: Array<{ label: string; value: number; destination: DashboardDestination }>;
};
export type DashboardWidget = {
  id: "summary" | "area-status" | "project-progress" | "planner-week";
  build: (snapshot: DashboardSnapshot) => DashboardWidgetModel;
};
```

Implement exactly four registry entries. Summary routes its Area and Project statistics to list destinations. Area points route to `area-detail`, Project points route to `project-detail`, daily Planner points route to `daily`, and the three Planner buckets route to `daily`, `weekly`, and `daily-overdue` respectively. A widget supplies any domain-specific display value, accessible wording, and normalized visual size through `displayValue`, `ariaLabel`, and `sizePercent`; the chart renderer must never infer those values from series identifiers.

- [ ] **Step 4: Run registry tests and type checking**

Run: `npm test -- tests/domain/dashboard-widgets.spec.ts && npm run typecheck`

Expected: PASS; TypeScript rejects a widget point without `label`, `value`, or `destination`.

- [ ] **Step 5: Commit the declarative widget boundary**

```bash
git add frontend/src/features/dashboard/model/dashboard-widgets.ts \
  frontend/tests/domain/dashboard-widgets.spec.ts
git commit -m "[ADD] Register dashboard analytic widgets"
```

Commit body must note that aggregation and visual specifications are separated from React rendering.

## Task 3: Load Dashboard data and handle typed navigation in the controller

**Files:**
- Modify: `frontend/src/features/workbench/model/workbench-model.ts`
- Modify: `frontend/src/features/workbench/hooks/useWorkbenchController.ts`
- Modify: `frontend/tests/presentation/use-workbench-controller.spec.tsx`

**Interfaces:**
- Consumes: `DashboardDestination` from Task 1 and `allItems` already returned by `/todo-engine/items`.
- Produces: `navigateDashboard(destination: DashboardDestination): void` and `reloadDashboard(): void` on `WorkbenchController` for Task 4.

- [ ] **Step 1: Write failing controller tests for Dashboard load and navigation**

```tsx
it("loads all items when the initial Dashboard is selected", async () => {
  vi.stubGlobal("fetch", vi.fn((url: string) => Promise.resolve({
    ok: true,
    json: async () => url === "/todo-engine/items" ? [{ id: "area", type: "area", title: "Health", status: "active" }] : [],
  })));
  const { result } = renderHook(() => useWorkbenchController());

  await waitFor(() => expect(result.current.workspaceItems.allItems).toHaveLength(1));
  expect(fetch).toHaveBeenCalledWith("/todo-engine/items");
});

it("opens a Daily Planner date from a Dashboard destination", () => {
  const { result } = renderHook(() => useWorkbenchController());
  act(() => result.current.navigateDashboard({ kind: "daily", date: "2026-07-25" }));

  expect(result.current.selection.leafTabId).toBe("daily");
  expect(result.current.planner.dailyDate).toBe("2026-07-25");
});
```

- [ ] **Step 2: Run the focused controller test to verify it fails**

Run: `npm test -- tests/presentation/use-workbench-controller.spec.tsx`

Expected: FAIL because Dashboard does not request all items and `navigateDashboard` is absent.

- [ ] **Step 3: Extend the controller contract and Dashboard branch of the fetch effect**

```ts
// workbench-model.ts
import type { DashboardDestination } from "@/features/dashboard/model/dashboard-navigation";

export type WorkbenchController = {
  // existing fields and methods
  navigateDashboard: (destination: DashboardDestination) => void;
  reloadDashboard: () => void;
};

// useWorkbenchController.ts, in the selection effect
if (selection.leafTabId === "dashboard") {
  setWorkspaceItems({ ...emptyWorkspaceItems, status: "loading" });
  void fetchAllWorkspaceItems().then((allItems) => {
    if (!cancelled) setWorkspaceItems({
      status: "loaded", items: [], allItems,
      tagOptions: collectTagOptions(allItems),
      relatedItems: buildRelatedItems(allItems),
    });
  }).catch(() => { if (!cancelled) setWorkspaceItems({ ...emptyWorkspaceItems, status: "error" }); });
  return () => { cancelled = true; };
}
```

Implement `navigateDashboard` as a single exhaustive switch. It must set the requested tab and matching Planner date for date destinations. For Area/Project detail destinations, store the item ID as pending before selecting the target tab; after the target tab's all-item fetch completes, open the existing detail view. This ordering prevents the existing selection-change effect from clearing the detail panel.

Add `const [dashboardReload, setDashboardReload] = useState(0);`, include
`dashboardReload` in the loading effect dependency list, and expose
`reloadDashboard: () => setDashboardReload((value) => value + 1)`. This keeps
retry limited to the Dashboard's existing all-items read.

- [ ] **Step 4: Add failure-safe detail and Planner navigation coverage**

```tsx
it("waits for the target list refresh before opening an Area detail", async () => {
  let resolveItems: ((value: { ok: boolean; json: () => Promise<unknown[]> }) => void) | undefined;
  vi.stubGlobal("fetch", vi.fn(() => new Promise((resolve) => { resolveItems = resolve; })));
  const { result } = renderHook(() => useWorkbenchController());

  act(() => result.current.navigateDashboard({ kind: "area-detail", itemId: "area-1" }));
  expect(result.current.detailItem).toBeNull();
  await act(async () => resolveItems?.({
    ok: true,
    json: async () => [{ id: "area-1", type: "area", title: "Health", status: "active" }],
  }));
  await waitFor(() => expect(result.current.detailItem?.id).toBe("area-1"));
});

it("routes the overdue summary to Daily on today without changing any item", () => {
  const { result } = renderHook(() => useWorkbenchController());
  act(() => result.current.navigateDashboard({ kind: "daily-overdue", date: "2026-07-23" }));
  expect(result.current.selection.leafTabId).toBe("daily");
  expect(result.current.detailItem).toBeNull();
});

it("repeats only the Dashboard all-items request when retrying", async () => {
  const fetchMock = vi.fn(() => Promise.resolve({ ok: true, json: async () => [] }));
  vi.stubGlobal("fetch", fetchMock);
  const { result } = renderHook(() => useWorkbenchController());
  const allItemCalls = () => fetchMock.mock.calls.filter(([url]) => url === "/todo-engine/items");
  await waitFor(() => expect(allItemCalls()).toHaveLength(1));
  act(() => result.current.reloadDashboard());
  await waitFor(() => expect(allItemCalls()).toHaveLength(2));
});
```

Use a deferred fetch promise in the first test so it demonstrates that detail opening happens after, not before, the refreshed item collection arrives.

- [ ] **Step 5: Run focused controller tests and type checking**

Run: `npm test -- tests/presentation/use-workbench-controller.spec.tsx && npm run typecheck`

Expected: PASS; non-Dashboard Workspace and Planner fetch behavior remains unchanged.

- [ ] **Step 6: Commit Dashboard controller behavior**

```bash
git add frontend/src/features/workbench/model/workbench-model.ts \
  frontend/src/features/workbench/hooks/useWorkbenchController.ts \
  frontend/tests/presentation/use-workbench-controller.spec.tsx
git commit -m "[UPDATE] Load and navigate dashboard analytics"
```

Commit body must state that Dashboard consumes the existing all-items endpoint and that navigation is read-only.

## Task 4: Render accessible reusable charts and the Dashboard panel

**Files:**
- Create: `frontend/src/features/dashboard/ui/DashboardChart.tsx`
- Create: `frontend/src/features/dashboard/ui/DashboardPanel.tsx`
- Modify: `frontend/src/features/dashboard/model/dashboard-widgets.ts` only when a generic renderer needs a presentation-ready field absent from the chart contract
- Modify: `frontend/src/features/workbench/ui/MainPanel.tsx`
- Modify: `frontend/src/styles/globals.css`
- Create: `frontend/tests/presentation/dashboard-panel.spec.tsx`

**Interfaces:**
- Consumes: `dashboardWidgets`, `DashboardWidgetModel`, `DashboardChartSpec`, and `controller.navigateDashboard` from Tasks 2 and 3.
- Produces: the rendered Dashboard for the `dashboard` leaf tab.

- [ ] **Step 1: Write failing presentation tests for all panel states and interactions**

```tsx
it("renders graph-led Area, Project, and Planner widgets", async () => {
  render(<WorkbenchPageClient />);
  expect(await screen.findByRole("region", { name: "Area work status" })).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Project progress" })).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Planner weekly schedule" })).toBeInTheDocument();
});

it("opens the selected Project detail from its graph bar", async () => {
  const user = userEvent.setup();
  render(<WorkbenchPageClient />);
  await user.click(await screen.findByRole("button", { name: /Release: 82% complete/ }));
  expect(await screen.findByRole("heading", { name: "Release" })).toBeInTheDocument();
});

it("renders a creation hint for a loaded empty Dashboard", async () => {
  render(<WorkbenchPageClient />);
  expect(await screen.findByText("Create an Area, Project, or work item to populate analytics.")).toBeInTheDocument();
});
```

Include mocked fetch responses for an accessible grouped Planner chart and a rejected all-items request. Assert skeletons while the all-items promise is unresolved and the retry control after rejection.

- [ ] **Step 2: Run the focused presentation test to verify it fails**

Run: `npm test -- tests/presentation/dashboard-panel.spec.tsx`

Expected: FAIL because Dashboard still renders the generic Workspace table.

- [ ] **Step 3: Implement generic chart rendering without domain calculations**

The renderer displays `DashboardPoint.displayValue`, `DashboardPoint.ariaLabel`, and `DashboardPoint.sizePercent` when supplied, with generic defaults only for absent optional presentation fields. It must not inspect series IDs such as `completed` or `remaining`.

```tsx
export function DashboardChart({ chart, onNavigate }: {
  chart: DashboardChartSpec;
  onNavigate: (destination: DashboardDestination) => void;
}) {
  return (
    <div className={`dashboard-chart dashboard-chart-${chart.kind}`} role="img" aria-label={chart.ariaLabel}>
      {chart.series.map((series) => (
        <div className="dashboard-chart-series" key={series.id}>
          {series.points.map((point) => (
            <button key={point.id} type="button" className={`dashboard-chart-point tone-${series.tone}`}
              aria-label={`${point.label}: ${point.value}`}
              onClick={() => onNavigate(point.destination)}>
              <span className="dashboard-chart-value">{point.value}</span>
              <span className="dashboard-chart-label">{point.label}</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
```

Render values as text in every button. Use CSS custom properties for chart tone colors, visible keyboard focus, responsive grid changes below the existing mobile breakpoint, and `prefers-reduced-motion: reduce` to remove chart transitions.

- [ ] **Step 4: Implement panel states and wire MainPanel routing**

```tsx
// MainPanel.tsx, before planner routing
if (controller.selection.leafTabId === "dashboard") {
  return <main className="main-panel"><DashboardPanel controller={controller} /></main>;
}

// DashboardPanel.tsx, loaded state
const snapshot = buildDashboardSnapshot(controller.workspaceItems.allItems, controller.planner.date);
return <section className="dashboard-panel" aria-label="Dashboard analytics">
  {dashboardWidgets.map((widget) => (
    <DashboardWidget key={widget.id} model={widget.build(snapshot)} onNavigate={controller.navigateDashboard} />
  ))}
</section>;
```

Use distinct render paths for `idle`/`loading`, `error`, loaded empty, and loaded populated states. The retry button calls the `reloadDashboard` controller method defined and tested in Task 3; it repeats only the existing all-items request.

- [ ] **Step 5: Run presentation, architecture, and type checks**

Run: `npm test -- tests/presentation/dashboard-panel.spec.tsx tests/architecture/design-boundaries.spec.ts && npm run typecheck`

Expected: PASS; no feature component contains a raw hex value and every chart button has an accessible name.

- [ ] **Step 6: Commit the Dashboard UI**

```bash
git add frontend/src/features/dashboard/ui/DashboardChart.tsx \
  frontend/src/features/dashboard/ui/DashboardPanel.tsx \
  frontend/src/features/workbench/ui/MainPanel.tsx \
  frontend/src/styles/globals.css \
  frontend/tests/presentation/dashboard-panel.spec.tsx \
  frontend/src/features/workbench/model/workbench-model.ts \
  frontend/src/features/workbench/hooks/useWorkbenchController.ts \
  frontend/tests/presentation/use-workbench-controller.spec.tsx
git commit -m "[ADD] Render dashboard analytics"
```

Commit body must record the Area/Project/Planner interactions and responsive accessibility behavior.

## Task 5: Run full validation and synchronize current-state documentation

**Files:**
- Modify: `frontend/README.md` only if it documents the Dashboard as empty or omits the user-visible navigation behavior.
- Test: `frontend/tests/domain/dashboard-model.spec.ts`
- Test: `frontend/tests/domain/dashboard-widgets.spec.ts`
- Test: `frontend/tests/presentation/dashboard-panel.spec.tsx`

**Interfaces:**
- Consumes: the completed Dashboard model, registry, controller, and UI.
- Produces: a verified feature and stable documentation only when current docs are stale.

- [ ] **Step 1: Inspect relevant current-state documentation before editing**

Run: `rg -n "Dashboard|dashboard" frontend/README.md README.md docs`

Expected: identify whether an existing user-facing Dashboard statement would become stale. Do not add roadmap or implementation-history prose.

- [ ] **Step 2: Update only stale current-state documentation, if found**

```md
## Dashboard

Dashboard summarizes Area work state, Project progress and attention, and the
current week's Planner schedule. Graph elements open the relevant existing
Workspace or Planner view.
```

Place equivalent concise copy in the existing section that describes frontend
views; do not create this section if the target document has a locked structure
that does not accommodate it.

- [ ] **Step 3: Run the complete frontend gate**

Run: `npm test && npm run typecheck && npm run build`

Expected: all Vitest suites pass, TypeScript emits no errors, and Next static export completes.

- [ ] **Step 4: Run workspace formatting and Rust-adjacent safety gates**

Run: `cargo fmt --check && cargo clippy --all-targets --all-features -- -D warnings`

Expected: PASS; the Dashboard does not alter the Rust codebase, but the workspace gate stays green.

- [ ] **Step 5: Commit documentation only when it changed**

```bash
git add frontend/README.md
git commit -m "[DOCS] Document dashboard analytics"
```

Run this command only when `frontend/README.md` changed in Step 2. Skip this
commit when no documentation is stale. Never stage unrelated files.

## Plan Self-Review

- [ ] Each design requirement maps to a task: graph-led Area/Project/Planner layout (Tasks 2 and 4), exact counting rules (Task 1), navigation (Task 3), developer-extensible widgets (Task 2), loading/error/empty/accessibility states (Task 4), and verification (Task 5).
- [ ] The plan introduces no backend endpoint, schema change, runtime preference, or chart dependency.
- [ ] All later interfaces are defined by Tasks 1–3 before the UI consumes them.
- [ ] Search this document for `TBD`, `TODO`, `implement later`, and `fill in details`; no unresolved placeholder is permitted.
