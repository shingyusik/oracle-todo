"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  ledgerApi,
  type AccountInput,
  type Page,
  type ReportRangeInput,
  type TransactionCategoryInput,
} from "@/features/ledger/api/ledger-api";
import type {
  Account,
  AccountBalance,
  AccountCategory,
  BreakdownRow,
  Currency,
  LedgerBriefing,
  LedgerEntryInput,
  LedgerEntryUpdate,
  LedgerEntryView,
  LedgerSummary,
  MasterPurgePreview,
  PurgePreview,
  TransactionCategory,
  TransferInput,
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
  reportStatus: ReportStatus;
  reportError: string | null;
  summary: LedgerSummary | null;
  accountBreakdown: BreakdownRow[];
  categoryBreakdown: BreakdownRow[];
  briefing: LedgerBriefing | null;
};

export type LedgerController = {
  state: LedgerState;
  tableViewSaveError: string | null;
  retryTableViewSave(): void;
  tableViewConfirmation: LedgerTableViewConfirmation | null;
  tableTabs(scope: LedgerTableScopeId): TableViewTabsState<PlannerTableSettings>;
  tableSettings(scope: LedgerTableScopeId): PlannerTableSettings;
  tableIsDirty(scope: LedgerTableScopeId): boolean;
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
  runReports(range: ReportRangeInput): Promise<void>;
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
  reportStatus: "idle",
  reportError: null,
  summary: null,
  accountBreakdown: [],
  categoryBreakdown: [],
  briefing: null,
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
  const tableViewsRef = useRef(tableViews);
  const initialTableViews = useRef(tableViews);
  const tableViewsLoaded = useRef(false);
  const pendingTableViewCommands = useRef<PendingLedgerViewCommand[]>([]);
  const refreshGeneration = useRef(0);
  const latestRefresh = useRef<Promise<RefreshOutcome> | null>(null);
  const [tableViewConfirmation, setTableViewConfirmation] = useState<
    LedgerTableViewConfirmation | null
  >(null);
  tableViewsRef.current = tableViews;

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
      for (const persistedState of persistedStates) {
        saveTableViews(persistedState);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const refreshOutcome = useCallback((): Promise<RefreshOutcome> => {
    const generation = ++refreshGeneration.current;
    setState((current) => current.status === "loaded"
      ? { ...current, error: null }
      : { ...current, status: "loading", error: null });
    const request = (async (): Promise<RefreshOutcome> => {
      try {
        const [entries, currencies, accountCategories, accounts, categories, balances] =
          await Promise.all([
            drainPages((offset) =>
              ledgerApi.listEntries({ includeArchived: true, limit: 200, offset })),
            drainPages((offset) => ledgerApi.listCurrencies({ limit: 200, offset })),
            drainPages((offset) =>
              ledgerApi.listAccountCategories({ limit: 200, offset })),
            drainPages((offset) => ledgerApi.listAccounts({ limit: 200, offset })),
            drainPages((offset) =>
              ledgerApi.listTransactionCategories({ limit: 200, offset })),
            drainPages((offset) =>
              ledgerApi.listAccountBalances({ limit: 200, offset })),
          ]);
        if (generation !== refreshGeneration.current) {
          return latestRefresh.current ?? { ok: false, error: "Ledger request failed" };
        }
        setState((current) => ({
          ...current,
          status: "loaded",
          error: null,
          entries,
          currencies,
          accountCategories,
          accounts,
          categories,
          balances,
        }));
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

  const refresh = useCallback(async () => (await refreshOutcome()).ok, [refreshOutcome]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const mutate = useCallback(async (
    operation: () => Promise<unknown>,
    requireRefresh = false,
  ) => {
    await operation();
    const outcome = await refreshOutcome();
    if (outcome.ok) return;
    if (requireRefresh) throw new LedgerMutationRefreshError();
  }, [refreshOutcome]);

  const runReports = useCallback(async (range: ReportRangeInput) => {
    setState((current) => ({
      ...current,
      reportStatus: "loading",
      reportError: null,
    }));
    try {
      const [summary, accountBreakdown, categoryBreakdown, briefing] =
        await Promise.all([
          ledgerApi.summary(range),
          ledgerApi.accountReport(range),
          ledgerApi.categoryReport(range),
          ledgerApi.briefing(range),
        ]);
      setState((current) => ({
        ...current,
        reportStatus: "loaded",
        reportError: null,
        summary,
        accountBreakdown,
        categoryBreakdown,
        briefing,
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        reportStatus: "error",
        reportError: errorMessage(error),
      }));
      throw error;
    }
  }, []);

  function updateTableTabs(
    scope: LedgerTableScopeId,
    updater: (
      tabs: TableViewTabsState<PlannerTableSettings>,
    ) => TableViewTabsState<PlannerTableSettings> | null,
    persist = false,
  ): boolean {
    const updated = updater(tableViewsRef.current[scope]);
    if (!updated) return false;
    const apply = (state: LedgerTableViewsState): LedgerTableViewsState => {
      const nextTabs = updater(state[scope]);
      return nextTabs ? { ...state, [scope]: nextTabs } : state;
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
    runReports,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Ledger request failed";
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
