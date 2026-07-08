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

export type PlannerFilterMode = "and" | "or";
export type PlannerFilterField =
  | "title"
  | "scheduled"
  | "due"
  | "tags"
  | "area"
  | "project"
  | "routine"
  | "item_type"
  | "status"
  | "priority"
  | "horizon";
export type PlannerFilterType =
  | "text"
  | "date"
  | "number"
  | "select"
  | "multiSelect"
  | "relation";
export type PlannerFilterOperator =
  | "is"
  | "is_not"
  | "contains"
  | "does_not_contain"
  | "starts_with"
  | "ends_with"
  | "is_before"
  | "is_after"
  | "is_on_or_before"
  | "is_on_or_after"
  | "is_between"
  | "is_relative_to_today"
  | "greater_than"
  | "less_than"
  | "is_empty"
  | "is_not_empty";
export type PlannerFilterValue =
  | string
  | string[]
  | { start: string; end: string }
  | { amount: string; unit: "day" | "week" | "month" }
  | null;
export type PlannerFilterRule = {
  id: string;
  field: PlannerFilterField;
  type: PlannerFilterType;
  operator: PlannerFilterOperator;
  value: PlannerFilterValue;
};

export type PlannerGroupBy =
  | "none"
  | "area"
  | "project"
  | "routine"
  | "tag"
  | "item_type"
  | "status";

export type PlannerSortBy = "priority" | "scheduled" | "updated" | "title";

export type DailyGroupBy = PlannerGroupBy;
export type DailySortBy = PlannerSortBy;

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

export function matchesPlannerFilterRules(
  item: WorkspaceItemModel,
  relatedItems: WorkspaceItemsModel["relatedItems"],
  rules: PlannerFilterRule[],
  mode: PlannerFilterMode,
  today: string,
): boolean {
  if (rules.length === 0) return true;
  const results = rules.map((rule) =>
    matchesPlannerFilterRule(item, relatedItems, rule, today),
  );
  return mode === "and" ? results.every(Boolean) : results.some(Boolean);
}

export function filterPlannerItemsByRules(
  items: WorkspaceItemModel[],
  relatedItems: WorkspaceItemsModel["relatedItems"],
  rules: PlannerFilterRule[],
  mode: PlannerFilterMode,
  today: string,
): WorkspaceItemModel[] {
  return items.filter((item) =>
    matchesPlannerFilterRules(item, relatedItems, rules, mode, today),
  );
}

function matchesPlannerFilterRule(
  item: WorkspaceItemModel,
  relatedItems: WorkspaceItemsModel["relatedItems"],
  rule: PlannerFilterRule,
  today: string,
): boolean {
  const value = plannerFilterValue(item, relatedItems, rule.field);
  if (rule.operator === "is_empty") return isFilterEmpty(value);
  if (rule.operator === "is_not_empty") return !isFilterEmpty(value);
  if (isFilterEmpty(value)) return false;
  if (rule.type === "date") return matchesDateFilter(String(value ?? ""), rule, today);
  if (rule.type === "number") return matchesNumberFilter(value, rule);
  if (Array.isArray(value)) return matchesArrayFilter(value, rule);
  return matchesTextFilter(String(value ?? ""), rule);
}

function plannerFilterValue(
  item: WorkspaceItemModel,
  relatedItems: WorkspaceItemsModel["relatedItems"],
  field: PlannerFilterField,
): string | string[] | number | null | undefined {
  if (field === "title") return item.title;
  if (field === "scheduled") return datePart(item.scheduled);
  if (field === "due") return datePart(item.due);
  if (field === "tags") return item.tags ?? [];
  if (field === "area") return relationValues(item.area_id, relatedItems.areas);
  if (field === "project") return relationValues(item.project_id, relatedItems.projects);
  if (field === "routine") return relationValues(item.routine_id, relatedItems.routines);
  if (field === "item_type") return item.type;
  if (field === "status") return item.status;
  if (field === "priority") return item.priority;
  return item.horizon;
}

function relationValues(
  id: string | null | undefined,
  labels: Record<string, string>,
): string[] {
  if (!id) return [];
  const label = labels[id];
  return label && label !== id ? [id, label] : [id];
}

function isFilterEmpty(value: string | string[] | number | null | undefined): boolean {
  return value == null || value === "" || (Array.isArray(value) && value.length === 0);
}

function matchesTextFilter(value: string, rule: PlannerFilterRule): boolean {
  const actual = value.toLowerCase();
  const expected = filterValueStrings(rule.value);
  const firstExpected = expected[0] ?? "";
  if (rule.operator === "is") return expected.includes(actual);
  if (rule.operator === "is_not") return !expected.includes(actual);
  if (rule.operator === "contains") {
    return expected.some((value) => actual.includes(value));
  }
  if (rule.operator === "does_not_contain") {
    return expected.every((value) => !actual.includes(value));
  }
  if (rule.operator === "starts_with") return actual.startsWith(firstExpected);
  if (rule.operator === "ends_with") return actual.endsWith(firstExpected);
  return false;
}

function matchesArrayFilter(values: string[], rule: PlannerFilterRule): boolean {
  const actual = values.map((value) => value.toLowerCase());
  const expected = filterValueStrings(rule.value);
  const hasMatch = expected.some((value) => actual.includes(value));
  if (
    rule.operator === "is" ||
    rule.operator === "contains"
  ) {
    return hasMatch;
  }
  if (
    rule.operator === "is_not" ||
    rule.operator === "does_not_contain"
  ) {
    return !hasMatch;
  }
  return false;
}

function matchesDateFilter(value: string, rule: PlannerFilterRule, today: string): boolean {
  if (rule.operator === "is_between" && isRangeValue(rule.value)) {
    return value >= rule.value.start && value <= rule.value.end;
  }
  if (rule.operator === "is_relative_to_today" && isRelativeValue(rule.value)) {
    return value === addRelativeDate(today, rule.value);
  }
  const expected = String(rule.value ?? "");
  if (rule.operator === "is") return value === expected;
  if (rule.operator === "is_not") return value !== expected;
  if (rule.operator === "is_before") return value < expected;
  if (rule.operator === "is_after") return value > expected;
  if (rule.operator === "is_on_or_before") return value <= expected;
  if (rule.operator === "is_on_or_after") return value >= expected;
  return false;
}

function matchesNumberFilter(
  value: string | string[] | number | null | undefined,
  rule: PlannerFilterRule,
): boolean {
  if (Array.isArray(value)) return false;
  const actual = Number(value);
  const expected = Number(rule.value);
  if (Number.isNaN(actual) || Number.isNaN(expected)) return false;
  if (rule.operator === "is") return actual === expected;
  if (rule.operator === "is_not") return actual !== expected;
  if (rule.operator === "greater_than") return actual > expected;
  if (rule.operator === "less_than") return actual < expected;
  return false;
}

function filterValueStrings(value: PlannerFilterValue): string[] {
  return (Array.isArray(value) ? value : [String(value ?? "")]).map((entry) =>
    entry.toLowerCase(),
  );
}

function isRangeValue(
  value: PlannerFilterValue,
): value is { start: string; end: string } {
  return typeof value === "object" && value != null && "start" in value && "end" in value;
}

function isRelativeValue(
  value: PlannerFilterValue,
): value is { amount: string; unit: "day" | "week" | "month" } {
  return typeof value === "object" && value != null && "amount" in value && "unit" in value;
}

function addRelativeDate(
  today: string,
  value: { amount: string; unit: "day" | "week" | "month" },
): string {
  const date = new Date(`${today}T00:00:00Z`);
  const amount = Number(value.amount);
  if (value.unit === "month") date.setUTCMonth(date.getUTCMonth() + amount);
  else date.setUTCDate(date.getUTCDate() + amount * (value.unit === "week" ? 7 : 1));
  return date.toISOString().slice(0, 10);
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

export function sortPlannerItems(
  items: WorkspaceItemModel[],
  sortBy: PlannerSortBy,
): WorkspaceItemModel[] {
  return [...items].sort((left, right) => compareDailyItems(left, right, sortBy));
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

export function groupPlannerItems(
  items: WorkspaceItemModel[],
  relatedItems: WorkspaceItemsModel["relatedItems"],
  groupBy: PlannerGroupBy,
): PlannerGroup[] {
  return groupItems(items, relatedItems, groupBy);
}

function groupItems(
  items: WorkspaceItemModel[],
  relatedItems: WorkspaceItemsModel["relatedItems"],
  groupBy: PlannerGroupBy,
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

function groupKeys(item: WorkspaceItemModel, groupBy: PlannerGroupBy): string[] {
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
  groupBy: PlannerGroupBy,
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
