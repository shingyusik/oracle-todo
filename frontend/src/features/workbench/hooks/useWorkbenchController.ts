"use client";

import { useMemo, useState } from "react";

import {
  type WorkbenchSelection,
  type WorkbenchTabId,
  resolveInitialSelection,
  resolveSelection,
  toggleTodoGroupExpansion,
  toggleWorkspaceExpansion,
} from "@/domain/workbench/navigation";
import {
  type WorkbenchController,
  createPanelModel,
} from "@/features/workbench/model/workbench-model";

export function useWorkbenchController(): WorkbenchController {
  const [selection, setSelection] = useState<WorkbenchSelection>(() =>
    resolveInitialSelection(),
  );
  const panel = useMemo(
    () => createPanelModel(selection.leafTabId),
    [selection.leafTabId],
  );

  return {
    selection,
    panel,
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
