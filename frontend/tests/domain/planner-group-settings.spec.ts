import { describe, expect, it } from "vitest";

import {
  buildPlannerGroupCandidates,
  defaultPlannerGroupSettings,
  moveManualGroup,
  normalizePlannerGroupSettings,
  orderVisiblePlannerGroups,
  plannerGroupStorageKey,
  type PlannerGroupCandidate,
} from "@/features/workbench/model/planner-group-settings";
import type { WorkspaceItemModel, WorkspaceItemsModel } from "@/features/workbench/model/workbench-model";

const relatedItems: WorkspaceItemsModel["relatedItems"] = {
  areas: { "area-1": "Work" },
  goals: {},
  projects: { "project-1": "Planner" },
  routines: { "routine-1": "Morning" },
};

function item(id: string, patch: Partial<WorkspaceItemModel>): WorkspaceItemModel {
  return {
    id,
    title: id,
    type: "task",
    status: "active",
    ...patch,
  };
}

function candidate(key: string, label: string, count = 1): PlannerGroupCandidate {
  return { key, label, count };
}

describe("planner group settings", () => {
  it("uses independent versioned storage keys", () => {
    expect(plannerGroupStorageKey("yearly")).toBe(
      "oracle-todo.planner-group-settings.v1.yearly",
    );
    expect(plannerGroupStorageKey("daily")).toBe(
      "oracle-todo.planner-group-settings.v1.daily",
    );
  });

  it("normalizes partial or malformed stored values", () => {
    expect(normalizePlannerGroupSettings(null)).toEqual(defaultPlannerGroupSettings());
    expect(
      normalizePlannerGroupSettings({
        groupBy: "tag",
        sort: "alphabetical",
        hideEmpty: false,
        manualOrder: ["focus", 4, "focus"],
        hiddenGroupKeys: ["ops", null],
      }),
    ).toEqual({
      groupBy: "tag",
      sort: "alphabetical",
      hideEmpty: false,
      manualOrder: ["focus"],
      hiddenGroupKeys: ["ops"],
    });
  });

  it("builds relation, missing-value, and multi-tag candidates", () => {
    const candidates = buildPlannerGroupCandidates({
      view: "daily",
      groupBy: "tag",
      items: [item("a", { tags: ["focus", "ops"] }), item("b", { tags: [] })],
      relatedItems,
    });

    expect(candidates.map(({ key, label, count }) => ({ key, label, count }))).toEqual([
      { key: "focus", label: "focus", count: 1 },
      { key: "ops", label: "ops", count: 1 },
      { key: "untagged", label: "Untagged", count: 1 },
    ]);
  });

  it("orders visible groups and appends unknown manual keys in candidate order", () => {
    const candidates = [candidate("b", "Beta"), candidate("a", "Alpha")];

    expect(
      orderVisiblePlannerGroups(candidates, {
        ...defaultPlannerGroupSettings(),
        groupBy: "tag",
        manualOrder: ["a"],
      }).map((group) => group.key),
    ).toEqual(["a", "b"]);
    expect(
      orderVisiblePlannerGroups(candidates, {
        ...defaultPlannerGroupSettings(),
        groupBy: "tag",
        sort: "reverse_alphabetical",
      }).map((group) => group.key),
    ).toEqual(["b", "a"]);
  });

  it("hides empty and explicitly hidden groups", () => {
    expect(
      orderVisiblePlannerGroups(
        [candidate("shown", "Shown", 1), candidate("empty", "Empty", 0), candidate("hidden", "Hidden", 1)],
        {
          ...defaultPlannerGroupSettings(),
          hiddenGroupKeys: ["hidden"],
        },
      ).map((group) => group.key),
    ).toEqual(["shown"]);
  });

  it("moves manual group keys without mutating the source order", () => {
    const order = ["a", "b", "c"];

    expect(moveManualGroup(order, "b", -1)).toEqual(["b", "a", "c"]);
    expect(order).toEqual(["a", "b", "c"]);
  });
});
