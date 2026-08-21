"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  type LeafTabId,
  type WorkbenchSelection,
  type WorkbenchTabId,
  resolveInitialSelection,
  resolveSelection,
  toggleTodoGroupExpansion,
  toggleWorkspaceExpansion,
} from "@/domain/workbench/navigation";
import type { DashboardDestination } from "@/features/dashboard/model/dashboard-navigation";
import {
  loadTodoTableLookups,
  plannerTodoTableScope,
  queryTodoTable,
} from "@/features/workbench/api/table-api";
import {
  type CreateWorkspaceItemForm,
  type LegacyPlannerControls,
  type MaterializeRoutineTarget,
  type PlannerCreationAnalysis,
  type PlannerCreationAnchor,
  type PlannerCreationContext,
  type PlannerControls,
  type PlannerTabConfirmation,
  type PostponeResult,
  type TableViewTabConfirmation,
  type TableViewTarget,
  type TodoTableTarget,
  type TodoTableLookups,
  type TodoTableContext,
  type TodoTableOccurrence,
  type TodoTablePageState,
  type TodoTableScope,
  type WorkbenchController,
  type WorkspaceItemModel,
  type WorkspaceItemPatch,
  type WorkspaceItemTransitionAction,
  type WorkspaceItemTransitionState,
  type WorkspaceItemsModel,
  createPanelModel,
  plannerCreationPolicyForTable,
} from "@/features/workbench/model/workbench-model";
import {
  defaultPlannerGroupSettings,
  normalizePlannerGroupSettings,
  type PlannerGroupSettings,
  type PlannerViewId,
} from "@/features/workbench/model/planner-group-settings";
import {
  addMonths,
  addYears,
  clonePlannerTableSettings,
  isoWeekStart,
  monthStart,
  plannerTableIds,
  type PlannerTableId,
  type PlannerTableSettings,
  yearStart,
} from "@/features/workbench/model/planner-model";
import {
  buildPlannerTabsState,
  createPlannerTab,
  deletePlannerTab,
  discardPlannerTabDraft,
  plannerTabIsDirty,
  renamePlannerTab,
  resetPlannerTabsToFirst,
  savePlannerTabDraft,
  selectPlannerTab,
  updatePlannerTabDraft,
  type PlannerTableTabsState,
  type StoredPlannerTableTabs,
} from "@/features/workbench/model/planner-tabs";
import {
  buildTableViewTabsState,
  createTableViewTab,
  deleteTableViewTab,
  discardTableViewTabDraft,
  renameTableViewTab,
  saveTableViewTabDraft,
  selectTableViewTab,
  tableViewTabIsDirty,
  updateTableViewTabDraft,
  type TableViewTabsState,
} from "@/features/workbench/model/table-view-tabs";
import {
  workspaceTableScopeIds,
  workspaceTableViewSettingsAdapter,
  type WorkspaceTableScopeId,
  type WorkspaceTableViewsState,
} from "@/features/workbench/model/workspace-table-views";
import { decodeApiError, RavenApiError } from "@/lib/raven-api";

type WorkspaceItemType = "area" | "project" | "routine" | "task" | "event" | "goal";
type DashboardDetailLeafTabId = "areas" | "projects";
type PendingDashboardDetail = {
  itemId: string;
  targetLeafTabId: DashboardDetailLeafTabId;
  requestId: number | null;
};
type PendingPlannerSettingsCommand = {
  apply: (planner: PlannerControls) => PlannerControls;
  persist: boolean;
};
type PendingWorkspaceViewCommand = {
  apply: (state: WorkspaceTableViewsState) => WorkspaceTableViewsState;
  persist: boolean;
};

const workspaceItemTypes: Partial<Record<LeafTabId, string>> = {
  areas: "area",
  projects: "project",
  routines: "routine",
  tasks: "task",
  events: "event",
  goals: "goal",
};

const plannerItemTypes: Partial<Record<LeafTabId, WorkspaceItemType[]>> = {
  yearly: ["goal", "area", "project"],
  monthly: ["goal", "task", "event", "routine", "area", "project"],
  weekly: ["goal", "task", "event", "routine", "area", "project"],
  daily: ["task", "event", "routine", "area", "project"],
};

const plannerViewIds: PlannerViewId[] = ["yearly", "monthly", "weekly", "daily"];
const plannerLeafTabIds = new Set<LeafTabId>(plannerViewIds);
const idleWorkspaceItemTransitionState: WorkspaceItemTransitionState = {
  pending: false,
  error: null,
};

function tableIdsForPlannerLeaf(leafTabId: LeafTabId): PlannerTableId[] {
  return plannerLeafTabIds.has(leafTabId)
    ? plannerTableIds.filter((tableId) => tableId.startsWith(`${leafTabId}.`))
    : [];
}

function defaultPlannerGroupSettingsByView(): Record<
  PlannerViewId,
  PlannerGroupSettings
> {
  return Object.fromEntries(
    plannerViewIds.map((view) => [view, defaultPlannerGroupSettings()]),
  ) as Record<PlannerViewId, PlannerGroupSettings>;
}

type StoredPlannerSettings = Pick<PlannerControls, "tableTabs">;

let plannerSettingsWrite = Promise.resolve();
let plannerTabIdCounter = 0;
let workspaceViewsWrite = Promise.resolve();
let workspaceTabIdCounter = 0;

async function loadPlannerSettings(): Promise<StoredPlannerSettings | null> {
  try {
    const response = await fetch("/api/v1/preferences/planner.v1");
    if (!response.ok) return null;
    const value = await response.json();
    if (!value || typeof value !== "object") return null;
    const candidate = value as Record<string, unknown>;
    const legacy = normalizeLegacyPlannerControls(candidate);
    const storedTabs = Object.prototype.hasOwnProperty.call(
      candidate,
      "tableTabs",
    )
      ? candidate.tableTabs
      : undefined;
    const storedTableSettings = Object.prototype.hasOwnProperty.call(
      candidate,
      "tableSettings",
    )
      ? candidate.tableSettings
      : undefined;
    return {
      tableTabs: buildPlannerTabsState(storedTabs, storedTableSettings, legacy),
    };
  } catch {
    return null;
  }
}

function persistPlannerSettings(planner: PlannerControls): void {
  const storedTableTabs = Object.fromEntries(
    plannerTableIds.map((tableId) => [
      tableId,
      { tabs: planner.tableTabs[tableId].tabs },
    ]),
  ) as Record<PlannerTableId, StoredPlannerTableTabs>;
  const body = JSON.stringify({
    value: {
      tableTabs: storedTableTabs,
    },
  });
  plannerSettingsWrite = plannerSettingsWrite
    .catch(() => undefined)
    .then(() => fetch("/api/v1/preferences/planner.v1", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body,
    }))
    .then(() => undefined)
    .catch(() => undefined);
}

async function loadWorkspaceViews(): Promise<WorkspaceTableViewsState | null> {
  try {
    const response = await fetch("/api/v1/preferences/workspace.views.v1");
    if (!response.ok) return null;
    const value = await response.json();
    if (!isRecord(value)) return null;

    const state = createDefaultWorkspaceViews();
    for (const [scope, candidate] of Object.entries(value)) {
      if (!isWorkspaceTableScopeId(scope)) continue;
      state[scope] = buildTableViewTabsState(
        scope,
        candidate,
        workspaceTableViewSettingsAdapter,
      );
    }
    return state;
  } catch {
    return null;
  }
}

function persistWorkspaceViews(state: WorkspaceTableViewsState): void {
  const value = Object.fromEntries(
    Object.entries(state).map(([scope, tableTabs]) => [
      scope,
      { tabs: tableTabs?.tabs ?? [] },
    ]),
  );
  const body = JSON.stringify({ value });
  workspaceViewsWrite = workspaceViewsWrite
    .catch(() => undefined)
    .then(() => fetch("/api/v1/preferences/workspace.views.v1", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body,
    }))
    .then(() => undefined)
    .catch(() => undefined);
}

function normalizeRules(value: unknown): LegacyPlannerControls["filterRules"] {
  if (!Array.isArray(value)) return [];
  return value.filter((rule): rule is LegacyPlannerControls["filterRules"][number] =>
    !!rule && typeof rule === "object" &&
    typeof (rule as { id?: unknown }).id === "string" &&
    typeof (rule as { field?: unknown }).field === "string" &&
    typeof (rule as { type?: unknown }).type === "string" &&
    typeof (rule as { operator?: unknown }).operator === "string",
  );
}

function normalizeSortRules(
  value: unknown,
  defaults: LegacyPlannerControls["dailySortRules"],
): LegacyPlannerControls["dailySortRules"] {
  if (!Array.isArray(value)) return defaults;
  return value.filter((rule): rule is LegacyPlannerControls["dailySortRules"][number] =>
    !!rule && typeof rule === "object" &&
    typeof (rule as { id?: unknown }).id === "string" &&
    typeof (rule as { field?: unknown }).field === "string" &&
    ((rule as { direction?: unknown }).direction === "asc" || (rule as { direction?: unknown }).direction === "desc"),
  );
}

function normalizeLegacyPlannerControls(
  candidate: Record<string, unknown>,
): LegacyPlannerControls {
  const defaults = createDefaultLegacyPlannerControls();
  const candidateGroups = isRecord(candidate.groupSettings)
    ? candidate.groupSettings
    : {};
  return {
    filterMode: candidate.filterMode === "or" ? "or" : "and",
    filterRules: normalizeRules(candidate.filterRules),
    groupSettings: Object.fromEntries(
      plannerViewIds.map((view) => [
        view,
        normalizePlannerGroupSettings(candidateGroups[view]),
      ]),
    ) as Record<PlannerViewId, PlannerGroupSettings>,
    dailySortRules: normalizeSortRules(
      candidate.dailySortRules,
      defaults.dailySortRules,
    ),
    yearlySortRules: normalizeSortRules(
      candidate.yearlySortRules,
      defaults.yearlySortRules,
    ),
    monthlySortRules: normalizeSortRules(
      candidate.monthlySortRules,
      defaults.monthlySortRules,
    ),
    weeklySortRules: normalizeSortRules(
      candidate.weeklySortRules,
      defaults.weeklySortRules,
    ),
  };
}

function createDefaultLegacyPlannerControls(): LegacyPlannerControls {
  return {
    filterMode: "and",
    filterRules: [],
    groupSettings: defaultPlannerGroupSettingsByView(),
    dailySortRules: [{ id: "daily-default-sort", field: "priority", direction: "asc" }],
    yearlySortRules: [{ id: "yearly-default-sort", field: "scheduled", direction: "asc" }],
    monthlySortRules: [{ id: "monthly-default-sort", field: "scheduled", direction: "asc" }],
    weeklySortRules: [{ id: "weekly-default-sort", field: "scheduled", direction: "asc" }],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

const emptyWorkspaceItems: WorkspaceItemsModel = {
  status: "idle",
  items: [],
  allItems: [],
  tagOptions: [],
  relatedItems: {
    areas: {},
    goals: {},
    projects: {},
    routines: {},
  },
};

function todayDate(): string {
  return formatLocalDate(new Date());
}

function weekStartForDate(date: string): string {
  return isoWeekStart(date);
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function createDefaultPlanner(): PlannerControls {
  const date = todayDate();
  const yearlyDate = yearStart(date);
  const monthlyDate = monthStart(date);
  const weeklyDate = weekStartForDate(date);
  const legacy = createDefaultLegacyPlannerControls();
  return {
    date,
    weekStart: weeklyDate,
    yearlyDate,
    monthlyDate,
    weeklyDate,
    dailyDate: date,
    tableTabs: buildPlannerTabsState(undefined, undefined, legacy),
  };
}

function createDefaultWorkspaceViews(): WorkspaceTableViewsState {
  return Object.fromEntries(
    workspaceTableScopeIds.map((scope) => [
      scope,
      buildTableViewTabsState(
        scope,
        undefined,
        workspaceTableViewSettingsAdapter,
      ),
    ]),
  ) as WorkspaceTableViewsState;
}

function workspaceTableTabsFor(
  state: WorkspaceTableViewsState,
  scope: WorkspaceTableScopeId,
): TableViewTabsState<PlannerTableSettings> {
  return state[scope] ?? buildTableViewTabsState(
    scope,
    undefined,
    workspaceTableViewSettingsAdapter,
  );
}

function updateWorkspaceTableTabs(
  state: WorkspaceTableViewsState,
  scope: WorkspaceTableScopeId,
  updater: (
    tableTabs: TableViewTabsState<PlannerTableSettings>,
  ) => TableViewTabsState<PlannerTableSettings>,
): WorkspaceTableViewsState {
  return {
    ...state,
    [scope]: updater(workspaceTableTabsFor(state, scope)),
  };
}

function updateTableTabs(
  planner: PlannerControls,
  tableId: PlannerTableId,
  updater: (state: PlannerTableTabsState) => PlannerTableTabsState,
): PlannerControls {
  return {
    ...planner,
    tableTabs: {
      ...planner.tableTabs,
      [tableId]: updater(planner.tableTabs[tableId]),
    },
  };
}

function nextPlannerTabId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  plannerTabIdCounter += 1;
  return `planner-tab-${Date.now()}-${plannerTabIdCounter}`;
}

function nextWorkspaceTabId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  workspaceTabIdCounter += 1;
  return `workspace-tab-${Date.now()}-${workspaceTabIdCounter}`;
}

function workspaceScopeForLeaf(
  leafTabId: LeafTabId,
): WorkspaceTableScopeId | null {
  const itemType = workspaceItemTypes[leafTabId];
  return itemType
    ? `workspace.${itemType}` as WorkspaceTableScopeId
    : null;
}

function isWorkspaceTableScopeId(value: string): value is WorkspaceTableScopeId {
  const segments = value.split(".");
  const itemTypes = new Set([
    "area",
    "project",
    "goal",
    "routine",
    "task",
    "event",
  ]);
  return (
    (segments.length === 2 &&
      segments[0] === "workspace" &&
      itemTypes.has(segments[1] ?? "")) ||
    (segments.length === 3 &&
      segments[0] === "detail" &&
      itemTypes.has(segments[1] ?? "") &&
      itemTypes.has(segments[2] ?? ""))
  );
}

function plannerConfirmationFor(
  confirmation: TableViewTabConfirmation | null,
): PlannerTabConfirmation | null {
  if (!confirmation) return null;
  if (confirmation.kind === "navigate") {
    return {
      kind: "navigate",
      targetSelection: confirmation.targetSelection,
    };
  }
  if (confirmation.target.surface !== "planner") return null;
  return {
    kind: confirmation.kind,
    tableId: confirmation.target.scope,
    targetTabId: confirmation.targetTabId,
  };
}

function plannerDateForPanel(panelId: LeafTabId, planner: PlannerControls): string {
  if (panelId === "yearly") {
    return planner.yearlyDate;
  }
  if (panelId === "monthly") {
    return planner.monthlyDate;
  }
  if (panelId === "weekly") {
    return planner.weeklyDate;
  }
  if (panelId === "daily") {
    return planner.dailyDate;
  }

  return planner.date;
}

function plannerPeriodForTable(
  tableId: PlannerTableId,
  planner: PlannerControls,
): { from: string; to: string } {
  if (tableId.startsWith("yearly.")) {
    const from = yearStart(planner.yearlyDate);
    return { from, to: addDays(addYears(from, 1), -1) };
  }
  if (tableId.startsWith("monthly.")) {
    const from = monthStart(planner.monthlyDate);
    return { from, to: addDays(addMonths(from, 1), -1) };
  }
  if (tableId.startsWith("weekly.")) {
    const from = weekStartForDate(planner.weeklyDate);
    return { from, to: addDays(from, 6) };
  }
  return { from: planner.dailyDate, to: planner.dailyDate };
}

function todoTableKey(
  scope: TodoTableScope,
  context: TodoTableContext,
  settings: PlannerTableSettings,
): string {
  return JSON.stringify({
    scope,
    context,
    filterMode: settings.filterMode,
    filters: settings.filterRules.map(({ field, operator, value }) => ({ field, operator, value })),
    sorts: settings.sortRules.map(({ field, direction }) => ({ field, direction })),
    group: settings.groupSettings,
  });
}

function dedupeTodoOccurrences(items: TodoTableOccurrence[]): TodoTableOccurrence[] {
  const seen = new Set<string>();
  return items.filter((item) => !seen.has(item.key) && Boolean(seen.add(item.key)));
}

function withActivePlannerPeriod(
  planner: PlannerControls,
  panelId: LeafTabId,
): PlannerControls {
  const date = plannerDateForPanel(panelId, planner);
  return {
    ...planner,
    date,
    weekStart: panelId === "weekly" ? date : weekStartForDate(date),
  };
}

function setPlannerDateForPanel(
  planner: PlannerControls,
  panelId: LeafTabId,
  date: string,
): PlannerControls {
  if (panelId === "yearly") {
    return withActivePlannerPeriod({ ...planner, yearlyDate: yearStart(date) }, panelId);
  }
  if (panelId === "monthly") {
    return withActivePlannerPeriod({ ...planner, monthlyDate: monthStart(date) }, panelId);
  }
  if (panelId === "weekly") {
    return withActivePlannerPeriod({ ...planner, weeklyDate: weekStartForDate(date) }, panelId);
  }
  if (panelId === "daily") {
    return withActivePlannerPeriod({ ...planner, dailyDate: date }, panelId);
  }

  return withActivePlannerPeriod({ ...planner, date }, panelId);
}

function movePlannerDate(panelId: LeafTabId, date: string, direction: -1 | 1): string {
  if (panelId === "yearly") {
    return yearStart(addYears(yearStart(date), direction));
  }
  if (panelId === "monthly") {
    return monthStart(addMonths(monthStart(date), direction));
  }
  if (panelId === "weekly") {
    return addDays(weekStartForDate(date), direction * 7);
  }
  return addDays(date, direction);
}

function resetPlannerDate(panelId: LeafTabId): string {
  const date = todayDate();

  if (panelId === "yearly") {
    return yearStart(date);
  }
  if (panelId === "monthly") {
    return monthStart(date);
  }
  if (panelId === "weekly") {
    return weekStartForDate(date);
  }

  return date;
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00`);
  value.setDate(value.getDate() + days);
  return formatLocalDate(value);
}

function replaceWorkspaceItem(
  items: WorkspaceItemModel[],
  updated: WorkspaceItemModel,
): WorkspaceItemModel[] {
  return items.map((item) => (item.id === updated.id ? updated : item));
}

function upsertWorkspaceItem(
  items: WorkspaceItemModel[],
  item: WorkspaceItemModel,
): WorkspaceItemModel[] {
  return items.some((current) => current.id === item.id)
    ? replaceWorkspaceItem(items, item)
    : [...items, item];
}

function itemMatchesCollection(item: WorkspaceItemModel, leafTabId: LeafTabId): boolean {
  const workspaceType = workspaceItemTypes[leafTabId];
  if (workspaceType) {
    return item.type === workspaceType;
  }

  return (plannerItemTypes[leafTabId] ?? []).some((itemType) => itemType === item.type);
}

function applyMutationToCollection(
  items: WorkspaceItemModel[],
  result: { source: WorkspaceItemModel; follow_up?: WorkspaceItemModel },
  leafTabId: LeafTabId,
): WorkspaceItemModel[] {
  const containsSource = items.some((item) => item.id === result.source.id);
  let updated = containsSource
    ? replaceWorkspaceItem(items, result.source)
    : items;
  if (!result.follow_up) return updated;

  const containsFollowUp = updated.some((item) => item.id === result.follow_up?.id);
  if (
    containsFollowUp ||
    containsSource ||
    itemMatchesCollection(result.follow_up, leafTabId)
  ) {
    updated = upsertWorkspaceItem(updated, result.follow_up);
  }
  return updated;
}

function applyMutationToDetail(
  item: WorkspaceItemModel | null,
  result: { source: WorkspaceItemModel; follow_up?: WorkspaceItemModel },
): WorkspaceItemModel | null {
  if (item?.id === result.source.id) return result.source;
  if (result.follow_up && item?.id === result.follow_up.id) return result.follow_up;
  return item;
}

const emptyPlannerCreationAnalysis: PlannerCreationAnalysis = {
  prefills: {},
  visibilityWarning: false,
};

function plannerCreationScheduledAnchor(
  anchor: PlannerCreationAnchor,
  planner: PlannerControls,
): string {
  switch (anchor) {
    case "daily-date":
      return planner.dailyDate;
    case "previous-daily-date":
      return addDays(planner.dailyDate, -1);
    case "unscheduled":
      return "";
    case "weekly-month":
      return monthStart(planner.weeklyDate);
    case "weekly-week":
    case "weekly-day-grid":
      return weekStartForDate(planner.weeklyDate);
    case "monthly-period":
    case "monthly-calendar":
      return monthStart(planner.monthlyDate);
    case "monthly-first-week":
      return weekStartForDate(monthStart(planner.monthlyDate));
    case "yearly-period":
    case "yearly-first-month":
      return yearStart(planner.yearlyDate);
  }
}

function canonicalPlannerCreationContext(
  context: PlannerCreationContext,
  planner: PlannerControls,
): PlannerCreationContext {
  const policy = plannerCreationPolicyForTable(context.tableId);
  return {
    ...context,
    itemTypes: [...policy.itemTypes],
    scheduled: plannerCreationScheduledAnchor(policy.anchor, planner),
    horizon: policy.horizon,
    editableDate: policy.editableDate,
  };
}

function analyzePlannerCreationContext(
  context: PlannerCreationContext | null,
): PlannerCreationAnalysis {
  if (!context || context.tableSettings.filterRules.length === 0) {
    return emptyPlannerCreationAnalysis;
  }
  if (context.tableSettings.filterMode !== "and") {
    return { prefills: {}, visibilityWarning: true };
  }

  const prefills: PlannerCreationAnalysis["prefills"] = {};
  const tags: string[] = [];
  for (const rule of context.tableSettings.filterRules) {
    const values = Array.isArray(rule.value) ? rule.value : [];
    if (values.length !== 1 || values[0]?.trim() === "") {
      return { prefills: {}, visibilityWarning: true };
    }
    const value = values[0];

    if (rule.field === "area" && rule.type === "relation" && rule.operator === "is") {
      if (prefills.area_id && prefills.area_id !== value) {
        return { prefills: {}, visibilityWarning: true };
      }
      prefills.area_id = value;
      continue;
    }
    if (
      rule.field === "project" &&
      rule.type === "relation" &&
      rule.operator === "is"
    ) {
      if (prefills.project_id && prefills.project_id !== value) {
        return { prefills: {}, visibilityWarning: true };
      }
      prefills.project_id = value;
      continue;
    }
    if (
      rule.field === "priority" &&
      rule.type === "select" &&
      rule.operator === "is"
    ) {
      const priority = Number(value);
      if (
        !Number.isInteger(priority) ||
        (prefills.priority !== undefined && prefills.priority !== priority)
      ) {
        return { prefills: {}, visibilityWarning: true };
      }
      prefills.priority = priority;
      continue;
    }
    if (
      rule.field === "tags" &&
      rule.type === "multiSelect" &&
      (rule.operator === "is" || rule.operator === "contains")
    ) {
      if (!tags.includes(value)) tags.push(value);
      continue;
    }

    return { prefills: {}, visibilityWarning: true };
  }

  if (tags.length > 0) prefills.tags = tags;
  return { prefills, visibilityWarning: false };
}

export function useWorkbenchController(): WorkbenchController {
  const [selection, setSelectionState] = useState<WorkbenchSelection>(() =>
    resolveInitialSelection(),
  );
  const selectionStateRef = useRef(selection);
  const setSelection = (
    update:
      | WorkbenchSelection
      | ((current: WorkbenchSelection) => WorkbenchSelection),
  ): WorkbenchSelection => {
    const next = typeof update === "function"
      ? update(selectionStateRef.current)
      : update;
    selectionStateRef.current = next;
    setSelectionState(next);
    return next;
  };
  const [workspaceItems, setWorkspaceItems] =
    useState<WorkspaceItemsModel>(emptyWorkspaceItems);
  const [planner, setPlannerState] = useState<PlannerControls>(() =>
    createDefaultPlanner(),
  );
  const plannerStateRef = useRef(planner);
  const setPlanner = (
    update: PlannerControls | ((current: PlannerControls) => PlannerControls),
  ): PlannerControls => {
    const next = typeof update === "function"
      ? update(plannerStateRef.current)
      : update;
    plannerStateRef.current = next;
    setPlannerState(next);
    return next;
  };
  const [workspaceViews, setWorkspaceViewsState] =
    useState<WorkspaceTableViewsState>(() => createDefaultWorkspaceViews());
  const workspaceViewsStateRef = useRef(workspaceViews);
  const [todoTablePages, setTodoTablePages] = useState<Record<string, TodoTablePageState>>({});
  const todoTablePagesRef = useRef(todoTablePages);
  const initializedTodoTables = useRef(new Set<string>());
  const initializedTodoTargets = useRef(new Map<string, TodoTableTarget>());
  const pendingTodoMore = useRef(new Set<string>());
  const [todoLookups, setTodoLookups] = useState<Partial<Record<TodoTableScope, TodoTableLookups>>>({});
  todoTablePagesRef.current = todoTablePages;
  const setWorkspaceViews = (
    update:
      | WorkspaceTableViewsState
      | ((
          current: WorkspaceTableViewsState,
        ) => WorkspaceTableViewsState),
  ): WorkspaceTableViewsState => {
    const next = typeof update === "function"
      ? update(workspaceViewsStateRef.current)
      : update;
    workspaceViewsStateRef.current = next;
    setWorkspaceViewsState(next);
    return next;
  };
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [archiveConfirmationOpen, setArchiveConfirmationOpen] = useState(false);
  const [creationDialogOpen, setCreationDialogOpen] = useState(false);
  const [tableViewTabConfirmation, setTableViewTabConfirmation] =
    useState<TableViewTabConfirmation | null>(null);
  const [plannerCreationContext, setPlannerCreationContext] =
    useState<PlannerCreationContext | null>(null);
  const [detailItem, setDetailItem] = useState<WorkspaceItemModel | null>(null);
  const detailOpenGeneration = useRef(0);
  const setDetailPage = (item: WorkspaceItemModel | null) => {
    detailOpenGeneration.current += 1;
    setDetailItem(item);
  };
  const [dashboardReload, setDashboardReload] = useState(0);
  const pendingDashboardDetail = useRef<PendingDashboardDetail | null>(null);
  const pendingTaskCreation = useRef(false);
  const itemMutationTails = useRef(new Map<string, Promise<void>>());
  const itemTransitions = useRef(
    new Map<
      string,
      { promise: Promise<void>; detailGeneration: number | null }
    >(),
  );
  const initialPlannerTableTabs = useRef(planner.tableTabs);
  const plannerSettingsLoaded = useRef(false);
  const pendingPlannerSettingsCommands =
    useRef<PendingPlannerSettingsCommand[]>([]);
  const initialWorkspaceViews = useRef(workspaceViews);
  const workspaceViewsLoaded = useRef(false);
  const pendingWorkspaceViewCommands = useRef<PendingWorkspaceViewCommand[]>([]);
  const visibleWorkspaceItemIds = useRef<string[]>([]);
  const [itemTransitionStates, setItemTransitionStates] = useState<
    Record<string, WorkspaceItemTransitionState>
  >({});

  const todoTableDescriptor = (target: TodoTableTarget) => {
    let scope: TodoTableScope;
    let context: TodoTableContext;
    let settings: PlannerTableSettings;
    if (target.surface === "workspace") {
      scope = target.scope;
      context = { kind: "workspace" };
      settings = workspaceTableTabsFor(workspaceViewsStateRef.current, target.scope).draftSettings;
    } else if (target.surface === "planner") {
      scope = plannerTodoTableScope(target.tableId);
      const period = plannerPeriodForTable(target.tableId, plannerStateRef.current);
      context = { kind: "planner", ...period };
      settings = plannerStateRef.current.tableTabs[target.tableId].draftSettings;
    } else {
      scope = target.scope;
      context = { kind: "linked", parentType: target.parentType, parentId: target.parentId };
      const parts = target.scope.split(".");
      const settingsScope = `detail.${parts[1]}.${parts[2]}` as WorkspaceTableScopeId;
      settings = workspaceTableTabsFor(workspaceViewsStateRef.current, settingsScope).draftSettings;
    }
    return { scope, context, settings, key: todoTableKey(scope, context, settings) };
  };

  const emptyTodoPage = (generation = 0): TodoTablePageState => ({
    items: [], nextOffset: 0, moreStatus: "idle", moreError: null, generation,
  });
  const setTodoPage = (key: string, page: TodoTablePageState) => {
    todoTablePagesRef.current = { ...todoTablePagesRef.current, [key]: page };
    setTodoTablePages(todoTablePagesRef.current);
  };
  const ensureTodoTable = async (target: TodoTableTarget): Promise<void> => {
    const descriptor = todoTableDescriptor(target);
    if (initializedTodoTables.current.has(descriptor.key)) return;
    initializedTodoTables.current.add(descriptor.key);
    initializedTodoTargets.current.set(descriptor.key, target);
    const previous = todoTablePagesRef.current[descriptor.key] ?? emptyTodoPage();
    const generation = previous.generation + 1;
    setTodoPage(descriptor.key, { ...emptyTodoPage(generation), moreStatus: "loading" });
    try {
      const [page, lookups] = await Promise.all([
        queryTodoTable({ ...descriptor, offset: 0 }),
        loadTodoTableLookups(descriptor.scope),
      ]);
      if (todoTablePagesRef.current[descriptor.key]?.generation !== generation) return;
      setTodoPage(descriptor.key, { items: dedupeTodoOccurrences(page.items), nextOffset: page.nextOffset, moreStatus: "idle", moreError: null, generation });
      setTodoLookups((current) => ({ ...current, [descriptor.scope]: lookups }));
    } catch {
      if (todoTablePagesRef.current[descriptor.key]?.generation !== generation) return;
      initializedTodoTables.current.delete(descriptor.key);
      initializedTodoTargets.current.delete(descriptor.key);
      setTodoPage(descriptor.key, { ...previous, nextOffset: 0, moreStatus: "error", moreError: "Could not load rows.", generation });
    }
  };
  const loadMoreTodoTable = async (target: TodoTableTarget): Promise<void> => {
    const descriptor = todoTableDescriptor(target);
    const current = todoTablePagesRef.current[descriptor.key] ?? emptyTodoPage();
    if (current.nextOffset === null || pendingTodoMore.current.has(descriptor.key)) return;
    pendingTodoMore.current.add(descriptor.key);
    const offset = current.nextOffset;
    const generation = current.generation;
    setTodoPage(descriptor.key, { ...current, moreStatus: "loading", moreError: null });
    try {
      const page = await queryTodoTable({ ...descriptor, offset });
      if (todoTablePagesRef.current[descriptor.key]?.generation !== generation) return;
      setTodoPage(descriptor.key, { ...current, items: dedupeTodoOccurrences([...current.items, ...page.items]), nextOffset: page.nextOffset, moreStatus: "idle", moreError: null });
    } catch {
      if (todoTablePagesRef.current[descriptor.key]?.generation !== generation) return;
      setTodoPage(descriptor.key, { ...current, moreStatus: "idle", moreError: "Could not load more rows." });
    } finally {
      pendingTodoMore.current.delete(descriptor.key);
    }
  };
  const reloadInitializedTodoTables = (): void => {
    const targets = [...initializedTodoTargets.current.values()];
    if (targets.length === 0) return;
    const invalidated = Object.fromEntries(Object.entries(todoTablePagesRef.current).map(
      ([key, page]) => [key, { ...page, generation: page.generation + 1 }],
    ));
    todoTablePagesRef.current = invalidated;
    setTodoTablePages(invalidated);
    initializedTodoTables.current.clear();
    initializedTodoTargets.current.clear();
    for (const target of targets) void ensureTodoTable(target);
  };

  const applySharedItem = (updated: WorkspaceItemModel) => {
    setWorkspaceItems((current) => ({
      ...current,
      items: replaceWorkspaceItem(current.items, updated),
      allItems: replaceWorkspaceItem(current.allItems, updated),
      tagOptions: mergeTagOptions(current.tagOptions, updated.tags),
    }));
  };

  const removeSharedItem = (itemId: string) => {
    setWorkspaceItems((current) => {
      const allItems = current.allItems.filter((item) => item.id !== itemId);
      return {
        ...current,
        items: current.items.filter((item) => item.id !== itemId),
        allItems,
        relatedItems: buildRelatedItems(allItems),
      };
    });
    setSelectedItemIds((current) => current.filter((id) => id !== itemId));
  };

  const enqueueItemMutation = <Result,>(
    itemId: string,
    mutation: () => Promise<Result>,
  ): Promise<Result> => {
    const previous = itemMutationTails.current.get(itemId);
    const source = previous ? previous.then(mutation, mutation) : mutation();
    const operation = source.then((result) => {
      reloadInitializedTodoTables();
      return result;
    });
    const tail = operation.then(() => undefined, () => undefined);
    itemMutationTails.current.set(itemId, tail);
    void tail.then(() => {
      if (itemMutationTails.current.get(itemId) === tail) {
        itemMutationTails.current.delete(itemId);
      }
    });
    return operation;
  };
  const panel = useMemo(
    () => createPanelModel(selection.leafTabId),
    [selection.leafTabId],
  );
  const activePlanner = useMemo(
    () => withActivePlannerPeriod(planner, selection.leafTabId),
    [planner, selection.leafTabId],
  );
  const plannerCreationAnalysis = useMemo(
    () => analyzePlannerCreationContext(plannerCreationContext),
    [plannerCreationContext],
  );

  const applyPlannerSettingsCommand = (
    apply: PendingPlannerSettingsCommand["apply"],
    persist = false,
  ): PlannerControls => {
    const next = apply(plannerStateRef.current);
    setPlanner(next);
    if (plannerSettingsLoaded.current) {
      if (persist) persistPlannerSettings(next);
    } else {
      pendingPlannerSettingsCommands.current.push({ apply, persist });
    }
    return next;
  };

  const applyWorkspaceViewCommand = (
    apply: PendingWorkspaceViewCommand["apply"],
    persist = false,
  ): WorkspaceTableViewsState => {
    const next = apply(workspaceViewsStateRef.current);
    setWorkspaceViews(next);
    if (workspaceViewsLoaded.current) {
      if (persist) persistWorkspaceViews(next);
    } else {
      pendingWorkspaceViewCommands.current.push({ apply, persist });
    }
    return next;
  };

  const resolvePlannerTabCommandId = (
    tableId: PlannerTableId,
    tableTabs: PlannerTableTabsState,
    requestedTabId: string,
  ): string => {
    if (tableTabs.tabs.some((tab) => tab.id === requestedTabId)) {
      return requestedTabId;
    }
    const initialIndex = initialPlannerTableTabs.current[tableId].tabs.findIndex(
      (tab) => tab.id === requestedTabId,
    );
    return initialIndex >= 0
      ? tableTabs.tabs[initialIndex]?.id ?? requestedTabId
      : requestedTabId;
  };

  const resolveWorkspaceTabCommandId = (
    scope: WorkspaceTableScopeId,
    tableTabs: TableViewTabsState<PlannerTableSettings>,
    requestedTabId: string,
  ): string => {
    if (tableTabs.tabs.some((tab) => tab.id === requestedTabId)) {
      return requestedTabId;
    }
    const initialIndex = workspaceTableTabsFor(
      initialWorkspaceViews.current,
      scope,
    ).tabs.findIndex((tab) => tab.id === requestedTabId);
    return initialIndex >= 0
      ? tableTabs.tabs[initialIndex]?.id ?? requestedTabId
      : requestedTabId;
  };

  useEffect(() => {
    let active = true;
    void loadPlannerSettings().then((stored) => {
      if (!active) return;

      let next: PlannerControls = {
        ...plannerStateRef.current,
        tableTabs: stored?.tableTabs ?? initialPlannerTableTabs.current,
      };
      const persistedStates: PlannerControls[] = [];
      for (const command of pendingPlannerSettingsCommands.current) {
        next = command.apply(next);
        if (command.persist) persistedStates.push(next);
      }
      pendingPlannerSettingsCommands.current = [];
      plannerSettingsLoaded.current = true;
      setTableViewTabConfirmation((current) => {
        if (
          !current ||
          current.kind === "navigate" ||
          current.target.surface !== "planner"
        ) {
          return current;
        }
        const targetTabId = resolvePlannerTabCommandId(
          current.target.scope,
          next.tableTabs[current.target.scope],
          current.targetTabId,
        );
        return targetTabId === current.targetTabId
          ? current
          : { ...current, targetTabId };
      });
      setPlanner(next);
      for (const persistedState of persistedStates) {
        persistPlannerSettings(persistedState);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    void loadWorkspaceViews().then((stored) => {
      if (!active) return;

      let next = stored ?? initialWorkspaceViews.current;
      const persistedStates: WorkspaceTableViewsState[] = [];
      for (const command of pendingWorkspaceViewCommands.current) {
        next = command.apply(next);
        if (command.persist) persistedStates.push(next);
      }
      pendingWorkspaceViewCommands.current = [];
      workspaceViewsLoaded.current = true;
      setTableViewTabConfirmation((current) => {
        if (
          !current ||
          current.kind === "navigate" ||
          current.target.surface !== "workspace"
        ) {
          return current;
        }
        const targetTabId = resolveWorkspaceTabCommandId(
          current.target.scope,
          workspaceTableTabsFor(next, current.target.scope),
          current.targetTabId,
        );
        return targetTabId === current.targetTabId
          ? current
          : { ...current, targetTabId };
      });
      setWorkspaceViews(next);
      for (const persistedState of persistedStates) {
        persistWorkspaceViews(persistedState);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    visibleWorkspaceItemIds.current = [];
    setSelectedItemIds([]);
    setArchiveConfirmationOpen(false);
    setCreationDialogOpen(false);
    setPlannerCreationContext(null);
    setDetailPage(null);
    if (
      selection.leafTabId === "tasks"
      && pendingTaskCreation.current
    ) {
      pendingTaskCreation.current = false;
      setCreationDialogOpen(true);
    }
  }, [selection.leafTabId]);

  useEffect(() => {
    if (selection.leafTabId === "dashboard") {
      setWorkspaceItems({ ...emptyWorkspaceItems, status: "loading" });

      void fetchAllWorkspaceItems()
        .then((allItems) => {
          const leaf = selectionStateRef.current.leafTabId;
          setWorkspaceItems({
              status: "loaded",
              items: allItems.filter((item) => {
                const type = workspaceItemTypes[leaf];
                const plannerTypes = plannerItemTypes[leaf];
                return type ? item.type === type : Boolean(plannerTypes?.includes(item.type as WorkspaceItemType));
              }),
              allItems,
              tagOptions: collectTagOptions(allItems),
              relatedItems: buildRelatedItems(allItems),
            });
        })
        .catch(() => {
          if (selectionStateRef.current.leafTabId === "dashboard") {
            setWorkspaceItems({ ...emptyWorkspaceItems, status: "error" });
          }
        });
      return;
    }

    const pendingDetail = pendingDashboardDetail.current;
    setWorkspaceItems((current) => ({
      ...current,
      status: "loaded",
      items: current.allItems.filter((item) => {
        const type = workspaceItemTypes[selection.leafTabId];
        const plannerTypes = plannerItemTypes[selection.leafTabId];
        return type ? item.type === type : Boolean(plannerTypes?.includes(item.type as WorkspaceItemType));
      }),
      relatedItems: buildRelatedItems(current.allItems),
      tagOptions: collectTagOptions(current.allItems),
    }));
    if (pendingDetail?.targetLeafTabId === selection.leafTabId) {
      pendingDashboardDetail.current = null;
      setDetailPage(
        workspaceItems.allItems.find((item) => item.id === pendingDetail.itemId) ?? null,
      );
    }
  }, [dashboardReload, selection.leafTabId]);

  const requestSelection = (nextSelection: WorkbenchSelection): void => {
    const currentSelection = selectionStateRef.current;
    const leafChanged = nextSelection.leafTabId !== currentSelection.leafTabId;
    const departingTableIds = tableIdsForPlannerLeaf(currentSelection.leafTabId);
    const dirtyTargets: TableViewTarget[] = departingTableIds
      .filter((tableId) =>
        plannerTabIsDirty(plannerStateRef.current.tableTabs[tableId])
      )
      .map((scope) => ({ surface: "planner", scope }));
    const workspaceScope = workspaceScopeForLeaf(currentSelection.leafTabId);
    if (
      workspaceScope &&
      tableViewTabIsDirty(
        workspaceTableTabsFor(
          workspaceViewsStateRef.current,
          workspaceScope,
        ),
        clonePlannerTableSettings,
      )
    ) {
      dirtyTargets.push({ surface: "workspace", scope: workspaceScope });
    }
    if (leafChanged && dirtyTargets.length > 0) {
      setTableViewTabConfirmation({
        kind: "navigate",
        dirtyTargets,
        targetSelection: nextSelection,
      });
      return;
    }

    if (leafChanged) {
      applyPlannerSettingsCommand((current) => {
        let next = current;
        for (const tableId of tableIdsForPlannerLeaf(nextSelection.leafTabId)) {
          next = updateTableTabs(next, tableId, resetPlannerTabsToFirst);
        }
        return next;
      });
    }

    if (
      pendingDashboardDetail.current &&
      pendingDashboardDetail.current.targetLeafTabId !== nextSelection.leafTabId
    ) {
      pendingDashboardDetail.current = null;
    }
    setSelection(nextSelection);
  };

  const navigateDashboard = (destination: DashboardDestination): void => {
    pendingTaskCreation.current = false;
    switch (destination.kind) {
      case "areas":
        pendingDashboardDetail.current = null;
        setSelection((current) => resolveSelection("areas", current));
        return;
      case "area-detail":
        pendingDashboardDetail.current = {
          itemId: destination.itemId,
          targetLeafTabId: "areas",
          requestId: null,
        };
        setSelection((current) => resolveSelection("areas", current));
        return;
      case "projects":
        pendingDashboardDetail.current = null;
        setSelection((current) => resolveSelection("projects", current));
        return;
      case "tasks":
      case "events":
      case "routines":
        pendingDashboardDetail.current = null;
        setSelection((current) => resolveSelection(destination.kind, current));
        return;
      case "project-detail":
        pendingDashboardDetail.current = {
          itemId: destination.itemId,
          targetLeafTabId: "projects",
          requestId: null,
        };
        setSelection((current) => resolveSelection("projects", current));
        return;
      case "daily":
      case "daily-overdue":
        pendingDashboardDetail.current = null;
        setPlanner((current) =>
          setPlannerDateForPanel(current, "daily", destination.date),
        );
        requestSelection(
          resolveSelection("daily", selectionStateRef.current),
        );
        return;
      case "weekly":
        pendingDashboardDetail.current = null;
        setPlanner((current) =>
          setPlannerDateForPanel(current, "weekly", destination.weekStart),
        );
        requestSelection(
          resolveSelection("weekly", selectionStateRef.current),
        );
        return;
      default: {
        const exhaustiveDestination: never = destination;
        return exhaustiveDestination;
      }
    }
  };

  const persistTableTabs = (
    tableId: PlannerTableId,
    updater: (
      tableTabs: PlannerTableTabsState,
    ) => PlannerTableTabsState | null,
  ): boolean => {
    const current = plannerStateRef.current;
    const tableTabs = updater(current.tableTabs[tableId]);
    if (!tableTabs) return false;
    applyPlannerSettingsCommand(
      (planner) => {
        const updatedTabs = updater(planner.tableTabs[tableId]);
        return updatedTabs
          ? updateTableTabs(planner, tableId, () => updatedTabs)
          : planner;
      },
      true,
    );
    return true;
  };

  const persistWorkspaceTableTabs = (
    scope: WorkspaceTableScopeId,
    updater: (
      tableTabs: TableViewTabsState<PlannerTableSettings>,
    ) => TableViewTabsState<PlannerTableSettings> | null,
  ): boolean => {
    const tableTabs = updater(
      workspaceTableTabsFor(workspaceViewsStateRef.current, scope),
    );
    if (!tableTabs) return false;
    applyWorkspaceViewCommand(
      (state) => {
        const updatedTabs = updater(workspaceTableTabsFor(state, scope));
        return updatedTabs
          ? updateWorkspaceTableTabs(state, scope, () => updatedTabs)
          : state;
      },
      true,
    );
    return true;
  };

  const confirmTableViewTabAction = (): void => {
    const confirmation = tableViewTabConfirmation;
    if (!confirmation) return;

    if (confirmation.kind === "navigate") {
      const plannerTargets = confirmation.dirtyTargets.filter(
        (
          target,
        ): target is Extract<TableViewTarget, { surface: "planner" }> =>
          target.surface === "planner",
      );
      const destinationTableIds = tableIdsForPlannerLeaf(
        confirmation.targetSelection.leafTabId,
      );
      if (plannerTargets.length > 0 || destinationTableIds.length > 0) {
        applyPlannerSettingsCommand((current) => {
          let next = current;
          for (const target of plannerTargets) {
            next = updateTableTabs(
              next,
              target.scope,
              discardPlannerTabDraft,
            );
          }
          for (const tableId of destinationTableIds) {
            next = updateTableTabs(next, tableId, resetPlannerTabsToFirst);
          }
          return next;
        });
      }

      const workspaceTargets = confirmation.dirtyTargets.filter(
        (
          target,
        ): target is Extract<TableViewTarget, { surface: "workspace" }> =>
          target.surface === "workspace",
      );
      if (workspaceTargets.length > 0) {
        applyWorkspaceViewCommand((state) => {
          let next = state;
          for (const target of workspaceTargets) {
            next = updateWorkspaceTableTabs(
              next,
              target.scope,
              (tableTabs) =>
                discardTableViewTabDraft(
                  tableTabs,
                  clonePlannerTableSettings,
                ),
            );
          }
          return next;
        });
      }

      if (confirmation.targetSelection.leafTabId !== "tasks") {
        pendingTaskCreation.current = false;
      }
      setSelection(confirmation.targetSelection);
      setTableViewTabConfirmation(null);
      return;
    }

    if (confirmation.target.surface === "planner") {
      const tableId = confirmation.target.scope;
      if (confirmation.kind === "select") {
        applyPlannerSettingsCommand((current) =>
          updateTableTabs(current, tableId, (tableTabs) => {
            const targetTabId = resolvePlannerTabCommandId(
              tableId,
              tableTabs,
              confirmation.targetTabId,
            );
            return selectPlannerTab(
              discardPlannerTabDraft(tableTabs),
              targetTabId,
            );
          }),
        );
      } else {
        applyPlannerSettingsCommand((current) => {
          const tableTabs = current.tableTabs[tableId];
          const targetTabId = resolvePlannerTabCommandId(
            tableId,
            tableTabs,
            confirmation.targetTabId,
          );
          const deleted = deletePlannerTab(tableTabs, targetTabId);
          return deleted
            ? updateTableTabs(current, tableId, () => deleted)
            : current;
        }, true);
      }
    } else {
      const scope = confirmation.target.scope;
      if (confirmation.kind === "select") {
        applyWorkspaceViewCommand((state) =>
          updateWorkspaceTableTabs(state, scope, (tableTabs) => {
            const targetTabId = resolveWorkspaceTabCommandId(
              scope,
              tableTabs,
              confirmation.targetTabId,
            );
            return selectTableViewTab(
              discardTableViewTabDraft(
                tableTabs,
                clonePlannerTableSettings,
              ),
              targetTabId,
              clonePlannerTableSettings,
            );
          }),
        );
      } else {
        applyWorkspaceViewCommand((state) => {
          const tableTabs = workspaceTableTabsFor(state, scope);
          const targetTabId = resolveWorkspaceTabCommandId(
            scope,
            tableTabs,
            confirmation.targetTabId,
          );
          const deleted = deleteTableViewTab(
            tableTabs,
            targetTabId,
            clonePlannerTableSettings,
          );
          return deleted
            ? updateWorkspaceTableTabs(state, scope, () => deleted)
            : state;
        }, true);
      }
    }

    setTableViewTabConfirmation(null);
  };

  const plannerTabConfirmation = plannerConfirmationFor(
    tableViewTabConfirmation,
  );

  const openTaskCreation = (): void => {
    setPlannerCreationContext(null);
    const currentSelection = selectionStateRef.current;
    if (currentSelection.leafTabId === "tasks") {
      pendingTaskCreation.current = false;
      setCreationDialogOpen(true);
      return;
    }
    pendingTaskCreation.current = true;
    requestSelection(resolveSelection("tasks", currentSelection));
  };

  const cancelTableViewTabAction = (): void => {
    if (tableViewTabConfirmation?.kind === "navigate") {
      pendingTaskCreation.current = false;
    }
    setTableViewTabConfirmation(null);
  };

  return {
    selection,
    panel,
    workspaceItems,
    planner: activePlanner,
    selectedItemIds,
    archiveConfirmationOpen,
    creationDialogOpen,
    tableViewTabConfirmation,
    plannerTabConfirmation,
    plannerCreationContext,
    plannerCreationAnalysis,
    detailItem,
    todoTablePage: (target) => {
      const { key } = todoTableDescriptor(target);
      return todoTablePages[key] ?? emptyTodoPage();
    },
    ensureTodoTable,
    loadMoreTodoTable,
    todoTableLookups: (scope) => todoLookups[scope] ?? null,
    selectTab: (tabId: WorkbenchTabId) => {
      pendingTaskCreation.current = false;
      const currentSelection = selectionStateRef.current;
      const nextSelection =
        tabId === "workspace" || tabId === "planner"
          ? toggleTodoGroupExpansion(currentSelection, tabId)
          : resolveSelection(tabId, currentSelection);
      requestSelection(nextSelection);
    },
    navigateDashboard,
    reloadDashboard: () => setDashboardReload((value) => value + 1),
    toggleWorkspaceExpansion: () =>
      setSelection((currentSelection) =>
        toggleWorkspaceExpansion(currentSelection),
      ),
    movePlannerPeriod: (direction) =>
      setPlanner((current) => {
        const date = movePlannerDate(
          selection.leafTabId,
          plannerDateForPanel(selection.leafTabId, current),
          direction,
        );
        return setPlannerDateForPanel(current, selection.leafTabId, date);
      }),
    selectPlannerPeriodDate: (date) =>
      setPlanner((current) =>
        setPlannerDateForPanel(current, selection.leafTabId, date),
      ),
    resetPlannerPeriodToToday: () =>
      setPlanner((current) => {
        const date = resetPlannerDate(selection.leafTabId);
        return setPlannerDateForPanel(current, selection.leafTabId, date);
      }),
    toggleItemSelection: (itemId: string) =>
      setSelectedItemIds((current) =>
        current.includes(itemId)
          ? current.filter((id) => id !== itemId)
          : [...current, itemId],
      ),
    setVisibleWorkspaceItemIds: (itemIds) => {
      const availableIds = new Set(workspaceItems.items.map((item) => item.id));
      visibleWorkspaceItemIds.current = [
        ...new Set(itemIds.filter((id) => availableIds.has(id))),
      ];
    },
    toggleVisibleSelection: () =>
      setSelectedItemIds((current) => {
        const visibleIds = visibleWorkspaceItemIds.current;

        return visibleIds.every((id) => current.includes(id)) ? [] : visibleIds;
      }),
    requestArchiveSelected: () =>
      setArchiveConfirmationOpen(selectedItemIds.length > 0),
    cancelArchiveSelected: () => setArchiveConfirmationOpen(false),
    confirmArchiveSelected: async () => {
      const idsToArchive = selectedItemIds;
      const results = await Promise.allSettled(
        idsToArchive.map(async (id) => {
          await postArchiveItem(id);
          return id;
        }),
      );
      const archivedIds = results
        .filter((result): result is PromiseFulfilledResult<string> => result.status === "fulfilled")
        .map((result) => result.value);
      const failedIds = idsToArchive.filter((id) => !archivedIds.includes(id));

      setWorkspaceItems((current) => ({
        ...current,
        items: current.items.filter((item) => !archivedIds.includes(item.id)),
        allItems: current.allItems.filter((item) => !archivedIds.includes(item.id)),
      }));
      setSelectedItemIds(failedIds);
      setArchiveConfirmationOpen(false);
      if (archivedIds.length > 0) reloadInitializedTodoTables();
    },
    openCreationDialog: () => {
      setPlannerCreationContext(null);
      setCreationDialogOpen(true);
    },
    openTaskCreation,
    openPlannerCreationDialog: (context) => {
      setPlannerCreationContext(canonicalPlannerCreationContext(context, activePlanner));
      setCreationDialogOpen(true);
    },
    closeCreationDialog: () => {
      setCreationDialogOpen(false);
      setPlannerCreationContext(null);
    },
    createWorkspaceItem: async (form) => {
      let contextualForm = form;
      if (plannerCreationContext) {
        const canonicalContext = canonicalPlannerCreationContext(
          plannerCreationContext,
          activePlanner,
        );
        const requestedItemType = form.itemType ?? canonicalContext.itemTypes[0];
        if (
          !requestedItemType ||
          !canonicalContext.itemTypes.some((itemType) => itemType === requestedItemType)
        ) {
          const label = requestedItemType
            ? requestedItemType[0].toUpperCase() + requestedItemType.slice(1)
            : "Item";
          throw new RavenApiError(
            "validation_error",
            `${label} is not allowed for ${canonicalContext.tableId}.`,
            {},
            "",
            400,
          );
        }
        contextualForm = {
          scheduled: canonicalContext.scheduled,
          ...plannerCreationAnalysis.prefills,
          ...form,
          horizon: canonicalContext.horizon,
          ...(!canonicalContext.editableDate
            ? {
                scheduled: canonicalContext.scheduled,
              }
            : {}),
        };
        contextualForm.itemType = requestedItemType;
      }
      const item = await createItemRequest(
        selection.leafTabId,
        activePlanner,
        contextualForm,
      );
      setWorkspaceItems((current) => ({
        ...current,
        items: [item, ...current.items],
        allItems: [item, ...current.allItems],
      }));
      setDetailPage(item);
      setCreationDialogOpen(false);
      setPlannerCreationContext(null);
      reloadInitializedTodoTables();
    },
    openDetailView: (item) => setDetailPage(item),
    patchWorkspaceItem: (itemId, patch) =>
      enqueueItemMutation(itemId, async () => {
        const updated = await patchItem(itemId, patch);
        setDetailItem((current) => (current?.id === updated.id ? updated : current));
        applySharedItem(updated);
      }),
    plannerTableTabs: (tableId) => activePlanner.tableTabs[tableId],
    plannerTableSettings: (tableId) =>
      activePlanner.tableTabs[tableId].draftSettings,
    plannerTableIsDirty: (tableId) =>
      plannerTabIsDirty(activePlanner.tableTabs[tableId]),
    updatePlannerTableSettings: (tableId, updater) => {
      applyPlannerSettingsCommand((current) => {
        const tableTabs = current.tableTabs[tableId];
        return updateTableTabs(current, tableId, () =>
          updatePlannerTabDraft(tableTabs, updater(tableTabs.draftSettings)),
        );
      });
    },
    selectPlannerTableTab: (tableId, tabId) => {
      const tableTabs = plannerStateRef.current.tableTabs[tableId];
      if (
        tableTabs.activeTabId === tabId ||
        !tableTabs.tabs.some((tab) => tab.id === tabId)
      ) {
        return;
      }
      if (plannerTabIsDirty(tableTabs)) {
        setTableViewTabConfirmation({
          kind: "select",
          target: { surface: "planner", scope: tableId },
          targetTabId: tabId,
        });
        return;
      }
      applyPlannerSettingsCommand((current) =>
        updateTableTabs(current, tableId, (currentTabs) =>
          selectPlannerTab(
            currentTabs,
            resolvePlannerTabCommandId(tableId, currentTabs, tabId),
          ),
        ),
      );
    },
    savePlannerTableTab: (tableId) => {
      persistTableTabs(tableId, savePlannerTabDraft);
    },
    createPlannerTableTab: (tableId, name) => {
      if (name.trim().length === 0) return false;
      const tabId = nextPlannerTabId();
      return persistTableTabs(tableId, (tableTabs) =>
        createPlannerTab(tableTabs, tabId, name),
      );
    },
    renamePlannerTableTab: (tableId, tabId, name) => {
      if (name.trim().length === 0) return false;
      return persistTableTabs(tableId, (tableTabs) =>
        renamePlannerTab(
          tableTabs,
          resolvePlannerTabCommandId(tableId, tableTabs, tabId),
          name,
        ),
      );
    },
    requestDeletePlannerTableTab: (tableId, tabId) => {
      const tableTabs = plannerStateRef.current.tableTabs[tableId];
      if (
        tableTabs.tabs.length <= 1 ||
        !tableTabs.tabs.some((tab) => tab.id === tabId)
      ) {
        return;
      }
      setTableViewTabConfirmation({
        kind: "delete",
        target: { surface: "planner", scope: tableId },
        targetTabId: tabId,
      });
    },
    workspaceTableTabs: (scope) =>
      workspaceTableTabsFor(workspaceViews, scope),
    workspaceTableSettings: (scope) =>
      workspaceTableTabsFor(workspaceViews, scope).draftSettings,
    workspaceTableIsDirty: (scope) =>
      tableViewTabIsDirty(
        workspaceTableTabsFor(workspaceViews, scope),
        clonePlannerTableSettings,
      ),
    updateWorkspaceTableSettings: (scope, updater) => {
      applyWorkspaceViewCommand((state) =>
        updateWorkspaceTableTabs(state, scope, (tableTabs) =>
          updateTableViewTabDraft(
            tableTabs,
            updater(tableTabs.draftSettings),
            clonePlannerTableSettings,
          ),
        ),
      );
    },
    selectWorkspaceTableTab: (scope, tabId) => {
      const tableTabs = workspaceTableTabsFor(
        workspaceViewsStateRef.current,
        scope,
      );
      if (
        tableTabs.activeTabId === tabId ||
        !tableTabs.tabs.some((tab) => tab.id === tabId)
      ) {
        return;
      }
      if (tableViewTabIsDirty(tableTabs, clonePlannerTableSettings)) {
        setTableViewTabConfirmation({
          kind: "select",
          target: { surface: "workspace", scope },
          targetTabId: tabId,
        });
        return;
      }
      applyWorkspaceViewCommand((state) =>
        updateWorkspaceTableTabs(state, scope, (currentTabs) =>
          selectTableViewTab(
            currentTabs,
            resolveWorkspaceTabCommandId(scope, currentTabs, tabId),
            clonePlannerTableSettings,
          ),
        ),
      );
    },
    saveWorkspaceTableTab: (scope) => {
      persistWorkspaceTableTabs(scope, (tableTabs) =>
        saveTableViewTabDraft(tableTabs, clonePlannerTableSettings),
      );
    },
    createWorkspaceTableTab: (scope, name) => {
      if (name.trim().length === 0) return false;
      const tabId = nextWorkspaceTabId();
      return persistWorkspaceTableTabs(scope, (tableTabs) =>
        createTableViewTab(
          tableTabs,
          tabId,
          name,
          clonePlannerTableSettings,
        ),
      );
    },
    renameWorkspaceTableTab: (scope, tabId, name) => {
      if (name.trim().length === 0) return false;
      return persistWorkspaceTableTabs(scope, (tableTabs) =>
        renameTableViewTab(
          tableTabs,
          resolveWorkspaceTabCommandId(scope, tableTabs, tabId),
          name,
        ),
      );
    },
    requestDeleteWorkspaceTableTab: (scope, tabId) => {
      const tableTabs = workspaceTableTabsFor(
        workspaceViewsStateRef.current,
        scope,
      );
      if (
        tableTabs.tabs.length <= 1 ||
        !tableTabs.tabs.some((tab) => tab.id === tabId)
      ) {
        return;
      }
      setTableViewTabConfirmation({
        kind: "delete",
        target: { surface: "workspace", scope },
        targetTabId: tabId,
      });
    },
    confirmTableViewTabAction,
    cancelTableViewTabAction,
    confirmPlannerTabAction: confirmTableViewTabAction,
    cancelPlannerTabAction: cancelTableViewTabAction,
    transitionWorkspaceItem: (
      itemId: string,
      action: WorkspaceItemTransitionAction,
    ) => {
      const originatingGeneration =
        detailItem?.id === itemId ? detailOpenGeneration.current : null;
      const existing = itemTransitions.current.get(itemId);
      if (
        existing &&
        (originatingGeneration === null ||
          existing.detailGeneration === originatingGeneration)
      ) {
        return existing.promise;
      }

      const transition = enqueueItemMutation(itemId, async () => {
          const updated = await postJson(`/api/v1/todo/items/${itemId}/${action}`, {});
          setDetailItem((current) =>
            detailOpenGeneration.current === originatingGeneration && current?.id === updated.id
              ? updated
              : current,
          );
          if (action === "archive") {
            removeSharedItem(itemId);
          } else {
            applySharedItem(updated);
          }
        });
      itemTransitions.current.set(itemId, {
        promise: transition,
        detailGeneration: originatingGeneration,
      });
      setItemTransitionStates((current) => ({
        ...current,
        [itemId]: { pending: true, error: null },
      }));
      const clearTransition = (error: string | null) => {
        if (itemTransitions.current.get(itemId)?.promise === transition) {
          itemTransitions.current.delete(itemId);
          setItemTransitionStates((current) =>
            error
              ? { ...current, [itemId]: { pending: false, error } }
              : Object.fromEntries(
                  Object.entries(current).filter(([key]) => key !== itemId),
                ),
          );
        }
      };
      void transition.then(
        () => clearTransition(null),
        (cause) => clearTransition(
          cause instanceof RavenApiError
            ? cause.message
            : "Could not update item.",
        ),
      );
      return transition;
    },
    missWorkspaceItem: (itemId) => {
      const existing = itemTransitions.current.get(itemId);
      if (existing) return existing.promise;

      const transition = enqueueItemMutation(itemId, async () => {
        const source = await postMissItem(itemId);
        setDetailItem((current) => applyMutationToDetail(current, { source }));
        setWorkspaceItems((current) => {
          const allItems = upsertWorkspaceItem(current.allItems, source);
          return {
            ...current,
            items: applyMutationToCollection(
              current.items,
              { source },
              selectionStateRef.current.leafTabId,
            ),
            allItems,
            relatedItems: buildRelatedItems(allItems),
            tagOptions: mergeTagOptions(current.tagOptions, source.tags),
          };
        });
      });
      itemTransitions.current.set(itemId, {
        promise: transition,
        detailGeneration: null,
      });
      setItemTransitionStates((current) => ({
        ...current,
        [itemId]: { pending: true, error: null },
      }));
      const clearTransition = (error: string | null) => {
        if (itemTransitions.current.get(itemId)?.promise === transition) {
          itemTransitions.current.delete(itemId);
          setItemTransitionStates((current) =>
            error
              ? { ...current, [itemId]: { pending: false, error } }
              : Object.fromEntries(
                  Object.entries(current).filter(([key]) => key !== itemId),
                ),
          );
        }
      };
      void transition.then(
        () => clearTransition(null),
        (cause) => clearTransition(
          cause instanceof RavenApiError
            ? cause.message
            : "Could not update item.",
        ),
      );
      return transition;
    },
    postponeWorkspaceItem: (itemId, scheduled) => {
      const existing = itemTransitions.current.get(itemId);
      if (existing) return existing.promise;

      const transition = enqueueItemMutation(itemId, async () => {
        const result = await postPostponeItem(itemId, scheduled);
        setDetailItem((current) => applyMutationToDetail(current, result));
        setWorkspaceItems((current) => {
          const allItems = upsertWorkspaceItem(
            upsertWorkspaceItem(current.allItems, result.source),
            result.follow_up,
          );
          return {
            ...current,
            items: applyMutationToCollection(
              current.items,
              result,
              selectionStateRef.current.leafTabId,
            ),
            allItems,
            relatedItems: buildRelatedItems(allItems),
            tagOptions: mergeTagOptions(
              mergeTagOptions(current.tagOptions, result.source.tags),
              result.follow_up.tags,
            ),
          };
        });
      });
      itemTransitions.current.set(itemId, {
        promise: transition,
        detailGeneration: null,
      });
      setItemTransitionStates((current) => ({
        ...current,
        [itemId]: { pending: true, error: null },
      }));
      const clearTransition = (error: string | null) => {
        if (itemTransitions.current.get(itemId)?.promise === transition) {
          itemTransitions.current.delete(itemId);
          setItemTransitionStates((current) =>
            error
              ? { ...current, [itemId]: { pending: false, error } }
              : Object.fromEntries(
                  Object.entries(current).filter(([key]) => key !== itemId),
                ),
          );
        }
      };
      void transition.then(
        () => clearTransition(null),
        (cause) => clearTransition(
          cause instanceof RavenApiError
            ? cause.message
            : "Could not update item.",
        ),
      );
      return transition;
    },
    workspaceItemTransitionState: (itemId) =>
      itemTransitionStates[itemId] ?? idleWorkspaceItemTransitionState,
    materializeRoutine: async (itemId, window) => {
      const { routine, created } = await postMaterializeRoutine(itemId, window);
      // Generated tasks belong in `items` only where the tab already lists tasks;
      // the routines tab lists routines, so injecting them there would corrupt it.
      const listsTasks =
        workspaceItemTypes[selection.leafTabId] === "task" ||
        (plannerItemTypes[selection.leafTabId] ?? []).includes("task");

      setDetailItem((current) => (current?.id === routine.id ? routine : current));
      setWorkspaceItems((current) => {
        const items = replaceWorkspaceItem(current.items, routine);
        const allItems = replaceWorkspaceItem(current.allItems, routine);

        return {
          ...current,
          items: listsTasks ? [...created, ...items] : items,
          allItems: [...created, ...allItems],
          tagOptions: mergeTagOptions(current.tagOptions, routine.tags),
        };
      });
      reloadInitializedTodoTables();

      return created;
    },
    saveDetailItem: async (patch) => {
      if (!detailItem) {
        return;
      }

      const itemId = detailItem.id;
      const originatingGeneration = detailOpenGeneration.current;
      await enqueueItemMutation(itemId, async () => {
        const updated = await patchItem(itemId, patch);
        setDetailItem((current) =>
          detailOpenGeneration.current === originatingGeneration && current?.id === updated.id
            ? updated
            : current,
        );
        applySharedItem(updated);
      });
    },
    closeDetailView: () => setDetailPage(null),
  };
}

function fetchAllWorkspaceItems(): Promise<WorkspaceItemModel[]> {
  return fetch("/api/v1/todo/items").then((response) => {
    if (!response.ok) {
      throw new Error(`Raven ToDo API returned ${response.status}`);
    }

    return response.json();
  });
}

function collectTagOptions(items: WorkspaceItemModel[]): string[] {
  return mergeTagOptions(
    [],
    items.flatMap((item) => item.tags ?? []),
  );
}

function mergeTagOptions(current: string[], tags: string[] | null | undefined): string[] {
  return [...new Set([...current, ...(tags ?? []).map((tag) => tag.trim()).filter(Boolean)])].sort(
    (left, right) => left.localeCompare(right),
  );
}

function postArchiveItem(itemId: string): Promise<WorkspaceItemModel> {
  return fetch(`/api/v1/todo/items/${itemId}/archive`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason: "Archived from workspace table" }),
  }).then((response) => {
    if (!response.ok) {
      return throwApiError(response);
    }

    return response.json();
  });
}

function postMaterializeRoutine(
  itemId: string,
  target: MaterializeRoutineTarget,
): Promise<{ routine: WorkspaceItemModel; created: WorkspaceItemModel[] }> {
  return fetch(`/api/v1/todo/routines/${itemId}/materialize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(target),
  }).then((response) => {
    if (!response.ok) {
      return throwApiError(response);
    }

    return response.json();
  });
}

function postPostponeItem(
  itemId: string,
  scheduled: string,
): Promise<PostponeResult> {
  return fetch(`/api/v1/todo/items/${itemId}/postpone`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ today: todayDate(), scheduled }),
  }).then((response) => {
    if (!response.ok) {
      return throwApiError(response);
    }

    return response.json();
  });
}

function postMissItem(itemId: string): Promise<WorkspaceItemModel> {
  return fetch(`/api/v1/todo/items/${itemId}/miss`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  }).then((response) => {
    if (!response.ok) {
      return throwApiError(response);
    }

    return response.json();
  });
}

function patchItem(
  itemId: string,
  patch: WorkspaceItemPatch,
): Promise<WorkspaceItemModel> {
  return fetch(`/api/v1/todo/items/${itemId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  }).then((response) => {
    if (!response.ok) {
      return throwApiError(response);
    }

    return response.json();
  });
}

async function throwApiError(response: Response): Promise<never> {
  throw decodeApiError(
    await response.json().catch(() => null),
    response.status,
  );
}

function createItemRequest(
  panelId: LeafTabId,
  planner: PlannerControls,
  form: CreateWorkspaceItemForm,
): Promise<WorkspaceItemModel> {
  const title = form.title.trim();
  const goalDefaults = plannerGoalDefaults(panelId, planner, form);
  const plannerType = plannerCreationType(panelId, form);

  if (panelId === "areas") {
    return postJson("/api/v1/todo/areas", { title });
  }
  if (panelId === "projects") {
    return postJson("/api/v1/todo/projects/propose", {
      title,
      actor: "user",
      definition_of_done: form.definition_of_done,
    });
  }
  if (panelId === "tasks") {
    return postJson("/api/v1/todo/tasks/propose", { title, actor: "user" });
  }
  if (panelId === "routines") {
    return postJson("/api/v1/todo/routines/propose", {
      title,
      actor: "user",
      materialization_policy: "single_open",
      recurrence_rule: form.recurrence_rule,
    });
  }
  if (panelId === "events") {
    return postJson("/api/v1/todo/events/propose", {
      title,
      scheduled: form.scheduled,
      actor: "user",
    });
  }
  if (panelId === "goals") {
    return postJson("/api/v1/todo/goals/propose", {
      title,
      horizon: goalDefaults.horizon,
      scheduled: goalDefaults.scheduled,
      actor: "user",
    });
  }
  if (
    plannerType === "goal" &&
    (panelId === "yearly" || panelId === "monthly" || panelId === "weekly")
  ) {
    return postJson("/api/v1/todo/goals/propose", {
      title,
      horizon: goalDefaults.horizon,
      scheduled: goalDefaults.scheduled,
      tags: form.tags,
      actor: "user",
    });
  }
  if (panelId === "weekly" || panelId === "daily" || panelId === "monthly") {
    if (plannerType === "task") {
      return postJson("/api/v1/todo/tasks/propose", {
        title,
        scheduled: form.scheduled === undefined ? planner.date : form.scheduled || undefined,
        area: form.area_id,
        project_id: form.project_id,
        priority: form.priority,
        tags: form.tags,
        actor: "user",
      });
    }
    if (plannerType === "event") {
      return postJson("/api/v1/todo/events/propose", {
        title,
        scheduled: form.scheduled || planner.date,
        area: form.area_id,
        project_id: form.project_id,
        priority: form.priority,
        tags: form.tags,
        actor: "user",
      });
    }
  }

  throw new Error(`Cannot create item from ${panelId}`);
}

function plannerCreationType(
  panelId: LeafTabId,
  form: CreateWorkspaceItemForm,
): CreateWorkspaceItemForm["itemType"] {
  if (form.itemType) {
    return form.itemType;
  }
  if (panelId === "daily") {
    return "task";
  }
  if (panelId === "weekly") {
    return "goal";
  }
  if (panelId === "yearly" || panelId === "monthly") {
    return "goal";
  }
  return undefined;
}

function plannerGoalDefaults(
  panelId: LeafTabId,
  planner: PlannerControls,
  form: CreateWorkspaceItemForm,
): { horizon: string; scheduled?: string } {
  if (form.horizon) {
    return {
      horizon: form.horizon,
      scheduled: form.scheduled,
    };
  }
  if (panelId === "weekly") {
    return {
      horizon: "week",
      scheduled: form.scheduled || isoWeekStart(planner.weekStart),
    };
  }
  if (panelId === "monthly") {
    return {
      horizon: "month",
      scheduled: form.scheduled || monthStart(planner.date),
    };
  }
  if (panelId === "yearly") {
    return {
      horizon: "year",
      scheduled: form.scheduled || yearStart(planner.date),
    };
  }

  return {
    horizon: form.horizon || "month",
    scheduled: form.scheduled,
  };
}

function postJson(url: string, body: unknown): Promise<WorkspaceItemModel> {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((response) => {
    if (!response.ok) {
      return throwApiError(response);
    }

    return response.json();
  });
}

function buildRelatedItems(items: WorkspaceItemModel[]) {
  return {
    areas: titlesById(items, "area"),
    goals: titlesById(items, "goal"),
    projects: titlesById(items, "project"),
    routines: titlesById(items, "routine"),
  };
}

function titlesById(
  items: WorkspaceItemModel[],
  itemType: WorkspaceItemType,
): Record<string, string> {
  return Object.fromEntries(
    items
      .filter((item) => item.type === itemType)
      .map((item) => [item.id, item.title]),
  );
}
