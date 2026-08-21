"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  healthApi,
  type DailyMetricInput,
  type DailyMetricsMutation,
} from "@/features/health/api/health-api";
import type {
  DietEntry,
  DietInput,
  DietUpdate,
  EventInput,
  EventUpdate,
  HealthEvent,
  HealthTableLookups,
  HealthTableOccurrence,
} from "@/features/health/model/health-model";
import {
  resolveHealthReportRange,
  type HealthReport,
  type HealthReportSelection,
} from "@/features/health/model/health-reports";
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

export type LoadStatus = "idle" | "loading" | "loaded" | "error";
type InFlightReport = {
  generation: number;
  raw: Promise<HealthReport>;
  outcome: Promise<boolean>;
};
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
export type HealthTablePageState = {
  items: HealthTableOccurrence[];
  nextOffset: number | null;
  moreStatus: "idle" | "loading" | "error";
  moreError: string | null;
  generation: number;
};

export class HealthMutationRefreshError extends Error {
  constructor() {
    super("Changes were saved, but Health could not refresh.");
    this.name = "HealthMutationRefreshError";
  }
}

export type HealthState = {
  metricsStatus: LoadStatus;
  metricsError: string | null;
  metricsEntries: HealthEvent[];
  medicationStatus: LoadStatus;
  medicationError: string | null;
  medicationEntries: HealthEvent[];
  bowelStatus: LoadStatus;
  bowelError: string | null;
  bowelEntries: HealthEvent[];
  dietStatus: LoadStatus;
  dietError: string | null;
  dietEntries: DietEntry[];
  reportStatus: LoadStatus;
  reportError: string | null;
  report: HealthReport | null;
  reportSelection: HealthReportSelection;
  tableLookups?: Record<HealthTableScopeId, HealthTableLookups>;
};

export type HealthController = {
  state: HealthState;
  tableViewSaveError: string | null;
  retryTableViewSave(): void;
  tableViewConfirmation: HealthTableViewConfirmation | null;
  tableTabs(scope: HealthTableScopeId): TableViewTabsState<PlannerTableSettings>;
  tableSettings(scope: HealthTableScopeId): PlannerTableSettings;
  tableIsDirty(scope: HealthTableScopeId): boolean;
  tablePage?(scope: HealthTableScopeId): HealthTablePageState;
  ensureTable?(scope: HealthTableScopeId): Promise<void>;
  loadMore?(scope: HealthTableScopeId): Promise<void>;
  ensureReferenceData?(scope: HealthTableScopeId): Promise<boolean>;
  hasReferenceData?(scope: HealthTableScopeId): boolean;
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
  refreshMetrics(): Promise<boolean>;
  refreshMedication(): Promise<boolean>;
  refreshBowel(): Promise<boolean>;
  refreshDiet(): Promise<boolean>;
  runReports(selection: HealthReportSelection): Promise<boolean>;
  retryReports(): Promise<boolean>;
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
  saveMetrics(input: DailyMetricsMutation): Promise<void>;
};

const DIET_PAGE_SIZE = 200;
const EVENT_PAGE_SIZE = 200;
const initialState: HealthState = {
  metricsStatus: "idle",
  metricsError: null,
  metricsEntries: [],
  medicationStatus: "idle",
  medicationError: null,
  medicationEntries: [],
  bowelStatus: "idle",
  bowelError: null,
  bowelEntries: [],
  dietStatus: "idle",
  dietError: null,
  dietEntries: [],
  reportStatus: "idle",
  reportError: null,
  report: null,
  reportSelection: { preset: 30 },
  tableLookups: {
    "health.diet": {},
    "health.bowel": {},
    "health.medication": {},
    "health.metrics": {},
  },
};

const emptyTablePage = (): HealthTablePageState => ({
  items: [], nextOffset: null, moreStatus: "idle", moreError: null, generation: 0,
});
const initialTablePages: Record<HealthTableScopeId, HealthTablePageState> = {
  "health.diet": emptyTablePage(),
  "health.bowel": emptyTablePage(),
  "health.medication": emptyTablePage(),
  "health.metrics": emptyTablePage(),
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
  const [tablePages, setTablePages] = useState(initialTablePages);
  const tablePagesRef = useRef(tablePages);
  const initializedTables = useRef(new Set<HealthTableScopeId>());
  const pendingMore = useRef(new Set<HealthTableScopeId>());
  const referenceDataLoaded = useRef(new Set<HealthTableScopeId>());
  const referenceDataRequests = useRef(new Map<HealthTableScopeId, Promise<boolean>>());
  const tableViewsRef = useRef(tableViews);
  const initialTableViews = useRef(tableViews);
  const tableViewsLoaded = useRef(false);
  const pendingTableViewCommands = useRef<PendingHealthViewCommand[]>([]);
  const [tableViewConfirmation, setTableViewConfirmation] =
    useState<HealthTableViewConfirmation | null>(null);
  const mounted = useRef(true);
  const dietGeneration = useRef(0);
  const inFlightDietRefresh = useRef<Promise<boolean> | null>(null);
  const latestDietOutcome = useRef<Promise<boolean> | null>(null);
  const bowelGeneration = useRef(0);
  const inFlightBowelRefresh = useRef<Promise<boolean> | null>(null);
  const latestBowelOutcome = useRef<Promise<boolean> | null>(null);
  const medicationGeneration = useRef(0);
  const inFlightMedicationRefresh = useRef<Promise<boolean> | null>(null);
  const latestMedicationOutcome = useRef<Promise<boolean> | null>(null);
  const metricsGeneration = useRef(0);
  const inFlightMetricsRefresh = useRef<Promise<boolean> | null>(null);
  const latestMetricsOutcome = useRef<Promise<boolean> | null>(null);
  const reportGeneration = useRef(0);
  const inFlightReports = useRef(new Map<string, InFlightReport>());
  const latestReportOutcome = useRef<Promise<boolean> | null>(null);
  const reportSelection = useRef<HealthReportSelection>({ preset: 30 });
  tableViewsRef.current = tableViews;
  tablePagesRef.current = tablePages;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const loadInitialTable = useCallback(async (scope: HealthTableScopeId) => {
    const wasInitialized = initializedTables.current.has(scope);
    initializedTables.current.add(scope);
    const previousPage = tablePagesRef.current[scope];
    const generation = previousPage.generation + 1;
    const page = { ...emptyTablePage(), moreStatus: "loading" as const, generation };
    tablePagesRef.current = { ...tablePagesRef.current, [scope]: page };
    setTablePages(tablePagesRef.current);
    setState((current) => setScopeLoadState(current, scope, wasInitialized ? undefined : "loading"));
    try {
      const [result, lookups] = await Promise.all([
        healthApi.queryTable(scope, tableViewsRef.current[scope].draftSettings, 0),
        healthApi.tableLookups(scope),
      ]);
      if (tablePagesRef.current[scope].generation !== generation) return true;
      const next = {
        ...page,
        items: dedupeOccurrences(result.items),
        nextOffset: result.nextOffset,
        moreStatus: "idle" as const,
      };
      tablePagesRef.current = { ...tablePagesRef.current, [scope]: next };
      setTablePages(tablePagesRef.current);
      setState((current) => ({
        ...setScopeLoadState(current, scope, "loaded"),
        tableLookups: { ...initialState.tableLookups!, ...current.tableLookups, [scope]: lookups },
      }));
      return true;
    } catch {
      if (tablePagesRef.current[scope].generation !== generation) return true;
      const failed = {
        ...page,
        items: previousPage.items,
        nextOffset: 0,
        moreStatus: "error" as const,
        moreError: "Could not load rows.",
      };
      tablePagesRef.current = { ...tablePagesRef.current, [scope]: failed };
      setTablePages(tablePagesRef.current);
      setState((current) => setScopeLoadState(
        current,
        scope,
        wasInitialized ? undefined : "error",
        scopeError(scope),
      ));
      return false;
    }
  }, []);

  const ensureTable = useCallback(async (scope: HealthTableScopeId) => {
    if (initializedTables.current.has(scope)) return;
    await loadInitialTable(scope);
  }, [loadInitialTable]);

  const loadMore = useCallback(async (scope: HealthTableScopeId) => {
    const current = tablePagesRef.current[scope];
    if (current.nextOffset === null || pendingMore.current.has(scope)) return;
    pendingMore.current.add(scope);
    const generation = current.generation;
    const offset = current.nextOffset;
    const loading = { ...current, moreStatus: "loading" as const, moreError: null };
    tablePagesRef.current = { ...tablePagesRef.current, [scope]: loading };
    setTablePages(tablePagesRef.current);
    try {
      const result = await healthApi.queryTable(
        scope,
        tableViewsRef.current[scope].draftSettings,
        offset,
      );
      if (tablePagesRef.current[scope].generation !== generation) return;
      const next = {
        ...tablePagesRef.current[scope],
        items: dedupeOccurrences(offset === 0 ? result.items : [...current.items, ...result.items]),
        nextOffset: result.nextOffset,
        moreStatus: "idle" as const,
        moreError: null,
      };
      tablePagesRef.current = { ...tablePagesRef.current, [scope]: next };
      setTablePages(tablePagesRef.current);
      setState((state) => setScopeLoadState(state, scope, "loaded"));
    } catch {
      if (tablePagesRef.current[scope].generation !== generation) return;
      const next = {
        ...tablePagesRef.current[scope],
        moreStatus: "idle" as const,
        moreError: offset === 0 ? "Could not load rows." : "Could not load more rows.",
      };
      tablePagesRef.current = { ...tablePagesRef.current, [scope]: next };
      setTablePages(tablePagesRef.current);
    } finally {
      pendingMore.current.delete(scope);
    }
  }, []);

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
      const changedInitializedScopes = [...initializedTables.current].filter((scope) =>
        JSON.stringify(tableViewsRef.current[scope].draftSettings)
          !== JSON.stringify(next[scope].draftSettings));
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
      for (const scope of changedInitializedScopes) void loadInitialTable(scope);
      for (const persistedState of persistedStates) saveTableViews(persistedState);
    });
    return () => {
      active = false;
    };
  }, [loadInitialTable]);

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

  const startMetricsRefresh = useCallback((force = false): Promise<boolean> => {
    if (!force && inFlightMetricsRefresh.current) return inFlightMetricsRefresh.current;
    const generation = ++metricsGeneration.current;
    setState((current) => current.metricsStatus === "loaded"
      ? { ...current, metricsError: null }
      : { ...current, metricsStatus: "loading", metricsError: null });
    const request = (async () => {
      try {
        const metricsEntries: HealthEvent[] = [];
        let offset = 0;
        let page: HealthEvent[];
        do {
          page = await healthApi.listEvents({
            dailyOnly: true,
            limit: EVENT_PAGE_SIZE,
            offset,
          });
          metricsEntries.push(...page);
          offset += page.length;
        } while (page.length === EVENT_PAGE_SIZE);
        if (generation !== metricsGeneration.current) {
          return latestMetricsOutcome.current ?? false;
        }
        setState((current) => ({
          ...current,
          metricsStatus: "loaded",
          metricsError: null,
          metricsEntries,
        }));
        return true;
      } catch (error) {
        if (generation !== metricsGeneration.current) {
          return latestMetricsOutcome.current ?? false;
        }
        setState((current) => current.metricsStatus === "loaded"
          ? { ...current, metricsError: errorMessage(error, "Metrics request failed") }
          : {
            ...current,
            metricsStatus: "error",
            metricsError: errorMessage(error, "Metrics request failed"),
          });
        return false;
      }
    })();
    latestMetricsOutcome.current = request;
    inFlightMetricsRefresh.current = request;
    void request.finally(() => {
      if (inFlightMetricsRefresh.current === request) inFlightMetricsRefresh.current = null;
    });
    return request;
  }, []);

  const loadReferenceData = useCallback((
    scope: HealthTableScopeId,
    force = false,
  ): Promise<boolean> => {
    if (!force && referenceDataLoaded.current.has(scope)) return Promise.resolve(true);
    const pending = referenceDataRequests.current.get(scope);
    if (pending) return pending;
    const load = scope === "health.diet"
      ? startDietRefresh
      : scope === "health.bowel"
        ? startBowelRefresh
        : scope === "health.medication"
          ? startMedicationRefresh
          : startMetricsRefresh;
    const request = load(force).then((ok) => {
      if (ok) referenceDataLoaded.current.add(scope);
      return ok;
    }).finally(() => referenceDataRequests.current.delete(scope));
    referenceDataRequests.current.set(scope, request);
    return request;
  }, [startBowelRefresh, startDietRefresh, startMedicationRefresh, startMetricsRefresh]);

  const ensureReferenceData = useCallback(
    (scope: HealthTableScopeId) => loadReferenceData(scope),
    [loadReferenceData],
  );

  const refreshScope = useCallback(async (
    scope: HealthTableScopeId,
    initialize = false,
  ) => {
    const requests: Promise<boolean>[] = [];
    if (initialize || initializedTables.current.has(scope)) requests.push(loadInitialTable(scope));
    if (referenceDataLoaded.current.has(scope)) requests.push(loadReferenceData(scope, true));
    if (requests.length === 0) requests.push(loadInitialTable(scope));
    const outcomes = await Promise.all(requests);
    return outcomes.every(Boolean);
  }, [loadInitialTable, loadReferenceData]);

  const refresh = useCallback(async () => {
    const scopes = new Set([...initializedTables.current, ...referenceDataLoaded.current]);
    const outcomes = await Promise.all([...scopes].map((scope) => refreshScope(scope)));
    return outcomes.every(Boolean);
  }, [refreshScope]);

  const runReports = useCallback((selection: HealthReportSelection): Promise<boolean> => {
    reportSelection.current = selection;
    const resolved = resolveHealthReportRange(selection, new Date());
    if (!resolved.ok) {
      ++reportGeneration.current;
      const outcome = Promise.resolve(false);
      latestReportOutcome.current = outcome;
      if (mounted.current) {
        setState((current) => ({
          ...current,
          reportStatus: "error",
          reportError: "Choose a valid report date range.",
          reportSelection: selection,
        }));
      }
      return outcome;
    }

    const { start, end } = resolved.range;
    const key = `${start}\u0000${end}`;
    const existing = inFlightReports.current.get(key);
    if (existing) {
      if (mounted.current) {
        setState((current) => ({
          ...current,
          reportStatus: "loading",
          reportError: null,
          reportSelection: selection,
        }));
      }
      if (existing.generation === reportGeneration.current) return existing.outcome;
      const generation = ++reportGeneration.current;
      const outcome = settleReport(existing.raw, generation);
      inFlightReports.current.set(key, { ...existing, generation, outcome });
      latestReportOutcome.current = outcome;
      return outcome;
    }

    const generation = ++reportGeneration.current;
    if (mounted.current) {
      setState((current) => ({
        ...current,
        reportStatus: "loading",
        reportError: null,
        reportSelection: selection,
      }));
    }
    const raw = healthApi.reports({ from: start, to: end });
    const request = settleReport(raw, generation);
    latestReportOutcome.current = request;
    inFlightReports.current.set(key, { generation, raw, outcome: request });
    const clear = () => {
      if (inFlightReports.current.get(key)?.raw === raw) inFlightReports.current.delete(key);
    };
    void raw.then(clear, clear);
    return request;

    async function settleReport(
      rawReport: Promise<HealthReport>,
      requestGeneration: number,
    ): Promise<boolean> {
      try {
        const report = await rawReport;
        if (requestGeneration !== reportGeneration.current) {
          return latestReportOutcome.current ?? false;
        }
        if (mounted.current) {
          setState((current) => ({
            ...current,
            reportStatus: "loaded",
            reportError: null,
            report,
            reportSelection: reportSelection.current,
          }));
        }
        return true;
      } catch (error) {
        if (requestGeneration !== reportGeneration.current) {
          return latestReportOutcome.current ?? false;
        }
        if (mounted.current) {
          setState((current) => ({
            ...current,
            reportStatus: "error",
            reportError: errorMessage(error, "Health reports request failed"),
            reportSelection: reportSelection.current,
          }));
        }
        return false;
      }
    }
  }, []);

  const retryReports = useCallback(
    () => runReports(reportSelection.current),
    [runReports],
  );

  const refreshMetrics = useCallback(() => refreshScope("health.metrics"), [refreshScope]);
  const refreshMedication = useCallback(
    () => refreshScope("health.medication"),
    [refreshScope],
  );
  const refreshBowel = useCallback(() => refreshScope("health.bowel"), [refreshScope]);
  const refreshDiet = useCallback(() => refreshScope("health.diet"), [refreshScope]);

  const refreshAfterMutation = useCallback(async () => {
    if (!await refreshScope("health.diet", true)) throw new HealthMutationRefreshError();
  }, [refreshScope]);

  const refreshAfterBowelMutation = useCallback(async () => {
    if (!await refreshScope("health.bowel", true)) throw new HealthMutationRefreshError();
  }, [refreshScope]);

  const refreshAfterMedicationMutation = useCallback(async () => {
    if (!await refreshScope("health.medication", true)) throw new HealthMutationRefreshError();
  }, [refreshScope]);

  const refreshAfterMetricsMutation = useCallback(async () => {
    if (!await refreshScope("health.metrics", true)) throw new HealthMutationRefreshError();
  }, [refreshScope]);

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
    const previousSettings = JSON.stringify(tableViewsRef.current[scope].draftSettings);
    const updated = updater(tableViewsRef.current[scope]);
    if (!updated) return false;
    const apply = (views: HealthTableViewsState): HealthTableViewsState => {
      const nextTabs = updater(views[scope]);
      return nextTabs ? { ...views, [scope]: nextTabs } : views;
    };
    const next = { ...tableViewsRef.current, [scope]: updated };
    tableViewsRef.current = next;
    setTableViews(next);
    if (
      initializedTables.current.has(scope)
      && previousSettings !== JSON.stringify(updated.draftSettings)
    ) {
      void loadInitialTable(scope);
    }
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
    tablePage: (scope) => tablePages[scope],
    ensureTable,
    loadMore,
    ensureReferenceData,
    hasReferenceData: (scope) => referenceDataLoaded.current.has(scope),
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
    refreshMetrics,
    refreshMedication,
    refreshBowel,
    refreshDiet,
    runReports,
    retryReports,
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
    upsertMetrics: (input) => mutate(
      () => healthApi.upsertDailyMetrics(input),
      refreshAfterMetricsMutation,
    ),
    saveMetrics: (input) => mutate(
      () => healthApi.saveDailyMetrics(input),
      refreshAfterMetricsMutation,
    ),
  };
}

function errorMessage(error: unknown, fallback: string): string {
  void error;
  return fallback;
}

function dedupeOccurrences(items: HealthTableOccurrence[]): HealthTableOccurrence[] {
  const seen = new Set<string>();
  return items.filter(({ key }) => !seen.has(key) && Boolean(seen.add(key)));
}

function scopeError(scope: HealthTableScopeId): string {
  if (scope === "health.diet") return "Diet request failed";
  if (scope === "health.bowel") return "Bowel request failed";
  if (scope === "health.medication") return "Medication request failed";
  return "Metrics request failed";
}

function setScopeLoadState(
  state: HealthState,
  scope: HealthTableScopeId,
  status?: LoadStatus,
  error?: string,
): HealthState {
  const nextError = error ?? (status === "loaded" ? null : undefined);
  if (scope === "health.diet") return {
    ...state,
    ...(status === undefined ? {} : { dietStatus: status }),
    ...(nextError === undefined ? {} : { dietError: nextError }),
  };
  if (scope === "health.bowel") return {
    ...state,
    ...(status === undefined ? {} : { bowelStatus: status }),
    ...(nextError === undefined ? {} : { bowelError: nextError }),
  };
  if (scope === "health.medication") return {
    ...state,
    ...(status === undefined ? {} : { medicationStatus: status }),
    ...(nextError === undefined ? {} : { medicationError: nextError }),
  };
  return {
    ...state,
    ...(status === undefined ? {} : { metricsStatus: status }),
    ...(nextError === undefined ? {} : { metricsError: nextError }),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
