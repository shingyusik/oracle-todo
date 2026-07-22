import type { WorkspaceItemModel } from "@/features/workbench/model/workbench-model";

export type LinkedItemType = "project" | "routine" | "task" | "event" | "goal";

export type LinkedItemGroup = {
  type: LinkedItemType;
  label: string;
  items: WorkspaceItemModel[];
};

const childRules: Record<
  string,
  {
    field: "area_id" | "project_id" | "routine_id" | "parent_id";
    types: LinkedItemType[];
  }
> = {
  area: { field: "area_id", types: ["project", "routine", "task", "event"] },
  project: { field: "project_id", types: ["routine", "task", "event"] },
  routine: { field: "routine_id", types: ["task"] },
  goal: { field: "parent_id", types: ["goal", "task"] },
};

export function linkedItemGroups(
  item: WorkspaceItemModel,
  items: WorkspaceItemModel[],
): LinkedItemGroup[] {
  const rule = childRules[item.type];

  if (!rule) return [];

  return rule.types.flatMap((type) => {
    const children = items.filter(
      (candidate) =>
        candidate.id !== item.id &&
        candidate.type === type &&
        candidate[rule.field] === item.id,
    );

    return children.length === 0
      ? []
      : [{ type, label: `${type[0]?.toUpperCase()}${type.slice(1)}s`, items: children }];
  });
}
