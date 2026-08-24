import { describe, expect, it } from "vitest";

import {
  defaultHealthTableSettings,
  healthBowelFilterSelectOptions,
  healthDietFilterSelectOptions,
  healthMedicationFilterSelectOptions,
  healthFilterFieldsForScope,
  healthGroupOptionsForScope,
  healthSortFieldsForScope,
  healthTableScopeIds,
  normalizeHealthTableSettings,
} from "@/features/health/model/health-table-views";
import { normalizeLedgerTableSettings } from "@/features/ledger/model/ledger-table-views";
import { defaultPlannerGroupSettings } from "@/features/workbench/model/planner-group-settings";
import {
  normalizePlannerTableSettings,
  type PlannerFilterRule,
  type PlannerGroupBy,
  type PlannerSortRule,
} from "@/features/workbench/model/planner-model";
import type { LegacyPlannerControls } from "@/features/workbench/model/workbench-model";
import { tableViewFilterFieldConfigs } from "@/features/workbench/ui/TableViewControls";

function legacyControls(): LegacyPlannerControls {
  return {
    filterMode: "and",
    filterRules: [],
    groupSettings: {
      daily: defaultPlannerGroupSettings(),
      weekly: defaultPlannerGroupSettings(),
      monthly: defaultPlannerGroupSettings(),
      yearly: defaultPlannerGroupSettings(),
    },
    dailySortRules: [],
    weeklySortRules: [],
    monthlySortRules: [],
    yearlySortRules: [],
  };
}

describe("Health table views", () => {
  it("maps each Health select field to only its own options", () => {
    const fields = tableViewFilterFieldConfigs({
      tags: [],
      daily: {
        tags: [], areas: [], projects: [], currencies: [], routines: [],
        statuses: [{ value: "active", label: "Active" }],
        priorities: [], horizons: [], parents: [], materializationPolicies: [], participants: [],
      },
      fieldOptions: healthDietFilterSelectOptions,
    }, ["meal_type", "has_photo"]);

    expect(fields.map(({ field, options }) => [field, options])).toEqual([
      ["meal_type", [
        { value: "breakfast", label: "Breakfast" },
        { value: "lunch", label: "Lunch" },
        { value: "dinner", label: "Dinner" },
        { value: "snack", label: "Snack" },
        { value: "late_night", label: "Late night" },
      ]],
      ["has_photo", [
        { value: "with-photo", label: "Yes" },
        { value: "without-photo", label: "No" },
      ]],
    ]);
  });

  it("maps each Bowel select field to only its own options", () => {
    const fields = tableViewFilterFieldConfigs({
      tags: [],
      daily: {
        tags: [], areas: [], projects: [], currencies: [], routines: [], statuses: [],
        priorities: [], horizons: [], parents: [], materializationPolicies: [], participants: [],
      },
      fieldOptions: healthBowelFilterSelectOptions,
    }, ["bristol_scale", "blood_visible"]);

    expect(fields.map(({ field, label, options }) => [field, label, options])).toEqual([
      ["bristol_scale", "Bristol Scale", [
        { value: "1", label: "Type 1" }, { value: "2", label: "Type 2" },
        { value: "3", label: "Type 3" }, { value: "4", label: "Type 4" },
        { value: "5", label: "Type 5" }, { value: "6", label: "Type 6" },
        { value: "7", label: "Type 7" },
      ]],
      ["blood_visible", "Blood Visible", [
        { value: "yes", label: "Yes" }, { value: "no", label: "No" },
      ]],
    ]);
  });

  it("defines the Diet scope controls and defaults", () => {
    expect(healthTableScopeIds).toEqual([
      "health.diet", "health.bowel", "health.medication", "health.metrics",
    ]);
    expect(healthFilterFieldsForScope("health.diet")).toEqual([
      "date", "meal_type", "food", "tags", "has_photo",
    ]);
    expect(healthSortFieldsForScope("health.diet")).toEqual([
      "date", "meal_type", "food", "created", "updated",
    ]);
    expect(healthGroupOptionsForScope("health.diet").map(({ value }) => value)).toEqual([
      "none", "month", "week", "day", "meal_type", "tag", "has_photo",
    ]);
    expect(defaultHealthTableSettings("health.diet").sortRules).toEqual([{
      id: "health.diet-default-sort", field: "date", direction: "desc",
    }]);
  });

  it("defines exact Health Metrics controls without day grouping", () => {
    expect(healthFilterFieldsForScope("health.metrics")).toEqual([
      "date", "weight", "sleep", "crp", "calprotectin", "condition",
    ]);
    expect(healthSortFieldsForScope("health.metrics")).toEqual([
      "date", "weight", "sleep", "crp", "calprotectin", "condition",
    ]);
    expect(healthGroupOptionsForScope("health.metrics").map(({ value }) => value)).toEqual([
      "none", "month", "week",
    ]);
    expect(defaultHealthTableSettings("health.metrics").sortRules).toEqual([{
      id: "health.metrics-default-sort", field: "date", direction: "desc",
    }]);
    expect(normalizeHealthTableSettings("health.metrics", {
      groupSettings: { groupBy: "day" },
    }).groupSettings.groupBy).toBe("none");
  });

  it("defines Medication controls, units, and defaults", () => {
    expect(healthFilterFieldsForScope("health.medication")).toEqual(["date", "medication_name", "medication_unit"]);
    expect(healthSortFieldsForScope("health.medication")).toEqual(["date", "medication_name", "dose", "created", "updated"]);
    expect(healthGroupOptionsForScope("health.medication")).toEqual([
      { value: "none", label: "None" },
      { value: "month", label: "Month" },
      { value: "week", label: "Week" },
      { value: "day", label: "Day" },
      { value: "medication_name", label: "Medication" },
      { value: "medication_unit", label: "Unit" },
    ]);
    expect(healthMedicationFilterSelectOptions.medication_unit).toEqual([
      { value: "tablet", label: "정" }, { value: "capsule", label: "캡슐" },
      { value: "packet", label: "포" }, { value: "mg", label: "mg" },
      { value: "g", label: "g" }, { value: "ml", label: "ml" },
      { value: "drop", label: "방울" }, { value: "dose", label: "회" },
    ]);
  });

  it("defines the Bowel scope controls and defaults", () => {
    expect(healthFilterFieldsForScope("health.bowel")).toEqual([
      "date", "bristol_scale", "blood_visible",
    ]);
    expect(healthSortFieldsForScope("health.bowel")).toEqual([
      "date", "bristol_scale", "created", "updated",
    ]);
    expect(healthGroupOptionsForScope("health.bowel").map(({ value }) => value)).toEqual([
      "none", "month", "week", "day", "bristol_scale", "blood_visible",
    ]);
    expect(defaultHealthTableSettings("health.bowel").sortRules).toEqual([{
      id: "health.bowel-default-sort", field: "date", direction: "desc",
    }]);
  });

  it("normalizes Bowel settings without leaking Diet controls", () => {
    const settings = normalizeHealthTableSettings("health.bowel", {
      filterRules: [
        { id: "scale", field: "bristol_scale", type: "select", operator: "is", value: ["4"] },
        { id: "diet", field: "meal_type", type: "select", operator: "is", value: ["lunch"] },
      ],
      sortRules: [
        { id: "blood", field: "blood_visible", direction: "asc" },
        { id: "scale", field: "bristol_scale", direction: "desc" },
        { id: "diet", field: "food", direction: "asc" },
      ],
      groupSettings: { groupBy: "blood_visible", hiddenGroupKeys: ["no"] },
    });

    expect(settings.filterRules.map(({ field }) => field)).toEqual(["bristol_scale"]);
    expect(settings.sortRules.map(({ field }) => field)).toEqual(["bristol_scale"]);
    expect(settings.groupSettings.groupBy).toBe("blood_visible");
    expect(settings.groupSettings.hiddenGroupKeys).toEqual(["no"]);
  });

  it("rewrites duplicate health filter IDs without dropping rules", () => {
    const normalized = normalizeHealthTableSettings("health.diet", {
      filterRules: [
        { id: "duplicate", field: "food", type: "text", operator: "contains", value: "one" },
        { id: "duplicate", field: "food", type: "text", operator: "contains", value: "two" },
      ],
    });

    expect(normalized.filterRules).toHaveLength(2);
    expect(new Set(normalized.filterRules.map((rule) => rule.id)).size).toBe(2);
  });

  it("normalizes every persisted control against the Diet allowlists", () => {
    const settings = normalizeHealthTableSettings("health.diet", {
      filterMode: "or",
      filterRules: [
        { id: "food", field: "food", type: "text", operator: "contains", value: "rice" },
        { id: "drop", field: "amount", type: "number", operator: "greater_than", value: "1" },
      ],
      sortRules: [
        { id: "created", field: "created", direction: "desc" },
        { id: "tag", field: "tags", direction: "asc" },
        { id: "photo", field: "has_photo", direction: "asc" },
        { id: "drop", field: "amount", direction: "desc" },
      ],
      groupSettings: {
        groupBy: "meal_type", sort: "alphabetical", hideEmpty: false,
        manualOrder: ["dinner"], hiddenGroupKeys: ["snack"],
      },
    });

    expect(settings.filterMode).toBe("or");
    expect(settings.filterRules.map(({ field }) => field)).toEqual(["food"]);
    expect(settings.sortRules.map(({ field }) => field)).toEqual(["created"]);
    expect(settings.groupSettings).toEqual({
      groupBy: "meal_type", sort: "alphabetical", hideEmpty: false,
      manualOrder: ["dinner"], hiddenGroupKeys: ["snack"],
    });
  });

  it("does not leak Health-only fields or groups into Planner and Ledger scopes", () => {
    const healthOnly = {
      filterRules: [{
        id: "meal", field: "meal_type", type: "select", operator: "is", value: ["lunch"],
      }],
      sortRules: [{ id: "photo", field: "has_photo", direction: "asc" }],
      groupSettings: { groupBy: "meal_type" },
    };

    expect(normalizePlannerTableSettings("daily.today", healthOnly, legacyControls()).filterRules)
      .toEqual([]);
    expect(normalizePlannerTableSettings("daily.today", healthOnly, legacyControls()).sortRules)
      .toEqual([{ id: "daily.today-default-sort", field: "priority", direction: "asc" }]);
    expect(normalizePlannerTableSettings("daily.today", healthOnly, legacyControls()).groupSettings.groupBy)
      .toBe("none");
    expect(normalizePlannerTableSettings("daily.today", {
      sortRules: healthOnly.sortRules,
    }, legacyControls()).sortRules)
      .toEqual([{ id: "daily.today-default-sort", field: "priority", direction: "asc" }]);
    expect(normalizeLedgerTableSettings("ledger.transactions", healthOnly).filterRules)
      .toEqual([]);
    expect(normalizeLedgerTableSettings("ledger.transactions", healthOnly).sortRules)
      .toEqual([]);
    expect(normalizeLedgerTableSettings("ledger.transactions", healthOnly).groupSettings.groupBy)
      .toBe("none");
  });

  it.each(["weight", "sleep", "crp", "calprotectin", "condition"] as const)(
    "removes Metrics-only field %s from every other scope",
    (field) => {
      const candidate = {
        filterRules: [{ id: field, field, type: "number", operator: "is_not_empty", value: null }],
        sortRules: [{ id: field, field, direction: "asc" }],
        groupSettings: { groupBy: "none" },
      };
      for (const scope of ["health.diet", "health.bowel", "health.medication"] as const) {
        expect(normalizeHealthTableSettings(scope, candidate)).toMatchObject({
          filterRules: [], sortRules: [], groupSettings: { groupBy: "none" },
        });
      }
      expect(normalizeLedgerTableSettings("ledger.transactions", candidate)).toMatchObject({
        filterRules: [], sortRules: [], groupSettings: { groupBy: "none" },
      });
      expect(normalizePlannerTableSettings("daily.today", candidate, legacyControls())).toMatchObject({
        filterRules: [],
        sortRules: [{ id: "daily.today-default-sort", field: "priority", direction: "asc" }],
        groupSettings: { groupBy: "none" },
      });
    },
  );

  it("rejects Health-only values during Planner legacy migration", () => {
    const legacy = legacyControls();
    legacy.filterRules = [{
      id: "meal", field: "meal_type", type: "select", operator: "is", value: ["lunch"],
    }];
    legacy.dailySortRules = [{ id: "photo", field: "has_photo", direction: "asc" }];
    legacy.groupSettings.daily = {
      ...defaultPlannerGroupSettings(),
      groupBy: "meal_type",
    };

    const migrated = normalizePlannerTableSettings("daily.today", undefined, legacy);
    expect(migrated.filterRules).toEqual([]);
    expect(migrated.sortRules).toEqual([]);
    expect(migrated.groupSettings.groupBy).toBe("none");
  });

  it.each([
    ["bristol_scale", "select", ["4"], "bristol_scale"],
    ["blood_visible", "select", ["yes"], "blood_visible"],
  ] as const)("removes persisted Bowel field %s from every non-Bowel scope", (
    field, type, value, groupBy,
  ) => {
    const candidate = {
      filterRules: [{ id: field, field, type, operator: "is", value: [...value] }],
      sortRules: [{ id: field, field, direction: "asc" }],
      groupSettings: { groupBy },
    } satisfies {
      filterRules: PlannerFilterRule[];
      sortRules: PlannerSortRule[];
      groupSettings: { groupBy: PlannerGroupBy };
    };
    const legacy = legacyControls();
    legacy.filterRules = candidate.filterRules;
    legacy.dailySortRules = candidate.sortRules;
    legacy.groupSettings.daily = { ...defaultPlannerGroupSettings(), groupBy };

    for (const scope of ["health.diet", "health.medication"] as const) {
      const normalized = normalizeHealthTableSettings(scope, candidate);
      expect(normalized.filterRules).toEqual([]);
      expect(normalized.sortRules).toEqual([]);
      expect(normalized.groupSettings.groupBy).toBe("none");
    }
    const planner = normalizePlannerTableSettings("daily.today", candidate, legacy);
    expect(planner.filterRules).toEqual([]);
    expect(planner.sortRules).toEqual([{ id: "daily.today-default-sort", field: "priority", direction: "asc" }]);
    expect(planner.groupSettings.groupBy).toBe("none");
    const migrated = normalizePlannerTableSettings("daily.today", undefined, legacy);
    expect(migrated.filterRules).toEqual([]);
    expect(migrated.sortRules).toEqual([]);
    expect(migrated.groupSettings.groupBy).toBe("none");
    const ledger = normalizeLedgerTableSettings("ledger.transactions", candidate);
    expect(ledger.filterRules).toEqual([]);
    expect(ledger.sortRules).toEqual([]);
    expect(ledger.groupSettings.groupBy).toBe("none");
  });

  it.each([
    ["medication_name", "text", "Aspirin", "medication_name"],
    ["medication_unit", "select", ["tablet"], "medication_unit"],
    ["dose", "number", "2", "none"],
  ] as const)("removes Medication-only field %s from every non-Medication scope", (field, type, value, groupBy) => {
    const candidate = {
      filterRules: [{ id: field, field, type, operator: type === "text" ? "contains" : "is", value }],
      sortRules: [{ id: field, field, direction: "asc" }], groupSettings: { groupBy },
    };
    for (const scope of ["health.diet", "health.bowel"] as const) {
      expect(normalizeHealthTableSettings(scope, candidate)).toMatchObject({ filterRules: [], sortRules: [], groupSettings: { groupBy: "none" } });
    }
    expect(normalizeLedgerTableSettings("ledger.transactions", candidate)).toMatchObject({ filterRules: [], sortRules: [], groupSettings: { groupBy: "none" } });
    expect(normalizePlannerTableSettings("daily.today", candidate, legacyControls())).toMatchObject({ filterRules: [], groupSettings: { groupBy: "none" } });
    const legacy = legacyControls();
    legacy.filterRules = candidate.filterRules as PlannerFilterRule[];
    legacy.dailySortRules = candidate.sortRules as PlannerSortRule[];
    legacy.groupSettings.daily = { ...defaultPlannerGroupSettings(), groupBy: groupBy as PlannerGroupBy };
    expect(normalizePlannerTableSettings("daily.today", undefined, legacy)).toMatchObject({ filterRules: [], sortRules: [], groupSettings: { groupBy: "none" } });
  });
});
