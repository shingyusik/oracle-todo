import React from "react";

import type { DashboardDestination } from "@/features/dashboard/model/dashboard-navigation";
import type { DonutChartSpec } from "@/features/dashboard/model/dashboard-widgets";

type DashboardDonutChartProps = {
  chart: DonutChartSpec;
  onNavigate: (destination: DashboardDestination) => void;
};

type DonutStyle = React.CSSProperties & {
  "--dashboard-donut-completed-end": string;
  "--dashboard-donut-incomplete-end": string;
  "--dashboard-donut-missed-end": string;
};

export function DashboardDonutChart({
  chart,
  onNavigate,
}: DashboardDonutChartProps) {
  const completedEnd = chart.segments[0]?.percentage ?? 0;
  const incompleteEnd =
    completedEnd + (chart.segments[1]?.percentage ?? 0);
  const missedEnd =
    incompleteEnd + (chart.segments[2]?.percentage ?? 0);
  const style: DonutStyle = {
    "--dashboard-donut-completed-end": `${completedEnd}%`,
    "--dashboard-donut-incomplete-end": `${incompleteEnd}%`,
    "--dashboard-donut-missed-end": `${missedEnd}%`,
  };

  return (
    <div
      className="dashboard-chart dashboard-chart-donut"
      role="group"
      aria-label={chart.ariaLabel}
    >
      <div className="dashboard-donut-ring" style={style} aria-hidden="true">
        <span className="dashboard-donut-total">{chart.total}</span>
      </div>
      <div className="dashboard-chart-legend dashboard-donut-legend">
        {chart.segments.map((segment) => (
          <button
            key={segment.id}
            type="button"
            className={`dashboard-donut-segment tone-${segment.tone}`}
            aria-label={segment.ariaLabel}
            onClick={() => onNavigate(segment.destination)}
          >
            <span className="dashboard-chart-legend-swatch" aria-hidden="true" />
            <span className="dashboard-donut-segment-label">
              {segment.label}
            </span>
            <span className="dashboard-chart-value">{segment.value}</span>
            <span className="dashboard-donut-segment-percentage">
              {segment.percentage}%
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
