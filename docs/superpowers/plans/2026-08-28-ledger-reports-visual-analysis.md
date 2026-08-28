# Ledger Reports Visual Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the table-led Ledger Reports view with a balanced graph-first page for current assets, liabilities, income and spending patterns, average daily spending, and category composition.

**Architecture:** Keep the existing Ledger controller and report endpoints. Build one currency-specific presentation model from current balances, the current comparison range, category breakdown, and trend data; render that model with reusable CSS-based donuts and an accessible grouped bar chart, then route chart selections through the existing transaction table settings.

**Tech Stack:** TypeScript, React 18, Next.js 14, CSS, Vitest, Testing Library

---

## File Map

- Modify `frontend/src/features/ledger/model/ledger-reports.ts`: own report calculations, composition slices, trend display values, and drilldown filter construction.
- Modify `frontend/tests/domain/ledger-reports.spec.ts`: verify calculations, currency isolation, category aggregation, and every drilldown shape.
- Modify `frontend/src/features/ledger/hooks/useLedgerController.ts`: stop loading unused account activity breakdown data.
- Modify `frontend/tests/presentation/ledger-panel.spec.tsx`: update report fixtures and verify controller requests, rendering, interaction, loading, error, and empty states.
- Modify `frontend/src/features/ledger/ui/LedgerReports.tsx`: pass current balances into the presentation model and compose the approved balanced layout.
- Modify `frontend/src/features/ledger/ui/LedgerReportCharts.tsx`: replace report tables and the line chart with summary metrics, reusable composition donuts, and an accessible grouped bar chart.
- Modify `frontend/src/styles/globals.css`: style the six-card summary, paired donuts, grouped bars, focus states, and narrow layout.

No backend, schema, dependency, or Dashboard file changes are needed.

### Task 1: Build the currency-specific report presentation model

**Files:**
- Modify: `frontend/src/features/ledger/model/ledger-reports.ts`
- Test: `frontend/tests/domain/ledger-reports.spec.ts`

- [ ] **Step 1: Replace the old model expectations with failing calculation tests**

Add `AccountBalance` to the model imports, replace the account breakdown fixture with current balances, and cover totals, inclusive daily averaging, bucket pacing, category aggregation, and currency isolation:

```ts
const balances: AccountBalance[] = [
  balance("asset-cash", "Cash", "currency-usd", 12_000),
  balance("asset-savings", "Savings", "currency-usd", 8_000),
  balance("debt-card", "Card", "currency-usd", -5_000),
  balance("asset-eur", "EUR cash", "currency-eur", 99_000),
];

it("derives current assets, liabilities, net assets, and inclusive daily spending", () => {
  const model = buildLedgerReportModel(
    comparison, categories, balances, trend, "currency-usd",
  );

  expect(model.metrics).toEqual({
    totalAssetsMinor: 20_000,
    totalLiabilitiesMinor: 5_000,
    netAssetsMinor: 15_000,
    incomeMinor: 1_000,
    expenseMinor: 400,
    averageDailyExpenseMinor: 13,
  });
  expect(model.assets.map(({ label, valueMinor, percentage }) =>
    [label, valueMinor, percentage])).toEqual([
      ["Cash", 12_000, 60],
      ["Savings", 8_000, 40],
    ]);
  expect(model.liabilities).toMatchObject([
    { id: "debt-card", label: "Card", valueMinor: 5_000, percentage: 100 },
  ]);
  expect(model.trend.points[0]).toMatchObject({ averageExpensePaceMinor: 13 });
});

it("keeps seven categories and combines the rest into Other", () => {
  const rows = Array.from({ length: 9 }, (_, index) =>
    breakdown(`category-${index}`, `Category ${index}`, 0, 900 - index * 100, 0));
  const model = buildLedgerReportModel(
    comparison, rows, balances, trend, "currency-usd",
  );

  expect(model.categories).toHaveLength(8);
  expect(model.categories.at(-1)).toMatchObject({
    id: null,
    label: "Other",
    valueMinor: 300,
    interactive: false,
  });
});

it("keeps a balance-only currency visible with zero period activity", () => {
  expect(reportCurrencyOptions(comparison, balances)).toContainEqual({
    id: "currency-eur",
    code: "EUR",
  });
  const model = buildLedgerReportModel(
    comparison, categories, balances, trend, "currency-eur",
  );
  expect(model.metrics.incomeMinor).toBe(0);
  expect(model.metrics.expenseMinor).toBe(0);
  expect(model.metrics.totalAssetsMinor).toBe(99_000);
});

function balance(
  id: string,
  name: string,
  currencyId: string,
  currentBalanceMinor: number,
): AccountBalance {
  return {
    account: {
      id,
      name,
      categoryId: "account-category-cash",
      currencyId,
      openingBalanceMinor: 0,
      active: true,
    },
    currencyCode: currencyId === "currency-usd" ? "USD" : "EUR",
    decimalPlaces: 2,
    currentBalanceMinor,
  };
}
```

- [ ] **Step 2: Run the domain test to verify it fails**

Run:

```powershell
npm --prefix frontend test -- tests/domain/ledger-reports.spec.ts
```

Expected: FAIL because the old builder accepts account breakdown rows and does not expose the new metrics or composition slices.

- [ ] **Step 3: Implement the minimal presentation model**

Replace the old card tuple and account breakdown fields with explicit presentation types, keeping all calculations in `ledger-reports.ts`:

```ts
export type CompositionSlice = {
  id: string | null;
  label: string;
  valueMinor: number;
  percentage: number;
  interactive: boolean;
};

export type LedgerReportModel = {
  currencyId: string;
  currencyCode: string;
  decimalPlaces: number;
  range: ReportRange | null;
  metrics: {
    totalAssetsMinor: number;
    totalLiabilitiesMinor: number;
    netAssetsMinor: number;
    incomeMinor: number;
    expenseMinor: number;
    averageDailyExpenseMinor: number;
  };
  assets: CompositionSlice[];
  liabilities: CompositionSlice[];
  categories: CompositionSlice[];
  trend: {
    granularity: LedgerTrend["granularity"];
    points: Array<LedgerTrend["currencies"][number]["points"][number] & {
      averageExpensePaceMinor: number;
    }>;
  };
};

export function buildLedgerReportModel(
  comparison: LedgerComparison,
  categories: BreakdownRow[],
  balances: AccountBalance[],
  trend: LedgerTrend,
  currencyId: string,
): LedgerReportModel {
  const selected = comparison.currencies.find((row) => row.currencyId === currencyId);
  const balanceMetadata = balances.find((row) => row.account.currencyId === currencyId);
  if (!selected && !balanceMetadata) return emptyReportModel(currencyId, trend.granularity);
  const range = comparison.current.range;
  const selectedBalances = balances.filter(
    (row) => row.account.currencyId === currencyId,
  );
  const assets = composition(selectedBalances
    .filter((row) => row.currentBalanceMinor > 0)
    .map((row) => ({ id: row.account.id, label: row.account.name,
      valueMinor: row.currentBalanceMinor, interactive: true })));
  const liabilities = composition(selectedBalances
    .filter((row) => row.currentBalanceMinor < 0)
    .map((row) => ({ id: row.account.id, label: row.account.name,
      valueMinor: Math.abs(row.currentBalanceMinor), interactive: true })));
  const totalAssetsMinor = sumSlices(assets);
  const totalLiabilitiesMinor = sumSlices(liabilities);
  const current = selected?.current ?? {
    incomeMinor: 0,
    expenseMinor: 0,
    netChangeMinor: 0,
    entryCount: 0,
  };
  const averageDailyExpenseMinor = Math.round(
    current.expenseMinor / inclusiveDays(range.start, range.end),
  );
  const selectedTrend = trend.currencies.find((row) => row.currencyId === currencyId);
  return {
    currencyId,
    currencyCode: selected?.currencyCode ?? balanceMetadata!.currencyCode,
    decimalPlaces: selected?.current.decimalPlaces ?? balanceMetadata!.decimalPlaces,
    range,
    metrics: {
      totalAssetsMinor,
      totalLiabilitiesMinor,
      netAssetsMinor: totalAssetsMinor - totalLiabilitiesMinor,
      incomeMinor: current.incomeMinor,
      expenseMinor: current.expenseMinor,
      averageDailyExpenseMinor,
    },
    assets,
    liabilities,
    categories: categorySlices(categories, currencyId),
    trend: {
      granularity: trend.granularity,
      points: (selectedTrend?.points ?? []).map((point) => ({
        ...point,
        averageExpensePaceMinor:
          averageDailyExpenseMinor * inclusiveDays(point.start, point.end),
      })),
    },
  };
}
```

Export the currency option union used by the UI:

```ts
export function reportCurrencyOptions(
  comparison: LedgerComparison | null,
  balances: AccountBalance[],
): Array<{ id: string; code: string }> {
  const options = new Map<string, string>();
  for (const row of comparison?.currencies ?? []) {
    options.set(row.currencyId, row.currencyCode);
  }
  for (const row of balances) {
    if (!options.has(row.account.currencyId)) {
      options.set(row.account.currencyId, row.currencyCode);
    }
  }
  return [...options].map(([id, code]) => ({ id, code }));
}
```

Implement `composition`, `sumSlices`, `categorySlices`, and `inclusiveDays` directly below the builder. `inclusiveDays` must parse `YYYY-MM-DD` at UTC midnight; `categorySlices` must sort positive expenses descending, retain seven, and append a non-interactive `Other` slice only when rows remain.

Use these implementations:

```ts
type RawSlice = Omit<CompositionSlice, "percentage">;

function composition(rows: RawSlice[]): CompositionSlice[] {
  const sorted = [...rows].sort((left, right) =>
    right.valueMinor - left.valueMinor || left.label.localeCompare(right.label));
  const total = sorted.reduce((sum, row) => sum + row.valueMinor, 0);
  return sorted.map((row) => ({
    ...row,
    percentage: total === 0 ? 0 : Math.round(row.valueMinor / total * 100),
  }));
}

function sumSlices(rows: CompositionSlice[]): number {
  return rows.reduce((sum, row) => sum + row.valueMinor, 0);
}

function categorySlices(rows: BreakdownRow[], currencyId: string): CompositionSlice[] {
  const sorted = rows
    .filter((row) => row.currencyId === currencyId && row.expenseMinor > 0)
    .sort((left, right) =>
      right.expenseMinor - left.expenseMinor || left.name.localeCompare(right.name));
  const visible: RawSlice[] = sorted.slice(0, 7).map((row) => ({
    id: row.referenceId,
    label: row.name,
    valueMinor: row.expenseMinor,
    interactive: row.referenceId !== null,
  }));
  const otherMinor = sorted.slice(7)
    .reduce((sum, row) => sum + row.expenseMinor, 0);
  if (otherMinor > 0) visible.push({
    id: null,
    label: "Other",
    valueMinor: otherMinor,
    interactive: false,
  });
  return composition(visible);
}

function inclusiveDays(start: string, end: string): number {
  const millisecondsPerDay = 86_400_000;
  return Math.floor(
    (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`))
      / millisecondsPerDay,
  ) + 1;
}
```

Update `emptyReportModel` with the same field names:

```ts
function emptyReportModel(
  currencyId: string,
  granularity: LedgerTrend["granularity"],
): LedgerReportModel {
  return {
    currencyId,
    currencyCode: "",
    decimalPlaces: 0,
    range: null,
    metrics: {
      totalAssetsMinor: 0,
      totalLiabilitiesMinor: 0,
      netAssetsMinor: 0,
      incomeMinor: 0,
      expenseMinor: 0,
      averageDailyExpenseMinor: 0,
    },
    assets: [],
    liabilities: [],
    categories: [],
    trend: { granularity, points: [] },
  };
}
```

- [ ] **Step 4: Expand drilldowns and verify their exact filter rules**

Use a discriminated union so account drilldowns omit the date while category and trend drilldowns remain period-bound:

```ts
export type ReportDrilldownTarget =
  | { kind: "account"; currencyId: string; referenceId: string }
  | { kind: "category"; range: ReportRange; currencyId: string; referenceId: string }
  | {
      kind: "trend";
      range: ReportRange;
      currencyId: string;
      entryType: "income" | "expense";
    };
```

Update `applyReportDrilldown` and assert these fields:

```ts
expect(account.filterRules.map(({ field }) => field))
  .toEqual(["currency", "account"]);
expect(category.filterRules.map(({ field }) => field))
  .toEqual(["date", "currency", "category"]);
expect(incomeBucket.filterRules.map(({ field }) => field))
  .toEqual(["date", "currency", "entry_type"]);
expect(incomeBucket.filterRules.at(-1)).toMatchObject({
  type: "select",
  operator: "is",
  value: ["income"],
});
```

Implement the rule construction without mutating the caller's settings:

```ts
export function applyReportDrilldown(
  settings: PlannerTableSettings,
  target: ReportDrilldownTarget,
): PlannerTableSettings {
  const next = clonePlannerTableSettings(settings);
  const rules: PlannerTableSettings["filterRules"] = [{
    id: "ledger-report-currency",
    field: "currency",
    type: "relation",
    operator: "is",
    value: [target.currencyId],
  }];
  if (target.kind === "account") {
    rules.push({
      id: "ledger-report-account",
      field: "account",
      type: "relation",
      operator: "is",
      value: [target.referenceId],
    });
  } else {
    rules.unshift({
      id: "ledger-report-date",
      field: "date",
      type: "date",
      operator: "is_between",
      value: target.range,
    });
    rules.push(target.kind === "category" ? {
      id: "ledger-report-category",
      field: "category",
      type: "relation",
      operator: "is",
      value: [target.referenceId],
    } : {
      id: "ledger-report-entry-type",
      field: "entry_type",
      type: "select",
      operator: "is",
      value: [target.entryType],
    });
  }
  return { ...next, filterMode: "and", filterRules: rules };
}
```

- [ ] **Step 5: Run the domain test and type checker**

Run:

```powershell
npm --prefix frontend test -- tests/domain/ledger-reports.spec.ts
npm --prefix frontend run typecheck
```

Expected: both commands PASS.

- [ ] **Step 6: Commit the model change**

```powershell
git add frontend/src/features/ledger/model/ledger-reports.ts frontend/tests/domain/ledger-reports.spec.ts
git commit -m @'
[UPDATE] Build Ledger report analysis model

- 현재 계좌 잔액에서 자산·부채·순자산 구성을 계산
- 기간별 일평균 소비와 카테고리 기타 묶음을 추가
- 그래프별 거래 드릴다운 필터를 구분
'@
```

### Task 2: Remove the unused account report request

**Files:**
- Modify: `frontend/src/features/ledger/hooks/useLedgerController.ts`
- Test: `frontend/tests/presentation/ledger-panel.spec.tsx`

- [ ] **Step 1: Change the controller request test to fail on account report loading**

Update `loads report analysis from the comparison's canonical current range`:

```ts
const accounts = vi.spyOn(ledgerApi, "accountReport").mockResolvedValue([]);
const categories = vi.spyOn(ledgerApi, "categoryReport").mockResolvedValue([]);
const reportTrend = vi.spyOn(ledgerApi, "trend").mockResolvedValue(
  trend("2026-08-01", "2026-08-31"),
);

await act(async () => {
  await result.current.runReports({ period: "current_month" });
});

expect(accounts).not.toHaveBeenCalled();
expect(categories).toHaveBeenCalledWith({ from: "2026-08-01", to: "2026-08-31" });
expect(reportTrend).toHaveBeenCalledWith({ from: "2026-08-01", to: "2026-08-31" });
```

- [ ] **Step 2: Run the focused controller test to verify it fails**

Run:

```powershell
npm --prefix frontend test -- tests/presentation/ledger-panel.spec.tsx -t "loads report analysis from the comparison's canonical current range"
```

Expected: FAIL because `accountReport` is called once.

- [ ] **Step 3: Remove account breakdown state and the request**

In `LedgerState`, `initialState`, and successful report updates, remove `accountBreakdown`. In `runReports`, request only categories and trend after the comparison establishes the canonical range:

```ts
const [categoryBreakdown, trend] = await Promise.all([
  ledgerApi.categoryReport(range),
  ledgerApi.trend(range),
]);
if (generation !== reportGeneration.current) return;
setState((current) => ({
  ...current,
  reportStatus: "loaded",
  reportError: null,
  comparison,
  trend,
  summary: comparison.current,
  categoryBreakdown,
}));
```

Remove `accountBreakdown` from presentation fixtures. Keep `ledgerApi.accountReport` because it remains a valid client for the public report endpoint; this change only stops loading unused page data.

- [ ] **Step 4: Run controller and race/failure tests**

Run:

```powershell
npm --prefix frontend test -- tests/presentation/ledger-panel.spec.tsx -t "report analysis|newer report result|retains report data"
```

Expected: PASS, including the existing stale-request and retained-data guarantees.

- [ ] **Step 5: Commit the request cleanup**

```powershell
git add frontend/src/features/ledger/hooks/useLedgerController.ts frontend/tests/presentation/ledger-panel.spec.tsx
git commit -m @'
[REFACTOR] Stop loading unused Ledger account report

- 현재 잔액 기반 자산 그래프로 대체되는 계좌 활동 요청을 제거
- 기간 전환 경쟁 상태와 실패 시 기존 데이터 보존 동작을 유지
'@
```

### Task 3: Replace report tables with the approved graph-first UI

**Files:**
- Modify: `frontend/src/features/ledger/ui/LedgerReports.tsx`
- Modify: `frontend/src/features/ledger/ui/LedgerReportCharts.tsx`
- Test: `frontend/tests/presentation/ledger-panel.spec.tsx`

- [ ] **Step 1: Replace old table assertions with failing graph and interaction tests**

Seed `reportAnalysisState().balances` with two positive KRW balances, one negative KRW balance, and one USD balance. Add these focused tests:

```tsx
it("renders the balanced six-metric summary and separate asset and liability donuts", () => {
  render(<LedgerPanel leafTabId="reports" controller={controller(reportAnalysisState())} />);

  const summary = screen.getByRole("region", { name: "Summary" });
  for (const label of [
    "Total assets", "Total liabilities", "Net assets",
    "Income", "Spending", "Average daily spending",
  ]) expect(within(summary).getByRole("group", { name: label })).toBeInTheDocument();
  expect(screen.getByRole("img", { name: /Asset composition/ })).toBeInTheDocument();
  expect(screen.getByRole("img", { name: /Liability composition/ })).toBeInTheDocument();
});

it("drills from an account, a trend bar, and an expense category", async () => {
  const user = userEvent.setup();
  const onReportDrilldown = vi.fn();
  render(<LedgerPanel leafTabId="reports"
    controller={controller(reportAnalysisState())}
    onReportDrilldown={onReportDrilldown} />);

  await user.click(screen.getByRole("button", { name: /Cash.*asset/ }));
  await user.click(screen.getByRole("button", { name: /2026-08-01.*Expense/ }));
  await user.click(screen.getByRole("button", { name: /Food.*expense category/ }));

  expect(onReportDrilldown).toHaveBeenNthCalledWith(1, {
    kind: "account", currencyId: "currency-krw", referenceId: "account-cash",
  });
  expect(onReportDrilldown).toHaveBeenNthCalledWith(2, {
    kind: "trend", currencyId: "currency-krw", entryType: "expense",
    range: { start: "2026-08-01", end: "2026-08-01" },
  });
  expect(onReportDrilldown).toHaveBeenNthCalledWith(3, {
    kind: "category", currencyId: "currency-krw", referenceId: "category-food",
    range: { start: "2026-08-01", end: "2026-08-31" },
  });
});
```

Also replace the old table-empty test with section-specific empty messages for Assets, Liabilities, Spending by category, and Income and spending pattern.

- [ ] **Step 2: Run the presentation tests to verify they fail**

Run:

```powershell
npm --prefix frontend test -- tests/presentation/ledger-panel.spec.tsx -t "balanced six-metric|drills from|section-specific messages"
```

Expected: FAIL because the old page still renders four comparison cards, two tables, and a polyline chart.

- [ ] **Step 3: Wire balances into the report model and approved section order**

In `LedgerReports.tsx`, change the model call and loaded composition:

```tsx
const reportCurrencies = reportCurrencyOptions(state.comparison, state.balances);
const model = state.comparison && state.trend
  ? buildLedgerReportModel(
      state.comparison,
      state.categoryBreakdown,
      state.balances,
      state.trend,
      currencyId,
    )
  : null;

{model ? (
  <>
    <ReportSummaryCards model={model} currency={currency} />
    <AccountBalanceDonuts model={model} currency={currency} onDrilldown={onDrilldown} />
    <IncomeExpenseTrendChart model={model} currency={currency} onDrilldown={onDrilldown} />
    <ExpenseCategoryDonut model={model} currency={currency} onDrilldown={onDrilldown} />
  </>
) : state.reportStatus === "idle" ? (
  <p className="items-message">Choose a report period to view analysis.</p>
) : state.reportStatus === "loading" ? (
  <p role="status" className="items-message">Loading reports...</p>
) : null}
```

- [ ] **Step 4: Implement reusable donuts and the six summary metrics**

In `LedgerReportCharts.tsx`, keep period and currency controls, delete `AccountReportSection`, and replace the old category section with one internal `CompositionDonut` used by Assets, Liabilities, and Spending by category:

```tsx
function CompositionDonut({
  title, totalLabel, slices, emptyMessage, ariaLabel, formatValue, onSelect,
}: {
  title: string;
  totalLabel: string;
  slices: CompositionSlice[];
  emptyMessage: string;
  ariaLabel: string;
  formatValue: (valueMinor: number) => string;
  onSelect?: (slice: CompositionSlice) => void;
}) {
  if (slices.length === 0) {
    return <section className="ledger-report-composition"><h3>{title}</h3>
      <p className="items-message">{emptyMessage}</p></section>;
  }
  return (
    <section className="ledger-report-composition">
      <h3>{title}</h3>
      <div className="ledger-report-donut-panel">
        <div className="ledger-report-donut" role="img" aria-label={ariaLabel}
          style={{ "--ledger-report-donut": categoryGradient(
            slices.map(({ valueMinor }) => valueMinor),
          ) } as React.CSSProperties}>
          <strong>{totalLabel}</strong>
        </div>
        <div className="ledger-report-donut-legend">
          {slices.map((slice) => {
            const content = <><span>{slice.label} · {slice.percentage}%</span>
              <span>{formatValue(slice.valueMinor)}</span></>;
            return slice.interactive && onSelect
              ? <button key={slice.id} type="button"
                  aria-label={`${slice.label}, ${slice.percentage}%`}
                  onClick={() => onSelect(slice)}>{content}</button>
              : <div key={slice.id ?? "other"}>{content}</div>;
          })}
        </div>
      </div>
    </section>
  );
}
```

Pass `formatValue={(value) => reportMoney(value, currency, model.currencyCode)}` from each wrapper. For account slices, call:

```tsx
onSelect={(slice) => {
  if (slice.id) onDrilldown?.({
    kind: "account",
    currencyId: model.currencyId,
    referenceId: slice.id,
  });
}}
```

For category slices, call:

```tsx
onSelect={(slice) => {
  if (slice.id && model.range) onDrilldown?.({
    kind: "category",
    range: model.range,
    currencyId: model.currencyId,
    referenceId: slice.id,
  });
}}
```

Render summary cards from a fixed label/value array with no previous-period text:

```tsx
export function ReportSummaryCards({ model, currency }: {
  model: LedgerReportModel;
  currency: Pick<Currency, "code" | "decimalPlaces"> | undefined;
}) {
  const cards = [
    ["Total assets", model.metrics.totalAssetsMinor, "Current balance"],
    ["Total liabilities", model.metrics.totalLiabilitiesMinor, "Current balance"],
    ["Net assets", model.metrics.netAssetsMinor, "Current balance"],
    ["Income", model.metrics.incomeMinor, "Selected period"],
    ["Spending", model.metrics.expenseMinor, "Selected period"],
    ["Average daily spending", model.metrics.averageDailyExpenseMinor,
      "Selected period calendar days"],
  ] as const;
  return (
    <section className="ledger-report-section" aria-label="Summary">
      <h2>Summary</h2>
      <div className="ledger-report-summary">
        {cards.map(([label, value, context]) => (
          <div key={label} className="ledger-report-card" role="group" aria-label={label}>
            <span>{label}</span>
            <strong>{reportMoney(value, currency, model.currencyCode)}</strong>
            <small>{context}</small>
          </div>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Implement the grouped income/spending chart**

Replace the SVG polylines with HTML buttons so every bar is natively keyboard accessible. Scale income, spending, and the per-bucket average pace against one maximum:

```tsx
const maximum = Math.max(1, ...model.trend.points.flatMap((point) => [
  point.incomeMinor, point.expenseMinor, point.averageExpensePaceMinor,
]));
const height = (value: number) => `${value / maximum * 100}%`;

<div className="ledger-report-bars" role="img" aria-label="Income and spending pattern">
  {model.trend.points.map((point) => (
    <div className="ledger-report-bar-group" key={`${point.start}-${point.end}`}>
      <div className="ledger-report-bar-plot">
        <button type="button" className="ledger-report-bar-income"
          style={{ height: height(point.incomeMinor) }}
          aria-label={`${point.start} Income ${reportMoney(point.incomeMinor, currency, model.currencyCode)}`}
          onClick={() => onDrilldown?.(trendDrilldown(model, point, "income"))} />
        <button type="button" className="ledger-report-bar-expense"
          style={{ height: height(point.expenseMinor) }}
          aria-label={`${point.start} Expense ${reportMoney(point.expenseMinor, currency, model.currencyCode)}`}
          onClick={() => onDrilldown?.(trendDrilldown(model, point, "expense"))} />
        <span className="ledger-report-average-marker"
          style={{ bottom: height(point.averageExpensePaceMinor) }}
          aria-hidden="true" />
      </div>
      <span>{point.start}</span>
    </div>
  ))}
</div>
```

Define the drilldown helper next to the chart:

```ts
function trendDrilldown(
  model: LedgerReportModel,
  point: LedgerReportModel["trend"]["points"][number],
  entryType: "income" | "expense",
): ReportDrilldownTarget {
  return {
    kind: "trend",
    range: { start: point.start, end: point.end },
    currencyId: model.currencyId,
    entryType,
  };
}
```

Keep a visible legend for Income, Spending, and Average daily pace. Add an `sr-only` list containing both series and the average pace for every bucket.

- [ ] **Step 6: Run the full Ledger presentation test file**

Run:

```powershell
npm --prefix frontend test -- tests/presentation/ledger-panel.spec.tsx
```

Expected: PASS with no account/category report tables or previous-period text remaining.

- [ ] **Step 7: Commit the graph-first UI**

```powershell
git add frontend/src/features/ledger/ui/LedgerReports.tsx frontend/src/features/ledger/ui/LedgerReportCharts.tsx frontend/tests/presentation/ledger-panel.spec.tsx
git commit -m @'
[UPDATE] Rebuild Ledger Reports around visual analysis

- 자산과 부채를 분리한 계좌 구성 원그래프를 추가
- 수입·소비 패턴을 거래 이동이 가능한 막대그래프로 교체
- 소비 카테고리 표를 총액과 비율 중심 원그래프로 단순화
'@
```

### Task 4: Apply the balanced responsive layout and complete verification

**Files:**
- Modify: `frontend/src/styles/globals.css`
- Test: `frontend/tests/presentation/ledger-panel.spec.tsx`

- [ ] **Step 1: Add a failing CSS contract test**

Add a report-specific test next to the existing stylesheet contract test:

```ts
it("uses the balanced Ledger report grid and stacks it at the narrow breakpoint", async () => {
  const css = await fs.readFile(
    path.join(process.cwd(), "src/styles/globals.css"), "utf8",
  );
  expect(css).toMatch(/\.ledger-report-balance-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,/s);
  const narrow = css.slice(css.indexOf("@media (max-width: 760px)"));
  expect(narrow).toMatch(/\.ledger-report-balance-grid\s*\{[^}]*grid-template-columns:\s*1fr/s);
  expect(css).toContain(".ledger-report-bars");
  expect(css).toContain(".ledger-report-bar-income:focus-visible");
});
```

- [ ] **Step 2: Run the CSS contract test to verify it fails**

Run:

```powershell
npm --prefix frontend test -- tests/presentation/ledger-panel.spec.tsx -t "balanced Ledger report grid"
```

Expected: FAIL because the new selectors do not exist.

- [ ] **Step 3: Replace table and polyline styles with the balanced layout**

In `globals.css`:

```css
.ledger-report-summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.ledger-report-balance-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.ledger-report-bars {
  display: flex;
  min-height: 260px;
  gap: 12px;
  overflow-x: auto;
  border-bottom: 1px solid var(--color-hairline-light);
  padding: 16px 8px 0;
}

.ledger-report-bar-group {
  display: grid;
  min-width: 52px;
  flex: 1 0 52px;
  grid-template-rows: minmax(180px, 1fr) auto;
  gap: 8px;
  color: var(--color-text-muted);
  font-size: 11px;
  text-align: center;
}

.ledger-report-bar-plot {
  position: relative;
  display: flex;
  align-items: end;
  justify-content: center;
  gap: 4px;
}

.ledger-report-bar-income,
.ledger-report-bar-expense {
  width: min(18px, 42%);
  min-height: 2px;
  border: 0;
  border-radius: var(--radius-xs) var(--radius-xs) 0 0;
  padding: 0;
}

.ledger-report-bar-income { background: var(--color-chart-primary); }
.ledger-report-bar-expense { background: var(--color-chart-secondary); }

.ledger-report-average-marker {
  position: absolute;
  right: 0;
  left: 0;
  border-top: 2px dashed var(--color-chart-warning);
}

.ledger-report-bar-income:focus-visible,
.ledger-report-bar-expense:focus-visible {
  outline: 3px solid var(--color-ink);
  outline-offset: 3px;
}

@media (max-width: 760px) {
  .ledger-report-summary,
  .ledger-report-balance-grid {
    grid-template-columns: 1fr;
  }
}
```

Delete obsolete `.ledger-report-category-layout`, `.ledger-report-table`, polyline, and account table rules. Preserve period controls, currency controls, donut sizing, error layout, and reduced-motion conventions.

- [ ] **Step 4: Run focused and complete frontend verification**

Run:

```powershell
npm --prefix frontend test -- tests/domain/ledger-reports.spec.ts tests/presentation/ledger-panel.spec.tsx
npm --prefix frontend run typecheck
npm --prefix frontend test
npm --prefix frontend run build
```

Expected: all commands PASS. The static build completes without adding dependencies.

- [ ] **Step 5: Inspect the final diff for accidental scope growth**

Run:

```powershell
git status --short
git diff --stat
git diff
```

Expected: only the seven frontend files in the File Map are changed; no backend, schema, lockfile, Dashboard, or generated `frontend/out` changes are present.

- [ ] **Step 6: Commit the responsive visual contract**

```powershell
git add frontend/src/styles/globals.css frontend/tests/presentation/ledger-panel.spec.tsx
git commit -m @'
[UPDATE] Style balanced Ledger report charts

- 요약 지표와 자산·부채 그래프를 균형형 그리드로 배치
- 좁은 화면 적층과 그래프 가로 스크롤을 보장
- 키보드 초점과 색상 외 텍스트 범례를 유지
'@
```

- [ ] **Step 7: Verify the completed commit series**

Run:

```powershell
git status --short
git log --oneline -n 6
```

Expected: the worktree is clean and the four implementation commits appear above the approved design and plan documentation commits.
