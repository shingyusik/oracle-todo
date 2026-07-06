import { describe, expect, it } from "vitest";

import {
  buildDailyPlannerModel,
  buildWeeklyPlannerModel,
} from "@/features/workbench/model/planner-model";
import type { WorkspaceItemModel, WorkspaceItemsModel } from "@/features/workbench/model/workbench-model";

const relatedItems: WorkspaceItemsModel["relatedItems"] = {
  areas: { "area-1": "Work" },
  goals: {},
  projects: { "project-1": "Planner" },
  routines: { "routine-1": "Morning" },
};

const items: WorkspaceItemModel[] = [
  {
    id: "task-today",
    type: "task",
    title: "Today high",
    status: "active",
    scheduled: "2026-07-06",
    priority: 1,
    area_id: "area-1",
    project_id: "project-1",
    tags: ["deep-work"],
    updated_at: "2026-07-06T08:00:00Z",
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
    id: "done",
    type: "task",
    title: "Done",
    status: "completed",
    scheduled: "2026-07-06",
    tags: ["deep-work"],
  },
  {
    id: "unscheduled",
    type: "task",
    title: "Loose",
    status: "active",
    tags: ["deep-work"],
  },
];

describe("planner model", () => {
  it("builds daily sections, hides completed items, and filters by tag and area", () => {
    const model = buildDailyPlannerModel(items, relatedItems, {
      date: "2026-07-06",
      filters: {
        tags: ["deep-work"],
        areaIds: ["area-1"],
        projectIds: [],
        routineIds: [],
        itemTypes: [],
        statuses: [],
      },
      groupBy: "area",
      sortBy: "priority",
    });

    expect(model.sections.today.groups[0]).toMatchObject({
      label: "Work",
      items: [expect.objectContaining({ id: "task-today" })],
    });
    expect(model.sections.overdue.groups).toEqual([]);
    expect(model.sections.unscheduled.groups).toEqual([]);
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
