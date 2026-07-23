import { describe, expect, it } from "vitest";

import { dashboardWidgets } from "@/features/dashboard/model/dashboard-widgets";

const sampleDashboardSnapshot = {
  summary: { activeAreas: 1, activeProjects: 1, activeWork: 2, attentionProjects: 0 },
  areas: [],
  projects: [],
  planner: {
    today: 1,
    thisWeek: 1,
    overdue: 0,
    days: [{ date: "2026-07-21", scheduled: 1, due: 0 }],
  },
};

describe("dashboard widget registry", () => {
  it("registers the summary, Area, Project, and Planner widgets with unique IDs", () => {
    expect(dashboardWidgets.map((widget) => widget.id)).toEqual([
      "summary", "area-status", "project-progress", "planner-week",
    ]);
    expect(new Set(dashboardWidgets.map((widget) => widget.id)).size).toBe(dashboardWidgets.length);
  });

  it("emits an accessible chart specification and typed destination for every data point", () => {
    const widget = dashboardWidgets.find(({ id }) => id === "planner-week");
    const model = widget?.build(sampleDashboardSnapshot);

    expect(model?.chart?.series).toHaveLength(2);
    expect(model?.chart?.series[0]?.points[0]?.destination).toEqual({
      kind: "daily",
      date: "2026-07-21",
    });
  });
});
