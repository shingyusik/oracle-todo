# Ledger Report Readability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Ledger Reports load account balances directly, present income and spending as readable tabbed charts with a visible money axis, retain zero-value currency compositions, group report amounts, and apply valid custom ranges immediately.

**Architecture:** Keep report orchestration in `useLedgerController` and presentation behavior in the existing report components. Reuse the current model and APIs; add no dependency, persisted preference, endpoint, or schema. Keep money grouping report-local so existing transaction and master-data formatting does not change.

**Tech Stack:** React 18, TypeScript, Next.js 14 static export, Vitest, Testing Library, existing CSS chart primitives

---

## File Structure

- Modify `frontend/src/features/ledger/hooks/useLedgerController.ts`: include paginated balances in every report request.
- Modify `frontend/src/features/ledger/ui/LedgerReportCharts.tsx`: immediate custom ranges, report-only grouped money, stable zero donuts, trend tabs, and Y-axis rendering.
- Modify `frontend/src/styles/globals.css`: style tabs, fixed Y-axis column, selected-series bars, and zero donuts responsively.
- Modify `frontend/tests/presentation/ledger-panel.spec.tsx`: cover controller requests and all user-visible report behavior.

### Task 1: Load balances with Reports

**Files:**
- Modify: `frontend/src/features/ledger/hooks/useLedgerController.ts:568-606`
- Test: `frontend/tests/presentation/ledger-panel.spec.tsx:3206-3243`

- [ ] **Step 1: Preserve the failing regression test for direct report balance loading**

The current working tree already contains the test and its RED evidence (`listAccountBalances` was called zero times before the fix). Keep these assertions in `loads report analysis from the comparison's canonical current range`:

```tsx
const balanceRows = [{
  account: loadedState.accounts[0]!,
  currencyCode: "KRW",
  decimalPlaces: 0,
  currentBalanceMinor: 2_000,
}];
vi.mocked(ledgerApi.listAccountBalances)
  .mockResolvedValue({ items: balanceRows, nextOffset: null });

expect(ledgerApi.listAccountBalances)
  .toHaveBeenCalledWith({ limit: 200, offset: undefined });
expect(result.current.state.balances).toEqual(balanceRows);
```

- [ ] **Step 2: Keep the minimal balance request in report orchestration**

Use the existing `drainPages` helper and update state only after the report generation guard:

```ts
const [categoryBreakdown, trend, balances] = await Promise.all([
  ledgerApi.categoryReport(range),
  ledgerApi.trend(range),
  drainPages((offset) => ledgerApi.listAccountBalances({ limit: 200, offset })),
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
  balances,
}));
```

- [ ] **Step 3: Run the focused controller test**

Run:

```powershell
npm --prefix frontend test -- ledger-panel.spec.tsx
```

Expected: `loads report analysis from the comparison's canonical current range` passes and the full file reports zero failures.

- [ ] **Step 4: Commit the balance fix only**

Stage the controller hunk and its matching test hunk without staging later UI work, then commit:

```text
[FIX] Load balances with Ledger reports

- Reports 직접 진입 시에도 계좌 잔액을 페이지 끝까지 조회
- Accounts 화면 방문 여부와 무관하게 자산 및 부채 분석을 구성
```

### Task 2: Apply custom ranges without a submit button

**Files:**
- Modify: `frontend/src/features/ledger/ui/LedgerReportCharts.tsx:29-84`
- Test: `frontend/tests/presentation/ledger-panel.spec.tsx:2794-2840`

- [ ] **Step 1: Replace the submit test with immediate valid-range tests**

```tsx
it("runs a custom report as soon as both dates form a valid range", async () => {
  const user = userEvent.setup();
  const ledger = controller();
  render(<LedgerPanel leafTabId="reports" controller={ledger} />);

  await user.type(screen.getByLabelText("From"), "2026-07-01");
  expect(ledger.runReports).toHaveBeenCalledTimes(1);
  await user.type(screen.getByLabelText("To"), "2026-07-31");

  expect(screen.queryByRole("button", { name: "Run reports" })).toBeNull();
  expect(ledger.runReports).toHaveBeenLastCalledWith({
    period: "custom",
    from: "2026-07-01",
    to: "2026-07-31",
  });
});

it("does not run an incomplete or inverted custom range", async () => {
  const user = userEvent.setup();
  const ledger = controller();
  render(<LedgerPanel leafTabId="reports" controller={ledger} />);

  await user.type(screen.getByLabelText("From"), "2026-08-31");
  await user.type(screen.getByLabelText("To"), "2026-08-01");

  expect(ledger.runReports).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run `npm --prefix frontend test -- ledger-panel.spec.tsx`.

Expected: FAIL because `Run reports` still exists and no custom request occurs before clicking it.

- [ ] **Step 3: Replace the form submission with one guarded range updater**

Inside `ReportPeriodControls`, use:

```tsx
function updateRange(field: "from" | "to", value: string) {
  const next = { ...range, [field]: value };
  setRange(next);
  if (next.from !== "" && next.to !== "" && next.from <= next.to) {
    onChange({ period: "custom", ...next });
  }
}
```

Render `.ledger-report-custom` as a `div`, remove the submit button, and wire the native date inputs:

```tsx
<div className="ledger-report-custom" aria-label="Ledger report range">
  <label>
    From
    <input
      type="date"
      value={range.from}
      onChange={(event) => updateRange("from", event.target.value)}
    />
  </label>
  <label>
    To
    <input
      type="date"
      value={range.to}
      onChange={(event) => updateRange("to", event.target.value)}
    />
  </label>
</div>
```

Update the retry test to trigger the error by entering the second valid date instead of clicking a removed button.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run `npm --prefix frontend test -- ledger-panel.spec.tsx`.

Expected: both custom-range tests and the retry test pass.

- [ ] **Step 5: Commit the period-control change**

```text
[UPDATE] Apply Ledger report ranges immediately

- 유효한 시작일과 종료일이 완성되면 사용자 지정 보고서를 즉시 실행
- 불완전하거나 역전된 기간은 요청하지 않고 별도 실행 버튼 제거
```

### Task 3: Group report money and retain zero composition donuts

**Files:**
- Modify: `frontend/src/features/ledger/ui/LedgerReportCharts.tsx:129-280, 375-386`
- Test: `frontend/tests/presentation/ledger-panel.spec.tsx:2877-2920, 3060-3155`

- [ ] **Step 1: Add failing grouped-money and zero-USD-liability assertions**

Extend the report fixture for a large KRW summary and assert report-only grouping:

```tsx
const state = reportAnalysisState();
state.comparison!.currencies[0]!.current.incomeMinor = 3_650_000;
state.comparison!.current.currencies[0]!.incomeMinor = 3_650_000;
render(<LedgerPanel leafTabId="reports" controller={controller(state)} />);

expect(within(screen.getByRole("region", { name: "Summary" }))
  .getByRole("group", { name: "Income" }))
  .toHaveTextContent("3,650,000 KRW");
expect(screen.getByRole("button", { name: /Cash, 67%, 2,000 KRW/ }))
  .toBeInTheDocument();
```

In a second test, extend the fixture balances before rendering to cover signs and two-decimal
grouping:

```tsx
const user = userEvent.setup();
const groupedBalances = reportAnalysisState();
groupedBalances.balances = groupedBalances.balances.map((balance) => balance.account.id === "account-card"
  ? { ...balance, currentBalanceMinor: -650_000 }
  : balance.account.id === "account-dollar-cash"
    ? { ...balance, currentBalanceMinor: 125_000 }
    : balance);
render(<LedgerPanel leafTabId="reports" controller={controller(groupedBalances)} />);
expect(screen.getByRole("button", { name: /Credit card, 100%, 650,000 KRW/ }))
  .toBeInTheDocument();
await user.click(screen.getByRole("button", { name: "USD" }));
expect(screen.getByRole("img", { name: /Asset composition, total 1,250.00 USD/ }))
  .toBeInTheDocument();
```

In the existing currency-isolation test, select USD and assert the stable zero donut:

```tsx
await user.click(within(currencyGroup).getByRole("button", { name: "USD" }));
expect(screen.getByRole("img", { name: "Liability composition, total 0 USD" }))
  .toBeInTheDocument();
expect(screen.getByText("No liability balances for this currency."))
  .toBeInTheDocument();
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run `npm --prefix frontend test -- ledger-panel.spec.tsx`.

Expected: FAIL because report values are ungrouped and an empty liability composition renders no donut.

- [ ] **Step 3: Add an exact report-only grouped minor-unit formatter**

Import `formatMinorUnits` beside `formatMoney`, retain `formatMoney` for non-report UI, and replace the local report helper with:

```tsx
function reportMoney(
  value: number,
  currency: Pick<Currency, "code" | "decimalPlaces"> | undefined,
  code: string,
): string {
  const amount = formatMinorUnits(value, currency?.decimalPlaces ?? 0);
  const [whole, fraction] = amount.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const display = fraction === undefined ? grouped : `${grouped}.${fraction}`;
  const currencyCode = currency?.code ?? code;
  return currencyCode ? `${display} ${currencyCode}` : display;
}
```

This preserves exact minor units and formats `-650000`, `125000` with two decimals, and zero without changing transaction tables.

- [ ] **Step 4: Make zero donuts opt-in for account compositions**

Add `showZeroDonut?: boolean` to `CompositionDonut`, pass it from both account cards, and keep category behavior unchanged:

```tsx
<CompositionDonut
  title="Assets"
  slices={model.assets}
  showZeroDonut
  emptyMessage="No asset balances for this currency."
  ariaLabel="Asset composition"
  formatValue={formatValue}
  onSelect={selectAccount}
/>
<CompositionDonut
  title="Liabilities"
  slices={model.liabilities}
  showZeroDonut
  emptyMessage="No liability balances for this currency."
  ariaLabel="Liability composition"
  formatValue={formatValue}
  onSelect={selectAccount}
/>
```

Replace the unconditional empty return with:

```tsx
if (slices.length === 0 && !showZeroDonut) {
  return (
    <div className="ledger-report-composition">
      {showTitle ? <h3>{title}</h3> : null}
      <p className="items-message">{emptyMessage}</p>
    </div>
  );
}
```

Render the normal donut for an empty account slice and replace its empty legend with the message:

```tsx
{slices.length === 0 ? (
  <p className="items-message">{emptyMessage}</p>
) : (
  <div className="ledger-report-donut-legend">
    {slices.map((slice, index) => {
      const content = (
        <>
          <span className="ledger-report-donut-label">
            <span
              className="ledger-report-donut-key"
              aria-hidden="true"
              style={{ background: chartColors[index % chartColors.length] }}
            />
            {slice.label} · {slice.percentage}%
          </span>
          <span>{formatValue(slice.valueMinor)}</span>
        </>
      );
      return slice.interactive && onSelect ? (
        <button
          key={slice.id}
          type="button"
          aria-label={`${slice.label}, ${slice.percentage}%, ${formatValue(slice.valueMinor)}, ${ariaLabel.toLowerCase()}`}
          onClick={() => onSelect(slice)}
        >
          {content}
        </button>
      ) : <div key={slice.id ?? `${slice.label}-${slice.valueMinor}`}>{content}</div>;
    })}
  </div>
)}
```

- [ ] **Step 5: Run the focused tests and verify GREEN**

Run `npm --prefix frontend test -- ledger-panel.spec.tsx`.

Expected: grouped Summary/donut values pass, USD shows a `0 USD` liability donut, and the category empty-state test still passes.

- [ ] **Step 6: Commit the report-format and zero-state change**

```text
[UPDATE] Clarify Ledger report amounts and zero balances

- 보고서 금액에 통화 소수 자릿수를 유지한 천 단위 구분자 적용
- 선택 통화에 부채가 없어도 0 원그래프와 안내 문구로 레이아웃 유지
```

### Task 4: Replace grouped series with tabbed trend and visible Y-axis

**Files:**
- Modify: `frontend/src/features/ledger/ui/LedgerReportCharts.tsx:294-376`
- Modify: `frontend/src/styles/globals.css:421-507`
- Test: `frontend/tests/presentation/ledger-panel.spec.tsx:2965-3060`

- [ ] **Step 1: Replace the interim independent-series test with tab and axis behavior tests**

```tsx
it("shows Spending first and switches to an Income chart with grouped Y-axis values", async () => {
  const user = userEvent.setup();
  const state = reportAnalysisState();
  state.trend!.currencies[0]!.points = [{
    start: "2026-08-01", end: "2026-08-01",
    incomeMinor: 3_200_000, expenseMinor: 800_000,
  }, {
    start: "2026-08-02", end: "2026-08-02",
    incomeMinor: 1_600_000, expenseMinor: 400_000,
  }];
  render(<LedgerPanel leafTabId="reports" controller={controller(state)} />);

  expect(screen.getByRole("tab", { name: "Spending" }))
    .toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("button", { name: "2026-08-01 Expense 800,000 KRW" }))
    .toBeInTheDocument();
  expect(screen.getByLabelText("Spending Y-axis"))
    .toHaveTextContent("800,000 KRW400,000 KRW0 KRW");
  expect(screen.getByText("Average daily pace")).toBeInTheDocument();

  await user.click(screen.getByRole("tab", { name: "Income" }));
  expect(screen.getByRole("button", { name: "2026-08-01 Income 3,200,000 KRW" }))
    .toBeInTheDocument();
  expect(screen.getByLabelText("Income Y-axis"))
    .toHaveTextContent("3,200,000 KRW1,600,000 KRW0 KRW");
  expect(screen.queryByText("Average daily pace")).toBeNull();
});
```

Extend the drilldown test: click the default Expense bar, switch to Income, click its bar, and assert `entryType: "expense"` then `entryType: "income"`.

- [ ] **Step 2: Run the focused tests and verify RED**

Run `npm --prefix frontend test -- ledger-panel.spec.tsx`.

Expected: FAIL because no series tabs or visible Y-axis exist and both series render together.

- [ ] **Step 3: Add local selected-series state and a zero-safe scale**

At the start of `IncomeExpenseTrendChart`:

```tsx
const [series, setSeries] = React.useState<"income" | "expense">("expense");
const isExpense = series === "expense";
const maximum = Math.max(0, ...points.flatMap((point) => isExpense
  ? [point.expenseMinor, point.averageExpensePaceMinor]
  : [point.incomeMinor]));
const height = (value: number) => maximum === 0 ? "0%" : `${value / maximum * 100}%`;
const ticks = [maximum, Math.round(maximum / 2), 0];
```

- [ ] **Step 4: Render semantic tabs, one series, and the selected Y-axis**

Use local tabs and a chart grid:

```tsx
<div className="ledger-report-trend-tabs" role="tablist" aria-label="Trend series">
  <button type="button" role="tab" aria-selected={!isExpense} onClick={() => setSeries("income")}>Income</button>
  <button type="button" role="tab" aria-selected={isExpense} onClick={() => setSeries("expense")}>Spending</button>
</div>
<div className="ledger-report-trend-chart">
  <div className="ledger-report-y-axis" aria-label={`${isExpense ? "Spending" : "Income"} Y-axis`}>
    {ticks.map((tick, index) => <span key={`${tick}-${index}`}>{reportMoney(tick, currency, model.currencyCode)}</span>)}
  </div>
  <div className="ledger-report-bars" role="group" aria-label={`${isExpense ? "Spending" : "Income"} pattern`}>
    {points.map((point) => {
      const value = isExpense ? point.expenseMinor : point.incomeMinor;
      const label = isExpense ? "Expense" : "Income";
      return (
        <div className="ledger-report-bar-group" key={`${point.start}-${point.end}`}>
          <div className="ledger-report-bar-plot">
            <button
              type="button"
              className={isExpense ? "ledger-report-bar-expense" : "ledger-report-bar-income"}
              style={{ height: height(value) }}
              aria-label={`${point.start} ${label} ${reportMoney(value, currency, model.currencyCode)}`}
              onClick={() => onDrilldown?.(trendDrilldown(model, point, series))}
            />
            {isExpense ? <span className="ledger-report-average-marker" style={{ bottom: height(point.averageExpensePaceMinor) }} aria-hidden="true" /> : null}
          </div>
          <span>{point.start}</span>
        </div>
      );
    })}
  </div>
</div>
```

Render `Average daily pace` legend text only for Spending. Change the screen-reader list to describe only the selected series, adding average pace only for Spending.

- [ ] **Step 5: Add the approved left-axis and tab CSS**

```css
.ledger-report-trend-tabs {
  display: flex;
  gap: 8px;
}

.ledger-report-trend-tabs button {
  border: 1px solid var(--color-hairline-light);
  border-radius: var(--radius-pill);
  background: var(--color-canvas-cream);
  padding: 7px 12px;
}

.ledger-report-trend-tabs button[aria-selected="true"] {
  border-color: var(--color-ink);
  background: var(--color-ink);
  color: var(--color-on-dark);
}

.ledger-report-trend-tabs button:focus-visible {
  outline: 3px solid var(--color-ink);
  outline-offset: 3px;
}

.ledger-report-trend-chart {
  display: grid;
  min-width: 0;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 12px;
}

.ledger-report-y-axis {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 16px 0 29px;
  color: var(--color-text-muted);
  font-size: 11px;
  text-align: right;
}
```

Keep `.ledger-report-bars` horizontally scrollable. Increase a single selected bar to `width: min(24px, 60%)`; retain existing colors and focus styles.

- [ ] **Step 6: Run the focused tests and verify GREEN**

Run `npm --prefix frontend test -- ledger-panel.spec.tsx`.

Expected: Spending is default, both tabs and Y-axes pass, average text is Spending-only, both drilldowns pass, and zero-valued bars remain `0%`.

- [ ] **Step 7: Commit the trend-chart change**

```text
[UPDATE] Add readable Ledger trend tabs and axis

- 지출 기본 탭과 수입 전환으로 계열별 추세를 분리
- 선택 계열의 최대·중간·0 금액을 왼쪽 Y축에 표시
- 평균 소비선은 지출 축에만 연결하고 기존 드릴다운 유지
```

### Task 5: Verify the complete frontend change

**Files:**
- Verify: `frontend/src/features/ledger/hooks/useLedgerController.ts`
- Verify: `frontend/src/features/ledger/ui/LedgerReportCharts.tsx`
- Verify: `frontend/src/styles/globals.css`
- Verify: `frontend/tests/presentation/ledger-panel.spec.tsx`

- [ ] **Step 1: Run focused Ledger presentation tests**

Run `npm --prefix frontend test -- ledger-panel.spec.tsx`.

Expected: all LedgerPanel tests pass.

- [ ] **Step 2: Run the full frontend suite**

Run `npm --prefix frontend test`.

Expected: all test files pass with zero failed tests.

- [ ] **Step 3: Run typecheck after tests**

Run `npm --prefix frontend run typecheck`.

Expected: exit code 0. Do not run this concurrently with `next build`, because build regeneration of `.next/types` can race the compiler.

- [ ] **Step 4: Run the production build**

Run `npm --prefix frontend run build`.

Expected: static `/` and `/_not-found` routes build successfully.

- [ ] **Step 5: Inspect final changes**

Run:

```powershell
git diff --check
git status --short
git log --oneline -n 8
```

Expected: no whitespace errors; only intended uncommitted files remain, or the worktree is clean after all task commits.

- [ ] **Step 6: Restart the mock UI for manual confirmation**

After stopping the existing server, run:

```powershell
$env:RAVEN_HOME = "$PWD\.mock-data\todo-engine"
npm --prefix frontend run ui -- --no-open
```

Expected: KRW shows populated asset and liability donuts, USD keeps a `0 USD` liability donut, Summary uses commas, Spending opens first with a left money axis, Income switches cleanly, and custom dates apply without a button.
