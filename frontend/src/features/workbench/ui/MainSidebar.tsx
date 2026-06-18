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
};

export function MainSidebar({
  tabs,
  activeTabId,
  onSelectTab,
}: MainSidebarProps) {
  return (
    <nav className="main-sidebar" aria-label="Primary sections">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className="main-sidebar-tab"
          data-active={tab.id === activeTabId}
          onClick={() => onSelectTab(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
