import { workbenchCopy } from "@/design/copy";
import type {
  LeafTabId,
  WorkbenchSelection,
  WorkbenchTabId,
} from "@/domain/workbench/navigation";
import type {
  DailyFilterState,
  DailyGroupBy,
  DailySortBy,
  PlannerGroupBy,
  PlannerSortBy,
} from "@/features/workbench/model/planner-model";

export type WorkbenchPanelModel = {
  id: LeafTabId;
  title: string;
};

export type WorkspaceItemModel = {
  id: string;
  title: string;
  type: string;
  status: string;
  tags?: string[];
  area_id?: string | null;
  project_id?: string | null;
  routine_id?: string | null;
  parent_id?: string | null;
  definition_of_done?: string | null;
  review_cycle?: string | null;
  standard?: string | null;
  note?: string | null;
  outcome?: string | null;
  horizon?: string | null;
  recurrence_rule?: string | null;
  materialization_policy?: string | null;
  due?: string | null;
  scheduled?: string | null;
  priority?: number | null;
  created_at?: string | null;
  last_materialized_at?: string | null;
  updated_at?: string | null;
  metadata_?: {
    location?: string;
    participants?: string[];
    commitment_type?: string;
  };
};

export type WorkspaceItemsModel = {
  status: "idle" | "loading" | "loaded" | "error";
  items: WorkspaceItemModel[];
  tagOptions: string[];
  relatedItems: {
    areas: Record<string, string>;
    goals: Record<string, string>;
    projects: Record<string, string>;
    routines: Record<string, string>;
  };
};

export type PlannerControls = {
  date: string;
  weekStart: string;
  dailyFilters: DailyFilterState;
  dailyGroupBy: DailyGroupBy;
  dailySortBy: DailySortBy;
  yearlyGroupBy: PlannerGroupBy;
  yearlySortBy: PlannerSortBy;
  monthlyGroupBy: PlannerGroupBy;
  monthlySortBy: PlannerSortBy;
  weeklyGroupBy: PlannerGroupBy;
  weeklySortBy: PlannerSortBy;
};

export type CreateWorkspaceItemForm = {
  title: string;
  itemType?: "task" | "goal" | "routine" | "event";
  scheduled?: string;
  horizon?: string;
  tags?: string[];
};

export type WorkspaceItemPatch = {
  title?: string;
  description?: string;
  note?: string;
  outcome?: string;
  horizon?: string;
  parent_id?: string;
  definition_of_done?: string;
  review_cycle?: string;
  standard?: string;
  recurrence_rule?: string;
  materialization_policy?: string;
  due?: string;
  scheduled?: string;
  priority?: number;
  area?: string;
  project_id?: string;
  routine_id?: string;
  location?: string;
  participants?: string[];
  commitment_type?: string;
  tags?: string[];
};

export type WorkspaceItemTransitionAction =
  | "approve"
  | "activate"
  | "pause"
  | "resume"
  | "complete"
  | "archive";

export type WorkbenchController = {
  selection: WorkbenchSelection;
  panel: WorkbenchPanelModel;
  workspaceItems: WorkspaceItemsModel;
  planner: PlannerControls;
  selectedItemIds: string[];
  archiveConfirmationOpen: boolean;
  creationDialogOpen: boolean;
  detailItem: WorkspaceItemModel | null;
  selectTab: (tabId: WorkbenchTabId) => void;
  toggleWorkspaceExpansion: () => void;
  movePlannerPeriod: (direction: -1 | 1) => void;
  resetPlannerPeriodToToday: () => void;
  toggleItemSelection: (itemId: string) => void;
  toggleVisibleSelection: () => void;
  requestArchiveSelected: () => void;
  cancelArchiveSelected: () => void;
  confirmArchiveSelected: () => Promise<void>;
  openCreationDialog: () => void;
  closeCreationDialog: () => void;
  createWorkspaceItem: (form: CreateWorkspaceItemForm) => Promise<void>;
  openDetailView: (item: WorkspaceItemModel) => void;
  patchWorkspaceItem: (itemId: string, patch: WorkspaceItemPatch) => Promise<void>;
  setDailyFilter: (field: keyof DailyFilterState, values: string[]) => void;
  setDailyGroupBy: (groupBy: DailyGroupBy) => void;
  setDailySortBy: (sortBy: DailySortBy) => void;
  setPlannerGroupBy: (groupBy: PlannerGroupBy) => void;
  setPlannerSortBy: (sortBy: PlannerSortBy) => void;
  transitionWorkspaceItem: (
    itemId: string,
    action: WorkspaceItemTransitionAction,
  ) => Promise<void>;
  saveDetailItem: (patch: WorkspaceItemPatch) => Promise<void>;
  closeDetailView: () => void;
};

export function createPanelModel(leafTabId: LeafTabId): WorkbenchPanelModel {
  const panel = workbenchCopy.panels[leafTabId];

  return {
    id: leafTabId,
    title: panel.title,
  };
}
