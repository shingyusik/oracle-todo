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

  it("preserves a non-zero intensity for one item in a 201-item heatmap row", () => {
    const snapshot = buildDashboardSnapshot([
      { id: "area", type: "area", title: "Health", status: "active" },
      {
        id: "completed",
        type: "task",
        title: "Complete",
        status: "completed",
        area_id: "area",
      },
      ...Array.from({ length: 200 }, (_, index) => ({
        id: `missed-${index}`,
        type: "task",
        title: `Missed ${index}`,
        status: "missed",
        area_id: "area",
      })),
    ], today);

    expect(snapshot.areas[0]?.percentages.completed)
      .toBeCloseTo(0.4975124378, 10);
    expect(snapshot.areas[0]?.percentages.missed)
      .toBeCloseTo(99.5024875622, 10);
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
      { id: "project", type: "project", title: "Release", status: "active", due: "2026-07-20", updated_at: "2026-07-16T00:00:00Z" },
    ], today);

    expect(snapshot.projects[0]?.attention).toBe("risk");
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

  it("accepts an exact 366-day inclusive completion range", () => {
    const range = { start: "2025-07-29", end: "2026-07-29" };

    expect(isValidDashboardDateRange(range)).toBe(true);
    const days = buildDashboardSnapshot([], today, range).completionHistory.days;
    expect(days).toHaveLength(366);
    expect(days[0]?.date).toBe("2025-07-29");
    expect(days.at(-1)?.date).toBe("2026-07-29");
  });

  it("rejects a 367-day inclusive completion range", () => {
    expect(isValidDashboardDateRange({
      start: "2025-07-28",
      end: "2026-07-29",
    })).toBe(false);
  });
});
