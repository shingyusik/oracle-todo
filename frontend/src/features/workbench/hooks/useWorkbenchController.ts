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

type WorkspaceItemType = "area" | "project" | "routine" | "task" | "event" | "goal";

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
  const value = new Date(`${date}T00:00:00`);
  const day = value.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  value.setDate(value.getDate() + mondayOffset);
  return formatLocalDate(value);
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function createDefaultPlanner(): PlannerControls {
  const date = todayDate();
  return {
    date,
    weekStart: weekStartForDate(date),
    dailyFilters: {
      tags: [],
      areaIds: [],
      projectIds: [],
      routineIds: [],
      itemTypes: [],
      statuses: [],
    },
    dailyGroupBy: "none",
    dailySortBy: "priority",
    plannerGroupBy: "none",
    plannerSortBy: "scheduled",
  };
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

    Promise.all(requestedTypes.map(fetchWorkspaceItems))
      .then((responses) => {
        if (!cancelled) {
          const plannerItems = plannerTypes ? responses.flat() : null;
          const [items, ...relatedItems] = responses;
          setWorkspaceItems({
            status: "loaded",
            items: plannerItems ?? items,
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
    planner,
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
      const item = await createItemRequest(selection.leafTabId, planner, form);
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
      }));
    },
    setDailyFilter: (field, values) =>
      setPlanner((current) => ({
        ...current,
        dailyFilters: { ...current.dailyFilters, [field]: values },
      })),
    setDailyGroupBy: (groupBy) =>
      setPlanner((current) => ({ ...current, dailyGroupBy: groupBy })),
    setDailySortBy: (sortBy) =>
      setPlanner((current) => ({ ...current, dailySortBy: sortBy })),
    setPlannerGroupBy: (groupBy) =>
      setPlanner((current) => ({ ...current, plannerGroupBy: groupBy })),
    setPlannerSortBy: (sortBy) =>
      setPlanner((current) => ({ ...current, plannerSortBy: sortBy })),
    transitionWorkspaceItem: async (
      itemId: string,
      action: WorkspaceItemTransitionAction,
    ) => {
      const updated = await postJson(`/todo-engine/items/${itemId}/${action}`, {});
      setDetailItem((current) => (current?.id === updated.id ? updated : current));
      setWorkspaceItems((current) => ({
        ...current,
        items: replaceWorkspaceItem(current.items, updated),
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
      throw new Error(`todo-engine returned ${response.status}`);
    }

    return response.json();
  });
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
  if (panelId === "weekly") {
    return {
      horizon: "week",
      scheduled: form.scheduled || planner.weekStart,
    };
  }
  if (panelId === "monthly") {
    return {
      horizon: "month",
      scheduled: form.scheduled || planner.date,
    };
  }
  if (panelId === "yearly") {
    return {
      horizon: "year",
      scheduled: form.scheduled || planner.date,
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
