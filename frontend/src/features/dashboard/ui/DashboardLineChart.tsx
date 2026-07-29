import React from "react";

import type { LineChartSpec } from "@/features/dashboard/model/dashboard-widgets";

type DashboardLineChartProps = {
  chart: LineChartSpec;
};

export function DashboardLineChart({ chart }: DashboardLineChartProps) {
  const maximum = Math.max(
    1,
    ...chart.points.map((point) => point.value),
  );
  const coordinates = chart.points.map((point, index) => ({
    ...point,
    x:
      chart.points.length === 1
        ? 50
        : (index / (chart.points.length - 1)) * 100,
    y: 94 - (point.value / maximum) * 84,
  }));

  return (
    <div
      className="dashboard-chart dashboard-chart-line"
      role="group"
      aria-label={chart.ariaLabel}
    >
      <div className="dashboard-line-plot">
        <svg
          className="dashboard-line-svg"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <polyline
            className="dashboard-line-path"
            points={coordinates
              .map((point) => `${point.x},${point.y}`)
              .join(" ")}
          />
        </svg>
        {coordinates.map((point) => (
          <span
            key={point.id}
            className="dashboard-line-point"
            role="img"
            tabIndex={0}
            aria-label={point.ariaLabel}
            style={{ left: `${point.x}%`, top: `${point.y}%` }}
          >
            <span className="dashboard-line-marker" aria-hidden="true" />
            <span className="dashboard-line-tooltip">
              {point.ariaLabel}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
