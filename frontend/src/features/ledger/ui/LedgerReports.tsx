"use client";

import React, { useEffect, useRef, useState } from "react";

import type { LedgerController } from "@/features/ledger/hooks/useLedgerController";
import {
  buildLedgerReportModel,
  reportCurrencyOptions,
  type ReportDrilldownTarget,
} from "@/features/ledger/model/ledger-reports";
import {
  AccountBalanceDonuts,
  ExpenseCategoryDonut,
  IncomeExpenseTrendChart,
  ReportCurrencyTabs,
  ReportPeriodControls,
  ReportSummaryCards,
} from "@/features/ledger/ui/LedgerReportCharts";

export function LedgerReports({
  controller,
  onDrilldown,
}: {
  controller: LedgerController;
  onDrilldown?: (target: ReportDrilldownTarget) => void;
}) {
  const defaultReportRequested = useRef(false);
  const { state } = controller;
  const reportCurrencies = reportCurrencyOptions(state.comparison, state.balances);
  const [currencyId, setCurrencyId] = useState(reportCurrencies[0]?.id ?? "");

  useEffect(() => {
    if (defaultReportRequested.current || state.reportStatus !== "idle") return;
    defaultReportRequested.current = true;
    void controller.runReports({ period: "current_month" }).catch(() => undefined);
  }, [controller, state.reportStatus]);

  useEffect(() => {
    if (!reportCurrencies.some(({ id }) => id === currencyId)) {
      setCurrencyId(reportCurrencies[0]?.id ?? "");
    }
  }, [currencyId, reportCurrencies]);

  const model = state.comparison && state.trend
    ? buildLedgerReportModel(
      state.comparison,
      state.categoryBreakdown,
      state.balances,
      state.trend,
      currencyId,
    )
    : null;
  const currency = model ? {
    code: model.currencyCode,
    decimalPlaces: model.decimalPlaces,
  } : undefined;

  function runReports(selection: Parameters<LedgerController["runReports"]>[0]) {
    void controller.runReports(selection).catch(() => undefined);
  }

  function retryReports() {
    void controller.retryReports().catch(() => undefined);
  }

  return (
    <section className="ledger-reports" aria-labelledby="ledger-reports-heading">
      <header className="workspace-table-header">
        <h1 id="ledger-reports-heading">Reports</h1>
      </header>
      <ReportPeriodControls
        selection={state.reportSelection}
        disabled={state.reportStatus === "loading"}
        onChange={runReports}
      />
      <ReportCurrencyTabs
        currencies={reportCurrencies}
        selectedId={currencyId}
        onChange={setCurrencyId}
      />
      {state.reportError && (
        <div className="items-message ledger-report-error">
          <p role="alert">{state.reportError}</p>
          <button type="button" onClick={retryReports}>Retry reports</button>
        </div>
      )}
      <div
        className="ledger-report-analysis"
        role="region"
        aria-label="Report analysis"
        aria-busy={state.reportStatus === "loading"}
      >
        {model ? (
          <>
            <ReportSummaryCards model={model} currency={currency} />
            <AccountBalanceDonuts
              model={model}
              currency={currency}
              onDrilldown={onDrilldown}
            />
            <IncomeExpenseTrendChart
              model={model}
              currency={currency}
              onDrilldown={onDrilldown}
            />
            <ExpenseCategoryDonut
              model={model}
              currency={currency}
              onDrilldown={onDrilldown}
            />
          </>
        ) : state.reportStatus === "idle" ? (
          <p className="items-message">Choose a report period to view analysis.</p>
        ) : state.reportStatus === "loading" ? (
          <p role="status" className="items-message">Loading reports…</p>
        ) : null}
      </div>
    </section>
  );
}
