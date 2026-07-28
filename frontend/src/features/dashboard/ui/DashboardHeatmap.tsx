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
        <table className="dashboard-heatmap-grid">
          <thead>
            <tr className="dashboard-heatmap-header">
              <th scope="col">Name</th>
              {chart.columns.map((column) => (
                <th key={column.id} scope="col">
                  {column.label}
                </th>
              ))}
              {hasProgress ? <th scope="col">Progress</th> : null}
            </tr>
          </thead>
          <tbody>
            {chart.rows.map((row) => {
              const attentionLabel = projectAttentionLabel(row.attention);
              const rowLabel = attentionLabel
                ? `${row.label} · ${attentionLabel}`
                : row.label;

              return (
                <tr className="dashboard-heatmap-row" key={row.id}>
                  <th scope="row">
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
                  </th>
                  {row.cells.map((cell) => {
                    const column = chart.columns.find(
                      (candidate) => candidate.id === cell.columnId,
                    );
                    const style: HeatmapCellStyle = {
                      "--dashboard-heatmap-intensity":
                        cell.intensityPercent / 100,
                    };

                    return (
                      <td key={cell.id}>
                        <button
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
                      </td>
                    );
                  })}
                  {hasProgress ? (
                    <td>
                      <span className="dashboard-heatmap-progress">
                        {row.progressLabel ?? ""}
                      </span>
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
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
