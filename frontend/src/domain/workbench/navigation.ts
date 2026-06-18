export type MainTabId = "dashboard" | "todo" | "workspace";
export type WorkspaceChildTabId =
  | "areas"
  | "projects"
  | "routines"
  | "tasks"
  | "planner";
export type PlannerTabId = "yearly" | "monthly" | "weekly" | "daily";
export type LeafTabId =
  | Exclude<MainTabId, "workspace">
  | Exclude<WorkspaceChildTabId, "planner">
  | PlannerTabId;
export type WorkbenchTabId = MainTabId | WorkspaceChildTabId | PlannerTabId;

export type WorkbenchSelection = {
  mainTabId: MainTabId;
  leafTabId: LeafTabId;
  plannerExpanded: boolean;
};

export type NavigationTab<TId extends WorkbenchTabId = WorkbenchTabId> = {
  id: TId;
  label: string;
};

export const workbenchNavigation = {
  mainTabs: [
    { id: "dashboard", label: "Dashboard" },
    { id: "todo", label: "ToDo" },
    { id: "workspace", label: "Workspace" },
  ] satisfies NavigationTab<MainTabId>[],
  workspaceTabs: [
    { id: "areas", label: "Areas" },
    { id: "projects", label: "Projects" },
    { id: "routines", label: "Routines" },
    { id: "tasks", label: "Tasks" },
    { id: "planner", label: "Planner" },
  ] satisfies NavigationTab<WorkspaceChildTabId>[],
  plannerTabs: [
    { id: "yearly", label: "Yearly" },
    { id: "monthly", label: "Monthly" },
    { id: "weekly", label: "Weekly" },
    { id: "daily", label: "Daily" },
  ] satisfies NavigationTab<PlannerTabId>[],
} as const;

export function resolveInitialSelection(): WorkbenchSelection {
  return {
    mainTabId: "dashboard",
    leafTabId: "dashboard",
    plannerExpanded: false,
  };
}

export function resolveSelection(tabId: WorkbenchTabId): WorkbenchSelection {
  if (tabId === "dashboard" || tabId === "todo") {
    return {
      mainTabId: tabId,
      leafTabId: tabId,
      plannerExpanded: false,
    };
  }

  if (tabId === "workspace") {
    return {
      mainTabId: "workspace",
      leafTabId: "areas",
      plannerExpanded: false,
    };
  }

  if (tabId === "planner") {
    return {
      mainTabId: "workspace",
      leafTabId: "yearly",
      plannerExpanded: true,
    };
  }

  const plannerExpanded = workbenchNavigation.plannerTabs.some(
    (tab) => tab.id === tabId,
  );

  return {
    mainTabId: "workspace",
    leafTabId: tabId,
    plannerExpanded,
  };
}
