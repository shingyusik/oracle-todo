import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  applyHealthReportDrilldown,
  resolveHealthReportRange,
  type HealthReportDrilldown,
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
});
