import type { HealthEvent } from "@/features/health/model/health-model";
import { healthFilterFieldsForScope, healthSortFieldsForScope } from "@/features/health/model/health-table-views";
import { orderVisiblePlannerGroups, type PlannerGroupSettings } from "@/features/workbench/model/planner-group-settings";
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

export const healthMetricIdentities = {
  weight: { category: "weight", metricKey: "body_weight", name: "Body weight", unit: "kg" },
  sleep: { category: "sleep", metricKey: "sleep_duration", name: "Sleep", unit: "hours" },
  crp: { category: "lab", metricKey: "crp", name: "CRP", unit: "mg/L" },
  calprotectin: {
    category: "lab", metricKey: "fecal_calprotectin",
    name: "Fecal calprotectin", unit: "µg/g",
  },
  condition: {
    category: "symptom", metricKey: "overall_condition",
    name: "Overall condition", unit: null,
  },
} as const;

export type HealthMetricField = keyof typeof healthMetricIdentities;
export type HealthMetricsRow = {
  id: string;
  date: string;
  events: Partial<Record<HealthMetricField, HealthEvent>>;
  weight: number | null;
  sleep: number | null;
  crp: number | null;
  calprotectin: number | null;
  condition: number | null;
  note: string;
  createdAt: string;
  updatedAt: string;
};
export type HealthMetricsRowGroup = {
  key: string;
  label: string | null;
  rows: HealthMetricsRow[];
};

const fields = Object.keys(healthMetricIdentities) as HealthMetricField[];
const monthNames = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function deriveHealthMetricsGroups(
  events: readonly HealthEvent[],
  settings: PlannerTableSettings,
  now = new Date(),
): HealthMetricsRowGroup[] {
  const rows = projectRows(events)
    .filter((row) => matchesRules(
      row,
      effectivePlannerFilterRules(
        settings.filterRules,
        healthFilterFieldsForScope("health.metrics"),
      ),
      settings.filterMode,
      localCalendarDate(now),
    ))
    .sort((left, right) => compareRows(left, right, settings.sortRules));
  return groupRows(rows, settings.groupSettings);
}

function projectRows(events: readonly HealthEvent[]): HealthMetricsRow[] {
  const byDate = new Map<string, Partial<Record<HealthMetricField, HealthEvent>>>();
  for (const event of events) {
    const field = metricField(event);
    if (!field || event.deletedAt !== null) continue;
    const date = localCalendarDate(new Date(event.occurredAt));
    const members = byDate.get(date) ?? {};
    members[field] = event;
    byDate.set(date, members);
  }
  return [...byDate].map(([date, eventsByField]) => {
    const members = Object.values(eventsByField);
    const condition = eventsByField.condition;
    return {
      id: date,
      date,
      events: eventsByField,
      weight: metricValue(eventsByField.weight),
      sleep: metricValue(eventsByField.sleep),
      crp: metricValue(eventsByField.crp),
      calprotectin: metricValue(eventsByField.calprotectin),
      condition: metricValue(condition),
      note: condition?.attributes.kind === "symptom"
        ? condition.attributes.conditionNote ?? ""
        : "",
      createdAt: members.reduce((earliest, event) =>
        Date.parse(event.createdAt) < Date.parse(earliest.createdAt) ? event : earliest).createdAt,
      updatedAt: members.reduce((latest, event) =>
        Date.parse(event.updatedAt) > Date.parse(latest.updatedAt) ? event : latest).updatedAt,
    };
  });
}

function metricField(event: HealthEvent): HealthMetricField | null {
  return fields.find((field) => {
    const identity = healthMetricIdentities[field];
    return event.category === identity.category
      && event.metricKey === identity.metricKey
      && event.name === identity.name
      && (identity.unit === null
        ? event.unit === null || event.unit === "score"
        : event.unit === identity.unit);
  }) ?? null;
}

function metricValue(event: HealthEvent | undefined): number | null {
  return event?.value ?? null;
}

function matchesRules(
  row: HealthMetricsRow,
  rules: readonly PlannerFilterRule[],
  mode: PlannerTableSettings["filterMode"],
  today: string,
): boolean {
  if (rules.length === 0) return true;
  const matches = rules.map((rule) =>
    matchesPlannerFilterValue(filterValue(row, rule.field), rule, today));
  return mode === "and" ? matches.every(Boolean) : matches.some(Boolean);
}

function filterValue(row: HealthMetricsRow, field: PlannerFilterField): string | number | null {
  if (field === "date") return row.date;
  if (fields.includes(field as HealthMetricField)) return row[field as HealthMetricField];
  return null;
}

function compareRows(
  left: HealthMetricsRow,
  right: HealthMetricsRow,
  rules: readonly PlannerSortRule[],
): number {
  const active = rules.filter((rule) =>
    healthSortFieldsForScope("health.metrics").includes(rule.field));
  const effective = active.length > 0
    ? active
    : [{ id: "health.metrics-default-sort", field: "date", direction: "desc" } as const];
  for (const rule of effective) {
    const leftValue = sortValue(left, rule.field);
    const rightValue = sortValue(right, rule.field);
    if (leftValue === null || rightValue === null) {
      if (leftValue !== rightValue) return leftValue === null ? 1 : -1;
      continue;
    }
    const result = typeof leftValue === "number"
      ? leftValue - (rightValue as number)
      : leftValue.localeCompare(rightValue as string);
    if (result !== 0) return rule.direction === "asc" ? result : -result;
  }
  return left.id.localeCompare(right.id);
}

function sortValue(row: HealthMetricsRow, field: PlannerSortBy): string | number | null {
  if (field === "date") return row.date;
  if (fields.includes(field as HealthMetricField)) return row[field as HealthMetricField];
  return null;
}

function groupRows(
  rows: HealthMetricsRow[],
  settings: PlannerGroupSettings,
): HealthMetricsRowGroup[] {
  if (settings.groupBy === "none" || rows.length === 0) {
    return [{ key: "all", label: null, rows }];
  }
  const groups = new Map<string, HealthMetricsRowGroup>();
  for (const row of rows) {
    const group = metricGroup(row, settings.groupBy);
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

function metricGroup(
  row: HealthMetricsRow,
  groupBy: PlannerGroupBy,
): Pick<HealthMetricsRowGroup, "key" | "label"> {
  if (groupBy === "month") {
    const key = row.date.slice(0, 7);
    return { key, label: `${monthNames[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}` };
  }
  if (groupBy === "week") {
    const key = isoWeekStart(row.date);
    return { key, label: `Week of ${key}` };
  }
  return { key: "all", label: null };
}
