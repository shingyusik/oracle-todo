"use client";

import React, { useEffect, useRef, useState } from "react";

import type { LedgerController } from "@/features/ledger/hooks/useLedgerController";
import {
  buildLedgerReportModel,
  type ReportDrilldownTarget,
} from "@/features/ledger/model/ledger-reports";
import {
  AccountReportSection,
  ExpenseCategorySection,
  LedgerTrendChart,
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
  const [formError, setFormError] = useState<string | null>(null);
  const defaultReportRequested = useRef(false);
  const { state } = controller;
  const reportCurrencies = state.comparison?.currencies.map((currency) => ({
    id: currency.currencyId,
    code: currency.currencyCode,
  })) ?? [];
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
      state.accountBreakdown,
      state.trend,
      currencyId,
    )
    : null;
  const currency = state.currencies.find(({ id }) => id === currencyId);

  function runReports(selection: Parameters<LedgerController["runReports"]>[0]) {
    setFormError(null);
    void controller.runReports(selection).catch((cause) => {
      setFormError(cause instanceof Error ? cause.message : "Could not load reports");
    });
  }

  function retryReports() {
    setFormError(null);
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
      {(formError || state.reportError) && (
        <div className="items-message ledger-report-error">
          <p role="alert">{formError ?? state.reportError}</p>
          {state.reportError && (
            <button type="button" onClick={retryReports}>Retry reports</button>
          )}
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
            <ExpenseCategorySection
              model={model}
              currency={currency}
              onDrilldown={onDrilldown}
            />
            <AccountReportSection
              model={model}
              currency={currency}
              onDrilldown={onDrilldown}
            />
            <LedgerTrendChart model={model} currency={currency} />
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
