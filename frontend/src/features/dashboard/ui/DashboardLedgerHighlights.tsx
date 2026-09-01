"use client";

import React from "react";

import type { ReportSelection } from "@/features/ledger/api/ledger-api";
import {
  loadLedgerReport,
  type LedgerReportData,
} from "@/features/ledger/api/ledger-report-loader";
import {
  buildLedgerReportModel,
  reportCurrencyOptions,
  type LedgerReportModel,
  type ReportDrilldownTarget,
} from "@/features/ledger/model/ledger-reports";
import {
  ExpenseCategoryDonut,
  IncomeExpenseTrendChart,
  ReportCurrencyTabs,
} from "@/features/ledger/ui/LedgerReportCharts";
import { formatMinorUnits } from "@/features/ledger/ui/ledger-ui";

export type DashboardLedgerNavigation =
  | { kind: "report"; selection: ReportSelection; currencyId: string }
  | { kind: "drilldown"; target: ReportDrilldownTarget };

export function DashboardLedgerHighlights({
  mutationEpoch,
  onNavigate,
}: {
  mutationEpoch: number;
  onNavigate: (navigation: DashboardLedgerNavigation) => void;
}) {
  const [selection, setSelection] = React.useState<ReportSelection>({
    period: "current_month",
  });
  const [data, setData] = React.useState<LedgerReportData | null>(null);
  const [status, setStatus] = React.useState<"loading" | "loaded" | "error">("loading");
  const [currencyId, setCurrencyId] = React.useState("");
  const [retry, setRetry] = React.useState(0);

  React.useEffect(() => {
    let active = true;
    setStatus("loading");
    void loadLedgerReport(selection).then((result) => {
      if (!active) return;
      const currencies = reportCurrencyOptions(result.comparison, result.balances);
      setData(result);
      setCurrencyId((current) => currencies.some(({ id }) => id === current)
        ? current
        : currencies[0]?.id ?? "");
      setStatus("loaded");
    }).catch(() => {
      if (active) setStatus("error");
    });
    return () => {
      active = false;
    };
  }, [selection, mutationEpoch, retry]);

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
  const currency = model ? {
    code: model.currencyCode,
    decimalPlaces: model.decimalPlaces,
  } : undefined;
  const drilldown = (target: ReportDrilldownTarget) => {
    onNavigate({ kind: "drilldown", target });
  };

  return (
    <section
      className="dashboard-ledger"
      aria-labelledby="dashboard-ledger-heading"
    >
      <header className="dashboard-ledger-header">
        <h2 id="dashboard-ledger-heading">
          <button
            type="button"
            disabled={status !== "loaded" || !model}
            onClick={() => {
              if (model) onNavigate({ kind: "report", selection, currencyId });
            }}
          >
            Ledger highlights
          </button>
        </h2>
        <div className="dashboard-ledger-controls">
          <div className="dashboard-ledger-period" role="group" aria-label="Ledger highlight period">
            <button
              type="button"
              aria-pressed={selection.period === "current_month"}
              disabled={status === "loading"}
              onClick={() => setSelection({ period: "current_month" })}
            >
              Current month
            </button>
            <button
              type="button"
              aria-pressed={selection.period === "previous_month"}
              disabled={status === "loading"}
              onClick={() => setSelection({ period: "previous_month" })}
            >
              Previous month
            </button>
          </div>
          <ReportCurrencyTabs
            currencies={currencies}
            selectedId={currencyId}
            onChange={setCurrencyId}
          />
        </div>
      </header>
      <div className="dashboard-ledger-grid" aria-busy={status === "loading"}>
        {status === "loading" ? (
          <>
            <LedgerSkeleton className="dashboard-ledger-skeleton-cash-flow" />
            <LedgerSkeleton className="dashboard-ledger-skeleton-category" />
            <LedgerSkeleton className="dashboard-ledger-skeleton-trend" />
          </>
        ) : status === "error" ? (
          <div className="dashboard-ledger-error">
            <p role="alert">Could not load Ledger highlights.</p>
            <button type="button" onClick={() => setRetry((current) => current + 1)}>
              Retry Ledger highlights
            </button>
          </div>
        ) : model ? (
          <>
            <CashFlow model={model} />
            <ExpenseCategoryDonut
              model={model}
              currency={currency}
              onDrilldown={drilldown}
            />
            <IncomeExpenseTrendChart
              model={model}
              currency={currency}
              onDrilldown={drilldown}
            />
          </>
        ) : (
          <p className="items-message">No Ledger currencies available.</p>
        )}
      </div>
    </section>
  );
}

function LedgerSkeleton({ className }: { className: string }) {
  return (
    <div
      className={`dashboard-ledger-skeleton ${className}`}
      data-testid="dashboard-ledger-skeleton"
      aria-hidden="true"
    >
      <span />
      <span />
      <span />
    </div>
  );
}

function CashFlow({ model }: { model: LedgerReportModel }) {
  const { incomeMinor, expenseMinor, averageDailyExpenseMinor } = model.metrics;
  const remainingMinor = incomeMinor - expenseMinor;
  const percent = incomeMinor > 0
    ? Math.round(expenseMinor / incomeMinor * 100)
    : null;
  const over = expenseMinor > incomeMinor;
  const ringStop = over ? 100 : percent ?? 0;
  const money = (value: number) => cashFlowMoney(
    value,
    model.decimalPlaces,
    model.currencyCode,
  );

  return (
    <section className="dashboard-ledger-cash-flow" aria-label="Cash Flow">
      <h2>Cash Flow</h2>
      {incomeMinor === 0 && expenseMinor === 0 ? (
        <p className="items-message">No income or spending for this period.</p>
      ) : (
        <>
          <div
            className={`dashboard-ledger-cash-flow-donut${over ? " is-over" : ""}`}
            role="img"
            aria-label={cashFlowAriaLabel(
              incomeMinor,
              expenseMinor,
              percent,
              money,
              remainingMinor,
              averageDailyExpenseMinor,
            )}
            style={{
              "--dashboard-ledger-ring-stop": `${ringStop}%`,
            } as React.CSSProperties}
          >
            <strong>
              {incomeMinor === 0
                ? "No income"
                : over
                  ? `Over ${percent! - 100}%`
                  : `${percent}%`}
            </strong>
          </div>
          <div className="dashboard-ledger-cash-flow-metrics">
            <CashFlowMetric label="Income" value={money(incomeMinor)} />
            <CashFlowMetric label="Spending" value={money(expenseMinor)} />
            <CashFlowMetric label="Remaining" value={money(remainingMinor)} />
            <CashFlowMetric
              label="Average daily spending"
              value={money(averageDailyExpenseMinor)}
            />
          </div>
        </>
      )}
    </section>
  );
}

function CashFlowMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="dashboard-ledger-cash-flow-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function cashFlowMoney(value: number, decimalPlaces: number, code: string): string {
  const [whole, fraction] = formatMinorUnits(value, decimalPlaces).split(".");
  const amount = `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${
    fraction === undefined ? "" : `.${fraction}`
  }`;
  return `${amount} ${code}`;
}

function cashFlowAriaLabel(
  incomeMinor: number,
  expenseMinor: number,
  percent: number | null,
  money: (value: number) => string,
  remainingMinor: number,
  averageDailyExpenseMinor: number,
): string {
  const spending = incomeMinor === 0
    ? `Spending ${money(expenseMinor)} with no income`
    : `Spending is ${percent}% of income`;
  return `Cash Flow. Income ${money(incomeMinor)}. ${spending}. Remaining ${
    money(remainingMinor)
  }. Average daily spending ${money(averageDailyExpenseMinor)}.`;
}
