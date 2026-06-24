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
  type WorkbenchController,
  type WorkspaceItemModel,
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

export function useWorkbenchController(): WorkbenchController {
  const [selection, setSelection] = useState<WorkbenchSelection>(() =>
    resolveInitialSelection(),
  );
  const [workspaceItems, setWorkspaceItems] =
    useState<WorkspaceItemsModel>(emptyWorkspaceItems);
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
    if (!itemType) {
      setWorkspaceItems(emptyWorkspaceItems);
      return;
    }

    let cancelled = false;
    setWorkspaceItems({ ...emptyWorkspaceItems, status: "loading" });

    Promise.all([
      fetchWorkspaceItems(itemType),
      ...((relatedItemTypes[selection.leafTabId] ?? []).map(fetchWorkspaceItems)),
    ])
      .then(([items, ...relatedItems]) => {
        if (!cancelled) {
          setWorkspaceItems({
            status: "loaded",
            items,
            relatedItems: buildRelatedItems(relatedItems.flat()),
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
      await Promise.all(idsToArchive.map(postArchiveItem));
      setWorkspaceItems((current) => ({
        ...current,
        items: current.items.filter((item) => !idsToArchive.includes(item.id)),
      }));
      setSelectedItemIds([]);
      setArchiveConfirmationOpen(false);
    },
    openCreationDialog: () => setCreationDialogOpen(true),
    closeCreationDialog: () => setCreationDialogOpen(false),
    createWorkspaceItem: async (form) => {
      const item = await createItemRequest(selection.leafTabId, form);
      setWorkspaceItems((current) => ({
        ...current,
        items: [item, ...current.items],
      }));
      setDetailItem(item);
      setCreationDialogOpen(false);
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

function createItemRequest(
  panelId: LeafTabId,
  form: CreateWorkspaceItemForm,
): Promise<WorkspaceItemModel> {
  const title = form.title.trim();

  if (panelId === "areas") {
    return postJson("/todo-engine/areas", { title });
  }
  if (panelId === "projects") {
    return postJson("/todo-engine/projects/propose", { title, actor: "user" });
  }
  if (panelId === "tasks") {
    return postJson("/todo-engine/tasks/propose", { title, actor: "user" });
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
      scheduled: form.scheduled || new Date().toISOString().slice(0, 10),
      actor: "user",
    });
  }
  if (panelId === "goals") {
    return postJson("/todo-engine/goals/propose", {
      title,
      horizon: form.horizon || "month",
      scheduled: form.scheduled,
      actor: "user",
    });
  }

  throw new Error(`Cannot create item from ${panelId}`);
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
