"use client";

import React from "react";

import type { ReportSelection } from "@/features/ledger/api/ledger-api";
import type { Currency } from "@/features/ledger/model/ledger-model";
import type {
  CompositionSlice,
  LedgerReportModel,
  ReportDrilldownTarget,
} from "@/features/ledger/model/ledger-reports";
import { formatMinorUnits } from "@/features/ledger/ui/ledger-ui";

const reportPresets: ReadonlyArray<{
  period: Exclude<ReportSelection["period"], "custom">;
  label: string;
}> = [
  { period: "current_month", label: "Current month" },
  { period: "previous_month", label: "Previous month" },
  { period: "current_year", label: "Current year" },
];

const chartColors = [
  "var(--color-chart-primary)",
  "var(--color-chart-secondary)",
  "var(--color-chart-warning)",
] as const;

export function ReportPeriodControls({
  selection,
  disabled,
  onChange,
}: {
  selection: ReportSelection;
  disabled: boolean;
  onChange: (selection: ReportSelection) => Promise<boolean>;
}) {
  const [range, setRange] = React.useState(() => selection.period === "custom"
    ? { from: selection.from, to: selection.to }
    : { from: "", to: "" });
  const [customOpen, setCustomOpen] = React.useState(false);
  const customButtonRef = React.useRef<HTMLButtonElement>(null);
  const focusCustomOnClose = React.useRef(false);
  const validRange = range.from !== "" && range.to !== "" && range.from <= range.to;

  React.useEffect(() => {
    if (!customOpen && focusCustomOnClose.current) {
      focusCustomOnClose.current = false;
      customButtonRef.current?.focus();
    }
  }, [customOpen]);

  async function applyCustomRange(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validRange) return;
    if (await onChange({ period: "custom", ...range })) {
      focusCustomOnClose.current = true;
      setCustomOpen(false);
    }
  }

  return (
    <div className="ledger-report-period" aria-label="Report period">
      <div className="ledger-report-presets">
        {reportPresets.map(({ period, label }) => (
          <button
            key={period}
            type="button"
            aria-pressed={selection.period === period}
            disabled={disabled}
            onClick={() => {
              setCustomOpen(false);
              void onChange({ period });
            }}
          >
            {label}
          </button>
        ))}
        <button
          ref={customButtonRef}
          type="button"
          aria-pressed={selection.period === "custom"}
          aria-expanded={customOpen}
          disabled={disabled}
          onClick={() => setCustomOpen((open) => !open)}
        >
          Custom range
        </button>
      </div>
      {customOpen && (
        <form
          className="ledger-report-custom"
          aria-label="Ledger report range"
          onSubmit={applyCustomRange}
        >
          <label>
            Start
            <input
              type="date"
              required
              disabled={disabled}
              value={range.from}
              onChange={(event) => setRange((current) => ({
                ...current,
                from: event.target.value,
              }))}
            />
          </label>
          <label>
            End
            <input
              type="date"
              required
              disabled={disabled}
              value={range.to}
              onChange={(event) => setRange((current) => ({
                ...current,
                to: event.target.value,
              }))}
            />
          </label>
          <button type="submit" disabled={disabled || !validRange}>Apply</button>
        </form>
      )}
    </div>
  );
}

export function ReportCurrencyTabs({
  currencies,
  selectedId,
  onChange,
}: {
  currencies: ReadonlyArray<{ id: string; code: string }>;
  selectedId: string;
  onChange: (currencyId: string) => void;
}) {
  if (currencies.length === 0) return null;
  return (
    <div className="ledger-report-currencies" role="group" aria-label="Report currency">
      {currencies.map((currency) => (
        <button
          key={currency.id}
          type="button"
          aria-pressed={currency.id === selectedId}
          onClick={() => onChange(currency.id)}
        >
          {currency.code}
        </button>
      ))}
    </div>
  );
}

export function ReportSummaryCards({
  model,
  currency,
}: {
  model: LedgerReportModel;
  currency: Pick<Currency, "code" | "decimalPlaces"> | undefined;
}) {
  const cards = [
    ["Total assets", model.metrics.totalAssetsMinor, "Current balance"],
    ["Total liabilities", model.metrics.totalLiabilitiesMinor, "Current balance"],
    ["Net assets", model.metrics.netAssetsMinor, "Current balance"],
    ["Income", model.metrics.incomeMinor, "Selected period"],
    ["Spending", model.metrics.expenseMinor, "Selected period"],
    [
      "Average daily spending",
      model.metrics.averageDailyExpenseMinor,
      "Selected period calendar days",
    ],
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

export function AccountBalanceDonuts(props: ReportSectionProps) {
  const { model, currency, onDrilldown } = props;
  const formatValue = (value: number) => value === 0
    ? `0 ${currency?.code ?? model.currencyCode}`
    : reportMoney(value, currency, model.currencyCode);
  const selectAccount = (slice: CompositionSlice) => {
    if (slice.id) onDrilldown?.({
      kind: "account",
      currencyId: model.currencyId,
      referenceId: slice.id,
    });
  };

  return (
    <section className="ledger-report-section" aria-label="Account balances">
      <h2>Account balances</h2>
      <div className="ledger-report-compositions">
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
      </div>
    </section>
  );
}

export function ExpenseCategoryDonut(props: ReportSectionProps) {
  const { model, currency, onDrilldown } = props;
  return (
    <section className="ledger-report-section" aria-label="Spending by category">
      <h2>Spending by category</h2>
      <CompositionDonut
        title="Spending by category"
        showTitle={false}
        slices={model.categories}
        emptyMessage="No spending categories for this period."
        ariaLabel="Expense category composition"
        formatValue={(value) => reportMoney(value, currency, model.currencyCode)}
        onSelect={(slice) => {
          if (slice.interactive && model.range) onDrilldown?.({
            kind: "category",
            range: model.range,
            currencyId: model.currencyId,
            referenceId: slice.id,
          });
        }}
      />
    </section>
  );
}

function CompositionDonut({
  title,
  slices,
  emptyMessage,
  ariaLabel,
  formatValue,
  onSelect,
  showTitle = true,
  showZeroDonut = false,
}: {
  title: string;
  slices: CompositionSlice[];
  emptyMessage: string;
  ariaLabel: string;
  formatValue: (valueMinor: number) => string;
  onSelect?: (slice: CompositionSlice) => void;
  showTitle?: boolean;
  showZeroDonut?: boolean;
}) {
  const totalLabel = formatValue(slices.reduce((sum, slice) => sum + slice.valueMinor, 0));
  if (slices.length === 0 && !showZeroDonut) {
    return (
      <div className="ledger-report-composition">
        {showTitle ? <h3>{title}</h3> : null}
        <p className="items-message">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="ledger-report-composition">
      {showTitle ? <h3>{title}</h3> : null}
      <div className="ledger-report-donut-panel">
        <div
          className="ledger-report-donut"
          role="img"
          aria-label={`${ariaLabel}, total ${totalLabel}`}
          style={slices.length === 0 ? undefined : {
            "--ledger-report-donut": categoryGradient(
              slices.map(({ valueMinor }) => valueMinor),
            ),
          } as React.CSSProperties}
        >
          <strong>{totalLabel}</strong>
        </div>
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
      </div>
    </div>
  );
}

export function IncomeExpenseTrendChart({
  model,
  currency,
  onDrilldown,
}: {
  model: LedgerReportModel;
  currency: Pick<Currency, "code" | "decimalPlaces"> | undefined;
  onDrilldown?: (target: ReportDrilldownTarget) => void;
}) {
  const points = model.trend.points;
  const [series, setSeries] = React.useState<"income" | "expense">("expense");
  const isExpense = series === "expense";
  const maximum = Math.max(0, ...points.flatMap((point) => isExpense
    ? [point.expenseMinor, point.averageExpensePaceMinor]
    : [point.incomeMinor]));
  const height = (value: number) => maximum === 0 ? "0%" : `${value / maximum * 100}%`;
  const ticks = [maximum, Math.round(maximum / 2), 0];
  const granularity = `${model.trend.granularity[0]?.toUpperCase()}${model.trend.granularity.slice(1)}`;

  return (
    <section className="ledger-report-section" aria-label="Income and spending pattern">
      <div className="ledger-report-section-heading">
        <h2>Income and spending pattern</h2>
        <p>{granularity} granularity</p>
      </div>
      {points.length === 0 ? (
        <p className="items-message">No income or spending for this period.</p>
      ) : (
        <div className="ledger-report-trend">
          <div className="ledger-report-trend-tabs" role="tablist" aria-label="Trend series">
            <button
              type="button"
              role="tab"
              aria-selected={!isExpense}
              onClick={() => setSeries("income")}
            >
              Income
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={isExpense}
              onClick={() => setSeries("expense")}
            >
              Spending
            </button>
          </div>
          {isExpense ? (
            <div className="ledger-report-trend-legend">
              <span>Average daily pace</span>
            </div>
          ) : null}
          <div className="ledger-report-trend-chart">
            <div
              className="ledger-report-y-axis"
              aria-label={`${isExpense ? "Spending" : "Income"} Y-axis`}
            >
              {ticks.map((tick, index) => (
                <span key={`${tick}-${index}`}>
                  {reportMoney(tick, currency, model.currencyCode)}
                </span>
              ))}
            </div>
            <div
              className="ledger-report-bars"
              role="group"
              aria-label={`${isExpense ? "Spending" : "Income"} pattern`}
            >
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
                      {isExpense ? (
                        <span
                          className="ledger-report-average-marker"
                          style={{ bottom: height(point.averageExpensePaceMinor) }}
                          aria-hidden="true"
                        />
                      ) : null}
                    </div>
                    <span>{point.start}</span>
                  </div>
                );
              })}
            </div>
          </div>
          <ul className="sr-only">
            {points.map((point) => (
              <li key={`${point.start}-${point.end}`}>
                {point.start}{point.end === point.start ? "" : ` to ${point.end}`}: {isExpense
                  ? <>Spending {reportMoney(point.expenseMinor, currency, model.currencyCode)}; Average daily pace {reportMoney(point.averageExpensePaceMinor, currency, model.currencyCode)}</>
                  : <>Income {reportMoney(point.incomeMinor, currency, model.currencyCode)}</>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

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

type ReportSectionProps = {
  model: LedgerReportModel;
  currency: Pick<Currency, "code" | "decimalPlaces"> | undefined;
  onDrilldown?: (target: ReportDrilldownTarget) => void;
};

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

function categoryGradient(values: number[]): string {
  const total = values.reduce((sum, value) => sum + value, 0);
  let start = 0;
  const stops = values.map((value, index) => {
    const end = start + value / total * 100;
    const stop = `${chartColors[index % chartColors.length]} ${start}% ${end}%`;
    start = end;
    return stop;
  });
  return `conic-gradient(${stops.join(", ")})`;
}
