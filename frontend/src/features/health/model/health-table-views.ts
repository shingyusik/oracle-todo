import {
  defaultPlannerGroupSettings,
  normalizePlannerGroupSettings,
} from "@/features/workbench/model/planner-group-settings";
import {
  clonePlannerTableSettings,
  normalizePlannerFilterRule,
  normalizePlannerSortRule,
  type PlannerFilterField,
  type PlannerFilterMode,
  type PlannerGroupBy,
  type PlannerSortBy,
  type PlannerTableSettings,
} from "@/features/workbench/model/planner-model";
import type { TableViewSettingsAdapter } from "@/features/workbench/model/table-view-tabs";

export const healthTableScopeIds = ["health.diet"] as const;
export type HealthTableScopeId = (typeof healthTableScopeIds)[number];

export const healthDietFilterSelectOptions = {
  meal_type: [
    { value: "breakfast", label: "Breakfast" },
    { value: "lunch", label: "Lunch" },
    { value: "dinner", label: "Dinner" },
    { value: "snack", label: "Snack" },
    { value: "late_night", label: "Late night" },
  ],
  has_photo: [
    { value: "with-photo", label: "Yes" },
    { value: "without-photo", label: "No" },
  ],
} satisfies Partial<Record<PlannerFilterField, { value: string; label: string }[]>>;

const filterFields = [
  "date", "meal_type", "food", "tags", "has_photo",
] as const satisfies readonly PlannerFilterField[];
const sortFields = [...filterFields, "updated"] as const satisfies readonly PlannerSortBy[];
const groupOptions = [
  { value: "none", label: "None" },
  { value: "month", label: "Month" },
  { value: "week", label: "Week" },
  { value: "day", label: "Day" },
  { value: "meal_type", label: "Meal type" },
  { value: "tag", label: "Tag" },
  { value: "has_photo", label: "Photo" },
] as const satisfies readonly { value: PlannerGroupBy; label: string }[];

export function healthFilterFieldsForScope(
  _scope: HealthTableScopeId,
): readonly PlannerFilterField[] {
  return filterFields;
}

export function healthSortFieldsForScope(
  _scope: HealthTableScopeId,
): readonly PlannerSortBy[] {
  return sortFields;
}

export function healthGroupOptionsForScope(_scope: HealthTableScopeId) {
  return groupOptions;
}

export function defaultHealthTableSettings(
  scope: HealthTableScopeId,
): PlannerTableSettings {
  return {
    filterMode: "and",
    filterRules: [],
    sortRules: [{ id: `${scope}-default-sort`, field: "date", direction: "desc" }],
    groupSettings: defaultPlannerGroupSettings(),
  };
}

export function normalizeHealthTableSettings(
  scope: HealthTableScopeId,
  candidate: unknown,
): PlannerTableSettings {
  const defaults = defaultHealthTableSettings(scope);
  if (!isRecord(candidate)) return defaults;
  const filterRules = Array.isArray(candidate.filterRules)
    ? candidate.filterRules.flatMap((rule) => {
        const normalized = normalizePlannerFilterRule(rule, filterFields);
        return normalized ? [normalized] : [];
      })
    : defaults.filterRules;
  const sortRules = Array.isArray(candidate.sortRules)
    ? candidate.sortRules.flatMap((rule) => {
        const normalized = normalizePlannerSortRule(rule, sortFields);
        return normalized ? [normalized] : [];
      })
    : defaults.sortRules;
  const requestedGroup = isRecord(candidate.groupSettings) &&
      typeof candidate.groupSettings.groupBy === "string"
    ? candidate.groupSettings.groupBy as PlannerGroupBy
    : "none";
  const groupSettings = normalizePlannerGroupSettings({
    ...(isRecord(candidate.groupSettings) ? candidate.groupSettings : {}),
    groupBy: "none",
  });
  const allowedGroups = new Set(groupOptions.map(({ value }) => value));

  return {
    filterMode: normalizeFilterMode(candidate.filterMode),
    filterRules,
    sortRules,
    groupSettings: {
      ...groupSettings,
      groupBy: allowedGroups.has(requestedGroup as (typeof groupOptions)[number]["value"])
        ? requestedGroup
        : "none",
    },
  };
}

export const healthTableViewSettingsAdapter = {
  defaultSettings: defaultHealthTableSettings,
  normalizeSettings: normalizeHealthTableSettings,
  cloneSettings: clonePlannerTableSettings,
} satisfies TableViewSettingsAdapter<HealthTableScopeId, PlannerTableSettings>;

function normalizeFilterMode(value: unknown): PlannerFilterMode {
  return value === "or" ? "or" : "and";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
