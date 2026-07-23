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

  return Object.fromEntries(plannerTableIds.map((tableId) => {
    if (storedTabs !== undefined) {
      return [tableId, buildTableTabsState(tableId, tabsMap?.[tableId], legacy)];
    }

    const settings = storedTableSettings !== undefined
      ? normalizePlannerTableSettings(tableId, settingsMap?.[tableId] ?? {}, legacy)
      : normalizePlannerTableSettings(tableId, undefined, legacy);
    return [tableId, stateFromTabs(tableId, [{
      id: defaultTabId(tableId),
      name: "Table",
      settings,
    }])];
  })) as PlannerTabsState;
}

export function plannerTabIsDirty(state: PlannerTableTabsState): boolean {
  const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId);
  return activeTab !== undefined && JSON.stringify(clonePlannerTableSettings(activeTab.settings)) !==
    JSON.stringify(clonePlannerTableSettings(state.draftSettings));
}

export function selectPlannerTab(
  state: PlannerTableTabsState,
  tabId: string,
): PlannerTableTabsState {
  const tab = state.tabs.find((candidate) => candidate.id === tabId);
  if (!tab || tab.id === state.activeTabId) return state;
  return {
    ...state,
    activeTabId: tab.id,
    draftSettings: clonePlannerTableSettings(tab.settings),
  };
}

export function updatePlannerTabDraft(
  state: PlannerTableTabsState,
  settings: PlannerTableSettings,
): PlannerTableTabsState {
  return { ...state, draftSettings: clonePlannerTableSettings(settings) };
}

export function savePlannerTabDraft(
  state: PlannerTableTabsState,
): PlannerTableTabsState {
  if (!state.tabs.some((tab) => tab.id === state.activeTabId)) return state;
  const draftSettings = clonePlannerTableSettings(state.draftSettings);
  return {
    ...state,
    tabs: state.tabs.map((tab) => tab.id === state.activeTabId
      ? { ...tab, settings: clonePlannerTableSettings(draftSettings) }
      : tab),
    draftSettings,
  };
}

export function createPlannerTab(
  state: PlannerTableTabsState,
  id: string,
  requestedName: string,
): PlannerTableTabsState | null {
  if (id.trim().length === 0 || state.tabs.some((tab) => tab.id === id)) return null;
  const name = uniqueName(requestedName, state.tabs.map((tab) => tab.name));
  if (!name) return null;

  const draftSettings = clonePlannerTableSettings(state.draftSettings);
  return {
    tabs: [...state.tabs, { id, name, settings: clonePlannerTableSettings(draftSettings) }],
    activeTabId: id,
    draftSettings,
  };
}

export function renamePlannerTab(
  state: PlannerTableTabsState,
  tabId: string,
  requestedName: string,
): PlannerTableTabsState | null {
  const index = state.tabs.findIndex((tab) => tab.id === tabId);
  if (index < 0) return null;
  const name = uniqueName(
    requestedName,
    state.tabs.filter((tab) => tab.id !== tabId).map((tab) => tab.name),
  );
  if (!name) return null;

  return {
    ...state,
    tabs: state.tabs.map((tab, tabIndex) => tabIndex === index ? { ...tab, name } : tab),
  };
}

export function deletePlannerTab(
  state: PlannerTableTabsState,
  tabId: string,
): PlannerTableTabsState | null {
  const index = state.tabs.findIndex((tab) => tab.id === tabId);
  if (state.tabs.length <= 1 || index < 0) return null;

  const tabs = state.tabs.filter((tab) => tab.id !== tabId);
  if (tabId !== state.activeTabId) return { ...state, tabs };

  const nextActiveTab = tabs[index] ?? tabs[index - 1];
  return {
    tabs,
    activeTabId: nextActiveTab.id,
    draftSettings: clonePlannerTableSettings(nextActiveTab.settings),
  };
}

export function discardPlannerTabDraft(
  state: PlannerTableTabsState,
): PlannerTableTabsState {
  const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId);
  return activeTab
    ? { ...state, draftSettings: clonePlannerTableSettings(activeTab.settings) }
    : state;
}

export function resetPlannerTabsToFirst(
  state: PlannerTableTabsState,
): PlannerTableTabsState {
  const firstTab = state.tabs[0];
  return firstTab
    ? {
      ...state,
      activeTabId: firstTab.id,
      draftSettings: clonePlannerTableSettings(firstTab.settings),
    }
    : state;
}

function buildTableTabsState(
  tableId: PlannerTableId,
  candidate: unknown,
  legacy: LegacyPlannerControls,
): PlannerTableTabsState {
  if (!isRecord(candidate) || !Array.isArray(candidate.tabs)) {
    return stateFromTabs(tableId, [defaultTab(tableId)]);
  }

  const tabs = normalizeTabs(tableId, candidate.tabs, legacy);
  return stateFromTabs(tableId, tabs.length > 0 ? tabs : [defaultTab(tableId)]);
}

function normalizeTabs(
  tableId: PlannerTableId,
  candidates: unknown[],
  legacy: LegacyPlannerControls,
): PlannerTableTab[] {
  const ids = new Set<string>();
  const names: string[] = [];
  const tabs: PlannerTableTab[] = [];

  for (const candidate of candidates) {
    if (!isRecord(candidate) || typeof candidate.id !== "string" || candidate.id.trim().length === 0 ||
      typeof candidate.name !== "string") continue;
    const name = uniqueName(candidate.name, names);
    if (!name) continue;

    const id = uniqueId(candidate.id, ids);
    const settings = normalizePlannerTableSettings(tableId, candidate.settings ?? {}, legacy);
    ids.add(id);
    names.push(name);
    tabs.push({ id, name, settings: clonePlannerTableSettings(settings) });
  }

  return tabs;
}

function stateFromTabs(
  tableId: PlannerTableId,
  tabs: PlannerTableTab[],
): PlannerTableTabsState {
  const firstTab = tabs[0] ?? defaultTab(tableId);
  const storedTabs = tabs.length > 0 ? tabs : [firstTab];
  return {
    tabs: storedTabs.map((tab) => ({ ...tab, settings: clonePlannerTableSettings(tab.settings) })),
    activeTabId: firstTab.id,
    draftSettings: clonePlannerTableSettings(firstTab.settings),
  };
}

function defaultTab(tableId: PlannerTableId): PlannerTableTab {
  return {
    id: defaultTabId(tableId),
    name: "Table",
    settings: defaultPlannerTableSettings(tableId),
  };
}

function defaultTabId(tableId: PlannerTableId): string {
  return `${tableId}-table`;
}

function uniqueId(candidate: string, usedIds: ReadonlySet<string>): string {
  if (!usedIds.has(candidate)) return candidate;
  let suffix = 2;
  while (usedIds.has(`${candidate}-${suffix}`)) suffix += 1;
  return `${candidate}-${suffix}`;
}

function uniqueName(requestedName: string, existingNames: readonly string[]): string | null {
  const baseName = requestedName.trim();
  if (baseName.length === 0) return null;
  const usedNames = new Set(existingNames.map((name) => name.toLowerCase()));
  if (!usedNames.has(baseName.toLowerCase())) return baseName;

  let suffix = 2;
  while (usedNames.has(`${baseName} ${suffix}`.toLowerCase())) suffix += 1;
  return `${baseName} ${suffix}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
