import React from "react";

import { workbenchCopy } from "@/design/copy";
import { workbenchNavigation } from "@/domain/workbench/navigation";
import type { WorkbenchController } from "@/features/workbench/model/workbench-model";
import { MainPanel } from "@/features/workbench/ui/MainPanel";
import { MainSidebar } from "@/features/workbench/ui/MainSidebar";
import { SubSidebar } from "@/features/workbench/ui/SubSidebar";

type WorkbenchWireframeProps = {
  controller: WorkbenchController;
};

export function WorkbenchWireframe({ controller }: WorkbenchWireframeProps) {
  const showTodoTabs = controller.selection.mainTabId === "todo";
  const showWorkspaceTabs = showTodoTabs && controller.selection.workspaceExpanded;
  const showPlannerTabs = showTodoTabs && controller.selection.plannerExpanded;

  return (
    <div className="workbench-shell">
      <aside className="workbench-nav" aria-label={workbenchCopy.navigation.shellLabel}>
        <div className="workbench-logo">{workbenchCopy.logoLabel}</div>
        <div className="workbench-nav-grid">
          <MainSidebar
            tabs={workbenchNavigation.mainTabs}
            activeTabId={controller.selection.mainTabId}
            onSelectTab={controller.selectTab}
            ariaLabel={workbenchCopy.navigation.mainSidebarLabel}
          />
          <SubSidebar
            id="workspace-sections"
            todoTabs={showTodoTabs ? workbenchNavigation.todoTabs : []}
            workspaceTabs={showWorkspaceTabs ? workbenchNavigation.workspaceTabs : []}
            plannerTabs={showPlannerTabs ? workbenchNavigation.plannerTabs : []}
            activeLeafTabId={controller.selection.leafTabId}
            workspaceExpanded={controller.selection.workspaceExpanded}
            plannerExpanded={controller.selection.plannerExpanded}
            onSelectTab={controller.selectTab}
            ariaLabel={workbenchCopy.navigation.subSidebarLabel}
          />
        </div>
      </aside>
      <MainPanel panel={controller.panel} />
    </div>
  );
}
