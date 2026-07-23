import React from "react";

import type { DashboardDestination } from "@/features/dashboard/model/dashboard-navigation";
import type { DashboardChartSpec } from "@/features/dashboard/model/dashboard-widgets";

type DashboardChartProps = {
  chart: DashboardChartSpec;
  onNavigate: (destination: DashboardDestination) => void;
};

type ChartPointStyle = React.CSSProperties & {
  "--dashboard-point-scale": number;
  "--dashboard-point-stack": string;
};

export function DashboardChart({
  chart,
  onNavigate,
}: DashboardChartProps) {
  const pointCount = Math.max(
    0,
    ...chart.series.map((series) => series.points.length),
  );

  return (
    <div
      className={`dashboard-chart dashboard-chart-${chart.kind}`}
      role="group"
      aria-label={chart.ariaLabel}
    >
      <div className="dashboard-chart-legend" aria-hidden="true">
        {chart.series.map((series) => (
          <span
            className={`dashboard-chart-legend-item tone-${series.tone}`}
            key={series.id}
          >
            <span className="dashboard-chart-legend-swatch" aria-hidden="true" />
            {series.label}
          </span>
        ))}
      </div>
      <div className="dashboard-chart-plot">
        {Array.from({ length: pointCount }, (_, pointIndex) => {
          const label =
            chart.series.find((series) => series.points[pointIndex])
              ?.points[pointIndex]?.label ?? "";

          return (
            <div
              className="dashboard-chart-category"
              key={`${label}-${pointIndex}`}
            >
              <span className="dashboard-chart-category-label">{label}</span>
              <div className="dashboard-chart-bars">
                {chart.series.map((series) => {
                  const point = series.points[pointIndex];
                  if (!point) {
                    return null;
                  }

                  const style: ChartPointStyle = {
                    "--dashboard-point-scale": point.sizePercent,
                    "--dashboard-point-stack": `${point.sizePercent}%`,
                  };

                  return (
                    <button
                      key={point.id}
                      type="button"
                      className={`dashboard-chart-point tone-${series.tone}`}
                      style={style}
                      aria-label={point.ariaLabel}
                      onClick={() => onNavigate(point.destination)}
                    >
                      <span className="dashboard-chart-value">
                        {point.displayValue}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
