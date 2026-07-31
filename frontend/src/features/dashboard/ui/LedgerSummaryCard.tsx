import React from "react";

import type {
  UnifiedDashboardModel,
} from "@/features/dashboard/model/dashboard-model";

export function LedgerSummaryCard({
  projection,
}: {
  projection: UnifiedDashboardModel["ledger"];
}) {
  return (
    <section className="dashboard-widget" aria-label="Cash Flow">
      <header className="dashboard-widget-header">
        <div className="dashboard-widget-heading">
          <h2>Cash Flow</h2>
          <p>Current-period totals. Detailed analysis is available in Reports.</p>
        </div>
      </header>
      {projection.status === "error" ? (
        <p className="dashboard-widget-empty">Ledger data unavailable</p>
      ) : projection.data.currencies.length === 0 ? (
        <p className="dashboard-widget-empty">No Ledger activity in this period.</p>
      ) : (
        <div className="dashboard-stat-grid">
          {projection.data.currencies.map((currency) => (
            <div
              className="dashboard-stat dashboard-stat-composite"
              key={currency.currencyCode}
            >
              <strong>{currency.currencyCode}</strong>
              <span>Income {currency.incomeMinor}</span>
              <span>Expense {currency.expenseMinor}</span>
              <span>Net {currency.netChangeMinor}</span>
              <span>{currency.unitLabel}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
