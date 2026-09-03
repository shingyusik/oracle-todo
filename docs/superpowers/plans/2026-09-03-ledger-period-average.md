# Ledger Period Average Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Calculate Ledger average daily spending over the elapsed portion of each selected period and show its formatted value in the shared spending-chart legend.

**Architecture:** Extend the existing shared report loader with one observed-period summary, reusing `LedgerState.summary` for the Reports path and returning the same summary directly to Dashboard highlights. `buildLedgerReportModel` remains the single formula used by both surfaces; the shared trend component renders the value once for both callers.

**Tech Stack:** TypeScript, React, existing Raven Ledger API client, Vitest, Testing Library, CSS

---

## File Structure

- `frontend/src/features/ledger/api/ledger-report-loader.ts`: derive the browser-local observed range and load its summary.
- `frontend/src/features/ledger/hooks/useLedgerController.ts`: retain the loader's observed summary in the existing report state.
- `frontend/src/features/ledger/model/ledger-reports.ts`: calculate the daily average from observed spending and observed calendar days.
- `frontend/src/features/ledger/ui/LedgerReports.tsx`: pass the observed summary into the shared model.
- `frontend/src/features/dashboard/ui/DashboardLedgerHighlights.tsx`: pass the same observed summary into the shared model.
- `frontend/src/features/ledger/ui/LedgerReportCharts.tsx`: label the summary denominator and render the formatted average in the legend.
- `frontend/tests/domain/ledger-reports.spec.ts`: cover partial, completed, and future-only average windows.
- `frontend/tests/presentation/ledger-panel.spec.tsx`: cover loader range selection and Report presentation.
- `frontend/tests/presentation/dashboard-ledger-highlights.spec.tsx`: cover the reused Dashboard value.
- Other `LedgerReportData` fixtures found by `rg -n "LedgerReportData" frontend/tests`: add the required `summary` field without changing their scenario.

### Task 1: Load the observed-period spending summary

**Files:**
- Modify: `frontend/src/features/ledger/api/ledger-report-loader.ts`
- Test: `frontend/tests/presentation/ledger-panel.spec.tsx`
- Update fixtures: `frontend/tests/presentation/dashboard-panel.spec.tsx`
- Update fixtures: `frontend/tests/presentation/dashboard-ledger-highlights.spec.tsx`
- Update fixtures: `frontend/tests/presentation/workbench-wireframe.spec.tsx`

- [ ] **Step 1: Write failing loader tests**

Add tests beside `loads all report data from the comparison's canonical current range` that inject
`2026-09-03` into `loadLedgerReport` and assert these cases:

```ts
it.each([
  ["current month", { period: "current_month" }, "2026-09-01", "2026-09-30"],
  ["current year", { period: "current_year" }, "2026-01-01", "2026-12-31"],
  ["future-ending custom range", { period: "custom", from: "2026-09-01", to: "2026-09-10" }, "2026-09-01", "2026-09-10"],
] as const)("loads an elapsed summary for %s", async (
  _name, selection, start, end,
) => {
  const selected = stubReportLoad(start, end);
  const observed = {
    ...selected.current,
    range: { start, end: "2026-09-03" },
  };
  const summary = vi.spyOn(ledgerApi, "summary").mockResolvedValue(observed);

  const result = await loadLedgerReport(selection, "2026-09-03");

  expect(summary).toHaveBeenCalledWith({ from: start, to: "2026-09-03" });
  expect(result.summary).toBe(observed);
});
```

Add completed and future-only cases:

```ts
it("reuses the selected summary for a completed period", async () => {
  const selected = stubReportLoad("2026-08-01", "2026-08-31");
  const summary = vi.spyOn(ledgerApi, "summary");
  const result = await loadLedgerReport({ period: "previous_month" }, "2026-09-03");
  expect(summary).not.toHaveBeenCalled();
  expect(result.summary).toBe(selected.current);
});

it("uses no observed summary when the range starts in the future", async () => {
  stubReportLoad("2026-09-10", "2026-09-20");
  const summary = vi.spyOn(ledgerApi, "summary");
  const result = await loadLedgerReport(
    { period: "custom", from: "2026-09-10", to: "2026-09-20" },
    "2026-09-03",
  );
  expect(summary).not.toHaveBeenCalled();
  expect(result.summary).toBeNull();
});

function stubReportLoad(start: string, end: string) {
  const selected = comparison(start, end);
  vi.spyOn(ledgerApi, "compare").mockResolvedValue(selected);
  vi.spyOn(ledgerApi, "categoryReport").mockResolvedValue([]);
  vi.spyOn(ledgerApi, "trend").mockResolvedValue(trend(start, end));
  vi.spyOn(ledgerApi, "listAccountBalances")
    .mockResolvedValue({ items: [], nextOffset: null });
  return selected;
}
```

- [ ] **Step 2: Run the loader tests and verify RED**

Run:

```powershell
npm --prefix frontend test -- tests/presentation/ledger-panel.spec.tsx
```

Expected: FAIL because `loadLedgerReport` does not accept the date argument and does not return
`summary`.

- [ ] **Step 3: Implement the observed range in the shared loader**

Add `LedgerSummary` to the model imports and extend the result:

```ts
export type LedgerReportData = {
  comparison: LedgerComparison;
  categoryBreakdown: BreakdownRow[];
  trend: LedgerTrend;
  balances: AccountBalance[];
  summary: LedgerSummary | null;
};
```

Use a local date default and the existing summary endpoint:

```ts
export async function loadLedgerReport(
  selection: ReportSelection,
  today = localCalendarDate(new Date()),
): Promise<LedgerReportData> {
  const comparison = await ledgerApi.compare(selection);
  const range = {
    from: comparison.current.range.start,
    to: comparison.current.range.end,
  };
  const observedSummary = range.from > today
    ? Promise.resolve(null)
    : range.to <= today
      ? Promise.resolve(comparison.current)
      : ledgerApi.summary({ from: range.from, to: today });
  const [categoryBreakdown, trend, balances, summary] = await Promise.all([
    ledgerApi.categoryReport(range),
    ledgerApi.trend(range),
    drainPages((offset) => ledgerApi.listAccountBalances({ limit: 200, offset })),
    observedSummary,
  ]);
  return { comparison, categoryBreakdown, trend, balances, summary };
}

function localCalendarDate(value: Date): string {
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}
```

Add `summary` to every typed `LedgerReportData` fixture. Use the fixture's
`comparison.current` for completed ranges and `null` only for future-only fixtures.

- [ ] **Step 4: Run the loader tests and verify GREEN**

Run the same command. Expected: all `ledger-panel.spec.tsx` tests pass.

- [ ] **Step 5: Commit the loader unit**

```powershell
git add frontend/src/features/ledger/api/ledger-report-loader.ts frontend/tests/presentation/ledger-panel.spec.tsx frontend/tests/presentation/dashboard-panel.spec.tsx frontend/tests/presentation/dashboard-ledger-highlights.spec.tsx frontend/tests/presentation/workbench-wireframe.spec.tsx
git commit -m "[FIX] Load elapsed Ledger report summaries"
```

### Task 2: Use one elapsed-day formula in Reports and Dashboard

**Files:**
- Modify: `frontend/src/features/ledger/hooks/useLedgerController.ts`
- Modify: `frontend/src/features/ledger/model/ledger-reports.ts`
- Modify: `frontend/src/features/ledger/ui/LedgerReports.tsx`
- Modify: `frontend/src/features/dashboard/ui/DashboardLedgerHighlights.tsx`
- Test: `frontend/tests/domain/ledger-reports.spec.ts`
- Test: `frontend/tests/presentation/dashboard-ledger-highlights.spec.tsx`

- [ ] **Step 1: Write failing model tests**

Add a partial observed summary and verify the screenshot case:

```ts
it("uses observed spending and elapsed days for an active period", () => {
  const selected = {
    ...comparison,
    current: {
      ...comparison.current,
      range: { start: "2026-09-01", end: "2026-09-30" },
    },
  };
  const observed = {
    range: { start: "2026-09-01", end: "2026-09-03" },
    currencies: [{ ...current, expenseMinor: 34_089 }],
  };
  const model = buildLedgerReportModel(
    selected, categories, balances, trend, "currency-usd", observed,
  );
  expect(model.metrics.averageDailyExpenseMinor).toBe(11_363);
});

it("returns a zero average for a future-only period", () => {
  const model = buildLedgerReportModel(
    comparison, categories, balances, trend, "currency-usd", null,
  );
  expect(model.metrics.averageDailyExpenseMinor).toBe(0);
});
```

Override the observed summary in the Dashboard test and assert the screenshot case:

```ts
it("shows the elapsed current-month average", async () => {
  const data = reportData({
    incomeMinor: 0,
    expenseMinor: 34_089,
  });
  data.summary = {
    range: { start: "2026-09-01", end: "2026-09-03" },
    currencies: [{
      ...data.comparison.current.currencies[0]!,
      expenseMinor: 34_089,
    }],
  };
  vi.mocked(loadLedgerReport).mockResolvedValue(data);
  render(<DashboardLedgerHighlights mutationEpoch={0} onNavigate={vi.fn()} />);
  expect(await screen.findByRole("region", { name: "Cash Flow" }))
    .toHaveTextContent("11,363 KRW");
});
```

- [ ] **Step 2: Run focused tests and verify RED**

```powershell
npm --prefix frontend test -- tests/domain/ledger-reports.spec.ts tests/presentation/dashboard-ledger-highlights.spec.tsx
```

Expected: FAIL because the model has no observed-summary parameter and Dashboard still divides by
the full selected range.

- [ ] **Step 3: Implement the shared formula and wire both callers**

Extend `buildLedgerReportModel`:

```ts
export function buildLedgerReportModel(
  comparison: LedgerComparison,
  categories: BreakdownRow[],
  balances: AccountBalance[],
  trend: LedgerTrend,
  currencyId: string,
  observedSummary: LedgerSummary | null = comparison.current,
): LedgerReportModel {
  const observed = observedSummary?.currencies.find(
    (row) => row.currencyId === currencyId,
  );
  const observedDays = observedSummary
    ? inclusiveDays(observedSummary.range.start, observedSummary.range.end)
    : 0;
  const averageDailyExpenseMinor = observedDays === 0
    ? 0
    : Math.round((observed?.expenseMinor ?? 0) / observedDays);
```

In `useLedgerController.runReports`, retain the returned value using the existing state field:

```ts
const { comparison, categoryBreakdown, trend, balances, summary } =
  await loadLedgerReport(selection);
setState((current) => ({
  ...current,
  reportStatus: "loaded",
  reportError: null,
  comparison,
  trend,
  summary,
  categoryBreakdown,
  balances,
}));
```

Pass `state.summary` as the sixth argument from `LedgerReports`, and `data.summary` as the sixth
argument from `DashboardLedgerHighlights`.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the same focused command. Expected: both files pass.

- [ ] **Step 5: Commit the shared calculation unit**

```powershell
git add frontend/src/features/ledger/hooks/useLedgerController.ts frontend/src/features/ledger/model/ledger-reports.ts frontend/src/features/ledger/ui/LedgerReports.tsx frontend/src/features/dashboard/ui/DashboardLedgerHighlights.tsx frontend/tests/domain/ledger-reports.spec.ts frontend/tests/presentation/dashboard-ledger-highlights.spec.tsx
git commit -m "[FIX] Calculate elapsed Ledger daily spending"
```

### Task 3: Show the average value in the shared trend legend

**Files:**
- Modify: `frontend/src/features/ledger/ui/LedgerReportCharts.tsx`
- Test: `frontend/tests/presentation/ledger-panel.spec.tsx`
- Test: `frontend/tests/presentation/dashboard-ledger-highlights.spec.tsx`

- [ ] **Step 1: Write failing presentation assertions**

Update the Report trend test:

```ts
expect(screen.getByText("Average daily · 23 KRW")).toBeInTheDocument();
await user.click(screen.getByRole("tab", { name: "Income" }));
expect(screen.queryByText(/Average daily ·/)).toBeNull();
```

Add the matching Dashboard assertion inside the shared chart scenario:

```ts
expect(within(surface).getByText("Average daily · 44,645 KRW"))
  .toBeInTheDocument();
```

Assert that the Summary average card includes `Elapsed calendar days`.

- [ ] **Step 2: Run presentation tests and verify RED**

```powershell
npm --prefix frontend test -- tests/presentation/ledger-panel.spec.tsx tests/presentation/dashboard-ledger-highlights.spec.tsx
```

Expected: FAIL because the legend contains no amount and the Summary context still says selected
period calendar days.

- [ ] **Step 3: Render the formatted value through the existing formatter**

In `ReportSummaryCards`, change the context to `Elapsed calendar days`. In the Spending legend,
reuse `reportMoney`:

```tsx
<div className="ledger-report-trend-legend">
  <span>
    Average daily · {reportMoney(
      model.metrics.averageDailyExpenseMinor,
      currency,
      model.currencyCode,
    )}
  </span>
</div>
```

No new CSS is required because the existing legend already occupies the approved top-right
position.

- [ ] **Step 4: Run presentation tests and verify GREEN**

Run the same presentation command. Expected: both files pass.

- [ ] **Step 5: Commit the presentation unit**

```powershell
git add frontend/src/features/ledger/ui/LedgerReportCharts.tsx frontend/tests/presentation/ledger-panel.spec.tsx frontend/tests/presentation/dashboard-ledger-highlights.spec.tsx
git commit -m "[UPDATE] Label Ledger average spending lines"
```

### Task 4: Verify the complete frontend

**Files:**
- Verify all changed frontend and documentation files.

- [ ] **Step 1: Run the focused Ledger suite**

```powershell
npm --prefix frontend test -- tests/domain/ledger-reports.spec.ts tests/presentation/ledger-panel.spec.tsx tests/presentation/dashboard-ledger-highlights.spec.tsx tests/presentation/dashboard-panel.spec.tsx tests/presentation/workbench-wireframe.spec.tsx
```

Expected: all focused tests pass.

- [ ] **Step 2: Run the full frontend suite**

```powershell
npm --prefix frontend test -- --reporter=dot
```

Expected: all test files and tests pass.

- [ ] **Step 3: Run typecheck and production build sequentially**

```powershell
npm --prefix frontend run typecheck
npm --prefix frontend run build
```

Expected: both commands exit 0. Do not run them concurrently because Next.js replaces `.next`
while building.

- [ ] **Step 4: Inspect final state**

```powershell
git diff --check
git status --short
git log --oneline -n 10
```

Expected: no whitespace errors, only intentional changes if any remain, and three clear
implementation commits after the design and plan commits.
