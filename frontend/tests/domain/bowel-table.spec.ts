import { describe, expect, it } from "vitest";

import type { HealthEvent } from "@/features/health/model/health-model";
import { deriveBowelGroups } from "@/features/health/model/bowel-table";
import { defaultHealthTableSettings } from "@/features/health/model/health-table-views";
import type { PlannerFilterRule, PlannerTableSettings } from "@/features/workbench/model/planner-model";

const id = (suffix: string) => `00000000-0000-4000-8000-${suffix.padStart(12, "0")}`;

function bowel(suffix: string, patch: Partial<HealthEvent> = {}): HealthEvent {
  return {
    id: id(suffix), occurredAt: "2026-07-08T12:00:00.000Z", category: "bowel",
    metricKey: "bowel", name: "Bowel", value: 4, unit: null, note: null,
    attributes: { kind: "bowel", bristolScale: 4, bloodVisible: false },
    createdAt: "2026-07-08T12:00:00.000Z", updatedAt: "2026-07-08T12:00:00.000Z",
    deletedAt: null, ...patch,
  };
}

function settings(patch: Omit<Partial<PlannerTableSettings>, "groupSettings"> & {
  groupSettings?: Partial<PlannerTableSettings["groupSettings"]>;
} = {}): PlannerTableSettings {
  const defaults = defaultHealthTableSettings("health.bowel");
  return { ...defaults, ...patch, groupSettings: { ...defaults.groupSettings, ...patch.groupSettings } };
}

function localInstant(year: number, month: number, day: number, hour = 12): string {
  return new Date(year, month - 1, day, hour).toISOString();
}

describe("deriveBowelGroups", () => {
  it("projects only active validated Bowel events and defaults to newest time with id ties", () => {
    const events = [
      bowel("3", { occurredAt: "2026-07-08T10:00:00+09:00" }),
      bowel("2", { occurredAt: "2026-07-08T01:30:00Z", note: "note" }),
      bowel("1", { occurredAt: "2026-07-08T01:30:00Z", attributes: { kind: "bowel", bristolScale: 7, bloodVisible: true } }),
      bowel("4", { deletedAt: "2026-07-09T00:00:00Z" }),
      bowel("5", { category: "sleep" }),
      bowel("6", { attributes: { kind: "sleep", metricKey: "sleep", name: "Sleep", hours: 8 } }),
    ];
    const rows = deriveBowelGroups(events, settings())[0]!.rows;
    expect(rows.map(({ id: rowId }) => rowId)).toEqual([id("1"), id("2"), id("3")]);
    expect(rows[0]).toMatchObject({
      event: events[2], bristolScale: 7, bloodVisible: true, bloodLabel: "Yes", note: "",
    });
    expect(rows[1]).toMatchObject({ bloodLabel: "No", note: "note" });
  });

  it("uses local calendar dates for projection and relative-date filtering", () => {
    const occurredAt = ["2026-01-02T00:30:00+14:00", "2026-01-02T23:30:00-12:00"]
      .find((value) => new Date(value).getDate() !== Number(value.slice(8, 10)))!;
    const instant = new Date(occurredAt);
    const now = new Date(instant.getFullYear(), instant.getMonth(), instant.getDate(), 12);
    const groups = deriveBowelGroups([bowel("1", { occurredAt })], settings({ filterRules: [{
      id: "today", field: "date", type: "date", operator: "is_relative_to_today",
      value: { amount: "0", unit: "day" },
    }] }), now);
    expect(groups[0]!.rows[0]!.date).not.toBe(occurredAt.slice(0, 10));
  });

  it.each([
    ["date is", { id: "f", field: "date", type: "date", operator: "is", value: "2026-07-08" }, ["1", "2"]],
    ["date before", { id: "f", field: "date", type: "date", operator: "is_before", value: "2026-07-09" }, ["1", "2"]],
    ["scale is", { id: "f", field: "bristol_scale", type: "select", operator: "is", value: ["4"] }, ["1"]],
    ["scale is not", { id: "f", field: "bristol_scale", type: "select", operator: "is_not", value: ["4"] }, ["2"]],
    ["scale contains", { id: "f", field: "bristol_scale", type: "select", operator: "contains", value: ["7"] }, ["2"]],
    ["scale excludes", { id: "f", field: "bristol_scale", type: "select", operator: "does_not_contain", value: ["7"] }, ["1"]],
    ["blood is", { id: "f", field: "blood_visible", type: "select", operator: "is", value: ["yes"] }, ["2"]],
    ["blood is not", { id: "f", field: "blood_visible", type: "select", operator: "is_not", value: ["yes"] }, ["1"]],
  ] as const)("applies %s through the shared matcher", (_name, rule, suffixes) => {
    const groups = deriveBowelGroups([
      bowel("1"),
      bowel("2", { attributes: { kind: "bowel", bristolScale: 7, bloodVisible: true } }),
    ], settings({ filterRules: [rule as PlannerFilterRule] }));
    expect(groups[0]!.rows.map(({ id: rowId }) => rowId)).toEqual(suffixes.map(id));
  });

  it.each([
    ["is", "2026-07-08", ["2"]],
    ["is_not", "2026-07-08", ["3", "1"]],
    ["is_before", "2026-07-08", ["1"]],
    ["is_after", "2026-07-08", ["3"]],
    ["is_on_or_before", "2026-07-08", ["2", "1"]],
    ["is_on_or_after", "2026-07-08", ["3", "2"]],
    ["is_between", { start: "2026-07-08", end: "2026-07-09" }, ["3", "2"]],
    ["is_relative_to_today", { amount: "0", unit: "day" }, ["2"]],
    ["is_empty", null, []],
    ["is_not_empty", null, ["3", "2", "1"]],
  ] as const)("supports the date %s operator", (operator, value, suffixes) => {
    const events = [
      bowel("1", { occurredAt: localInstant(2026, 7, 7) }),
      bowel("2", { occurredAt: localInstant(2026, 7, 8) }),
      bowel("3", { occurredAt: localInstant(2026, 7, 9) }),
    ];
    const rule = { id: operator, field: "date", type: "date", operator, value } as PlannerFilterRule;
    const rows = deriveBowelGroups(events, settings({ filterRules: [rule] }), new Date(2026, 6, 8, 12))[0]!.rows;
    expect(rows.map(({ id: rowId }) => rowId)).toEqual(suffixes.map(id));
  });

  it.each([
    ["bristol_scale", "is", ["7"], ["2"]],
    ["bristol_scale", "is_not", ["7"], ["1"]],
    ["bristol_scale", "contains", ["7"], ["2"]],
    ["bristol_scale", "does_not_contain", ["7"], ["1"]],
    ["bristol_scale", "is_empty", null, []],
    ["bristol_scale", "is_not_empty", null, ["1", "2"]],
    ["blood_visible", "is", ["yes"], ["2"]],
    ["blood_visible", "is_not", ["yes"], ["1"]],
    ["blood_visible", "contains", ["yes"], ["2"]],
    ["blood_visible", "does_not_contain", ["yes"], ["1"]],
    ["blood_visible", "is_empty", null, []],
    ["blood_visible", "is_not_empty", null, ["1", "2"]],
  ] as const)("supports the %s %s operator", (field, operator, value, suffixes) => {
    const events = [
      bowel("1"),
      bowel("2", { attributes: { kind: "bowel", bristolScale: 7, bloodVisible: true } }),
    ];
    const rule = { id: operator, field, type: "select", operator, value } as PlannerFilterRule;
    const rows = deriveBowelGroups(events, settings({ filterRules: [rule] }))[0]!.rows;
    expect(rows.map(({ id: rowId }) => rowId)).toEqual(suffixes.map(id));
  });

  it("applies effective rules with AND and OR without leaking unsupported fields", () => {
    const rules: PlannerFilterRule[] = [
      { id: "blank", field: "bristol_scale", type: "select", operator: "is", value: [] },
      { id: "scale", field: "bristol_scale", type: "select", operator: "is", value: ["4"] },
      { id: "blood", field: "blood_visible", type: "select", operator: "is", value: ["yes"] },
      { id: "leak", field: "meal_type", type: "select", operator: "is", value: ["lunch"] },
    ];
    const events = [bowel("1"), bowel("2", { attributes: { kind: "bowel", bristolScale: 7, bloodVisible: true } })];
    expect(deriveBowelGroups(events, settings({ filterMode: "and", filterRules: rules }))[0]!.rows).toEqual([]);
    expect(deriveBowelGroups(events, settings({ filterMode: "or", filterRules: rules }))[0]!.rows.map(({ id: rowId }) => rowId))
      .toEqual([id("1"), id("2")]);
  });

  it.each(["date", "bristol_scale", "created", "updated"] as const)(
    "sorts deterministically by %s with id as final tie-break", (field) => {
      const events = [
        bowel("3", { occurredAt: "2026-07-08T10:00:00Z", attributes: { kind: "bowel", bristolScale: 6, bloodVisible: false }, createdAt: "2026-07-08T10:00:00Z", updatedAt: "2026-07-08T10:00:00Z" }),
        bowel("2", { occurredAt: "2026-07-08T09:00:00Z", attributes: { kind: "bowel", bristolScale: 4, bloodVisible: false }, createdAt: "2026-07-08T09:00:00Z", updatedAt: "2026-07-08T09:00:00Z" }),
        bowel("1", { occurredAt: "2026-07-08T09:00:00Z", attributes: { kind: "bowel", bristolScale: 4, bloodVisible: false }, createdAt: "2026-07-08T09:00:00Z", updatedAt: "2026-07-08T09:00:00Z" }),
      ];
      expect(deriveBowelGroups(events, settings({ sortRules: [{ id: field, field, direction: "asc" }] }))[0]!.rows.map(({ id: rowId }) => rowId))
        .toEqual([id("1"), id("2"), id("3")]);
    },
  );

  it.each([
    ["day", ["2026-01-05", "2025-12-31"]],
    ["week", ["2026-01-05", "2025-12-29"]],
    ["month", ["2026-01", "2025-12"]],
    ["bristol_scale", ["7", "4"]],
    ["blood_visible", ["yes", "no"]],
  ] as const)("groups by %s with the expected membership", (groupBy, keys) => {
    const groups = deriveBowelGroups([
      bowel("1", { occurredAt: localInstant(2025, 12, 31) }),
      bowel("2", { occurredAt: localInstant(2026, 1, 5), attributes: { kind: "bowel", bristolScale: 7, bloodVisible: true } }),
    ], settings({ groupSettings: { groupBy } }));
    expect(groups.map(({ key }) => key)).toEqual(keys);
    expect(groups.flatMap(({ rows }) => rows.map(({ id: rowId }) => rowId))).toEqual([id("2"), id("1")]);
  });

  it("labels Bowel groups and honors alphabetical reverse manual hidden and hideEmpty semantics", () => {
    const events = [bowel("1"), bowel("2", { attributes: { kind: "bowel", bristolScale: 7, bloodVisible: true } })];
    expect(deriveBowelGroups(events, settings({ groupSettings: { groupBy: "bristol_scale", sort: "alphabetical" } })).map(({ key, label }) => [key, label]))
      .toEqual([["4", "Type 4"], ["7", "Type 7"]]);
    expect(deriveBowelGroups(events, settings({ groupSettings: { groupBy: "blood_visible", sort: "reverse_alphabetical" } })).map(({ key, label }) => [key, label]))
      .toEqual([["yes", "Yes"], ["no", "No"]]);
    expect(deriveBowelGroups(events, settings({ groupSettings: { groupBy: "bristol_scale", sort: "manual", manualOrder: ["7", "4"], hiddenGroupKeys: ["4"], hideEmpty: false } })).map(({ key }) => key))
      .toEqual(["7"]);
  });

  it("does not synthesize phantom empty groups when hideEmpty is false", () => {
    const groups = deriveBowelGroups([bowel("1")], settings({ groupSettings: {
      groupBy: "bristol_scale", hideEmpty: false,
    } }));
    expect(groups.map(({ key }) => key)).toEqual(["4"]);
    expect(deriveBowelGroups([], settings({ groupSettings: { groupBy: "bristol_scale", hideEmpty: false } })))
      .toEqual([{ key: "all", label: null, rows: [] }]);
  });
});
