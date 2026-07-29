import {
  buildTableViewTabsState,
  createTableViewTab,
  deleteTableViewTab,
  discardTableViewTabDraft,
  renameTableViewTab,
  resetTableViewTabsToFirst,
  saveTableViewTabDraft,
  selectTableViewTab,
  tableViewTabIsDirty,
  updateTableViewTabDraft,
  type TableViewSettingsAdapter,
} from "@/features/workbench/model/table-view-tabs";
import {
  clonePlannerTableSettings,
  defaultPlannerTableSettings,
  normalizePlannerTableSettings,
  plannerTableIds,
  type PlannerTableId,
  type PlannerTableSettings,
} from "@/features/workbench/model/planner-model";
import type { LegacyPlannerControls } from "@/features/workbench/model/workbench-model";

export type PlannerTableTab = {
  id: string;
  name: string;
  settings: PlannerTableSettings;
};

export type StoredPlannerTableTabs = {
  tabs: PlannerTableTab[];
};

export type PlannerTableTabsState = StoredPlannerTableTabs & {
  activeTabId: string;
  draftSettings: PlannerTableSettings;
};

export type PlannerTabsState = Record<PlannerTableId, PlannerTableTabsState>;

export function buildPlannerTabsState(
  storedTabs: unknown | undefined,
  storedTableSettings: unknown | undefined,
  legacy: LegacyPlannerControls,
): PlannerTabsState {
  const tabsMap = isRecord(storedTabs) ? storedTabs : undefined;
  const settingsMap = isRecord(storedTableSettings) ? storedTableSettings : undefined;
  const adapter = plannerTableViewSettingsAdapter(legacy);

  return Object.fromEntries(plannerTableIds.map((tableId) => {
    if (storedTabs !== undefined) {
      return [tableId, buildTableViewTabsState(tableId, tabsMap?.[tableId], adapter)];
    }

    const settings = storedTableSettings !== undefined
      ? normalizePlannerTableSettings(tableId, settingsMap?.[tableId] ?? {}, legacy)
      : normalizePlannerTableSettings(tableId, undefined, legacy);
    return [tableId, buildTableViewTabsState(tableId, {
      tabs: [{ id: defaultTabId(tableId), name: "Table", settings }],
    }, adapter)];
  })) as PlannerTabsState;
}

export function plannerTabIsDirty(state: PlannerTableTabsState): boolean {
  return tableViewTabIsDirty(state, clonePlannerTableSettings);
}

export function selectPlannerTab(
  state: PlannerTableTabsState,
  tabId: string,
): PlannerTableTabsState {
  return selectTableViewTab(state, tabId, clonePlannerTableSettings);
}

export function updatePlannerTabDraft(
  state: PlannerTableTabsState,
  settings: PlannerTableSettings,
): PlannerTableTabsState {
  return updateTableViewTabDraft(state, settings, clonePlannerTableSettings);
}

export function savePlannerTabDraft(
  state: PlannerTableTabsState,
): PlannerTableTabsState {
  return saveTableViewTabDraft(state, clonePlannerTableSettings);
}

export function createPlannerTab(
  state: PlannerTableTabsState,
  id: string,
  requestedName: string,
): PlannerTableTabsState | null {
  return createTableViewTab(state, id, requestedName, clonePlannerTableSettings);
}

export function renamePlannerTab(
  state: PlannerTableTabsState,
  tabId: string,
  requestedName: string,
): PlannerTableTabsState | null {
  return renameTableViewTab(state, tabId, requestedName);
}

export function deletePlannerTab(
  state: PlannerTableTabsState,
  tabId: string,
): PlannerTableTabsState | null {
  return deleteTableViewTab(state, tabId, clonePlannerTableSettings);
}

export function discardPlannerTabDraft(
  state: PlannerTableTabsState,
): PlannerTableTabsState {
  return discardTableViewTabDraft(state, clonePlannerTableSettings);
}

export function resetPlannerTabsToFirst(
  state: PlannerTableTabsState,
): PlannerTableTabsState {
  return resetTableViewTabsToFirst(state, clonePlannerTableSettings);
}

function plannerTableViewSettingsAdapter(
  legacy: LegacyPlannerControls,
): TableViewSettingsAdapter<PlannerTableId, PlannerTableSettings> {
  return {
    defaultSettings: defaultPlannerTableSettings,
    normalizeSettings: (tableId, candidate) => normalizePlannerTableSettings(tableId, candidate, legacy),
    cloneSettings: clonePlannerTableSettings,
  };
}

function defaultTabId(tableId: PlannerTableId): string {
  return `${tableId}-table`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
