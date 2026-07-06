import type {
  WorkspaceItemModel,
  WorkspaceItemsModel,
} from "@/features/workbench/model/workbench-model";

export type DailyFilterState = {
  tags: string[];
  areaIds: string[];
  projectIds: string[];
  routineIds: string[];
  itemTypes: string[];
  statuses: string[];
};

export type DailyGroupBy =
  | "none"
  | "area"
  | "project"
  | "routine"
  | "tag"
  | "item_type"
  | "status";

export type DailySortBy = "priority" | "scheduled" | "updated" | "title";

export type DailyPlannerOptions = {
  date: string;
  filters: DailyFilterState;
  groupBy: DailyGroupBy;
  sortBy: DailySortBy;
};

export type PlannerGroup = {
  key: string;
  label: string;
  items: WorkspaceItemModel[];
};

export type DailyPlannerSection = {
  id: "today" | "overdue" | "upcoming" | "unscheduled";
  title: string;
  groups: PlannerGroup[];
};

export type DailyPlannerModel = {
  sections: Record<DailyPlannerSection["id"], DailyPlannerSection>;
};

export type WeeklyPlannerDay = {
  date: string;
  label: string;
  items: WorkspaceItemModel[];
};

export type WeeklyPlannerModel = {
  monthGoals: WorkspaceItemModel[];
  weekGoals: WorkspaceItemModel[];
  days: WeeklyPlannerDay[];
};

const terminalStatuses = new Set(["completed", "archived", "dropped", "cancelled"]);
const dailyItemTypes = new Set(["task", "event", "routine"]);
const weeklyItemTypes = new Set(["task", "event", "routine"]);

export function buildDailyPlannerModel(
  items: WorkspaceItemModel[],
  relatedItems: WorkspaceItemsModel["relatedItems"],
  options: DailyPlannerOptions,
): DailyPlannerModel {
  const visible = items
    .filter((item) => dailyItemTypes.has(item.type))
    .filter((item) => !terminalStatuses.has(item.status))
    .filter((item) => matchesDailyFilters(item, options.filters))
    .sort((left, right) => compareDailyItems(left, right, options.sortBy));

  const today: WorkspaceItemModel[] = [];
  const overdue: WorkspaceItemModel[] = [];
  const upcoming: WorkspaceItemModel[] = [];
  const unscheduled: WorkspaceItemModel[] = [];

  for (const item of visible) {
    const date = datePart(item.scheduled);
    if (!date) {
      unscheduled.push(item);
    } else if (date < options.date) {
      overdue.push(item);
    } else if (date === options.date) {
      today.push(item);
    } else {
      upcoming.push(item);
    }
  }

  return {
    sections: {
      today: section("today", "Today", today, relatedItems, options.groupBy),
      overdue: section("overdue", "Overdue", overdue, relatedItems, options.groupBy),
      upcoming: section("upcoming", "Upcoming", upcoming, relatedItems, options.groupBy),
      unscheduled: section(
        "unscheduled",
        "Unscheduled",
        unscheduled,
        relatedItems,
        options.groupBy,
      ),
    },
  };
}

export function buildWeeklyPlannerModel(
  items: WorkspaceItemModel[],
  weekStart: string,
): WeeklyPlannerModel {
  const weekDates = Array.from({ length: 7 }, (_, offset) =>
    addDays(weekStart, offset),
  );
  const monthKey = weekStart.slice(0, 7);

  return {
    monthGoals: items.filter(
      (item) =>
        item.type === "goal" &&
        !terminalStatuses.has(item.status) &&
        item.horizon === "month" &&
        datePart(item.scheduled)?.startsWith(monthKey),
    ),
    weekGoals: items.filter(
      (item) =>
        item.type === "goal" &&
        !terminalStatuses.has(item.status) &&
        item.horizon === "week" &&
        weekDates.includes(datePart(item.scheduled) ?? ""),
    ),
    days: weekDates.map((date) => ({
      date,
      label: date,
      items: items.filter(
        (item) =>
          weeklyItemTypes.has(item.type) &&
          !terminalStatuses.has(item.status) &&
          datePart(item.scheduled) === date,
      ),
    })),
  };
}

function matchesDailyFilters(
  item: WorkspaceItemModel,
  filters: DailyFilterState,
): boolean {
  return (
    matchesAny(item.tags ?? [], filters.tags) &&
    matchesOne(item.area_id, filters.areaIds) &&
    matchesOne(item.project_id, filters.projectIds) &&
    matchesOne(item.routine_id, filters.routineIds) &&
    matchesOne(item.type, filters.itemTypes) &&
    matchesOne(item.status, filters.statuses)
  );
}

function matchesAny(values: string[], selected: string[]): boolean {
  return selected.length === 0 || selected.some((value) => values.includes(value));
}

function matchesOne(value: string | null | undefined, selected: string[]): boolean {
  return selected.length === 0 || (value != null && selected.includes(value));
}

function compareDailyItems(
  left: WorkspaceItemModel,
  right: WorkspaceItemModel,
  sortBy: DailySortBy,
): number {
  if (sortBy === "title") {
    return left.title.localeCompare(right.title);
  }
  if (sortBy === "scheduled") {
    return compareText(left.scheduled, right.scheduled);
  }
  if (sortBy === "updated") {
    return compareText(right.updated_at, left.updated_at);
  }
  return compareNumber(left.priority, right.priority)
    || compareText(left.scheduled, right.scheduled)
    || compareText(right.updated_at, left.updated_at)
    || left.title.localeCompare(right.title);
}

function compareNumber(
  left: number | null | undefined,
  right: number | null | undefined,
): number {
  return (left ?? Number.MAX_SAFE_INTEGER) - (right ?? Number.MAX_SAFE_INTEGER);
}

function compareText(
  left: string | null | undefined,
  right: string | null | undefined,
): number {
  return (left ?? "").localeCompare(right ?? "");
}

function section(
  id: DailyPlannerSection["id"],
  title: string,
  items: WorkspaceItemModel[],
  relatedItems: WorkspaceItemsModel["relatedItems"],
  groupBy: DailyGroupBy,
): DailyPlannerSection {
  return { id, title, groups: groupItems(items, relatedItems, groupBy) };
}

function groupItems(
  items: WorkspaceItemModel[],
  relatedItems: WorkspaceItemsModel["relatedItems"],
  groupBy: DailyGroupBy,
): PlannerGroup[] {
  if (groupBy === "none") {
    return items.length === 0 ? [] : [{ key: "all", label: "All", items }];
  }

  const groups = new Map<string, PlannerGroup>();
  for (const item of items) {
    const keys = groupKeys(item, groupBy);
    for (const key of keys) {
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          label: groupLabel(key, groupBy, relatedItems),
          items: [],
        });
      }
      groups.get(key)?.items.push(item);
    }
  }
  return [...groups.values()];
}

function groupKeys(item: WorkspaceItemModel, groupBy: DailyGroupBy): string[] {
  if (groupBy === "tag") {
    return item.tags && item.tags.length > 0 ? item.tags : ["untagged"];
  }
  if (groupBy === "area") return [item.area_id ?? "none"];
  if (groupBy === "project") return [item.project_id ?? "none"];
  if (groupBy === "routine") return [item.routine_id ?? "none"];
  if (groupBy === "item_type") return [item.type];
  if (groupBy === "status") return [item.status];
  return ["all"];
}

function groupLabel(
  key: string,
  groupBy: DailyGroupBy,
  relatedItems: WorkspaceItemsModel["relatedItems"],
): string {
  if (key === "none") return "No value";
  if (key === "untagged") return "Untagged";
  if (groupBy === "area") return relatedItems.areas[key] ?? key;
  if (groupBy === "project") return relatedItems.projects[key] ?? key;
  if (groupBy === "routine") return relatedItems.routines[key] ?? key;
  return key;
}

function datePart(value: string | null | undefined): string | null {
  return value ? value.slice(0, 10) : null;
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
