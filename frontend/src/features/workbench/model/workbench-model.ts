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
};

export type WorkbenchController = {
  selection: WorkbenchSelection;
  panel: WorkbenchPanelModel;
  selectTab: (tabId: WorkbenchTabId) => void;
};

export function createPanelModel(leafTabId: LeafTabId): WorkbenchPanelModel {
  const panel = workbenchCopy.panels[leafTabId];

  return {
    id: leafTabId,
    title: panel.title,
    eyebrow: panel.eyebrow,
    summary: panel.summary,
  };
}
