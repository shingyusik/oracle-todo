import { describe, expect, it } from "vitest";

import {
  buildDailyPlannerModel,
  buildWeeklyPlannerModel,
} from "@/features/workbench/model/planner-model";
import type { WorkspaceItemModel, WorkspaceItemsModel } from "@/features/workbench/model/workbench-model";

const relatedItems: WorkspaceItemsModel["relatedItems"] = {
  areas: { "area-1": "Work", "area-2": "Home" },
  goals: {},
  projects: { "project-1": "Planner", "project-2": "Ops" },
  routines: { "routine-1": "Morning", "routine-2": "Evening" },
};

const items: WorkspaceItemModel[] = [
  {
    id: "task-focus",
    type: "task",
    title: "Focus block",
    status: "active",
    scheduled: "2026-07-06",
    priority: 1,
    area_id: "area-1",
    project_id: "project-1",
    routine_id: "routine-1",
    tags: ["deep-work", "focus"],
    updated_at: "2026-07-06T08:00:00Z",
  },
  {
    id: "task-ops",
    type: "task",
    title: "Ops review",
    status: "active",
    scheduled: "2026-07-06",
    priority: 2,
    area_id: "area-1",
    project_id: "project-1",
    routine_id: "routine-2",
    tags: ["ops"],
    updated_at: "2026-07-06T07:00:00Z",
  },
  {
    id: "project-match",
    type: "project",
    title: "Project planning",
    status: "approved",
    scheduled: "2026-07-06",
    area_id: "area-1",
    project_id: "project-1",
    routine_id: "routine-1",
    tags: ["planning"],
    updated_at: "2026-07-06T06:00:00Z",
  },
  {
    id: "routine-match",
    type: "routine",
    title: "Morning routine",
    status: "approved",
    scheduled: "2026-07-06",
    area_id: "area-1",
    project_id: "project-1",
    routine_id: "routine-1",
    tags: ["habit"],
    updated_at: "2026-07-06T05:00:00Z",
  },
  {
    id: "wrong-area",
    type: "task",
    title: "Home focus",
    status: "active",
    scheduled: "2026-07-06",
    area_id: "area-2",
    project_id: "project-1",
    routine_id: "routine-1",
    tags: ["deep-work"],
    updated_at: "2026-07-06T04:00:00Z",
  },
  {
    id: "wrong-project",
    type: "task",
    title: "Ops backlog",
    status: "active",
    scheduled: "2026-07-06",
    area_id: "area-1",
    project_id: "project-2",
    routine_id: "routine-1",
    tags: ["ops"],
    updated_at: "2026-07-06T03:00:00Z",
  },
  {
    id: "task-overdue",
    type: "task",
    title: "Yesterday",
    status: "active",
    scheduled: "2026-07-05",
    priority: 5,
    tags: ["admin"],
    updated_at: "2026-07-05T08:00:00Z",
  },
  {
    id: "task-upcoming",
    type: "task",
    title: "Tomorrow",
    status: "active",
    scheduled: "2026-07-07",
    priority: 4,
    tags: ["admin"],
    updated_at: "2026-07-06T09:00:00Z",
  },
  {
    id: "done",
    type: "task",
    title: "Done",
    status: "completed",
    scheduled: "2026-07-06",
    tags: ["deep-work"],
  },
  {
    id: "archived",
    type: "task",
    title: "Archived",
    status: "archived",
    scheduled: "2026-07-06",
    tags: ["ops"],
  },
  {
    id: "unscheduled",
    type: "task",
    title: "Loose",
    status: "active",
    tags: ["deep-work"],
  },
];

function buildDaily(filters: Partial<Parameters<typeof buildDailyPlannerModel>[2]["filters"]> = {}, groupBy: Parameters<typeof buildDailyPlannerModel>[2]["groupBy"] = "none") {
  return buildDailyPlannerModel(items, relatedItems, {
    date: "2026-07-06",
    filters: {
      tags: [],
      areaIds: [],
      projectIds: [],
      routineIds: [],
      itemTypes: [],
      statuses: [],
      ...filters,
    },
    groupBy,
    sortBy: "priority",
  });
}

describe("planner model", () => {
  it("uses AND across filter categories and OR inside multi-select values", () => {
    const model = buildDaily({
      tags: ["deep-work", "ops"],
      areaIds: ["area-1"],
      projectIds: ["project-1"],
    });

    expect(model.sections.today.groups[0]?.items.map((item) => item.id)).toEqual([
      "task-focus",
      "task-ops",
    ]);
    expect(model.sections.today.groups[0]?.items.map((item) => item.id)).not.toContain("wrong-area");
    expect(model.sections.today.groups[0]?.items.map((item) => item.id)).not.toContain("wrong-project");
  });

  it("applies project, routine, item type, and status filters together", () => {
    const model = buildDaily({
      projectIds: ["project-1"],
      routineIds: ["routine-1"],
      itemTypes: ["routine"],
      statuses: ["approved"],
    });

    expect(model.sections.today.groups[0]?.items.map((item) => item.id)).toEqual([
      "routine-match",
    ]);
  });

  it("places visible work into today, overdue, upcoming, and unscheduled sections", () => {
    const model = buildDaily();

    expect(model.sections.today.groups[0]?.items.map((item) => item.id)).toEqual([
      "task-focus",
      "task-ops",
      "project-match",
      "routine-match",
      "wrong-area",
      "wrong-project",
    ]);
    expect(model.sections.overdue.groups[0]?.items.map((item) => item.id)).toEqual([
      "task-overdue",
    ]);
    expect(model.sections.upcoming.groups[0]?.items.map((item) => item.id)).toEqual([
      "task-upcoming",
    ]);
    expect(model.sections.unscheduled.groups[0]?.items.map((item) => item.id)).toEqual([
      "unscheduled",
    ]);
  });

  it.each([
    ["area", ["Home", "Work"]],
    ["project", ["Ops", "Planner"]],
    ["routine", ["Evening", "Morning"]],
    ["tag", ["deep-work", "focus", "habit", "ops", "planning"]],
    ["item_type", ["project", "routine", "task"]],
    ["status", ["active", "approved"]],
  ] as const)("groups today items by %s with expected labels", (groupBy, labels) => {
    const model = buildDaily({}, groupBy);

    expect(model.sections.today.groups.map((group) => group.label).sort()).toEqual(labels);
  });

  it("keeps completed and archived items hidden in daily and weekly models", () => {
    const daily = buildDaily();
    const weekly = buildWeeklyPlannerModel(
      [
        {
          id: "month-goal-active",
          type: "goal",
          title: "July Goal",
          status: "active",
          horizon: "month",
          scheduled: "2026-07-01",
        },
        {
          id: "month-goal-completed",
          type: "goal",
          title: "Done Goal",
          status: "completed",
          horizon: "month",
          scheduled: "2026-07-02",
        },
        {
          id: "week-goal-active",
          type: "goal",
          title: "Week Goal",
          status: "active",
          horizon: "week",
          scheduled: "2026-07-06",
        },
        {
          id: "week-goal-archived",
          type: "goal",
          title: "Archived Goal",
          status: "archived",
          horizon: "week",
          scheduled: "2026-07-07",
        },
        {
          id: "task-active",
          type: "task",
          title: "Monday Task",
          status: "active",
          scheduled: "2026-07-06",
        },
        {
          id: "task-completed",
          type: "task",
          title: "Done Task",
          status: "completed",
          scheduled: "2026-07-06",
        },
      ],
      "2026-07-06",
    );

    const visibleDailyIds = daily.sections.today.groups.flatMap((group) =>
      group.items.map((item) => item.id),
    );

    expect(visibleDailyIds).not.toContain("done");
    expect(visibleDailyIds).not.toContain("archived");
    expect(weekly.monthGoals.map((item) => item.id)).toEqual(["month-goal-active"]);
    expect(weekly.weekGoals.map((item) => item.id)).toEqual(["week-goal-active"]);
    expect(weekly.days[0].items.map((item) => item.id)).toEqual(["task-active"]);
  });

  it("builds weekly goals and seven day columns", () => {
    const weekly = buildWeeklyPlannerModel(
      [
        {
          id: "month-goal",
          type: "goal",
          title: "July Goal",
          status: "active",
          horizon: "month",
          scheduled: "2026-07-01",
        },
        {
          id: "week-goal",
          type: "goal",
          title: "Week Goal",
          status: "active",
          horizon: "week",
          scheduled: "2026-07-06",
        },
        {
          id: "task",
          type: "task",
          title: "Monday Task",
          status: "active",
          scheduled: "2026-07-06",
        },
      ],
      "2026-07-06",
    );

    expect(weekly.monthGoals.map((item) => item.id)).toEqual(["month-goal"]);
    expect(weekly.weekGoals.map((item) => item.id)).toEqual(["week-goal"]);
    expect(weekly.days).toHaveLength(7);
    expect(weekly.days[0].items.map((item) => item.id)).toEqual(["task"]);
  });
});
