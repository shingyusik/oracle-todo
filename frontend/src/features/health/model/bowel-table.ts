import type { HealthEvent } from "@/features/health/model/health-model";
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

export type BowelRow = {
  id: string;
  event: HealthEvent;
  date: string;
  timeLabel: string;
  bristolScale: number;
  bloodVisible: boolean;
  bloodLabel: "Yes" | "No";
  note: string;
};

export type BowelRowGroup = { key: string; label: string | null; rows: BowelRow[] };

const monthNames = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function deriveBowelGroups(
  events: readonly HealthEvent[],
  settings: PlannerTableSettings,
  now = new Date(),
): BowelRowGroup[] {
  const today = localCalendarDate(now);
  const rules = effectivePlannerFilterRules(
    settings.filterRules,
    healthFilterFieldsForScope("health.bowel"),
  );
  const rows = events
    .filter((event) => event.deletedAt === null
      && event.category === "bowel"
      && event.attributes.kind === "bowel")
    .map(projectBowelRow)
    .filter((row) => matchesBowelRules(row, rules, settings.filterMode, today))
    .sort((left, right) => compareBowelRows(left, right, settings.sortRules));
  return groupBowelRows(rows, settings.groupSettings);
}

function projectBowelRow(event: HealthEvent): BowelRow {
  if (event.attributes.kind !== "bowel") throw new TypeError("invalid bowel event attributes");
  const occurredAt = new Date(event.occurredAt);
  return {
    id: event.id,
    event,
    date: localCalendarDate(occurredAt),
    timeLabel: occurredAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    bristolScale: event.attributes.bristolScale,
    bloodVisible: event.attributes.bloodVisible,
    bloodLabel: event.attributes.bloodVisible ? "Yes" : "No",
    note: event.note ?? "",
  };
}

function matchesBowelRules(
  row: BowelRow,
  rules: readonly PlannerFilterRule[],
  mode: PlannerTableSettings["filterMode"],
  today: string,
): boolean {
  if (rules.length === 0) return true;
  const matches = rules.map((rule) =>
    matchesPlannerFilterValue(bowelFilterValue(row, rule.field), rule, today));
  return mode === "and" ? matches.every(Boolean) : matches.some(Boolean);
}

function bowelFilterValue(row: BowelRow, field: PlannerFilterField): string | number | null {
  if (field === "date") return row.date;
  if (field === "bristol_scale") return String(row.bristolScale);
  if (field === "blood_visible") return row.bloodVisible ? "yes" : "no";
  return null;
}

function compareBowelRows(
  left: BowelRow,
  right: BowelRow,
  rules: readonly PlannerSortRule[],
): number {
  const activeRules = rules.filter((rule) =>
    healthSortFieldsForScope("health.bowel").includes(rule.field));
  const effectiveRules = activeRules.length > 0
    ? activeRules
    : [{ id: "health.bowel-default-sort", field: "date", direction: "desc" } as const];
  for (const rule of effectiveRules) {
    const result = compareValue(bowelSortValue(left, rule.field), bowelSortValue(right, rule.field));
    if (result !== 0) return rule.direction === "asc" ? result : -result;
  }
  return left.id.localeCompare(right.id);
}

function bowelSortValue(row: BowelRow, field: PlannerSortBy): string | number {
  if (field === "date") return Date.parse(row.event.occurredAt);
  if (field === "bristol_scale") return row.bristolScale;
  if (field === "created") return Date.parse(row.event.createdAt);
  if (field === "updated") return Date.parse(row.event.updatedAt);
  return "";
}

function compareValue(left: string | number, right: string | number): number {
  return typeof left === "number" && typeof right === "number"
    ? left - right
    : String(left).localeCompare(String(right));
}

function groupBowelRows(rows: BowelRow[], settings: PlannerGroupSettings): BowelRowGroup[] {
  if (settings.groupBy === "none" || rows.length === 0) {
    return [{ key: "all", label: null, rows }];
  }
  const groups = new Map<string, BowelRowGroup>();
  for (const row of rows) {
    const group = bowelGroup(row, settings.groupBy);
    const stored = groups.get(group.key) ?? { ...group, rows: [] };
    stored.rows.push(row);
    groups.set(group.key, stored);
  }
  return orderVisiblePlannerGroups(
    [...groups.values()].map(({ key, label, rows: groupRows }) => ({
      key, label: label ?? key, count: groupRows.length,
    })),
    settings,
  ).map(({ key }) => groups.get(key)!);
}

function bowelGroup(
  row: BowelRow,
  groupBy: PlannerGroupBy,
): Pick<BowelRowGroup, "key" | "label"> {
  if (groupBy === "month") {
    const key = row.date.slice(0, 7);
    return { key, label: `${monthNames[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}` };
  }
  if (groupBy === "week") {
    const key = isoWeekStart(row.date);
    return { key, label: `Week of ${key}` };
  }
  if (groupBy === "day") return { key: row.date, label: row.date };
  if (groupBy === "bristol_scale") {
    return { key: String(row.bristolScale), label: `Type ${row.bristolScale}` };
  }
  if (groupBy === "blood_visible") {
    return { key: row.bloodVisible ? "yes" : "no", label: row.bloodLabel };
  }
  return { key: "all", label: null };
}
