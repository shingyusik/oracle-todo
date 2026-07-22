import { describe, expect, it } from "vitest";

import {
  buildPlannerGroupCandidates,
  defaultPlannerGroupSettings,
} from "@/features/workbench/model/planner-group-settings";
import {
  buildDailyPlannerSections,
  buildDailyPlannerModel,
  buildMonthlyPeriodGoalCardsModel,
  buildWeeklyPlannerModel,
  buildYearlyPeriodGoalCardsModel,
  filterPlannerItemsByRules,
  groupPlannerItems,
  matchesPlannerFilterRules,
  defaultPlannerTableSettings,
  normalizePlannerTableSettings,
  plannerTableIds,
  sortPlannerItems,
  type PlannerFilterRule,
} from "@/features/workbench/model/planner-model";
import type {
  LegacyPlannerControls,
  WorkspaceItemModel,
  WorkspaceItemsModel,
} from "@/features/workbench/model/workbench-model";

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
    status: "active",
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
    status: "active",
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
  groupBy: Parameters<typeof buildDailyPlannerModel>[2]["groupSettings"]["groupBy"] = "none",
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
    groupSettings: { ...defaultPlannerGroupSettings(), groupBy },
    groupCandidates: buildPlannerGroupCandidates({ view: "daily", groupBy, items, relatedItems }),
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

function legacyPlannerControls(): LegacyPlannerControls {
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

describe("planner model", () => {
  it("defines stable planner table identifiers", () => {
    expect(plannerTableIds).toEqual([
      "daily.today", "daily.overdue", "daily.unscheduled",
      "weekly.month-goals", "weekly.week-goals", "weekly.day-grid",
      "monthly.period-goals", "monthly.calendar", "monthly.week-goals",
      "yearly.period-goals", "yearly.month-goals",
    ]);
  });

  it("creates independently mutable planner table defaults", () => {
    const first = defaultPlannerTableSettings("daily.today");
    const second = defaultPlannerTableSettings("daily.today");

    first.sortRules[0]!.id = "changed";
    first.groupSettings.manualOrder.push("area-1");
    first.groupSettings.hiddenGroupKeys.push("area-2");

    expect(second.sortRules[0]!.id).toBe("daily.today-default-sort");
    expect(second.groupSettings.manualOrder).toEqual([]);
    expect(second.groupSettings.hiddenGroupKeys).toEqual([]);
  });

  it("deeply isolates nested legacy settings for each migrated table", () => {
    const legacy = legacyPlannerControls();
    legacy.filterRules = [
      { id: "tags", field: "tags", type: "multiSelect", operator: "contains", value: ["focus"] },
      {
        id: "range",
        field: "scheduled",
        type: "date",
        operator: "is_between",
        value: { start: "2026-07-01", end: "2026-07-31" },
      },
    ];
    legacy.groupSettings.daily = {
      ...defaultPlannerGroupSettings(),
      manualOrder: ["area-1"],
      hiddenGroupKeys: ["area-2"],
    };

    const first = normalizePlannerTableSettings("daily.today", undefined, legacy);
    const second = normalizePlannerTableSettings("daily.overdue", undefined, legacy);
    (first.filterRules[0]!.value as string[]).push("ops");
    (first.filterRules[1]!.value as { start: string; end: string }).start = "2026-07-02";
    first.groupSettings.manualOrder.push("area-3");
    first.groupSettings.hiddenGroupKeys.push("area-4");

    expect(second.filterRules[0]!.value).toEqual(["focus"]);
    expect(second.filterRules[1]!.value).toEqual({ start: "2026-07-01", end: "2026-07-31" });
    expect(second.groupSettings.manualOrder).toEqual(["area-1"]);
    expect(second.groupSettings.hiddenGroupKeys).toEqual(["area-2"]);
  });

  it("uses table defaults for partial persisted settings instead of legacy filter mode", () => {
    const legacy = legacyPlannerControls();
    legacy.filterMode = "or";

    const partial = normalizePlannerTableSettings("daily.today", {
      filterRules: [{ id: "invalid", field: "unknown" }],
    }, legacy);
    const neighboring = normalizePlannerTableSettings("daily.overdue", {
      filterMode: "or",
      filterRules: [{ id: "title", field: "title", type: "text", operator: "contains", value: "plan" }],
    }, legacy);

    expect(partial.filterMode).toBe("and");
    expect(partial.filterRules).toEqual([]);
    expect(neighboring.filterMode).toBe("or");
    expect(neighboring.filterRules).toEqual([
      { id: "title", field: "title", type: "text", operator: "contains", value: "plan" },
    ]);
  });

  it.each([null, "malformed", []] as const)(
    "uses table defaults when a persisted settings candidate is malformed: %j",
    (candidate) => {
      const legacy = legacyPlannerControls();
      legacy.filterMode = "or";
      legacy.filterRules = [
        { id: "legacy-filter", field: "title", type: "text", operator: "contains", value: "legacy" },
      ];
      legacy.dailySortRules = [{ id: "legacy-sort", field: "title", direction: "desc" }];
      legacy.groupSettings.daily = {
        ...defaultPlannerGroupSettings(),
        groupBy: "area",
      };

      expect(normalizePlannerTableSettings("daily.today", candidate, legacy)).toEqual(
        defaultPlannerTableSettings("daily.today"),
      );
    },
  );

  it("strictly validates legacy settings before migrating them", () => {
    const legacy = legacyPlannerControls();
    legacy.filterMode = "or";
    legacy.filterRules = [
      { id: "valid-filter", field: "title", type: "text", operator: "contains", value: "legacy" },
      { id: "malformed-filter", field: "scheduled", type: "date", operator: "is", value: "not-a-date" },
    ] as PlannerFilterRule[];
    legacy.dailySortRules = [
      { id: "valid-sort", field: "title", direction: "desc" },
      { id: "malformed-sort", field: "unknown", direction: "asc" },
    ] as never;
    legacy.groupSettings.daily = {
      groupBy: "area",
      sort: "manual",
      hideEmpty: true,
      manualOrder: ["area-1", 3],
      hiddenGroupKeys: ["area-2", null],
    } as never;

    const migrated = normalizePlannerTableSettings("daily.today", undefined, legacy);

    expect(migrated.filterMode).toBe("or");
    expect(migrated.filterRules).toEqual([
      { id: "valid-filter", field: "title", type: "text", operator: "contains", value: "legacy" },
    ]);
    expect(migrated.sortRules).toEqual(defaultPlannerTableSettings("daily.today").sortRules);
    expect(migrated.groupSettings).toEqual({
      ...defaultPlannerGroupSettings(),
      groupBy: "area",
      manualOrder: ["area-1"],
      hiddenGroupKeys: ["area-2"],
    });
  });

  it("falls back only the malformed persisted table settings", () => {
    const legacy = legacyPlannerControls();
    const malformed = normalizePlannerTableSettings("daily.today", {
      filterMode: "or",
      filterRules: [
        { id: "unknown-field", field: "unknown", type: "text", operator: "contains", value: "x" },
        { id: "wrong-combination", field: "title", type: "date", operator: "is_before", value: "2026-07-22" },
        { id: "bad-range", field: "scheduled", type: "date", operator: "is_between", value: "2026-07-22" },
      ],
      sortRules: [{ id: "bad-sort", field: "unknown", direction: "asc" }],
      groupSettings: { groupBy: "unknown", manualOrder: ["safe", 3] },
    }, legacy);
    const valid = normalizePlannerTableSettings("daily.overdue", {
      filterMode: "or",
      filterRules: [{ id: "title", field: "title", type: "text", operator: "contains", value: "plan" }],
      sortRules: [{ id: "title", field: "title", direction: "desc" }],
      groupSettings: { groupBy: "area", sort: "manual", hideEmpty: true, manualOrder: ["area-1"] },
    }, legacy);

    expect(malformed.filterMode).toBe("or");
    expect(malformed.filterRules).toEqual([]);
    expect(malformed.sortRules).toEqual(defaultPlannerTableSettings("daily.today").sortRules);
    expect(malformed.groupSettings.groupBy).toBe("none");
    expect(malformed.groupSettings.manualOrder).toEqual(["safe"]);
    expect(valid.filterRules).toHaveLength(1);
    expect(valid.sortRules).toEqual([{ id: "title", field: "title", direction: "desc" }]);
    expect(valid.groupSettings.manualOrder).toEqual(["area-1"]);
  });

  it("rejects inherited prototype keys as persisted filter and sort fields", () => {
    const settings = normalizePlannerTableSettings("daily.today", {
      filterRules: [
        { id: "prototype-filter", field: "toString", type: "text", operator: "contains", value: "x" },
      ],
      sortRules: [
        { id: "prototype-sort", field: "constructor", direction: "asc" },
      ],
    }, legacyPlannerControls());

    expect(settings.filterRules).toEqual([]);
    expect(settings.sortRules).toEqual(defaultPlannerTableSettings("daily.today").sortRules);
  });

  it("rejects malformed date filter values while retaining valid calendar dates", () => {
    const settings = normalizePlannerTableSettings("daily.today", {
      filterRules: [
        { id: "malformed-date", field: "scheduled", type: "date", operator: "is", value: "2026-2-28" },
        { id: "impossible-date", field: "scheduled", type: "date", operator: "is", value: "2026-02-30" },
        {
          id: "reversed-range",
          field: "scheduled",
          type: "date",
          operator: "is_between",
          value: { start: "2026-07-31", end: "2026-07-01" },
        },
        {
          id: "nonnumeric-relative",
          field: "scheduled",
          type: "date",
          operator: "is_relative_to_today",
          value: { amount: "tomorrow", unit: "day" },
        },
        { id: "valid-date", field: "due", type: "date", operator: "is", value: "2026-02-28" },
        {
          id: "valid-relative",
          field: "scheduled",
          type: "date",
          operator: "is_relative_to_today",
          value: { amount: "2", unit: "week" },
        },
      ],
    }, legacyPlannerControls());

    expect(settings.filterRules).toEqual([
      { id: "valid-date", field: "due", type: "date", operator: "is", value: "2026-02-28" },
      {
        id: "valid-relative",
        field: "scheduled",
        type: "date",
        operator: "is_relative_to_today",
        value: { amount: "2", unit: "week" },
      },
    ]);
  });

  it("partitions raw Daily sections before table presentation controls", () => {
    const rawItems = [
      item("today-task", { title: "Today", scheduled: "2026-07-22" }),
      item("before-task", { title: "Before", scheduled: "2026-07-21" }),
      item("no-date-task", { title: "No date", scheduled: null }),
      item("routine", { type: "routine", scheduled: "2026-07-22" }),
    ];
    const sections = buildDailyPlannerSections(rawItems, "2026-07-22");

    expect(sections.today.map((entry) => entry.id)).toEqual(["today-task"]);
    expect(sections.overdue.map((entry) => entry.id)).toEqual(["before-task"]);
    expect(sections.unscheduled.map((entry) => entry.id)).toEqual(["no-date-task"]);

    const todayPresentation = sortPlannerItems(
      filterPlannerItemsByRules(
        sections.today,
        relatedItems,
        [{ id: "title", field: "title", type: "text", operator: "contains", value: "today" }],
        "and",
        "2026-07-22",
      ),
      [{ id: "descending-title", field: "title", direction: "desc" }],
    );

    expect(todayPresentation.map((entry) => entry.id)).toEqual(["today-task"]);
    expect(sections.overdue.map((entry) => entry.id)).toEqual(["before-task"]);
    expect(sections.unscheduled.map((entry) => entry.id)).toEqual(["no-date-task"]);
    expect(Object.values(sections).flat().map((entry) => entry.id)).not.toContain("routine");
  });

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
    const groupedItems = [
      item("focus", { tags: ["focus"] }),
      item("ops", { tags: ["ops", "focus"] }),
      item("empty", { tags: [] }),
    ];
    const result = groupPlannerItems(
      groupedItems,
      relatedItems,
      { ...defaultPlannerGroupSettings(), groupBy: "tag" },
      buildPlannerGroupCandidates({ view: "daily", groupBy: "tag", items: groupedItems, relatedItems }),
    );

    expect(result.map((group) => [group.label, group.items.map((entry) => entry.id)])).toEqual([
      ["focus", ["focus", "ops"]],
      ["ops", ["ops"]],
      ["Untagged", ["empty"]],
    ]);
  });

  it("groups planner items by related area labels", () => {
    const groupedItems = [
      item("work", { area_id: "area-1" }),
      item("none", { area_id: null }),
    ];
    const result = groupPlannerItems(
      groupedItems,
      relatedItems,
      { ...defaultPlannerGroupSettings(), groupBy: "area" },
      buildPlannerGroupCandidates({ view: "daily", groupBy: "area", items: groupedItems, relatedItems }),
    );

    expect(result.map((group) => group.label)).toEqual(["Work", "No area"]);
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
      itemTypes: ["task"],
      statuses: ["active"],
    });

    expect(model.sections.today.groups[0]?.items.map((item) => item.id)).toEqual([
      "task-focus",
      "wrong-area",
    ]);
  });

  it("places visible work into selected-date, overdue, and unscheduled sections while excluding future work", () => {
    const model = buildDaily();

    expect(model.sections.today.groups[0]?.items.map((item) => item.id)).toEqual([
      "task-focus",
      "task-ops",
      "wrong-area",
      "wrong-project",
      "done",
    ]);
    expect(model.sections.overdue.groups[0]?.items.map((item) => item.id)).toEqual([
      "task-overdue",
    ]);
    expect(model.sections.unscheduled.groups[0]?.items.map((item) => item.id)).toEqual([
      "unscheduled",
    ]);
    expect(model.sections.today.groups[0]?.items.map((item) => item.id)).not.toContain(
      "task-upcoming",
    );
    expect(model.sections.today.groups[0]?.items.map((item) => item.id)).not.toContain(
      "project-match",
    );
  });

  it("labels daily sections from the selected reference date", () => {
    const result = buildDaily({}, "none", "2026-07-06");

    expect(result.sections.today.title).toBe("July 6, 2026");
    expect(result.sections.overdue.title).toBe("Before July 6, 2026");
    expect(result.sections.unscheduled.title).toBe("Unscheduled");
    expect(result.sections.today.groups[0]?.items.map((item) => item.id)).toContain(
      "task-focus",
    );
    expect(result.sections.overdue.groups[0]?.items.map((item) => item.id)).toContain(
      "task-overdue",
    );
  });

  it.each([
    ["area", ["Home", "No area", "Work"]],
    ["project", ["No project", "Ops", "Planner"]],
    ["routine", ["Evening", "Morning", "No routine"]],
    ["tag", ["deep-work", "focus", "ops"]],
    ["item_type", ["Task"]],
    ["status", ["Active", "Completed"]],
  ] as const)("groups today items by %s with expected labels", (groupBy, labels) => {
    const model = buildDaily({}, groupBy);

    expect(model.sections.today.groups.map((group) => group.label).sort()).toEqual(labels);
  });

  it("keeps completed tasks in the completed status group", () => {
    const model = buildDaily({}, "status");

    expect(
      model.sections.today.groups
        .find((group) => group.label === "Completed")
        ?.items.map((item) => item.id),
    ).toEqual(["done"]);
  });

  it("keeps active, completed, and waiting tasks in status groups while excluding terminal tasks", () => {
    const statusItems = [
      item("active", { status: "active", scheduled: "2026-07-06" }),
      item("completed", { status: "completed", scheduled: "2026-07-06" }),
      item("waiting", { status: "waiting", scheduled: "2026-07-06" }),
      item("someday", { status: "someday", scheduled: "2026-07-06" }),
      item("rejected", { status: "rejected", scheduled: "2026-07-06" }),
    ];
    const model = buildDailyPlannerModel(statusItems, relatedItems, {
      date: "2026-07-06",
      filters: {
        tags: [],
        areaIds: [],
        projectIds: [],
        routineIds: [],
        itemTypes: [],
        statuses: [],
      },
      groupSettings: { ...defaultPlannerGroupSettings(), groupBy: "status" },
      groupCandidates: buildPlannerGroupCandidates({
        view: "daily",
        groupBy: "status",
        items: statusItems,
        relatedItems,
      }),
      sortRules: [],
    });

    expect(
      model.sections.today.groups.map((group) => [
        group.label,
        group.items.map((entry) => entry.id),
      ]),
    ).toEqual([
      ["Active", ["active"]],
      ["Completed", ["completed"]],
      ["Waiting", ["waiting"]],
    ]);
  });

  it("keeps completed tasks and events visible while hiding other terminal items", () => {
    const workItems = [
      item("task-active", { status: "active", scheduled: "2026-07-06" }),
      item("task-completed", { status: "completed", scheduled: "2026-07-06" }),
      item("task-archived", { status: "archived", scheduled: "2026-07-06" }),
      item("task-dropped", { status: "dropped", scheduled: "2026-07-06" }),
      item("task-cancelled", { status: "cancelled", scheduled: "2026-07-06" }),
      item("task-someday", { status: "someday", scheduled: "2026-07-06" }),
      item("task-rejected", { status: "rejected", scheduled: "2026-07-06" }),
      item("event-completed", {
        title: "Z event completed",
        type: "event",
        status: "completed",
        scheduled: "2026-07-06",
      }),
      item("event-archived", {
        type: "event",
        status: "archived",
        scheduled: "2026-07-06",
      }),
      item("routine-completed", {
        type: "routine",
        status: "completed",
        scheduled: "2026-07-06",
      }),
    ];
    const goalItems: WorkspaceItemModel[] = [
      item("month-goal-active", {
        type: "goal",
        status: "active",
        horizon: "month",
        scheduled: "2026-07-01",
      }),
      item("month-goal-completed", {
        type: "goal",
        status: "completed",
        horizon: "month",
        scheduled: "2026-07-01",
      }),
      item("month-goal-someday", {
        type: "goal",
        status: "someday",
        horizon: "month",
        scheduled: "2026-07-01",
      }),
      item("week-goal-active", {
        type: "goal",
        status: "active",
        horizon: "week",
        scheduled: "2026-07-06",
      }),
      item("week-goal-archived", {
        type: "goal",
        status: "archived",
        horizon: "week",
        scheduled: "2026-07-06",
      }),
      item("week-goal-rejected", {
        type: "goal",
        status: "rejected",
        horizon: "week",
        scheduled: "2026-07-06",
      }),
    ];
    const daily = buildDailyPlannerModel(workItems, relatedItems, {
      date: "2026-07-06",
      filters: {
        tags: [], areaIds: [], projectIds: [], routineIds: [], itemTypes: [], statuses: [],
      },
      groupSettings: defaultPlannerGroupSettings(),
      groupCandidates: [],
      sortRules: [],
    });
    const weekly = buildWeeklyPlannerModel([...goalItems, ...workItems], "2026-07-06");
    const monthly = buildMonthlyPeriodGoalCardsModel(
      [...goalItems, ...workItems],
      "2026-07-01",
    );

    const visibleDailyIds = daily.sections.today.groups.flatMap((group) =>
      group.items.map((item) => item.id),
    );
    const visibleMonthlyIds = monthly.weeks.flatMap((week) =>
      week.days.flatMap((day) => day.items.map((entry) => entry.id)),
    );
    const visibleWeeklyIds = weekly.days.flatMap((day) =>
      day.items.map((item) => item.id),
    );

    expect(visibleDailyIds).toEqual([
      "task-active",
      "task-completed",
      "event-completed",
    ]);
    expect(visibleMonthlyIds).toEqual([
      "task-active",
      "task-completed",
      "event-completed",
    ]);
    expect(weekly.monthGoals.map((item) => item.id)).toEqual(["month-goal-active"]);
    expect(weekly.weekGoals.map((item) => item.id)).toEqual(["week-goal-active"]);
    expect(monthly.carousel[1].goals.map((entry) => entry.id)).toEqual([
      "month-goal-active",
    ]);
    expect(monthly.weeks.flatMap((week) => week.goals.map((entry) => entry.id))).toEqual([
      "week-goal-active",
    ]);
    expect(weekly.days[0].items.map((item) => item.id)).toEqual([
      "task-active",
      "task-completed",
      "event-completed",
    ]);
    expect(visibleDailyIds).toContain("event-completed");
    expect(visibleDailyIds).not.toContain("event-archived");
    expect(visibleDailyIds).not.toContain("routine-completed");
    expect(visibleWeeklyIds).toContain("event-completed");
    expect(visibleWeeklyIds).not.toContain("event-archived");
    expect(visibleWeeklyIds).not.toContain("routine-completed");
    expect(visibleMonthlyIds).toContain("event-completed");
    expect(visibleMonthlyIds).not.toContain("event-archived");
    expect(visibleMonthlyIds).not.toContain("routine-completed");
  });

  it("limits daily weekly and monthly work lists to tasks and events", () => {
    const workItems = [
      item("task", { type: "task", scheduled: "2026-07-06" }),
      item("event", { type: "event", scheduled: "2026-07-06" }),
      item("routine", { type: "routine", scheduled: "2026-07-06" }),
      item("month-goal", { type: "goal", horizon: "month", scheduled: "2026-07-01" }),
      item("week-goal", { type: "goal", horizon: "week", scheduled: "2026-07-06" }),
    ];
    const daily = buildDailyPlannerModel(workItems, relatedItems, {
      date: "2026-07-06",
      filters: {
        tags: [], areaIds: [], projectIds: [], routineIds: [], itemTypes: [], statuses: [],
      },
      groupSettings: defaultPlannerGroupSettings(),
      groupCandidates: [],
      sortRules: [],
    });
    const weekly = buildWeeklyPlannerModel(workItems, "2026-07-06");
    const monthly = buildMonthlyPeriodGoalCardsModel(workItems, "2026-07-01");

    expect(daily.sections.today.groups.flatMap((group) => group.items.map((entry) => entry.id)))
      .toEqual(["event", "task"]);
    expect(weekly.days[0]?.items.map((entry) => entry.id)).toEqual(["task", "event"]);
    expect(monthly.weeks[1]?.days[0]?.items.map((entry) => entry.id))
      .toEqual(["task", "event"]);
    expect(weekly.monthGoals.map((entry) => entry.id)).toEqual(["month-goal"]);
    expect(weekly.weekGoals.map((entry) => entry.id)).toEqual(["week-goal"]);
    expect(monthly.carousel[1]?.goals.map((entry) => entry.id)).toEqual(["month-goal"]);
    expect(monthly.weeks[1]?.goals.map((entry) => entry.id)).toEqual(["week-goal"]);
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
    expect(weekly.days.map((day) => day.label)).toEqual([
      "Mon · 2026-07-06",
      "Tue · 2026-07-07",
      "Wed · 2026-07-08",
      "Thu · 2026-07-09",
      "Fri · 2026-07-10",
      "Sat · 2026-07-11",
      "Sun · 2026-07-12",
    ]);
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
        item("monday-task", {
          type: "task",
          scheduled: "2025-12-29",
        }),
        item("wednesday-event", {
          type: "event",
          scheduled: "2025-12-31",
        }),
        item("completed-task", {
          type: "task",
          status: "completed",
          scheduled: "2026-01-08",
        }),
        item("completed-event", {
          type: "event",
          status: "completed",
          scheduled: "2026-01-08",
        }),
        item("outside-month-routine", {
          type: "routine",
          scheduled: "2026-02-02",
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
    expect(model.weeks[0]?.days.map((day) => day.date)).toEqual([
      "2025-12-29",
      "2025-12-30",
      "2025-12-31",
      "2026-01-01",
      "2026-01-02",
      "2026-01-03",
      "2026-01-04",
    ]);
    expect(model.weeks[0]?.days[0]?.items.map((entry) => entry.id)).toEqual(["monday-task"]);
    expect(model.weeks[0]?.days[2]?.items.map((entry) => entry.id)).toEqual(["wednesday-event"]);
    expect(model.weeks[1]?.days[3]?.items.map((entry) => entry.id)).toContain("completed-task");
    expect(model.weeks[1]?.days[3]?.items.map((entry) => entry.id)).toContain("completed-event");
    expect(model.weeks.at(-1)?.days.flatMap((day) => day.items.map((entry) => entry.id))).not.toContain(
      "outside-month-routine",
    );
  });
});
