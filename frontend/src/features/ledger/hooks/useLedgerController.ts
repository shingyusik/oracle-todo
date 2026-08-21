"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  ledgerApi,
  type AccountInput,
  type AccountCategoryInput,
  type CurrencyInput,
  type Page,
  type ReportSelection,
  type TransactionCategoryInput,
} from "@/features/ledger/api/ledger-api";
import type {
  Account,
  AccountBalance,
  AccountCategory,
  BreakdownRow,
  Currency,
  LedgerComparison,
  LedgerEntryInput,
  LedgerEntryUpdate,
  LedgerEntryView,
  LedgerSummary,
  LedgerTableOccurrence,
  LedgerTableLookups,
  LedgerTrend,
  MasterPurgePreview,
  PurgePreview,
  TransactionCategory,
  TransferInput,
  TransferUpdate,
} from "@/features/ledger/model/ledger-model";
import {
  createLedgerTableViews,
  ledgerTableViewSettingsAdapter,
  type LedgerTableScopeId,
  type LedgerTableViewsState,
} from "@/features/ledger/model/ledger-table-views";
import type { PlannerTableSettings } from "@/features/workbench/model/planner-model";
import {
  createTableViewTab,
  deleteTableViewTab,
  renameTableViewTab,
  saveTableViewTabDraft,
  selectTableViewTab,
  tableViewTabIsDirty,
  updateTableViewTabDraft,
  type TableViewTabsState,
} from "@/features/workbench/model/table-view-tabs";
import { RavenApiError, RavenTransportError } from "@/lib/raven-api";

type LedgerTableViewConfirmation =
  | {
      kind: "select" | "delete";
      target: { scope: LedgerTableScopeId };
      targetTabId: string;
    }
  | { kind: "navigate" };

type PendingLedgerViewCommand = {
  apply: (state: LedgerTableViewsState) => LedgerTableViewsState;
  persist: boolean;
};

type LoadStatus = "loading" | "loaded" | "error";
type ReportStatus = "idle" | "loading" | "loaded" | "error";
type RefreshOutcome = { ok: true } | { ok: false; error: string };
export type LedgerTablePageState = {
  items: LedgerTableOccurrence[];
  nextOffset: number | null;
  moreStatus: "idle" | "loading" | "error";
  moreError: string | null;
  generation: number;
};

export class LedgerMutationRefreshError extends Error {
  constructor() {
    super("Changes were saved, but Ledger could not refresh.");
    this.name = "LedgerMutationRefreshError";
  }
}

export type LedgerState = {
  status: LoadStatus;
  error: string | null;
  entries: LedgerEntryView[];
  currencies: Currency[];
  accountCategories: AccountCategory[];
  accounts: Account[];
  categories: TransactionCategory[];
  balances: AccountBalance[];
  tableLookups?: Record<LedgerTableScopeId, LedgerTableLookups>;
  reportStatus: ReportStatus;
  reportError: string | null;
  reportSelection: ReportSelection;
  comparison: LedgerComparison | null;
  trend: LedgerTrend | null;
  summary: LedgerSummary | null;
  accountBreakdown: BreakdownRow[];
  categoryBreakdown: BreakdownRow[];
};

export type LedgerController = {
  state: LedgerState;
  tableViewSaveError: string | null;
  retryTableViewSave(): void;
  tableViewConfirmation: LedgerTableViewConfirmation | null;
  tableTabs(scope: LedgerTableScopeId): TableViewTabsState<PlannerTableSettings>;
  tableSettings(scope: LedgerTableScopeId): PlannerTableSettings;
  tableIsDirty(scope: LedgerTableScopeId): boolean;
  tablePage?(scope: LedgerTableScopeId): LedgerTablePageState;
  ensureTable?(scope: LedgerTableScopeId): Promise<void>;
  loadMore?(scope: LedgerTableScopeId): Promise<void>;
  ensureReferenceData?(scope: LedgerTableScopeId): Promise<boolean>;
  hasReferenceData?(scope: LedgerTableScopeId): boolean;
  updateTableSettings(
    scope: LedgerTableScopeId,
    updater: (settings: PlannerTableSettings) => PlannerTableSettings,
  ): void;
  selectTableTab(scope: LedgerTableScopeId, tabId: string): void;
  saveTableTab(scope: LedgerTableScopeId): void;
  createTableTab(scope: LedgerTableScopeId, name: string): boolean;
  renameTableTab(scope: LedgerTableScopeId, tabId: string, name: string): boolean;
  requestDeleteTableTab(scope: LedgerTableScopeId, tabId: string): void;
  confirmTableViewAction(): void;
  cancelTableViewAction(): void;
  refresh(): Promise<boolean>;
  createEntry(input: LedgerEntryInput): Promise<void>;
  updateEntry(id: string, input: LedgerEntryUpdate): Promise<void>;
  transfer(input: TransferInput): Promise<void>;
  updateTransfer(id: string, input: TransferUpdate): Promise<void>;
  archive(id: string): Promise<void>;
  restore(id: string): Promise<void>;
  previewPurge(id: string): Promise<PurgePreview>;
  purge(id: string, confirmation: string): Promise<void>;
  createAccount(input: AccountInput): Promise<void>;
  updateAccount(id: string, input: Partial<AccountInput>): Promise<void>;
  archiveAccount(id: string): Promise<void>;
  restoreAccount(id: string): Promise<void>;
  previewAccountPurge(id: string): Promise<MasterPurgePreview>;
  purgeAccount(id: string, confirmation: string): Promise<void>;
  createCategory(input: TransactionCategoryInput): Promise<void>;
  updateCategory(id: string, input: Partial<TransactionCategoryInput>): Promise<void>;
  archiveCategory(id: string): Promise<void>;
  restoreCategory(id: string): Promise<void>;
  previewCategoryPurge(id: string): Promise<MasterPurgePreview>;
  purgeCategory(id: string, confirmation: string): Promise<void>;
  createCurrency(input: CurrencyInput): Promise<void>;
  updateCurrency(id: string, input: Partial<CurrencyInput>): Promise<void>;
  deactivateCurrency(id: string): Promise<void>;
  createAccountCategory(input: AccountCategoryInput): Promise<void>;
  updateAccountCategory(id: string, input: Partial<AccountCategoryInput>): Promise<void>;
  deactivateAccountCategory(id: string): Promise<void>;
  previewAccountCategoryPurge(id: string): Promise<MasterPurgePreview>;
  purgeAccountCategory(id: string, confirmation: string): Promise<void>;
  runReports(selection: ReportSelection): Promise<void>;
  retryReports(): Promise<void>;
};

const initialState: LedgerState = {
  status: "loading",
  error: null,
  entries: [],
  currencies: [],
  accountCategories: [],
  accounts: [],
  categories: [],
  balances: [],
  tableLookups: {
    "ledger.transactions": {},
    "ledger.accounts": {},
    "ledger.categories": {},
  },
  reportStatus: "idle",
  reportError: null,
  reportSelection: { period: "current_month" },
  comparison: null,
  trend: null,
  summary: null,
  accountBreakdown: [],
  categoryBreakdown: [],
};

const emptyTablePage = (): LedgerTablePageState => ({
  items: [],
  nextOffset: null,
  moreStatus: "idle",
  moreError: null,
  generation: 0,
});
const initialTablePages: Record<LedgerTableScopeId, LedgerTablePageState> = {
  "ledger.transactions": emptyTablePage(),
  "ledger.accounts": emptyTablePage(),
  "ledger.categories": emptyTablePage(),
};

let ledgerViewsWrite = Promise.resolve();
let ledgerTabIdCounter = 0;

async function loadLedgerViews(): Promise<LedgerTableViewsState | null> {
  try {
    const response = await fetch("/api/v1/preferences/ledger.views.v1");
    if (!response.ok) return null;
    return createLedgerTableViews(await response.json());
  } catch {
    return null;
  }
}

function persistLedgerViews(state: LedgerTableViewsState): Promise<void> {
  const value = Object.fromEntries(Object.entries(state).map(([scope, tabs]) => [
    scope,
    { tabs: tabs.tabs },
  ]));
  const write = ledgerViewsWrite
    .catch(() => undefined)
    .then(async () => {
      const response = await fetch("/api/v1/preferences/ledger.views.v1", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value }),
      });
      if (!response.ok) throw new Error("Ledger view preference write failed");
    });
  ledgerViewsWrite = write.catch(() => undefined);
  return write;
}

export function useLedgerController(): LedgerController {
  const [state, setState] = useState(initialState);
  const [tableViewSaveError, setTableViewSaveError] = useState<string | null>(null);
  const tableViewSaveErrorRef = useRef<string | null>(null);
  const tableViewSaveGeneration = useRef(0);
  const [tableViews, setTableViews] = useState(createLedgerTableViews);
  const [tablePages, setTablePages] = useState(initialTablePages);
  const tablePagesRef = useRef(tablePages);
  const initializedTables = useRef(new Set<LedgerTableScopeId>());
  const pendingMore = useRef(new Set<LedgerTableScopeId>());
  const referenceDataLoaded = useRef(new Set<LedgerTableScopeId>());
  const referenceDataRequests = useRef(new Map<LedgerTableScopeId, Promise<boolean>>());
  const tableViewsRef = useRef(tableViews);
  const initialTableViews = useRef(tableViews);
  const tableViewsLoaded = useRef(false);
  const pendingTableViewCommands = useRef<PendingLedgerViewCommand[]>([]);
  const refreshGeneration = useRef(0);
  const reportGeneration = useRef(0);
  const latestRefresh = useRef<Promise<RefreshOutcome> | null>(null);
  const [tableViewConfirmation, setTableViewConfirmation] = useState<
    LedgerTableViewConfirmation | null
  >(null);
  tableViewsRef.current = tableViews;
  tablePagesRef.current = tablePages;

  const loadInitialTable = useCallback(async (scope: LedgerTableScopeId) => {
    const wasInitialized = initializedTables.current.has(scope);
    initializedTables.current.add(scope);
    const previousPage = tablePagesRef.current[scope];
    const generation = previousPage.generation + 1;
    const page = { ...emptyTablePage(), moreStatus: "loading" as const, generation };
    tablePagesRef.current = { ...tablePagesRef.current, [scope]: page };
    setTablePages(tablePagesRef.current);
    try {
      const [result, lookups] = await Promise.all([
        ledgerApi.queryTable(scope, tableViewsRef.current[scope].draftSettings, 0),
        ledgerApi.tableLookups(scope),
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
        ...current,
        status: "loaded",
        error: null,
        tableLookups: { ...initialState.tableLookups!, ...current.tableLookups, [scope]: lookups },
      }));
      return true;
    } catch (error) {
      if (tablePagesRef.current[scope].generation !== generation) return true;
      const message = errorMessage(error);
      const failed = previousPage.items.length > 0
        ? { ...previousPage, moreStatus: "idle" as const, moreError: null, generation }
        : {
            ...page,
            nextOffset: 0,
            moreStatus: "error" as const,
            moreError: "Could not load rows.",
          };
      tablePagesRef.current = { ...tablePagesRef.current, [scope]: failed };
      setTablePages(tablePagesRef.current);
      setState((current) => wasInitialized
        ? { ...current, error: message }
        : { ...current, status: "error", error: message });
      return false;
    }
  }, []);

  const ensureTable = useCallback(async (scope: LedgerTableScopeId) => {
    if (initializedTables.current.has(scope)) return;
    await loadInitialTable(scope);
  }, [loadInitialTable]);

  const loadMore = useCallback(async (scope: LedgerTableScopeId) => {
    const current = tablePagesRef.current[scope];
    if (current.nextOffset === null || pendingMore.current.has(scope)) return;
    pendingMore.current.add(scope);
    const generation = current.generation;
    const offset = current.nextOffset;
    const loading = { ...current, moreStatus: "loading" as const, moreError: null };
    tablePagesRef.current = { ...tablePagesRef.current, [scope]: loading };
    setTablePages(tablePagesRef.current);
    try {
      const result = await ledgerApi.queryTable(
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
    } catch {
      if (tablePagesRef.current[scope].generation !== generation) return;
      const next = {
        ...tablePagesRef.current[scope],
        moreStatus: "idle" as const,
        moreError: "Could not load more rows.",
      };
      tablePagesRef.current = { ...tablePagesRef.current, [scope]: next };
      setTablePages(tablePagesRef.current);
    } finally {
      pendingMore.current.delete(scope);
    }
  }, []);

  const loadReferenceData = useCallback((
    scope: LedgerTableScopeId,
    force = false,
  ): Promise<boolean> => {
    if (!force && referenceDataLoaded.current.has(scope)) return Promise.resolve(true);
    const pending = referenceDataRequests.current.get(scope);
    if (pending) return pending;
    const request = (async () => {
      try {
        if (scope === "ledger.transactions") {
          const [entries, currencies, accounts, categories] = await Promise.all([
            drainPages((offset) => ledgerApi.listEntries({
              includeArchived: true, limit: 200, offset,
            })),
            drainPages((offset) => ledgerApi.listCurrencies({ limit: 200, offset })),
            drainPages((offset) => ledgerApi.listAccounts({ limit: 200, offset })),
            drainPages((offset) => ledgerApi.listTransactionCategories({ limit: 200, offset })),
          ]);
          setState((current) => ({
            ...current, error: null, entries, currencies, accounts, categories,
          }));
        } else if (scope === "ledger.accounts") {
          const [currencies, accountCategories, accounts, balances] = await Promise.all([
            drainPages((offset) => ledgerApi.listCurrencies({ limit: 200, offset })),
            drainPages((offset) => ledgerApi.listAccountCategories({ limit: 200, offset })),
            drainPages((offset) => ledgerApi.listAccounts({ limit: 200, offset })),
            drainPages((offset) => ledgerApi.listAccountBalances({ limit: 200, offset })),
          ]);
          setState((current) => ({
            ...current, error: null, currencies, accountCategories, accounts, balances,
          }));
        } else {
          const categories = await drainPages((offset) =>
            ledgerApi.listTransactionCategories({ limit: 200, offset }));
          setState((current) => ({ ...current, error: null, categories }));
        }
        referenceDataLoaded.current.add(scope);
        return true;
      } catch (error) {
        setState((current) => ({ ...current, error: errorMessage(error) }));
        return false;
      } finally {
        referenceDataRequests.current.delete(scope);
      }
    })();
    referenceDataRequests.current.set(scope, request);
    return request;
  }, []);
  const ensureReferenceData = useCallback(
    (scope: LedgerTableScopeId) => loadReferenceData(scope),
    [loadReferenceData],
  );

  function saveTableViews(next: LedgerTableViewsState) {
    const generation = ++tableViewSaveGeneration.current;
    void persistLedgerViews(next).then(
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
        const message = "Could not save Ledger views.";
        tableViewSaveErrorRef.current = message;
        setTableViewSaveError(message);
      },
    );
  }

  useEffect(() => {
    let active = true;
    void loadLedgerViews().then((stored) => {
      if (!active) return;
      let next = stored ?? initialTableViews.current;
      const persistedStates: LedgerTableViewsState[] = [];
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
        if (!current || current.kind === "navigate") return current;
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
      for (const scope of changedInitializedScopes) {
        void loadInitialTable(scope);
      }
      for (const persistedState of persistedStates) {
        saveTableViews(persistedState);
      }
    });
    return () => {
      active = false;
    };
  }, [loadInitialTable]);

  const refreshOutcome = useCallback((): Promise<RefreshOutcome> => {
    const generation = ++refreshGeneration.current;
    setState((current) => current.status === "loaded"
      ? { ...current, error: null }
      : { ...current, status: "loading", error: null });
    const request = (async (): Promise<RefreshOutcome> => {
      try {
        if (generation !== refreshGeneration.current) {
          return latestRefresh.current ?? { ok: false, error: "Ledger request failed" };
        }
        setState((current) => ({ ...current, status: "loaded", error: null }));
        return { ok: true };
      } catch (error) {
        if (generation !== refreshGeneration.current) {
          return latestRefresh.current ?? { ok: false, error: "Ledger request failed" };
        }
        const message = errorMessage(error);
        setState((current) => current.status === "loaded"
          ? { ...current, error: message }
          : { ...current, status: "error", error: message });
        return { ok: false, error: message };
      }
    })();
    latestRefresh.current = request;
    return request;
  }, []);

  const refresh = useCallback((): Promise<boolean> => {
    const generation = ++refreshGeneration.current;
    setState((current) => ({ ...current, error: null }));
    let request!: Promise<RefreshOutcome>;
    request = (async () => {
      const [references, pages] = await Promise.all([
        Promise.all(
          [...referenceDataLoaded.current].map((scope) => loadReferenceData(scope, true)),
        ),
        Promise.all([...initializedTables.current].map(loadInitialTable)),
      ]);
      if (generation !== refreshGeneration.current && latestRefresh.current !== request) {
        return latestRefresh.current ?? { ok: false, error: "Ledger request failed" };
      }
      const ok = references.every(Boolean) && pages.every(Boolean);
      return ok
        ? { ok: true }
        : { ok: false, error: "Ledger request failed" };
    })();
    latestRefresh.current = request;
    return request.then(({ ok }) => ok);
  }, [loadInitialTable, loadReferenceData]);

  useEffect(() => {
    void refreshOutcome();
  }, [refreshOutcome]);

  const mutate = useCallback(async (
    operation: () => Promise<unknown>,
    requireRefresh = false,
  ) => {
    await operation();
    const outcome = await refresh();
    if (outcome) return;
    if (requireRefresh) throw new LedgerMutationRefreshError();
  }, [refresh]);

  const runReports = useCallback(async (selection: ReportSelection) => {
    const generation = ++reportGeneration.current;
    setState((current) => ({
      ...current,
      reportStatus: "loading",
      reportError: null,
      reportSelection: selection,
    }));
    try {
      const comparison = await ledgerApi.compare(selection);
      const range = {
        from: comparison.current.range.start,
        to: comparison.current.range.end,
      };
      const [accountBreakdown, categoryBreakdown, trend] = await Promise.all([
        ledgerApi.accountReport(range),
        ledgerApi.categoryReport(range),
        ledgerApi.trend(range),
      ]);
      if (generation !== reportGeneration.current) return;
      setState((current) => ({
        ...current,
        reportStatus: "loaded",
        reportError: null,
        comparison,
        trend,
        summary: comparison.current,
        accountBreakdown,
        categoryBreakdown,
      }));
    } catch (error) {
      if (generation !== reportGeneration.current) return;
      setState((current) => ({
        ...current,
        reportStatus: "error",
        reportError: reportErrorMessage(error),
      }));
      throw error;
    }
  }, []);

  const retryReports = useCallback(
    () => runReports(state.reportSelection),
    [runReports, state.reportSelection],
  );

  function updateTableTabs(
    scope: LedgerTableScopeId,
    updater: (
      tabs: TableViewTabsState<PlannerTableSettings>,
    ) => TableViewTabsState<PlannerTableSettings> | null,
    persist = false,
  ): boolean {
    const previousSettings = JSON.stringify(tableViewsRef.current[scope].draftSettings);
    const updated = updater(tableViewsRef.current[scope]);
    if (!updated) return false;
    const apply = (state: LedgerTableViewsState): LedgerTableViewsState => {
      const nextTabs = updater(state[scope]);
      return nextTabs ? { ...state, [scope]: nextTabs } : state;
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
    scope: LedgerTableScopeId,
    tabs: TableViewTabsState<PlannerTableSettings>,
    requestedTabId: string,
  ): string {
    if (tabs.tabs.some((tab) => tab.id === requestedTabId)) return requestedTabId;
    const initialIndex = initialTableViews.current[scope].tabs.findIndex(
      (tab) => tab.id === requestedTabId,
    );
    return initialIndex >= 0
      ? tabs.tabs[initialIndex]?.id ?? requestedTabId
      : requestedTabId;
  }

  function confirmTableViewAction() {
    const confirmation = tableViewConfirmation;
    if (!confirmation || confirmation.kind === "navigate") return;
    const { scope } = confirmation.target;
    if (confirmation.kind === "delete") {
      updateTableTabs(scope, (tabs) => deleteTableViewTab(
        tabs,
        resolveTableTabId(scope, tabs, confirmation.targetTabId),
        ledgerTableViewSettingsAdapter.cloneSettings,
      ), true);
    } else {
      updateTableTabs(scope, (tabs) => selectTableViewTab(
        tabs,
        resolveTableTabId(scope, tabs, confirmation.targetTabId),
        ledgerTableViewSettingsAdapter.cloneSettings,
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
      ledgerTableViewSettingsAdapter.cloneSettings,
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
        ledgerTableViewSettingsAdapter.cloneSettings,
      ));
    },
    selectTableTab: (scope, tabId) => {
      const tabs = tableViewsRef.current[scope];
      if (tabs.activeTabId === tabId || !tabs.tabs.some((tab) => tab.id === tabId)) return;
      if (tableViewTabIsDirty(tabs, ledgerTableViewSettingsAdapter.cloneSettings)) {
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
        ledgerTableViewSettingsAdapter.cloneSettings,
      ));
    },
    saveTableTab: (scope) => {
      updateTableTabs(scope, (tabs) => saveTableViewTabDraft(
        tabs,
        ledgerTableViewSettingsAdapter.cloneSettings,
      ), true);
    },
    createTableTab: (scope, name) => updateTableTabs(scope, (tabs) =>
      createTableViewTab(
        tabs,
        `ledger-view-${Date.now()}-${++ledgerTabIdCounter}`,
        name,
        ledgerTableViewSettingsAdapter.cloneSettings,
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
    createEntry: (input) => mutate(() => ledgerApi.createEntry(input), true),
    updateEntry: (id, input) => mutate(() => ledgerApi.updateEntry(id, input)),
    transfer: (input) => mutate(() => ledgerApi.createTransfer(input), true),
    updateTransfer: (id, input) => mutate(() => ledgerApi.updateTransfer(id, input)),
    archive: (id) => mutate(() => ledgerApi.archiveEntry(id)),
    restore: (id) => mutate(() => ledgerApi.restoreEntry(id)),
    previewPurge: ledgerApi.previewEntryPurge,
    purge: (id, confirmation) =>
      mutate(() => ledgerApi.purgeEntry(id, confirmation)),
    createAccount: (input) => mutate(() => ledgerApi.createAccount(input)),
    updateAccount: (id, input) =>
      mutate(() => ledgerApi.updateAccount(id, input)),
    archiveAccount: (id) =>
      mutate(() => ledgerApi.updateAccount(id, { active: false })),
    restoreAccount: (id) =>
      mutate(() => ledgerApi.updateAccount(id, { active: true })),
    previewAccountPurge: (id) => ledgerApi.previewMasterPurge("accounts", id),
    purgeAccount: (id, confirmation) =>
      mutate(() => ledgerApi.purgeMaster("accounts", id, confirmation)),
    createCategory: (input) =>
      mutate(() => ledgerApi.createTransactionCategory(input)),
    updateCategory: (id, input) =>
      mutate(() => ledgerApi.updateTransactionCategory(id, input)),
    archiveCategory: (id) =>
      mutate(() => ledgerApi.updateTransactionCategory(id, { active: false })),
    restoreCategory: (id) =>
      mutate(() => ledgerApi.updateTransactionCategory(id, { active: true })),
    previewCategoryPurge: (id) =>
      ledgerApi.previewMasterPurge("transaction-categories", id),
    purgeCategory: (id, confirmation) =>
      mutate(() =>
        ledgerApi.purgeMaster("transaction-categories", id, confirmation)),
    createCurrency: (input) => mutate(() => ledgerApi.createCurrency(input)),
    updateCurrency: (id, input) => mutate(() => ledgerApi.updateCurrency(id, input)),
    deactivateCurrency: (id) => mutate(() => ledgerApi.updateCurrency(id, { active: false })),
    createAccountCategory: (input) => mutate(() => ledgerApi.createAccountCategory(input)),
    updateAccountCategory: (id, input) =>
      mutate(() => ledgerApi.updateAccountCategory(id, input)),
    deactivateAccountCategory: (id) =>
      mutate(() => ledgerApi.updateAccountCategory(id, { active: false })),
    previewAccountCategoryPurge: (id) =>
      ledgerApi.previewMasterPurge("account-categories", id),
    purgeAccountCategory: (id, confirmation) =>
      mutate(() => ledgerApi.purgeMaster("account-categories", id, confirmation)),
    runReports,
    retryReports,
  };
}

function dedupeOccurrences(items: LedgerTableOccurrence[]): LedgerTableOccurrence[] {
  const seen = new Set<string>();
  return items.filter(({ key }) => !seen.has(key) && Boolean(seen.add(key)));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Ledger request failed";
}

function reportErrorMessage(error: unknown): string {
  return error instanceof RavenApiError || error instanceof RavenTransportError
    ? error.message
    : "Could not load reports.";
}

async function drainPages<T>(
  load: (offset?: number) => Promise<Page<T>>,
): Promise<T[]> {
  const items: T[] = [];
  let offset: number | undefined;
  do {
    const page = await load(offset);
    items.push(...page.items);
    offset = page.nextOffset ?? undefined;
  } while (offset !== undefined);
  return items;
}
