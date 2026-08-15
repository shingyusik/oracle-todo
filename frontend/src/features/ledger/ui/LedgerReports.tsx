"use client";

import React, { useEffect, useRef, useState } from "react";

import type { LedgerController } from "@/features/ledger/hooks/useLedgerController";
import { formatMoney } from "@/features/ledger/ui/ledger-ui";

export function LedgerReports({ controller }: { controller: LedgerController }) {
  const [range, setRange] = useState({ from: "", to: "" });
  const [formError, setFormError] = useState<string | null>(null);
  const defaultReportRequested = useRef(false);
  const { state } = controller;
  const currencies = new Map(
    state.currencies.map((currency) => [currency.id, currency]),
  );
  const money = (value: number, currencyId: string, currencyCode: string) =>
    formatMoney(value, currencies.get(currencyId), currencyCode);

  useEffect(() => {
    if (defaultReportRequested.current || state.reportStatus !== "idle") return;
    defaultReportRequested.current = true;
    void controller.runReports({ period: "current_month" }).catch(() => undefined);
  }, [controller, state.reportStatus]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    try {
      await controller.runReports({ period: "custom", ...range });
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : "Could not load reports");
    }
  }

  function retryReports() {
    setFormError(null);
    void controller.retryReports().catch(() => undefined);
  }

  return (
    <section aria-labelledby="ledger-reports-heading">
      <header className="workspace-table-header">
        <h1 id="ledger-reports-heading">Reports</h1>
      </header>
      <form aria-label="Ledger report range" onSubmit={submit}>
        <label className="field-label">
          From
          <input
            type="date"
            required
            value={range.from}
            onChange={(event) =>
              setRange((current) => ({ ...current, from: event.target.value }))}
          />
        </label>
        <label className="field-label">
          To
          <input
            type="date"
            required
            value={range.to}
            onChange={(event) =>
              setRange((current) => ({ ...current, to: event.target.value }))}
          />
        </label>
        <button type="submit" disabled={state.reportStatus === "loading"}>
          {state.reportStatus === "loading" ? "Running…" : "Run reports"}
        </button>
      </form>
      {(formError || state.reportError) && (
        <div className="items-message">
          <p role="alert">{formError ?? state.reportError}</p>
          {state.reportError && (
            <button
              type="button"
              onClick={retryReports}
            >
              Retry reports
            </button>
          )}
        </div>
      )}
      {state.reportStatus === "idle" && (
        <p className="items-message">Choose a date range to view reports.</p>
      )}
      {state.summary && (
        <>
          <ReportTable
            heading="Summary"
            rows={state.summary.currencies.map((row) => ({
              key: row.currencyId,
              name: row.currencyCode,
              income: money(row.incomeMinor, row.currencyId, row.currencyCode),
              expense: money(row.expenseMinor, row.currencyId, row.currencyCode),
              net: money(row.netChangeMinor, row.currencyId, row.currencyCode),
            }))}
          />
          <ReportTable
            heading="By account"
            rows={state.accountBreakdown.map((row) => ({
              key: `${row.currencyId}-${row.referenceId ?? row.name}`,
              name: row.name,
              income: money(row.incomeMinor, row.currencyId, row.currencyCode),
              expense: money(row.expenseMinor, row.currencyId, row.currencyCode),
              net: money(row.netChangeMinor, row.currencyId, row.currencyCode),
            }))}
          />
          <ReportTable
            heading="By category"
            rows={state.categoryBreakdown.map((row) => ({
              key: `${row.currencyId}-${row.referenceId ?? row.name}`,
              name: row.name,
              income: money(row.incomeMinor, row.currencyId, row.currencyCode),
              expense: money(row.expenseMinor, row.currencyId, row.currencyCode),
              net: money(row.netChangeMinor, row.currencyId, row.currencyCode),
            }))}
          />
        </>
      )}
    </section>
  );
}

type ReportRow = {
  key: string;
  name: string;
  income: string;
  expense: string;
  net: string;
};

function ReportTable({ heading, rows }: { heading: string; rows: ReportRow[] }) {
  return (
    <section aria-labelledby={`report-${heading.replaceAll(" ", "-")}`}>
      <h2 id={`report-${heading.replaceAll(" ", "-")}`}>{heading}</h2>
      {rows.length === 0 ? (
        <p className="items-message">No report data for this range.</p>
      ) : (
        <div className="items-section">
          <table className="items-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Income</th>
                <th>Expense</th>
                <th>Net</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key}>
                  <td>{row.name}</td>
                  <td>{row.income}</td>
                  <td>{row.expense}</td>
                  <td>{row.net}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
