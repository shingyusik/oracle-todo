import type { DietEntry, MealType } from "@/features/health/model/health-model";
import {
  healthFilterFieldsForScope,
  healthSortFieldsForScope,
} from "@/features/health/model/health-table-views";
import {
  orderVisiblePlannerGroups,
  type PlannerGroupSettings,
} from "@/features/workbench/model/planner-group-settings";
import {
  effectivePlannerFilterRules,
  isoWeekStart,
  localCalendarDate,
  matchesPlannerFilterValue,
  type PlannerFilterField,
  type PlannerFilterRule,
  type PlannerGroupBy,
  type PlannerSortBy,
  type PlannerSortRule,
  type PlannerTableSettings,
} from "@/features/workbench/model/planner-model";

export type DietRow = {
  id: string;
  entry: DietEntry;
  date: string;
  timeLabel: string;
  mealType: MealType;
  mealLabel: string;
  food: string;
  tags: string[];
  hasPhoto: boolean;
  note: string;
};

export type DietRowGroup = {
  key: string;
  label: string | null;
  rows: DietRow[];
};

const mealLabels: Record<MealType, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snack",
  late_night: "Late night",
};
const monthNames = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function deriveDietGroups(
  entries: readonly DietEntry[],
  settings: PlannerTableSettings,
  now = new Date(),
): DietRowGroup[] {
  const today = localCalendarDate(now);
  const rules = effectivePlannerFilterRules(
    settings.filterRules,
    healthFilterFieldsForScope("health.diet"),
  );
  const rows = entries
    .filter(({ deletedAt }) => deletedAt === null)
    .map(projectDietRow)
    .filter((row) => matchesDietRules(row, rules, settings.filterMode, today))
    .sort((left, right) => compareDietRows(left, right, settings.sortRules));
  return groupDietRows(rows, settings.groupSettings);
}

function projectDietRow(entry: DietEntry): DietRow {
  const occurredAt = new Date(entry.occurredAt);
  return {
    id: entry.id,
    entry,
    date: localCalendarDate(occurredAt),
    timeLabel: occurredAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    mealType: entry.mealType,
    mealLabel: mealLabels[entry.mealType],
    food: entry.foodName,
    tags: [...entry.tags],
    hasPhoto: entry.mediaId !== null,
    note: entry.note ?? "",
  };
}

function matchesDietRules(
  row: DietRow,
  rules: readonly PlannerFilterRule[],
  mode: PlannerTableSettings["filterMode"],
  today: string,
): boolean {
  if (rules.length === 0) return true;
  const matches = rules.map((rule) =>
    matchesPlannerFilterValue(dietFilterValue(row, rule.field), rule, today),
  );
  return mode === "and" ? matches.every(Boolean) : matches.some(Boolean);
}

function dietFilterValue(
  row: DietRow,
  field: PlannerFilterField,
): string | string[] | null {
  if (field === "date") return row.date;
  if (field === "meal_type") return row.mealType;
  if (field === "food") return row.food;
  if (field === "tags") return row.tags;
  if (field === "has_photo") return row.hasPhoto ? "with-photo" : "without-photo";
  return null;
}

function compareDietRows(
  left: DietRow,
  right: DietRow,
  rules: readonly PlannerSortRule[],
): number {
  const activeRules = rules.filter((rule) =>
    healthSortFieldsForScope("health.diet").includes(rule.field),
  );
  const effectiveRules = activeRules.length > 0
    ? activeRules
    : [{ id: "health.diet-default-sort", field: "date", direction: "desc" } as const];
  for (const rule of effectiveRules) {
    const result = compareValue(dietSortValue(left, rule.field), dietSortValue(right, rule.field));
    if (result !== 0) return rule.direction === "asc" ? result : -result;
  }
  return left.id.localeCompare(right.id);
}

function dietSortValue(row: DietRow, field: PlannerSortBy): string | number {
  if (field === "date") return Date.parse(row.entry.occurredAt);
  if (field === "meal_type") return row.mealType;
  if (field === "food") return row.food;
  if (field === "created") return Date.parse(row.entry.createdAt);
  if (field === "updated") return Date.parse(row.entry.updatedAt);
  return "";
}

function compareValue(left: string | number, right: string | number): number {
  return typeof left === "number" && typeof right === "number"
    ? left - right
    : String(left).localeCompare(String(right));
}

function groupDietRows(rows: DietRow[], settings: PlannerGroupSettings): DietRowGroup[] {
  if (settings.groupBy === "none" || rows.length === 0) {
    return [{ key: "all", label: null, rows }];
  }
  const groups = new Map<string, DietRowGroup>();
  for (const row of rows) {
    for (const group of dietGroups(row, settings.groupBy)) {
      const stored = groups.get(group.key) ?? { ...group, rows: [] };
      stored.rows.push(row);
      groups.set(group.key, stored);
    }
  }
  return orderVisiblePlannerGroups(
    [...groups.values()].map(({ key, label, rows: groupRows }) => ({
      key, label: label ?? key, count: groupRows.length,
    })),
    settings,
  ).map(({ key }) => groups.get(key)!);
}

function dietGroups(
  row: DietRow,
  groupBy: PlannerGroupBy,
): Pick<DietRowGroup, "key" | "label">[] {
  if (groupBy === "month") {
    const key = row.date.slice(0, 7);
    return [{ key, label: `${monthNames[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}` }];
  }
  if (groupBy === "week") {
    const key = isoWeekStart(row.date);
    return [{ key, label: `Week of ${key}` }];
  }
  if (groupBy === "day") return [{ key: row.date, label: row.date }];
  if (groupBy === "meal_type") return [{ key: row.mealType, label: row.mealLabel }];
  if (groupBy === "tag") {
    return row.tags.length > 0
      ? row.tags.map((tag) => ({ key: tag, label: tag }))
      : [{ key: "untagged", label: "Untagged" }];
  }
  if (groupBy === "has_photo") {
    return [row.hasPhoto
      ? { key: "with-photo", label: "With photo" }
      : { key: "without-photo", label: "Without photo" }];
  }
  return [{ key: "all", label: null }];
}
