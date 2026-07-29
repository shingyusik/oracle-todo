import { describe, expect, it } from "vitest";

import { defaultPlannerGroupSettings } from "@/features/workbench/model/planner-group-settings";
import type { PlannerTableSettings } from "@/features/workbench/model/planner-model";
import {
  collapseWorkspaceGroups,
  deriveWorkspaceViewGroups,
  detailWorkspaceScope,
  workspaceFilterFieldsForScope,
  workspaceScopeForPanel,
  workspaceSortFieldsForScope,
  workspaceTableViewSettingsAdapter,
} from "@/features/workbench/model/workspace-table-views";
import type {
  WorkspaceItemModel,
  WorkspaceItemsModel,
} from "@/features/workbench/model/workbench-model";

const relatedItems: WorkspaceItemsModel["relatedItems"] = {
  areas: { "area-1": "Work", "area-2": "Home" },
  goals: {},
  projects: { "project-1": "Product", "project-2": "Operations" },
  routines: { "routine-1": "Morning" },
};

const tasks: WorkspaceItemModel[] = [
  task("alpha", {
    title: "Alpha",
    priority: 1,
    tags: ["focus", "shared"],
    area_id: "area-1",
  }),
  task("bravo", {
    title: "Bravo",
    priority: 2,
    tags: ["focus"],
    area_id: "area-1",
  }),
  task("charlie", {
    title: "Charlie",
    priority: 3,
    tags: ["ops"],
    area_id: "area-2",
  }),
  task("delta", {
    title: "Delta",
    priority: 4,
    tags: ["ops"],
    area_id: "area-2",
  }),
  task("echo", {
    title: "Echo",
    priority: 5,
    tags: ["shared"],
    area_id: "area-1",
  }),
  task("foxtrot", {
    title: "Foxtrot",
    priority: 6,
    tags: [],
    area_id: "area-2",
    status: "paused",
  }),
];

function task(
  id: string,
  patch: Partial<WorkspaceItemModel>,
): WorkspaceItemModel {
  return {
    id,
    title: id,
    type: "task",
    status: "active",
    updated_at: `2026-07-29T0${id.length}:00:00Z`,
    ...patch,
  };
}

function settings(
  patch: Partial<PlannerTableSettings> = {},
): PlannerTableSettings {
  return {
    filterMode: "and",
    filterRules: [],
    sortRules: [{ id: "priority", field: "priority", direction: "asc" }],
    groupSettings: defaultPlannerGroupSettings(),
    ...patch,
  };
}

describe("workspace table views", () => {
  it("maps every workspace panel and detail pair to an independent stable scope", () => {
    expect([
      workspaceScopeForPanel("areas"),
      workspaceScopeForPanel("projects"),
      workspaceScopeForPanel("goals"),
      workspaceScopeForPanel("routines"),
      workspaceScopeForPanel("tasks"),
      workspaceScopeForPanel("events"),
    ]).toEqual([
      "workspace.area",
      "workspace.project",
      "workspace.goal",
      "workspace.routine",
      "workspace.task",
      "workspace.event",
    ]);
    expect(detailWorkspaceScope("area", "task")).toBe("detail.area.task");
    expect(detailWorkspaceScope("project", "task")).toBe("detail.project.task");
  });

  it("limits filters and sorts to fields that exist on the scoped item type", () => {
    expect(workspaceFilterFieldsForScope("workspace.area")).toEqual([
      "title",
      "status",
      "tags",
      "note",
    ]);
    expect(workspaceFilterFieldsForScope("workspace.goal")).toEqual([
      "title",
      "status",
      "tags",
      "horizon",
      "scheduled",
      "parent",
      "note",
    ]);
    expect(workspaceFilterFieldsForScope("detail.project.task")).toEqual([
      "title",
      "status",
      "tags",
      "area",
      "project",
      "routine",
      "scheduled",
      "due",
      "priority",
      "description",
      "note",
    ]);
    expect(workspaceFilterFieldsForScope("workspace.task")).toContain(
      "routine",
    );
    expect(workspaceFilterFieldsForScope("workspace.area")).not.toContain(
      "routine",
    );
    expect(workspaceSortFieldsForScope("workspace.task")).toContain("updated");
    expect(workspaceSortFieldsForScope("workspace.goal")).toContain("horizon");
  });

  it("normalizes each scope locally and preserves valid sibling rules", () => {
    const normalized = workspaceTableViewSettingsAdapter.normalizeSettings(
      "workspace.goal",
      {
        filterMode: "or",
        filterRules: [
          {
            id: "keep",
            field: "horizon",
            type: "select",
            operator: "is",
            value: ["month"],
          },
          {
            id: "drop",
            field: "routine",
            type: "relation",
            operator: "is",
            value: ["routine-1"],
          },
        ],
        sortRules: [
          { id: "keep-sort", field: "updated", direction: "desc" },
          { id: "drop-sort", field: "priority", direction: "asc" },
        ],
        groupSettings: { groupBy: "area", sort: "manual", hideEmpty: true },
      },
    );

    expect(normalized.filterMode).toBe("or");
    expect(normalized.filterRules.map((rule) => rule.id)).toEqual(["keep"]);
    expect(normalized.sortRules.map((rule) => rule.id)).toEqual(["keep-sort"]);
    expect(normalized.groupSettings.groupBy).toBe("none");
  });

  it("filters, sorts, and groups workspace rows with Planner semantics", () => {
    const groups = deriveWorkspaceViewGroups(
      "detail.area.task",
      tasks,
      settings({
        filterRules: [
          {
            id: "active",
            field: "status",
            type: "select",
            operator: "is",
            value: ["active"],
          },
        ],
        groupSettings: { ...defaultPlannerGroupSettings(), groupBy: "area" },
      }),
      relatedItems,
    );

    expect(groups).toEqual([
      { key: "area-1", label: "Work", items: [tasks[0], tasks[1], tasks[4]] },
      { key: "area-2", label: "Home", items: [tasks[2], tasks[3]] },
    ]);
  });

  it("caps rendered rows globally and changes overflow after filtering", () => {
    const groups = deriveWorkspaceViewGroups(
      "detail.area.task",
      tasks,
      settings(),
      relatedItems,
    );
    const collapsed = collapseWorkspaceGroups(groups);
    const filteredGroups = deriveWorkspaceViewGroups(
      "detail.area.task",
      tasks,
      settings({
        filterRules: [
          {
            id: "area",
            field: "area",
            type: "relation",
            operator: "is",
            value: ["area-1"],
          },
        ],
      }),
      relatedItems,
    );

    expect(collapsed.visibleCount).toBe(5);
    expect(collapsed.hiddenCount).toBe(1);
    expect(collapsed.groups.flatMap((group) => group.items)).toHaveLength(5);
    expect(collapseWorkspaceGroups(filteredGroups)).toMatchObject({
      visibleCount: 3,
      hiddenCount: 0,
    });
  });

  it("counts tag duplicates as rendered rows and omits emptied trailing groups", () => {
    const groups = deriveWorkspaceViewGroups(
      "detail.area.task",
      tasks,
      settings({
        groupSettings: { ...defaultPlannerGroupSettings(), groupBy: "tag" },
      }),
      relatedItems,
    );
    const collapsed = collapseWorkspaceGroups(groups, 5);

    expect(groups.flatMap((group) => group.items)).toHaveLength(7);
    expect(collapsed).toMatchObject({ visibleCount: 5, hiddenCount: 2 });
    expect(collapsed.groups.map((group) => group.key)).toEqual([
      "focus",
      "ops",
      "shared",
    ]);
    expect(
      collapsed.groups.flatMap((group) => group.items).map((item) => item.id),
    ).toEqual(["alpha", "bravo", "charlie", "delta", "alpha"]);
  });
});
