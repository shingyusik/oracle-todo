import React from "react";
import { ChartDonut, chartToneColors } from "@/lib/chart-ui";

import type { DashboardDestination } from "@/features/dashboard/model/dashboard-navigation";
import type { DonutChartSpec } from "@/features/dashboard/model/dashboard-widgets";

type DashboardDonutChartProps = {
  chart: DonutChartSpec;
  onNavigate: (destination: DashboardDestination) => void;
};

export function DashboardDonutChart({
  chart,
  onNavigate,
}: DashboardDonutChartProps) {
  return (
    <div
      className="dashboard-chart dashboard-chart-donut"
      role="group"
      aria-label={`${chart.ariaLabel}, total ${chart.total}`}
    >
      <div className="dashboard-donut-ring">
        <ChartDonut data={chart.segments.map((segment) => ({ ...segment,
          color: chartToneColors[segment.tone], description: segment.ariaLabel,
        }))} onSelect={(index) => onNavigate(chart.segments[index].destination)}
          center={<span className="dashboard-donut-total">{chart.total}</span>} />
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
              {Math.round(segment.percentage)}%
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
