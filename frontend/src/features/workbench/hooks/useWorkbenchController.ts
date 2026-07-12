"use client";

import { useEffect, useMemo, useState } from "react";

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
  type PlannerControls,
  type WorkbenchController,
  type WorkspaceItemModel,
  type WorkspaceItemPatch,
  type WorkspaceItemTransitionAction,
  type WorkspaceItemsModel,
  createPanelModel,
} from "@/features/workbench/model/workbench-model";
import {
  addMonths,
  addYears,
  isoWeekStart,
  monthStart,
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
  routines: ["area"],
  tasks: ["area", "project", "routine"],
  events: ["area", "project"],
  goals: ["area", "goal"],
};

const plannerItemTypes: Partial<Record<LeafTabId, WorkspaceItemType[]>> = {
  yearly: ["goal", "area", "project"],
  monthly: ["goal", "area", "project"],
  weekly: ["goal", "task", "event", "routine", "area", "project"],
  daily: ["task", "event", "routine", "area", "project"],
};

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
  return {
    date,
    weekStart: weeklyDate,
    yearlyDate,
    monthlyDate,
    weeklyDate,
    dailyDate: date,
    dailyFilters: {
      tags: [],
      areaIds: [],
      projectIds: [],
      routineIds: [],
      itemTypes: [],
      statuses: [],
    },
    filterMode: "and",
    filterRules: [],
    dailyGroupBy: "none",
    dailySortRules: [{ id: "daily-default-sort", field: "priority", direction: "asc" }],
    yearlyGroupBy: "none",
    yearlySortRules: [{ id: "yearly-default-sort", field: "scheduled", direction: "asc" }],
    monthlyGroupBy: "none",
    monthlySortRules: [{ id: "monthly-default-sort", field: "scheduled", direction: "asc" }],
    weeklyGroupBy: "none",
    weeklySortRules: [{ id: "weekly-default-sort", field: "scheduled", direction: "asc" }],
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
  const [detailItem, setDetailItem] = useState<WorkspaceItemModel | null>(null);
  const panel = useMemo(
    () => createPanelModel(selection.leafTabId),
    [selection.leafTabId],
  );
  const activePlanner = useMemo(
    () => withActivePlannerPeriod(planner, selection.leafTabId),
    [planner, selection.leafTabId],
  );

  useEffect(() => {
    setSelectedItemIds([]);
    setArchiveConfirmationOpen(false);
    setCreationDialogOpen(false);
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
          const plannerItems = plannerTypes ? typedResponses.flat() : null;
          const [items, ...relatedItems] = typedResponses;
          setWorkspaceItems({
            status: "loaded",
            items: plannerItems ?? items,
            tagOptions: collectTagOptions(allItems),
            relatedItems: buildRelatedItems(
              plannerItems ?? relatedItems.flat(),
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
    openCreationDialog: () => setCreationDialogOpen(true),
    closeCreationDialog: () => setCreationDialogOpen(false),
    createWorkspaceItem: async (form) => {
      const item = await createItemRequest(
        selection.leafTabId,
        activePlanner,
        form,
      );
      setWorkspaceItems((current) => ({
        ...current,
        items: [item, ...current.items],
      }));
      setDetailItem(item);
      setCreationDialogOpen(false);
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
    setDailyFilter: (field, values) =>
      setPlanner((current) => ({
        ...current,
        dailyFilters: { ...current.dailyFilters, [field]: values },
      })),
    setPlannerFilterMode: (mode) =>
      setPlanner((current) => ({ ...current, filterMode: mode })),
    setPlannerFilterRules: (rules) =>
      setPlanner((current) => ({ ...current, filterRules: rules })),
    clearPlannerFilterRules: () =>
      setPlanner((current) => ({ ...current, filterMode: "and", filterRules: [] })),
    setDailyGroupBy: (groupBy) =>
      setPlanner((current) => ({ ...current, dailyGroupBy: groupBy })),
    setDailySortRules: (rules) =>
      setPlanner((current) => ({ ...current, dailySortRules: rules })),
    setPlannerGroupBy: (groupBy) =>
      setPlanner((current) => {
        if (selection.leafTabId === "weekly") {
          return { ...current, weeklyGroupBy: groupBy };
        }
        if (selection.leafTabId === "monthly") {
          return { ...current, monthlyGroupBy: groupBy };
        }
        if (selection.leafTabId === "yearly") {
          return { ...current, yearlyGroupBy: groupBy };
        }
        return current;
      }),
    setPlannerSortRules: (rules) =>
      setPlanner((current) => {
        if (selection.leafTabId === "weekly") {
          return { ...current, weeklySortRules: rules };
        }
        if (selection.leafTabId === "monthly") {
          return { ...current, monthlySortRules: rules };
        }
        if (selection.leafTabId === "yearly") {
          return { ...current, yearlySortRules: rules };
        }
        return current;
      }),
    transitionWorkspaceItem: async (
      itemId: string,
      action: WorkspaceItemTransitionAction,
    ) => {
      const updated = await postJson(`/todo-engine/items/${itemId}/${action}`, {});
      setDetailItem((current) => (current?.id === updated.id ? updated : current));
      setWorkspaceItems((current) => ({
        ...current,
        items: replaceWorkspaceItem(current.items, updated),
        tagOptions: mergeTagOptions(current.tagOptions, updated.tags),
      }));
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
      throw new Error(`todo-engine returned ${response.status}`);
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
    return postJson("/todo-engine/projects/propose", { title, actor: "user" });
  }
  if (panelId === "tasks") {
    return postJson("/todo-engine/tasks/propose", { title, actor: "user" }).then(
      (item) =>
        item.status === "active"
          ? item
          : postJson(`/todo-engine/items/${item.id}/activate`, {}),
    );
  }
  if (panelId === "routines") {
    return postJson("/todo-engine/routines/propose", {
      title,
      actor: "user",
      materialization_policy: "single_open",
    });
  }
  if (panelId === "events") {
    return postJson("/todo-engine/events/propose", {
      title,
      scheduled: form.scheduled,
      actor: "user",
    }).then((item) =>
      item.status === "active"
        ? item
        : postJson(`/todo-engine/items/${item.id}/activate`, {}),
    );
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
      actor: "user",
    });
  }
  if (panelId === "weekly" || panelId === "daily") {
    if (plannerType === "task") {
      return postJson("/todo-engine/tasks/propose", {
        title,
        scheduled: form.scheduled || planner.date,
        actor: "user",
      }).then(activateIfNeeded);
    }
    if (plannerType === "event") {
      return postJson("/todo-engine/events/propose", {
        title,
        scheduled: form.scheduled || planner.date,
        actor: "user",
      }).then(activateIfNeeded);
    }
    if (plannerType === "routine") {
      return postJson("/todo-engine/routines/propose", {
        title,
        actor: "user",
        materialization_policy: "single_open",
      });
    }
  }

  throw new Error(`Cannot create item from ${panelId}`);
}

function activateIfNeeded(item: WorkspaceItemModel): Promise<WorkspaceItemModel> {
  return item.status === "active"
    ? Promise.resolve(item)
    : postJson(`/todo-engine/items/${item.id}/activate`, {});
}

function plannerCreationType(
  panelId: LeafTabId,
  form: CreateWorkspaceItemForm,
): CreateWorkspaceItemForm["itemType"] {
  if (panelId === "daily") {
    return form.itemType ?? "task";
  }
  if (panelId === "weekly") {
    return form.itemType ?? "goal";
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
      throw new Error(`todo-engine returned ${response.status}`);
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
