import {
  defaultPlannerGroupSettings,
  normalizePlannerGroupSettings,
  orderVisiblePlannerGroups,
  type PlannerGroupCandidate,
  type PlannerGroupSettings,
} from "@/features/workbench/model/planner-group-settings";
import type {
  LegacyPlannerControls,
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
  | "status"
  | "priority"
  | "horizon"
  | "parent"
  | "recurrence_rule"
  | "materialization_policy"
  | "location"
  | "participants"
  | "commitment_type"
  | "description"
  | "note";
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

export type PlannerSortDirection = "asc" | "desc";
export type PlannerSortBy = PlannerFilterField | "updated";
export type PlannerSortRule = {
  id: string;
  field: PlannerSortBy;
  direction: PlannerSortDirection;
};

const plannerFilterFieldTypes: Record<PlannerFilterField, PlannerFilterType> = {
  title: "text",
  scheduled: "date",
  due: "date",
  tags: "multiSelect",
  area: "relation",
  project: "relation",
  routine: "relation",
  status: "select",
  priority: "select",
  horizon: "select",
  parent: "relation",
  recurrence_rule: "text",
  materialization_policy: "select",
  location: "text",
  participants: "multiSelect",
  commitment_type: "text",
  description: "text",
  note: "text",
};

const plannerFilterOperators: Record<PlannerFilterType, readonly PlannerFilterOperator[]> = {
  date: ["is", "is_not", "is_before", "is_after", "is_on_or_before", "is_on_or_after", "is_between", "is_relative_to_today", "is_empty", "is_not_empty"],
  number: ["is", "is_not", "greater_than", "less_than", "is_empty", "is_not_empty"],
  text: ["contains", "does_not_contain", "is", "is_not", "starts_with", "ends_with", "is_empty", "is_not_empty"],
  select: ["is", "is_not", "contains", "does_not_contain", "is_empty", "is_not_empty"],
  multiSelect: ["is", "is_not", "contains", "does_not_contain", "is_empty", "is_not_empty"],
  relation: ["is", "is_not", "contains", "does_not_contain", "is_empty", "is_not_empty"],
};

export const plannerTableIds = [
  "daily.today",
  "daily.overdue",
  "daily.unscheduled",
  "weekly.month-goals",
  "weekly.week-goals",
  "weekly.day-grid",
  "monthly.period-goals",
  "monthly.calendar",
  "monthly.week-goals",
  "yearly.period-goals",
  "yearly.month-goals",
] as const;

export type PlannerTableId = (typeof plannerTableIds)[number];

export type PlannerTableSettings = {
  filterMode: PlannerFilterMode;
  filterRules: PlannerFilterRule[];
  sortRules: PlannerSortRule[];
  groupSettings: PlannerGroupSettings;
};

const plannerDateWorkFilterFields = [
  "title",
  "status",
  "tags",
  "area",
  "project",
  "routine",
  "scheduled",
  "due",
  "priority",
  "recurrence_rule",
  "materialization_policy",
  "location",
  "participants",
  "commitment_type",
  "description",
  "note",
] as const satisfies readonly PlannerFilterField[];

const plannerGoalFilterFields = [
  "title",
  "status",
  "tags",
  "horizon",
  "scheduled",
  "due",
  "parent",
  "note",
] as const satisfies readonly PlannerFilterField[];

const plannerDateWorkSortFields = [
  ...plannerDateWorkFilterFields,
  "updated",
] as const satisfies readonly PlannerSortBy[];

const plannerGoalSortFields = [
  ...plannerGoalFilterFields,
  "updated",
] as const satisfies readonly PlannerSortBy[];

export function plannerFilterFieldsForTable(
  tableId: PlannerTableId,
): readonly PlannerFilterField[] {
  return tableId.endsWith("goals")
    ? plannerGoalFilterFields
    : plannerDateWorkFilterFields;
}

export function plannerSortFieldsForTable(
  tableId: PlannerTableId,
): readonly PlannerSortBy[] {
  return tableId.endsWith("goals")
    ? plannerGoalSortFields
    : plannerDateWorkSortFields;
}

export function defaultPlannerTableSettings(
  tableId: PlannerTableId,
): PlannerTableSettings {
  return {
    filterMode: "and",
    filterRules: [],
    sortRules: [defaultSortRule(tableId)],
    groupSettings: defaultPlannerGroupSettings(),
  };
}

export function normalizePlannerTableSettings(
  tableId: PlannerTableId,
  candidate: unknown,
  legacy: LegacyPlannerControls,
): PlannerTableSettings {
  const defaults = defaultPlannerTableSettings(tableId);
  const allowedFilterFields = plannerFilterFieldsForTable(tableId);
  const allowedSortFields = plannerSortFieldsForTable(tableId);
  if (candidate === undefined) {
    const legacySettings = legacySettingsForTable(tableId, legacy);
    const filterRules = normalizeFilterRules(
      legacy.filterRules,
      allowedFilterFields,
    );
    const sortRules = normalizePlannerSortRules(
      legacySettings.sortRules,
      allowedSortFields,
    );
    if (!filterRules || !sortRules) return defaults;
    return {
      filterMode: normalizeFilterMode(legacy.filterMode, defaults.filterMode),
      filterRules,
      sortRules,
      groupSettings: normalizePlannerGroupSettings(legacySettings.groupSettings),
    };
  }

  if (!isRecord(candidate)) return defaults;

  const filterRules = candidate.filterRules === undefined
    ? defaults.filterRules
    : normalizeFilterRules(candidate.filterRules, allowedFilterFields);
  const sortRules = candidate.sortRules === undefined
    ? defaults.sortRules
    : normalizePlannerSortRules(candidate.sortRules, allowedSortFields);
  if (!filterRules || !sortRules) return defaults;

  return {
    filterMode: normalizeFilterMode(candidate.filterMode, defaults.filterMode),
    filterRules,
    sortRules,
    groupSettings: normalizePlannerGroupSettings(candidate.groupSettings),
  };
}

function defaultSortRule(tableId: PlannerTableId): PlannerSortRule {
  return {
    id: `${tableId}-default-sort`,
    field: tableId.startsWith("daily.") ? "priority" : "scheduled",
    direction: "asc",
  };
}

function legacySettingsForTable(
  tableId: PlannerTableId,
  legacy: LegacyPlannerControls,
): Pick<PlannerTableSettings, "sortRules" | "groupSettings"> {
  const view = tableId.split(".")[0] as keyof LegacyPlannerControls["groupSettings"];
  const sortRules = view === "daily"
    ? legacy.dailySortRules
    : view === "weekly"
      ? legacy.weeklySortRules
      : view === "monthly"
        ? legacy.monthlySortRules
        : legacy.yearlySortRules;
  return { sortRules, groupSettings: legacy.groupSettings[view] };
}

function normalizeFilterMode(value: unknown, fallback: PlannerFilterMode): PlannerFilterMode {
  return value === "and" || value === "or" ? value : fallback;
}

function normalizeFilterRules(
  value: unknown,
  allowedFields: readonly PlannerFilterField[],
): PlannerFilterRule[] | null {
  if (!Array.isArray(value)) return null;
  const rules: PlannerFilterRule[] = [];
  for (const rule of value) {
    if (!isRecord(rule) || typeof rule.id !== "string" || rule.id.length === 0) return null;
    if (
      !isPlannerFilterField(rule.field) ||
      !allowedFields.includes(rule.field) ||
      !isPlannerFilterType(rule.type)
    ) return null;
    const { field, type } = rule;
    if (plannerFilterFieldTypes[field] !== type) {
      return null;
    }
    if (!isPlannerFilterOperator(type, rule.operator) || !isPlannerFilterValue(type, rule.operator, rule.value)) {
      return null;
    }
    rules.push({
      id: rule.id,
      field,
      type,
      operator: rule.operator,
      value: clonePlannerFilterValue(rule.value),
    });
  }
  return rules;
}

function normalizePlannerSortRules(
  value: unknown,
  allowedFields: readonly PlannerSortBy[],
): PlannerSortRule[] | null {
  if (!Array.isArray(value)) return null;
  const rules: PlannerSortRule[] = [];
  for (const rule of value) {
    if (!isRecord(rule) || typeof rule.id !== "string" || rule.id.length === 0) return null;
    if (
      !isPlannerSortField(rule.field) ||
      !allowedFields.includes(rule.field) ||
      !isPlannerSortDirection(rule.direction)
    ) return null;
    rules.push({ id: rule.id, field: rule.field, direction: rule.direction });
  }
  return rules;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isPlannerFilterField(value: unknown): value is PlannerFilterField {
  return typeof value === "string" && hasOwn(plannerFilterFieldTypes, value);
}

function isPlannerFilterType(value: unknown): value is PlannerFilterType {
  return typeof value === "string" && hasOwn(plannerFilterOperators, value);
}

function isPlannerSortField(value: unknown): value is PlannerSortBy {
  return value === "updated" || isPlannerFilterField(value);
}

function isPlannerSortDirection(value: unknown): value is PlannerSortDirection {
  return value === "asc" || value === "desc";
}

function isPlannerFilterOperator(
  type: PlannerFilterType,
  value: unknown,
): value is PlannerFilterOperator {
  return typeof value === "string" && plannerFilterOperators[type].includes(value as PlannerFilterOperator);
}

function isPlannerFilterValue(
  type: PlannerFilterType,
  operator: PlannerFilterOperator,
  value: unknown,
): value is PlannerFilterValue {
  if (operator === "is_empty" || operator === "is_not_empty") return value === null;
  if (type === "date" && operator === "is_between") {
    return isRangeValue(value);
  }
  if (type === "date" && operator === "is_relative_to_today") {
    return isRelativeValue(value);
  }
  if (type === "date") {
    return isIsoDate(value);
  }
  if (type === "select" || type === "multiSelect" || type === "relation") {
    return Array.isArray(value) && value.every((entry) => typeof entry === "string");
  }
  return typeof value === "string";
}

function clonePlannerFilterValue(value: PlannerFilterValue): PlannerFilterValue {
  if (Array.isArray(value)) return [...value];
  if (isRangeValue(value)) return { start: value.start, end: value.end };
  if (isRelativeValue(value)) return { amount: value.amount, unit: value.unit };
  return value;
}

export type DailyGroupBy = PlannerGroupBy;

export type DailyPlannerOptions = {
  date: string;
  filters: DailyFilterState;
  groupSettings: PlannerGroupSettings;
  groupCandidates: PlannerGroupCandidate[];
  sortRules: PlannerSortRule[];
};

export type PlannerGroup = {
  key: string;
  label: string;
  items: WorkspaceItemModel[];
};

export type DailyPlannerSection = {
  id: "today" | "overdue" | "unscheduled";
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

export type PeriodGoalCardPosition = "previous" | "selected" | "next";

export type PeriodGoalCardModel = {
  key: string;
  label: string;
  periodStart: string;
  position: PeriodGoalCardPosition;
  goals: WorkspaceItemModel[];
};

export type PeriodGoalBucketModel = {
  key: string;
  label: string;
  periodStart: string;
  goals: WorkspaceItemModel[];
};

export type MonthlyPlannerDay = {
  date: string;
  label: string;
  isSelectedMonth: boolean;
  items: WorkspaceItemModel[];
};

export type MonthlyPlannerWeekModel = PeriodGoalBucketModel & {
  days: MonthlyPlannerDay[];
};

export type YearlyPeriodGoalCardsModel = {
  selectedYear: string;
  carousel: PeriodGoalCardModel[];
  months: PeriodGoalBucketModel[];
};

export type MonthlyPeriodGoalCardsModel = {
  selectedMonth: string;
  carousel: PeriodGoalCardModel[];
  weeks: MonthlyPlannerWeekModel[];
};

const terminalStatuses = new Set([
  "completed",
  "archived",
  "dropped",
  "cancelled",
  "someday",
  "rejected",
]);

function isVisiblePlannerWorkItem(item: WorkspaceItemModel): boolean {
  return !terminalStatuses.has(item.status) ||
    ((item.type === "task" || item.type === "event") && item.status === "completed");
}

const plannerWorkItemTypes = new Set(["task", "event"]);
export const plannerWeekdayLabels = [
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
  "Sun",
] as const;
const monthLabels = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function buildYearlyPeriodGoalCardsModel(
  items: WorkspaceItemModel[],
  plannerDate: string,
): YearlyPeriodGoalCardsModel {
  const selectedYear = plannerDate.slice(0, 4);
  const yearStarts = [-1, 0, 1].map((offset) =>
    yearStart(addYears(`${selectedYear}-01-01`, offset)),
  );

  return {
    selectedYear,
    carousel: yearStarts.map((periodStart, index) =>
      periodCard(
        items,
        periodStart,
        ["previous", "selected", "next"][index] as PeriodGoalCardPosition,
        "year",
      ),
    ),
    months: Array.from({ length: 12 }, (_, monthIndex) => {
      const periodStart = `${selectedYear}-${String(monthIndex + 1).padStart(2, "0")}-01`;
      return {
        key: periodStart,
        label: monthLabels[monthIndex] ?? periodStart.slice(5, 7),
        periodStart,
        goals: goalsForPeriod(items, "month", periodStart),
      };
    }),
  };
}

export function buildMonthlyPeriodGoalCardsModel(
  items: WorkspaceItemModel[],
  plannerDate: string,
): MonthlyPeriodGoalCardsModel {
  const selectedMonth = monthStart(plannerDate);
  const monthStarts = [-1, 0, 1].map((offset) => monthStart(addMonths(selectedMonth, offset)));
  const monthEnd = addDays(addMonths(selectedMonth, 1), -1);
  const firstWeekStart = isoWeekStart(selectedMonth);
  const weeks: MonthlyPlannerWeekModel[] = [];

  for (let current = firstWeekStart, index = 1; current <= monthEnd; current = addDays(current, 7), index += 1) {
    const weekDates = Array.from({ length: 7 }, (_, offset) => addDays(current, offset));
    weeks.push({
      key: current,
      label: `W${index}`,
      periodStart: current,
      goals: goalsForPeriod(items, "week", current),
      days: weekDates.map((date) => ({
        date,
        label: date.slice(8, 10),
        isSelectedMonth: date.startsWith(selectedMonth.slice(0, 7)),
        items: items.filter(
          (item) =>
            plannerWorkItemTypes.has(item.type) &&
            isVisiblePlannerWorkItem(item) &&
            datePart(item.scheduled) === date,
        ),
      })),
    });
  }

  return {
    selectedMonth,
    carousel: monthStarts.map((periodStart, index) =>
      periodCard(
        items,
        periodStart,
        ["previous", "selected", "next"][index] as PeriodGoalCardPosition,
        "month",
      ),
    ),
    weeks,
  };
}

export function buildDailyPlannerModel(
  items: WorkspaceItemModel[],
  relatedItems: WorkspaceItemsModel["relatedItems"],
  options: DailyPlannerOptions,
): DailyPlannerModel {
  const rawSections = buildDailyPlannerSections(items, options.date);
  const dateLabel = dailySectionDateLabel(options.date);
  const displayItems = (sectionItems: WorkspaceItemModel[]) =>
    sectionItems
      .filter((item) => matchesDailyFilters(item, options.filters))
      .sort((left, right) => comparePlannerItems(left, right, options.sortRules));

  return {
    sections: {
      today: section(
        "today",
        dateLabel,
        displayItems(rawSections.today),
        relatedItems,
        options.groupSettings,
        options.groupCandidates,
      ),
      overdue: section(
        "overdue",
        `Before ${dateLabel}`,
        displayItems(rawSections.overdue),
        relatedItems,
        options.groupSettings,
        options.groupCandidates,
      ),
      unscheduled: section(
        "unscheduled",
        "Unscheduled",
        displayItems(rawSections.unscheduled),
        relatedItems,
        options.groupSettings,
        options.groupCandidates,
      ),
    },
  };
}

export function buildDailyPlannerSections(
  items: WorkspaceItemModel[],
  selectedDate: string,
): Record<DailyPlannerSection["id"], WorkspaceItemModel[]> {
  const sections: Record<DailyPlannerSection["id"], WorkspaceItemModel[]> = {
    today: [],
    overdue: [],
    unscheduled: [],
  };

  for (const item of items) {
    if (!plannerWorkItemTypes.has(item.type) || !isVisiblePlannerWorkItem(item)) {
      continue;
    }
    const date = datePart(item.scheduled);
    if (!date) {
      sections.unscheduled.push(item);
    } else if (date < selectedDate) {
      sections.overdue.push(item);
    } else if (date === selectedDate) {
      sections.today.push(item);
    }
  }

  return sections;
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
    days: weekDates.map((date, index) => ({
      date,
      label: `${plannerWeekdayLabels[index]} · ${date}`,
      items: items.filter(
        (item) =>
          plannerWorkItemTypes.has(item.type) &&
          isVisiblePlannerWorkItem(item) &&
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
  if (field === "status") return item.status;
  if (field === "priority") return item.priority;
  if (field === "horizon") return item.horizon;
  if (field === "parent") return relationValues(item.parent_id, relatedItems.goals);
  if (field === "recurrence_rule") return item.recurrence_rule;
  if (field === "materialization_policy") return item.materialization_policy;
  if (field === "location") return item.metadata_?.location;
  if (field === "participants") return item.metadata_?.participants ?? [];
  if (field === "commitment_type") return item.metadata_?.commitment_type;
  if (field === "description") return item.description;
  return item.note;
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
  value: unknown,
): value is { start: string; end: string } {
  return isRecord(value) && isIsoDate(value.start) && isIsoDate(value.end) && value.start <= value.end;
}

function isRelativeValue(
  value: unknown,
): value is { amount: string; unit: "day" | "week" | "month" } {
  return isRecord(value) && typeof value.amount === "string" && isNonNegativeInteger(value.amount) &&
    (value.unit === "day" || value.unit === "week" || value.unit === "month");
}

function hasOwn(object: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  return day <= daysInMonth(year, month);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  }
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

function isNonNegativeInteger(value: string): boolean {
  return /^\d+$/.test(value) && Number.isSafeInteger(Number(value));
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

function comparePlannerItems(
  left: WorkspaceItemModel,
  right: WorkspaceItemModel,
  sortRules: PlannerSortRule[],
): number {
  for (const rule of sortRules) {
    const result = comparePlannerSortRule(left, right, rule);
    if (result !== 0) return result;
  }
  return compareText(left.scheduled, right.scheduled)
    || compareText(right.updated_at, left.updated_at)
    || left.title.localeCompare(right.title);
}

function comparePlannerSortRule(
  left: WorkspaceItemModel,
  right: WorkspaceItemModel,
  rule: PlannerSortRule,
): number {
  const result = rule.field === "priority"
    ? compareNumber(left.priority, right.priority)
    : compareText(sortValue(left, rule.field), sortValue(right, rule.field));
  return rule.direction === "asc" ? result : -result;
}

function sortValue(
  item: WorkspaceItemModel,
  field: PlannerSortBy,
): string | null | undefined {
  if (field === "title") return item.title;
  if (field === "scheduled") return item.scheduled;
  if (field === "due") return item.due;
  if (field === "status") return item.status;
  if (field === "horizon") return item.horizon;
  if (field === "recurrence_rule") return item.recurrence_rule;
  if (field === "materialization_policy") return item.materialization_policy;
  if (field === "location") return item.metadata_?.location;
  if (field === "participants") return item.metadata_?.participants?.join(", ");
  if (field === "commitment_type") return item.metadata_?.commitment_type;
  if (field === "description") return item.description;
  if (field === "note") return item.note;
  if (field === "updated") return item.updated_at;
  if (field === "tags") return item.tags?.join(", ");
  if (field === "area") return item.area_id;
  if (field === "project") return item.project_id;
  if (field === "routine") return item.routine_id;
  return item.parent_id;
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
  sortRules: PlannerSortRule[],
): WorkspaceItemModel[] {
  return [...items].sort((left, right) => comparePlannerItems(left, right, sortRules));
}

function section(
  id: DailyPlannerSection["id"],
  title: string,
  items: WorkspaceItemModel[],
  relatedItems: WorkspaceItemsModel["relatedItems"],
  groupSettings: PlannerGroupSettings,
  groupCandidates: PlannerGroupCandidate[],
): DailyPlannerSection {
  return {
    id,
    title,
    groups: groupItems(items, relatedItems, groupSettings, groupCandidates),
  };
}

export function groupPlannerItems(
  items: WorkspaceItemModel[],
  relatedItems: WorkspaceItemsModel["relatedItems"],
  groupSettings: PlannerGroupSettings,
  groupCandidates: PlannerGroupCandidate[],
): PlannerGroup[] {
  return groupItems(items, relatedItems, groupSettings, groupCandidates);
}

function groupItems(
  items: WorkspaceItemModel[],
  relatedItems: WorkspaceItemsModel["relatedItems"],
  groupSettings: PlannerGroupSettings,
  groupCandidates: PlannerGroupCandidate[],
): PlannerGroup[] {
  const groupBy = groupSettings.groupBy;
  if (groupBy === "none") {
    return items.length === 0 ? [] : [{ key: "all", label: "All", items }];
  }

  const buckets = new Map<string, WorkspaceItemModel[]>();
  for (const item of items) {
    for (const key of groupKeys(item, groupBy)) {
      buckets.set(key, [...(buckets.get(key) ?? []), item]);
    }
  }
  return orderVisiblePlannerGroups(groupCandidates, groupSettings)
    .map((candidate) => ({
      key: candidate.key,
      label: candidate.label || groupLabel(candidate.key, groupBy, relatedItems),
      items: buckets.get(candidate.key) ?? [],
    }))
    .filter((group) => group.items.length > 0);
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

function dailySectionDateLabel(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function periodCard(
  items: WorkspaceItemModel[],
  periodStart: string,
  position: PeriodGoalCardPosition,
  horizon: "year" | "month",
): PeriodGoalCardModel {
  return {
    key: `${position}-${periodStart}`,
    label: horizon === "year" ? periodStart.slice(0, 4) : periodStart.slice(0, 7),
    periodStart,
    position,
    goals: goalsForPeriod(items, horizon, periodStart),
  };
}

function goalsForPeriod(
  items: WorkspaceItemModel[],
  horizon: "year" | "month" | "week",
  periodStart: string,
): WorkspaceItemModel[] {
  return items.filter(
    (item) =>
      item.type === "goal" &&
      !terminalStatuses.has(item.status) &&
      item.horizon === horizon &&
      datePart(item.scheduled) === periodStart,
  );
}

export function yearStart(date: string): string {
  return `${date.slice(0, 4)}-01-01`;
}

export function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

export function isoWeekStart(date: string): string {
  const value = new Date(`${date}T00:00:00`);
  const day = value.getDay();
  value.setDate(value.getDate() + (day === 0 ? -6 : 1 - day));
  return formatLocalDate(value);
}

export function addYears(date: string, years: number): string {
  const value = new Date(`${date}T00:00:00`);
  value.setFullYear(value.getFullYear() + years);
  return formatLocalDate(value);
}

export function addMonths(date: string, months: number): string {
  const value = new Date(`${date}T00:00:00`);
  value.setMonth(value.getMonth() + months);
  return formatLocalDate(value);
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
