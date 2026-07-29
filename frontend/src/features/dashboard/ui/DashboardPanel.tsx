import React from "react";

import {
  buildDashboardSnapshot,
  completionRangeEndingOn,
  dashboardDateRangeError,
  dashboardToday,
  type DashboardDateRange,
} from "@/features/dashboard/model/dashboard-model";
import type { DashboardDestination } from "@/features/dashboard/model/dashboard-navigation";
import {
  dashboardWidgets,
  type DashboardChartSpec,
  type DashboardLinkedStat,
  type DashboardStatModel,
  type DashboardWidgetModel,
} from "@/features/dashboard/model/dashboard-widgets";
import { DashboardChart } from "@/features/dashboard/ui/DashboardChart";
import { CompletionRangeControls } from "@/features/dashboard/ui/CompletionRangeControls";
import type { DashboardHeatmapVisibility } from "@/features/dashboard/ui/DashboardHeatmap";
import type { WorkbenchController } from "@/features/workbench/model/workbench-model";

const DASHBOARD_STATUS_PREVIEW_LIMIT = 5;

type DashboardPanelProps = {
  controller: WorkbenchController;
};

type DashboardStatusWidgetId = "area-status" | "project-status";

type DashboardStatusWidgetModel = DashboardWidgetModel & {
  id: DashboardStatusWidgetId;
};

type DashboardWidgetProps = {
  model: DashboardWidgetModel;
  onNavigate: (destination: DashboardDestination) => void;
  headerControls?: React.ReactNode;
  heatmapVisibility?: DashboardHeatmapVisibility;
};

export function DashboardPanel({ controller }: DashboardPanelProps) {
  const { workspaceItems } = controller;
  const today = dashboardToday();
  const [selectedPreset, setSelectedPreset] =
    React.useState<7 | 14 | 30 | "custom">(14);
  const [appliedRange, setAppliedRange] = React.useState<DashboardDateRange>(
    () => completionRangeEndingOn(today, 14),
  );
  const [draftRange, setDraftRange] = React.useState(appliedRange);
  const [rangeError, setRangeError] = React.useState<string | null>(null);
  const [expandedStatus, setExpandedStatus] = React.useState<
    Record<DashboardStatusWidgetId, boolean>
  >({ "area-status": false, "project-status": false });

  const applyPreset = (preset: 7 | 14 | 30) => {
    const next = completionRangeEndingOn(today, preset);
    setSelectedPreset(preset);
    setAppliedRange(next);
    setDraftRange(next);
    setRangeError(null);
  };

  const applyCustom = () => {
    const validationError = dashboardDateRangeError(draftRange);
    if (validationError !== null) {
      setRangeError(
        validationError === "too-long"
          ? "Completion range must be 366 days or fewer."
          : "Start date must be on or before end date.",
      );
      return;
    }
    setSelectedPreset("custom");
    setAppliedRange(draftRange);
    setRangeError(null);
  };

  const snapshot = workspaceItems.status === "loaded"
    ? buildDashboardSnapshot(
      workspaceItems.allItems,
      today,
      appliedRange,
    )
    : null;
  const models = snapshot === null
    ? []
    : dashboardWidgets.map((widget) => widget.build(snapshot));
  const primaryModels = models.filter(
    (model) => !isDashboardStatusWidget(model),
  );
  const statusModels = models.filter(isDashboardStatusWidget);
  const areaStatusRowCount = dashboardStatusRowCount(
    statusModels,
    "area-status",
  );
  const projectStatusRowCount = dashboardStatusRowCount(
    statusModels,
    "project-status",
  );

  React.useEffect(() => {
    if (workspaceItems.status !== "loaded") return;

    setExpandedStatus((current) => {
      const collapseArea = areaStatusRowCount !== null
        && areaStatusRowCount <= DASHBOARD_STATUS_PREVIEW_LIMIT
        && current["area-status"];
      const collapseProject = projectStatusRowCount !== null
        && projectStatusRowCount <= DASHBOARD_STATUS_PREVIEW_LIMIT
        && current["project-status"];
      if (!collapseArea && !collapseProject) return current;

      return {
        ...current,
        "area-status": collapseArea ? false : current["area-status"],
        "project-status": collapseProject ? false : current["project-status"],
      };
    });
  }, [areaStatusRowCount, projectStatusRowCount, workspaceItems.status]);

  if (workspaceItems.status === "idle" || workspaceItems.status === "loading") {
    return <DashboardLoading />;
  }

  if (workspaceItems.status === "error") {
    return (
      <section className="dashboard-state" aria-label="Dashboard analytics">
        <div className="dashboard-error" role="alert">
          <h1>Dashboard</h1>
          <p>Could not load Dashboard analytics.</p>
          <button type="button" onClick={controller.reloadDashboard}>
            Retry Dashboard
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="dashboard-panel" aria-label="Dashboard analytics">
      <header className="dashboard-panel-header">
        <p className="dashboard-panel-kicker">Analytics</p>
        <h1>Dashboard</h1>
      </header>
      {primaryModels.map((model) => {
        return (
          <DashboardWidget
            key={model.id}
            model={model}
            onNavigate={controller.navigateDashboard}
            headerControls={
              model.id === "completion-history" ? (
                <CompletionRangeControls
                  today={today}
                  appliedRange={appliedRange}
                  draftRange={draftRange}
                  selectedPreset={selectedPreset}
                  error={rangeError}
                  onPresetSelect={applyPreset}
                  onDraftChange={(field, value) =>
                    setDraftRange((current) => ({
                      ...current,
                      [field]: value,
                    }))}
                  onCustomApply={applyCustom}
                />
              ) : undefined
            }
          />
        );
      })}
      <div className="dashboard-status-grid">
        {statusModels.map((model) => (
          <DashboardWidget
            key={model.id}
            model={model}
            onNavigate={controller.navigateDashboard}
            heatmapVisibility={{
              limit: DASHBOARD_STATUS_PREVIEW_LIMIT,
              expanded: expandedStatus[model.id],
              onExpandedChange: (expanded) =>
                setExpandedStatus((current) => ({
                  ...current,
                  [model.id]: expanded,
                })),
            }}
          />
        ))}
      </div>
    </section>
  );
}

function isDashboardStatusWidget(
  model: DashboardWidgetModel,
): model is DashboardStatusWidgetModel {
  return model.id === "area-status" || model.id === "project-status";
}

function dashboardStatusRowCount(
  models: DashboardStatusWidgetModel[],
  id: DashboardStatusWidgetId,
): number | null {
  const chart = models.find((model) => model.id === id)?.chart;
  return chart?.kind === "heatmap" ? chart.rows.length : null;
}

function DashboardLoading() {
  return (
    <section
      className="dashboard-state dashboard-loading"
      role="status"
      aria-label="Loading Dashboard analytics"
    >
      <span className="sr-only">Loading Dashboard analytics.</span>
      {dashboardWidgets
        .filter(
          (widget) =>
            widget.id !== "area-status" && widget.id !== "project-status",
        )
        .map((widget) => (
          <div
            className={`dashboard-skeleton-card dashboard-skeleton-${widget.id}`}
            data-testid="dashboard-skeleton-card"
            aria-hidden="true"
            key={widget.id}
          >
            <span />
            <span />
            <span />
          </div>
        ))}
      <div className="dashboard-status-skeleton-grid">
        {dashboardWidgets
          .filter(
            (widget) =>
              widget.id === "area-status" || widget.id === "project-status",
          )
          .map((widget) => (
            <div
              className={`dashboard-skeleton-card dashboard-skeleton-${widget.id}`}
              data-testid="dashboard-skeleton-card"
              aria-hidden="true"
              key={widget.id}
            >
              <span />
              <span />
              <span />
            </div>
          ))}
      </div>
    </section>
  );
}

function DashboardWidget({
  model,
  onNavigate,
  headerControls,
  heatmapVisibility,
}: DashboardWidgetProps) {
  const chartHasData = model.chart && shouldRenderChart(model.chart);
  const chartIsEmpty = model.chart && isEmptyChart(model.chart);
  const widgetDestination = model.destination;

  return (
    <section
      className={`dashboard-widget dashboard-widget-${model.id}`}
      aria-label={model.title}
    >
      <header className="dashboard-widget-header">
        <div className="dashboard-widget-heading">
          <h2>
            {widgetDestination ? (
              <button
                type="button"
                onClick={() => onNavigate(widgetDestination)}
              >
                {model.title}
              </button>
            ) : (
              model.title
            )}
          </h2>
          <p>{model.description}</p>
        </div>
        {headerControls}
      </header>
      {model.stats ? (
        <div className="dashboard-stat-grid">
          {model.stats.map((stat) => (
            <DashboardStat
              key={stat.label}
              stat={stat}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      ) : null}
      {model.chart && chartHasData ? (
        <DashboardChart
          chart={model.chart}
          onNavigate={onNavigate}
          heatmapVisibility={heatmapVisibility}
        />
      ) : null}
      {model.chart && chartIsEmpty ? (
        <p className="dashboard-widget-empty">{model.emptyMessage}</p>
      ) : null}
    </section>
  );
}

function shouldRenderChart(chart: DashboardChartSpec): boolean {
  switch (chart.kind) {
    case "donut":
      return chart.total > 0;
    case "line":
      return true;
    case "heatmap":
      return chart.rows.length > 0;
  }
}

function isEmptyChart(chart: DashboardChartSpec): boolean {
  switch (chart.kind) {
    case "donut":
      return chart.total === 0;
    case "line":
      return chart.points.every((point) => point.value === 0);
    case "heatmap":
      return chart.rows.length === 0;
  }
}

function DashboardStat({
  stat,
  onNavigate,
}: {
  stat: DashboardStatModel;
  onNavigate: (destination: DashboardDestination) => void;
}) {
  if (stat.kind === "linked") {
    return <DashboardStatLink stat={stat} onNavigate={onNavigate} />;
  }

  return (
    <div
      className="dashboard-stat dashboard-stat-composite"
      role="group"
      aria-label={`${stat.label}: ${stat.value} total`}
    >
      <div className="dashboard-stat-primary">
        <span className="dashboard-stat-value">{stat.value}</span>
        <span className="dashboard-stat-label">{stat.label}</span>
      </div>
      <div className="dashboard-stat-actions">
        {stat.items.map((item) => (
          <button
            type="button"
            className="dashboard-stat-action"
            aria-label={`${item.label}: ${item.value}`}
            onClick={() => onNavigate(item.destination)}
            key={item.label}
          >
            <span className="dashboard-stat-action-value">{item.value}</span>
            <span className="dashboard-stat-action-label">{item.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function DashboardStatLink({
  stat,
  onNavigate,
}: {
  stat: DashboardLinkedStat;
  onNavigate: (destination: DashboardDestination) => void;
}) {
  return (
    <button
      type="button"
      className="dashboard-stat"
      aria-label={`${stat.label}: ${stat.value}`}
      onClick={() => onNavigate(stat.destination)}
    >
      <span className="dashboard-stat-value">{stat.value}</span>
      <span className="dashboard-stat-label">{stat.label}</span>
    </button>
  );
}
