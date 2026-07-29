import {
  buildPlannerGroupCandidates,
  defaultPlannerGroupSettings,
  normalizePlannerGroupSettings,
  type PlannerGroupSettings,
} from "@/features/workbench/model/planner-group-settings";
import {
  clonePlannerTableSettings,
  filterPlannerItemsByRules,
  groupPlannerItems,
  normalizePlannerFilterRule,
  normalizePlannerSortRule,
  sortPlannerItems,
  type PlannerFilterField,
  type PlannerFilterMode,
  type PlannerGroupBy,
  type PlannerSortBy,
  type PlannerTableSettings,
} from "@/features/workbench/model/planner-model";
import type {
  TableViewSettingsAdapter,
  TableViewTabsState,
} from "@/features/workbench/model/table-view-tabs";
import type {
  WorkspaceItemModel,
  WorkspaceItemsModel,
} from "@/features/workbench/model/workbench-model";

export const workspaceTableScopeIds = [
  "workspace.area",
  "workspace.project",
  "workspace.goal",
  "workspace.routine",
  "workspace.task",
  "workspace.event",
] as const;

export type WorkspaceTableScopeId =
  | (typeof workspaceTableScopeIds)[number]
  | `detail.${WorkspaceItemModel["type"]}.${WorkspaceItemModel["type"]}`;

export type WorkspaceTableViewsState = Partial<
  Record<WorkspaceTableScopeId, TableViewTabsState<PlannerTableSettings>>
>;

export type WorkspaceViewGroup = {
  key: string;
  label: string;
  items: WorkspaceItemModel[];
};

export type CollapsedWorkspaceGroups = {
  groups: WorkspaceViewGroup[];
  visibleCount: number;
  hiddenCount: number;
};

type WorkspaceItemType =
  "area" | "project" | "goal" | "routine" | "task" | "event";

const workspaceFilterFields: Record<
  WorkspaceItemType,
  readonly PlannerFilterField[]
> = {
  area: ["title", "status", "tags", "note"],
  project: ["title", "status", "tags", "area", "due", "note"],
  goal: ["title", "status", "tags", "horizon", "scheduled", "parent", "note"],
  routine: [
    "title",
    "status",
    "tags",
    "area",
    "project",
    "recurrence_rule",
    "materialization_policy",
    "priority",
    "description",
    "note",
  ],
  task: [
    "title",
    "status",
    "tags",
    "area",
    "project",
    "routine",
    "scheduled",
    "due",
    "priority",
    "description",
    "note",
  ],
  event: [
    "title",
    "status",
    "tags",
    "area",
    "project",
    "scheduled",
    "due",
    "priority",
    "location",
    "participants",
    "commitment_type",
    "description",
    "note",
  ],
};

const workspaceGroupFields: Record<
  WorkspaceItemType,
  readonly PlannerGroupBy[]
> = {
  area: ["none", "tag", "status"],
  project: ["none", "area", "tag", "status"],
  goal: ["none", "tag", "status"],
  routine: ["none", "area", "project", "tag", "status"],
  task: ["none", "area", "project", "routine", "tag", "status"],
  event: ["none", "area", "project", "tag", "status"],
};

const workspaceSortFields: Record<WorkspaceItemType, readonly PlannerSortBy[]> =
  {
    area: [...workspaceFilterFields.area, "updated"],
    project: [...workspaceFilterFields.project, "updated"],
    goal: [...workspaceFilterFields.goal, "updated"],
    routine: [...workspaceFilterFields.routine, "updated"],
    task: [...workspaceFilterFields.task, "updated"],
    event: [...workspaceFilterFields.event, "updated"],
  };

export function workspaceScopeForPanel(
  panelId: "areas" | "projects" | "goals" | "routines" | "tasks" | "events",
): WorkspaceTableScopeId {
  return `workspace.${panelId.slice(0, -1)}` as WorkspaceTableScopeId;
}

export function detailWorkspaceScope(
  parentType: WorkspaceItemModel["type"],
  childType: WorkspaceItemModel["type"],
): WorkspaceTableScopeId {
  return `detail.${parentType}.${childType}`;
}

export function workspaceFilterFieldsForScope(
  scope: WorkspaceTableScopeId,
): readonly PlannerFilterField[] {
  return workspaceFilterFields[workspaceItemTypeForScope(scope)];
}

export function workspaceSortFieldsForScope(
  scope: WorkspaceTableScopeId,
): readonly PlannerSortBy[] {
  return workspaceSortFields[workspaceItemTypeForScope(scope)];
}

export const workspaceTableViewSettingsAdapter: TableViewSettingsAdapter<
  WorkspaceTableScopeId,
  PlannerTableSettings
> = {
  defaultSettings: () => defaultWorkspaceTableSettings(),
  normalizeSettings: (scope, candidate) =>
    normalizeWorkspaceTableSettings(scope, candidate),
  cloneSettings: clonePlannerTableSettings,
};

export function defaultWorkspaceTableSettings(): PlannerTableSettings {
  return {
    filterMode: "and",
    filterRules: [],
    sortRules: [
      { id: "workspace-default-sort", field: "updated", direction: "desc" },
    ],
    groupSettings: defaultPlannerGroupSettings(),
  };
}

export function normalizeWorkspaceTableSettings(
  scope: WorkspaceTableScopeId,
  candidate: unknown,
): PlannerTableSettings {
  const defaults = defaultWorkspaceTableSettings();
  if (!isRecord(candidate)) return defaults;

  const filterFields = workspaceFilterFieldsForScope(scope);
  const sortFields = workspaceSortFieldsForScope(scope);
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
  const groupSettings = normalizeWorkspaceGroupSettings(
    candidate.groupSettings,
    workspaceItemTypeForScope(scope),
  );

  return {
    filterMode: normalizeFilterMode(candidate.filterMode),
    filterRules,
    sortRules,
    groupSettings,
  };
}

export function deriveWorkspaceViewGroups(
  scope: WorkspaceTableScopeId,
  items: WorkspaceItemModel[],
  settings: PlannerTableSettings,
  relatedItems: WorkspaceItemsModel["relatedItems"],
): WorkspaceViewGroup[] {
  const normalized = normalizeWorkspaceTableSettings(scope, settings);
  const filtered = filterPlannerItemsByRules(
    items,
    relatedItems,
    normalized.filterRules,
    normalized.filterMode,
    new Date().toISOString().slice(0, 10),
  );
  const sorted = sortPlannerItems(filtered, normalized.sortRules);
  const candidates = buildPlannerGroupCandidates({
    view: "daily",
    groupBy: normalized.groupSettings.groupBy,
    items: sorted,
    relatedItems,
  });
  return groupPlannerItems(
    sorted,
    relatedItems,
    normalized.groupSettings,
    candidates,
  );
}

export function collapseWorkspaceGroups(
  groups: WorkspaceViewGroup[],
  limit = 5,
): CollapsedWorkspaceGroups {
  const maximum = Math.max(0, limit);
  const renderedCount = groups.reduce(
    (count, group) => count + group.items.length,
    0,
  );
  let remaining = maximum;
  const visibleGroups = groups.flatMap((group) => {
    if (remaining <= 0) return [];
    const items = group.items.slice(0, remaining);
    remaining -= items.length;
    return items.length > 0 ? [{ ...group, items }] : [];
  });
  const visibleCount = visibleGroups.reduce(
    (count, group) => count + group.items.length,
    0,
  );
  return {
    groups: visibleGroups,
    visibleCount,
    hiddenCount: renderedCount - visibleCount,
  };
}

function workspaceItemTypeForScope(
  scope: WorkspaceTableScopeId,
): WorkspaceItemType {
  const type = scope.startsWith("workspace.")
    ? scope.slice("workspace.".length)
    : scope.split(".").at(-1);
  if (
    type === "area" ||
    type === "project" ||
    type === "goal" ||
    type === "routine" ||
    type === "task" ||
    type === "event"
  )
    return type;
  return "task";
}

function normalizeWorkspaceGroupSettings(
  value: unknown,
  itemType: WorkspaceItemType,
): PlannerGroupSettings {
  const normalized = normalizePlannerGroupSettings(value);
  return workspaceGroupFields[itemType].includes(normalized.groupBy)
    ? normalized
    : { ...normalized, groupBy: "none" };
}

function normalizeFilterMode(value: unknown): PlannerFilterMode {
  return value === "or" ? "or" : "and";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
