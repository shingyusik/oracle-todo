# Health Reports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the public Health Trends tab with a complete Reports workspace covering period summaries, fixed-metric and bowel trends, medication/tag frequencies, 24-hour diet-tag bowel response, and filtered drilldown.

**Architecture:** Keep `health.sqlite` as the only source of truth and compute one typed report in `health-engine` from active Diet and Health Event records. Add one read-only `/api/v1/health/reports` route, keep the last complete frontend result during refresh/error, and reuse Ledger report controls, existing Health table settings, native controls, and the installed dashboard chart primitives. Keep legacy Timeline/Trends engine/API/CLI endpoints for compatibility, but remove them from public Health navigation and frontend controller mutation refreshes.

**Tech Stack:** Rust 2024, rusqlite, axum/serde, TypeScript, React 18, Next.js 14, Vitest, Testing Library

---

## File map

**New files**

- `health-engine/src/application/reports.rs` — typed period model, validation, comparisons, chart projections, and exact 24-hour response calculation.
- `health-engine/tests/integration/reports.rs` — service/repository integration contract.
- `frontend/src/features/health/model/health-reports.ts` — report selection, display model, and deterministic drilldown settings.
- `frontend/src/features/health/ui/HealthReports.tsx` — Reports page, period controls, loading/error/empty states.
- `frontend/src/features/health/ui/HealthReportCharts.tsx` — summary cards, accessible charts/frequencies, metric selector, and drilldown buttons.
- `frontend/tests/domain/health-reports.spec.ts` — selection and drilldown contract.
- `frontend/tests/presentation/health-reports.spec.tsx` — controller and Reports UI contract.

**Modified files**

- `health-engine/src/application/mod.rs`, `health-engine/src/application/ports.rs` — export Reports and add its read boundary.
- `health-engine/src/infrastructure/sqlite/repository.rs` — fetch complete active report inputs without a cache or schema change.
- `raven-api/src/routes/health.rs`, `raven-api/tests/routes_health.rs` — typed `GET /health/reports?from=&to=` route.
- `docs/operations/api-reference.md` — current Reports query/response contract.
- `frontend/src/features/health/api/health-api.ts` — Reports response parsing and query.
- `frontend/src/features/health/hooks/useHealthController.ts` — retained-result Reports state and removal of frontend Timeline/Trends refresh coupling.
- `frontend/src/features/health/ui/HealthPanel.tsx` — render Reports and remove the legacy Trends panel.
- `frontend/src/features/workbench/ui/MainPanel.tsx` — pass the workbench controller and apply Health drilldowns.
- `frontend/src/domain/workbench/navigation.ts` — public `reports` leaf instead of `trends`.
- `frontend/src/features/dashboard/ui/DashboardLineChart.tsx`, `frontend/src/app/globals.css` — optional reference band and responsive Health report layout only.
- Health controller fixtures/tests in `frontend/tests/presentation/{health-panel,health-forms,diet-panel,bowel-panel,medication-panel,health-metrics-panel,quick-add,workbench-wireframe}.spec.tsx` and `frontend/tests/domain/workbench-navigation.spec.ts` — new Reports surface and exact read boundaries.
- `README.md`, `frontend/README.md` — public Reports navigation; retain legacy API/CLI Trends references only where they describe compatibility surfaces.

**Deleted file**

- `frontend/src/features/health/ui/HealthTrendsPanel.tsx` — dead public UI replaced by Reports.

Do not add a report table/cache, migration, chart package, custom metric/unit, diagnosis, recommendation, alert, report saved-view namespace, or generic cross-domain report framework.

---

### Task 1: Compute the complete typed report in Health engine

**Files:**

- Create: `health-engine/src/application/reports.rs`
- Create: `health-engine/tests/integration/reports.rs`
- Modify: `health-engine/src/application/mod.rs`
- Modify: `health-engine/src/application/ports.rs`
- Modify: `health-engine/src/infrastructure/sqlite/repository.rs`
- Modify: `health-engine/tests/integration.rs`

- [ ] **Step 1: Write failing range and summary tests**

Create fixtures across a current inclusive local-date range and its immediately preceding equal-length range. Require these public shapes:

```rust
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct HealthReportRange {
    pub from: Date,
    pub to: Date,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct HealthReport {
    pub range: HealthReportRange,
    pub previous_range: HealthReportRange,
    pub metrics: Vec<MetricSummary>,
    pub diet_count: CountComparison,
    pub bowel: BowelSummary,
    pub medication_count: CountComparison,
    pub bowel_points: Vec<BowelPoint>,
    pub metric_series: Vec<MetricSeries>,
    pub medication_frequencies: Vec<NamedCount>,
    pub diet_tag_frequencies: Vec<NamedCount>,
    pub diet_tag_bowel_responses: Vec<TagBowelResponse>,
    pub reaction_disclaimer: &'static str,
}

pub struct CountComparison {
    pub current: Option<u32>,
    pub previous: Option<u32>,
}

pub struct BowelSummary {
    pub current_count: Option<u32>,
    pub previous_count: Option<u32>,
    pub current_average: Option<f64>,
    pub previous_average: Option<f64>,
}
```

Assert `from > to`, a zero-length overflow, and ranges longer than 366 inclusive days return `HealthError::Validation`. Assert Diet, Bowel, and Medication with no rows are `None`, not `Some(0)`. Verify current counts/average against the equal-length previous range. For each fixed metric, select the latest reading inside the chosen range and compare it with the immediately preceding active daily measurement, including one before `from`; missing values stay `None`.

- [ ] **Step 2: Run the service test and verify RED**

Run:

```powershell
cargo test -p health-engine --test integration reports -- --nocapture
```

Expected: FAIL because the `reports` module, report DTOs, and repository read do not exist.

- [ ] **Step 3: Add one bounded read boundary**

Add this internal repository result and method:

```rust
pub(crate) struct ReportRecords {
    pub diets: Vec<DietEntry>,
    pub events: Vec<HealthEvent>,
}

fn report_records(
    &self,
    start_inclusive: OffsetDateTime,
    end_inclusive: OffsetDateTime,
    limit: u32,
) -> HealthResult<ReportRecords>;
```

Query only active rows. Fetch Diet entries and events from the previous-period start through `min(now, selected-end + 24 hours)` for counts, charts, and complete response windows. Also include active `daily_upsert = 1` fixed-metric events before that start only as needed to obtain the one immediately preceding measurement per fixed identity. Enforce one shared 100,000-row ceiling and return a validation error rather than truncating. Reuse `row_to_diet`, `diet_tags_on`, `row_to_event`, `format_time`, and the existing SQLite connection; add no table or index until a measured query requires one.

- [ ] **Step 4: Implement deterministic projection**

Expose:

```rust
pub fn reports(&self, range: HealthReportRange) -> HealthResult<HealthReport> {
    self.reports_at(range, OffsetDateTime::now_utc())
}

pub fn reports_at(
    &self,
    range: HealthReportRange,
    now: OffsetDateTime,
) -> HealthResult<HealthReport>
```

Convert inclusive local dates with `self.local_offset`; compute the previous equal-length range by calendar days. Include only Diet/Bowel/Medication rows whose local dates are in the requested comparison range. Include only the five fixed `daily_upsert` metric identities in metric summaries/series.

Sort bowel and metric points by instant then ID. Sort named frequencies by count descending then name ascending. Return all diet tags in the response table, including one-meal samples.

Define response rows as:

```rust
pub struct MetricReading {
    pub local_date: Date,
    #[serde(with = "time::serde::rfc3339")]
    pub occurred_at: OffsetDateTime,
    pub value: f64,
}

pub struct MetricSummary {
    pub metric: FixedMetric,
    pub name: &'static str,
    pub unit: Option<&'static str>,
    pub current: Option<MetricReading>,
    pub previous: Option<MetricReading>,
}

pub struct TagBowelResponse {
    pub tag: String,
    pub positive_meals: u32,
    pub eligible_meals: u32,
    pub rate: f64,
}
```

A meal is eligible only when `meal.occurred_at + 24h <= now`. It is positive when at least one Bristol 1, 2, 6, or 7 event satisfies `bowel.occurred_at > meal.occurred_at && bowel.occurred_at <= meal.occurred_at + 24h`. Treat overlapping meal windows independently and count a multi-tag meal once for each tag. Set the disclaimer exactly to `Observed associations only; they do not establish causation.`

- [ ] **Step 5: Add exact reaction-boundary tests**

Directly cover bowel at the meal instant (excluded), one nanosecond after (included), exactly 24 hours (included), after 24 hours (excluded), incomplete windows at `now` (excluded), historical end-date lookahead, overlapping meals sharing one bowel event, multi-tag meals, normal Bristol 3/4/5, and abnormal 1/2/6/7. Assert numerator, denominator, rate, all tags, ordering, and disclaimer.

- [ ] **Step 6: Run engine gates and commit**

Run:

```powershell
cargo fmt --check
cargo test -p health-engine --test integration reports -- --nocapture
cargo test -p health-engine --test integration daily_upsert -- --nocapture
```

Expected: PASS.

Commit only these files:

```powershell
git commit -m "[ADD] Compute Health Reports"
```

---

### Task 2: Expose the Reports HTTP contract

**Files:**

- Modify: `raven-api/src/routes/health.rs`
- Modify: `raven-api/tests/routes_health.rs`
- Modify: `docs/operations/api-reference.md`

- [ ] **Step 1: Write failing route tests**

Add authenticated tests for:

```http
GET /api/v1/health/reports?from=2026-07-22&to=2026-08-20
```

Assert status 200 and the complete typed JSON fields from Task 1. Assert missing `from`/`to`, malformed/nonexistent dates, reversed range, over-366-day range, and unknown query fields return the existing safe 400 envelope without paths, SQL, or raw storage errors.

- [ ] **Step 2: Run the route test and verify RED**

Run:

```powershell
cargo test -p raven-api --test routes_health health_reports -- --nocapture
```

Expected: FAIL with route not found.

- [ ] **Step 3: Add the read-only route**

Register `.route("/reports", get(reports))` and use:

```rust
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ReportsQuery {
    from: String,
    to: String,
}
```

Parse exact ISO local dates with a small `parse_date(value, field)` helper using `time::Date`; call `service.reports(HealthReportRange { from, to })`; serialize the engine DTO directly. Do not add a POST route, cache, request body, or separate API DTO copy.

- [ ] **Step 4: Document and verify the API**

Document the inclusive local-date semantics, 366-day limit, missing-as-null behavior, previous-period comparison, 24-hour open-start/closed-end window, active-only inputs, and no-causation disclaimer.

Run:

```powershell
cargo fmt --check
cargo test -p raven-api --test routes_health
git diff --check
```

Expected: PASS.

Commit:

```powershell
git commit -m "[ADD] Expose Health Reports API"
```

---

### Task 3: Parse Reports and define drilldown settings

**Files:**

- Create: `frontend/src/features/health/model/health-reports.ts`
- Create: `frontend/tests/domain/health-reports.spec.ts`
- Modify: `frontend/src/features/health/api/health-api.ts`
- Modify: `frontend/tests/domain/health-model.spec.ts`

- [ ] **Step 1: Write failing parser/selection tests**

Define:

```ts
export type HealthReportSelection =
  | { preset: 7 | 14 | 30 | 90 }
  | { preset: "custom"; from: string; to: string };

export type HealthReportDrilldown = {
  tab: "diet" | "bowel" | "medication" | "health-metrics";
  range: { start: string; end: string };
  field?: "tags" | "medication_name" | "bristol_scale" |
    "weight" | "sleep" | "crp" | "calprotectin" | "condition";
  value?: string | string[];
};
```

Freeze local today at `2026-08-20` and assert presets produce inclusive ranges: 7 => `2026-08-14..2026-08-20`, 30 => `2026-07-22..2026-08-20`, including month/year boundaries. Reject invalid/reversed custom ranges before calling the API.

Assert snake_case parsing keeps nullable comparisons, all five fixed metric series, exact units, frequencies, response numerator/denominator/rate, and RFC3339 instants.

- [ ] **Step 2: Run model tests and verify RED**

Run:

```powershell
npm --prefix frontend test -- health-reports.spec.ts health-model.spec.ts
```

Expected: FAIL because Reports types, parser, and query do not exist.

- [ ] **Step 3: Implement the API and pure range helpers**

Add `healthApi.reports({ from, to })` using existing `requestJson`, `apiUrl`, safe error parsing, and camel-case mapping patterns. Implement preset arithmetic with local `Date` getters and `localCalendarDate`; do not use UTC slicing for local presets.

- [ ] **Step 4: Implement exact AND drilldown rules**

Export:

```ts
export function applyHealthReportDrilldown(
  settings: PlannerTableSettings,
  target: HealthReportDrilldown,
): PlannerTableSettings
```

Clone settings, set `filterMode: "and"`, and replace filters with one inclusive `date is_between` rule plus the target rule when present. Use `tags contains [tag]`, `medication_name is [name]`, `bristol_scale is ["1","2","6","7"]`, and the selected fixed metric field `is_not_empty`. Preserve sort/group settings. Prove Diet/Bowel/Medication/Metrics receive only fields allowed by their existing scope.

- [ ] **Step 5: Run model gates and commit**

Run:

```powershell
npm --prefix frontend test -- health-reports.spec.ts health-model.spec.ts health-table-views.spec.ts planner-model.spec.ts
npm --prefix frontend run typecheck
```

Expected: PASS.

Commit:

```powershell
git commit -m "[ADD] Model Health Reports drilldowns"
```

---

### Task 4: Add retained-result Reports controller state

**Files:**

- Modify: `frontend/src/features/health/hooks/useHealthController.ts`
- Create: `frontend/tests/presentation/health-reports.spec.tsx`
- Modify fixture surfaces only in: `frontend/tests/presentation/health-panel.spec.tsx`, `health-forms.spec.tsx`, `diet-panel.spec.tsx`, `bowel-panel.spec.tsx`, `medication-panel.spec.tsx`, `health-metrics-panel.spec.tsx`, `quick-add.spec.tsx`

- [ ] **Step 1: Write failing controller tests**

Require:

```ts
reportStatus: LoadStatus;
reportError: string | null;
report: HealthReport | null;
reportSelection: HealthReportSelection;
runReports(selection: HealthReportSelection): Promise<boolean>;
retryReports(): Promise<boolean>;
```

Assert default selection is 30 days but no request occurs until `runReports` is called. Assert ordinary duplicate calls for the same range coalesce, a changed range supersedes older success/error, and loading/error retains the previous complete `report`. Retry uses the last selection and returns false/true without clearing retained data.

Assert initial controller mount reads only Diet, Bowel, Medication, and daily Metrics collections. Diet/Bowel/Medication/Metrics mutations refresh only their own dedicated collection after the mutation. Aggregate `refresh()` refreshes those four collections once each. It performs zero Timeline and zero Trends reads.

- [ ] **Step 2: Run controller tests and verify RED**

Run:

```powershell
npm --prefix frontend test -- health-reports.spec.tsx health-panel.spec.tsx health-forms.spec.tsx
```

Expected: FAIL because Reports state is absent and legacy Timeline/Trends reads remain coupled.

- [ ] **Step 3: Implement one Reports outcome chain**

Mirror the existing Ledger report generation pattern: keep one generation number, one ordinary in-flight promise keyed by `{from,to}`, and one latest retained outcome. On start set `reportStatus: "loading"` and `reportError: null` without clearing `report`. Only the newest completion may install data or error.

`runReports` resolves the selection to an inclusive range and calls `healthApi.reports`. `retryReports` calls `runReports` with the saved selection. Reports are read-only and never run from mutation refreshes.

- [ ] **Step 4: Remove frontend legacy read coupling**

Remove `timeline`, `timelineStatus/error`, `trends`, `trendsStatus/error`, `refreshTimeline`, `loadMoreTimeline`, and `refreshTrends` from the frontend controller public surface and fixtures. Keep backend endpoints and engine methods untouched for compatibility. Make the four collection refresh boundaries explicit rather than replacing them with a generic framework.

- [ ] **Step 5: Run controller regressions and commit**

Run:

```powershell
npm --prefix frontend test -- health-reports.spec.tsx health-panel.spec.tsx health-forms.spec.tsx diet-panel.spec.tsx bowel-panel.spec.tsx medication-panel.spec.tsx health-metrics-panel.spec.tsx quick-add.spec.tsx
npm --prefix frontend run typecheck
```

Expected: PASS with exact request counts and retained report behavior.

Commit:

```powershell
git commit -m "[UPDATE] Add Health Reports state"
```

---

### Task 5: Build the responsive Reports workspace

**Files:**

- Create: `frontend/src/features/health/ui/HealthReports.tsx`
- Create: `frontend/src/features/health/ui/HealthReportCharts.tsx`
- Modify: `frontend/src/features/dashboard/ui/DashboardLineChart.tsx`
- Modify: `frontend/src/features/health/ui/HealthPanel.tsx`
- Modify: `frontend/src/app/globals.css`
- Modify: `frontend/tests/presentation/health-reports.spec.tsx`
- Modify: `frontend/tests/presentation/health-panel.spec.tsx`

- [ ] **Step 1: Write failing presentation tests**

Directly assert:

- first Reports mount requests the 30-day inclusive range once;
- native preset buttons appear in `7, 14, 30, 90 days` order and custom uses two native date inputs plus Apply;
- invalid custom dates show an accessible error and make no request;
- the last complete analysis remains visible and `aria-busy=true` during replacement;
- blocking error, non-blocking refresh error, Retry false/true, and no-data copy are distinct;
- five latest-metric cards show units and preceding-measurement comparison or `Unavailable`;
- Diet, Bowel count/average, and Medication cards show previous equal-period comparison or `Unavailable`;
- the metric selector shows exactly Weight, Sleep, CRP, Calprotectin, Condition and one unit at a time;
- bowel points expose chronological accessible labels and the 3–5 reference band;
- every frequency/response row is keyboard-activatable and includes an accessible text alternative;
- response rows display `positive / eligible (percentage)` plus the exact disclaimer.

- [ ] **Step 2: Run presentation tests and verify RED**

Run:

```powershell
npm --prefix frontend test -- health-reports.spec.tsx health-panel.spec.tsx
```

Expected: FAIL because the Reports workspace is absent.

- [ ] **Step 3: Build period/loading/error states**

Follow `LedgerReports`: one `useRef` guards default 30-day loading, controls call `runReports`, and Retry calls `retryReports`. Never blank retained analysis during loading/error. With no report and loading show `Loading reports…`; with a successful report containing no usable data show `No health records are available for this period.` Empty charts name the required source, for example `Add bowel records to see a bowel trend.`

- [ ] **Step 4: Render the smallest accessible chart set**

Reuse `DashboardLineChart` for bowel and selected metric series. Add only an optional prop:

```ts
referenceBand?: { minimum: number; maximum: number; label: string };
```

Render it as one positioned, `aria-hidden` SVG/background band while the surrounding chart label states `Typical Bristol band 3 to 5`. Existing callers pass no prop and remain unchanged.

Render medication/tag frequencies and tag response as semantic lists of native buttons with CSS bars; do not add a chart dependency. Use CSS grid on desktop and one column under the existing narrow breakpoint.

- [ ] **Step 5: Run UI regressions and commit**

Run:

```powershell
npm --prefix frontend test -- health-reports.spec.tsx health-panel.spec.tsx workbench-wireframe.spec.tsx
npm --prefix frontend run typecheck
```

Expected: PASS, including existing Dashboard charts.

Commit:

```powershell
git commit -m "[ADD] Build Health Reports workspace"
```

---

### Task 6: Replace Trends navigation and wire filtered drilldown

**Files:**

- Modify: `frontend/src/domain/workbench/navigation.ts`
- Modify: `frontend/src/features/workbench/ui/MainPanel.tsx`
- Modify: `frontend/src/features/health/ui/HealthPanel.tsx`
- Delete: `frontend/src/features/health/ui/HealthTrendsPanel.tsx`
- Modify: `frontend/tests/domain/workbench-navigation.spec.ts`
- Modify: `frontend/tests/presentation/health-reports.spec.tsx`
- Modify: `frontend/tests/presentation/workbench-wireframe.spec.tsx`

- [ ] **Step 1: Write failing navigation and drilldown tests**

Assert public Health tabs are exactly:

```ts
[
  ["diet", "Diet"],
  ["bowel", "Bowel"],
  ["medication", "Medication"],
  ["health-metrics", "Health Metrics"],
  ["reports", "Reports"],
]
```

Assert `resolveSelection("reports")` selects Health/Reports, `trends` is no longer a `HealthTabId`, invalid Health leaves still fall back to Diet, and no visible Timeline/Trends tab exists.

Click each report target and assert the workbench selects the correct record tab and the controller receives exact AND filters:

```ts
{
  filterMode: "and",
  filterRules: [
    { field: "date", type: "date", operator: "is_between",
      value: { start: "2026-07-22", end: "2026-08-20" } },
    { field: "medication_name", type: "text", operator: "is", value: ["Mesalamine"] },
  ],
}
```

Also cover Diet tag, abnormal Bowel, and each selected metric drilldown. Preserve the target table's sort/group settings.

- [ ] **Step 2: Run navigation tests and verify RED**

Run:

```powershell
npm --prefix frontend test -- workbench-navigation.spec.ts health-reports.spec.tsx workbench-wireframe.spec.tsx
```

Expected: FAIL because public navigation still exposes Trends and HealthWorkspace lacks a drilldown bridge.

- [ ] **Step 3: Wire the existing workbench/controller seams**

Change `HealthTabId` and the public tab list from `trends` to `reports`. Pass `workbench` into `HealthWorkspace`, then:

```ts
function drilldown(target: HealthReportDrilldown) {
  const scope = `health.${target.tab === "health-metrics" ? "metrics" : target.tab}` as HealthTableScopeId;
  controller.updateTableSettings(scope, (settings) =>
    applyHealthReportDrilldown(settings, target));
  controller.selectTableTab(scope, controller.tableTabs(scope).activeTabId);
  workbench.selectTab(target.tab);
}
```

Use the existing selected tab when valid; do not create or auto-save a new view. Render `HealthReports` only for `reports`. Delete `HealthTrendsPanel.tsx` after `rg` proves no callers remain.

- [ ] **Step 4: Run navigation/UI gates and commit**

Run:

```powershell
npm --prefix frontend test -- workbench-navigation.spec.ts health-reports.spec.tsx health-panel.spec.tsx workbench-wireframe.spec.tsx
npm --prefix frontend run typecheck
git diff --check
```

Expected: PASS and `rg -n 'HealthTrendsPanel|leafTabId === "trends"' frontend/src frontend/tests` returns no matches.

Commit:

```powershell
git commit -m "[UPDATE] Replace Health Trends with Reports"
```

---

### Task 7: Synchronize stable docs and run the final gate

**Files:**

- Modify: `README.md`
- Modify: `frontend/README.md`
- Verify: `docs/architecture/data-model.md`
- Verify: `docs/operations/api-reference.md`
- Verify: `docs/superpowers/specs/2026-08-18-health-journal-ux-design.md`
- Verify: `AGENTS.md`, `CLAUDE.md`

- [ ] **Step 1: Update only stale public navigation facts**

Use `readme-structure-guard` before editing either README and `docs-change-updater` for current-state wording. Replace public Health `Trends` navigation with `Reports`; retain legacy `/health/trends` and CLI references where they document supported compatibility APIs. Do not claim diagnosis, causation, alerts, or a report cache.

- [ ] **Step 2: Audit the approved Reports contract**

Map every design bullet to an implementation/test: 7/14/30/90/custom inclusive periods; previous complete result retention; five latest metric comparisons; equal-period Diet/Bowel/Medication comparisons; missing-as-unavailable; bowel band; single-unit metric selector; all frequencies; exact response boundaries/eligibility/overlap; disclaimer; keyboard/text alternatives; empty/error/retry; and all drilldowns.

Confirm no schema, dependency, lockfile, custom metric, Timeline UI, Trends UI, report cache, summary table, restore/purge UI, diagnosis, or recommendation was added.

- [ ] **Step 3: Run frontend gates sequentially**

```powershell
npm --prefix frontend test
npm --prefix frontend run typecheck
npm --prefix frontend run build
```

Expected: every test passes and Next generates all static pages. Do not run typecheck concurrently with build because both access `.next/types`.

- [ ] **Step 4: Run Rust gates**

```powershell
cargo fmt --check
cargo test --workspace
cargo clippy --all-targets --all-features -- -D warnings
```

Expected: PASS except independently reproduced pre-existing host-specific failures, which must be reported rather than hidden or fixed outside scope. Always run the focused `reports` and `routes_health` tests even if a workspace baseline fails.

- [ ] **Step 5: Verify scope and user-owned state**

```powershell
git diff --check
git status --short
git diff -- frontend/package-lock.json Cargo.lock
```

Expected: the pre-existing user-owned `frontend/package-lock.json` modification remains unstaged and byte-for-byte untouched; `Cargo.lock` is unchanged; only planned Reports/code/test/docs files are committed.

- [ ] **Step 6: Request review and record evidence**

Use `superpowers:requesting-code-review`. Reproduce every proposed finding with a focused failing test before changing production code. Commit independent fixes separately with `structured-commit`.

Report exact frontend/Rust counts, typecheck/build/clippy results, commit list, changed files, docs state, lockfile preservation, worktree status, and any reproduced external baseline. Do not merge or push without the user's explicit instruction.

---

## Self-review result

- Spec coverage: every Reports period, summary, chart, diet-tag response boundary, drilldown, loading/error/empty, navigation, and architecture/non-goal requirement maps to Tasks 1–7.
- Simplicity: one new engine report projection and one API read route; no cache, migration, dependency, or generic report framework.
- Compatibility: legacy engine/API/CLI Timeline and Trends remain; only their public frontend surface and controller coupling are removed.
- Type consistency: API range uses `from/to`; shared table filters use `start/end`; the frontend model converts between them in one pure helper.
- User state: the existing unstaged `frontend/package-lock.json` change is explicitly preserved and never staged.
