import { describe, expect, it } from "vitest";

import {
  buildDailyPlannerModel,
  buildMonthlyPeriodGoalCardsModel,
  buildWeeklyPlannerModel,
  buildYearlyPeriodGoalCardsModel,
  filterPlannerItemsByRules,
  groupPlannerItems,
  matchesPlannerFilterRules,
  sortPlannerItems,
  type PlannerFilterRule,
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

function buildDaily(
  filters: Partial<Parameters<typeof buildDailyPlannerModel>[2]["filters"]> = {},
  groupBy: Parameters<typeof buildDailyPlannerModel>[2]["groupBy"] = "none",
  date = "2026-07-06",
) {
  return buildDailyPlannerModel(items, relatedItems, {
    date,
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
    sortRules: [{ id: "sort-priority", field: "priority", direction: "asc" }],
  });
}

function item(
  id: string,
  patch: Partial<WorkspaceItemModel>,
): WorkspaceItemModel {
  return {
    id,
    title: id,
    type: "task",
    status: "active",
    ...patch,
  };
}

describe("planner model", () => {
  it("sorts planner items by scheduled with unscheduled first matching existing compare behavior", () => {
    const result = sortPlannerItems(
      [
        item("late", { scheduled: "2026-07-09T10:00:00", priority: 3 }),
        item("none", { scheduled: null, priority: 1 }),
        item("early", { scheduled: "2026-07-07T09:00:00", priority: 2 }),
      ],
      [{ id: "sort-scheduled", field: "scheduled", direction: "asc" }],
    );

    expect(result.map((entry) => entry.id)).toEqual(["none", "early", "late"]);
  });

  it("sorts planner items by multiple rules in order", () => {
    const result = sortPlannerItems(
      [
        item("b-low", { title: "B", priority: 1 }),
        item("a-high", { title: "A", priority: 2 }),
        item("a-low", { title: "A", priority: 1 }),
      ],
      [
        { id: "sort-title", field: "title", direction: "asc" },
        { id: "sort-priority", field: "priority", direction: "desc" },
      ],
    );

    expect(result.map((entry) => entry.id)).toEqual(["a-high", "a-low", "b-low"]);
  });

  it("groups planner items by tag and keeps untagged items visible", () => {
    const result = groupPlannerItems(
      [
        item("focus", { tags: ["focus"] }),
        item("ops", { tags: ["ops", "focus"] }),
        item("empty", { tags: [] }),
      ],
      relatedItems,
      "tag",
    );

    expect(result.map((group) => [group.label, group.items.map((entry) => entry.id)])).toEqual([
      ["focus", ["focus", "ops"]],
      ["ops", ["ops"]],
      ["Untagged", ["empty"]],
    ]);
  });

  it("groups planner items by related area labels", () => {
    const result = groupPlannerItems(
      [
        item("work", { area_id: "area-1" }),
        item("none", { area_id: null }),
      ],
      relatedItems,
      "area",
    );

    expect(result.map((group) => group.label)).toEqual(["Work", "No value"]);
  });

  it("matches text, multi-select, and relation planner filter rules with and", () => {
    const rules: PlannerFilterRule[] = [
      { id: "r1", field: "title", type: "text", operator: "contains", value: "plan" },
      { id: "r2", field: "tags", type: "multiSelect", operator: "contains", value: ["focus"] },
      { id: "r3", field: "area", type: "relation", operator: "contains", value: ["area-1"] },
    ];

    expect(
      matchesPlannerFilterRules(
        {
          id: "task-1",
          title: "Plan filter UI",
          type: "task",
          status: "active",
          tags: ["focus"],
          area_id: "area-1",
        },
        relatedItems,
        rules,
        "and",
        "2026-07-08",
      ),
    ).toBe(true);
  });

  it("filters planner item lists through advanced rules", () => {
    const result = filterPlannerItemsByRules(
      [
        {
          id: "task-1",
          type: "task",
          title: "Plan API",
          status: "active",
          scheduled: "2026-07-08",
          tags: ["api"],
        },
        {
          id: "task-2",
          type: "task",
          title: "Write Notes",
          status: "active",
          scheduled: "2026-07-08",
          tags: ["writing"],
        },
      ],
      relatedItems,
      [
        {
          id: "r1",
          field: "tags",
          type: "multiSelect",
          operator: "contains",
          value: ["api"],
        },
      ],
      "and",
      "2026-07-08",
    );

    expect(result.map((item) => item.id)).toEqual(["task-1"]);
  });

  it("matches at least one planner filter rule with or", () => {
    const rules: PlannerFilterRule[] = [
      { id: "r1", field: "title", type: "text", operator: "contains", value: "missing" },
      { id: "r2", field: "status", type: "select", operator: "contains", value: ["active"] },
    ];

    expect(
      matchesPlannerFilterRules(
        { id: "task-1", title: "Plan", type: "task", status: "active" },
        relatedItems,
        rules,
        "or",
        "2026-07-08",
      ),
    ).toBe(true);
  });

  it("matches date and empty planner filter operators", () => {
    const rules: PlannerFilterRule[] = [
      {
        id: "r1",
        field: "scheduled",
        type: "date",
        operator: "is_between",
        value: { start: "2026-07-01", end: "2026-07-31" },
      },
      { id: "r2", field: "due", type: "date", operator: "is_empty", value: null },
    ];

    expect(
      matchesPlannerFilterRules(
        {
          id: "task-1",
          title: "Plan",
          type: "task",
          status: "active",
          scheduled: "2026-07-08",
          due: null,
        },
        relatedItems,
        rules,
        "and",
        "2026-07-08",
      ),
    ).toBe(true);
  });

  it("does not match empty scheduled values with date comparison operators", () => {
    expect(
      matchesPlannerFilterRules(
        {
          id: "task-1",
          title: "Plan",
          type: "task",
          status: "active",
          scheduled: null,
        },
        relatedItems,
        [
          {
            id: "r1",
            field: "scheduled",
            type: "date",
            operator: "is_before",
            value: "2026-07-08",
          },
        ],
        "and",
        "2026-07-08",
      ),
    ).toBe(false);
  });

  it("does not match empty priority values with number comparison operators", () => {
    expect(
      matchesPlannerFilterRules(
        {
          id: "task-1",
          title: "Plan",
          type: "task",
          status: "active",
          priority: null,
        },
        relatedItems,
        [
          {
            id: "r1",
            field: "priority",
            type: "number",
            operator: "less_than",
            value: "1",
          },
        ],
        "and",
        "2026-07-08",
      ),
    ).toBe(false);
  });

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
    expect(model.sections.today.groups[0]?.items.map((item) => item.id)).not.toContain(
      "project-match",
    );
  });

  it("labels daily sections from the selected reference date", () => {
    const result = buildDaily({}, "none", "2026-07-06");

    expect(result.sections.today.title).toBe("July 6, 2026");
    expect(result.sections.overdue.title).toBe("Before July 6, 2026");
    expect(result.sections.upcoming.title).toBe("After July 6, 2026");
    expect(result.sections.unscheduled.title).toBe("Unscheduled");
    expect(result.sections.today.groups[0]?.items.map((item) => item.id)).toContain(
      "task-focus",
    );
    expect(result.sections.overdue.groups[0]?.items.map((item) => item.id)).toContain(
      "task-overdue",
    );
    expect(result.sections.upcoming.groups[0]?.items.map((item) => item.id)).toContain(
      "task-upcoming",
    );
  });

  it.each([
    ["area", ["Home", "Work"]],
    ["project", ["Ops", "Planner"]],
    ["routine", ["Evening", "Morning"]],
    ["tag", ["deep-work", "focus", "habit", "ops"]],
    ["item_type", ["routine", "task"]],
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
        {
          id: "area",
          type: "area",
          title: "Area Marker",
          status: "active",
          scheduled: "2026-07-06",
        },
        {
          id: "project",
          type: "project",
          title: "Project Marker",
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

  it("builds yearly carousel cards and twelve month buckets", () => {
    const model = buildYearlyPeriodGoalCardsModel(
      [
        item("previous-year", {
          type: "goal",
          horizon: "year",
          scheduled: "2025-01-01",
        }),
        item("selected-year", {
          type: "goal",
          horizon: "year",
          scheduled: "2026-01-01",
        }),
        item("next-year", {
          type: "goal",
          horizon: "year",
          scheduled: "2027-01-01",
        }),
        item("january", {
          type: "goal",
          horizon: "month",
          scheduled: "2026-01-01",
        }),
        item("december", {
          type: "goal",
          horizon: "month",
          scheduled: "2026-12-01",
        }),
        item("done", {
          type: "goal",
          horizon: "month",
          status: "completed",
          scheduled: "2026-02-01",
        }),
      ],
      "2026-07-08",
    );

    expect(model.carousel.map((card) => [card.position, card.periodStart, card.goals.map((goal) => goal.id)])).toEqual([
      ["previous", "2025-01-01", ["previous-year"]],
      ["selected", "2026-01-01", ["selected-year"]],
      ["next", "2027-01-01", ["next-year"]],
    ]);
    expect(model.months).toHaveLength(12);
    expect(model.months[0]).toEqual(
      expect.objectContaining({
        label: "Jan",
        periodStart: "2026-01-01",
      }),
    );
    expect(model.months[0]?.goals.map((goal) => goal.id)).toEqual(["january"]);
    expect(model.months[1]?.goals).toEqual([]);
    expect(model.months[11]?.goals.map((goal) => goal.id)).toEqual(["december"]);
  });

  it("builds monthly carousel cards and ISO Monday week buckets intersecting the month", () => {
    const model = buildMonthlyPeriodGoalCardsModel(
      [
        item("previous-month", {
          type: "goal",
          horizon: "month",
          scheduled: "2025-12-01",
        }),
        item("selected-month", {
          type: "goal",
          horizon: "month",
          scheduled: "2026-01-01",
        }),
        item("next-month", {
          type: "goal",
          horizon: "month",
          scheduled: "2026-02-01",
        }),
        item("week-crosses-year", {
          type: "goal",
          horizon: "week",
          scheduled: "2025-12-29",
        }),
        item("week-inside-month", {
          type: "goal",
          horizon: "week",
          scheduled: "2026-01-05",
        }),
        item("archived-week", {
          type: "goal",
          horizon: "week",
          status: "archived",
          scheduled: "2026-01-12",
        }),
      ],
      "2026-01-15",
    );

    expect(model.carousel.map((card) => [card.position, card.periodStart, card.goals.map((goal) => goal.id)])).toEqual([
      ["previous", "2025-12-01", ["previous-month"]],
      ["selected", "2026-01-01", ["selected-month"]],
      ["next", "2026-02-01", ["next-month"]],
    ]);
    expect(model.weeks.map((week) => [week.label, week.periodStart])).toEqual([
      ["W1", "2025-12-29"],
      ["W2", "2026-01-05"],
      ["W3", "2026-01-12"],
      ["W4", "2026-01-19"],
      ["W5", "2026-01-26"],
    ]);
    expect(model.weeks[0]?.goals.map((goal) => goal.id)).toEqual(["week-crosses-year"]);
    expect(model.weeks[1]?.goals.map((goal) => goal.id)).toEqual(["week-inside-month"]);
    expect(model.weeks[2]?.goals).toEqual([]);
  });
});
