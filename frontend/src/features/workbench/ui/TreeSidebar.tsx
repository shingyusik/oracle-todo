import {
  IconCashBanknote as Banknote,
  IconCalendar as CalendarDays,
  IconChevronDown as ChevronDown,
  IconFolder as Folder,
  IconHeartbeat as HeartPulse,
  IconLayoutDashboard as LayoutDashboard,
  IconListCheck as ListTodo,
} from "@tabler/icons-react";
import React from "react";

import {
  workbenchNavigation,
  type NavigationTab,
  type WorkbenchTabId,
} from "@/domain/workbench/navigation";
import type { WorkbenchController } from "@/features/workbench/model/workbench-model";

type TreeSidebarProps = {
  controller: WorkbenchController;
  ariaLabel: string;
  mobile?: boolean;
  onNavigate?: () => void;
};

export function TreeSidebar({
  controller,
  ariaLabel,
  mobile = false,
  onNavigate,
}: TreeSidebarProps) {
  const { selection, selectTab } = controller;
  const [expanded, setExpanded] = React.useState(selection);
  React.useEffect(() => setExpanded(selection), [selection, mobile]);
  const tree = mobile ? expanded : selection;
  const todoVisible = tree.mainTabId === "todo";
  function selectParent(tabId: "todo" | "ledger" | "health" | "workspace" | "planner") {
    if (!mobile) {
      selectTab(tabId);
      return;
    }
    setExpanded((current) => {
      if (tabId === "workspace" || tabId === "planner") {
        const key = tabId === "workspace" ? "workspaceExpanded" : "plannerExpanded";
        return { ...current, [key]: !current[key] };
      }
      const mainTabId = current.mainTabId === tabId ? "dashboard" : tabId;
      return {
        ...current,
        mainTabId,
        ledgerExpanded: mainTabId === "ledger",
        healthExpanded: mainTabId === "health",
      };
    });
  }
  const renderLeaves = (tabs: readonly NavigationTab[]) =>
    tabs.map((tab) => (
      <button
        key={tab.id}
        type="button"
        className="tree-sidebar-tab tree-sidebar-leaf"
        data-active={tree.mainTabId === selection.mainTabId && tab.id === selection.leafTabId}
        aria-current={tree.mainTabId === selection.mainTabId && tab.id === selection.leafTabId ? "page" : undefined}
        onClick={() => {
          selectTab(tab.id as WorkbenchTabId, mobile ? tree.mainTabId : undefined);
          onNavigate?.();
        }}
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
        aria-current={
          selection.leafTabId === "dashboard" ? "page" : undefined
        }
        onClick={() => {
          selectTab("dashboard");
          onNavigate?.();
        }}
      >
        <LayoutDashboard aria-hidden="true" />
        Dashboard
      </button>
      <div className="tree-sidebar-divider" role="separator" />
      <button
        type="button"
        className="tree-sidebar-tab tree-sidebar-top-level"
        data-active={selection.mainTabId === "todo"}
        aria-current={selection.leafTabId === "todo" ? "page" : undefined}
        aria-expanded={todoVisible}
        onClick={() => selectParent("todo")}
      >
        <ListTodo aria-hidden="true" />
        ToDo
      </button>
      {todoVisible ? (
        <div className="tree-sidebar-children">
          {workbenchNavigation.todoTabs.map((tab) => {
            const workspace = tab.id === "workspace";
            const expanded = workspace
              ? tree.workspaceExpanded
              : tree.plannerExpanded;
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
                  onClick={() => selectParent(tab.id)}
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
      <button
        type="button"
        className="tree-sidebar-tab tree-sidebar-top-level"
        data-active={selection.mainTabId === "ledger"}
        aria-expanded={tree.ledgerExpanded}
        onClick={() => selectParent("ledger")}
      >
        <Banknote aria-hidden="true" />
        Ledger
      </button>
      {tree.ledgerExpanded ? (
        <div className="tree-sidebar-children">
          {renderLeaves(workbenchNavigation.ledgerTabs)}
        </div>
      ) : null}
      <button
        type="button"
        className="tree-sidebar-tab tree-sidebar-top-level"
        data-active={selection.mainTabId === "health"}
        aria-expanded={tree.healthExpanded}
        onClick={() => selectParent("health")}
      >
        <HeartPulse aria-hidden="true" />
        Health Journal
      </button>
      {tree.healthExpanded ? (
        <div className="tree-sidebar-children">
          {renderLeaves(workbenchNavigation.healthTabs)}
        </div>
      ) : null}
    </nav>
  );
}
