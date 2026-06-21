export type MainTabId = "dashboard" | "todo";
export type TodoChildTabId = "workspace" | "planner";
export type WorkspaceChildTabId = "areas" | "projects" | "routines" | "tasks";
export type PlannerTabId = "yearly" | "monthly" | "weekly" | "daily";
export type LeafTabId = MainTabId | WorkspaceChildTabId | PlannerTabId;
export type WorkbenchTabId =
  | MainTabId
  | TodoChildTabId
  | WorkspaceChildTabId
  | PlannerTabId;

export type WorkbenchSelection = {
  mainTabId: MainTabId;
  leafTabId: LeafTabId;
  workspaceExpanded: boolean;
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
  ] satisfies NavigationTab<MainTabId>[],
  todoTabs: [
    { id: "workspace", label: "Workspace" },
    { id: "planner", label: "Planner" },
  ] satisfies NavigationTab<TodoChildTabId>[],
  workspaceTabs: [
    { id: "areas", label: "Areas" },
    { id: "projects", label: "Projects" },
    { id: "routines", label: "Routines" },
    { id: "tasks", label: "Tasks" },
  ] satisfies NavigationTab<WorkspaceChildTabId>[],
  plannerTabs: [
    { id: "yearly", label: "Yearly" },
    { id: "monthly", label: "Monthly" },
    { id: "weekly", label: "Weekly" },
    { id: "daily", label: "Daily" },
  ] satisfies NavigationTab<PlannerTabId>[],
} as const;

const workspaceLeafTabIds = new Set<WorkbenchTabId>([
  "areas",
  "projects",
  "routines",
  "tasks",
]);
const plannerLeafTabIds = new Set<WorkbenchTabId>([
  "yearly",
  "monthly",
  "weekly",
  "daily",
]);

export function resolveInitialSelection(): WorkbenchSelection {
  return {
    mainTabId: "dashboard",
    leafTabId: "dashboard",
    workspaceExpanded: false,
    plannerExpanded: false,
  };
}

export function toggleWorkspaceExpansion(
  selection: WorkbenchSelection,
): WorkbenchSelection {
  return toggleTodoGroupExpansion(selection, "workspace");
}

export function toggleTodoGroupExpansion(
  selection: WorkbenchSelection,
  tabId: TodoChildTabId,
): WorkbenchSelection {
  if (tabId === "workspace") {
    if (selection.workspaceExpanded) {
      const leafTabId = workspaceLeafTabIds.has(selection.leafTabId)
        ? selection.plannerExpanded
          ? "yearly"
          : "todo"
        : selection.leafTabId;

      return {
        ...selection,
        mainTabId: "todo",
        leafTabId,
        workspaceExpanded: false,
      };
    }

    return {
      ...selection,
      mainTabId: "todo",
      leafTabId: "areas",
      workspaceExpanded: true,
    };
  }

  if (selection.plannerExpanded) {
    const leafTabId = plannerLeafTabIds.has(selection.leafTabId)
      ? selection.workspaceExpanded
        ? "areas"
        : "todo"
      : selection.leafTabId;

    return {
      ...selection,
      mainTabId: "todo",
      leafTabId,
      plannerExpanded: false,
    };
  }

  return {
    ...selection,
    mainTabId: "todo",
    leafTabId: "yearly",
    plannerExpanded: true,
  };
}

export function resolveSelection(
  tabId: WorkbenchTabId,
  currentSelection?: WorkbenchSelection,
): WorkbenchSelection {
  if (tabId === "dashboard" || tabId === "todo") {
    return {
      mainTabId: tabId,
      leafTabId: tabId,
      workspaceExpanded: false,
      plannerExpanded: false,
    };
  }

  if (tabId === "workspace") {
    return {
      mainTabId: "todo",
      leafTabId: "areas",
      workspaceExpanded: true,
      plannerExpanded: false,
    };
  }

  if (tabId === "planner") {
    return {
      mainTabId: "todo",
      leafTabId: "yearly",
      workspaceExpanded: false,
      plannerExpanded: true,
    };
  }

  const plannerExpanded = workbenchNavigation.plannerTabs.some(
    (tab) => tab.id === tabId,
  );

  return {
    mainTabId: "todo",
    leafTabId: tabId,
    workspaceExpanded: plannerExpanded
      ? (currentSelection?.workspaceExpanded ?? false)
      : true,
    plannerExpanded: plannerExpanded
      ? true
      : (currentSelection?.plannerExpanded ?? false),
  };
}
