import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  applyHealthReportDrilldown,
  buildHealthReportAnalysis,
  resolveHealthReportRange,
  type HealthReportDrilldown,
  type HealthReport,
} from "@/features/health/model/health-reports";
import {
  defaultHealthTableSettings,
  healthFilterFieldsForScope,
  normalizeHealthTableSettings,
  type HealthTableScopeId,
} from "@/features/health/model/health-table-views";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 7, 20, 12));
});

afterEach(() => vi.useRealTimers());

describe("Health report analysis", () => {
  const report = (overrides: Partial<HealthReport> = {}): HealthReport => ({
    range: { from: "2026-08-01", to: "2026-08-20" },
    previousRange: { from: "2026-07-12", to: "2026-07-31" },
    metrics: [
      { metric: "body_weight", name: "Weight", unit: "kg", current: null, previous: null },
      { metric: "sleep_duration", name: "Sleep", unit: "hours", current: null, previous: null },
      { metric: "crp", name: "CRP", unit: "mg/L", current: null, previous: null },
      { metric: "fecal_calprotectin", name: "Calprotectin", unit: "µg/g", current: null, previous: null },
      { metric: "overall_condition", name: "Condition", unit: null, current: null, previous: null },
    ],
    bowelPoints: [], metricSeries: [
      { metric: "body_weight", points: [] },
      { metric: "sleep_duration", points: [] },
      { metric: "crp", points: [] },
      { metric: "fecal_calprotectin", points: [] },
      { metric: "overall_condition", points: [] },
    ],
    dietCount: { current: null, previous: null }, bowel: {
      currentCount: null, previousCount: null, currentAverage: null, previousAverage: null,
    }, medicationCount: { current: null, previous: null }, medicationFrequencies: [],
    dietTagFrequencies: [], dietTagBowelResponses: [], reactionDisclaimer: "",
    ...overrides,
  });

  it("groups bowel records by local date in chronological order without synthetic dates", () => {
    const result = buildHealthReportAnalysis(report({ bowelPoints: [
      { localDate: "2026-08-12", occurredAt: "2026-08-12T01:00:00Z", bristolScale: 6 },
      { localDate: "2026-08-10", occurredAt: "2026-08-10T02:00:00Z", bristolScale: 5 },
      { localDate: "2026-08-10", occurredAt: "2026-08-10T01:00:00Z", bristolScale: 3 },
    ]}));
    expect(result.dailyBowelPoints).toEqual([
      { localDate: "2026-08-10", value: 4, recordCount: 2 },
      { localDate: "2026-08-12", value: 6, recordCount: 1 },
    ]);
    expect(result.latestDailyBowel).toEqual({ localDate: "2026-08-12", value: 6, recordCount: 1 });
  });

  it("derives chronological weight readings and latest change within the range", () => {
    const result = buildHealthReportAnalysis(report({ metricSeries: [{ metric: "body_weight", points: [
      { localDate: "2026-08-20", occurredAt: "2026-08-20T01:00:00Z", value: 70.5 },
      { localDate: "2026-08-05", occurredAt: "2026-08-05T01:00:00Z", value: 71.5 },
      { localDate: "2026-07-31", occurredAt: "2026-07-31T01:00:00Z", value: 72 },
    ] }] }));
    expect(result.weightPoints).toEqual([
      { localDate: "2026-08-05", occurredAt: "2026-08-05T01:00:00Z", value: 71.5 },
      { localDate: "2026-08-20", occurredAt: "2026-08-20T01:00:00Z", value: 70.5 },
    ]);
    expect(result.latestWeight).toEqual(result.weightPoints[1]);
    expect(result.weightChange).toBe(-1);
  });

  it("compares the latest two supporting metric readings", () => {
    const result = buildHealthReportAnalysis(report({ metricSeries: [{ metric: "sleep_duration", points: [
      { localDate: "2026-08-15", occurredAt: "2026-08-15T01:00:00Z", value: 7 },
      { localDate: "2026-08-20", occurredAt: "2026-08-20T01:00:00Z", value: 7.5 },
    ] }] }));
    expect(result.supportingMetrics).toHaveLength(4);
    expect(result.supportingMetrics.find(({ metric }) => metric === "sleep_duration")).toEqual({
      metric: "sleep_duration", name: "Sleep", unit: "hours",
      points: [
        { localDate: "2026-08-15", occurredAt: "2026-08-15T01:00:00Z", value: 7 },
        { localDate: "2026-08-20", occurredAt: "2026-08-20T01:00:00Z", value: 7.5 },
      ],
      latest: { localDate: "2026-08-20", occurredAt: "2026-08-20T01:00:00Z", value: 7.5 },
      previous: { localDate: "2026-08-15", occurredAt: "2026-08-15T01:00:00Z", value: 7 },
      change: 0.5,
    });
  });

  it("leaves weight change null when fewer than two readings are in range", () => {
    expect(buildHealthReportAnalysis(report({ metricSeries: [{ metric: "body_weight", points: [
      { localDate: "2026-08-20", occurredAt: "2026-08-20T01:00:00Z", value: 70.5 },
    ] }] })).weightChange).toBeNull();
  });
});

describe("Health report ranges", () => {
  it.each([
    [7, "2026-08-14", "2026-08-20"],
    [14, "2026-08-07", "2026-08-20"],
    [30, "2026-07-22", "2026-08-20"],
    [90, "2026-05-23", "2026-08-20"],
  ] as const)("resolves the inclusive local %i-day preset", (preset, start, end) => {
    expect(resolveHealthReportRange({ preset })).toEqual({
      ok: true,
      range: { start, end },
    });
  });

  it.each([
    [new Date(2026, 2, 1, 12), 7, "2026-02-23", "2026-03-01"],
    [new Date(2026, 0, 1, 12), 7, "2025-12-26", "2026-01-01"],
    [new Date(2024, 2, 1, 12), 7, "2024-02-24", "2024-03-01"],
  ] as const)("crosses month, year, and leap boundaries in local time", (now, preset, start, end) => {
    expect(resolveHealthReportRange({ preset }, now)).toEqual({
      ok: true,
      range: { start, end },
    });
  });

  it("validates custom dates, ordering, and the API's 366-day inclusive ceiling", () => {
    expect(resolveHealthReportRange({
      preset: "custom", from: "2024-02-29", to: "2025-02-28",
    })).toEqual({ ok: true, range: { start: "2024-02-29", end: "2025-02-28" } });
    expect(resolveHealthReportRange({
      preset: "custom", from: "2026-02-29", to: "2026-03-01",
    })).toEqual({ ok: false, error: "invalid_date" });
    expect(resolveHealthReportRange({
      preset: "custom", from: "2026-08-21", to: "2026-08-20",
    })).toEqual({ ok: false, error: "invalid_order" });
    expect(resolveHealthReportRange({
      preset: "custom", from: "2024-02-29", to: "2025-03-01",
    })).toEqual({ ok: false, error: "range_too_long" });
    expect(resolveHealthReportRange({
      preset: "custom", from: "0000-01-01", to: "0000-01-01",
    })).toEqual({ ok: false, error: "invalid_date" });
    expect(resolveHealthReportRange({
      preset: "custom", from: "0001-01-01", to: "0001-01-01",
    })).toEqual({ ok: true, range: { start: "0001-01-01", end: "0001-01-01" } });
  });
});

describe("Health report drilldowns", () => {
  const base = {
    ...defaultHealthTableSettings("health.diet"),
    filterMode: "or" as const,
    filterRules: [{ id: "old", field: "food" as const, type: "text" as const,
      operator: "contains" as const, value: "rice" }],
    sortRules: [{ id: "sort", field: "date" as const, direction: "asc" as const }],
    groupSettings: {
      groupBy: "tag" as const,
      sort: "manual" as const,
      hideEmpty: false,
      manualOrder: ["fiber"],
      hiddenGroupKeys: ["spicy"],
    },
  };

  it.each([
    [{ tab: "diet", range: { start: "2026-08-14", end: "2026-08-20" },
      field: "tags", value: "fiber" },
    { id: "health-report-tags", field: "tags", type: "multiSelect", operator: "contains",
      value: ["fiber"] }],
    [{ tab: "medication", range: { start: "2026-08-14", end: "2026-08-20" },
      field: "medication_name", value: "Vitamin D" },
    { id: "health-report-medication_name", field: "medication_name", type: "text",
      operator: "is", value: "Vitamin D" }],
    [{ tab: "bowel", range: { start: "2026-08-14", end: "2026-08-20" },
      field: "bristol_scale" },
    { id: "health-report-bristol_scale", field: "bristol_scale", type: "select",
      operator: "is", value: ["1", "2", "6", "7"] }],
    [{ tab: "health-metrics", range: { start: "2026-08-14", end: "2026-08-20" },
      field: "calprotectin" },
    { id: "health-report-calprotectin", field: "calprotectin", type: "number",
      operator: "is_not_empty", value: null }],
  ] as const)("replaces filters with an inclusive range and the selected target", (target, rule) => {
    const result = applyHealthReportDrilldown(base, target as HealthReportDrilldown);

    expect(result).toEqual({
      ...base,
      filterMode: "and",
      filterRules: [
        { id: "health-report-date", field: "date", type: "date", operator: "is_between",
          value: target.range },
        rule,
      ],
    });
    expect(result.sortRules).not.toBe(base.sortRules);
    expect(result.groupSettings).not.toBe(base.groupSettings);
    expect(result.groupSettings.manualOrder).not.toBe(base.groupSettings.manualOrder);
  });

  it("keeps only each drilldown's fields in its corresponding Health scope", () => {
    const cases: [HealthReportDrilldown, HealthTableScopeId][] = [
      [{ tab: "diet", range: { start: "2026-08-14", end: "2026-08-20" },
        field: "tags", value: "fiber" }, "health.diet"],
      [{ tab: "bowel", range: { start: "2026-08-14", end: "2026-08-20" },
        field: "bristol_scale" }, "health.bowel"],
      [{ tab: "medication", range: { start: "2026-08-14", end: "2026-08-20" },
        field: "medication_name", value: "Vitamin D" }, "health.medication"],
      [{ tab: "health-metrics", range: { start: "2026-08-14", end: "2026-08-20" },
        field: "crp" }, "health.metrics"],
    ];

    for (const [target, expectedScope] of cases) {
      const settings = applyHealthReportDrilldown(defaultHealthTableSettings(expectedScope), target);
      const targetField = settings.filterRules[1]!.field;
      for (const scope of [
        "health.diet", "health.bowel", "health.medication", "health.metrics",
      ] as const) {
        const normalized = normalizeHealthTableSettings(scope, settings);
        expect(normalized.filterRules).toEqual(
          scope === expectedScope ? settings.filterRules : [settings.filterRules[0]],
        );
        expect(healthFilterFieldsForScope(scope).includes(targetField)).toBe(scope === expectedScope);
      }
    }
  });

  it("supports explicit date-only drilldowns", () => {
    expect(applyHealthReportDrilldown(base, {
      tab: "medication", range: { start: "2026-08-14", end: "2026-08-20" },
    }).filterRules).toEqual([{
      id: "health-report-date", field: "date", type: "date", operator: "is_between",
      value: { start: "2026-08-14", end: "2026-08-20" },
    }]);
  });

  it("rejects invalid drilldown combinations even when a caller bypasses TypeScript", () => {
    const invalidField: HealthReportDrilldown = {
      tab: "diet", range: { start: "2026-08-14", end: "2026-08-20" },
      // @ts-expect-error Diet drilldowns cannot target metrics.
      field: "crp",
    };
    // @ts-expect-error Targeted Diet drilldowns require a tag value.
    const missingValue: HealthReportDrilldown = {
      tab: "diet", range: { start: "2026-08-14", end: "2026-08-20" }, field: "tags",
    };
    // @ts-expect-error Date-only drilldowns cannot carry orphan values.
    const orphanValue: HealthReportDrilldown = {
      tab: "bowel", range: { start: "2026-08-14", end: "2026-08-20" }, value: "4",
    };
    const invalidTab: HealthReportDrilldown = {
      // @ts-expect-error Health reports expose only Health workspace tabs.
      tab: "ledger", range: { start: "2026-08-14", end: "2026-08-20" },
    };

    for (const target of [invalidField, missingValue, orphanValue, invalidTab]) {
      expect(() => applyHealthReportDrilldown(base, target)).toThrow(TypeError);
    }
  });
});
