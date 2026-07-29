import React from "react";

import type { DashboardDestination } from "@/features/dashboard/model/dashboard-navigation";
import type { HeatmapChartSpec } from "@/features/dashboard/model/dashboard-widgets";

export type DashboardHeatmapVisibility = {
  limit: number;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
};

type DashboardHeatmapProps = {
  chart: HeatmapChartSpec;
  onNavigate: (destination: DashboardDestination) => void;
  visibility?: DashboardHeatmapVisibility;
};

type HeatmapCellStyle = React.CSSProperties & {
  "--dashboard-heatmap-intensity": number;
};

export function DashboardHeatmap({
  chart,
  onNavigate,
  visibility,
}: DashboardHeatmapProps) {
  const hasProgress = chart.rows.some(
    (row) => row.progressLabel !== undefined,
  );
  const canExpand = visibility !== undefined
    && chart.rows.length > visibility.limit;
  const visibleRows = canExpand && !visibility.expanded
    ? chart.rows.slice(0, visibility.limit)
    : chart.rows;
  const expanded = visibility?.expanded ?? false;
  const limit = visibility?.limit ?? chart.rows.length;
  const onExpandedChange = visibility?.onExpandedChange;

  React.useEffect(() => {
    if (expanded && chart.rows.length <= limit) {
      onExpandedChange?.(false);
    }
  }, [chart.rows.length, expanded, limit, onExpandedChange]);

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
            {visibleRows.map((row) => {
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
      {canExpand ? (
        <footer className="dashboard-heatmap-footer">
          <button
            type="button"
            className="dashboard-heatmap-toggle"
            aria-expanded={visibility.expanded}
            aria-label={`${chart.ariaLabel} ${
              visibility.expanded ? "접기" : "전체 보기"
            }`}
            onClick={() => visibility.onExpandedChange(!visibility.expanded)}
          >
            {visibility.expanded
              ? "접기"
              : `전체 보기 (총 ${chart.rows.length}개)`}
          </button>
        </footer>
      ) : null}
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
