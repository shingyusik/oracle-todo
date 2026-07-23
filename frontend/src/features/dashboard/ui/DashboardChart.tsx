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
  const maximumValue = Math.max(
    1,
    ...chart.series.flatMap((series) =>
      series.points.map((point) => point.value),
    ),
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
          const points = chart.series.flatMap((series) => {
            const point = series.points[pointIndex];
            return point ? [{ point, series }] : [];
          });
          const total = points.reduce((sum, { point }) => sum + point.value, 0);
          const label = points[0]?.point.label ?? "";
          const projectProgress = projectProgressPercent(chart, pointIndex);

          return (
            <div
              className="dashboard-chart-category"
              key={`${label}-${pointIndex}`}
            >
              <span className="dashboard-chart-category-label">{label}</span>
              <div className="dashboard-chart-bars">
                {points.map(({ point, series }) => {
                  const style: ChartPointStyle = {
                    "--dashboard-point-scale": (point.value / maximumValue) * 100,
                    "--dashboard-point-stack":
                      total === 0 ? "0%" : `${(point.value / total) * 100}%`,
                  };
                  const accessibleLabel =
                    projectProgress !== null && series.id === "completed"
                      ? `${point.label}: ${projectProgress}% complete`
                      : `${point.label}: ${point.value} ${series.label.toLowerCase()}`;

                  return (
                    <button
                      key={point.id}
                      type="button"
                      className={`dashboard-chart-point tone-${series.tone}`}
                      style={style}
                      aria-label={accessibleLabel}
                      onClick={() => onNavigate(point.destination)}
                    >
                      <span className="dashboard-chart-value">{point.value}</span>
                      <span className="sr-only">
                        {point.label}, {series.label}
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

function projectProgressPercent(
  chart: DashboardChartSpec,
  pointIndex: number,
): number | null {
  if (
    chart.kind !== "stacked-bar" ||
    chart.series.length !== 2 ||
    chart.series[0]?.id !== "completed" ||
    chart.series[1]?.id !== "remaining"
  ) {
    return null;
  }

  const completed = chart.series[0].points[pointIndex]?.value ?? 0;
  const remaining = chart.series[1].points[pointIndex]?.value ?? 0;
  const total = completed + remaining;
  return total === 0 ? null : Math.round((completed / total) * 100);
}
