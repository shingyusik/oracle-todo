"use client";

import { useMemo, useState } from "react";

import {
  type WorkbenchSelection,
  type WorkbenchTabId,
  resolveInitialSelection,
  resolveSelection,
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
    selectTab: (tabId: WorkbenchTabId) => setSelection(resolveSelection(tabId)),
  };
}
