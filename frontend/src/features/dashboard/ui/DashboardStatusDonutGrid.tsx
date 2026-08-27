import React from "react";

import type { DashboardDestination } from "@/features/dashboard/model/dashboard-navigation";
import type { StatusChartSpec } from "@/features/dashboard/model/dashboard-widgets";

export type DashboardStatusVisibility = {
  limit: number;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
};

type DashboardStatusDonutGridProps = {
  chart: StatusChartSpec;
  onNavigate: (destination: DashboardDestination) => void;
  visibility?: DashboardStatusVisibility;
};

export function DashboardStatusDonutGrid({
  chart,
  onNavigate,
  visibility,
}: DashboardStatusDonutGridProps) {
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
      className="dashboard-chart dashboard-chart-status"
      role="group"
      aria-label={chart.ariaLabel}
    >
      <div className="dashboard-status-donut-grid">
        {visibleRows.map((row) => {
          const completed = statusValue(row, "completed");
          const incomplete = statusValue(row, "incomplete");
          const paused = statusValue(row, "paused");
          const missed = statusValue(row, "missed");
          const completedStop = statusPercentage(row, "completed");
          const incompleteStop = completedStop
            + statusPercentage(row, "incomplete");
          const pausedStop = incompleteStop + statusPercentage(row, "paused");
          const attention = row.attention ?? "normal";
          const attentionLabel = projectAttentionLabel(attention);
          const center = chart.scope === "project"
            ? row.progressPercent == null ? "—" : `${row.progressPercent}%`
            : row.total;
          const meta = chart.scope === "project"
            ? `${attentionLabel} / Miss ${missed} / Total ${row.total}`
            : `Completed ${Math.round(completedStop)}% / Total ${row.total}`;
          const ariaLabel = chart.scope === "project"
            ? `${row.label}: ${row.progressPercent == null ? "Progress —" : `Progress ${row.progressPercent}%`}, ${attentionLabel}, ${completed} completed, ${incomplete} incomplete, ${paused} paused, ${missed} miss`
            : `${row.label}: Total ${row.total}, ${completed} completed, ${incomplete} incomplete, ${paused} paused, ${missed} miss`;
          const style = {
            "--dashboard-status-completed-stop": `${completedStop}%`,
            "--dashboard-status-incomplete-stop": `${incompleteStop}%`,
            "--dashboard-status-paused-stop": `${pausedStop}%`,
          } as React.CSSProperties;

          return (
            <button
              type="button"
              className={`dashboard-status-tile attention-${attention}`}
              style={style}
              aria-label={ariaLabel}
              onClick={() => onNavigate(row.destination)}
              key={row.id}
            >
              <span className="dashboard-status-label">{row.label}</span>
              <span
                className={`dashboard-status-donut${row.total === 0 ? " is-empty" : ""}`}
                aria-hidden="true"
              >
                <span className="dashboard-status-donut-center">{center}</span>
              </span>
              <span className="dashboard-status-meta">{meta}</span>
            </button>
          );
        })}
      </div>
      {canExpand ? (
        <footer className="dashboard-status-footer">
          <button
            type="button"
            className="dashboard-status-toggle"
            aria-expanded={visibility.expanded}
            aria-label={`${chart.ariaLabel} ${visibility.expanded ? "접기" : "전체 보기"}`}
            onClick={() => visibility.onExpandedChange(!visibility.expanded)}
          >
            {visibility.expanded ? "접기" : `전체 보기 (총 ${chart.rows.length}개)`}
          </button>
        </footer>
      ) : null}
    </div>
  );
}

function statusValue(
  row: StatusChartSpec["rows"][number],
  id: StatusChartSpec["rows"][number]["segments"][number]["id"],
): number {
  return row.segments.find((segment) => segment.id === id)?.value ?? 0;
}

function statusPercentage(
  row: StatusChartSpec["rows"][number],
  id: StatusChartSpec["rows"][number]["segments"][number]["id"],
): number {
  return row.segments.find((segment) => segment.id === id)?.percentage ?? 0;
}

function projectAttentionLabel(
  attention: NonNullable<StatusChartSpec["rows"][number]["attention"]>,
): "Risk" | "Attention" | "Normal" {
  return attention === "risk"
    ? "Risk"
    : attention === "attention" ? "Attention" : "Normal";
}
