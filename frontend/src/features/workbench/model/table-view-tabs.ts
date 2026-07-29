export type TableViewTab<TSettings> = {
  id: string;
  name: string;
  settings: TSettings;
};

export type TableViewTabsState<TSettings> = {
  tabs: TableViewTab<TSettings>[];
  activeTabId: string;
  draftSettings: TSettings;
};

export type TableViewSettingsAdapter<TScope extends string, TSettings> = {
  defaultSettings(scope: TScope): TSettings;
  normalizeSettings(scope: TScope, candidate: unknown): TSettings;
  cloneSettings(settings: TSettings): TSettings;
};

export function buildTableViewTabsState<TScope extends string, TSettings>(
  scope: TScope,
  candidate: unknown,
  adapter: TableViewSettingsAdapter<TScope, TSettings>,
): TableViewTabsState<TSettings> {
  const tabs = isRecord(candidate) && Array.isArray(candidate.tabs)
    ? normalizeTabs(scope, candidate.tabs, adapter)
    : [];
  return stateFromTabs(scope, tabs, adapter);
}

export function tableViewTabIsDirty<TSettings>(
  state: TableViewTabsState<TSettings>,
  cloneSettings: (settings: TSettings) => TSettings,
): boolean {
  const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId);
  return activeTab !== undefined && JSON.stringify(cloneSettings(activeTab.settings)) !==
    JSON.stringify(cloneSettings(state.draftSettings));
}

export function selectTableViewTab<TSettings>(
  state: TableViewTabsState<TSettings>,
  tabId: string,
  cloneSettings: (settings: TSettings) => TSettings,
): TableViewTabsState<TSettings> {
  const tab = state.tabs.find((candidate) => candidate.id === tabId);
  if (!tab || tab.id === state.activeTabId) return state;
  return {
    ...state,
    activeTabId: tab.id,
    draftSettings: cloneSettings(tab.settings),
  };
}

export function updateTableViewTabDraft<TSettings>(
  state: TableViewTabsState<TSettings>,
  settings: TSettings,
  cloneSettings: (settings: TSettings) => TSettings,
): TableViewTabsState<TSettings> {
  return { ...state, draftSettings: cloneSettings(settings) };
}

export function saveTableViewTabDraft<TSettings>(
  state: TableViewTabsState<TSettings>,
  cloneSettings: (settings: TSettings) => TSettings,
): TableViewTabsState<TSettings> {
  if (!state.tabs.some((tab) => tab.id === state.activeTabId)) return state;
  const draftSettings = cloneSettings(state.draftSettings);
  return {
    ...state,
    tabs: state.tabs.map((tab) => tab.id === state.activeTabId
      ? { ...tab, settings: cloneSettings(draftSettings) }
      : tab),
    draftSettings,
  };
}

export function createTableViewTab<TSettings>(
  state: TableViewTabsState<TSettings>,
  requestedId: string,
  requestedName: string,
  cloneSettings: (settings: TSettings) => TSettings,
): TableViewTabsState<TSettings> | null {
  const id = requestedId.trim();
  if (id.length === 0 || state.tabs.some((tab) => tab.id === id)) return null;
  const name = uniqueName(requestedName, state.tabs.map((tab) => tab.name));
  if (!name) return null;

  const draftSettings = cloneSettings(state.draftSettings);
  return {
    tabs: [...state.tabs, { id, name, settings: cloneSettings(draftSettings) }],
    activeTabId: id,
    draftSettings,
  };
}

export function renameTableViewTab<TSettings>(
  state: TableViewTabsState<TSettings>,
  tabId: string,
  requestedName: string,
): TableViewTabsState<TSettings> | null {
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

export function deleteTableViewTab<TSettings>(
  state: TableViewTabsState<TSettings>,
  tabId: string,
  cloneSettings: (settings: TSettings) => TSettings,
): TableViewTabsState<TSettings> | null {
  const index = state.tabs.findIndex((tab) => tab.id === tabId);
  if (state.tabs.length <= 1 || index < 0) return null;

  const tabs = state.tabs.filter((tab) => tab.id !== tabId);
  if (tabId !== state.activeTabId) return { ...state, tabs };

  const nextActiveTab = tabs[index] ?? tabs[index - 1];
  return {
    tabs,
    activeTabId: nextActiveTab.id,
    draftSettings: cloneSettings(nextActiveTab.settings),
  };
}

export function discardTableViewTabDraft<TSettings>(
  state: TableViewTabsState<TSettings>,
  cloneSettings: (settings: TSettings) => TSettings,
): TableViewTabsState<TSettings> {
  const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId);
  return activeTab
    ? { ...state, draftSettings: cloneSettings(activeTab.settings) }
    : state;
}

export function resetTableViewTabsToFirst<TSettings>(
  state: TableViewTabsState<TSettings>,
  cloneSettings: (settings: TSettings) => TSettings,
): TableViewTabsState<TSettings> {
  const firstTab = state.tabs[0];
  return firstTab
    ? {
      ...state,
      activeTabId: firstTab.id,
      draftSettings: cloneSettings(firstTab.settings),
    }
    : state;
}

function normalizeTabs<TScope extends string, TSettings>(
  scope: TScope,
  candidates: unknown[],
  adapter: TableViewSettingsAdapter<TScope, TSettings>,
): TableViewTab<TSettings>[] {
  const ids = new Set<string>();
  const names: string[] = [];
  const tabs: TableViewTab<TSettings>[] = [];

  for (const candidate of candidates) {
    if (!isRecord(candidate) || typeof candidate.id !== "string" || typeof candidate.name !== "string") {
      continue;
    }
    const requestedId = candidate.id.trim();
    if (requestedId.length === 0) continue;
    const name = uniqueName(candidate.name, names);
    if (!name) continue;

    const id = uniqueId(requestedId, ids);
    const settings = adapter.normalizeSettings(scope, candidate.settings ?? {});
    ids.add(id);
    names.push(name);
    tabs.push({ id, name, settings: adapter.cloneSettings(settings) });
  }

  return tabs;
}

function stateFromTabs<TScope extends string, TSettings>(
  scope: TScope,
  tabs: TableViewTab<TSettings>[],
  adapter: TableViewSettingsAdapter<TScope, TSettings>,
): TableViewTabsState<TSettings> {
  const storedTabs = tabs.length > 0 ? tabs : [defaultTab(scope, adapter)];
  const firstTab = storedTabs[0]!;
  return {
    tabs: storedTabs.map((tab) => ({ ...tab, settings: adapter.cloneSettings(tab.settings) })),
    activeTabId: firstTab.id,
    draftSettings: adapter.cloneSettings(firstTab.settings),
  };
}

function defaultTab<TScope extends string, TSettings>(
  scope: TScope,
  adapter: TableViewSettingsAdapter<TScope, TSettings>,
): TableViewTab<TSettings> {
  return {
    id: `${scope}-table`,
    name: "Table",
    settings: adapter.defaultSettings(scope),
  };
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
