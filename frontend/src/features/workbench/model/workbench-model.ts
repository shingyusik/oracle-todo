import { workbenchCopy } from "@/design/copy";
import type {
  LeafTabId,
  WorkbenchSelection,
  WorkbenchTabId,
} from "@/domain/workbench/navigation";
import type {
  DailyFilterState,
  PlannerFilterMode,
  PlannerFilterRule,
  PlannerGroupBy,
  PlannerSortRule,
} from "@/features/workbench/model/planner-model";
import type {
  PlannerGroupSettings,
  PlannerGroupSort,
  PlannerViewId,
} from "@/features/workbench/model/planner-group-settings";

export type WorkbenchPanelModel = {
  id: LeafTabId;
  title: string;
};

export type WorkspaceItemModel = {
  id: string;
  title: string;
  description?: string | null;
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
  future_occurrences?: number | null;
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
  yearlyDate: string;
  monthlyDate: string;
  weeklyDate: string;
  dailyDate: string;
  dailyFilters: DailyFilterState;
  filterMode: PlannerFilterMode;
  filterRules: PlannerFilterRule[];
  filterSettings: Record<PlannerViewId, PlannerFilterSettings>;
  groupSettings: Record<PlannerViewId, PlannerGroupSettings>;
  dailySortRules: PlannerSortRule[];
  yearlySortRules: PlannerSortRule[];
  monthlySortRules: PlannerSortRule[];
  weeklySortRules: PlannerSortRule[];
};

export type PlannerFilterSettings = Pick<
  PlannerControls,
  "filterMode" | "filterRules"
>;

export type CreateWorkspaceItemForm = {
  title: string;
  itemType?: "task" | "goal" | "routine" | "event";
  definition_of_done?: string;
  recurrence_rule?: string;
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
  | "pause"
  | "resume"
  | "complete"
  | "reopen"
  | "archive";

export type WorkspaceItemTransitionState = {
  pending: boolean;
  error: string | null;
};

export type MaterializeRoutineTarget = {
  future_occurrences: number;
};

export const DEFAULT_FUTURE_OCCURRENCES = 7;

export const MAX_FUTURE_OCCURRENCES = 365;

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
  selectPlannerPeriodDate: (date: string) => void;
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
  setPlannerFilterMode: (mode: PlannerFilterMode) => void;
  setPlannerFilterRules: (rules: PlannerFilterRule[]) => void;
  clearPlannerFilterRules: () => void;
  setDailyGroupBy: (groupBy: PlannerGroupBy) => void;
  setDailySortRules: (rules: PlannerSortRule[]) => void;
  setPlannerGroupBy: (groupBy: PlannerGroupBy) => void;
  setPlannerGroupSort: (sort: PlannerGroupSort) => void;
  setPlannerHideEmptyGroups: (hideEmpty: boolean) => void;
  togglePlannerGroupVisibility: (key: string) => void;
  setAllPlannerGroupsVisible: (keys: string[], visible: boolean) => void;
  setPlannerManualGroupOrder: (keys: string[]) => void;
  removePlannerGrouping: () => void;
  setPlannerSortRules: (rules: PlannerSortRule[]) => void;
  transitionWorkspaceItem: (
    itemId: string,
    action: WorkspaceItemTransitionAction,
  ) => Promise<void>;
  workspaceItemTransitionState: (itemId: string) => WorkspaceItemTransitionState;
  materializeRoutine: (
    itemId: string,
    target: MaterializeRoutineTarget,
  ) => Promise<WorkspaceItemModel[]>;
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
