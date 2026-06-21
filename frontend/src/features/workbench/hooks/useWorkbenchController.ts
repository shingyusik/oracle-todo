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
  type WorkspaceItemsModel,
  createPanelModel,
} from "@/features/workbench/model/workbench-model";

const workspaceItemTypes: Partial<Record<LeafTabId, string>> = {
  areas: "area",
  projects: "project",
  routines: "routine",
  tasks: "task",
};

export function useWorkbenchController(): WorkbenchController {
  const [selection, setSelection] = useState<WorkbenchSelection>(() =>
    resolveInitialSelection(),
  );
  const [workspaceItems, setWorkspaceItems] = useState<WorkspaceItemsModel>({
    status: "idle",
    items: [],
  });
  const panel = useMemo(
    () => createPanelModel(selection.leafTabId),
    [selection.leafTabId],
  );

  useEffect(() => {
    const itemType = workspaceItemTypes[selection.leafTabId];
    if (!itemType) {
      setWorkspaceItems({ status: "idle", items: [] });
      return;
    }

    let cancelled = false;
    setWorkspaceItems({ status: "loading", items: [] });

    fetch(`/todo-engine/items?type=${itemType}`)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`todo-engine returned ${response.status}`);
        }

        return response.json();
      })
      .then((items) => {
        if (!cancelled) {
          setWorkspaceItems({ status: "loaded", items });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setWorkspaceItems({ status: "error", items: [] });
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
