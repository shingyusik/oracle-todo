"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  healthApi,
  type DailyMetricInput,
} from "@/features/health/api/health-api";
import type {
  DietEntry,
  DietInput,
  DietUpdate,
  EventInput,
  EventUpdate,
  HealthEvent,
  HealthTrends,
  TimelineItem,
} from "@/features/health/model/health-model";
import {
  healthTableScopeIds,
  healthTableViewSettingsAdapter,
  type HealthTableScopeId,
} from "@/features/health/model/health-table-views";
import type { PlannerTableSettings } from "@/features/workbench/model/planner-model";
import {
  buildTableViewTabsState,
  createTableViewTab,
  deleteTableViewTab,
  renameTableViewTab,
  saveTableViewTabDraft,
  selectTableViewTab,
  tableViewTabIsDirty,
  updateTableViewTabDraft,
  type TableViewTabsState,
} from "@/features/workbench/model/table-view-tabs";

type LoadStatus = "idle" | "loading" | "loaded" | "error";
export type HealthRecordKind = "diet" | "event";
type RefreshOutcome = { ok: true } | { ok: false; error: string };
type HealthTableViewsState = Record<
  HealthTableScopeId,
  TableViewTabsState<PlannerTableSettings>
>;
type HealthTableViewConfirmation = {
  kind: "select" | "delete";
  target: { scope: HealthTableScopeId };
  targetTabId: string;
};
type PendingHealthViewCommand = {
  apply: (state: HealthTableViewsState) => HealthTableViewsState;
  persist: boolean;
};

export class HealthMutationRefreshError extends Error {
  constructor() {
    super("Changes were saved, but Health could not refresh.");
    this.name = "HealthMutationRefreshError";
  }
}

export type HealthState = {
  medicationStatus: LoadStatus;
  medicationError: string | null;
  medicationEntries: HealthEvent[];
  bowelStatus: LoadStatus;
  bowelError: string | null;
  bowelEntries: HealthEvent[];
  dietStatus: LoadStatus;
  dietError: string | null;
  dietEntries: DietEntry[];
  timelineStatus: LoadStatus;
  timelineError: string | null;
  timeline: TimelineItem[];
  timelineHasMore: boolean;
  trendsStatus: LoadStatus;
  trendsError: string | null;
  trends: HealthTrends | null;
};

export type HealthController = {
  state: HealthState;
  tableViewSaveError: string | null;
  retryTableViewSave(): void;
  tableViewConfirmation: HealthTableViewConfirmation | null;
  tableTabs(scope: HealthTableScopeId): TableViewTabsState<PlannerTableSettings>;
  tableSettings(scope: HealthTableScopeId): PlannerTableSettings;
  tableIsDirty(scope: HealthTableScopeId): boolean;
  updateTableSettings(
    scope: HealthTableScopeId,
    updater: (settings: PlannerTableSettings) => PlannerTableSettings,
  ): void;
  selectTableTab(scope: HealthTableScopeId, tabId: string): void;
  saveTableTab(scope: HealthTableScopeId): void;
  createTableTab(scope: HealthTableScopeId, name: string): boolean;
  renameTableTab(scope: HealthTableScopeId, tabId: string, name: string): boolean;
  requestDeleteTableTab(scope: HealthTableScopeId, tabId: string): void;
  confirmTableViewAction(): void;
  cancelTableViewAction(): void;
  refresh(): Promise<boolean>;
  refreshMedication(): Promise<boolean>;
  refreshBowel(): Promise<boolean>;
  refreshDiet(): Promise<boolean>;
  refreshTimeline(): Promise<void>;
  loadMoreTimeline(): Promise<void>;
  refreshTrends(days?: number): Promise<void>;
  createDiet(input: DietInput, image?: Blob): Promise<void>;
  updateDiet(id: string, input: DietUpdate, image?: Blob): Promise<void>;
  archiveDiet(id: string): Promise<void>;
  createBowel(input: EventInput): Promise<void>;
  updateBowel(id: string, input: EventUpdate): Promise<void>;
  archiveBowel(id: string): Promise<void>;
  createMedication(input: EventInput): Promise<void>;
  updateMedication(id: string, input: EventUpdate): Promise<void>;
  archiveMedication(id: string): Promise<void>;
  upsertMetrics(input: DailyMetricInput[]): Promise<void>;
  archive(kind: HealthRecordKind, id: string): Promise<void>;
  restore(kind: HealthRecordKind, id: string): Promise<void>;
  purge(kind: HealthRecordKind, id: string, confirmation: string): Promise<void>;
};

const PAGE_SIZE = 100;
const DIET_PAGE_SIZE = 200;
const EVENT_PAGE_SIZE = 200;
const initialState: HealthState = {
  medicationStatus: "idle",
  medicationError: null,
  medicationEntries: [],
  bowelStatus: "idle",
  bowelError: null,
  bowelEntries: [],
  dietStatus: "idle",
  dietError: null,
  dietEntries: [],
  timelineStatus: "idle",
  timelineError: null,
  timeline: [],
  timelineHasMore: false,
  trendsStatus: "idle",
  trendsError: null,
  trends: null,
};

let healthViewsWrite = Promise.resolve();
let healthTabIdCounter = 0;

function createHealthTableViews(candidate?: unknown): HealthTableViewsState {
  const stored = isRecord(candidate) ? candidate : {};
  return Object.fromEntries(healthTableScopeIds.map((scope) => [
    scope,
    buildTableViewTabsState(scope, stored[scope], healthTableViewSettingsAdapter),
  ])) as HealthTableViewsState;
}

async function loadHealthViews(): Promise<HealthTableViewsState | null> {
  try {
    const response = await fetch("/api/v1/preferences/health.views.v1");
    if (!response.ok) return null;
    return createHealthTableViews(await response.json());
  } catch {
    return null;
  }
}

function persistHealthViews(state: HealthTableViewsState): Promise<void> {
  const value = Object.fromEntries(Object.entries(state).map(([scope, tabs]) => [
    scope,
    { tabs: tabs.tabs },
  ]));
  const write = healthViewsWrite
    .catch(() => undefined)
    .then(async () => {
      const response = await fetch("/api/v1/preferences/health.views.v1", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value }),
      });
      if (!response.ok) throw new Error("Health view preference write failed");
    });
  healthViewsWrite = write.catch(() => undefined);
  return write;
}

export function useHealthController(): HealthController {
  const [state, setState] = useState(initialState);
  const [tableViewSaveError, setTableViewSaveError] = useState<string | null>(null);
  const tableViewSaveErrorRef = useRef<string | null>(null);
  const tableViewSaveGeneration = useRef(0);
  const [tableViews, setTableViews] = useState(createHealthTableViews);
  const tableViewsRef = useRef(tableViews);
  const initialTableViews = useRef(tableViews);
  const tableViewsLoaded = useRef(false);
  const pendingTableViewCommands = useRef<PendingHealthViewCommand[]>([]);
  const [tableViewConfirmation, setTableViewConfirmation] =
    useState<HealthTableViewConfirmation | null>(null);
  const loadingPage = useRef(false);
  const dietGeneration = useRef(0);
  const inFlightDietRefresh = useRef<Promise<boolean> | null>(null);
  const latestDietOutcome = useRef<Promise<boolean> | null>(null);
  const bowelGeneration = useRef(0);
  const inFlightBowelRefresh = useRef<Promise<boolean> | null>(null);
  const latestBowelOutcome = useRef<Promise<boolean> | null>(null);
  const medicationGeneration = useRef(0);
  const inFlightMedicationRefresh = useRef<Promise<boolean> | null>(null);
  const latestMedicationOutcome = useRef<Promise<boolean> | null>(null);
  const timelineGeneration = useRef(0);
  const latestTimelineOutcome = useRef<Promise<RefreshOutcome> | null>(null);
  const trendsGeneration = useRef(0);
  const latestTrendsOutcome = useRef<Promise<RefreshOutcome> | null>(null);
  const timelineOffset = state.timeline.length;
  tableViewsRef.current = tableViews;

  function saveTableViews(next: HealthTableViewsState) {
    const generation = ++tableViewSaveGeneration.current;
    void persistHealthViews(next).then(
      () => {
        if (
          generation === tableViewSaveGeneration.current &&
          tableViewSaveErrorRef.current !== null
        ) {
          tableViewSaveErrorRef.current = null;
          setTableViewSaveError(null);
        }
      },
      () => {
        if (generation !== tableViewSaveGeneration.current) return;
        const message = "Could not save Health views.";
        tableViewSaveErrorRef.current = message;
        setTableViewSaveError(message);
      },
    );
  }

  useEffect(() => {
    let active = true;
    void loadHealthViews().then((stored) => {
      if (!active) return;
      let next = stored ?? initialTableViews.current;
      const persistedStates: HealthTableViewsState[] = [];
      for (const command of pendingTableViewCommands.current) {
        next = command.apply(next);
        if (command.persist) persistedStates.push(next);
      }
      pendingTableViewCommands.current = [];
      tableViewsLoaded.current = true;
      tableViewsRef.current = next;
      setTableViewConfirmation((current) => {
        if (!current) return current;
        const targetTabId = resolveTableTabId(
          current.target.scope,
          next[current.target.scope],
          current.targetTabId,
        );
        return targetTabId === current.targetTabId
          ? current
          : { ...current, targetTabId };
      });
      setTableViews(next);
      for (const persistedState of persistedStates) saveTableViews(persistedState);
    });
    return () => {
      active = false;
    };
  }, []);

  const startDietRefresh = useCallback((force = false): Promise<boolean> => {
    if (!force && inFlightDietRefresh.current) return inFlightDietRefresh.current;
    const generation = ++dietGeneration.current;
    setState((current) => current.dietStatus === "loaded"
      ? { ...current, dietError: null }
      : { ...current, dietStatus: "loading", dietError: null });
    const request = (async () => {
      try {
        const dietEntries: DietEntry[] = [];
        let offset = 0;
        let page: DietEntry[];
        do {
          page = await healthApi.listDiet({ limit: DIET_PAGE_SIZE, offset });
          dietEntries.push(...page);
          offset += page.length;
        } while (page.length === DIET_PAGE_SIZE);
        if (generation !== dietGeneration.current) {
          return latestDietOutcome.current ?? false;
        }
        setState((current) => ({
          ...current,
          dietStatus: "loaded",
          dietError: null,
          dietEntries,
        }));
        return true;
      } catch (error) {
        if (generation !== dietGeneration.current) {
          return latestDietOutcome.current ?? false;
        }
        setState((current) => current.dietStatus === "loaded"
          ? { ...current, dietError: errorMessage(error, "Diet request failed") }
          : {
            ...current,
            dietStatus: "error",
            dietError: errorMessage(error, "Diet request failed"),
          });
        return false;
      }
    })();
    latestDietOutcome.current = request;
    inFlightDietRefresh.current = request;
    void request.finally(() => {
      if (inFlightDietRefresh.current === request) inFlightDietRefresh.current = null;
    });
    return request;
  }, []);

  const refreshDiet = useCallback(
    () => startDietRefresh(),
    [startDietRefresh],
  );

  const startBowelRefresh = useCallback((force = false): Promise<boolean> => {
    if (!force && inFlightBowelRefresh.current) return inFlightBowelRefresh.current;
    const generation = ++bowelGeneration.current;
    setState((current) => current.bowelStatus === "loaded"
      ? { ...current, bowelError: null }
      : { ...current, bowelStatus: "loading", bowelError: null });
    const request = (async () => {
      try {
        const bowelEntries: HealthEvent[] = [];
        let offset = 0;
        let page: HealthEvent[];
        do {
          page = await healthApi.listEvents({
            category: "bowel",
            limit: EVENT_PAGE_SIZE,
            offset,
          });
          bowelEntries.push(...page);
          offset += page.length;
        } while (page.length === EVENT_PAGE_SIZE);
        if (generation !== bowelGeneration.current) {
          return latestBowelOutcome.current ?? false;
        }
        setState((current) => ({
          ...current,
          bowelStatus: "loaded",
          bowelError: null,
          bowelEntries,
        }));
        return true;
      } catch (error) {
        if (generation !== bowelGeneration.current) {
          return latestBowelOutcome.current ?? false;
        }
        setState((current) => current.bowelStatus === "loaded"
          ? { ...current, bowelError: errorMessage(error, "Bowel request failed") }
          : {
            ...current,
            bowelStatus: "error",
            bowelError: errorMessage(error, "Bowel request failed"),
          });
        return false;
      }
    })();
    latestBowelOutcome.current = request;
    inFlightBowelRefresh.current = request;
    void request.finally(() => {
      if (inFlightBowelRefresh.current === request) inFlightBowelRefresh.current = null;
    });
    return request;
  }, []);

  const startMedicationRefresh = useCallback((force = false): Promise<boolean> => {
    if (!force && inFlightMedicationRefresh.current) return inFlightMedicationRefresh.current;
    const generation = ++medicationGeneration.current;
    setState((current) => current.medicationStatus === "loaded"
      ? { ...current, medicationError: null }
      : { ...current, medicationStatus: "loading", medicationError: null });
    const request = (async () => {
      try {
        const medicationEntries: HealthEvent[] = [];
        let offset = 0;
        let page: HealthEvent[];
        do {
          page = await healthApi.listEvents({
            category: "medication",
            limit: EVENT_PAGE_SIZE,
            offset,
          });
          medicationEntries.push(...page);
          offset += page.length;
        } while (page.length === EVENT_PAGE_SIZE);
        if (generation !== medicationGeneration.current) {
          return latestMedicationOutcome.current ?? false;
        }
        setState((current) => ({
          ...current,
          medicationStatus: "loaded",
          medicationError: null,
          medicationEntries,
        }));
        return true;
      } catch (error) {
        if (generation !== medicationGeneration.current) {
          return latestMedicationOutcome.current ?? false;
        }
        setState((current) => current.medicationStatus === "loaded"
          ? { ...current, medicationError: errorMessage(error, "Medication request failed") }
          : {
            ...current,
            medicationStatus: "error",
            medicationError: errorMessage(error, "Medication request failed"),
          });
        return false;
      }
    })();
    latestMedicationOutcome.current = request;
    inFlightMedicationRefresh.current = request;
    void request.finally(() => {
      if (inFlightMedicationRefresh.current === request) inFlightMedicationRefresh.current = null;
    });
    return request;
  }, []);

  const refreshTimelineOutcome = useCallback((): Promise<RefreshOutcome> => {
    const generation = ++timelineGeneration.current;
    setState((current) => ({
      ...current,
      timelineStatus: "loading",
      timelineError: null,
    }));
    const request = (async (): Promise<RefreshOutcome> => {
      try {
        const timeline = await healthApi.timeline({
          includeArchived: true,
          limit: PAGE_SIZE,
          offset: 0,
        });
        if (generation !== timelineGeneration.current) {
          return latestTimelineOutcome.current ?? {
            ok: false,
            error: "Health timeline request failed",
          };
        }
        setState((current) => ({
          ...current,
          timelineStatus: "loaded",
          timelineError: null,
          timeline,
          timelineHasMore: timeline.length === PAGE_SIZE,
        }));
        return { ok: true };
      } catch (error) {
        const message = errorMessage(error, "Health timeline request failed");
        if (generation !== timelineGeneration.current) {
          return latestTimelineOutcome.current ?? { ok: false, error: message };
        }
        setState((current) => ({
          ...current,
          timelineStatus: current.timeline.length === 0 ? "error" : "loaded",
          timelineError: message,
        }));
        return { ok: false, error: message };
      }
    })();
    latestTimelineOutcome.current = request;
    return request;
  }, []);

  const refreshTimeline = useCallback(async () => {
    await refreshTimelineOutcome();
  }, [refreshTimelineOutcome]);

  const refreshTrendsOutcome = useCallback((days = 30): Promise<RefreshOutcome> => {
    const generation = ++trendsGeneration.current;
    setState((current) => ({
      ...current,
      trendsStatus: "loading",
      trendsError: null,
    }));
    const request = (async (): Promise<RefreshOutcome> => {
      try {
        const trends = await healthApi.trends(days);
        if (generation !== trendsGeneration.current) {
          return latestTrendsOutcome.current ?? {
            ok: false,
            error: "Health trends request failed",
          };
        }
        setState((current) => ({
          ...current,
          trendsStatus: "loaded",
          trendsError: null,
          trends,
        }));
        return { ok: true };
      } catch (error) {
        const message = errorMessage(error, "Health trends request failed");
        if (generation !== trendsGeneration.current) {
          return latestTrendsOutcome.current ?? { ok: false, error: message };
        }
        setState((current) => ({
          ...current,
          trendsStatus: "error",
          trendsError: message,
        }));
        return { ok: false, error: message };
      }
    })();
    latestTrendsOutcome.current = request;
    return request;
  }, []);

  const refreshTrends = useCallback(async (days = 30) => {
    await refreshTrendsOutcome(days);
  }, [refreshTrendsOutcome]);

  useEffect(() => {
    void refreshDiet();
    void startBowelRefresh();
    void startMedicationRefresh();
    void refreshTimeline();
    void refreshTrends();
  }, [refreshDiet, refreshTimeline, refreshTrends, startBowelRefresh, startMedicationRefresh]);

  const loadMoreTimeline = useCallback(async () => {
    if (loadingPage.current) return;
    loadingPage.current = true;
    const generation = timelineGeneration.current;
    setState((current) => ({ ...current, timelineError: null }));
    try {
      const page = await healthApi.timeline({
        includeArchived: true,
        limit: PAGE_SIZE,
        offset: timelineOffset,
      });
      if (generation !== timelineGeneration.current) return;
      setState((current) => ({
        ...current,
        timeline: appendUnique(current.timeline, page),
        timelineHasMore: page.length === PAGE_SIZE,
      }));
    } catch (error) {
      if (generation !== timelineGeneration.current) return;
      setState((current) => ({
        ...current,
        timelineError: errorMessage(error, "More health records could not be loaded"),
      }));
    } finally {
      loadingPage.current = false;
    }
  }, [timelineOffset]);

  const refreshDietReads = useCallback(async (forceDiet = false) => {
    const [dietOk, timeline, trend] = await Promise.all([
      startDietRefresh(forceDiet),
      refreshTimelineOutcome(),
      refreshTrendsOutcome(),
    ]);
    return dietOk && timeline.ok && trend.ok;
  }, [startDietRefresh, refreshTimelineOutcome, refreshTrendsOutcome]);

  const refreshBowelReads = useCallback(async (forceBowel = false) => {
    const [bowelOk, timeline, trend] = await Promise.all([
      startBowelRefresh(forceBowel),
      refreshTimelineOutcome(),
      refreshTrendsOutcome(),
    ]);
    return bowelOk && timeline.ok && trend.ok;
  }, [startBowelRefresh, refreshTimelineOutcome, refreshTrendsOutcome]);

  const refreshMedicationRelated = useCallback(async (force = false) => {
    const [medicationOk, timeline, trends] = await Promise.all([
      startMedicationRefresh(force),
      refreshTimelineOutcome(),
      refreshTrendsOutcome(),
    ]);
    return medicationOk && timeline.ok && trends.ok;
  }, [startMedicationRefresh, refreshTimelineOutcome, refreshTrendsOutcome]);

  const refresh = useCallback(async () => {
    const [dietOk, bowelOk, medicationOk, timeline, trend] = await Promise.all([
      startDietRefresh(),
      startBowelRefresh(),
      startMedicationRefresh(),
      refreshTimelineOutcome(),
      refreshTrendsOutcome(),
    ]);
    return dietOk && bowelOk && medicationOk && timeline.ok && trend.ok;
  }, [startDietRefresh, startBowelRefresh, startMedicationRefresh, refreshTimelineOutcome, refreshTrendsOutcome]);

  const refreshMedication = useCallback(
    () => refreshMedicationRelated(),
    [refreshMedicationRelated],
  );

  const refreshBowel = useCallback(
    () => refreshBowelReads(),
    [refreshBowelReads],
  );

  const refreshAfterMutation = useCallback(async () => {
    if (!await refreshDietReads(true)) throw new HealthMutationRefreshError();
  }, [refreshDietReads]);

  const refreshAfterBowelMutation = useCallback(async () => {
    if (!await refreshBowelReads(true)) throw new HealthMutationRefreshError();
  }, [refreshBowelReads]);

  const refreshAfterMedicationMutation = useCallback(async () => {
    if (!await refreshMedicationRelated(true)) throw new HealthMutationRefreshError();
  }, [refreshMedicationRelated]);

  const refreshAfterEventMutation = useCallback(async () => {
    const [timeline, trend] = await Promise.all([
      refreshTimelineOutcome(),
      refreshTrendsOutcome(),
    ]);
    if (!timeline.ok || !trend.ok) throw new HealthMutationRefreshError();
  }, [refreshTimelineOutcome, refreshTrendsOutcome]);

  async function mutate(
    operation: () => Promise<unknown>,
    refreshMutation = refreshAfterMutation,
  ) {
    await operation();
    await refreshMutation();
  }

  function updateTableTabs(
    scope: HealthTableScopeId,
    updater: (
      tabs: TableViewTabsState<PlannerTableSettings>,
    ) => TableViewTabsState<PlannerTableSettings> | null,
    persist = false,
  ): boolean {
    const updated = updater(tableViewsRef.current[scope]);
    if (!updated) return false;
    const apply = (views: HealthTableViewsState): HealthTableViewsState => {
      const nextTabs = updater(views[scope]);
      return nextTabs ? { ...views, [scope]: nextTabs } : views;
    };
    const next = { ...tableViewsRef.current, [scope]: updated };
    tableViewsRef.current = next;
    setTableViews(next);
    if (tableViewsLoaded.current) {
      if (persist) saveTableViews(next);
    } else {
      pendingTableViewCommands.current.push({ apply, persist });
    }
    return true;
  }

  function resolveTableTabId(
    scope: HealthTableScopeId,
    tabs: TableViewTabsState<PlannerTableSettings>,
    requestedTabId: string,
  ): string {
    if (tabs.tabs.some((tab) => tab.id === requestedTabId)) return requestedTabId;
    const initialIndex = initialTableViews.current[scope].tabs.findIndex(
      (tab) => tab.id === requestedTabId,
    );
    return initialIndex >= 0 ? tabs.tabs[initialIndex]?.id ?? requestedTabId : requestedTabId;
  }

  function confirmTableViewAction() {
    const confirmation = tableViewConfirmation;
    if (!confirmation) return;
    const { scope } = confirmation.target;
    if (confirmation.kind === "delete") {
      updateTableTabs(scope, (tabs) => deleteTableViewTab(
        tabs,
        resolveTableTabId(scope, tabs, confirmation.targetTabId),
        healthTableViewSettingsAdapter.cloneSettings,
      ), true);
    } else {
      updateTableTabs(scope, (tabs) => selectTableViewTab(
        tabs,
        resolveTableTabId(scope, tabs, confirmation.targetTabId),
        healthTableViewSettingsAdapter.cloneSettings,
      ));
    }
    setTableViewConfirmation(null);
  }

  return {
    state,
    tableViewSaveError,
    retryTableViewSave: () => saveTableViews(tableViewsRef.current),
    tableViewConfirmation,
    tableTabs: (scope) => tableViews[scope],
    tableSettings: (scope) => tableViews[scope].draftSettings,
    tableIsDirty: (scope) => tableViewTabIsDirty(
      tableViews[scope],
      healthTableViewSettingsAdapter.cloneSettings,
    ),
    updateTableSettings: (scope, updater) => {
      updateTableTabs(scope, (tabs) => updateTableViewTabDraft(
        tabs,
        updater(tabs.draftSettings),
        healthTableViewSettingsAdapter.cloneSettings,
      ));
    },
    selectTableTab: (scope, tabId) => {
      const tabs = tableViewsRef.current[scope];
      if (tabs.activeTabId === tabId || !tabs.tabs.some((tab) => tab.id === tabId)) return;
      if (tableViewTabIsDirty(tabs, healthTableViewSettingsAdapter.cloneSettings)) {
        setTableViewConfirmation({
          kind: "select",
          target: { scope },
          targetTabId: tabId,
        });
        return;
      }
      updateTableTabs(scope, (current) => selectTableViewTab(
        current,
        resolveTableTabId(scope, current, tabId),
        healthTableViewSettingsAdapter.cloneSettings,
      ));
    },
    saveTableTab: (scope) => updateTableTabs(scope, (tabs) => saveTableViewTabDraft(
      tabs,
      healthTableViewSettingsAdapter.cloneSettings,
    ), true),
    createTableTab: (scope, name) => updateTableTabs(scope, (tabs) => createTableViewTab(
      tabs,
      `health-view-${Date.now()}-${++healthTabIdCounter}`,
      name,
      healthTableViewSettingsAdapter.cloneSettings,
    ), true),
    renameTableTab: (scope, tabId, name) => updateTableTabs(
      scope,
      (tabs) => renameTableViewTab(
        tabs,
        resolveTableTabId(scope, tabs, tabId),
        name,
      ),
      true,
    ),
    requestDeleteTableTab: (scope, tabId) => {
      const tabs = tableViewsRef.current[scope];
      if (tabs.tabs.length <= 1 || !tabs.tabs.some((tab) => tab.id === tabId)) return;
      setTableViewConfirmation({ kind: "delete", target: { scope }, targetTabId: tabId });
    },
    confirmTableViewAction,
    cancelTableViewAction: () => setTableViewConfirmation(null),
    refresh,
    refreshMedication,
    refreshBowel,
    refreshDiet,
    refreshTimeline,
    loadMoreTimeline,
    refreshTrends,
    createDiet: (input, image) =>
      mutate(() => image
        ? healthApi.createDietWithImage({ image, metadata: input })
        : healthApi.createDiet(input)),
    updateDiet: (id, input, image) => mutate(() => image
      ? healthApi.updateDietWithImage(id, { image, metadata: input })
      : healthApi.updateDiet(id, input)),
    archiveDiet: (id) => mutate(() => healthApi.archiveDiet(id)),
    createBowel: (input) => mutate(() => healthApi.createEvent(input), refreshAfterBowelMutation),
    updateBowel: (id, input) => mutate(
      () => healthApi.updateEvent(id, input),
      refreshAfterBowelMutation,
    ),
    archiveBowel: (id) => mutate(() => healthApi.archiveEvent(id), refreshAfterBowelMutation),
    createMedication: (input) => mutate(
      () => healthApi.createEvent(input),
      refreshAfterMedicationMutation,
    ),
    updateMedication: (id, input) => mutate(
      () => healthApi.updateEvent(id, input),
      refreshAfterMedicationMutation,
    ),
    archiveMedication: (id) => mutate(
      () => healthApi.archiveEvent(id),
      refreshAfterMedicationMutation,
    ),
    upsertMetrics: (input) => mutate(() => healthApi.upsertDailyMetrics(input), refreshAfterEventMutation),
    archive: (kind, id) => mutate(() =>
      kind === "diet" ? healthApi.archiveDiet(id) : healthApi.archiveEvent(id),
    kind === "diet" ? refreshAfterMutation : refreshAfterEventMutation),
    restore: (kind, id) => mutate(() =>
      kind === "diet" ? healthApi.restoreDiet(id) : healthApi.restoreEvent(id),
    kind === "diet" ? refreshAfterMutation : refreshAfterEventMutation),
    purge: (kind, id, confirmation) => mutate(() =>
      kind === "diet"
        ? healthApi.purgeDiet(id, confirmation)
        : healthApi.purgeEvent(id, confirmation),
    kind === "diet" ? refreshAfterMutation : refreshAfterEventMutation),
  };
}

function appendUnique(
  current: TimelineItem[],
  page: TimelineItem[],
): TimelineItem[] {
  const ids = new Set(current.map(timelineKey));
  return current.concat(page.filter((item) => !ids.has(timelineKey(item))));
}

function timelineKey(item: TimelineItem): string {
  return `${item.kind}:${item.record.id}`;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
