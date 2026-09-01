# Dashboard Ledger Highlights Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the approved Ledger highlights surface below ToDo analytics, with shared month/currency controls, a Cash Flow donut, and the existing category and trend charts.

**Architecture:** Extract the existing Ledger Report request sequence into one shared frontend loader. Keep Dashboard loading and selection state local, build the existing `LedgerReportModel`, and render the existing Report charts. Pass only a small navigation intent through `MainPanel`; Ledger workspace controllers remain responsible for transaction filters. Add no backend route, schema, dependency, persisted preference, or Dashboard-only duplicate aggregate.

**Tech Stack:** React 18, TypeScript, Next.js 14 static export, existing Ledger API/model/chart primitives, CSS Grid, Vitest, Testing Library

---

## File Structure

- Create `frontend/src/features/ledger/api/ledger-report-loader.ts`: shared comparison/category/trend/balance request orchestration.
- Create `frontend/src/features/dashboard/ui/DashboardLedgerHighlights.tsx`: Dashboard state, Cash Flow presentation, and reused Report charts.
- Delete `frontend/src/features/dashboard/ui/LedgerSummaryCard.tsx`: unused superseded prototype.
- Modify `frontend/src/features/ledger/hooks/useLedgerController.ts`: consume the shared loader while retaining request-generation guards.
- Modify `frontend/src/features/ledger/ui/LedgerReports.tsx`: accept a one-time Dashboard period/currency intent.
- Modify `frontend/src/features/ledger/ui/LedgerPanel.tsx`: forward the optional Report intent.
- Modify `frontend/src/features/dashboard/ui/DashboardPanel.tsx`: place Ledger highlights after all ToDo analytics.
- Modify `frontend/src/features/workbench/ui/MainPanel.tsx`: retain and deliver Dashboard Ledger navigation intent.
- Modify `frontend/src/styles/globals.css`: shared surface, `1:1:2` desktop grid, stacked narrow layout, Cash Flow donut, loading/error states.
- Create `frontend/tests/presentation/dashboard-ledger-highlights.spec.tsx`: focused Ledger highlight behavior.
- Modify `frontend/tests/presentation/ledger-panel.spec.tsx`: shared loader and initial Report intent coverage.
- Modify `frontend/tests/presentation/dashboard-panel.spec.tsx`: Dashboard composition and ToDo/Ledger failure isolation.
- Modify `frontend/tests/presentation/workbench-wireframe.spec.tsx`: Report and transaction navigation intent coverage.
- Modify `frontend/tests/architecture/design-boundaries.spec.ts`: responsive layout and dependency-free chart contract.

### Task 1: Share the existing Ledger Report loader

**Files:**
- Create: `frontend/src/features/ledger/api/ledger-report-loader.ts`
- Modify: `frontend/src/features/ledger/hooks/useLedgerController.ts:568-606,814-827`
- Test: `frontend/tests/presentation/ledger-panel.spec.tsx:3430-3565`

- [ ] **Step 1: Add a failing loader test**

In `ledger-panel.spec.tsx`, import `loadLedgerReport`, mock the existing four API methods, and add:

```tsx
it("loads one canonical Ledger report bundle including every balance page", async () => {
  vi.mocked(ledgerApi.compare).mockResolvedValue(reportComparison());
  vi.mocked(ledgerApi.categoryReport).mockResolvedValue(reportCategories());
  vi.mocked(ledgerApi.trend).mockResolvedValue(reportTrend());
  vi.mocked(ledgerApi.listAccountBalances)
    .mockResolvedValueOnce({ items: [balance("account-1")], nextOffset: 200 })
    .mockResolvedValueOnce({ items: [balance("account-2")], nextOffset: null });

  const result = await loadLedgerReport({ period: "current_month" });

  expect(ledgerApi.categoryReport).toHaveBeenCalledWith({
    from: result.comparison.current.range.start,
    to: result.comparison.current.range.end,
  });
  expect(ledgerApi.trend).toHaveBeenCalledWith({
    from: result.comparison.current.range.start,
    to: result.comparison.current.range.end,
  });
  expect(ledgerApi.listAccountBalances).toHaveBeenNthCalledWith(1, {
    limit: 200,
    offset: undefined,
  });
  expect(ledgerApi.listAccountBalances).toHaveBeenNthCalledWith(2, {
    limit: 200,
    offset: 200,
  });
  expect(result.balances).toHaveLength(2);
});
```

Use the file's existing report fixtures; add only the smallest fixture helpers needed for the two balance rows.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npm --prefix frontend test -- ledger-panel.spec.tsx
```

Expected: FAIL because `ledger-report-loader.ts` and `loadLedgerReport` do not exist.

- [ ] **Step 3: Extract the current orchestration without changing its behavior**

Create `ledger-report-loader.ts`:

```ts
import {
  ledgerApi,
  type Page,
  type ReportSelection,
} from "@/features/ledger/api/ledger-api";
import type {
  AccountBalance,
  BreakdownRow,
  LedgerComparison,
  LedgerTrend,
} from "@/features/ledger/model/ledger-model";

export type LedgerReportData = {
  comparison: LedgerComparison;
  categoryBreakdown: BreakdownRow[];
  trend: LedgerTrend;
  balances: AccountBalance[];
};

export async function loadLedgerReport(
  selection: ReportSelection,
): Promise<LedgerReportData> {
  const comparison = await ledgerApi.compare(selection);
  const range = {
    from: comparison.current.range.start,
    to: comparison.current.range.end,
  };
  const [categoryBreakdown, trend, balances] = await Promise.all([
    ledgerApi.categoryReport(range),
    ledgerApi.trend(range),
    drainPages((offset) => ledgerApi.listAccountBalances({ limit: 200, offset })),
  ]);
  return { comparison, categoryBreakdown, trend, balances };
}

async function drainPages<T>(
  load: (offset?: number) => Promise<Page<T>>,
): Promise<T[]> {
  const items: T[] = [];
  let offset: number | undefined;
  do {
    const page = await load(offset);
    items.push(...page.items);
    offset = page.nextOffset ?? undefined;
  } while (offset !== undefined);
  return items;
}
```

In `useLedgerController.runReports`, replace the inline requests with:

```ts
const { comparison, categoryBreakdown, trend, balances } =
  await loadLedgerReport(selection);
```

Keep the existing `reportGeneration` check, state transition, safe error conversion, and rethrow exactly where they are. Remove only the now-unused private `drainPages` function and imports.

- [ ] **Step 4: Run controller tests and verify GREEN**

Run:

```powershell
npm --prefix frontend test -- ledger-panel.spec.tsx
```

Expected: loader pagination, canonical range, stale-request protection, and retry tests pass.

- [ ] **Step 5: Commit the shared loader**

```text
[REFACTOR] Share Ledger report loading

- 비교 결과의 기준 기간으로 카테고리와 추이 데이터를 함께 조회
- 모든 계좌 잔액 페이지를 Report와 Dashboard가 같은 경로로 사용
```

### Task 2: Build the focused Dashboard Ledger surface

**Files:**
- Create: `frontend/src/features/dashboard/ui/DashboardLedgerHighlights.tsx`
- Delete: `frontend/src/features/dashboard/ui/LedgerSummaryCard.tsx`
- Create: `frontend/tests/presentation/dashboard-ledger-highlights.spec.tsx`

- [ ] **Step 1: Add focused failing tests for the approved states**

Mock `loadLedgerReport` and render `DashboardLedgerHighlights` directly. Cover these behaviors in one normal-flow test and three small edge tests:

```tsx
it("shows one shared selection with Cash Flow and the reused report charts", async () => {
  vi.mocked(loadLedgerReport).mockResolvedValue(reportData({
    incomeMinor: 3_650_000,
    expenseMinor: 1_384_000,
  }));
  const onNavigate = vi.fn();
  render(<DashboardLedgerHighlights mutationEpoch={0} onNavigate={onNavigate} />);

  expect(await screen.findByRole("region", { name: "Ledger highlights" }))
    .toHaveTextContent("3,650,000 KRW");
  expect(screen.getByRole("img", { name: /Spending is 38% of income/ }))
    .toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Spending by category" }))
    .toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Income and spending pattern" }))
    .toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Previous month" }));
  expect(loadLedgerReport).toHaveBeenLastCalledWith({ period: "previous_month" });
});
```

Also assert:

```tsx
expect(screen.getByText("Remaining").parentElement).toHaveTextContent("-200,000 KRW");
expect(screen.getByRole("img", { name: /Spending is 120% of income/ }))
  .toHaveClass("is-over");
```

For income `0` and expense `200_000`, expect `No income`, a full-red `is-over` ring, and `-200,000 KRW`. For both values `0`, expect `No income or spending for this period.` and no Cash Flow image. For a USD balance with no activity, select `USD` and expect all three panel empty states while the USD currency button remains present.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npm --prefix frontend test -- dashboard-ledger-highlights.spec.tsx
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Add the minimum Dashboard-only state and Cash Flow view**

Export the intent type beside the component; do not create a one-use navigation module:

```tsx
export type DashboardLedgerNavigation =
  | { kind: "report"; selection: ReportSelection; currencyId: string }
  | { kind: "drilldown"; target: ReportDrilldownTarget };
```

The component owns only:

```tsx
const [selection, setSelection] = React.useState<ReportSelection>({
  period: "current_month",
});
const [data, setData] = React.useState<LedgerReportData | null>(null);
const [status, setStatus] = React.useState<"loading" | "loaded" | "error">("loading");
const [currencyId, setCurrencyId] = React.useState("");
```

Load on `selection` or `mutationEpoch` changes with an effect-local `active` boolean. On success, retain the selected currency if it still exists; otherwise choose the first `reportCurrencyOptions` result. On failure, show only `Could not load Ledger highlights.` and `Retry Ledger highlights`; retry increments one local integer used by the effect. Never render the caught error.

Build the model only through:

```tsx
const currencies = data
  ? reportCurrencyOptions(data.comparison, data.balances)
  : [];
const model = data && currencyId
  ? buildLedgerReportModel(
      data.comparison,
      data.categoryBreakdown,
      data.balances,
      data.trend,
      currencyId,
    )
  : null;
```

Render `ReportCurrencyTabs`, `ExpenseCategoryDonut`, and `IncomeExpenseTrendChart` directly. Use two native buttons for Current month and Previous month because Dashboard deliberately excludes Report's current-year/custom controls.

Make the `Ledger highlights` heading a button. When a model is available, it calls:

```tsx
onNavigate({ kind: "report", selection, currencyId });
```

While loading, keep the surface heading and controls visible, set the body `aria-busy="true"`, and render three non-interactive skeleton panels in the same source order. The local error replaces only that body.

Cash Flow calculation stays presentation-only:

```ts
const { incomeMinor, expenseMinor } = model.metrics;
const remainingMinor = incomeMinor - expenseMinor;
const percent = incomeMinor > 0
  ? Math.round(expenseMinor / incomeMinor * 100)
  : null;
const over = expenseMinor > incomeMinor;
const ringStop = over ? 100 : percent ?? 0;
```

Use existing `formatMinorUnits` for all four amounts. If both values are zero, render the empty text. If `incomeMinor === 0 && expenseMinor > 0`, use `No income`; otherwise the center is `${percent}%` or `Over ${percent - 100}%`. Add a complete textual `aria-label` to the donut and route category/trend callbacks as `{ kind: "drilldown", target }`.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run:

```powershell
npm --prefix frontend test -- dashboard-ledger-highlights.spec.tsx
```

Expected: normal, over-budget, no-income, both-zero, USD-with-no-activity, selection, retry, and drilldown assertions pass.

- [ ] **Step 5: Commit the focused component**

```text
[ADD] Add Dashboard Ledger highlights

- 월과 통화를 공유하는 현금 흐름 요약을 추가
- 기존 카테고리 원그래프와 수입 지출 추이 그래프를 재사용
```

### Task 3: Place and style Ledger highlights below ToDo analytics

**Files:**
- Modify: `frontend/src/features/dashboard/ui/DashboardPanel.tsx`
- Modify: `frontend/src/features/workbench/ui/MainPanel.tsx:142-180`
- Modify: `frontend/src/styles/globals.css:3697-4050` and existing Dashboard media queries
- Modify: `frontend/tests/presentation/dashboard-panel.spec.tsx:199-760`
- Modify: `frontend/tests/architecture/design-boundaries.spec.ts`

- [ ] **Step 1: Replace the obsolete ToDo-only composition assertion**

Keep the assertion that Dashboard never requests `/api/v1/dashboard`, but replace the expectation that Cash Flow is absent. Mock the report loader and assert:

```tsx
render(
  <DashboardPanel
    controller={dashboardPanelController(items)}
    ledgerMutationEpoch={0}
    onLedgerNavigate={vi.fn()}
  />,
);

expect(screen.getByRole("region", { name: "Dashboard analytics" }))
  .toBeInTheDocument();
expect(await screen.findByRole("region", { name: "Ledger highlights" }))
  .toBeInTheDocument();
expect(requestJson).not.toHaveBeenCalledWith("/api/v1/dashboard");
```

Add an isolation test where the loader rejects: ToDo cards remain visible, the Ledger-local alert appears, and `Retry Dashboard` does not replace `Retry Ledger highlights`.

In `design-boundaries.spec.ts`, extend the existing Dashboard breakpoint test:

```ts
expect(wide).toMatch(
  /\.dashboard-ledger-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 1fr\) minmax\(0, 2fr\);/s,
);
expect(medium).toMatch(
  /\.dashboard-ledger-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/s,
);
expect(mobile).toMatch(
  /\.dashboard-ledger-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/s,
);
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```powershell
npm --prefix frontend test -- dashboard-panel.spec.tsx design-boundaries.spec.ts
```

Expected: FAIL because Dashboard does not mount or style Ledger highlights.

- [ ] **Step 3: Append Ledger highlights after every ToDo widget**

Extend `DashboardPanelProps`:

```ts
type DashboardPanelProps = {
  controller: WorkbenchController;
  ledgerMutationEpoch: number;
  onLedgerNavigate: (target: DashboardLedgerNavigation) => void;
};
```

Render this as the last child of the loaded `.dashboard-panel`, after `DashboardStatusCard`:

```tsx
<DashboardLedgerHighlights
  mutationEpoch={ledgerMutationEpoch}
  onNavigate={onLedgerNavigate}
/>
```

Do not gate it on ToDo-derived models. In `MainPanel`, pass `mutationEpochs?.ledger ?? 0` and keep this task independently compilable with the direct navigation callback:

```tsx
<DashboardPanel
  controller={controller}
  ledgerMutationEpoch={mutationEpochs?.ledger ?? 0}
  onLedgerNavigate={(target) =>
    controller.selectTab(target.kind === "report" ? "reports" : "transactions")}
/>
```

Task 4 replaces this direct callback with the intent-preserving callback.

- [ ] **Step 4: Add the shared-surface styles**

Use one outer bordered surface and internal grid divisions. The essential contract is:

```css
.dashboard-ledger {
  grid-column: 1 / -1;
  min-width: 0;
  border: 1px solid var(--color-hairline-light);
  background: var(--color-canvas-light);
}

.dashboard-ledger-grid {
  display: grid;
  min-width: 0;
}

@media (min-width: 1440px) {
  .dashboard-ledger-grid {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 2fr);
  }
}

@media (min-width: 768px) and (max-width: 1439px) {
  .dashboard-ledger-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 767px) {
  .dashboard-ledger-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
```

Scope Report chart spacing and borders under `.dashboard-ledger`; do not fork their chart colors or geometry. Add Cash Flow `conic-gradient`, `.is-over`, focus-visible, skeleton, and panel separators. Source/focus order remains Cash Flow, category, trend.

- [ ] **Step 5: Verify the mutation epoch reload and GREEN tests**

Add a rerender assertion to the Dashboard Ledger focused test:

```tsx
const { rerender } = render(
  <DashboardLedgerHighlights mutationEpoch={0} onNavigate={vi.fn()} />,
);
await waitFor(() => expect(loadLedgerReport).toHaveBeenCalledTimes(1));
rerender(<DashboardLedgerHighlights mutationEpoch={1} onNavigate={vi.fn()} />);
await waitFor(() => expect(loadLedgerReport).toHaveBeenCalledTimes(2));
```

Run:

```powershell
npm --prefix frontend test -- dashboard-ledger-highlights.spec.tsx dashboard-panel.spec.tsx design-boundaries.spec.ts
```

Expected: composition, isolation, reload, responsive, and dependency-free chart tests pass.

- [ ] **Step 6: Commit the Dashboard integration**

```text
[UPDATE] Place Ledger highlights below ToDo

- ToDo 분석 다음에 하나의 Ledger 분석 표면을 배치
- 데스크톱 1대1대2와 좁은 화면 세로 배치를 적용
```

### Task 4: Preserve period, currency, and drilldown navigation intent

**Files:**
- Modify: `frontend/src/features/workbench/ui/MainPanel.tsx:142-245`
- Modify: `frontend/src/features/ledger/ui/LedgerPanel.tsx:21-70`
- Modify: `frontend/src/features/ledger/ui/LedgerReports.tsx:20-52`
- Modify: `frontend/tests/presentation/ledger-panel.spec.tsx:2750-2920`
- Modify: `frontend/tests/presentation/workbench-wireframe.spec.tsx`

- [ ] **Step 1: Add failing one-time Report intent tests**

In `ledger-panel.spec.tsx`, render Reports with an initial Dashboard intent:

```tsx
render(
  <LedgerPanel
    leafTabId="reports"
    controller={ledger}
    initialReportSelection={{ period: "previous_month" }}
    initialReportCurrencyId="currency-usd"
  />,
);

await waitFor(() => {
  expect(ledger.runReports).toHaveBeenCalledWith({ period: "previous_month" });
});
expect(screen.getByRole("button", { name: "USD" }))
  .toHaveAttribute("aria-pressed", "true");
```

Rerender without the props and assert no second default current-month request occurs.

In `workbench-wireframe.spec.tsx`, mock the Dashboard child only enough to invoke `onLedgerNavigate`. Assert:

- `{ kind: "report", selection, currencyId }` selects `reports` and reaches `LedgerPanel` once.
- a category target selects `transactions` and calls `updateTableSettings("ledger.transactions", ...)` with date, currency, and category rules.
- a trend target selects `transactions` and applies date, currency, and entry-type rules.

- [ ] **Step 2: Run navigation tests and verify RED**

Run:

```powershell
npm --prefix frontend test -- ledger-panel.spec.tsx workbench-wireframe.spec.tsx
```

Expected: FAIL because Dashboard intent props and workbench transfer do not exist.

- [ ] **Step 3: Make Reports consume a one-time initial selection and currency**

Add these optional props through `LedgerPanel` into `LedgerReports`:

```ts
initialReportSelection?: ReportSelection;
initialReportCurrencyId?: string;
```

In `LedgerReports`, freeze the initial request and currency at mount:

```tsx
const initialSelection = useRef<ReportSelection>(
  initialReportSelection ?? { period: "current_month" },
);
const [currencyId, setCurrencyId] = useState(
  initialReportCurrencyId ?? reportCurrencies[0]?.id ?? "",
);

useEffect(() => {
  if (defaultReportRequested.current || state.reportStatus !== "idle") return;
  defaultReportRequested.current = true;
  void controller.runReports(initialSelection.current).catch(() => undefined);
}, [controller, state.reportStatus]);
```

In the currency reconciliation effect, return early while `reportCurrencies.length === 0`; this prevents the intended currency from being erased before the request completes.

- [ ] **Step 4: Retain one pending intent at the existing workbench boundary**

At the top of `MainPanel`, before conditional returns:

```tsx
const [ledgerNavigation, setLedgerNavigation] =
  React.useState<DashboardLedgerNavigation | null>(null);
const handleLedgerNavigationHandled = React.useCallback(
  () => setLedgerNavigation(null),
  [],
);

function navigateLedger(target: DashboardLedgerNavigation) {
  setLedgerNavigation(target);
  controller.selectTab(target.kind === "report" ? "reports" : "transactions");
}
```

Pass `navigateLedger` to Dashboard and the pending intent plus `onNavigationHandled={handleLedgerNavigationHandled}` to `LedgerWorkspace`.

Inside `LedgerWorkspace`, use one effect:

```tsx
useEffect(() => {
  if (!navigation) return;
  if (navigation.kind === "drilldown") {
    controller.updateTableSettings("ledger.transactions", (settings) =>
      applyReportDrilldown(settings, navigation.target));
  }
  onNavigationHandled();
}, [controller, navigation, onNavigationHandled]);
```

Pass Report intent values into `LedgerPanel` only when `navigation?.kind === "report"`. Do not directly query transactions or construct table rows in Dashboard.

- [ ] **Step 5: Run navigation tests and verify GREEN**

Run:

```powershell
npm --prefix frontend test -- ledger-panel.spec.tsx workbench-wireframe.spec.tsx
```

Expected: title, category, and trend navigation preserve the approved selection/filter intent exactly once.

- [ ] **Step 6: Commit navigation intent**

```text
[UPDATE] Preserve Ledger Dashboard navigation intent

- Dashboard의 기간과 통화를 Ledger Reports 진입 시 유지
- 카테고리와 막대 선택을 거래 필터로 한 번만 전달
```

### Task 5: Run complete frontend verification

**Files:**
- Verify all modified frontend files

- [ ] **Step 1: Run all frontend tests**

```powershell
npm --prefix frontend test
```

Expected: all Vitest suites pass with zero failures.

- [ ] **Step 2: Run static checks and production build**

```powershell
npm --prefix frontend run typecheck
npm --prefix frontend run build
git diff --check
```

Expected: TypeScript exits zero, Next.js static export succeeds, and Git reports no whitespace errors.

- [ ] **Step 3: Manually verify the approved visual and interactions**

Run the user's normal command:

```powershell
npm --prefix frontend run ui -- --no-open
```

Open the emitted loopback URL and verify:

- Ledger highlights is below all ToDo analytics.
- Desktop is one shared `1:1:2` surface; narrow viewport stacks Cash Flow, category, trend.
- Current/Previous month and KRW/USD update every panel.
- Overspending is full red with a negative remaining amount.
- Title opens Reports with selection retained.
- Category and trend bars open Transactions with the correct filters.
- A Ledger load failure leaves ToDo analytics usable.

Stop the local UI process after verification.

- [ ] **Step 4: Commit any verification-only correction with its regression test**

Skip this commit when no correction is needed. If manual verification reveals a defect, add the smallest failing regression assertion, fix it, rerun Steps 1-3, and commit only that correction with an NFLOW `[FIX]` message.
