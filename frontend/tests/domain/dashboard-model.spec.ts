import { describe, expect, it } from "vitest";

import { buildDashboardSnapshot } from "@/features/dashboard/model/dashboard-model";

const today = "2026-07-23";

describe("dashboard model", () => {
  it("counts only direct Area work by status", () => {
    const snapshot = buildDashboardSnapshot([
      { id: "area", type: "area", title: "Health", status: "active" },
      { id: "task", type: "task", title: "Run", status: "active", area_id: "area" },
      { id: "project", type: "project", title: "Plan", status: "active", area_id: "area" },
      { id: "nested", type: "task", title: "Nested", status: "completed", project_id: "project" },
    ], today);

    expect(snapshot.areas[0]).toMatchObject({ active: 1, completed: 0, paused: 0 });
  });

  it("gives Risk precedence over Attention", () => {
    const snapshot = buildDashboardSnapshot([
      { id: "project", type: "project", title: "Release", status: "active", due: "2026-07-20", updated_at: "2026-07-17T00:00:00Z" },
    ], today);

    expect(snapshot.projects[0]?.attention).toBe("risk");
  });

  it("deduplicates a same-day scheduled and due item in Planner summaries", () => {
    const snapshot = buildDashboardSnapshot([
      { id: "task", type: "task", title: "Ship", status: "active", scheduled: today, due: today },
    ], today);

    expect(snapshot.planner).toMatchObject({ today: 1, thisWeek: 1, overdue: 0 });
    expect(snapshot.planner.days.find((day) => day.date === today)).toMatchObject({ scheduled: 1, due: 1 });
  });

  it.each([
    ["2026-07-16", "attention"],
    ["2026-07-09", "risk"],
  ] as const)("uses %s updated_at boundary for %s", (updatedDate, expected) => {
    const snapshot = buildDashboardSnapshot([
      { id: "project", type: "project", title: "Plan", status: "active", updated_at: `${updatedDate}T12:00:00Z` },
    ], today);

    expect(snapshot.projects[0]?.attention).toBe(expected);
  });

  it("includes an item in separate weekly series on its distinct scheduled and due days", () => {
    const snapshot = buildDashboardSnapshot([
      { id: "task", type: "task", title: "Plan", status: "active", scheduled: "2026-07-21", due: "2026-07-25" },
    ], today);

    expect(snapshot.planner.days.find((day) => day.date === "2026-07-21")?.scheduled).toBe(1);
    expect(snapshot.planner.days.find((day) => day.date === "2026-07-25")?.due).toBe(1);
  });
});
