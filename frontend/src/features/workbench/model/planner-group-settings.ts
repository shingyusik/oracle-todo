import type { PlannerGroupBy } from "@/features/workbench/model/planner-model";
import type {
  WorkspaceItemModel,
  WorkspaceItemsModel,
} from "@/features/workbench/model/workbench-model";

export type PlannerViewId = "yearly" | "monthly" | "weekly" | "daily";
export type PlannerGroupSort = "manual" | "alphabetical" | "reverse_alphabetical";

export type PlannerGroupSettings = {
  groupBy: PlannerGroupBy;
  sort: PlannerGroupSort;
  hideEmpty: boolean;
  manualOrder: string[];
  hiddenGroupKeys: string[];
};

export type PlannerGroupCandidate = {
  key: string;
  label: string;
  count: number;
};

const groupByValues = new Set<PlannerGroupBy>([
  "none",
  "area",
  "project",
  "routine",
  "tag",
  "item_type",
  "status",
]);
const sortValues = new Set<PlannerGroupSort>([
  "manual",
  "alphabetical",
  "reverse_alphabetical",
]);
const itemTypeLabels: Record<string, string> = {
  task: "Task",
  event: "Event",
  routine: "Routine",
};
const statusLabels: Record<string, string> = {
  proposed: "Proposed",
  approved: "Approved",
  active: "Active",
  paused: "Paused",
};

export function defaultPlannerGroupSettings(): PlannerGroupSettings {
  return {
    groupBy: "none",
    sort: "manual",
    hideEmpty: true,
    manualOrder: [],
    hiddenGroupKeys: [],
  };
}

export function plannerGroupStorageKey(view: PlannerViewId): string {
  return `oracle-todo.planner-group-settings.v1.${view}`;
}

export function normalizePlannerGroupSettings(value: unknown): PlannerGroupSettings {
  const defaults = defaultPlannerGroupSettings();
  if (!value || typeof value !== "object") return defaults;
  const candidate = value as Partial<PlannerGroupSettings>;
  return {
    groupBy: groupByValues.has(candidate.groupBy as PlannerGroupBy)
      ? (candidate.groupBy as PlannerGroupBy)
      : defaults.groupBy,
    sort: sortValues.has(candidate.sort as PlannerGroupSort)
      ? (candidate.sort as PlannerGroupSort)
      : defaults.sort,
    hideEmpty: typeof candidate.hideEmpty === "boolean" ? candidate.hideEmpty : defaults.hideEmpty,
    manualOrder: uniqueStrings(candidate.manualOrder),
    hiddenGroupKeys: uniqueStrings(candidate.hiddenGroupKeys),
  };
}

export function buildPlannerGroupCandidates({
  groupBy,
  items,
  relatedItems,
}: {
  view: PlannerViewId;
  groupBy: PlannerGroupBy;
  items: WorkspaceItemModel[];
  relatedItems: WorkspaceItemsModel["relatedItems"];
}): PlannerGroupCandidate[] {
  if (groupBy === "none") return [];
  if (groupBy === "tag") return tagCandidates(items);
  if (groupBy === "item_type") return fixedCandidates(["task", "event", "routine"], itemTypeLabels, items, (item) => [item.type]);
  if (groupBy === "status") return fixedCandidates(["proposed", "approved", "active", "paused"], statusLabels, items, (item) => [item.status]);
  const map = relationMap(groupBy, relatedItems);
  const counts = countKeys(items, (item) => [relationValue(item, groupBy) ?? "none"]);
  return [
    ...Object.entries(map).map(([key, label]) => ({ key, label, count: counts.get(key) ?? 0 })),
    { key: "none", label: missingLabel(groupBy), count: counts.get("none") ?? 0 },
  ];
}

export function orderVisiblePlannerGroups(
  candidates: PlannerGroupCandidate[],
  settings: PlannerGroupSettings,
): PlannerGroupCandidate[] {
  const visible = candidates.filter(
    (candidate) =>
      !settings.hiddenGroupKeys.includes(candidate.key) &&
      (!settings.hideEmpty || candidate.count > 0),
  );
  const collator = new Intl.Collator(undefined, { sensitivity: "base" });
  if (settings.sort !== "manual") {
    const direction = settings.sort === "alphabetical" ? 1 : -1;
    return [...visible].sort((left, right) => direction * collator.compare(left.label, right.label));
  }
  const rank = new Map(settings.manualOrder.map((key, index) => [key, index]));
  return visible
    .map((candidate, index) => ({ candidate, index }))
    .sort((left, right) => {
      const ranked =
        (rank.get(left.candidate.key) ?? Number.MAX_SAFE_INTEGER) -
        (rank.get(right.candidate.key) ?? Number.MAX_SAFE_INTEGER);
      return ranked || left.index - right.index;
    })
    .map(({ candidate }) => candidate);
}

export function moveManualGroup(order: string[], key: string, direction: -1 | 1): string[] {
  const next = [...order];
  const index = next.indexOf(key);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= next.length) return next;
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

function uniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((entry): entry is string => typeof entry === "string"))];
}

function tagCandidates(items: WorkspaceItemModel[]): PlannerGroupCandidate[] {
  const counts = countKeys(items, (item) => item.tags && item.tags.length > 0 ? item.tags : ["untagged"]);
  const tags = [...counts.keys()].filter((key) => key !== "untagged").sort((left, right) => left.localeCompare(right));
  return [
    ...tags.map((key) => ({ key, label: key, count: counts.get(key) ?? 0 })),
    { key: "untagged", label: "Untagged", count: counts.get("untagged") ?? 0 },
  ];
}

function fixedCandidates(keys: string[], labels: Record<string, string>, items: WorkspaceItemModel[], values: (item: WorkspaceItemModel) => string[]): PlannerGroupCandidate[] {
  const counts = countKeys(items, values);
  return keys.map((key) => ({ key, label: labels[key] ?? key, count: counts.get(key) ?? 0 }));
}

function countKeys(items: WorkspaceItemModel[], values: (item: WorkspaceItemModel) => string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    for (const key of values(item)) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function relationMap(groupBy: PlannerGroupBy, relatedItems: WorkspaceItemsModel["relatedItems"]): Record<string, string> {
  if (groupBy === "area") return relatedItems.areas;
  if (groupBy === "project") return relatedItems.projects;
  if (groupBy === "routine") return relatedItems.routines;
  return {};
}

function relationValue(item: WorkspaceItemModel, groupBy: PlannerGroupBy): string | null | undefined {
  if (groupBy === "area") return item.area_id;
  if (groupBy === "project") return item.project_id;
  if (groupBy === "routine") return item.routine_id;
  return null;
}

function missingLabel(groupBy: PlannerGroupBy): string {
  if (groupBy === "area") return "No area";
  if (groupBy === "project") return "No project";
  if (groupBy === "routine") return "No routine";
  return "No value";
}
