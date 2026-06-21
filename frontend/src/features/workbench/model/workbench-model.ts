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

export type WorkbenchSummaryCardModel = {
  label: string;
  title: string;
  summary: string;
};

export type WorkbenchController = {
  selection: WorkbenchSelection;
  panel: WorkbenchPanelModel;
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
