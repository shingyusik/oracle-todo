import React from "react";

import type { PlannerTableId } from "@/features/workbench/model/planner-model";
import type { WorkbenchController } from "@/features/workbench/model/workbench-model";
import { TableViewTabs } from "@/features/workbench/ui/TableViewTabs";

export function PlannerTableTabs({
  controller,
  tableId,
  title,
}: {
  controller: WorkbenchController;
  tableId: PlannerTableId;
  title: string;
}): React.JSX.Element {
  return (
    <TableViewTabs
      scopeId={tableId}
      title={title}
      controller={{
        tabs: controller.plannerTableTabs(tableId),
        isDirty: controller.plannerTableIsDirty(tableId),
        select: (tabId) => controller.selectPlannerTableTab(tableId, tabId),
        save: () => controller.savePlannerTableTab(tableId),
        create: (name) => controller.createPlannerTableTab(tableId, name),
        rename: (tabId, name) =>
          controller.renamePlannerTableTab(tableId, tabId, name),
        requestDelete: (tabId) =>
          controller.requestDeletePlannerTableTab(tableId, tabId),
      }}
    />
  );
}
