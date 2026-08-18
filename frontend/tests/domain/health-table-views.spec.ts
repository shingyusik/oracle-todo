import { describe, expect, it } from "vitest";

import {
  defaultHealthTableSettings,
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
  it("defines the Diet scope controls and defaults", () => {
    expect(healthTableScopeIds).toEqual(["health.diet"]);
    expect(healthFilterFieldsForScope("health.diet")).toEqual([
      "date", "meal_type", "food", "tags", "has_photo",
    ]);
    expect(healthSortFieldsForScope("health.diet")).toEqual([
      "date", "meal_type", "food", "tags", "has_photo", "updated",
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
    expect(settings.sortRules.map(({ field }) => field)).toEqual(["has_photo"]);
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
    expect(normalizePlannerTableSettings("daily.today", healthOnly, legacyControls()).groupSettings.groupBy)
      .toBe("none");
    expect(normalizeLedgerTableSettings("ledger.transactions", healthOnly).filterRules)
      .toEqual([]);
    expect(normalizeLedgerTableSettings("ledger.transactions", healthOnly).groupSettings.groupBy)
      .toBe("none");
  });
});
