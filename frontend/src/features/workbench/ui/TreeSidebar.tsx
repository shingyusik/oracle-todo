import {
  CalendarDays,
  ChevronDown,
  Folder,
  LayoutDashboard,
  ListTodo,
} from "lucide-react";
import React from "react";

import {
  workbenchNavigation,
  type NavigationTab,
  type WorkbenchTabId,
} from "@/domain/workbench/navigation";
import type { WorkbenchController } from "@/features/workbench/model/workbench-model";

type TreeSidebarProps = { controller: WorkbenchController; ariaLabel: string };

export function TreeSidebar({ controller, ariaLabel }: TreeSidebarProps) {
  const { selection, selectTab } = controller;
  const todoVisible = selection.mainTabId === "todo";
  const renderLeaves = (tabs: readonly NavigationTab[]) =>
    tabs.map((tab) => (
      <button
        key={tab.id}
        type="button"
        className="tree-sidebar-tab tree-sidebar-leaf"
        data-active={tab.id === selection.leafTabId}
        onClick={() => selectTab(tab.id as WorkbenchTabId)}
      >
        {tab.label}
      </button>
    ));

  return (
    <nav className="tree-sidebar" aria-label={ariaLabel}>
      <button
        type="button"
        className="tree-sidebar-tab tree-sidebar-top-level"
        data-active={selection.mainTabId === "dashboard"}
        onClick={() => selectTab("dashboard")}
      >
        <LayoutDashboard aria-hidden="true" />
        Dashboard
      </button>
      <div className="tree-sidebar-divider" role="separator" />
      <button
        type="button"
        className="tree-sidebar-tab tree-sidebar-top-level"
        data-active={selection.mainTabId === "todo"}
        onClick={() => selectTab("todo")}
      >
        <ListTodo aria-hidden="true" />
        ToDo
      </button>
      {todoVisible ? (
        <div className="tree-sidebar-children">
          {workbenchNavigation.todoTabs.map((tab) => {
            const workspace = tab.id === "workspace";
            const expanded = workspace
              ? selection.workspaceExpanded
              : selection.plannerExpanded;
            const Icon = workspace ? Folder : CalendarDays;
            const leaves = workspace
              ? workbenchNavigation.workspaceTabs
              : workbenchNavigation.plannerTabs;
            return (
              <div key={tab.id} className="tree-sidebar-group">
                <button
                  type="button"
                  className="tree-sidebar-tab tree-sidebar-parent"
                  aria-expanded={expanded}
                  data-active={expanded}
                  onClick={() => selectTab(tab.id)}
                >
                  <span>
                    <Icon aria-hidden="true" />
                    {tab.label}
                  </span>
                  <ChevronDown aria-hidden="true" />
                </button>
                {expanded ? (
                  <div className="tree-sidebar-leaves">
                    {renderLeaves(leaves)}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </nav>
  );
}
