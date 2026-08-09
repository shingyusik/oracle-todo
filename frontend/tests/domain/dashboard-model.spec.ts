import { describe, expect, it } from "vitest";

import {
  buildDashboardSnapshot,
  completionRangeEndingOn,
  isValidDashboardDateRange,
  toUnifiedDashboardModel,
} from "@/features/dashboard/model/dashboard-model";
import type { RavenDashboard } from "@/features/dashboard/api/dashboard-api";

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

describe("dashboard model", () => {
  it("maps domain projections independently without rounding money or hiding units", () => {
    const response: RavenDashboard = {
      requestId: "00000000-0000-4000-8000-000000000001",
      todo: {
        status: "ok",
        data: {
          active: 4,
          todayCompleted: 2,
          todayIncomplete: 1,
          todayMissed: 0,
          todayTotal: 3,
          overdue: 1,
        },
      },
      ledger: {
        status: "ok",
        data: {
          periodStart: "2026-07-01",
          periodEnd: "2026-07-31",
          currencies: [{
            currencyCode: "KRW",
            incomeMinor: 9007199254740991,
            expenseMinor: 12000,
            netChangeMinor: 9007199254728991,
          }],
        },
      },
      health: {
        status: "ok",
        data: {
          latestCondition: {
            timestamp: "2026-07-31T01:00:00Z",
            name: "Overall condition",
            value: 8,
            unit: null,
          },
          latestSleep: {
            timestamp: "2026-07-31T01:00:00Z",
            name: "Sleep",
            value: 7.5,
            unit: "hours",
          },
          latestBowel: {
            timestamp: "2026-07-31T01:30:00Z",
            name: "Bowel",
            value: 4,
            unit: null,
          },
          latestMedication: null,
          recentDietTags: ["vegetable"],
        },
      },
      recentActivity: [{
        domain: "ledger",
        action: "create",
        recordId: "entry-1",
        timestamp: "2026-07-31T02:00:00Z",
      }],
    };

    const model = toUnifiedDashboardModel(response);

    expect(model.ledger).toMatchObject({
      status: "ok",
      data: {
        currencies: [{
          currencyCode: "KRW",
          incomeMinor: "9,007,199,254,740,991",
          unitLabel: "KRW minor units",
        }],
      },
    });
    expect(model.health).toMatchObject({
      status: "ok",
      data: {
        metrics: [
          { name: "Overall condition", displayValue: "8", unitLabel: "score out of 10" },
          { name: "Sleep", displayValue: "7.5", unitLabel: "hours" },
          { name: "Bowel", displayValue: "4", unitLabel: "Bristol scale" },
        ],
      },
    });
    expect(model.recentActivity[0]).toMatchObject({
      domainLabel: "Ledger",
      action: "create",
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

  it("orders Area rows by Miss, incomplete, then localized name", () => {
    const snapshot = buildDashboardSnapshot([
      { id: "area-name-z", type: "area", title: "Zulu", status: "active" },
      { id: "area-name-a", type: "area", title: "Alpha", status: "active" },
      { id: "area-incomplete", type: "area", title: "Incomplete", status: "active" },
      { id: "area-miss", type: "area", title: "Miss", status: "active" },
      { id: "miss", type: "task", title: "Miss", status: "missed", area_id: "area-miss" },
      { id: "open-1", type: "task", title: "Open 1", status: "active", area_id: "area-incomplete" },
      { id: "open-2", type: "event", title: "Open 2", status: "waiting", area_id: "area-incomplete" },
    ], today);

    expect(snapshot.areas.map((row) => row.title)).toEqual([
      "Miss",
      "Incomplete",
      "Alpha",
      "Zulu",
    ]);
  });

  it("orders Project rows by Miss, incomplete, then localized name", () => {
    const snapshot = buildDashboardSnapshot([
      { id: "project-name-z", type: "project", title: "Zulu", status: "active" },
      { id: "project-name-a", type: "project", title: "Alpha", status: "active" },
      { id: "project-incomplete", type: "project", title: "Incomplete", status: "active" },
      { id: "project-miss", type: "project", title: "Miss", status: "active" },
      { id: "miss", type: "event", title: "Miss", status: "missed", project_id: "project-miss" },
      { id: "open-1", type: "task", title: "Open 1", status: "active", project_id: "project-incomplete" },
      { id: "open-2", type: "event", title: "Open 2", status: "waiting", project_id: "project-incomplete" },
    ], today);

    expect(snapshot.projects.map((row) => row.title)).toEqual([
      "Miss",
      "Incomplete",
      "Alpha",
      "Zulu",
    ]);
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

  it("builds daily scheduled-or-due completion percentages", () => {
    const range = { start: "2026-07-22", end: "2026-07-24" };
    const snapshot = buildDashboardSnapshot([
      { id: "done", type: "task", title: "Done", status: "completed", scheduled: "2026-07-23", due: "2026-07-23" },
      { id: "active", type: "task", title: "Active", status: "active", due: "2026-07-23" },
      { id: "missed", type: "event", title: "Missed", status: "missed", scheduled: "2026-07-23" },
      { id: "cancelled", type: "event", title: "Cancelled", status: "cancelled", scheduled: "2026-07-23" },
      { id: "other-day", type: "task", title: "Other", status: "completed", scheduled: "2026-07-24" },
    ], today, range);

    expect(snapshot.completionHistory.days).toEqual([
      { date: "2026-07-22", completed: 0, total: 0, percentage: 0 },
      { date: "2026-07-23", completed: 1, total: 3, percentage: 100 / 3 },
      { date: "2026-07-24", completed: 1, total: 1, percentage: 100 },
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
