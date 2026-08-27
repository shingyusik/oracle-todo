import React from "react";

import type { DashboardDestination } from "@/features/dashboard/model/dashboard-navigation";
import type {
  DashboardWidgetModel,
  StatusChartSpec,
} from "@/features/dashboard/model/dashboard-widgets";
import {
  DashboardStatusDonutGrid,
  type DashboardStatusVisibility,
} from "@/features/dashboard/ui/DashboardStatusDonutGrid";

type StatusScope = "project" | "area";

type StatusWidgetModel = DashboardWidgetModel & {
  id: "project-status" | "area-status";
  chart: StatusChartSpec;
};

type DashboardStatusCardProps = {
  models: Record<StatusScope, StatusWidgetModel>;
  onNavigate: (destination: DashboardDestination) => void;
  visibility: Record<StatusScope, DashboardStatusVisibility>;
};

const scopes: StatusScope[] = ["project", "area"];

export function DashboardStatusCard({
  models,
  onNavigate,
  visibility,
}: DashboardStatusCardProps) {
  const [scope, setScope] = React.useState<StatusScope>("project");
  const tabRefs = React.useRef<Record<StatusScope, HTMLButtonElement | null>>({
    project: null,
    area: null,
  });
  const selectAndFocus = (next: StatusScope) => {
    setScope(next);
    tabRefs.current[next]?.focus();
  };

  const onTabKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    current: StatusScope,
  ) => {
    const index = scopes.indexOf(current);
    let next: StatusScope | null = null;
    if (event.key === "ArrowRight") next = scopes[(index + 1) % scopes.length];
    if (event.key === "ArrowLeft") {
      next = scopes[(index - 1 + scopes.length) % scopes.length];
    }
    if (event.key === "Home") next = "project";
    if (event.key === "End") next = "area";
    if (next === null) return;

    event.preventDefault();
    selectAndFocus(next);
  };

  return (
    <section
      className="dashboard-widget dashboard-widget-status"
      aria-label="Status"
    >
      <header className="dashboard-widget-header">
        <div className="dashboard-widget-heading">
          <h2>Status</h2>
          <p>Task and Event status by Project or Area.</p>
        </div>
      </header>
      <div
        className="dashboard-status-tabs"
        role="tablist"
        aria-label="Status scope"
      >
        {scopes.map((candidate) => {
          const selectedTab = candidate === scope;
          return (
            <button
              type="button"
              role="tab"
              id={`dashboard-status-tab-${candidate}`}
              aria-controls={`dashboard-status-panel-${candidate}`}
              aria-selected={selectedTab}
              tabIndex={selectedTab ? 0 : -1}
              ref={(element) => {
                tabRefs.current[candidate] = element;
              }}
              onClick={() => setScope(candidate)}
              onKeyDown={(event) => onTabKeyDown(event, candidate)}
              key={candidate}
            >
              {candidate === "project" ? "Project" : "Area"}
            </button>
          );
        })}
      </div>
      {scopes.map((candidate) => {
        const model = models[candidate];
        return (
          <div
            role="tabpanel"
            id={`dashboard-status-panel-${candidate}`}
            aria-labelledby={`dashboard-status-tab-${candidate}`}
            hidden={candidate !== scope}
            key={candidate}
          >
            {model.chart.rows.length === 0 ? (
              <p className="dashboard-widget-empty">{model.emptyMessage}</p>
            ) : (
              <DashboardStatusDonutGrid
                chart={model.chart}
                onNavigate={onNavigate}
                visibility={visibility[candidate]}
              />
            )}
          </div>
        );
      })}
    </section>
  );
}
