import React from "react";

import type {
  UnifiedDashboardModel,
} from "@/features/dashboard/model/dashboard-model";

export function HealthSummaryCard({
  projection,
}: {
  projection: UnifiedDashboardModel["health"];
}) {
  return (
    <section className="dashboard-widget" aria-label="Health Journal summary">
      <header className="dashboard-widget-header">
        <div className="dashboard-widget-heading">
          <h2>Health Journal</h2>
          <p>Latest recorded values. Detailed analysis is available in Trends.</p>
        </div>
      </header>
      {projection.status === "error" ? (
        <p className="dashboard-widget-empty">Health data unavailable</p>
      ) : projection.data.metrics.length === 0
        && projection.data.recentDietTags.length === 0 ? (
          <p className="dashboard-widget-empty">No recent Health Journal data.</p>
        ) : (
          <>
            <div className="dashboard-stat-grid">
              {projection.data.metrics.map((metric) => (
                <div
                  className="dashboard-stat dashboard-stat-composite"
                  key={`${metric.name}-${metric.timestamp}`}
                >
                  <strong>{metric.name}</strong>
                  <span>{metric.displayValue}</span>
                  <span>{metric.unitLabel}</span>
                </div>
              ))}
            </div>
            {projection.data.recentDietTags.length > 0 ? (
              <p>Recent diet tags: {projection.data.recentDietTags.join(", ")}</p>
            ) : null}
          </>
        )}
    </section>
  );
}
