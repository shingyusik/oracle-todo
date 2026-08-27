import { describe, expect, it } from "vitest";

import type { DashboardSnapshot } from "@/features/dashboard/model/dashboard-model";
import { dashboardWidgets } from "@/features/dashboard/model/dashboard-widgets";

const sampleDashboardSnapshot: DashboardSnapshot = {
  areas: [{
    id: "area-health",
    title: "Health",
    values: { completed: 2, incomplete: 1, paused: 1, missed: 0 },
    percentages: { completed: 50, incomplete: 25, paused: 25, missed: 0 },
    total: 4,
  }],
  projects: [{
    id: "project-release",
    title: "Release",
    values: { completed: 9, incomplete: 1, paused: 0, missed: 1 },
    percentages: { completed: 82, incomplete: 9, paused: 0, missed: 9 },
    total: 11,
    progress: 9 / 11,
    attention: "risk",
  }],
  todayOutcomes: {
    date: "2026-07-23",
    completed: 1,
    incomplete: 2,
    missed: 1,
    total: 4,
  },
  completionHistory: {
    range: { start: "2026-07-22", end: "2026-07-23" },
    days: [
      { date: "2026-07-22", completed: 0, total: 0, percentage: 0 },
      { date: "2026-07-23", completed: 2, total: 3, percentage: 200 / 3 },
    ],
  },
};

function widget(id: string) {
  return dashboardWidgets.find((candidate) => candidate.id === id)?.build(
    sampleDashboardSnapshot,
  );
}

describe("dashboard widget registry", () => {
  it("registers the four daily-outcome widgets in reading order", () => {
    expect(dashboardWidgets.map((candidate) => candidate.id)).toEqual([
      "today-outcomes",
      "completion-history",
      "area-status",
      "project-status",
    ]);
    expect(dashboardWidgets.map((candidate) => candidate.id)).not.toEqual(
      expect.arrayContaining(["summary", "planner-week"]),
    );
    expect(new Set(dashboardWidgets.map((candidate) => candidate.id)).size)
      .toBe(dashboardWidgets.length);
  });

  it("builds today's donut with totals, percentages, and Daily destinations", () => {
    expect(widget("today-outcomes")).toMatchObject({
      id: "today-outcomes",
      title: "Today's work",
      emptyMessage: "No Tasks or Events are scheduled or due today.",
      chart: {
        kind: "donut",
        ariaLabel: "Today's work",
        total: 4,
        segments: [
          {
            id: "completed",
            label: "Completed",
            value: 1,
            percentage: 25,
            tone: "success",
            ariaLabel: "Completed: 1 (25%)",
            destination: { kind: "daily", date: "2026-07-23" },
          },
          {
            id: "incomplete",
            label: "Incomplete",
            value: 2,
            percentage: 50,
            tone: "primary",
            ariaLabel: "Incomplete: 2 (50%)",
            destination: { kind: "daily", date: "2026-07-23" },
          },
          {
            id: "missed",
            label: "Miss",
            value: 1,
            percentage: 25,
            tone: "warning",
            ariaLabel: "Miss: 1 (25%)",
            destination: { kind: "daily", date: "2026-07-23" },
          },
        ],
      },
    });
  });

  it("preserves raw equal-third donut ratios while rounding visible labels", () => {
    const todayWidget = dashboardWidgets.find(
      (candidate) => candidate.id === "today-outcomes",
    );
    const chart = todayWidget?.build({
      ...sampleDashboardSnapshot,
      todayOutcomes: {
        date: "2026-07-23",
        completed: 1,
        incomplete: 1,
        missed: 1,
        total: 3,
      },
    }).chart;

    expect(chart?.kind).toBe("donut");
    if (chart?.kind !== "donut") return;

    expect(chart.segments[0]?.percentage).toBeCloseTo(33.3333333333, 10);
    expect(chart.segments[1]?.percentage).toBeCloseTo(33.3333333333, 10);
    expect(chart.segments[2]?.percentage).toBeCloseTo(33.3333333333, 10);
    expect(chart.segments.map((segment) => segment.ariaLabel)).toEqual([
      "Completed: 1 (33%)",
      "Incomplete: 1 (33%)",
      "Miss: 1 (33%)",
    ]);
  });

  it("maps completion percentages and exact ratios to informational line points", () => {
    expect(widget("completion-history")).toMatchObject({
      id: "completion-history",
      title: "Completion history",
      description:
        "Completion rate for Tasks and Events scheduled or due by browser-local calendar date.",
      emptyMessage: "No Tasks or Events are scheduled or due in this range.",
      chart: {
        kind: "line",
        ariaLabel: "Completion history",
        total: 3,
        points: [
          {
            id: "2026-07-22",
            label: "2026-07-22",
            value: 0,
            ariaLabel: "2026-07-22: 0% completed (0/0)",
          },
          {
            id: "2026-07-23",
            label: "2026-07-23",
            value: 200 / 3,
            ariaLabel: "2026-07-23: 67% completed (2/3)",
          },
        ],
      },
    });
    expect(widget("completion-history")?.chart).not.toHaveProperty(
      "points.0.destination",
    );
  });

  it("builds exact Area heatmap values and row-relative intensities", () => {
    expect(widget("area-status")).toMatchObject({
      id: "area-status",
      title: "Area status",
      emptyMessage: "Create an active or paused Area to view status distribution.",
      chart: {
        kind: "heatmap",
        ariaLabel: "Area status",
        columns: [
          { id: "completed", label: "Completed", tone: "success" },
          { id: "incomplete", label: "Incomplete", tone: "primary" },
          { id: "paused", label: "Paused", tone: "secondary" },
          { id: "missed", label: "Miss", tone: "warning" },
        ],
        rows: [{
          id: "area-health",
          label: "Health",
          destination: { kind: "area-detail", itemId: "area-health" },
          cells: [
            {
              id: "area-health-completed",
              columnId: "completed",
              value: 2,
              intensityPercent: 50,
              ariaLabel: "Health: 2 completed",
            },
            {
              id: "area-health-incomplete",
              columnId: "incomplete",
              value: 1,
              intensityPercent: 25,
              ariaLabel: "Health: 1 incomplete",
            },
            {
              id: "area-health-paused",
              columnId: "paused",
              value: 1,
              intensityPercent: 25,
              ariaLabel: "Health: 1 paused",
            },
            {
              id: "area-health-missed",
              columnId: "missed",
              value: 0,
              intensityPercent: 0,
              ariaLabel: "Health: 0 miss",
            },
          ],
        }],
      },
    });
  });

  it("exposes Project progress and Risk or Attention without relying on color", () => {
    const projectWidget = dashboardWidgets.find(
      (candidate) => candidate.id === "project-status",
    );
    const model = projectWidget?.build({
      ...sampleDashboardSnapshot,
      projects: [
        sampleDashboardSnapshot.projects[0],
        {
          id: "project-watch",
          title: "Watch",
          values: { completed: 1, incomplete: 1, paused: 0, missed: 0 },
          percentages: { completed: 50, incomplete: 50, paused: 0, missed: 0 },
          total: 2,
          progress: 0.5,
          attention: "attention",
        },
        {
          id: "project-empty",
          title: "Unplanned",
          values: { completed: 0, incomplete: 0, paused: 0, missed: 0 },
          percentages: { completed: 0, incomplete: 0, paused: 0, missed: 0 },
          total: 0,
          progress: null,
          attention: "normal",
        },
      ],
    });

    expect(model).toMatchObject({
      id: "project-status",
      title: "Project status",
      emptyMessage: "Create an active Project to view status distribution.",
      chart: {
        kind: "heatmap",
        ariaLabel: "Project status",
        rows: [
          {
            label: "Release",
            progressLabel: "Progress 82% · Risk",
            attention: "risk",
            destination: { kind: "project-detail", itemId: "project-release" },
          },
          {
            label: "Watch",
            progressLabel: "Progress 50% · Attention",
            attention: "attention",
          },
          {
            label: "Unplanned",
            progressLabel: "Progress —",
            attention: "normal",
          },
        ],
      },
    });
  });
});
