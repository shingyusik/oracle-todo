export type MainTabId = "dashboard" | "todo" | "ledger" | "health";
export type TodoChildTabId = "workspace" | "planner";
export type WorkspaceChildTabId =
  | "areas"
  | "projects"
  | "routines"
  | "tasks"
  | "events"
  | "goals";
export type PlannerTabId = "yearly" | "monthly" | "weekly" | "daily";
export type LedgerTabId =
  | "transactions"
  | "accounts"
  | "categories"
  | "reports";
export type HealthTabId =
  | "diet"
  | "bowel"
  | "medication"
  | "health-metrics"
  | "trends";
export type LeafTabId =
  | MainTabId
  | WorkspaceChildTabId
  | PlannerTabId
  | LedgerTabId
  | HealthTabId;
export type WorkbenchTabId =
  | MainTabId
  | TodoChildTabId
  | WorkspaceChildTabId
  | PlannerTabId
  | LedgerTabId
  | HealthTabId;

export type WorkbenchSelection = {
  mainTabId: MainTabId;
  leafTabId: LeafTabId;
  workspaceExpanded: boolean;
  plannerExpanded: boolean;
  ledgerExpanded: boolean;
  healthExpanded: boolean;
};

export type NavigationTab<TId extends WorkbenchTabId = WorkbenchTabId> = {
  id: TId;
  label: string;
};

export const workbenchNavigation = {
  mainTabs: [
    { id: "dashboard", label: "Dashboard" },
    { id: "todo", label: "ToDo" },
    { id: "ledger", label: "Ledger" },
    { id: "health", label: "Health Journal" },
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
    { id: "events", label: "Events" },
    { id: "goals", label: "Goals" },
  ] satisfies NavigationTab<WorkspaceChildTabId>[],
  plannerTabs: [
    { id: "yearly", label: "Yearly" },
    { id: "monthly", label: "Monthly" },
    { id: "weekly", label: "Weekly" },
    { id: "daily", label: "Daily" },
  ] satisfies NavigationTab<PlannerTabId>[],
  ledgerTabs: [
    { id: "transactions", label: "Transactions" },
    { id: "accounts", label: "Accounts" },
    { id: "categories", label: "Categories" },
    { id: "reports", label: "Reports" },
  ] satisfies NavigationTab<LedgerTabId>[],
  healthTabs: [
    { id: "diet", label: "Diet" },
    { id: "bowel", label: "Bowel" },
    { id: "medication", label: "Medication" },
    { id: "health-metrics", label: "Health Metrics" },
    { id: "trends", label: "Trends" },
  ] satisfies NavigationTab<HealthTabId>[],
} as const;

const workspaceLeafTabIds = new Set<WorkbenchTabId>([
  "areas",
  "projects",
  "routines",
  "tasks",
  "events",
  "goals",
]);
const plannerLeafTabIds = new Set<WorkbenchTabId>([
  "yearly",
  "monthly",
  "weekly",
  "daily",
]);
const ledgerLeafTabIds = new Set<WorkbenchTabId>([
  "transactions",
  "accounts",
  "categories",
  "reports",
]);
const healthLeafTabIds = new Set<WorkbenchTabId>([
  "diet",
  "bowel",
  "medication",
  "health-metrics",
  "trends",
]);

function createSelection(
  mainTabId: MainTabId,
  leafTabId: LeafTabId,
  workspaceExpanded = false,
  plannerExpanded = false,
): WorkbenchSelection {
  return {
    mainTabId,
    leafTabId,
    workspaceExpanded,
    plannerExpanded,
    ledgerExpanded: mainTabId === "ledger",
    healthExpanded: mainTabId === "health",
  };
}

export function resolveInitialSelection(): WorkbenchSelection {
  return createSelection("dashboard", "dashboard");
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

      return createSelection(
        "todo",
        leafTabId,
        false,
        selection.plannerExpanded,
      );
    }

    return createSelection(
      "todo",
      "areas",
      true,
      selection.plannerExpanded,
    );
  }

  if (selection.plannerExpanded) {
    const leafTabId = plannerLeafTabIds.has(selection.leafTabId)
      ? selection.workspaceExpanded
        ? "areas"
        : "todo"
      : selection.leafTabId;

    return createSelection(
      "todo",
      leafTabId,
      selection.workspaceExpanded,
      false,
    );
  }

  return createSelection(
    "todo",
    "yearly",
    selection.workspaceExpanded,
    true,
  );
}

export function resolveSelection(
  tabId: WorkbenchTabId,
  currentSelection?: WorkbenchSelection,
): WorkbenchSelection {
  if (tabId === "dashboard" || tabId === "todo") {
    return createSelection(tabId, tabId);
  }

  if (tabId === "ledger") {
    return createSelection("ledger", "transactions");
  }

  if (tabId === "health") {
    return createSelection("health", "diet");
  }

  if (tabId === "workspace") {
    return createSelection("todo", "areas", true);
  }

  if (tabId === "planner") {
    return createSelection("todo", "yearly", false, true);
  }

  if (ledgerLeafTabIds.has(tabId)) {
    return createSelection("ledger", tabId as LedgerTabId);
  }

  if (healthLeafTabIds.has(tabId)) {
    return createSelection("health", tabId as HealthTabId);
  }

  const plannerExpanded = workbenchNavigation.plannerTabs.some(
    (tab) => tab.id === tabId,
  );

  return createSelection(
    "todo",
    tabId,
    plannerExpanded
      ? (currentSelection?.workspaceExpanded ?? false)
      : true,
    plannerExpanded
      ? true
      : (currentSelection?.plannerExpanded ?? false),
  );
}
