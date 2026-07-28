import { describe, expect, it } from "vitest";

import {
  buildDashboardSnapshot,
  completionRangeEndingOn,
  isValidDashboardDateRange,
} from "@/features/dashboard/model/dashboard-model";

const today = "2026-07-23";

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00`);
  value.setDate(value.getDate() + days);
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, "0"),
    String(value.getDate()).padStart(2, "0"),
  ].join("-");
}

function localDateOf(value: string): string {
  const date = new Date(value);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

describe("dashboard model", () => {
  it("counts active Tasks, Events, and Routines separately", () => {
    const snapshot = buildDashboardSnapshot([
      { id: "task-active", type: "task", title: "Write", status: "active" },
      { id: "task-paused", type: "task", title: "Wait", status: "paused" },
      { id: "event-active", type: "event", title: "Meet", status: "active" },
      { id: "routine-active", type: "routine", title: "Review", status: "active" },
      { id: "routine-done", type: "routine", title: "Old review", status: "completed" },
    ], today);

    expect(snapshot.summary).toMatchObject({
      activeTasks: 1,
      activeEvents: 1,
      activeRoutines: 1,
    });
  });

  it("builds Area heatmap rows from direct Task and Event work only", () => {
    const snapshot = buildDashboardSnapshot([
      { id: "area", type: "area", title: "Health", status: "active" },
      { id: "active", type: "task", title: "Run", status: "active", area_id: "area" },
      { id: "waiting", type: "event", title: "Book", status: "waiting", area_id: "area" },
      { id: "paused", type: "task", title: "Rest", status: "paused", area_id: "area" },
      { id: "done", type: "event", title: "Check", status: "completed", area_id: "area" },
      { id: "missed", type: "task", title: "Skip", status: "missed", area_id: "area" },
      { id: "routine", type: "routine", title: "Template", status: "active", area_id: "area" },
      { id: "cancelled", type: "task", title: "Ignore", status: "cancelled", area_id: "area" },
    ], today);

    expect(snapshot.areas[0]).toMatchObject({
      values: { completed: 1, incomplete: 2, paused: 1, missed: 1 },
      percentages: { completed: 20, incomplete: 40, paused: 20, missed: 20 },
      total: 5,
    });
  });

  it("keeps Missed work in Project progress denominator", () => {
    const snapshot = buildDashboardSnapshot([
      { id: "project", type: "project", title: "Release", status: "active" },
      { id: "done", type: "task", title: "Done", status: "completed", project_id: "project" },
      { id: "missed", type: "event", title: "Miss", status: "missed", project_id: "project" },
      { id: "waiting", type: "task", title: "Wait", status: "waiting", project_id: "project" },
    ], today);

    expect(snapshot.projects[0]).toMatchObject({
      values: { completed: 1, incomplete: 1, paused: 0, missed: 1 },
      progress: 1 / 3,
    });
  });

  it("uses zero intensities and unavailable progress for containers without work", () => {
    const snapshot = buildDashboardSnapshot([
      { id: "area", type: "area", title: "Health", status: "paused" },
      { id: "project", type: "project", title: "Release", status: "active" },
    ], today);

    expect(snapshot.areas[0]?.percentages).toEqual({
      completed: 0, incomplete: 0, paused: 0, missed: 0,
    });
    expect(snapshot.projects[0]?.progress).toBeNull();
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

    expect(snapshot.planner).toMatchObject({ todayDate: today, today: 1, thisWeek: 1, overdue: 0 });
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

  it("partitions today's Task and Event work without counting Routine definitions", () => {
    const snapshot = buildDashboardSnapshot([
      { id: "task-done", type: "task", title: "Done", status: "completed", scheduled: today },
      { id: "event-open", type: "event", title: "Meet", status: "active", due: today },
      { id: "task-paused", type: "task", title: "Wait", status: "paused", scheduled: today, due: today },
      { id: "task-missed", type: "task", title: "Miss", status: "missed", scheduled: today },
      { id: "routine", type: "routine", title: "Template", status: "active", scheduled: today },
      { id: "generated", type: "task", title: "Generated", status: "waiting", routine_id: "routine", scheduled: today },
      { id: "cancelled", type: "event", title: "No longer", status: "cancelled", scheduled: today },
    ], today);

    expect(snapshot.todayOutcomes).toEqual({
      date: today,
      completed: 1,
      incomplete: 3,
      missed: 1,
      total: 5,
    });
  });

  it("builds a continuous inclusive completion history in browser-local dates", () => {
    const completedAt = "2026-07-22T23:30:00-07:00";
    const completionDate = localDateOf(completedAt);
    const range = { start: addDays(completionDate, -1), end: addDays(completionDate, 1) };
    const snapshot = buildDashboardSnapshot([
      { id: "task", type: "task", title: "Done", status: "completed", completed_at: completedAt },
      { id: "routine", type: "routine", title: "Template", status: "completed", completed_at: completedAt },
    ], today, range);

    expect(snapshot.completionHistory.days).toEqual([
      { date: range.start, completed: 0 },
      { date: completionDate, completed: 1 },
      { date: range.end, completed: 0 },
    ]);
  });

  it("creates exact 7, 14, and 30 day inclusive presets", () => {
    expect(completionRangeEndingOn(today, 7)).toEqual({
      start: addDays(today, -6),
      end: today,
    });
    expect(completionRangeEndingOn(today, 14)).toEqual({
      start: addDays(today, -13),
      end: today,
    });
    expect(completionRangeEndingOn(today, 30)).toEqual({
      start: addDays(today, -29),
      end: today,
    });
  });

  it("rejects reversed and invalid custom ranges", () => {
    expect(isValidDashboardDateRange({ start: "2026-07-29", end: "2026-07-28" })).toBe(false);
    expect(isValidDashboardDateRange({ start: "not-a-date", end: "2026-07-28" })).toBe(false);
  });
});
