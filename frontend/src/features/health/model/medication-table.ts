import type { HealthEvent, MedicationUnit } from "@/features/health/model/health-model";
import { healthFilterFieldsForScope, healthSortFieldsForScope } from "@/features/health/model/health-table-views";
import { orderVisiblePlannerGroups, type PlannerGroupSettings } from "@/features/workbench/model/planner-group-settings";
import {
  effectivePlannerFilterRules, isoWeekStart, localCalendarDate, matchesPlannerFilterValue,
  type PlannerFilterField, type PlannerFilterRule, type PlannerGroupBy, type PlannerSortBy,
  type PlannerSortRule, type PlannerTableSettings,
} from "@/features/workbench/model/planner-model";

export type MedicationRow = {
  id: string; event: HealthEvent; date: string; takenAtLabel: string;
  medicationName: string; dose: number; unit: MedicationUnit; unitLabel: string; note: string;
};
export type MedicationRowGroup = { key: string; label: string | null; rows: MedicationRow[] };

const unitLabels: Record<MedicationUnit, string> = {
  tablet: "정", capsule: "캡슐", packet: "포", mg: "mg", g: "g", ml: "ml", drop: "방울", dose: "회",
};
const monthNames = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function deriveMedicationGroups(
  events: readonly HealthEvent[], settings: PlannerTableSettings, now = new Date(),
): MedicationRowGroup[] {
  const today = localCalendarDate(now);
  const rules = effectivePlannerFilterRules(settings.filterRules, healthFilterFieldsForScope("health.medication"));
  const rows = events
    .filter((event) => event.deletedAt === null && event.category === "medication" && event.attributes.kind === "medication")
    .map(projectMedicationRow)
    .filter((row) => matchesRules(row, rules, settings.filterMode, today))
    .sort((left, right) => compareRows(left, right, settings.sortRules));
  return groupRows(rows, settings.groupSettings);
}

function projectMedicationRow(event: HealthEvent): MedicationRow {
  if (event.attributes.kind !== "medication") throw new TypeError("invalid medication event attributes");
  const occurredAt = new Date(event.occurredAt);
  return {
    id: event.id, event, date: localCalendarDate(occurredAt),
    takenAtLabel: occurredAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    medicationName: event.attributes.medicationName, dose: event.attributes.dose,
    unit: event.attributes.unit, unitLabel: unitLabels[event.attributes.unit], note: event.note ?? "",
  };
}

function matchesRules(row: MedicationRow, rules: readonly PlannerFilterRule[], mode: PlannerTableSettings["filterMode"], today: string): boolean {
  if (rules.length === 0) return true;
  const matches = rules.map((rule) => matchesPlannerFilterValue(filterValue(row, rule.field), rule, today));
  return mode === "and" ? matches.every(Boolean) : matches.some(Boolean);
}

function filterValue(row: MedicationRow, field: PlannerFilterField): string | null {
  if (field === "date") return row.date;
  if (field === "medication_name") return row.medicationName;
  if (field === "medication_unit") return row.unit;
  return null;
}

function compareRows(left: MedicationRow, right: MedicationRow, rules: readonly PlannerSortRule[]): number {
  const active = rules.filter((rule) => healthSortFieldsForScope("health.medication").includes(rule.field));
  const effective = active.length > 0 ? active : [{ id: "health.medication-default-sort", field: "date", direction: "desc" } as const];
  for (const rule of effective) {
    const result = compareValue(sortValue(left, rule.field), sortValue(right, rule.field));
    if (result !== 0) return rule.direction === "asc" ? result : -result;
  }
  return left.id.localeCompare(right.id);
}

function sortValue(row: MedicationRow, field: PlannerSortBy): string | number {
  if (field === "date") return Date.parse(row.event.occurredAt);
  if (field === "medication_name") return row.medicationName;
  if (field === "dose") return row.dose;
  if (field === "created") return Date.parse(row.event.createdAt);
  if (field === "updated") return Date.parse(row.event.updatedAt);
  return "";
}

function compareValue(left: string | number, right: string | number): number {
  return typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right));
}

function groupRows(rows: MedicationRow[], settings: PlannerGroupSettings): MedicationRowGroup[] {
  if (settings.groupBy === "none" || rows.length === 0) return [{ key: "all", label: null, rows }];
  const groups = new Map<string, MedicationRowGroup>();
  for (const row of rows) {
    const group = medicationGroup(row, settings.groupBy);
    const stored = groups.get(group.key) ?? { ...group, rows: [] };
    stored.rows.push(row);
    groups.set(group.key, stored);
  }
  return orderVisiblePlannerGroups(
    [...groups.values()].map(({ key, label, rows: groupRows }) => ({ key, label: label ?? key, count: groupRows.length })),
    settings,
  ).map(({ key }) => groups.get(key)!);
}

function medicationGroup(row: MedicationRow, groupBy: PlannerGroupBy): Pick<MedicationRowGroup, "key" | "label"> {
  if (groupBy === "month") {
    const key = row.date.slice(0, 7);
    return { key, label: `${monthNames[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}` };
  }
  if (groupBy === "week") {
    const key = isoWeekStart(row.date);
    return { key, label: `Week of ${key}` };
  }
  if (groupBy === "day") return { key: row.date, label: row.date };
  if (groupBy === "medication_name") return { key: row.medicationName, label: row.medicationName };
  if (groupBy === "medication_unit") return { key: row.unit, label: row.unitLabel };
  return { key: "all", label: null };
}
