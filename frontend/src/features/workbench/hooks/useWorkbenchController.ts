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
import {
  type CreateWorkspaceItemForm,
  type LegacyPlannerControls,
  type MaterializeRoutineTarget,
  type PlannerCreationAnalysis,
  type PlannerCreationAnchor,
  type PlannerCreationContext,
  type PlannerControls,
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
  isoWeekStart,
  monthStart,
  normalizePlannerTableSettings,
  plannerTableIds,
  type PlannerTableId,
  type PlannerTableSettings,
  yearStart,
} from "@/features/workbench/model/planner-model";

type WorkspaceItemType = "area" | "project" | "routine" | "task" | "event" | "goal";

export class TodoEngineApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly detail: string,
    readonly parentHorizon?: string,
    readonly childHorizon?: string,
    readonly horizon?: string,
    readonly scheduled?: string,
    readonly parentId?: string,
  ) {
    super(detail);
    this.name = "TodoEngineApiError";
  }
}

const workspaceItemTypes: Partial<Record<LeafTabId, string>> = {
  areas: "area",
  projects: "project",
  routines: "routine",
  tasks: "task",
  events: "event",
  goals: "goal",
};

const relatedItemTypes: Partial<Record<LeafTabId, WorkspaceItemType[]>> = {
  projects: ["area"],
  routines: ["area", "project"],
  tasks: ["area", "project", "routine"],
  events: ["area", "project"],
  goals: ["area", "goal"],
};

const plannerItemTypes: Partial<Record<LeafTabId, WorkspaceItemType[]>> = {
  yearly: ["goal", "area", "project"],
  monthly: ["goal", "task", "event", "routine", "area", "project"],
  weekly: ["goal", "task", "event", "routine", "area", "project"],
  daily: ["task", "event", "routine", "area", "project"],
};

const plannerViewIds: PlannerViewId[] = ["yearly", "monthly", "weekly", "daily"];
const idleWorkspaceItemTransitionState: WorkspaceItemTransitionState = {
  pending: false,
  error: null,
};

function defaultPlannerGroupSettingsByView(): Record<
  PlannerViewId,
  PlannerGroupSettings
> {
  return Object.fromEntries(
    plannerViewIds.map((view) => [view, defaultPlannerGroupSettings()]),
  ) as Record<PlannerViewId, PlannerGroupSettings>;
}

type StoredPlannerSettings = Pick<PlannerControls, "tableSettings">;

let plannerSettingsWrite = Promise.resolve();

async function loadPlannerSettings(): Promise<StoredPlannerSettings | null> {
  try {
    const response = await fetch("/todo-engine/settings/planner");
    if (!response.ok) return null;
    const value = await response.json();
    if (!value || typeof value !== "object") return null;
    const candidate = value as Record<string, unknown>;
    const legacy = normalizeLegacyPlannerControls(candidate);
    const storedTableSettings = Object.prototype.hasOwnProperty.call(
      candidate,
      "tableSettings",
    )
      ? candidate.tableSettings
      : undefined;
    return {
      tableSettings: buildPlannerTableSettingsMap(storedTableSettings, legacy),
    };
  } catch {
    return null;
  }
}

function persistPlannerSettings(planner: PlannerControls): void {
  const body = JSON.stringify({
    value: {
      tableSettings: planner.tableSettings,
    },
  });
  plannerSettingsWrite = plannerSettingsWrite
    .catch(() => undefined)
    .then(() => fetch("/todo-engine/settings/planner", {
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

function buildPlannerTableSettingsMap(
  stored: unknown | undefined,
  legacy: LegacyPlannerControls,
): Record<PlannerTableId, PlannerTableSettings> {
  const storedMap = isRecord(stored) ? stored : {};
  return Object.fromEntries(
    plannerTableIds.map((tableId) => {
      if (stored !== undefined) {
        const candidate = Object.prototype.hasOwnProperty.call(storedMap, tableId)
          ? storedMap[tableId]
          : null;
        return [tableId, normalizePlannerTableSettings(tableId, candidate, legacy)];
      }

      return [tableId, normalizePlannerTableSettings(tableId, undefined, legacy)];
    }),
  ) as Record<PlannerTableId, PlannerTableSettings>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

const emptyWorkspaceItems: WorkspaceItemsModel = {
  status: "idle",
  items: [],
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
    tableSettings: buildPlannerTableSettingsMap({}, legacy),
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
  const [selection, setSelection] = useState<WorkbenchSelection>(() =>
    resolveInitialSelection(),
  );
  const [workspaceItems, setWorkspaceItems] =
    useState<WorkspaceItemsModel>(emptyWorkspaceItems);
  const [planner, setPlanner] = useState<PlannerControls>(() =>
    createDefaultPlanner(),
  );
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [archiveConfirmationOpen, setArchiveConfirmationOpen] = useState(false);
  const [creationDialogOpen, setCreationDialogOpen] = useState(false);
  const [plannerCreationContext, setPlannerCreationContext] =
    useState<PlannerCreationContext | null>(null);
  const [detailItem, setDetailItem] = useState<WorkspaceItemModel | null>(null);
  const itemTransitions = useRef(new Map<string, Promise<void>>());
  const plannerSettingsChanged = useRef(false);
  const [itemTransitionStates, setItemTransitionStates] = useState<
    Record<string, WorkspaceItemTransitionState>
  >({});
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

  useEffect(() => {
    let active = true;
    void loadPlannerSettings().then((stored) => {
      if (active && stored && !plannerSettingsChanged.current) {
        setPlanner((current) => ({ ...current, ...stored }));
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const persistChangedPlannerSettings = (next: PlannerControls) => {
    plannerSettingsChanged.current = true;
    persistPlannerSettings(next);
  };

  useEffect(() => {
    setSelectedItemIds([]);
    setArchiveConfirmationOpen(false);
    setCreationDialogOpen(false);
    setPlannerCreationContext(null);
    setDetailItem(null);
  }, [selection.leafTabId]);

  useEffect(() => {
    const itemType = workspaceItemTypes[selection.leafTabId];
    const plannerTypes = plannerItemTypes[selection.leafTabId];
    const requestedTypes = itemType
      ? [itemType, ...(relatedItemTypes[selection.leafTabId] ?? [])]
      : plannerTypes;

    if (!requestedTypes || requestedTypes.length === 0) {
      setWorkspaceItems(emptyWorkspaceItems);
      return;
    }

    let cancelled = false;
    setWorkspaceItems({ ...emptyWorkspaceItems, status: "loading" });

    Promise.all([...requestedTypes.map(fetchWorkspaceItems), fetchAllWorkspaceItems()])
      .then((responses) => {
        if (!cancelled) {
          const allItems = responses[responses.length - 1] ?? [];
          const typedResponses = responses.slice(0, -1);
          const plannerRelatedItems = plannerTypes ? typedResponses.flat() : null;
          const plannerItems = plannerRelatedItems
            ? plannerRelatedItems.filter((item) =>
                item.type === "goal" || item.type === "task" || item.type === "event",
              )
            : null;
          const [items, ...relatedItems] = typedResponses;
          setWorkspaceItems({
            status: "loaded",
            items: plannerItems ?? items,
            tagOptions: collectTagOptions(allItems),
            relatedItems: buildRelatedItems(
              plannerRelatedItems ?? relatedItems.flat(),
            ),
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setWorkspaceItems({ ...emptyWorkspaceItems, status: "error" });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selection.leafTabId]);

  return {
    selection,
    panel,
    workspaceItems,
    planner: activePlanner,
    selectedItemIds,
    archiveConfirmationOpen,
    creationDialogOpen,
    plannerCreationContext,
    plannerCreationAnalysis,
    detailItem,
    selectTab: (tabId: WorkbenchTabId) =>
      setSelection((currentSelection) => {
        if (tabId === "workspace" || tabId === "planner") {
          return toggleTodoGroupExpansion(currentSelection, tabId);
        }

        return resolveSelection(tabId, currentSelection);
      }),
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
    toggleVisibleSelection: () =>
      setSelectedItemIds((current) => {
        const visibleIds = workspaceItems.items.map((item) => item.id);

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
      }));
      setSelectedItemIds(failedIds);
      setArchiveConfirmationOpen(false);
    },
    openCreationDialog: () => {
      setPlannerCreationContext(null);
      setCreationDialogOpen(true);
    },
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
          throw new TodoEngineApiError(
            400,
            "validation_error",
            `${label} is not allowed for ${canonicalContext.tableId}.`,
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
      }));
      setDetailItem(item);
      setCreationDialogOpen(false);
      setPlannerCreationContext(null);
    },
    openDetailView: (item) => setDetailItem(item),
    patchWorkspaceItem: async (itemId, patch) => {
      const updated = await patchItem(itemId, patch);
      setDetailItem((current) => (current?.id === updated.id ? updated : current));
      setWorkspaceItems((current) => ({
        ...current,
        items: replaceWorkspaceItem(current.items, updated),
        tagOptions: mergeTagOptions(current.tagOptions, updated.tags),
      }));
    },
    plannerTableSettings: (tableId) => activePlanner.tableSettings[tableId],
    updatePlannerTableSettings: (tableId, updater) =>
      setPlanner((current) => {
        const nextSettings = updater(current.tableSettings[tableId]);
        const next = {
          ...current,
          tableSettings: { ...current.tableSettings, [tableId]: nextSettings },
        };
        persistChangedPlannerSettings(next);
        return next;
      }),
    transitionWorkspaceItem: (
      itemId: string,
      action: WorkspaceItemTransitionAction,
    ) => {
      const existing = itemTransitions.current.get(itemId);
      if (existing) return existing;

      const transition = (async () => {
        const updated = await postJson(`/todo-engine/items/${itemId}/${action}`, {});
        setDetailItem((current) => (current?.id === updated.id ? updated : current));
        setWorkspaceItems((current) => ({
          ...current,
          items: replaceWorkspaceItem(current.items, updated),
          tagOptions: mergeTagOptions(current.tagOptions, updated.tags),
        }));
      })();
      itemTransitions.current.set(itemId, transition);
      setItemTransitionStates((current) => ({
        ...current,
        [itemId]: { pending: true, error: null },
      }));
      const clearTransition = (error: string | null) => {
        if (itemTransitions.current.get(itemId) === transition) {
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
          cause instanceof TodoEngineApiError
            ? cause.detail
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

        return {
          ...current,
          items: listsTasks ? [...created, ...items] : items,
          tagOptions: mergeTagOptions(current.tagOptions, routine.tags),
        };
      });

      return created;
    },
    saveDetailItem: async (patch) => {
      if (!detailItem) {
        return;
      }

      const updated = await patchItem(detailItem.id, patch);
      setDetailItem(updated);
      setWorkspaceItems((current) => ({
        ...current,
        items: replaceWorkspaceItem(current.items, updated),
        tagOptions: mergeTagOptions(current.tagOptions, updated.tags),
      }));
    },
    closeDetailView: () => setDetailItem(null),
  };
}

function fetchWorkspaceItems(
  itemType: WorkspaceItemType | string,
): Promise<WorkspaceItemModel[]> {
  return fetch(`/todo-engine/items?type=${itemType}`).then((response) => {
    if (!response.ok) {
      throw new Error(`todo-engine returned ${response.status}`);
    }

    return response.json();
  });
}

function fetchAllWorkspaceItems(): Promise<WorkspaceItemModel[]> {
  return fetch("/todo-engine/items").then((response) => {
    if (!response.ok) {
      throw new Error(`todo-engine returned ${response.status}`);
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
  return fetch(`/todo-engine/items/${itemId}/archive`, {
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
  return fetch(`/todo-engine/routines/${itemId}/materialize`, {
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

function patchItem(
  itemId: string,
  patch: WorkspaceItemPatch,
): Promise<WorkspaceItemModel> {
  return fetch(`/todo-engine/items/${itemId}`, {
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
  const body = (await response.json().catch(() => null)) as
    | {
        code?: unknown;
        detail?: unknown;
        parent_horizon?: unknown;
        child_horizon?: unknown;
        horizon?: unknown;
        scheduled?: unknown;
        parent_id?: unknown;
      }
    | null;

  throw new TodoEngineApiError(
    response.status,
    typeof body?.code === "string" ? body.code : "internal_error",
    typeof body?.detail === "string"
      ? body.detail
      : `todo-engine returned ${response.status}`,
    typeof body?.parent_horizon === "string" ? body.parent_horizon : undefined,
    typeof body?.child_horizon === "string" ? body.child_horizon : undefined,
    typeof body?.horizon === "string" ? body.horizon : undefined,
    typeof body?.scheduled === "string" ? body.scheduled : undefined,
    typeof body?.parent_id === "string" ? body.parent_id : undefined,
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
    return postJson("/todo-engine/areas", { title });
  }
  if (panelId === "projects") {
    return postJson("/todo-engine/projects/propose", {
      title,
      actor: "user",
      definition_of_done: form.definition_of_done,
    });
  }
  if (panelId === "tasks") {
    return postJson("/todo-engine/tasks/propose", { title, actor: "user" });
  }
  if (panelId === "routines") {
    return postJson("/todo-engine/routines/propose", {
      title,
      actor: "user",
      materialization_policy: "single_open",
      recurrence_rule: form.recurrence_rule,
    });
  }
  if (panelId === "events") {
    return postJson("/todo-engine/events/propose", {
      title,
      scheduled: form.scheduled,
      actor: "user",
    });
  }
  if (panelId === "goals") {
    return postJson("/todo-engine/goals/propose", {
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
    return postJson("/todo-engine/goals/propose", {
      title,
      horizon: goalDefaults.horizon,
      scheduled: goalDefaults.scheduled,
      tags: form.tags,
      actor: "user",
    });
  }
  if (panelId === "weekly" || panelId === "daily" || panelId === "monthly") {
    if (plannerType === "task") {
      return postJson("/todo-engine/tasks/propose", {
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
      return postJson("/todo-engine/events/propose", {
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
