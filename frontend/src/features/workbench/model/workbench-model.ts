import { workbenchCopy } from "@/design/copy";
import type {
  LeafTabId,
  WorkbenchSelection,
  WorkbenchTabId,
} from "@/domain/workbench/navigation";

export type WorkbenchPanelModel = {
  id: LeafTabId;
  title: string;
  eyebrow: string;
  summary: string;
  overviewLabel: string;
  summaryCards: WorkbenchSummaryCardModel[];
};

export type WorkspaceItemModel = {
  id: string;
  title: string;
  type: string;
  status: string;
  area_id?: string | null;
  project_id?: string | null;
  routine_id?: string | null;
  definition_of_done?: string | null;
  review_cycle?: string | null;
  standard?: string | null;
  note?: string | null;
  outcome?: string | null;
  recurrence_rule?: string | null;
  materialization_policy?: string | null;
  due?: string | null;
  scheduled?: string | null;
  priority?: number | null;
  last_materialized_at?: string | null;
  updated_at?: string | null;
};

export type WorkspaceItemsModel = {
  status: "idle" | "loading" | "loaded" | "error";
  items: WorkspaceItemModel[];
  relatedItems: {
    areas: Record<string, string>;
    projects: Record<string, string>;
    routines: Record<string, string>;
  };
};

export type WorkbenchSummaryCardModel = {
  label: string;
  title: string;
  summary: string;
};

export type WorkbenchController = {
  selection: WorkbenchSelection;
  panel: WorkbenchPanelModel;
  workspaceItems: WorkspaceItemsModel;
  selectTab: (tabId: WorkbenchTabId) => void;
  toggleWorkspaceExpansion: () => void;
};

export function createPanelModel(leafTabId: LeafTabId): WorkbenchPanelModel {
  const panel = workbenchCopy.panels[leafTabId];

  return {
    id: leafTabId,
    title: panel.title,
    eyebrow: panel.eyebrow,
    summary: panel.summary,
    overviewLabel: workbenchCopy.panelOverviewLabel(panel.title),
    summaryCards: [
      {
        label: workbenchCopy.summaryCards.focus.label,
        title: panel.title,
        summary: panel.summary,
      },
      {
        label: workbenchCopy.summaryCards.status.label,
        title: workbenchCopy.summaryCards.status.title,
        summary: workbenchCopy.summaryCards.status.summary,
      },
    ],
  };
}
