# Health Report Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild Health Journal Reports around daily average Bristol scores and body-weight change while preserving the useful supporting health, diet, medication, and response analyses.

**Architecture:** Keep the existing Health report API contract and derive the new daily and first-to-latest values in the frontend report model. Extend the existing shared line chart only with optional numeric-domain and unit-label inputs, then compose the redesigned Report from those existing model and chart boundaries. Dashboard Health highlights remain out of scope.

**Tech Stack:** TypeScript, React 18, Next.js 14, Vitest, Testing Library, existing Raven CSS and Health report API.

---

## File map

- Modify `frontend/src/features/health/model/health-reports.ts`: derive ordered daily Bristol averages, weight change, and supporting metric comparisons.
- Modify `frontend/src/features/dashboard/ui/DashboardLineChart.tsx`: support an optional non-zero Y domain and visible value suffix without changing existing callers.
- Modify `frontend/src/features/health/ui/HealthReports.tsx`: make Custom range a peer button and reveal its form only when selected.
- Modify `frontend/src/features/health/ui/HealthReportCharts.tsx`: render the new summary, primary charts, metric tabs, coverage, and response bars.
- Modify `frontend/src/styles/globals.css`: implement the approved responsive report hierarchy using existing design tokens.
- Modify `frontend/tests/domain/health-reports.spec.ts`: verify deterministic report derivations.
- Modify `frontend/tests/presentation/health-reports.spec.tsx`: verify controls, charts, drilldowns, accessibility, empty states, and responsive selectors.

### Task 1: Derive the report analysis model

**Files:**
- Modify: `frontend/src/features/health/model/health-reports.ts:42-83`
- Modify: `frontend/src/features/health/model/health-reports.ts:128-200`
- Test: `frontend/tests/domain/health-reports.spec.ts`

- [ ] **Step 1: Write the failing derivation tests**

Import `buildHealthReportAnalysis` and add a `Health report analysis` suite. Use the existing `HealthReport` type and construct a minimal report with two bowel records on one date, a missing date, two weight readings, and two sleep readings:

```ts
it("groups bowel records by local date and derives in-range weight change", () => {
  const value = analysisReport();

  expect(buildHealthReportAnalysis(value)).toMatchObject({
    dailyBowelPoints: [
      { localDate: "2026-08-10", value: 4, recordCount: 2 },
      { localDate: "2026-08-12", value: 6, recordCount: 1 },
    ],
    latestDailyBowel: {
      localDate: "2026-08-12", value: 6, recordCount: 1,
    },
    latestWeight: {
      localDate: "2026-08-12", occurredAt: "2026-08-12T08:00:00Z", value: 70.5,
    },
    weightChange: -1,
  });
});

it("uses the latest two in-range readings for supporting metric comparison", () => {
  const sleep = buildHealthReportAnalysis(analysisReport()).supportingMetrics
    .find(({ metric }) => metric === "sleep_duration");

  expect(sleep).toMatchObject({
    latest: { localDate: "2026-08-12", value: 7.5 },
    previous: { localDate: "2026-08-10", value: 7 },
    change: 0.5,
  });
});

it("reports no weight comparison for fewer than two in-range readings", () => {
  const value = analysisReport();
  value.metricSeries = value.metricSeries.map((series) =>
    series.metric === "body_weight"
      ? { ...series, points: series.points.slice(-1) }
      : series,
  );

  expect(buildHealthReportAnalysis(value).weightChange).toBeNull();
});
```

Define `analysisReport()` beside the suite with all five fixed metric rows and series required by `HealthReport`. Put bowel input in reverse timestamp order to prove the derivation returns chronological dates. Do not insert a point for `2026-08-11`.

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```powershell
npm --prefix frontend test -- tests/domain/health-reports.spec.ts
```

Expected: FAIL because `buildHealthReportAnalysis` is not exported.

- [ ] **Step 3: Add the minimal analysis types and builder**

Add these exported types after `HealthReport`:

```ts
export type HealthReportDailyBowelPoint = {
  localDate: string;
  value: number;
  recordCount: number;
};

export type HealthReportSupportingMetric = {
  metric: Exclude<HealthReportMetric, "body_weight">;
  name: string;
  unit: string | null;
  points: HealthReportReading[];
  latest: HealthReportReading | null;
  previous: HealthReportReading | null;
  change: number | null;
};

export type HealthReportAnalysis = {
  dailyBowelPoints: HealthReportDailyBowelPoint[];
  latestDailyBowel: HealthReportDailyBowelPoint | null;
  weightPoints: HealthReportReading[];
  latestWeight: HealthReportReading | null;
  weightChange: number | null;
  supportingMetrics: HealthReportSupportingMetric[];
};
```

Add the builder below `mapHealthReport`:

```ts
export function buildHealthReportAnalysis(report: HealthReport): HealthReportAnalysis {
  const bowelByDate = new Map<string, { total: number; count: number }>();
  for (const point of report.bowelPoints) {
    const day = bowelByDate.get(point.localDate) ?? { total: 0, count: 0 };
    day.total += point.bristolScale;
    day.count += 1;
    bowelByDate.set(point.localDate, day);
  }
  const dailyBowelPoints = [...bowelByDate.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([localDate, day]) => ({
      localDate,
      value: day.total / day.count,
      recordCount: day.count,
    }));
  const weightPoints = orderedReadings(
    report.metricSeries.find(({ metric }) => metric === "body_weight")?.points ?? [],
  );
  const supportingMetrics = report.metricSeries
    .filter((series): series is HealthReportMetricSeries & {
      metric: Exclude<HealthReportMetric, "body_weight">;
    } => series.metric !== "body_weight")
    .map((series) => {
      const points = orderedReadings(series.points);
      const latest = points.at(-1) ?? null;
      const previous = points.at(-2) ?? null;
      const definition = report.metrics.find(({ metric }) => metric === series.metric);
      return {
        metric: series.metric,
        name: definition?.name ?? series.metric,
        unit: definition?.unit ?? null,
        points,
        latest,
        previous,
        change: latest && previous ? latest.value - previous.value : null,
      };
    });
  const latestWeight = weightPoints.at(-1) ?? null;
  return {
    dailyBowelPoints,
    latestDailyBowel: dailyBowelPoints.at(-1) ?? null,
    weightPoints,
    latestWeight,
    weightChange: latestWeight && weightPoints.length > 1
      ? latestWeight.value - weightPoints[0]!.value
      : null,
    supportingMetrics,
  };
}

function orderedReadings(points: HealthReportReading[]): HealthReportReading[] {
  return [...points].sort((left, right) =>
    left.localDate.localeCompare(right.localDate)
      || left.occurredAt.localeCompare(right.occurredAt));
}
```

- [ ] **Step 4: Run the focused domain tests**

Run:

```powershell
npm --prefix frontend test -- tests/domain/health-reports.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the derivation**

```powershell
git add frontend/src/features/health/model/health-reports.ts frontend/tests/domain/health-reports.spec.ts
git commit -m "[ADD] Derive Health report analysis"
```

### Task 2: Give the shared line chart an explicit numeric domain and unit

**Files:**
- Modify: `frontend/src/features/dashboard/ui/DashboardLineChart.tsx:5-76`
- Test: `frontend/tests/presentation/health-reports.spec.tsx`

- [ ] **Step 1: Write failing line-chart tests**

Extend the existing `DashboardLineChart` test coverage:

```tsx
it("renders a non-zero numeric domain with a unit and limits long-range date labels", () => {
  const points = Array.from({ length: 30 }, (_, index) => ({
    id: String(index),
    label: `2026-08-${String(index + 1).padStart(2, "0")}`,
    value: 68 + index / 20,
    ariaLabel: `Weight ${68 + index / 20} kg`,
  }));
  const { container } = render(
    <DashboardLineChart
      chart={{ kind: "line", ariaLabel: "Weight trend", total: points.length, points }}
      domain={{ minimum: 67, maximum: 71 }}
      valueSuffix=" kg"
    />,
  );

  expect(within(screen.getByRole("group", { name: "Weight trend" }))
    .getByText("71 kg")).toBeInTheDocument();
  expect(container.querySelectorAll(".dashboard-line-x-tick")).toHaveLength(7);
});
```

Also render the Bristol reference band with `domain={{ minimum: 1, maximum: 7 }}` and assert
that the band remains present. This protects the non-zero-domain band calculation.

- [ ] **Step 2: Run the presentation test and verify failure**

Run:

```powershell
npm --prefix frontend test -- tests/presentation/health-reports.spec.tsx
```

Expected: FAIL because `domain` and `valueSuffix` are not accepted.

- [ ] **Step 3: Extend the chart without changing default callers**

Extend `DashboardLineChartProps`:

```ts
domain?: { minimum: number; maximum: number };
valueSuffix?: string;
```

Resolve the scale once and reuse it for points, ticks, and the reference band:

```ts
const dataMaximum = Math.max(1, referenceBand?.maximum ?? 0, ...chart.points.map(({ value }) => value));
const minimum = domain?.minimum ?? 0;
const maximum = domain?.maximum ?? (scale === "percentage" ? 100 : dataMaximum);
const span = Math.max(Number.EPSILON, maximum - minimum);
const position = (value: number) => 94 - ((value - minimum) / span) * 84;
```

For an explicit domain, create five evenly spaced Y ticks from maximum to minimum. Keep the
existing percentage and automatic tick behavior when no domain is supplied. Render tick text
with a small formatter that removes floating-point noise and appends `valueSuffix`; percentage
callers continue to append `%`. Use `position()` for each point and for both edges of the
reference band.

- [ ] **Step 4: Run the focused presentation tests**

Run:

```powershell
npm --prefix frontend test -- tests/presentation/health-reports.spec.tsx
```

Expected: PASS, including existing callers without the new props.

- [ ] **Step 5: Commit the chart capability**

```powershell
git add frontend/src/features/dashboard/ui/DashboardLineChart.tsx frontend/tests/presentation/health-reports.spec.tsx
git commit -m "[UPDATE] Support Health chart value domains"
```

### Task 3: Collapse the custom period controls

**Files:**
- Modify: `frontend/src/features/health/ui/HealthReports.tsx:13-124`
- Test: `frontend/tests/presentation/health-reports.spec.tsx`

- [ ] **Step 1: Replace the period-control expectations with the approved interaction**

In `requests the default range once...`, assert the initial five peer buttons, hidden custom
fields, reveal behavior, preset close behavior, and existing validation:

```tsx
expect(screen.getAllByRole("button").slice(0, 5).map((button) => button.textContent))
  .toEqual(["7 days", "14 days", "30 days", "90 days", "Custom range"]);
expect(screen.queryByLabelText("From")).toBeNull();

await user.click(screen.getByRole("button", { name: "Custom range" }));
expect(screen.getByRole("button", { name: "Custom range" }))
  .toHaveAttribute("aria-pressed", "true");
expect(screen.getByLabelText("From")).toBeVisible();
expect(screen.getByLabelText("To")).toBeVisible();
expect(value.runReports).not.toHaveBeenCalled();

await user.click(screen.getByRole("button", { name: "14 days" }));
expect(screen.queryByLabelText("From")).toBeNull();
expect(value.runReports).toHaveBeenLastCalledWith({ preset: 14 });
```

Reopen Custom range and retain the existing invalid-date, ordering, 366-day, and successful
Apply assertions.

- [ ] **Step 2: Run the test and verify failure**

Run:

```powershell
npm --prefix frontend test -- tests/presentation/health-reports.spec.tsx
```

Expected: FAIL because Custom range is not a preset button and the form is always visible.

- [ ] **Step 3: Implement the local disclosure state**

Add state initialized from the active selection:

```ts
const [customOpen, setCustomOpen] = useState(
  () => controller.state.reportSelection.preset === "custom",
);
```

When a numbered preset is clicked, call `setCustomOpen(false)` before `request({ preset })`.
Add the peer button:

```tsx
<button
  type="button"
  aria-pressed={customOpen}
  disabled={loading}
  onClick={() => setCustomOpen(true)}
>
  Custom range
</button>
```

Render the existing `health-report-custom` form only when `customOpen` is true. Do not call
the API until Apply passes `resolveHealthReportRange`.

- [ ] **Step 4: Run the focused presentation tests**

Run:

```powershell
npm --prefix frontend test -- tests/presentation/health-reports.spec.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit the period interaction**

```powershell
git add frontend/src/features/health/ui/HealthReports.tsx frontend/tests/presentation/health-reports.spec.tsx
git commit -m "[UPDATE] Collapse Health custom report range"
```

### Task 4: Build the primary Health summary and charts

**Files:**
- Modify: `frontend/src/features/health/ui/HealthReportCharts.tsx:14-297`
- Modify: `frontend/src/styles/globals.css:567-680`
- Test: `frontend/tests/presentation/health-reports.spec.tsx`

- [ ] **Step 1: Write failing primary-analysis assertions**

Update `populatedReport()` so two bowel records share `2026-08-10` with scores 3 and 5, a
later day has score 6, and weight moves from 71.5 kg to 72 kg. Replace the old nine-card and
raw bowel-point assertions with:

```tsx
const summary = screen.getByRole("region", { name: "Summary" });
expect(within(summary).getByText("Latest daily Bristol average").parentElement)
  .toHaveTextContent("6");
expect(within(summary).getByText("Latest weight").parentElement)
  .toHaveTextContent("72 kg");
expect(within(summary).getByText("Weight change").parentElement)
  .toHaveTextContent("+0.5 kg");
expect(within(summary).queryByText("Diet count")).toBeNull();

const bowel = screen.getByRole("group", {
  name: "Daily average Bristol score. Typical Bristol band 3 to 5",
});
expect(within(bowel).getAllByRole("img").map((point) => point.getAttribute("aria-label")))
  .toEqual([
    "2026-08-10: Average Bristol 4 from 2 records",
    "2026-08-12: Average Bristol 6 from 1 record",
  ]);
expect(screen.getByRole("group", { name: "Weight trend (kg)" })).toBeInTheDocument();
```

Add a one-weight-reading case that expects `No comparison available`, and retain the empty
report assertions for both primary charts.

- [ ] **Step 2: Run the presentation test and verify failure**

Run:

```powershell
npm --prefix frontend test -- tests/presentation/health-reports.spec.tsx
```

Expected: FAIL against the old summary and raw bowel chart.

- [ ] **Step 3: Replace the summary and primary chart composition**

Call `buildHealthReportAnalysis(report)` once in `HealthReportAnalysis` and pass the result to
child sections. Replace the old metric/count summary with three `ReportCard` values:

```tsx
<ReportCard label="Latest daily Bristol average" onClick={bowelDrilldown}>
  <strong>{latestDailyBowel ? number(latestDailyBowel.value) : "Unavailable"}</strong>
  <small>{latestDailyBowel
    ? `${latestDailyBowel.localDate} · ${latestDailyBowel.recordCount} records`
    : "No records in selected period"}</small>
</ReportCard>
<ReportCard label="Latest weight" onClick={weightDrilldown}>
  <strong>{latestWeight ? `${number(latestWeight.value)} kg` : "Unavailable"}</strong>
  <small>{latestWeight?.localDate ?? "No records in selected period"}</small>
</ReportCard>
<ReportCard label="Weight change" onClick={weightDrilldown}>
  <strong>{weightChange === null ? "No comparison available" : `${signed(weightChange)} kg`}</strong>
  <small>First to latest record in selected period</small>
</ReportCard>
```

Render the primary charts in `.health-report-primary-grid`. Convert derived points to the
existing `LineChartSpec` shape. Pass `domain={{ minimum: 1, maximum: 7 }}` and the existing
3–5 reference band to the bowel chart. Give its source action a date-only bowel drilldown.

For weight, calculate a readable domain without a zero baseline:

```ts
const weightValues = analysis.weightPoints.map(({ value }) => value);
const weightMinimum = Math.floor(Math.min(...weightValues) - 1);
const weightMaximum = Math.ceil(Math.max(...weightValues) + 1);
```

Pass that domain and `valueSuffix=" kg"` to the chart. Keep the date-only weight drilldown.
If either point array is empty, render its specific empty message instead of a chart.

- [ ] **Step 4: Add the approved responsive primary layout**

Replace the two old summary-grid rules with:

```css
.health-report-primary-summary {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.health-report-primary-grid {
  display: grid;
  min-width: 0;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
```

At `@media (max-width: 760px)`, stack both selectors to `minmax(0, 1fr)`. Reuse existing
colors, borders, spacing, focus outlines, and line-chart styles; do not add a new visual token.

- [ ] **Step 5: Run the focused presentation tests**

Run:

```powershell
npm --prefix frontend test -- tests/presentation/health-reports.spec.tsx
```

Expected: PASS for the primary summary, grouped bowel values, weight change, drilldowns,
empty states, and responsive grid selectors.

- [ ] **Step 6: Commit the primary analysis**

```powershell
git add frontend/src/features/health/ui/HealthReportCharts.tsx frontend/src/styles/globals.css frontend/tests/presentation/health-reports.spec.tsx
git commit -m "[UPDATE] Lead Health reports with bowel and weight trends"
```

### Task 5: Reorganize supporting analyses

**Files:**
- Modify: `frontend/src/features/health/ui/HealthReportCharts.tsx:248-368`
- Modify: `frontend/src/styles/globals.css:640-734`
- Test: `frontend/tests/presentation/health-reports.spec.tsx`

- [ ] **Step 1: Write failing supporting-analysis assertions**

Replace the select-based metric test with button-based metric assertions and add coverage and
response-bar checks:

```tsx
const metrics = screen.getByRole("group", { name: "Other health metrics" });
expect(within(metrics).getAllByRole("button").filter((button) =>
  button.hasAttribute("aria-pressed")).map((button) => button.textContent))
  .toEqual(["Sleep", "CRP", "Calprotectin", "Condition"]);
expect(within(metrics).queryByRole("button", { name: "Weight" })).toBeNull();
expect(within(metrics).getByText(/Latest 7.5 hours/)).toBeInTheDocument();

await user.click(within(metrics).getByRole("button", { name: "CRP" }));
expect(within(metrics).getByText("No CRP readings are available for this period."))
  .toBeInTheDocument();

expect(screen.getByRole("region", { name: "Diet tag frequency" }))
  .toHaveTextContent("8 records in selected period");
expect(screen.getByRole("region", { name: "Medication frequency" }))
  .toHaveTextContent("4 records in selected period");
expect(screen.getByRole("button", { name: "spicy, 1 / 2, 50%" }))
  .toContainElement(document.querySelector(".health-report-response-bar"));
```

Retain the existing keyboard drilldown assertions for metric, diet, medication, and response
rows, updating only their accessible names where necessary.

- [ ] **Step 2: Run the test and verify failure**

Run:

```powershell
npm --prefix frontend test -- tests/presentation/health-reports.spec.tsx
```

Expected: FAIL because the old UI uses a select, omits coverage copy, and renders response
rows without proportion bars.

- [ ] **Step 3: Implement metric tabs from the derived analysis**

Limit definitions to Sleep, CRP, Calprotectin, and Condition. Keep local selected-metric state
and render peer buttons:

```tsx
<div className="health-report-metric-tabs" role="group" aria-label="Other health metrics">
  {metrics.map(({ metric, name }) => (
    <button
      key={metric}
      type="button"
      aria-pressed={selected === metric}
      onClick={() => setSelected(metric)}
    >
      {name}
    </button>
  ))}
</div>
```

For the selected derived metric, show `Latest {value}` and `Change {signed(change)}` when two
readings exist, or `No previous reading` when only one exists. Pass `valueSuffix` to the line
chart when the metric has a unit. Keep the source-record drilldown button and local empty copy.

- [ ] **Step 4: Add coverage and response proportions**

Pass `report.dietCount.current` and `report.medicationCount.current` into their corresponding
frequency sections. Render `Unavailable` for null, otherwise `{count} records in selected
period`.

In each response row, insert the existing absolute background span with the rate variable:

```tsx
<span
  className="health-report-frequency-bar health-report-response-bar"
  style={{ "--health-report-bar": row.rate } as React.CSSProperties}
  aria-hidden="true"
/>
```

Keep `positiveMeals / eligibleMeals` and the rounded percentage in visible and accessible text.
Add only the CSS necessary to give `.health-report-response-bar` the existing warning color
and keep row text above the bar.

- [ ] **Step 5: Run the focused presentation tests**

Run:

```powershell
npm --prefix frontend test -- tests/presentation/health-reports.spec.tsx
```

Expected: PASS for metric tabs, values, local empty states, coverage, response proportions,
keyboard interaction, and typed drilldowns.

- [ ] **Step 6: Commit the supporting analyses**

```powershell
git add frontend/src/features/health/ui/HealthReportCharts.tsx frontend/src/styles/globals.css frontend/tests/presentation/health-reports.spec.tsx
git commit -m "[UPDATE] Reorganize Health supporting analyses"
```

### Task 6: Verify the complete Report and documentation impact

**Files:**
- Verify: `frontend/src/features/health/model/health-reports.ts`
- Verify: `frontend/src/features/dashboard/ui/DashboardLineChart.tsx`
- Verify: `frontend/src/features/health/ui/HealthReports.tsx`
- Verify: `frontend/src/features/health/ui/HealthReportCharts.tsx`
- Verify: `frontend/src/styles/globals.css`
- Verify: `frontend/tests/domain/health-reports.spec.ts`
- Verify: `frontend/tests/presentation/health-reports.spec.tsx`
- Reference: `docs/superpowers/specs/2026-09-04-health-report-redesign-design.md`

- [ ] **Step 1: Run the focused Health report tests together**

```powershell
npm --prefix frontend test -- tests/domain/health-reports.spec.ts tests/presentation/health-reports.spec.tsx
```

Expected: both files PASS.

- [ ] **Step 2: Run the complete frontend verification**

```powershell
npm --prefix frontend test
npm --prefix frontend run typecheck
npm --prefix frontend run build
git diff --check
```

Expected: all tests PASS, TypeScript exits 0, Next.js build exits 0, and `git diff --check`
prints nothing.

- [ ] **Step 3: Compare the implementation to the approved design**

Confirm all of the following in the built Report:

```text
5 peer period buttons; custom fields collapsed by default
3 primary summary values; no Diet/Bowel/Medication count-card row
daily grouped Bristol chart with 1–7 axis and 3–5 band
weight chart with kg axis and first-to-latest change
no synthetic zero points; at most 7 visible X-axis labels
4 supporting metric tabs; Weight absent from the supporting selector
Diet and Medication frequency coverage
Diet–bowel response proportion, sample counts, and association disclaimer
section-local empty states and preserved report-level retry
all drilldowns retain the selected inclusive date range
```

- [ ] **Step 4: Record the documentation decision**

No stable README or operations contract changes are required: the Report remains within the
documented Health Journal Reports surface, and neither its API nor lifecycle behavior changes.
Do not edit Dashboard documentation because Dashboard work is deferred.

- [ ] **Step 5: Confirm final repository state**

```powershell
git status --short
git log --oneline -n 8
```

Expected: no unintended files, and each preceding task appears as its own focused commit.
