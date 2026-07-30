import React from "react";

import { workbenchCopy } from "@/design/copy";
import type {
  TableViewTarget,
  WorkbenchController,
} from "@/features/workbench/model/workbench-model";
import { MainPanel } from "@/features/workbench/ui/MainPanel";
import { QuickAddDialog } from "@/features/workbench/ui/QuickAddDialog";
import {
  TableViewTabConfirmationDialog,
  type TableViewTabConfirmationDialogAdapter,
} from "@/features/workbench/ui/TableViewTabConfirmationDialog";
import { TreeSidebar } from "@/features/workbench/ui/TreeSidebar";

type WorkbenchWireframeProps = {
  controller: WorkbenchController;
};

export function WorkbenchWireframe({ controller }: WorkbenchWireframeProps) {
  const [quickAddOpen, setQuickAddOpen] = React.useState(false);
  const confirmationAdapter: TableViewTabConfirmationDialogAdapter<TableViewTarget> = {
    confirmation: controller.tableViewTabConfirmation,
    confirm: controller.confirmTableViewTabAction,
    cancel: controller.cancelTableViewTabAction,
    isDirty: (target) => target.surface === "planner"
      ? controller.plannerTableIsDirty(target.scope)
      : controller.workspaceTableIsDirty(target.scope),
    activeTabId: (target) => target.surface === "planner"
      ? controller.plannerTableTabs(target.scope).activeTabId
      : controller.workspaceTableTabs(target.scope).activeTabId,
  };

  return (
    <div className="workbench-shell">
      <aside className="workbench-nav">
        <div className="workbench-logo">
          <img
            className="workbench-logo-image"
            src="/merovingian-mark.png"
            alt={workbenchCopy.logoAlt}
          />
          <div className="workbench-logo-copy">
            <span className="workbench-logo-wordmark">
              {workbenchCopy.logoWordmark}
            </span>
            <span className="workbench-logo-tagline">
              {workbenchCopy.logoTagline}
            </span>
          </div>
        </div>
        <TreeSidebar
          controller={controller}
          ariaLabel={workbenchCopy.navigation.shellLabel}
        />
        <button
          type="button"
          className="items-toolbar-button"
          aria-haspopup="dialog"
          onClick={() => setQuickAddOpen(true)}
        >
          Quick Add
        </button>
      </aside>
      <MainPanel controller={controller} />
      <TableViewTabConfirmationDialog adapter={confirmationAdapter} />
      {quickAddOpen ? (
        <QuickAddDialog
          controller={controller}
          onClose={() => setQuickAddOpen(false)}
        />
      ) : null}
    </div>
  );
}
