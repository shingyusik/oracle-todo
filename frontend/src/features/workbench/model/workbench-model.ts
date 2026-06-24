import { workbenchCopy } from "@/design/copy";
import type {
  LeafTabId,
  WorkbenchSelection,
  WorkbenchTabId,
} from "@/domain/workbench/navigation";

export type WorkbenchPanelModel = {
  id: LeafTabId;
  title: string;
};

export type WorkspaceItemModel = {
  id: string;
  title: string;
  type: string;
  status: string;
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
  relatedItems: {
    areas: Record<string, string>;
    goals: Record<string, string>;
    projects: Record<string, string>;
    routines: Record<string, string>;
  };
};

export type WorkbenchController = {
  selection: WorkbenchSelection;
  panel: WorkbenchPanelModel;
  workspaceItems: WorkspaceItemsModel;
  selectedItemIds: string[];
  archiveConfirmationOpen: boolean;
  selectTab: (tabId: WorkbenchTabId) => void;
  toggleWorkspaceExpansion: () => void;
  toggleItemSelection: (itemId: string) => void;
  toggleVisibleSelection: () => void;
  requestArchiveSelected: () => void;
  cancelArchiveSelected: () => void;
  confirmArchiveSelected: () => Promise<void>;
};

export function createPanelModel(leafTabId: LeafTabId): WorkbenchPanelModel {
  const panel = workbenchCopy.panels[leafTabId];

  return {
    id: leafTabId,
    title: panel.title,
  };
}
