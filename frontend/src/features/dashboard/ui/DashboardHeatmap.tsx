import React from "react";

import type { DashboardDestination } from "@/features/dashboard/model/dashboard-navigation";
import type { HeatmapChartSpec } from "@/features/dashboard/model/dashboard-widgets";

type DashboardHeatmapProps = {
  chart: HeatmapChartSpec;
  onNavigate: (destination: DashboardDestination) => void;
};

type HeatmapCellStyle = React.CSSProperties & {
  "--dashboard-heatmap-intensity": number;
};

export function DashboardHeatmap({
  chart,
  onNavigate,
}: DashboardHeatmapProps) {
  const hasProgress = chart.rows.some(
    (row) => row.progressLabel !== undefined,
  );

  return (
    <div
      className="dashboard-chart dashboard-chart-heatmap"
      role="group"
      aria-label={chart.ariaLabel}
    >
      <div className="dashboard-heatmap-scroll">
        <div className="dashboard-heatmap-grid" role="table">
          <div className="dashboard-heatmap-header" role="row">
            <span role="columnheader">Name</span>
            {chart.columns.map((column) => (
              <span key={column.id} role="columnheader">
                {column.label}
              </span>
            ))}
            {hasProgress ? <span role="columnheader">Progress</span> : null}
          </div>
          {chart.rows.map((row) => {
            const attentionLabel = projectAttentionLabel(row.attention);
            const rowLabel = attentionLabel
              ? `${row.label} · ${attentionLabel}`
              : row.label;

            return (
              <div className="dashboard-heatmap-row" role="row" key={row.id}>
                <button
                  type="button"
                  className="dashboard-heatmap-row-label"
                  aria-label={rowLabel}
                  onClick={() => onNavigate(row.destination)}
                >
                  <span>{row.label}</span>
                  {attentionLabel ? (
                    <span className="dashboard-project-attention">
                      {attentionLabel}
                    </span>
                  ) : null}
                </button>
                {row.cells.map((cell) => {
                  const column = chart.columns.find(
                    (candidate) => candidate.id === cell.columnId,
                  );
                  const style: HeatmapCellStyle = {
                    "--dashboard-heatmap-intensity":
                      cell.intensityPercent / 100,
                  };

                  return (
                    <button
                      key={cell.id}
                      type="button"
                      className={`dashboard-heatmap-cell tone-${column?.tone ?? "primary"}`}
                      style={style}
                      aria-label={cell.ariaLabel}
                      onClick={() => onNavigate(row.destination)}
                    >
                      <span className="dashboard-chart-value">
                        {cell.value}
                      </span>
                    </button>
                  );
                })}
                {hasProgress ? (
                  <span className="dashboard-heatmap-progress">
                    {row.progressLabel ?? ""}
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function projectAttentionLabel(
  attention: HeatmapChartSpec["rows"][number]["attention"],
): "Risk" | "Attention" | null {
  if (attention === "risk") return "Risk";
  if (attention === "attention") return "Attention";
  return null;
}
