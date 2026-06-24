"use client";

import { useEffect, useMemo, useState } from "react";

import {
  type LeafTabId,
  type WorkbenchSelection,
  type WorkbenchTabId,
  resolveInitialSelection,
  resolveSelection,
  toggleTodoGroupExpansion,
  toggleWorkspaceExpansion,
} from "@/domain/workbench/navigation";
import {
  type WorkbenchController,
  type WorkspaceItemModel,
  type WorkspaceItemsModel,
  createPanelModel,
} from "@/features/workbench/model/workbench-model";

type WorkspaceItemType = "area" | "project" | "routine" | "task" | "event" | "goal";

const workspaceItemTypes: Partial<Record<LeafTabId, string>> = {
  areas: "area",
  projects: "project",
  routines: "routine",
  tasks: "task",
  events: "event",
  goals: "goal",
};

const relatedItemTypes: Partial<Record<LeafTabId, WorkspaceItemType[]>> = {
  projects: ["area"],
  routines: ["area"],
  tasks: ["area", "project", "routine"],
  events: ["area", "project"],
  goals: ["goal"],
};

const emptyWorkspaceItems: WorkspaceItemsModel = {
  status: "idle",
  items: [],
  relatedItems: {
    areas: {},
    goals: {},
    projects: {},
    routines: {},
  },
};

export function useWorkbenchController(): WorkbenchController {
  const [selection, setSelection] = useState<WorkbenchSelection>(() =>
    resolveInitialSelection(),
  );
  const [workspaceItems, setWorkspaceItems] =
    useState<WorkspaceItemsModel>(emptyWorkspaceItems);
  const panel = useMemo(
    () => createPanelModel(selection.leafTabId),
    [selection.leafTabId],
  );

  useEffect(() => {
    const itemType = workspaceItemTypes[selection.leafTabId];
    if (!itemType) {
      setWorkspaceItems(emptyWorkspaceItems);
      return;
    }

    let cancelled = false;
    setWorkspaceItems({ ...emptyWorkspaceItems, status: "loading" });

    Promise.all([
      fetchWorkspaceItems(itemType),
      ...((relatedItemTypes[selection.leafTabId] ?? []).map(fetchWorkspaceItems)),
    ])
      .then(([items, ...relatedItems]) => {
        if (!cancelled) {
          setWorkspaceItems({
            status: "loaded",
            items,
            relatedItems: buildRelatedItems(relatedItems.flat()),
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setWorkspaceItems({ ...emptyWorkspaceItems, status: "error" });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selection.leafTabId]);

  return {
    selection,
    panel,
    workspaceItems,
    selectTab: (tabId: WorkbenchTabId) =>
      setSelection((currentSelection) => {
        if (tabId === "workspace" || tabId === "planner") {
          return toggleTodoGroupExpansion(currentSelection, tabId);
        }

        return resolveSelection(tabId, currentSelection);
      }),
    toggleWorkspaceExpansion: () =>
      setSelection((currentSelection) =>
        toggleWorkspaceExpansion(currentSelection),
      ),
  };
}

function fetchWorkspaceItems(
  itemType: WorkspaceItemType | string,
): Promise<WorkspaceItemModel[]> {
  return fetch(`/todo-engine/items?type=${itemType}`).then((response) => {
    if (!response.ok) {
      throw new Error(`todo-engine returned ${response.status}`);
    }

    return response.json();
  });
}

function buildRelatedItems(items: WorkspaceItemModel[]) {
  return {
    areas: titlesById(items, "area"),
    goals: titlesById(items, "goal"),
    projects: titlesById(items, "project"),
    routines: titlesById(items, "routine"),
  };
}

function titlesById(
  items: WorkspaceItemModel[],
  itemType: WorkspaceItemType,
): Record<string, string> {
  return Object.fromEntries(
    items
      .filter((item) => item.type === itemType)
      .map((item) => [item.id, item.title]),
  );
}
