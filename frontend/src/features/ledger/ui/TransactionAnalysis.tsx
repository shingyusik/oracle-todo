"use client";

import React from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { ledgerApi } from "@/features/ledger/api/ledger-api";
import { buildTransactionAnalysis, type TransactionAnalysisBucket } from "@/features/ledger/model/ledger-analysis";
import { formatMoney, safeLedgerErrorMessage } from "@/features/ledger/ui/ledger-ui";
import type { PlannerTableSettings } from "@/features/workbench/model/planner-model";
import { localCalendarDate } from "@/features/workbench/model/planner-model";
import { ChartDonut, ChartTooltip, useChartAnimation } from "@/lib/chart-ui";

const colors = ["var(--color-chart-primary)", "var(--color-chart-secondary)", "var(--color-chart-warning)"];

export function TransactionAnalysis({ settings, generation, onClose }: {
  settings: PlannerTableSettings; generation: number; onClose(): void;
}) {
  const [result, setResult] = React.useState<{ key: string; buckets: TransactionAnalysisBucket[] } | null>(null);
  const [failure, setFailure] = React.useState<{ key: string; message: string } | null>(null);
  const [retry, setRetry] = React.useState(0);
  const [currencyId, setCurrencyId] = React.useState("");
  const anchor = React.useRef<HTMLDivElement>(null);
  const animate = useChartAnimation();
  const snapshot = JSON.stringify(settings);
  const referenceDate = localCalendarDate(new Date());
  const key = JSON.stringify([snapshot, generation, referenceDate, retry]);
  React.useEffect(() => {
    let active = true;
    void ledgerApi.analyzeTable(JSON.parse(snapshot)).then((buckets) => {
      for (const id of new Set(buckets.map((bucket) => bucket.currencyId))) buildTransactionAnalysis(buckets, id);
      if (active) setResult({ key, buckets });
    }).catch((error: unknown) => {
      if (active) setFailure({ key, message: safeLedgerErrorMessage(error, "Could not load transaction analysis.") });
    });
    return () => { active = false; };
  }, [key, snapshot]);

  const buckets = result?.key === key ? result.buckets : null;
  const currencies = [...new Map((buckets ?? []).map((row) => [row.currencyId, {
    id: row.currencyId, code: row.currencyCode, decimalPlaces: row.decimalPlaces,
  }])).values()];
  const currency = currencies.find((item) => item.id === currencyId) ?? currencies[0];
  const model = currency && buckets ? buildTransactionAnalysis(buckets, currency.id) : null;
  const money = (value: number) => formatMoney(value, currency);
  return (
    <section id="transaction-analysis" className="ledger-transaction-analysis ledger-report-section" aria-label="Transaction analysis">
      <header className="ledger-report-section-heading">
        <div><h2>Transaction analysis</h2><p>All transactions matching this view. Transfers count once and are excluded from income and spending.</p></div>
        <button type="button" className="items-toolbar-button" onClick={onClose} aria-label="Close transaction analysis">Close</button>
      </header>
      {failure?.key === key ? <div className="items-message"><p role="alert">{failure.message}</p>
        <button type="button" onClick={() => setRetry((value) => value + 1)}>Retry analysis</button></div>
        : !buckets ? <p role="status">Loading analysis…</p>
        : !model ? <p className="items-message">No transactions match this view.</p>
        : <>
          <div className="ledger-report-currencies" role="group" aria-label="Analysis currency">
            {currencies.map((item) => <button key={item.id} type="button" aria-pressed={item.id === currency.id}
              onClick={() => setCurrencyId(item.id)}>{item.code}</button>)}
          </div>
          <div className="ledger-report-summary">
            {[["Spending", money(model.spending)], ["Income", money(model.income)],
              ["Net income", money(model.income - model.spending)], ["Transactions", model.count.toLocaleString()],
              ["Average monthly spending", money(model.averageMonthlySpending)]].map(([label, value]) =>
              <div key={label} className="ledger-report-card" role="group" aria-label={label}><span>{label}</span><strong>{value}</strong></div>)}
          </div>
          <p className="items-message">Monthly average covers {model.months.length} calendar months from {model.months[0].month} to {model.months[model.months.length - 1].month}, including months with no matching transactions.</p>
          <section className="ledger-report-section" aria-label="Monthly filtered cash flow">
            <h3>Monthly income and spending</h3>
            <div className="ledger-analysis-chart" ref={anchor}>
              <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 600, height: 260 }}>
                <BarChart data={model.months} accessibilityLayer>
                  <CartesianGrid vertical={false} stroke="var(--color-hairline-light)" />
                  <XAxis dataKey="month" /><YAxis tickFormatter={(value: number) => (value / 10 ** currency.decimalPlaces).toLocaleString()} />
                  <ChartTooltip anchor={anchor} formatter={(value) => money(Number(value))} />
                  <Bar dataKey="income" name="Income" fill={colors[0]} isAnimationActive={animate} />
                  <Bar dataKey="spending" name="Spending" fill={colors[1]} isAnimationActive={animate} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <details><summary>Monthly values</summary><table className="ledger-analysis-values"><thead><tr><th scope="col">Month</th><th scope="col">Income</th><th scope="col">Spending</th></tr></thead>
              <tbody>{model.months.map((month) => <tr key={month.month}><th scope="row">{month.month}</th><td>{money(month.income)}</td><td>{money(month.spending)}</td></tr>)}</tbody></table></details>
          </section>
          <section className="ledger-report-section" aria-label="Filtered spending by category">
            <h3>Spending by category</h3>
            {model.categories.length ? <div className="ledger-report-donut-panel">
              <div className="ledger-report-donut" role="img" aria-label={`Spending by category, total ${money(model.spending)}`}>
                <ChartDonut data={model.categories.map((category, index) => ({ label: category.label, value: category.value,
                  color: colors[index % colors.length], description: money(category.value) }))} center={<strong>{money(model.spending)}</strong>} />
              </div>
              <div className="ledger-report-donut-legend">{model.categories.map((category) => <div key={category.id}>
                <span>{category.label} · {(category.value / model.spending * 100).toFixed(1)}%</span><span>{money(category.value)}</span>
              </div>)}</div>
            </div> : <p className="items-message">No spending matches this view.</p>}
          </section>
        </>}
    </section>
  );
}
