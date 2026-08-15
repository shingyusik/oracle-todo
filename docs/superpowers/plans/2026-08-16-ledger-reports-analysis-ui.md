# Ledger Reports Analysis UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the legacy Ledger report form with the SHI-73 period analysis UI, including currency-separated comparisons, category/account analysis, automatic trends, and filtered Transactions drilldown.

**Architecture:** Keep report policy on the existing server endpoints. The frontend maps the established ordinal-date wire contract, asks `/reports/compare` for the canonical current range, then loads breakdowns and trend for that returned range. Pure Ledger model helpers build display data and Transactions filter rules; the controller owns request generations; presentation components render native CSS/SVG charts without adding a dependency.

**Tech Stack:** Next.js 14, React 18, TypeScript 5.5, Vitest, Testing Library, existing Raven JSON API helpers and Ledger table-view model.

**Spec:** `docs/superpowers/specs/2026-08-14-ledger-reports-ux-design.md`

## Global Constraints

- Reports default to the current calendar month and offer Current month, Previous month, Current year, and Custom range.
- Currency totals remain separate; never sum or convert currencies.
- The server remains authoritative for preset and custom comparison ranges.
- Category donut values and the category table use the same expense rows.
- Drilldown applies period, currency, and selected category or account as AND filters before opening Transactions.
- Loading and retry preserve period and currency selection.
- Do not add a chart package; use existing design tokens plus native CSS/SVG.
- Do not expose raw API/storage errors or the legacy briefing markdown.

---

### Task 1: Map report contracts and derive report/drilldown models

**Files:**
- Create: `frontend/src/features/ledger/model/ledger-reports.ts`
- Modify: `frontend/src/features/ledger/model/ledger-model.ts`
- Modify: `frontend/src/features/ledger/api/ledger-api.ts`
- Modify: `frontend/src/features/ledger/model/ledger-table-views.ts`
- Modify: `frontend/src/features/ledger/model/transaction-table.ts`
- Test: `frontend/tests/domain/ledger-model.spec.ts`
- Test: `frontend/tests/domain/ledger-reports.spec.ts`
- Test: `frontend/tests/domain/ledger-table-views.spec.ts`
- Test: `frontend/tests/domain/transaction-table.spec.ts`

**Interfaces:**
- Consumes: `/reports/compare` aligned `currencies`, `/reports/trend`, existing `PlannerTableSettings` and filter rules.
- Produces: `ReportSelection`, `LedgerComparison`, `LedgerTrend`, `buildLedgerReportModel(...)`, and `applyReportDrilldown(settings, target)` for Tasks 2-3.

- [ ] **Step 1: Write failing wire-contract tests**

Add focused cases proving ordinal dates, aligned currency comparison rows, trend points, and unsafe values are mapped:

```ts
expect(mapLedgerComparison({
  current: summary([2026, 213], [2026, 243]),
  previous: summary([2026, 182], [2026, 212]),
  currencies: [{
    currency_id: "currency-usd",
    currency_code: "USD",
    current: currencySummary("currency-usd", "USD", 1000, 400, 600, 2),
    previous: currencySummary("currency-usd", "USD", 800, 500, 300, 3),
  }],
}).current.range).toEqual({ start: "2026-08-01", end: "2026-08-31" });

expect(mapLedgerTrend({
  range: { start: [2026, 213], end: [2026, 214] },
  granularity: "daily",
  currencies: [{ currency_id: "currency-usd", currency_code: "USD", points: [
    { start: [2026, 213], end: [2026, 213], income_minor: 100, expense_minor: 25 },
  ] }],
}).currencies[0].points[0].start).toBe("2026-08-01");
```

- [ ] **Step 2: Run the mapper tests and verify RED**

Run: `npm --prefix frontend test -- tests/domain/ledger-model.spec.ts`

Expected: FAIL because aligned comparison currencies, ordinal dates, and trend mapping do not exist.

- [ ] **Step 3: Implement the exact frontend contracts**

In `ledger-model.ts`, add the aligned comparison and trend types, plus a Ledger-local ordinal date decoder. Keep `isoDate` for endpoints that already return ISO strings.

```ts
export type CurrencyComparison = {
  currencyId: string;
  currencyCode: string;
  current: CurrencySummary;
  previous: CurrencySummary;
};
export type LedgerComparison = {
  current: LedgerSummary;
  previous: LedgerSummary;
  currencies: CurrencyComparison[];
};
export type TrendGranularity = "daily" | "weekly" | "monthly";
export type TrendPoint = {
  start: string;
  end: string;
  incomeMinor: number;
  expenseMinor: number;
};
export type CurrencyTrend = {
  currencyId: string;
  currencyCode: string;
  points: TrendPoint[];
};
export type LedgerTrend = {
  range: ReportRange;
  granularity: TrendGranularity;
  currencies: CurrencyTrend[];
};
```

Decode `[year, ordinal]` only after validating integer year/ordinal and round-tripping through UTC date construction. Return `YYYY-MM-DD`; throw the existing safe boundary error for invalid wire values.

- [ ] **Step 4: Add failing API query tests, then implement preset/custom compare and trend clients**

Define:

```ts
export type ReportSelection =
  | { period: "current_month" | "previous_month" | "current_year" }
  | { period: "custom"; from: string; to: string };

compare(input: ReportSelection): Promise<LedgerComparison>;
trend(input: ReportRangeInput): Promise<LedgerTrend>;
```

Assert exact query strings through the existing request mock. `compare()` sends `period` and only sends `from`/`to` for custom; `trend()` sends `from`, `to`, and `granularity=auto`.

- [ ] **Step 5: Write failing pure report-model and drilldown tests**

Cover:

```ts
const model = buildLedgerReportModel(comparison, categories, accounts, trend, "currency-usd");
expect(model.summary.map(({ valueMinor }) => valueMinor)).toEqual([1000, 400, 600]);
expect(model.summary[3].count).toBe(2);
expect(model.categories.reduce((sum, row) => sum + row.expenseMinor, 0)).toBe(400);
expect(model.trend.points.map(({ incomeMinor, expenseMinor }) =>
  [incomeMinor, expenseMinor])).toEqual([[100, 25]]);

const next = applyReportDrilldown(settings, {
  range: { start: "2026-08-01", end: "2026-08-31" },
  currencyId: "currency-usd",
  kind: "category",
  referenceId: "category-food",
});
expect(next.filterMode).toBe("and");
expect(next.filterRules.map(({ field }) => field)).toEqual(["date", "currency", "category"]);
```

Also prove account drilldown uses `account`, existing non-report filter rules are replaced, and an empty currency produces zero cards and empty sections.

- [ ] **Step 6: Implement the smallest pure model and Transactions currency support**

`buildLedgerReportModel` selects exactly one currency from each response, derives changes as `current - previous`, filters category rows to positive expenses, and returns zero values when a selected currency has no current rows. `applyReportDrilldown` returns a cloned settings object with deterministic IDs and three AND rules.

Add `currency` to `ledger.transactions` filter fields, return `[row.currencyId, row.currencyCode]` from `transactionFilterValue`, and expose active currencies as filter candidates through the existing Ledger header path. Do not persist drilldown automatically.

- [ ] **Step 7: Run the focused domain tests and commit**

Run:

```bash
npm --prefix frontend test -- tests/domain/ledger-model.spec.ts tests/domain/ledger-reports.spec.ts tests/domain/ledger-table-views.spec.ts tests/domain/transaction-table.spec.ts
npm --prefix frontend run typecheck
```

Expected: all selected tests and typecheck PASS.

Commit:

```bash
git add frontend/src/features/ledger/model/ledger-model.ts frontend/src/features/ledger/model/ledger-reports.ts frontend/src/features/ledger/model/ledger-table-views.ts frontend/src/features/ledger/model/transaction-table.ts frontend/src/features/ledger/api/ledger-api.ts frontend/tests/domain/ledger-model.spec.ts frontend/tests/domain/ledger-reports.spec.ts frontend/tests/domain/ledger-table-views.spec.ts frontend/tests/domain/transaction-table.spec.ts
git commit -m "[ADD] Model Ledger report analysis"
```

---

### Task 2: Orchestrate canonical report loading in the Ledger controller

**Files:**
- Modify: `frontend/src/features/ledger/hooks/useLedgerController.ts`
- Test: `frontend/tests/presentation/ledger-panel.spec.tsx`

**Interfaces:**
- Consumes: Task 1 `ReportSelection`, `LedgerComparison`, and `LedgerTrend`.
- Produces: `LedgerState.comparison`, `LedgerState.trend`, `LedgerState.reportSelection`, and generation-safe `runReports(selection)` / `retryReports()`.

- [ ] **Step 1: Write failing controller tests**

Use a production `useLedgerController()` harness with API spies. Prove:

1. initial Ledger load does not request reports until Reports is opened;
2. `runReports({ period: "current_month" })` first awaits `compare`, then uses `comparison.current.range` for accounts, categories, and trend;
3. a newer request wins over a late older success or failure;
4. failure keeps the previous report data and selection while exposing one safe retry action;
5. `retryReports()` repeats the last selection.

```ts
await act(async () => controller.runReports({ period: "current_month" }));
expect(ledgerApi.accountReport).toHaveBeenCalledWith({
  from: "2026-08-01",
  to: "2026-08-31",
});
expect(controller.state.reportSelection).toEqual({ period: "current_month" });
```

- [ ] **Step 2: Run the focused presentation test and verify RED**

Run: `npm --prefix frontend test -- tests/presentation/ledger-panel.spec.tsx`

Expected: FAIL because the state and orchestration contract do not exist.

- [ ] **Step 3: Implement generation-safe two-stage loading**

Extend report state without changing general Ledger refresh state:

```ts
comparison: LedgerComparison | null;
trend: LedgerTrend | null;
reportSelection: ReportSelection;
```

Use `reportGeneration.current` to ignore stale completions. `runReports` must:

1. store the requested selection and set `reportStatus: "loading"` without clearing loaded data;
2. await `ledgerApi.compare(selection)`;
3. convert the returned current range to `{ from, to }`;
4. load account report, category report, and trend in one `Promise.all`;
5. atomically publish comparison, `summary: comparison.current`, breakdowns, and trend;
6. retain controls/data and set only the safe error on failure.

Remove the briefing request and state from this path because the approved Reports UI has exactly category, account, and trend analysis sections and must not expose raw briefing content.

- [ ] **Step 4: Add the Reports-entry default load boundary**

Keep the hook free of navigation knowledge. In the presentation boundary, call `runReports({ period: "current_month" })` once when the Reports panel first mounts and `reportStatus === "idle"`. React StrictMode must not cause duplicate visible state or allow an older response to overwrite a retry.

- [ ] **Step 5: Run focused tests and commit**

Run:

```bash
npm --prefix frontend test -- tests/presentation/ledger-panel.spec.tsx
npm --prefix frontend run typecheck
```

Expected: PASS.

Commit:

```bash
git add frontend/src/features/ledger/hooks/useLedgerController.ts frontend/tests/presentation/ledger-panel.spec.tsx
git commit -m "[UPDATE] Load Ledger report analysis"
```

---

### Task 3: Build the analysis UI and Transactions drilldown

**Files:**
- Create: `frontend/src/features/ledger/ui/LedgerReportCharts.tsx`
- Modify: `frontend/src/features/ledger/ui/LedgerReports.tsx`
- Modify: `frontend/src/features/ledger/ui/LedgerPanel.tsx`
- Modify: `frontend/src/features/workbench/ui/MainPanel.tsx`
- Modify: `frontend/src/styles/globals.css`
- Test: `frontend/tests/presentation/ledger-panel.spec.tsx`
- Test: `frontend/tests/presentation/workbench-wireframe.spec.tsx`
- Test: `frontend/tests/architecture/design-boundaries.spec.ts`

**Interfaces:**
- Consumes: Task 1 report view model and drilldown target; Task 2 report state/actions.
- Produces: accessible period/currency controls, summary cards, category donut+table, account table, two-series trend, and a callback path to Transactions.

- [ ] **Step 1: Write failing Reports presentation tests**

Cover the user-visible contract:

- Current month is selected and requested by default.
- Preset buttons and valid custom dates submit the matching `ReportSelection`.
- Currency tabs never combine rows and preserve selection across loading/error/retry.
- Four cards render current values and signed comparison changes.
- Category donut labels and table expenses have the same total.
- Account rows show income, expense, and net.
- Trend announces its daily/weekly/monthly granularity and exposes both income and expense values to assistive technology.
- Empty responses show zero cards plus section-specific empty messages.
- Loading marks report content `aria-busy`; retry calls `retryReports` without resetting controls.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `npm --prefix frontend test -- tests/presentation/ledger-panel.spec.tsx`

Expected: FAIL against the legacy From/To report form.

- [ ] **Step 3: Implement controls, cards, tables, and native charts**

Replace the legacy form with:

```tsx
<ReportPeriodControls selection={selection} onChange={runReports} />
<ReportCurrencyTabs currencies={model.currencies} selectedId={currencyId} />
<div aria-busy={state.reportStatus === "loading"}>
  <ReportSummaryCards cards={model.summary} />
  <ExpenseCategorySection rows={model.categories} onDrilldown={onDrilldown} />
  <AccountReportSection rows={model.accounts} onDrilldown={onDrilldown} />
  <LedgerTrendChart trend={model.trend} />
</div>
```

Use native `<input type="date">`. The donut uses a CSS `conic-gradient` generated from category percentages and a button legend. The trend uses one SVG with two polylines sharing the same scale; every point also has an accessible textual label. Reuse existing chart color variables and focus styles; add only Ledger-specific layout selectors.

- [ ] **Step 4: Write failing end-to-end drilldown tests**

At the `MainPanel`/Workbench boundary, click one category and one account result and assert:

```ts
expect(workbench.selection.leafTabId).toBe("transactions");
expect(ledger.tableSettings("ledger.transactions").filterRules).toEqual([
  expect.objectContaining({ field: "date", operator: "is_between" }),
  expect.objectContaining({ field: "currency", operator: "is" }),
  expect.objectContaining({ field: "category", operator: "is" }),
]);
```

Also assert the resulting Transactions table shows only matching rows and that rows without a `referenceId` do not render a drilldown button.

- [ ] **Step 5: Implement the minimal navigation callback chain**

Pass one callback through `MainPanel -> LedgerWorkspace -> LedgerPanel -> LedgerReports`. In `LedgerWorkspace`, apply Task 1's pure drilldown settings through:

```ts
ledger.updateTableSettings("ledger.transactions", (settings) =>
  applyReportDrilldown(settings, target));
workbench.selectTab("transactions");
```

The callback must update only the active Transactions tab draft, leave other saved views unchanged, and navigate only after valid rendered category/account targets.

- [ ] **Step 6: Run focused frontend checks and commit**

Run:

```bash
npm --prefix frontend test -- tests/presentation/ledger-panel.spec.tsx tests/presentation/workbench-wireframe.spec.tsx tests/architecture/design-boundaries.spec.ts
npm --prefix frontend run typecheck
npm --prefix frontend run build
```

Expected: all selected tests, typecheck, and build PASS.

Commit:

```bash
git add frontend/src/features/ledger/ui/LedgerReportCharts.tsx frontend/src/features/ledger/ui/LedgerReports.tsx frontend/src/features/ledger/ui/LedgerPanel.tsx frontend/src/features/workbench/ui/MainPanel.tsx frontend/src/styles/globals.css frontend/tests/presentation/ledger-panel.spec.tsx frontend/tests/presentation/workbench-wireframe.spec.tsx frontend/tests/architecture/design-boundaries.spec.ts
git commit -m "[ADD] Build Ledger report analysis UI"
```

---

### Task 4: Verify final behavior and synchronize documentation

**Files:**
- Modify only if verification reveals a factual gap: `docs/operations/api-reference.md`
- Modify only if user-facing operation guidance changed: `docs/operations/verification-and-smoke.md`

**Interfaces:**
- Consumes: completed Tasks 1-3.
- Produces: verified SHI-73 implementation with documentation matching the final API/UI behavior.

- [ ] **Step 1: Run the complete frontend suite**

Run:

```bash
npm --prefix frontend test
npm --prefix frontend run typecheck
npm --prefix frontend run build
```

Expected: 0 failures.

- [ ] **Step 2: Run workspace regression checks**

Run:

```bash
cargo fmt --check
cargo test --workspace
cargo clippy --all-targets --all-features -- -D warnings
```

Expected: 0 failures and 0 warnings.

- [ ] **Step 3: Check documentation against the shipped behavior**

Verify the API reference still states preset comparison mapping, ordinal report dates, automatic granularity, per-currency separation, and the 366-bucket cap. Do not edit docs when they are already accurate. If a factual gap exists, write only that final-state correction and run the documentation structure checks required by the repository skills.

- [ ] **Step 4: Commit only material documentation corrections**

If and only if Step 3 changed documentation:

```bash
git add docs/operations/api-reference.md docs/operations/verification-and-smoke.md
git commit -m "[DOCS] Document Ledger report analysis"
```

- [ ] **Step 5: Request whole-branch review**

Review the complete diff from the plan base for specification compliance, race safety, boundary validation, accessibility, filter correctness, and regression risk. Resolve findings through the subagent-driven review loop before offering merge options.
