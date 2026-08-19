import { describe, expect, it } from "vitest";

import {
  defaultHealthTableSettings,
  healthDietFilterSelectOptions,
  healthFilterFieldsForScope,
  healthGroupOptionsForScope,
  healthSortFieldsForScope,
  healthTableScopeIds,
  normalizeHealthTableSettings,
} from "@/features/health/model/health-table-views";
import { normalizeLedgerTableSettings } from "@/features/ledger/model/ledger-table-views";
import { defaultPlannerGroupSettings } from "@/features/workbench/model/planner-group-settings";
import { normalizePlannerTableSettings } from "@/features/workbench/model/planner-model";
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

  it("defines the Diet scope controls and defaults", () => {
    expect(healthTableScopeIds).toEqual(["health.diet"]);
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
});
