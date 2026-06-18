import React from "react";

import type {
  LeafTabId,
  NavigationTab,
  PlannerTabId,
  WorkbenchTabId,
  WorkspaceChildTabId,
} from "@/domain/workbench/navigation";

type SubSidebarProps = {
  workspaceTabs: readonly NavigationTab<WorkspaceChildTabId>[];
  plannerTabs: readonly NavigationTab<PlannerTabId>[];
  activeLeafTabId: LeafTabId;
  plannerExpanded: boolean;
  onSelectTab: (tabId: WorkbenchTabId) => void;
  ariaLabel: string;
};

export function SubSidebar({
  workspaceTabs,
  plannerTabs,
  activeLeafTabId,
  plannerExpanded,
  onSelectTab,
  ariaLabel,
}: SubSidebarProps) {
  return (
    <nav className="sub-sidebar" aria-label={ariaLabel}>
      {workspaceTabs.map((tab) => {
        const isPlanner = tab.id === "planner";
        const isActive =
          tab.id === activeLeafTabId || (isPlanner && plannerExpanded);

        return (
          <div key={tab.id} className="sub-sidebar-group">
            <button
              type="button"
              className="sub-sidebar-tab"
              data-active={isActive}
              onClick={() => onSelectTab(tab.id)}
            >
              {tab.label}
            </button>
            {isPlanner && plannerExpanded ? (
              <div className="planner-tab-list" data-expanded={plannerExpanded}>
                {plannerTabs.map((plannerTab) => (
                  <button
                    key={plannerTab.id}
                    type="button"
                    className="sub-sidebar-tab sub-sidebar-tab-nested"
                    data-active={plannerTab.id === activeLeafTabId}
                    onClick={() => onSelectTab(plannerTab.id)}
                  >
                    {plannerTab.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}
