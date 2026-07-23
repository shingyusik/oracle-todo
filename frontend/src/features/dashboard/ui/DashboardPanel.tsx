import React from "react";

import {
  buildDashboardSnapshot,
  dashboardToday,
} from "@/features/dashboard/model/dashboard-model";
import type { DashboardDestination } from "@/features/dashboard/model/dashboard-navigation";
import {
  dashboardWidgets,
  type DashboardWidgetModel,
} from "@/features/dashboard/model/dashboard-widgets";
import { DashboardChart } from "@/features/dashboard/ui/DashboardChart";
import type { WorkbenchController } from "@/features/workbench/model/workbench-model";

type DashboardPanelProps = {
  controller: WorkbenchController;
};

type DashboardWidgetProps = {
  model: DashboardWidgetModel;
  onNavigate: (destination: DashboardDestination) => void;
};

export function DashboardPanel({ controller }: DashboardPanelProps) {
  const { workspaceItems } = controller;

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

  if (workspaceItems.allItems.length === 0) {
    return (
      <section className="dashboard-state" aria-label="Dashboard analytics">
        <div className="dashboard-empty">
          <h1>Dashboard</h1>
          <p>Create an Area, Project, or work item to populate analytics.</p>
        </div>
      </section>
    );
  }

  const snapshot = buildDashboardSnapshot(
    workspaceItems.allItems,
    dashboardToday(),
  );

  return (
    <section className="dashboard-panel" aria-label="Dashboard analytics">
      <header className="dashboard-panel-header">
        <p className="dashboard-panel-kicker">Analytics</p>
        <h1>Dashboard</h1>
      </header>
      {dashboardWidgets.map((widget) => (
        <DashboardWidget
          key={widget.id}
          model={widget.build(snapshot)}
          onNavigate={controller.navigateDashboard}
        />
      ))}
    </section>
  );
}

function DashboardLoading() {
  return (
    <section
      className="dashboard-state dashboard-loading"
      role="status"
      aria-label="Loading Dashboard analytics"
    >
      <span className="sr-only">Loading Dashboard analytics.</span>
      {dashboardWidgets.map((widget) => (
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
    </section>
  );
}

function DashboardWidget({ model, onNavigate }: DashboardWidgetProps) {
  const chartHasData = model.chart?.series.some((series) =>
    series.points.some((point) => point.value > 0 || point.placeholder),
  );
  const widgetDestination = model.destination;

  return (
    <section
      className={`dashboard-widget dashboard-widget-${model.id}`}
      aria-label={model.title}
    >
      <header className="dashboard-widget-header">
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
      </header>
      {model.stats ? (
        <div className="dashboard-stat-grid">
          {model.stats.map((stat) => (
            <button
              type="button"
              className="dashboard-stat"
              aria-label={`${stat.label}: ${stat.value}`}
              onClick={() => onNavigate(stat.destination)}
              key={stat.label}
            >
              <span className="dashboard-stat-value">{stat.value}</span>
              <span className="dashboard-stat-label">{stat.label}</span>
            </button>
          ))}
        </div>
      ) : null}
      {model.chart && chartHasData ? (
        <DashboardChart chart={model.chart} onNavigate={onNavigate} />
      ) : null}
      {model.chart && !chartHasData ? (
        <p className="dashboard-widget-empty">{model.emptyMessage}</p>
      ) : null}
    </section>
  );
}
