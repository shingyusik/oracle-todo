import { describe, expect, it } from "vitest";

import type { HealthEvent, HealthCategory } from "@/features/health/model/health-model";
import {
  deriveHealthMetricsGroups,
  healthMetricIdentities,
} from "@/features/health/model/health-metrics-table";
import { defaultHealthTableSettings } from "@/features/health/model/health-table-views";
import type { PlannerFilterRule, PlannerTableSettings } from "@/features/workbench/model/planner-model";

type Metric = keyof typeof healthMetricIdentities;
const id = (suffix: string) => `00000000-0000-4000-8000-${suffix.padStart(12, "0")}`;

function metric(
  field: Metric,
  suffix: string,
  value: number,
  date = "2026-07-08T12:00:00.000Z",
  patch: Partial<HealthEvent> = {},
): HealthEvent {
  const identity = healthMetricIdentities[field];
  const attributes = field === "weight"
    ? { kind: "weight" as const, metricKey: identity.metricKey, name: identity.name, value, unit: "kg" }
    : field === "sleep"
      ? { kind: "sleep" as const, metricKey: identity.metricKey, name: identity.name, hours: value }
      : field === "condition"
        ? { kind: "symptom" as const, metricKey: identity.metricKey, name: identity.name, score: value, conditionNote: "steady" }
        : { kind: "lab" as const, metricKey: identity.metricKey, name: identity.name, value, unit: identity.unit };
  return {
    id: id(suffix), occurredAt: date, category: identity.category as HealthCategory,
    metricKey: identity.metricKey, name: identity.name, value,
    unit: field === "condition" ? "score" : identity.unit,
    note: field === "condition" ? "steady" : null, attributes,
    createdAt: date, updatedAt: date, deletedAt: null, ...patch,
  };
}

function settings(patch: Omit<Partial<PlannerTableSettings>, "groupSettings"> & {
  groupSettings?: Partial<PlannerTableSettings["groupSettings"]>;
} = {}): PlannerTableSettings {
  const defaults = defaultHealthTableSettings("health.metrics");
  return { ...defaults, ...patch, groupSettings: { ...defaults.groupSettings, ...patch.groupSettings } };
}

function localInstant(year: number, month: number, day: number, hour = 12): string {
  return new Date(year, month - 1, day, hour).toISOString();
}

describe("Health Metrics daily table", () => {
  it("exports the five fixed identities", () => {
    expect(healthMetricIdentities).toEqual({
      weight: { category: "weight", metricKey: "body_weight", name: "Body weight", unit: "kg" },
      sleep: { category: "sleep", metricKey: "sleep_duration", name: "Sleep", unit: "hours" },
      crp: { category: "lab", metricKey: "crp", name: "CRP", unit: "mg/L" },
      calprotectin: { category: "lab", metricKey: "fecal_calprotectin", name: "Fecal calprotectin", unit: "µg/g" },
      condition: { category: "symptom", metricKey: "overall_condition", name: "Overall condition", unit: null },
    });
  });

  it("combines active fixed daily query results into one local-date row", () => {
    const older = localInstant(2026, 7, 8, 9);
    const newer = localInstant(2026, 7, 8, 18);
    const events = [
      metric("weight", "1", 68.2, older, { createdAt: older, updatedAt: older }),
      metric("condition", "2", 7, newer, {
        unit: null, note: "separate event note", createdAt: newer, updatedAt: newer,
      }),
      metric("sleep", "3", 7.5, older),
      metric("crp", "4", 2.1, older),
      metric("calprotectin", "5", 80, older),
      metric("crp", "6", 9, older, { deletedAt: newer }),
      metric("crp", "7", 3, older, { metricKey: "other_lab", name: "Other lab" }),
      metric("condition", "8", 5, older, { metricKey: "headache", name: "Headache" }),
    ];
    const rows = deriveHealthMetricsGroups(events, settings())[0]!.rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "2026-07-08", date: "2026-07-08", weight: 68.2, sleep: 7.5,
      crp: 2.1, calprotectin: 80, condition: 7, note: "steady",
      createdAt: older, updatedAt: newer,
    });
    expect(Object.keys(rows[0]!.events)).toEqual([
      "weight", "condition", "sleep", "crp", "calprotectin",
    ]);
  });

  it("defaults to newest local date and uses date as the final ascending identity tie", () => {
    const rows = deriveHealthMetricsGroups([
      metric("weight", "3", 70, localInstant(2026, 7, 10)),
      metric("weight", "2", 70, localInstant(2026, 7, 8)),
      metric("weight", "1", 70, localInstant(2026, 7, 9)),
    ], settings()).flatMap(({ rows: groupRows }) => groupRows);
    expect(rows.map(({ id: rowId }) => rowId)).toEqual(["2026-07-10", "2026-07-09", "2026-07-08"]);

    const tied = deriveHealthMetricsGroups([
      metric("weight", "3", 70, localInstant(2026, 7, 10)),
      metric("weight", "2", 70, localInstant(2026, 7, 8)),
      metric("weight", "1", 70, localInstant(2026, 7, 9)),
    ], settings({ sortRules: [{ id: "weight", field: "weight", direction: "desc" }] }))[0]!.rows;
    expect(tied.map(({ id: rowId }) => rowId)).toEqual(["2026-07-08", "2026-07-09", "2026-07-10"]);
  });

  it("selects earliest and latest timestamps by instant while preserving their strings", () => {
    const earlierCreated = "2026-07-08T09:00:00+09:00";
    const laterCreated = "2026-07-08T01:00:00Z";
    const earlierUpdated = "2026-07-08T09:30:00+09:00";
    const laterUpdated = "2026-07-08T01:00:00Z";
    const row = deriveHealthMetricsGroups([
      metric("weight", "1", 68, localInstant(2026, 7, 8), {
        createdAt: earlierCreated, updatedAt: earlierUpdated,
      }),
      metric("sleep", "2", 8, localInstant(2026, 7, 8), {
        createdAt: laterCreated, updatedAt: laterUpdated,
      }),
    ], settings())[0]!.rows[0]!;

    expect(row.createdAt).toBe(earlierCreated);
    expect(row.updatedAt).toBe(laterUpdated);
  });

  it("sorts numeric values with missing values last in either direction", () => {
    const events = [
      metric("weight", "1", 70, localInstant(2026, 7, 8)),
      metric("weight", "2", 60, localInstant(2026, 7, 9)),
      metric("sleep", "3", 8, localInstant(2026, 7, 10)),
    ];
    for (const [direction, expected] of [
      ["asc", ["2026-07-09", "2026-07-08", "2026-07-10"]],
      ["desc", ["2026-07-08", "2026-07-09", "2026-07-10"]],
    ] as const) {
      const rows = deriveHealthMetricsGroups(events, settings({
        sortRules: [{ id: "weight", field: "weight", direction }],
      }))[0]!.rows;
      expect(rows.map(({ id: rowId }) => rowId)).toEqual(expected);
    }
  });

  it("supports AND/OR numeric value and presence filters", () => {
    const events = [
      metric("weight", "1", 70, localInstant(2026, 7, 8)),
      metric("condition", "2", 8, localInstant(2026, 7, 9)),
      metric("weight", "3", 60, localInstant(2026, 7, 9)),
      metric("sleep", "4", 8, localInstant(2026, 7, 10)),
    ];
    const rules: PlannerFilterRule[] = [
      { id: "weight", field: "weight", type: "number", operator: "greater_than", value: "65" },
      { id: "condition", field: "condition", type: "number", operator: "is_not_empty", value: null },
    ];
    expect(deriveHealthMetricsGroups(events, settings({ filterMode: "and", filterRules: rules }))[0]!.rows.map(({ id: rowId }) => rowId))
      .toEqual([]);
    expect(deriveHealthMetricsGroups(events, settings({ filterMode: "or", filterRules: rules }))[0]!.rows.map(({ id: rowId }) => rowId))
      .toEqual(["2026-07-09", "2026-07-08"]);
    expect(deriveHealthMetricsGroups(events, settings({ filterRules: [{
      id: "missing", field: "weight", type: "number", operator: "is_empty", value: null,
    }] }))[0]!.rows.map(({ id: rowId }) => rowId)).toEqual(["2026-07-10"]);
  });

  it("groups by local month/week and honors reverse, manual, and hidden ordering", () => {
    const events = [
      metric("weight", "1", 68, localInstant(2025, 12, 31)),
      metric("weight", "2", 69, localInstant(2026, 1, 5)),
      metric("weight", "3", 70, localInstant(2026, 2, 2)),
    ];
    expect(deriveHealthMetricsGroups(events, settings({ groupSettings: {
      groupBy: "week",
    } })).map(({ key }) => key)).toEqual(["2026-02-02", "2026-01-05", "2025-12-29"]);
    expect(deriveHealthMetricsGroups(events, settings({ groupSettings: {
      groupBy: "month", sort: "reverse_alphabetical",
    } })).map(({ key }) => key)).toEqual(["2026-01", "2026-02", "2025-12"]);
    expect(deriveHealthMetricsGroups(events, settings({ groupSettings: {
      groupBy: "month", sort: "manual", manualOrder: ["2026-01", "2026-02", "2025-12"],
      hiddenGroupKeys: ["2026-02"],
    } })).map(({ key }) => key)).toEqual(["2026-01", "2025-12"]);
  });
});
