"use client";

import { useCallback, useEffect, useState } from "react";

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

type LoadStatus = "loading" | "loaded" | "error";
type ReportStatus = "idle" | "loading" | "loaded" | "error";

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
  refresh(): Promise<void>;
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

export function useLedgerController(): LedgerController {
  const [state, setState] = useState(initialState);

  const refresh = useCallback(async () => {
    setState((current) => ({ ...current, status: "loading", error: null }));
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
    } catch (error) {
      setState((current) => ({
        ...current,
        status: "error",
        error: errorMessage(error),
      }));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const mutate = useCallback(async (operation: () => Promise<unknown>) => {
    await operation();
    await refresh();
  }, [refresh]);

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

  return {
    state,
    refresh,
    createEntry: (input) => mutate(() => ledgerApi.createEntry(input)),
    updateEntry: (id, input) => mutate(() => ledgerApi.updateEntry(id, input)),
    transfer: (input) => mutate(() => ledgerApi.createTransfer(input)),
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
