import {
  LayoutDashboard,
  ListTodo,
  type LucideIcon,
} from "lucide-react";
import React from "react";

import type {
  MainTabId,
  NavigationTab,
  WorkbenchTabId,
} from "@/domain/workbench/navigation";

type MainSidebarProps = {
  tabs: readonly NavigationTab<MainTabId>[];
  activeTabId: MainTabId;
  onSelectTab: (tabId: WorkbenchTabId) => void;
  ariaLabel: string;
};

const mainTabIcons: Record<MainTabId, LucideIcon> = {
  dashboard: LayoutDashboard,
  todo: ListTodo,
};

export function MainSidebar({
  tabs,
  activeTabId,
  onSelectTab,
  ariaLabel,
}: MainSidebarProps) {
  return (
    <nav className="main-sidebar" aria-label={ariaLabel}>
      {tabs.map((tab) => {
        const TabIcon = mainTabIcons[tab.id];

        return (
          <button
            key={tab.id}
            type="button"
            className="main-sidebar-tab"
            aria-label={tab.label}
            data-tooltip={tab.label}
            data-active={tab.id === activeTabId}
            onClick={() => onSelectTab(tab.id)}
          >
            <TabIcon className="main-sidebar-tab-icon" aria-hidden="true" />
          </button>
        );
      })}
    </nav>
  );
}
