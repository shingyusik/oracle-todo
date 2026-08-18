import { describe, expect, it } from "vitest";

import type { DietEntry, MealType } from "@/features/health/model/health-model";
import { defaultHealthTableSettings } from "@/features/health/model/health-table-views";
import { deriveDietGroups } from "@/features/health/model/diet-table";
import type { PlannerTableSettings } from "@/features/workbench/model/planner-model";

const id = (suffix: string) => `00000000-0000-4000-8000-${suffix.padStart(12, "0")}`;

function diet(
  suffix: string,
  patch: Partial<DietEntry> = {},
): DietEntry {
  return {
    id: id(suffix),
    occurredAt: "2026-07-08T12:00:00.000Z",
    mealType: "lunch",
    foodName: `Food ${suffix}`,
    note: null,
    tags: [],
    mediaId: null,
    createdAt: "2026-07-08T12:00:00.000Z",
    updatedAt: "2026-07-08T12:00:00.000Z",
    deletedAt: null,
    ...patch,
  };
}

function settings(
  patch: Omit<Partial<PlannerTableSettings>, "groupSettings"> & {
    groupSettings?: Partial<PlannerTableSettings["groupSettings"]>;
  } = {},
): PlannerTableSettings {
  const defaults = defaultHealthTableSettings("health.diet");
  return {
    ...defaults,
    ...patch,
    groupSettings: { ...defaults.groupSettings, ...patch.groupSettings },
  };
}

function localInstant(year: number, month: number, day: number, hour = 12): string {
  return new Date(year, month - 1, day, hour).toISOString();
}

describe("deriveDietGroups", () => {
  it("projects only active Diet entries and sorts timestamps numerically with id as final tie-break", () => {
    const entries = [
      diet("3", { occurredAt: "2026-07-08T10:00:00+09:00" }),
      diet("2", { occurredAt: "2026-07-08T01:30:00Z" }),
      diet("1", { occurredAt: "2026-07-08T01:30:00Z" }),
      diet("4", { deletedAt: "2026-07-09T00:00:00Z" }),
    ];

    const rows = deriveDietGroups(entries, settings())[0]!.rows;
    expect(rows.map(({ id: rowId }) => rowId)).toEqual([id("1"), id("2"), id("3")]);
    expect(rows[0]).toMatchObject({
      entry: entries[2], mealType: "lunch", mealLabel: "Lunch", food: "Food 1",
      tags: [], hasPhoto: false, note: "",
    });
  });

  it.each([
    ["and", []],
    ["or", [id("1"), id("2")]],
  ] as const)("applies effective %s filters using the shared matcher", (filterMode, ids) => {
    const groups = deriveDietGroups([
      diet("1", { foodName: "Rice bowl", mealType: "lunch", tags: ["spicy"] }),
      diet("2", { foodName: "Toast", mealType: "breakfast", tags: ["quick"] }),
    ], settings({
      filterMode,
      filterRules: [
        { id: "blank", field: "food", type: "text", operator: "contains", value: "" },
        { id: "food", field: "food", type: "text", operator: "contains", value: "rice" },
        { id: "tag", field: "tags", type: "multiSelect", operator: "contains", value: ["quick"] },
      ],
    }));

    expect(groups).toHaveLength(1);
    expect(groups[0]!.rows.map(({ id: rowId }) => rowId)).toEqual(ids);
  });

  it("uses each configured sort before the deterministic id tie-break", () => {
    const entries = [
      diet("3", { foodName: "B", mealType: "lunch" }),
      diet("2", { foodName: "A", mealType: "dinner" }),
      diet("1", { foodName: "A", mealType: "breakfast" }),
    ];
    const groups = deriveDietGroups(entries, settings({ sortRules: [
      { id: "food", field: "food", direction: "asc" },
      { id: "meal", field: "meal_type", direction: "desc" },
    ] }));

    expect(groups[0]!.rows.map(({ id: rowId }) => rowId)).toEqual([id("2"), id("1"), id("3")]);
  });

  it("uses the local date for offset timestamps and relative-date filters", () => {
    const occurredAt = [
      "2026-01-02T00:30:00+14:00",
      "2026-01-02T23:30:00-12:00",
    ].find((value) => new Date(value).getDate() !== Number(value.slice(8, 10)))!;
    const instant = new Date(occurredAt);
    const localNow = new Date(
      instant.getFullYear(), instant.getMonth(), instant.getDate(), 12,
    );
    const groups = deriveDietGroups([diet("1", { occurredAt })], settings({
      filterRules: [{
        id: "today",
        field: "date",
        type: "date",
        operator: "is_relative_to_today",
        value: { amount: "0", unit: "day" },
      }],
    }), localNow);

    expect(groups[0]!.rows.map(({ id: rowId }) => rowId)).toEqual([id("1")]);
    expect(groups[0]!.rows[0]!.date).not.toBe(occurredAt.slice(0, 10));
  });

  it("filters photo presence and sorts by photo and updated timestamp", () => {
    const entries = [
      diet("1", { mediaId: null, updatedAt: "2026-07-08T09:00:00Z" }),
      diet("2", { mediaId: id("22"), updatedAt: "2026-07-08T10:00:00Z" }),
      diet("3", { mediaId: id("33"), updatedAt: "2026-07-08T11:00:00+02:00" }),
    ];
    const filtered = deriveDietGroups(entries, settings({
      filterRules: [{
        id: "photo", field: "has_photo", type: "select", operator: "is", value: ["with-photo"],
      }],
    }));
    const sorted = deriveDietGroups(entries, settings({ sortRules: [
      { id: "photo", field: "has_photo", direction: "asc" },
      { id: "updated", field: "updated", direction: "desc" },
    ] }));

    expect(filtered[0]!.rows.map(({ id: rowId }) => rowId)).toEqual([id("2"), id("3")]);
    expect(sorted[0]!.rows.map(({ id: rowId }) => rowId)).toEqual([id("1"), id("2"), id("3")]);
  });

  it.each([
    ["day", ["2026-01-05", "2025-12-31"]],
    ["week", ["2026-01-05", "2025-12-29"]],
    ["month", ["2026-01", "2025-12"]],
  ] as const)("groups by local-calendar %s", (groupBy, keys) => {
    const groups = deriveDietGroups([
      diet("1", { occurredAt: localInstant(2025, 12, 31) }),
      diet("2", { occurredAt: localInstant(2026, 1, 5) }),
    ], settings({ groupSettings: { groupBy } }));

    expect(groups.map(({ key }) => key)).toEqual(keys);
  });

  it.each([
    ["meal_type", ["dinner", "breakfast"], [["2"], ["1"]]],
    ["tag", ["beta", "alpha"], [["2"], ["1"]]],
    ["has_photo", ["with-photo", "without-photo"], [["2", "3"], ["1"]]],
  ] as const)("groups by %s while honoring hidden and manual settings", (groupBy, keys, suffixes) => {
    const mealTypes: MealType[] = ["breakfast", "dinner", "snack"];
    const groups = deriveDietGroups([
      diet("1", { mealType: mealTypes[0]!, tags: ["alpha"], mediaId: null }),
      diet("2", { mealType: mealTypes[1]!, tags: ["beta"], mediaId: id("22") }),
      diet("3", { mealType: mealTypes[2]!, tags: ["hidden"], mediaId: id("33") }),
    ], settings({ groupSettings: {
      groupBy,
      sort: "manual",
      manualOrder: [...keys],
      hiddenGroupKeys: [groupBy === "meal_type" ? "snack" : groupBy === "tag" ? "hidden" : "ignored"],
    } }));

    expect(groups.map(({ key }) => key)).toEqual(keys);
    expect(groups.map(({ rows }) => rows.map(({ id: rowId }) => rowId))).toEqual(
      suffixes.map((groupSuffixes) => groupSuffixes.map(id)),
    );
  });

  it("orders groups alphabetically and returns one empty ungrouped group when no rows match", () => {
    const alphabetical = deriveDietGroups([
      diet("1", { mealType: "lunch" }), diet("2", { mealType: "breakfast" }),
    ], settings({ groupSettings: { groupBy: "meal_type", sort: "alphabetical" } }));
    expect(alphabetical.map(({ key }) => key)).toEqual(["breakfast", "lunch"]);

    const empty = deriveDietGroups([diet("1")], settings({
      filterRules: [{ id: "missing", field: "food", type: "text", operator: "is", value: "missing" }],
      groupSettings: { groupBy: "meal_type" },
    }));
    expect(empty).toEqual([{ key: "all", label: null, rows: [] }]);
  });
});
