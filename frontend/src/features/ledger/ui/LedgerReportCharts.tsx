"use client";

import React from "react";

import type { ReportSelection } from "@/features/ledger/api/ledger-api";
import type { Currency } from "@/features/ledger/model/ledger-model";
import type {
  LedgerReportModel,
  ReportDrilldownTarget,
} from "@/features/ledger/model/ledger-reports";
import { formatMoney } from "@/features/ledger/ui/ledger-ui";

const reportPresets: ReadonlyArray<{
  period: Exclude<ReportSelection["period"], "custom">;
  label: string;
}> = [
  { period: "current_month", label: "Current month" },
  { period: "previous_month", label: "Previous month" },
  { period: "current_year", label: "Current year" },
];

export function ReportPeriodControls({
  selection,
  disabled,
  onChange,
}: {
  selection: ReportSelection;
  disabled: boolean;
  onChange: (selection: ReportSelection) => void;
}) {
  const [range, setRange] = React.useState(() => selection.period === "custom"
    ? { from: selection.from, to: selection.to }
    : { from: "", to: "" });
  const validRange = range.from !== "" && range.to !== "" && range.from <= range.to;

  return (
    <div className="ledger-report-period" aria-label="Report period">
      <div className="ledger-report-presets">
        {reportPresets.map(({ period, label }) => (
          <button
            key={period}
            type="button"
            aria-pressed={selection.period === period}
            disabled={disabled}
            onClick={() => onChange({ period })}
          >
            {label}
          </button>
        ))}
      </div>
      <form
        className="ledger-report-custom"
        aria-label="Ledger report range"
        onSubmit={(event) => {
          event.preventDefault();
          if (validRange) onChange({ period: "custom", ...range });
        }}
      >
        <label>
          From
          <input
            type="date"
            required
            value={range.from}
            onChange={(event) => setRange((current) => ({
              ...current,
              from: event.target.value,
            }))}
          />
        </label>
        <label>
          To
          <input
            type="date"
            required
            value={range.to}
            onChange={(event) => setRange((current) => ({
              ...current,
              to: event.target.value,
            }))}
          />
        </label>
        <button type="submit" disabled={disabled || !validRange}>Run reports</button>
      </form>
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
  currency: Currency | undefined;
}) {
  const cards = [model.summary[0], model.summary[1], model.summary[2], model.summary[3]];
  const labels = ["Income", "Expenses", "Net", "Entries"];
  return (
    <section className="ledger-report-section" aria-label="Summary">
      <h2>Summary</h2>
      <div className="ledger-report-summary">
        {cards.map((card, index) => {
          const isCount = card.id === "entries";
          const value = isCount
            ? card.count.toString()
            : reportMoney(card.valueMinor, currency, model.currencyCode);
          return (
            <div
              key={card.id}
              className="ledger-report-card"
              role="group"
              aria-label={labels[index]}
            >
              <span>{labels[index]}</span>
              <strong>{value}</strong>
              <small>{signedValue(card.changeMinor, isCount, currency, model.currencyCode)} vs previous period</small>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function ExpenseCategorySection({
  model,
  currency,
  onDrilldown,
}: ReportSectionProps) {
  const total = model.categories.reduce((sum, row) => sum + row.expenseMinor, 0);
  const gradient = categoryGradient(model.categories.map(({ expenseMinor }) => expenseMinor));
  const totalLabel = reportMoney(total, currency, model.currencyCode);
  return (
    <section className="ledger-report-section" aria-label="Expense categories">
      <h2>Expense categories</h2>
      {model.categories.length === 0 ? (
        <p className="items-message">No expense categories for this period.</p>
      ) : (
        <div className="ledger-report-category-layout">
          <div className="ledger-report-donut-panel">
            <div
              className="ledger-report-donut"
              role="img"
              aria-label={`Expense category total ${totalLabel}`}
              style={{ "--ledger-report-donut": gradient } as React.CSSProperties}
            >
              <strong>{totalLabel}</strong>
            </div>
            <div className="ledger-report-donut-legend">
              {model.categories.map((row) => {
                const label = `${row.name}, ${reportMoney(row.expenseMinor, currency, model.currencyCode)}, ${Math.round(row.expenseMinor / total * 100)}%`;
                return row.referenceId && model.range ? (
                  <button
                    key={row.referenceId}
                    type="button"
                    aria-label={label}
                    onClick={() => onDrilldown?.(drilldown(model, "category", row.referenceId!))}
                  >
                    <span>{row.name}</span>
                    <span>{reportMoney(row.expenseMinor, currency, model.currencyCode)}</span>
                  </button>
                ) : (
                  <div key={`${row.name}-${row.currencyId}`} aria-label={label}>
                    <span>{row.name}</span>
                    <span>{reportMoney(row.expenseMinor, currency, model.currencyCode)}</span>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="items-section">
            <table className="items-table ledger-report-table" aria-label="Expense categories">
              <thead><tr><th scope="col">Category</th><th scope="col">Expense</th></tr></thead>
              <tbody>
                {model.categories.map((row) => (
                  <tr key={`${row.referenceId ?? row.name}-${row.currencyId}`}>
                    <td>{row.name}</td>
                    <td>{reportMoney(row.expenseMinor, currency, model.currencyCode)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><th scope="row">Total</th><td>{totalLabel}</td></tr></tfoot>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

export function AccountReportSection({
  model,
  currency,
  onDrilldown,
}: ReportSectionProps) {
  return (
    <section className="ledger-report-section" aria-label="Accounts">
      <h2>Accounts</h2>
      {model.accounts.length === 0 ? (
        <p className="items-message">No account activity for this period.</p>
      ) : (
        <div className="items-section">
          <table className="items-table ledger-report-table" aria-label="Accounts">
            <thead>
              <tr><th scope="col">Account</th><th scope="col">Income</th><th scope="col">Expense</th><th scope="col">Net</th></tr>
            </thead>
            <tbody>
              {model.accounts.map((row) => (
                <tr key={`${row.referenceId ?? row.name}-${row.currencyId}`}>
                  <td>
                    {row.referenceId && model.range ? (
                      <button
                        type="button"
                        onClick={() => onDrilldown?.(drilldown(model, "account", row.referenceId!))}
                      >
                        <span aria-hidden="true">{row.name}</span>
                        <span className="sr-only">View {row.name} transactions</span>
                      </button>
                    ) : row.name}
                  </td>
                  <td>{reportMoney(row.incomeMinor, currency, model.currencyCode)}</td>
                  <td>{reportMoney(row.expenseMinor, currency, model.currencyCode)}</td>
                  <td>{reportMoney(row.netChangeMinor, currency, model.currencyCode)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function LedgerTrendChart({
  model,
  currency,
}: {
  model: LedgerReportModel;
  currency: Currency | undefined;
}) {
  const points = model.trend.points;
  const maximum = Math.max(1, ...points.flatMap((point) => [point.incomeMinor, point.expenseMinor]));
  const coordinates = (key: "incomeMinor" | "expenseMinor") => points
    .map((point, index) => `${pointX(index, points.length)},${100 - point[key] / maximum * 100}`)
    .join(" ");
  const granularity = `${model.trend.granularity[0]?.toUpperCase()}${model.trend.granularity.slice(1)}`;

  return (
    <section className="ledger-report-section" aria-label="Trend">
      <div className="ledger-report-section-heading">
        <h2>Trend</h2>
        <p>{granularity} granularity</p>
      </div>
      {points.length === 0 ? (
        <p className="items-message">No trend data for this period.</p>
      ) : (
        <div className="ledger-report-trend">
          <div className="ledger-report-trend-legend" aria-hidden="true">
            <span>Income</span><span>Expense</span>
          </div>
          <svg viewBox="0 0 100 100" role="img" aria-label="Income and expense trend" preserveAspectRatio="none">
            <polyline className="ledger-report-trend-income" points={coordinates("incomeMinor")} />
            <polyline className="ledger-report-trend-expense" points={coordinates("expenseMinor")} />
          </svg>
          <ul className="sr-only">
            {points.map((point) => (
              <li key={`${point.start}-${point.end}`}>
                {point.start}{point.end === point.start ? "" : ` to ${point.end}`}: Income {reportMoney(point.incomeMinor, currency, model.currencyCode)}; Expense {reportMoney(point.expenseMinor, currency, model.currencyCode)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

type ReportSectionProps = {
  model: LedgerReportModel;
  currency: Currency | undefined;
  onDrilldown?: (target: ReportDrilldownTarget) => void;
};

function reportMoney(value: number, currency: Currency | undefined, code: string): string {
  return formatMoney(value, currency, code);
}

function signedValue(
  value: number,
  count: boolean,
  currency: Currency | undefined,
  code: string,
): string {
  const formatted = count ? Math.abs(value).toString() : reportMoney(Math.abs(value), currency, code);
  return value > 0 ? `+${formatted}` : value < 0 ? `−${formatted}` : formatted;
}

function drilldown(
  model: LedgerReportModel,
  kind: ReportDrilldownTarget["kind"],
  referenceId: string,
): ReportDrilldownTarget {
  return { range: model.range!, currencyId: model.currencyId, kind, referenceId };
}

function categoryGradient(values: number[]): string {
  const total = values.reduce((sum, value) => sum + value, 0);
  const colors = [
    "var(--color-chart-primary)",
    "var(--color-chart-secondary)",
    "var(--color-chart-warning)",
  ];
  let start = 0;
  const stops = values.map((value, index) => {
    const end = start + value / total * 100;
    const stop = `${colors[index % colors.length]} ${start}% ${end}%`;
    start = end;
    return stop;
  });
  return `conic-gradient(${stops.join(", ")})`;
}

function pointX(index: number, length: number): number {
  return length === 1 ? 50 : index / (length - 1) * 100;
}
