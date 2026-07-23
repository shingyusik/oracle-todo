import { describe, expect, it } from "vitest";

import type { DashboardSnapshot } from "@/features/dashboard/model/dashboard-model";
import { dashboardWidgets } from "@/features/dashboard/model/dashboard-widgets";

const sampleDashboardSnapshot: DashboardSnapshot = {
  summary: {
    activeAreas: 1,
    activeProjects: 1,
    activeTasks: 2,
    activeEvents: 1,
    activeRoutines: 1,
    attentionProjects: 0,
  },
  areas: [],
  projects: [{
    id: "project-release",
    title: "Release",
    completed: 9,
    remaining: 2,
    progress: 9 / 11,
    attention: "normal",
  }],
  planner: {
    todayDate: "2026-07-23",
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

  it("combines active work into one summary card with direct Workspace links", () => {
    const widget = dashboardWidgets.find(({ id }) => id === "summary");
    const model = widget?.build({
      ...sampleDashboardSnapshot,
      summary: {
        ...sampleDashboardSnapshot.summary,
        activeTasks: 3,
        activeEvents: 2,
        activeRoutines: 1,
      },
    });

    expect(model?.stats).toHaveLength(4);
    expect(model?.stats).toEqual([
      {
        kind: "linked",
        label: "Active Areas",
        value: 1,
        destination: { kind: "areas" },
      },
      {
        kind: "linked",
        label: "Active Projects",
        value: 1,
        destination: { kind: "projects" },
      },
      {
        kind: "composite",
        label: "Active Work",
        value: 6,
        items: [
          { kind: "linked", label: "Tasks", value: 3, destination: { kind: "tasks" } },
          { kind: "linked", label: "Events", value: 2, destination: { kind: "events" } },
          { kind: "linked", label: "Routines", value: 1, destination: { kind: "routines" } },
        ],
      },
      {
        kind: "linked",
        label: "Attention Projects",
        value: 0,
        destination: { kind: "projects" },
      },
    ]);
  });

  it("emits an accessible chart specification and typed destination for every data point", () => {
    const widget = dashboardWidgets.find(({ id }) => id === "planner-week");
    const model = widget?.build(sampleDashboardSnapshot);

    expect(model?.chart?.series).toHaveLength(2);
    expect(model?.chart?.series[0]?.points[0]).toEqual({
      id: "2026-07-21-scheduled",
      label: "2026-07-21",
      value: 1,
      displayValue: "1",
      ariaLabel: "2026-07-21: 1 scheduled",
      sizePercent: 100,
      destination: {
        kind: "daily",
        date: "2026-07-21",
      },
    });
  });

  it("builds Project completion presentation from snapshot progress", () => {
    const widget = dashboardWidgets.find(({ id }) => id === "project-progress");
    const model = widget?.build(sampleDashboardSnapshot);

    expect(model?.chart?.series[0]?.points[0]).toEqual({
      id: "project-release-completed",
      label: "Release",
      value: 9,
      displayValue: "9",
      ariaLabel: "Release: 82% complete (9 completed)",
      sizePercent: 82,
      destination: {
        kind: "project-detail",
        itemId: "project-release",
      },
    });
    expect(model?.chart?.series[1]?.points[0]).toEqual(expect.objectContaining({
      displayValue: "2",
      ariaLabel: "Release: 2 remaining",
      sizePercent: 18,
    }));
  });

  it("exposes distinct Project risk and attention states without relying on color", () => {
    const widget = dashboardWidgets.find(({ id }) => id === "project-progress");
    const model = widget?.build({
      ...sampleDashboardSnapshot,
      projects: [
        {
          id: "project-risk",
          title: "Risky release",
          completed: 1,
          remaining: 1,
          progress: 0.5,
          attention: "risk",
        },
        {
          id: "project-attention",
          title: "Watch release",
          completed: 1,
          remaining: 1,
          progress: 0.5,
          attention: "attention",
        },
      ],
    });

    expect(model?.chart?.series[0]?.points[0]).toEqual(expect.objectContaining({
      label: "Risky release · Risk",
      ariaLabel: expect.stringContaining("Risk"),
      tone: "warning",
    }));
    expect(model?.chart?.series[0]?.points[1]).toEqual(expect.objectContaining({
      label: "Watch release · Attention",
      ariaLabel: expect.stringContaining("Attention"),
    }));
  });

  it("presents unavailable progress as a dash for a Project without linked work", () => {
    const widget = dashboardWidgets.find(({ id }) => id === "project-progress");
    const model = widget?.build({
      ...sampleDashboardSnapshot,
      projects: [{
        id: "project-empty",
        title: "Unplanned",
        completed: 0,
        remaining: 0,
        progress: null,
        attention: "normal",
      }],
    });

    expect(model?.chart?.series[0]?.points[0]).toEqual(expect.objectContaining({
      label: "Unplanned · Progress —",
      value: 0,
      displayValue: "—",
      sizePercent: 0,
      placeholder: true,
      ariaLabel: expect.stringContaining("progress unavailable (—)"),
    }));
    expect(model?.chart?.series[1]?.points[0]).toEqual(expect.objectContaining({
      value: 0,
      displayValue: "0",
      sizePercent: 0,
    }));
  });

  it("keeps Today and Overdue navigation on the selected dashboard date", () => {
    const widget = dashboardWidgets.find(({ id }) => id === "planner-week");
    const model = widget?.build(sampleDashboardSnapshot);

    expect(model?.destination).toEqual({ kind: "weekly", weekStart: "2026-07-21" });
    expect(model?.stats).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: "Today",
        destination: { kind: "daily", date: "2026-07-23" },
      }),
      expect.objectContaining({
        label: "Overdue",
        destination: { kind: "daily-overdue", date: "2026-07-23" },
      }),
    ]));
  });
});
