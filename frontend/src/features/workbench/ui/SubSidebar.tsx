import { CalendarDays, ChevronDown, Folder } from "lucide-react";
import React from "react";

import type {
  LeafTabId,
  NavigationTab,
  PlannerTabId,
  TodoChildTabId,
  WorkbenchTabId,
  WorkspaceChildTabId,
} from "@/domain/workbench/navigation";

type SubSidebarProps = {
  id: string;
  todoTabs: readonly NavigationTab<TodoChildTabId>[];
  workspaceTabs: readonly NavigationTab<WorkspaceChildTabId>[];
  plannerTabs: readonly NavigationTab<PlannerTabId>[];
  activeLeafTabId: LeafTabId;
  workspaceExpanded: boolean;
  plannerExpanded: boolean;
  onSelectTab: (tabId: WorkbenchTabId) => void;
  ariaLabel: string;
};

export function SubSidebar({
  id,
  todoTabs,
  workspaceTabs,
  plannerTabs,
  activeLeafTabId,
  workspaceExpanded,
  plannerExpanded,
  onSelectTab,
  ariaLabel,
}: SubSidebarProps) {
  return (
    <nav id={id} className="sub-sidebar" aria-label={ariaLabel}>
      {todoTabs.map((tab) => {
        const isWorkspace = tab.id === "workspace";
        const isPlanner = tab.id === "planner";
        const ParentIcon = isWorkspace ? Folder : CalendarDays;
        const isActive =
          (isWorkspace && workspaceExpanded) || (isPlanner && plannerExpanded);

        return (
          <div key={tab.id} className="sub-sidebar-group">
            <button
              type="button"
              className="sub-sidebar-tab sub-sidebar-tab-parent"
              aria-expanded={isActive}
              data-active={isActive}
              data-expanded={isActive}
              onClick={() => onSelectTab(tab.id)}
            >
              <span className="sub-sidebar-parent-label">
                <ParentIcon
                  className="sub-sidebar-parent-icon"
                  aria-hidden="true"
                />
                {tab.label}
              </span>
              <ChevronDown
                className="sub-sidebar-chevron"
                aria-hidden="true"
              />
            </button>

            {isWorkspace && workspaceExpanded ? (
              <div className="nested-tab-list" data-expanded={workspaceExpanded}>
                {workspaceTabs.map((workspaceTab) => (
                  <button
                    key={workspaceTab.id}
                    type="button"
                    className="sub-sidebar-tab sub-sidebar-tab-nested"
                    data-active={workspaceTab.id === activeLeafTabId}
                    onClick={() => onSelectTab(workspaceTab.id)}
                  >
                    {workspaceTab.label}
                  </button>
                ))}
              </div>
            ) : null}

            {isPlanner && plannerExpanded ? (
              <div className="nested-tab-list" data-expanded={plannerExpanded}>
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
