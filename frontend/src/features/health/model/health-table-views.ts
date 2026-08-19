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

export const healthTableScopeIds = ["health.diet", "health.bowel"] as const;
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

export const healthBowelFilterSelectOptions = {
  bristol_scale: Array.from({ length: 7 }, (_, index) => ({
    value: String(index + 1), label: `Type ${index + 1}`,
  })),
  blood_visible: [
    { value: "yes", label: "Yes" },
    { value: "no", label: "No" },
  ],
} satisfies Partial<Record<PlannerFilterField, { value: string; label: string }[]>>;

const dietFilterFields = [
  "date", "meal_type", "food", "tags", "has_photo",
] as const satisfies readonly PlannerFilterField[];
const bowelFilterFields = [
  "date", "bristol_scale", "blood_visible",
] as const satisfies readonly PlannerFilterField[];
const dietSortFields = [
  "date", "meal_type", "food", "created", "updated",
] as const satisfies readonly PlannerSortBy[];
const bowelSortFields = [
  "date", "bristol_scale", "created", "updated",
] as const satisfies readonly PlannerSortBy[];
const dietGroupOptions = [
  { value: "none", label: "None" },
  { value: "month", label: "Month" },
  { value: "week", label: "Week" },
  { value: "day", label: "Day" },
  { value: "meal_type", label: "Meal type" },
  { value: "tag", label: "Tag" },
  { value: "has_photo", label: "Photo" },
] as const satisfies readonly { value: PlannerGroupBy; label: string }[];
const bowelGroupOptions = [
  { value: "none", label: "None" },
  { value: "month", label: "Month" },
  { value: "week", label: "Week" },
  { value: "day", label: "Day" },
  { value: "bristol_scale", label: "Bristol Scale" },
  { value: "blood_visible", label: "Blood Visible" },
] as const satisfies readonly { value: PlannerGroupBy; label: string }[];

export function healthFilterFieldsForScope(scope: HealthTableScopeId): readonly PlannerFilterField[] {
  return scope === "health.bowel" ? bowelFilterFields : dietFilterFields;
}

export function healthSortFieldsForScope(scope: HealthTableScopeId): readonly PlannerSortBy[] {
  return scope === "health.bowel" ? bowelSortFields : dietSortFields;
}

export function healthGroupOptionsForScope(scope: HealthTableScopeId) {
  return scope === "health.bowel" ? bowelGroupOptions : dietGroupOptions;
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
  const filterFields = healthFilterFieldsForScope(scope);
  const sortFields = healthSortFieldsForScope(scope);
  const groupOptions = healthGroupOptionsForScope(scope);
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
