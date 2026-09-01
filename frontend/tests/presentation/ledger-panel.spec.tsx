import "@testing-library/jest-dom/vitest";

import { promises as fs } from "node:fs";
import path from "node:path";
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ledgerApi } from "@/features/ledger/api/ledger-api";
import { loadLedgerReport } from "@/features/ledger/api/ledger-report-loader";
import type {
  LedgerComparison,
  LedgerEntryView,
  LedgerTableOccurrence,
  LedgerTrend,
  MasterPurgePreview,
} from "@/features/ledger/model/ledger-model";
import { deriveTransactionGroups } from "@/features/ledger/model/transaction-table";
import { deriveAccountGroups } from "@/features/ledger/model/account-table";
import { deriveCategoryGroups } from "@/features/ledger/model/category-table";
import {
  createLedgerTableViews,
  defaultLedgerTableSettings,
} from "@/features/ledger/model/ledger-table-views";
import type {
  LedgerController,
  LedgerState,
} from "@/features/ledger/hooks/useLedgerController";
import {
  LedgerMutationRefreshError,
  useLedgerController,
} from "@/features/ledger/hooks/useLedgerController";
import { LedgerPanel } from "@/features/ledger/ui/LedgerPanel";
import { AccountSettingsDialog } from "@/features/ledger/ui/AccountSettingsDialog";
import { LedgerTableViewHeader } from "@/features/ledger/ui/LedgerTableViewHeader";
import { TransactionsTable } from "@/features/ledger/ui/TransactionsTable";
import { RavenApiError, RavenTransportError } from "@/lib/raven-api";

const loadedState: LedgerState = {
  status: "loaded",
  error: null,
  entries: [],
  currencies: [{
    id: "currency-krw",
    code: "KRW",
    name: "Korean won",
    symbol: "₩",
    decimalPlaces: 0,
    active: true,
  }, {
    id: "currency-usd",
    code: "USD",
    name: "US dollar",
    symbol: "$",
    decimalPlaces: 2,
    active: true,
  }],
  accountCategories: [{
    id: "account-category-cash",
    name: "Cash",
    parentId: null,
    liability: false,
    active: true,
  }],
  accounts: [{
    id: "account-cash",
    name: "Cash",
    categoryId: "account-category-cash",
    currencyId: "currency-krw",
    openingBalanceMinor: 0,
    active: true,
  }],
  categories: [{
    id: "category-food",
    name: "Food",
    parentId: null,
    kind: "expense",
    active: true,
  }],
  balances: [],
  tableLookups: {
    "ledger.transactions": {
      accounts: [{ id: "account-cash", label: "Cash" }],
      categories: [{ id: "category-food", label: "Food" }],
      currencies: [
        { id: "currency-krw", label: "KRW" },
        { id: "currency-usd", label: "USD" },
      ],
    },
    "ledger.accounts": {
      accountTypes: [{ id: "account-category-cash", label: "Cash" }],
      currencies: [
        { id: "currency-krw", label: "KRW" },
        { id: "currency-usd", label: "USD" },
      ],
    },
    "ledger.categories": {
      categories: [{ id: "category-food", label: "Food" }],
    },
  },
  reportStatus: "idle",
  reportError: null,
  reportSelection: { period: "current_month" },
  comparison: null,
  trend: null,
  summary: null,
  categoryBreakdown: [],
};

function controller(state: LedgerState = loadedState): LedgerController {
  const views = createLedgerTableViews();
  const result: LedgerController = {
    state,
    tableViewSaveError: null,
    retryTableViewSave: vi.fn(),
    tableViewConfirmation: null,
    tableTabs: (scope) => views[scope],
    tableSettings: (scope) => views[scope].draftSettings,
    tableIsDirty: vi.fn(() => false),
    tablePage: (scope) => ({
      items: legacyOccurrences(result, state, scope),
      nextOffset: null,
      moreStatus: "idle",
      moreError: null,
      generation: 1,
    }),
    ensureTable: vi.fn().mockResolvedValue(undefined),
    loadMore: vi.fn().mockResolvedValue(undefined),
    ensureReferenceData: vi.fn().mockResolvedValue(true),
    updateTableSettings: vi.fn(),
    selectTableTab: vi.fn(),
    saveTableTab: vi.fn(),
    createTableTab: vi.fn(() => true),
    renameTableTab: vi.fn(() => true),
    requestDeleteTableTab: vi.fn(),
    confirmTableViewAction: vi.fn(),
    cancelTableViewAction: vi.fn(),
    refresh: vi.fn(),
    createEntry: vi.fn(),
    updateEntry: vi.fn(),
    transfer: vi.fn(),
    updateTransfer: vi.fn(),
    archive: vi.fn(),
    restore: vi.fn(),
    previewPurge: vi.fn().mockResolvedValue({
      confirmationId: "confirm-entry",
      transferGroupId: null,
      entryIds: ["entry-1"],
    }),
    purge: vi.fn(),
    createAccount: vi.fn(),
    updateAccount: vi.fn(),
    archiveAccount: vi.fn(),
    restoreAccount: vi.fn(),
    previewAccountPurge: vi.fn(),
    purgeAccount: vi.fn(),
    createCategory: vi.fn(),
    updateCategory: vi.fn(),
    archiveCategory: vi.fn(),
    restoreCategory: vi.fn(),
    previewCategoryPurge: vi.fn(),
    purgeCategory: vi.fn(),
    createCurrency: vi.fn(),
    updateCurrency: vi.fn(),
    deactivateCurrency: vi.fn(),
    createAccountCategory: vi.fn(),
    updateAccountCategory: vi.fn(),
    deactivateAccountCategory: vi.fn(),
    previewAccountCategoryPurge: vi.fn().mockResolvedValue({
      confirmationId: "account-category-cash",
      recordType: "account_category",
    }),
    purgeAccountCategory: vi.fn(),
    runReports: vi.fn().mockResolvedValue(undefined),
    retryReports: vi.fn().mockResolvedValue(undefined),
  };
  return result;
}

function legacyOccurrences(
  ledger: LedgerController,
  state: LedgerState,
  scope: "ledger.transactions" | "ledger.accounts" | "ledger.categories",
): LedgerTableOccurrence[] {
  const groups = scope === "ledger.transactions"
    ? deriveTransactionGroups(
      state.entries,
      ledger.tableSettings(scope),
      undefined,
      state.currencies,
    )
    : scope === "ledger.accounts"
      ? deriveAccountGroups(
        state.accounts,
        state.balances,
        state.accountCategories,
        ledger.tableSettings(scope),
      )
      : deriveCategoryGroups(state.categories, ledger.tableSettings(scope));
  return groups.flatMap((group) => group.rows.map((record) => ({
    key: `${group.key}:${record.id}`,
    groupKey: group.label === null ? null : group.key,
    groupLabel: group.label,
    scope,
    record,
  } as LedgerTableOccurrence)));
}

function TransactionHeaderHarness() {
  const [settings, setSettings] = React.useState(defaultLedgerTableSettings("ledger.transactions"));
  const views = React.useMemo(() => createLedgerTableViews(), []);
  const ledger = controller();
  ledger.tableTabs = (scope) => views[scope];
  ledger.tableSettings = (scope) => scope === "ledger.transactions"
    ? settings
    : views[scope].draftSettings;
  ledger.updateTableSettings = (scope, updater) => {
    if (scope === "ledger.transactions") setSettings(updater);
  };

  return (
    <LedgerTableViewHeader
      controller={ledger}
      scope="ledger.transactions"
      title="Transactions"
      headingId="transactions-heading"
    />
  );
}

function entryView(id: string, content: string): LedgerEntryView {
  return {
    accountName: "Cash",
    categoryName: "Food",
    currencyCode: "KRW",
    entry: {
      id,
      date: "2026-07-30",
      writtenAt: "2026-07-30T00:00:00Z",
      content,
      transactionCategoryId: "category-food",
      accountId: "account-cash",
      entryType: "expense",
      amountMinor: 12000,
      currencyId: "currency-krw",
      transferGroupId: null,
      source: "ui",
      notes: null,
      createdAt: "2026-07-30T00:00:00Z",
      updatedAt: "2026-07-30T00:00:00Z",
      deletedAt: null,
    },
  };
}

function transactionEntry(
  id: string,
  content: string,
  overrides: Partial<LedgerEntryView["entry"]> = {},
  view: Partial<Pick<LedgerEntryView, "accountName" | "categoryName" | "currencyCode">> = {},
): LedgerEntryView {
  const base = entryView(id, content);
  return {
    ...base,
    ...view,
    entry: { ...base.entry, ...overrides },
  };
}

function transactionEntries(): LedgerEntryView[] {
  const transfer = {
    date: "2026-08-01",
    writtenAt: "2026-08-01T09:00:00Z",
    content: "Move funds",
    transactionCategoryId: null,
    amountMinor: 2500,
    transferGroupId: "transfer-1",
    createdAt: "2026-08-01T09:00:00Z",
    updatedAt: "2026-08-01T09:00:00Z",
  };
  return [
    transactionEntry("expense-1", "Lunch", {
      date: "2026-07-30",
      entryType: "expense",
      amountMinor: 12000,
    }),
    transactionEntry("transfer-in", "Move funds", {
      ...transfer,
      accountId: "account-card",
      entryType: "transfer_in",
    }, { accountName: "Card", categoryName: null }),
    transactionEntry("archived-1", "Archived", {
      date: "2026-08-03",
      deletedAt: "2026-08-03T10:00:00Z",
    }),
    transactionEntry("income-1", "Salary", {
      date: "2026-08-02",
      entryType: "adjustment_in",
      amountMinor: 5000,
      transactionCategoryId: null,
    }, { categoryName: null }),
    transactionEntry("transfer-out", "Move funds", {
      ...transfer,
      accountId: "account-cash",
      entryType: "transfer_out",
    }, { accountName: "Cash", categoryName: null }),
  ];
}

function transactionOccurrence(
  key: string,
  id: string,
  content: string,
): Extract<LedgerTableOccurrence, { scope: "ledger.transactions" }> {
  return {
    key,
    groupKey: null,
    groupLabel: null,
    scope: "ledger.transactions",
    record: {
      ...deriveTransactionGroups(
        [entryView(id, content)],
        defaultLedgerTableSettings("ledger.transactions"),
      )[0]!.rows[0]!,
      decimalPlaces: 0,
    },
  };
}

function accountOccurrence(
  account = loadedState.accounts[0]!,
): Extract<LedgerTableOccurrence, { scope: "ledger.accounts" }> {
  return {
    key: account.id,
    groupKey: null,
    groupLabel: null,
    scope: "ledger.accounts",
    record: {
      id: account.id,
      account,
      name: account.name,
      accountTypeId: account.categoryId,
      accountTypeLabel: "Cash",
      currencyId: account.currencyId,
      currencyCode: "KRW",
      decimalPlaces: 0,
      currentBalanceMinor: 0,
    },
  };
}

function categoryOccurrence(
  category = loadedState.categories[0]!,
): Extract<LedgerTableOccurrence, { scope: "ledger.categories" }> {
  return {
    key: category.id,
    groupKey: null,
    groupLabel: null,
    scope: "ledger.categories",
    record: {
      id: category.id,
      category,
      name: category.name,
      kind: category.kind,
      kindLabel: "Expense",
      parentId: category.parentId,
      parentLabel: "No parent",
    },
  };
}

function transactionSettings(
  patch: Partial<ReturnType<typeof defaultLedgerTableSettings>> = {},
) {
  const defaults = defaultLedgerTableSettings("ledger.transactions");
  return {
    ...defaults,
    ...patch,
    groupSettings: {
      ...defaults.groupSettings,
      ...patch.groupSettings,
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function mockLedgerLoads() {
  vi.spyOn(ledgerApi, "queryTable")
    .mockResolvedValue({ items: [], nextOffset: null });
  vi.spyOn(ledgerApi, "tableLookups")
    .mockResolvedValue({ accounts: [], categories: [], currencies: [] });
  vi.spyOn(ledgerApi, "listEntries")
    .mockResolvedValue({ items: [], nextOffset: null });
  vi.spyOn(ledgerApi, "listCurrencies")
    .mockResolvedValue({ items: loadedState.currencies, nextOffset: null });
  vi.spyOn(ledgerApi, "listAccountCategories")
    .mockResolvedValue({ items: loadedState.accountCategories, nextOffset: null });
  vi.spyOn(ledgerApi, "listAccounts")
    .mockResolvedValue({ items: loadedState.accounts, nextOffset: null });
  vi.spyOn(ledgerApi, "listTransactionCategories")
    .mockResolvedValue({ items: loadedState.categories, nextOffset: null });
  vi.spyOn(ledgerApi, "listAccountBalances")
    .mockResolvedValue({ items: [], nextOffset: null });
}

function comparison(start: string, end: string): LedgerComparison {
  const current = {
    range: { start, end },
    currencies: [{
      currencyId: "currency-krw",
      currencyCode: "KRW",
      decimalPlaces: 0,
      incomeMinor: 3000,
      expenseMinor: 1200,
      netChangeMinor: 1800,
      entryCount: 2,
    }],
  };
  return {
    current,
    previous: {
      range: { start: "2026-07-01", end: "2026-07-31" },
      currencies: [{
        currencyId: "currency-krw",
        currencyCode: "KRW",
        decimalPlaces: 0,
        incomeMinor: 2000,
        expenseMinor: 1000,
        netChangeMinor: 1000,
        entryCount: 1,
      }],
    },
    currencies: [{
      currencyId: "currency-krw",
      currencyCode: "KRW",
      current: current.currencies[0]!,
      previous: {
        currencyId: "currency-krw",
        currencyCode: "KRW",
        decimalPlaces: 0,
        incomeMinor: 2000,
        expenseMinor: 1000,
        netChangeMinor: 1000,
        entryCount: 1,
      },
    }],
  };
}

function trend(start: string, end: string): LedgerTrend {
  return {
    range: { start, end },
    granularity: "daily",
    currencies: [{
      currencyId: "currency-krw",
      currencyCode: "KRW",
      points: [{ start, end, incomeMinor: 3000, expenseMinor: 1200 }],
    }],
  };
}

function reportAnalysisState(
  overrides: Partial<LedgerState> = {},
): LedgerState {
  const current = {
    range: { start: "2026-08-01", end: "2026-08-31" },
    currencies: [{
      currencyId: "currency-krw",
      currencyCode: "KRW",
      decimalPlaces: 0,
      incomeMinor: 3000,
      expenseMinor: 1200,
      netChangeMinor: 1800,
      entryCount: 3,
    }, {
      currencyId: "currency-usd",
      currencyCode: "USD",
      decimalPlaces: 2,
      incomeMinor: 1234,
      expenseMinor: 200,
      netChangeMinor: 1034,
      entryCount: 2,
    }],
  };
  const previous = {
    range: { start: "2026-07-01", end: "2026-07-31" },
    currencies: [{
      currencyId: "currency-krw",
      currencyCode: "KRW",
      decimalPlaces: 0,
      incomeMinor: 2000,
      expenseMinor: 1500,
      netChangeMinor: 500,
      entryCount: 2,
    }, {
      currencyId: "currency-usd",
      currencyCode: "USD",
      decimalPlaces: 2,
      incomeMinor: 1000,
      expenseMinor: 350,
      netChangeMinor: 650,
      entryCount: 3,
    }],
  };

  return {
    ...loadedState,
    reportStatus: "loaded",
    comparison: {
      current,
      previous,
      currencies: current.currencies.map((currency, index) => ({
        currencyId: currency.currencyId,
        currencyCode: currency.currencyCode,
        current: currency,
        previous: previous.currencies[index]!,
      })),
    },
    categoryBreakdown: [{
      currencyId: "currency-krw",
      currencyCode: "KRW",
      decimalPlaces: 0,
      referenceId: "category-food",
      name: "Food",
      incomeMinor: 0,
      expenseMinor: 700,
      netChangeMinor: -700,
      entryCount: 1,
    }, {
      currencyId: "currency-krw",
      currencyCode: "KRW",
      decimalPlaces: 0,
      referenceId: "category-transit",
      name: "Transit",
      incomeMinor: 0,
      expenseMinor: 500,
      netChangeMinor: -500,
      entryCount: 1,
    }, {
      currencyId: "currency-usd",
      currencyCode: "USD",
      decimalPlaces: 2,
      referenceId: "category-food",
      name: "Food",
      incomeMinor: 0,
      expenseMinor: 200,
      netChangeMinor: -200,
      entryCount: 1,
    }],
    balances: [{
      account: loadedState.accounts[0]!,
      currencyCode: "KRW",
      decimalPlaces: 0,
      currentBalanceMinor: 2_000,
    }, {
      account: { ...loadedState.accounts[0]!, id: "account-savings", name: "Savings" },
      currencyCode: "KRW",
      decimalPlaces: 0,
      currentBalanceMinor: 1_000,
    }, {
      account: { ...loadedState.accounts[0]!, id: "account-card", name: "Credit card" },
      currencyCode: "KRW",
      decimalPlaces: 0,
      currentBalanceMinor: -500,
    }, {
      account: {
        ...loadedState.accounts[0]!,
        id: "account-dollar-cash",
        name: "Dollar cash",
        currencyId: "currency-usd",
      },
      currencyCode: "USD",
      decimalPlaces: 2,
      currentBalanceMinor: 2_500,
    }],
    trend: {
      range: current.range,
      granularity: "daily",
      currencies: [{
        currencyId: "currency-krw",
        currencyCode: "KRW",
        points: [{
          start: "2026-08-01",
          end: "2026-08-01",
          incomeMinor: 1000,
          expenseMinor: 700,
        }, {
          start: "2026-08-02",
          end: "2026-08-02",
          incomeMinor: 2000,
          expenseMinor: 500,
        }],
      }, {
        currencyId: "currency-usd",
        currencyCode: "USD",
        points: [{
          start: "2026-08-01",
          end: "2026-08-01",
          incomeMinor: 1234,
          expenseMinor: 200,
        }],
      }],
    },
    summary: current,
    ...overrides,
  };
}

describe("LedgerPanel", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("opens Account settings only from Accounts and restores trigger focus after Escape", async () => {
    const user = userEvent.setup();
    const ledger = controller();
    const { rerender } = render(<LedgerPanel controller={ledger} leafTabId="accounts" />);

    const trigger = screen.getByRole("button", { name: "Account settings" });
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    await user.click(trigger);
    expect(screen.getByRole("dialog", { name: "Account settings" })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Account settings" })).toBeNull();
    expect(trigger).toHaveFocus();
    expect(screen.getByRole("button", { name: "Add account" })).toBeInTheDocument();

    rerender(<LedgerPanel controller={ledger} leafTabId="transactions" />);
    expect(screen.queryByRole("button", { name: "Account settings" })).toBeNull();
    rerender(<LedgerPanel controller={ledger} leafTabId="categories" />);
    expect(screen.queryByRole("button", { name: "Account settings" })).toBeNull();
    rerender(<LedgerPanel controller={ledger} leafTabId="reports" />);
    expect(screen.queryByRole("button", { name: "Account settings" })).toBeNull();
  });

  it("keeps the production Account settings dialog open while its save is pending", async () => {
    const user = userEvent.setup();
    const request = deferred<void>();
    const ledger = controller();
    ledger.createAccountCategory = vi.fn(() => request.promise);
    render(<LedgerPanel controller={ledger} leafTabId="accounts" />);

    await user.click(screen.getByRole("button", { name: "Account settings" }));
    const dialog = screen.getByRole("dialog", { name: "Account settings" });
    await user.type(screen.getByLabelText("Account type name"), "Wallet");
    const save = within(dialog).getByRole("button", { name: "Save" });
    await user.click(save);

    expect(dialog).toHaveAttribute("aria-busy", "true");
    expect(save).toBeDisabled();
    expect(save).toHaveAccessibleName("Saving…");
    expect(within(dialog).getByRole("button", { name: "Close" })).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "Account settings" })).toBeInTheDocument();

    await act(async () => request.resolve(undefined));
  });

  it("isolates Account settings and traps focus between its enabled controls", async () => {
    const user = userEvent.setup();
    const returnFocusRef = React.createRef<HTMLButtonElement>();
    const view = render(
      <>
        <button ref={returnFocusRef} type="button">Open settings</button>
        <AccountSettingsDialog
          controller={controller()}
          onClose={vi.fn()}
          returnFocusRef={returnFocusRef}
        />
      </>,
    );

    const dialog = screen.getByRole("dialog", { name: "Account settings" });
    const accountTypes = within(dialog).getByRole("tab", { name: "Account types" });
    const save = within(dialog).getByRole("button", { name: "Save" });
    expect(view.container).toHaveAttribute("aria-hidden", "true");
    expect(view.container).toHaveAttribute("inert");
    expect(document.body.style.overflow).toBe("hidden");
    expect(accountTypes).toHaveFocus();

    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(save).toHaveFocus();
    await user.keyboard("{Tab}");
    expect(accountTypes).toHaveFocus();
  });

  it("keeps Account settings open and returns focus when Escape cancels deactivation", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const returnFocusRef = React.createRef<HTMLButtonElement>();
    render(
      <>
        <button ref={returnFocusRef} type="button">Open settings</button>
        <AccountSettingsDialog
          controller={controller()}
          onClose={onClose}
          returnFocusRef={returnFocusRef}
        />
      </>,
    );

    const deactivate = screen.getByRole("button", { name: "Deactivate Cash" });
    await user.click(deactivate);
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: "Deactivate Cash?" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "Account settings" })).toBeInTheDocument();
    await waitFor(() => expect(deactivate).toHaveFocus());
    expect(onClose).not.toHaveBeenCalled();
  });

  it("executes a pending settings deactivation only once", async () => {
    const user = userEvent.setup();
    const request = deferred<void>();
    const ledger = controller();
    ledger.deactivateAccountCategory = vi.fn(() => request.promise);
    const returnFocusRef = React.createRef<HTMLButtonElement>();
    render(
      <>
        <button ref={returnFocusRef} type="button">Open settings</button>
        <AccountSettingsDialog
          controller={ledger}
          onClose={vi.fn()}
          returnFocusRef={returnFocusRef}
        />
      </>,
    );

    await user.click(screen.getByRole("button", { name: "Deactivate Cash" }));
    const confirm = screen.getByRole("button", { name: "Deactivate" });
    await user.click(confirm);
    await user.click(confirm);

    expect(ledger.deactivateAccountCategory).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("dialog", { name: "Deactivate Cash?" }))
      .toHaveAttribute("aria-busy", "true");
    await act(async () => request.resolve(undefined));
  });

  it("uses complete Account settings tabs and shows only active settings", async () => {
    const user = userEvent.setup();
    const inactiveState = {
      ...loadedState,
      accountCategories: [...loadedState.accountCategories, {
        id: "account-category-old",
        name: "Old category",
        parentId: null,
        liability: false,
        active: false,
      }],
      currencies: [...loadedState.currencies, {
        id: "currency-old",
        code: "OLD",
        name: "Old currency",
        symbol: "O",
        decimalPlaces: 2,
        active: false,
      }],
    };
    const returnFocusRef = React.createRef<HTMLButtonElement>();
    render(
      <>
        <button ref={returnFocusRef} type="button">Open settings</button>
        <AccountSettingsDialog
          controller={controller(inactiveState)}
          onClose={vi.fn()}
          returnFocusRef={returnFocusRef}
        />
      </>,
    );

    const dialog = screen.getByRole("dialog", { name: "Account settings" });
    expect(within(dialog.querySelector("header")!).queryByRole("button")).toBeNull();
    const tabs = within(dialog).getByRole("tablist", { name: "Account settings sections" });
    expect(tabs).toHaveClass("ledger-account-settings-tabs");
    for (const tab of within(tabs).getAllByRole("tab")) {
      expect(tab).toHaveClass("ledger-account-settings-tab");
    }
    const accountTypes = within(tabs).getByRole("tab", { name: "Account types" });
    const currencies = within(tabs).getByRole("tab", { name: "Currencies" });
    expect(accountTypes).toHaveAttribute("id", "account-types-tab");
    expect(accountTypes).toHaveAttribute("aria-controls", "account-types-panel");
    expect(accountTypes).toHaveAttribute("aria-selected", "true");
    expect(accountTypes).toHaveAttribute("tabindex", "0");
    expect(currencies).toHaveAttribute("id", "currencies-tab");
    expect(currencies).toHaveAttribute("aria-controls", "currencies-panel");
    expect(currencies).toHaveAttribute("aria-selected", "false");
    expect(currencies).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("tabpanel", { name: "Account types" }))
      .toHaveAttribute("aria-labelledby", "account-types-tab");
    expect(within(dialog).getByRole("heading", { name: "New account type" }))
      .toBeInTheDocument();
    expect(within(dialog).getByRole("checkbox", { name: "Liability" }).parentElement)
      .toHaveClass("ledger-account-settings-checkbox");
    const close = within(dialog).getByRole("button", { name: "Close" });
    const actions = close.parentElement!;
    expect(actions).toHaveClass("ledger-create-dialog-actions");
    const save = within(actions).getByRole("button", { name: "Save" });
    expect(save).toHaveClass("ledger-create-dialog-save");
    expect(save).toHaveAttribute("form", "account-settings-account-type-form");
    expect(screen.getAllByText("Cash")).not.toHaveLength(0);
    expect(screen.queryByText("Old category")).toBeNull();

    const accountTypeTable = within(dialog).getByRole("table");
    expect(accountTypeTable).toHaveClass(
      "ledger-account-settings-table",
      "ledger-account-settings-account-types-table",
    );
    const expectIconAction = (
      table: HTMLElement,
      name: string,
      iconClass: string,
    ) => {
      const action = within(table).getByRole("button", { name });
      expect(action).toHaveAttribute("title", name);
      expect(action).toContainElement(action.querySelector(`.${iconClass}`));
      expect(action.textContent?.trim()).toBe("");
    };
    expectIconAction(accountTypeTable, "Edit Cash", "lucide-pencil");
    expectIconAction(accountTypeTable, "Deactivate Cash", "lucide-circle-off");
    expectIconAction(accountTypeTable, "Delete Cash", "lucide-trash-2");
    expect(within(accountTypeTable).getByRole("cell", { name: /Edit Cash/ }))
      .toHaveClass("ledger-account-settings-actions-cell");

    await user.click(within(accountTypeTable).getByRole("button", { name: "Edit Cash" }));
    const accountEditorHeading = screen.getByRole("heading", {
      name: "Edit account type",
    }).parentElement!;
    expect(accountEditorHeading).toHaveClass("ledger-account-settings-editor-header");
    const cancelAccountEdit = within(accountEditorHeading).getByRole("button", {
      name: "Cancel edit",
    });
    expect(cancelAccountEdit).toBeInTheDocument();
    expect(screen.getByLabelText("Liability").parentElement?.nextElementSibling)
      .not.toBe(cancelAccountEdit);
    await user.click(cancelAccountEdit);

    accountTypes.focus();
    await user.keyboard("{ArrowRight}");
    expect(currencies).toHaveFocus();
    expect(screen.getByRole("tabpanel", { name: "Currencies" }))
      .toHaveAttribute("aria-labelledby", "currencies-tab");
    expect(within(dialog).getByRole("heading", { name: "New currency" }))
      .toBeInTheDocument();
    expect(save).toHaveAttribute("form", "account-settings-currency-form");
    expect(screen.getByText("KRW")).toBeInTheDocument();
    expect(screen.queryByText("OLD")).toBeNull();

    const currencyTable = within(dialog).getByRole("table");
    expect(currencyTable).toHaveClass(
      "ledger-account-settings-table",
      "ledger-account-settings-currencies-table",
    );
    expectIconAction(currencyTable, "Edit KRW", "lucide-pencil");
    expectIconAction(currencyTable, "Deactivate KRW", "lucide-circle-off");
    expect(within(currencyTable).queryByRole("button", { name: "Delete KRW" })).toBeNull();
    expect(within(currencyTable).getByRole("cell", { name: /Edit KRW/ }))
      .toHaveClass("ledger-account-settings-actions-cell");

    await user.click(within(currencyTable).getByRole("button", { name: "Edit KRW" }));
    const currencyEditorHeading = screen.getByRole("heading", {
      name: "Edit currency",
    }).parentElement!;
    expect(currencyEditorHeading).toHaveClass("ledger-account-settings-editor-header");
    expect(within(currencyEditorHeading).getByRole("button", { name: "Cancel edit" }))
      .toBeInTheDocument();
    currencies.focus();
    await user.keyboard("{ArrowLeft}");
    expect(accountTypes).toHaveFocus();
  });

  it("keeps referenced Account types and shows only a safe purge-preview failure", async () => {
    const user = userEvent.setup();
    const ledger = controller();
    ledger.previewAccountCategoryPurge = vi.fn().mockRejectedValue(
      new Error("sqlite /private/raven.sqlite: referenced"),
    );
    render(
      <AccountSettingsDialog
        controller={ledger}
        onClose={vi.fn()}
        returnFocusRef={React.createRef<HTMLButtonElement>()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Delete Cash" }));

    expect(ledger.previewAccountCategoryPurge)
      .toHaveBeenCalledWith("account-category-cash");
    expect(screen.queryByRole("dialog", { name: "Permanently delete Cash?" }))
      .toBeNull();
    expect(await screen.findByRole("alert"))
      .toHaveTextContent("Could not delete account type.");
    expect(screen.getByRole("alert")).not.toHaveTextContent("sqlite");
    expect(ledger.purgeAccountCategory).not.toHaveBeenCalled();
  });

  it("previews and permanently deletes an unused Account type once", async () => {
    const user = userEvent.setup();
    const preview = deferred<MasterPurgePreview>();
    const purge = deferred<void>();
    const ledger = controller();
    ledger.previewAccountCategoryPurge = vi.fn()
      .mockReturnValueOnce(preview.promise)
      .mockResolvedValue({
        confirmationId: "account-category-cash",
        recordType: "account_category",
      });
    ledger.purgeAccountCategory = vi.fn(() => purge.promise);
    const onClose = vi.fn();
    render(
      <AccountSettingsDialog
        controller={ledger}
        onClose={onClose}
        returnFocusRef={React.createRef<HTMLButtonElement>()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Edit Cash" }));
    const deleteCash = screen.getByRole("button", { name: "Delete Cash" });
    await user.click(deleteCash);
    await user.click(deleteCash);
    expect(ledger.previewAccountCategoryPurge).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("dialog", { name: "Account settings" }))
      .toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "Close" })).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => preview.resolve({
      confirmationId: "account-category-cash",
      recordType: "account_category",
    }));
    const confirmation = await screen.findByRole("dialog", {
      name: "Permanently delete Cash?",
    });
    expect(within(confirmation).getByRole("button", { name: "Cancel" })).toHaveFocus();
    await user.click(within(confirmation).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(deleteCash).toHaveFocus());

    await user.click(deleteCash);
    expect(ledger.previewAccountCategoryPurge).toHaveBeenCalledTimes(2);
    expect(ledger.previewAccountCategoryPurge)
      .toHaveBeenNthCalledWith(2, "account-category-cash");
    const reopened = await screen.findByRole("dialog", {
      name: "Permanently delete Cash?",
    });
    const confirm = within(reopened).getByRole("button", { name: "Delete" });
    await user.click(confirm);
    await user.click(confirm);
    expect(ledger.purgeAccountCategory).toHaveBeenCalledTimes(1);
    expect(ledger.purgeAccountCategory).toHaveBeenCalledWith(
      "account-category-cash",
      "account-category-cash",
    );
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "Permanently delete Cash?" }))
      .toBeInTheDocument();
    await act(async () => purge.resolve(undefined));
    expect(screen.getByRole("form", { name: "New account type" }))
      .toBeInTheDocument();
  });

  it("creates, edits, and deactivates account types with the exact payload", async () => {
    const user = userEvent.setup();
    const ledger = controller({
      ...loadedState,
      accountCategories: [{
        id: "account-category-bank",
        name: "Bank",
        parentId: null,
        liability: false,
        active: true,
      }, ...loadedState.accountCategories],
    });
    const returnFocusRef = React.createRef<HTMLButtonElement>();
    render(
      <>
        <button ref={returnFocusRef} type="button">Open settings</button>
        <AccountSettingsDialog controller={ledger} onClose={vi.fn()} returnFocusRef={returnFocusRef} />
      </>,
    );

    await user.type(screen.getByLabelText("Account type name"), "Card");
    await user.selectOptions(screen.getByLabelText("Parent account type"), "account-category-bank");
    await user.click(screen.getByLabelText("Liability"));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(ledger.createAccountCategory).toHaveBeenCalledWith({
      name: "Card",
      parent: "account-category-bank",
      liability: true,
    });
    expect(screen.getByLabelText("Account type name")).toHaveValue("");

    await user.click(screen.getByRole("button", { name: "Edit Cash" }));
    expect(within(screen.getByLabelText("Parent account type"))
      .queryByRole("option", { name: "Cash" })).toBeNull();
    await user.clear(screen.getByLabelText("Account type name"));
    await user.type(screen.getByLabelText("Account type name"), "Wallet");
    await user.selectOptions(screen.getByLabelText("Parent account type"), "account-category-bank");
    await user.click(screen.getByLabelText("Liability"));
    expect(screen.getByRole("heading", { name: "Edit account type" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(ledger.updateAccountCategory).toHaveBeenCalledWith("account-category-cash", {
      name: "Wallet",
      parent: "account-category-bank",
      liability: true,
    });

    await user.click(screen.getByRole("button", { name: "Deactivate Cash" }));
    await user.click(screen.getByRole("button", { name: "Deactivate" }));
    expect(ledger.deactivateAccountCategory).toHaveBeenCalledWith("account-category-cash");
    expect(ledger.previewAccountPurge).not.toHaveBeenCalled();
    expect(ledger.purgeAccount).not.toHaveBeenCalled();
  });

  it("keeps an account type draft and only shows a safe save failure", async () => {
    const user = userEvent.setup();
    const ledger = controller();
    ledger.createAccountCategory = vi.fn().mockRejectedValue(
      new Error("sqlite /private/raven.sqlite: secret"),
    );
    const returnFocusRef = React.createRef<HTMLButtonElement>();
    render(
      <>
        <button ref={returnFocusRef} type="button">Open settings</button>
        <AccountSettingsDialog controller={ledger} onClose={vi.fn()} returnFocusRef={returnFocusRef} />
      </>,
    );

    await user.type(screen.getByLabelText("Account type name"), "Wallet");
    await user.click(screen.getByLabelText("Liability"));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save account type.");
    expect(screen.getByRole("alert")).not.toHaveTextContent("sqlite");
    expect(screen.getByLabelText("Account type name")).toHaveValue("Wallet");
    expect(screen.getByLabelText("Liability")).toBeChecked();
  });

  it("returns matching deactivated editors to Add mode without retaining update paths", async () => {
    const user = userEvent.setup();
    const ledger = controller();
    const returnFocusRef = React.createRef<HTMLButtonElement>();
    render(
      <>
        <button ref={returnFocusRef} type="button">Open settings</button>
        <AccountSettingsDialog controller={ledger} onClose={vi.fn()} returnFocusRef={returnFocusRef} />
      </>,
    );

    await user.click(screen.getByRole("button", { name: "Edit Cash" }));
    const deactivateCash = screen.getByRole("button", { name: "Deactivate Cash" });
    await user.click(deactivateCash);
    await user.click(screen.getByRole("button", { name: "Deactivate" }));
    expect(screen.getByRole("form", { name: "New account type" })).toBeInTheDocument();
    await waitFor(() => expect(deactivateCash).toHaveFocus());
    await user.clear(screen.getByLabelText("Account type name"));
    await user.type(screen.getByLabelText("Account type name"), "Wallet");
    expect(screen.getByLabelText("Account type name")).toHaveValue("Wallet");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(ledger.createAccountCategory).toHaveBeenCalledTimes(1);
    expect(ledger.updateAccountCategory).not.toHaveBeenCalled();

    await user.click(screen.getByRole("tab", { name: "Currencies" }));
    await user.click(screen.getByRole("button", { name: "Edit KRW" }));
    const deactivateKrw = screen.getByRole("button", { name: "Deactivate KRW" });
    await user.click(deactivateKrw);
    await user.click(screen.getByRole("button", { name: "Deactivate" }));
    expect(screen.getByRole("form", { name: "New currency" })).toBeInTheDocument();
    await waitFor(() => expect(deactivateKrw).toHaveFocus());
    await user.clear(screen.getByLabelText("Currency code"));
    await user.type(screen.getByLabelText("Currency code"), "JPY");
    await user.clear(screen.getByLabelText("Currency name"));
    await user.type(screen.getByLabelText("Currency name"), "Japanese yen");
    await user.clear(screen.getByLabelText("Currency symbol"));
    await user.type(screen.getByLabelText("Currency symbol"), "¥");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(ledger.createCurrency).toHaveBeenCalledTimes(1);
    expect(ledger.updateCurrency).not.toHaveBeenCalled();
  });

  it("keeps editors for different deactivated settings", async () => {
    const user = userEvent.setup();
    const ledger = controller({
      ...loadedState,
      accountCategories: [{
        id: "account-category-bank",
        name: "Bank",
        parentId: null,
        liability: false,
        active: true,
      }, ...loadedState.accountCategories],
    });
    const returnFocusRef = React.createRef<HTMLButtonElement>();
    render(
      <>
        <button ref={returnFocusRef} type="button">Open settings</button>
        <AccountSettingsDialog controller={ledger} onClose={vi.fn()} returnFocusRef={returnFocusRef} />
      </>,
    );

    await user.click(screen.getByRole("button", { name: "Edit Bank" }));
    await user.click(screen.getByRole("button", { name: "Deactivate Cash" }));
    await user.click(screen.getByRole("button", { name: "Deactivate" }));
    expect(screen.getByRole("form", { name: "Edit account type" })).toBeInTheDocument();
    expect(screen.getByLabelText("Account type name")).toHaveValue("Bank");

    await user.click(screen.getByRole("tab", { name: "Currencies" }));
    await user.click(screen.getByRole("button", { name: "Edit USD" }));
    await user.click(screen.getByRole("button", { name: "Deactivate KRW" }));
    await user.click(screen.getByRole("button", { name: "Deactivate" }));
    expect(screen.getByRole("form", { name: "Edit currency" })).toBeInTheDocument();
    expect(screen.getByLabelText("Currency code")).toHaveValue("USD");
  });

  it("clears inline save errors when cancelling either editor", async () => {
    const user = userEvent.setup();
    const ledger = controller();
    ledger.updateAccountCategory = vi.fn().mockRejectedValue(new Error("account failure"));
    ledger.updateCurrency = vi.fn().mockRejectedValue(new Error("currency failure"));
    const returnFocusRef = React.createRef<HTMLButtonElement>();
    render(
      <>
        <button ref={returnFocusRef} type="button">Open settings</button>
        <AccountSettingsDialog controller={ledger} onClose={vi.fn()} returnFocusRef={returnFocusRef} />
      </>,
    );

    await user.click(screen.getByRole("button", { name: "Edit Cash" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save account type.");
    await user.click(screen.getByRole("button", { name: "Cancel edit" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("heading", { name: "New account type" })).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Currencies" }));
    await user.click(screen.getByRole("button", { name: "Edit KRW" }));
    expect(screen.getByRole("heading", { name: "Edit currency" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save currency.");
    await user.click(screen.getByRole("button", { name: "Cancel edit" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("heading", { name: "New currency" })).toBeInTheDocument();
  });

  it("creates, edits, validates, and deactivates currencies with the exact payload", async () => {
    const user = userEvent.setup();
    const ledger = controller();
    const returnFocusRef = React.createRef<HTMLButtonElement>();
    render(
      <>
        <button ref={returnFocusRef} type="button">Open settings</button>
        <AccountSettingsDialog controller={ledger} onClose={vi.fn()} returnFocusRef={returnFocusRef} />
      </>,
    );

    await user.click(screen.getByRole("tab", { name: "Currencies" }));
    await user.type(screen.getByLabelText("Currency code"), "JPY");
    await user.type(screen.getByLabelText("Currency name"), "Japanese yen");
    await user.type(screen.getByLabelText("Currency symbol"), "¥");
    await user.clear(screen.getByLabelText("Decimal places"));
    await user.type(screen.getByLabelText("Decimal places"), "0");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(ledger.createCurrency).toHaveBeenCalledWith({
      code: "JPY",
      name: "Japanese yen",
      symbol: "¥",
      decimalPlaces: 0,
    });

    await user.click(screen.getByRole("button", { name: "Edit KRW" }));
    await user.clear(screen.getByLabelText("Currency code"));
    await user.type(screen.getByLabelText("Currency code"), "KWR");
    await user.clear(screen.getByLabelText("Currency name"));
    await user.type(screen.getByLabelText("Currency name"), "Korean won updated");
    await user.clear(screen.getByLabelText("Currency symbol"));
    await user.type(screen.getByLabelText("Currency symbol"), "W");
    await user.clear(screen.getByLabelText("Decimal places"));
    await user.type(screen.getByLabelText("Decimal places"), "3");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(ledger.updateCurrency).toHaveBeenCalledWith("currency-krw", {
      code: "KWR",
      name: "Korean won updated",
      symbol: "W",
      decimalPlaces: 3,
    });

    await user.click(screen.getByRole("button", { name: "Edit USD" }));
    await user.clear(screen.getByLabelText("Decimal places"));
    await user.type(screen.getByLabelText("Decimal places"), "19");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert"))
      .toHaveTextContent("Decimal places must be an integer from 0 to 18.");
    expect(ledger.updateCurrency).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Decimal places")).toHaveValue(19);

    await user.click(screen.getByRole("button", { name: "Cancel edit" }));
    await user.click(screen.getByRole("button", { name: "Deactivate KRW" }));
    await user.click(screen.getByRole("button", { name: "Deactivate" }));
    expect(ledger.deactivateCurrency).toHaveBeenCalledWith("currency-krw");
    expect(ledger.previewAccountPurge).not.toHaveBeenCalled();
    expect(ledger.purgeAccount).not.toHaveBeenCalled();
  });

  it("keeps currency drafts after safe failures and blocks closing while pending", async () => {
    const user = userEvent.setup();
    const request = deferred<void>();
    const ledger = controller();
    ledger.createCurrency = vi.fn(() => request.promise);
    const onClose = vi.fn();
    const returnFocusRef = React.createRef<HTMLButtonElement>();
    render(
      <>
        <button ref={returnFocusRef} type="button">Open settings</button>
        <AccountSettingsDialog controller={ledger} onClose={onClose} returnFocusRef={returnFocusRef} />
      </>,
    );

    await user.click(screen.getByRole("tab", { name: "Currencies" }));
    await user.type(screen.getByLabelText("Currency code"), "JPY");
    await user.type(screen.getByLabelText("Currency name"), "Japanese yen");
    await user.type(screen.getByLabelText("Currency symbol"), "¥");
    const save = screen.getByRole("button", { name: "Save" });
    await user.click(save);
    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
    expect(save).toBeDisabled();
    expect(save).toHaveAccessibleName("Saving…");
    expect(screen.getByRole("button", { name: "Close" })).toBeDisabled();

    await act(async () => request.reject(new Error("raw storage error")));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save currency.");
    expect(screen.getByRole("alert")).not.toHaveTextContent("storage");
    expect(screen.getByLabelText("Currency code")).toHaveValue("JPY");
  });

  it("forwards currency mutations and refreshes active currencies", async () => {
    const refreshedCurrencies = [{
      id: "currency-jpy",
      code: "JPY",
      name: "Japanese yen",
      symbol: "¥",
      decimalPlaces: 0,
      active: true,
    }];
    mockLedgerLoads();
    vi.mocked(ledgerApi.listCurrencies)
      .mockResolvedValueOnce({ items: loadedState.currencies, nextOffset: null })
      .mockResolvedValue({ items: refreshedCurrencies, nextOffset: null });
    vi.spyOn(ledgerApi, "createCurrency").mockResolvedValue({} as never);
    vi.spyOn(ledgerApi, "updateCurrency").mockResolvedValue({} as never);

    const { result } = renderHook(() => useLedgerController());
    await waitFor(() => expect(result.current.state.status).toBe("loaded"));
    await act(async () => {
      await result.current.ensureReferenceData!("ledger.accounts");
    });

    await act(async () => {
      await result.current.createCurrency({
        code: "JPY",
        name: "Japanese yen",
        symbol: "¥",
        decimalPlaces: 0,
      });
    });
    expect(ledgerApi.createCurrency).toHaveBeenCalledWith({
      code: "JPY",
      name: "Japanese yen",
      symbol: "¥",
      decimalPlaces: 0,
    });
    expect(result.current.state.currencies).toEqual(refreshedCurrencies);

    await act(async () => {
      await result.current.updateCurrency("currency-usd", { name: "US Dollar" });
      await result.current.deactivateCurrency("currency-usd");
    });
    expect(ledgerApi.updateCurrency).toHaveBeenCalledWith("currency-usd", {
      name: "US Dollar",
    });
    expect(ledgerApi.updateCurrency).toHaveBeenCalledWith("currency-usd", { active: false });
    expect(ledgerApi.listCurrencies).toHaveBeenCalledTimes(4);
  });

  it("forwards account-category mutations and refreshes active categories", async () => {
    const refreshedCategories = [{
      id: "account-type-card",
      name: "Card",
      parentId: null,
      liability: true,
      active: true,
    }];
    mockLedgerLoads();
    vi.mocked(ledgerApi.listAccountCategories)
      .mockResolvedValueOnce({ items: loadedState.accountCategories, nextOffset: null })
      .mockResolvedValue({ items: refreshedCategories, nextOffset: null });
    vi.spyOn(ledgerApi, "createAccountCategory").mockResolvedValue({} as never);
    vi.spyOn(ledgerApi, "updateAccountCategory").mockResolvedValue({} as never);
    const purgePreview: MasterPurgePreview = {
      confirmationId: "account-type-card",
      recordType: "account_category",
    };
    vi.spyOn(ledgerApi, "previewMasterPurge").mockResolvedValue(purgePreview);
    vi.spyOn(ledgerApi, "purgeMaster").mockResolvedValue(undefined);

    const { result } = renderHook(() => useLedgerController());
    await waitFor(() => expect(result.current.state.status).toBe("loaded"));
    await act(async () => {
      await result.current.ensureReferenceData!("ledger.accounts");
    });

    await act(async () => {
      await result.current.createAccountCategory({ name: "Card", liability: true });
    });
    expect(ledgerApi.createAccountCategory).toHaveBeenCalledWith({
      name: "Card",
      liability: true,
    });
    expect(result.current.state.accountCategories).toEqual(refreshedCategories);

    await act(async () => {
      await result.current.updateAccountCategory("account-type-cash", { name: "Cash" });
      await result.current.deactivateAccountCategory("account-type-cash");
    });
    expect(ledgerApi.updateAccountCategory).toHaveBeenCalledWith("account-type-cash", {
      name: "Cash",
    });
    expect(ledgerApi.updateAccountCategory).toHaveBeenCalledWith("account-type-cash", {
      active: false,
    });
    let preview: MasterPurgePreview | undefined;
    await act(async () => {
      preview = await result.current.previewAccountCategoryPurge("account-type-card");
    });
    expect(preview).toEqual(purgePreview);
    expect(ledgerApi.previewMasterPurge).toHaveBeenCalledWith(
      "account-categories",
      "account-type-card",
    );
    expect(ledgerApi.listAccountCategories).toHaveBeenCalledTimes(4);

    await act(async () => {
      await result.current.purgeAccountCategory("account-type-card", "account-type-card");
    });
    expect(ledgerApi.purgeMaster).toHaveBeenCalledWith(
      "account-categories",
      "account-type-card",
      "account-type-card",
    );
    expect(ledgerApi.listAccountCategories).toHaveBeenCalledTimes(5);
  });

  it("uses Transactions as the default leaf and has no Overview", () => {
    render(<LedgerPanel controller={controller()} />);

    expect(screen.getByRole("heading", { name: "Transactions" })).toBeInTheDocument();
    expect(screen.queryByText("Overview")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("New transaction")).not.toBeInTheDocument();
    const add = screen.getByRole("button", { name: "Add transaction" });
    expect(add).toHaveClass("items-toolbar-button");
    expect(add).toHaveAttribute("aria-haspopup", "dialog");
    expect(add.parentElement).toHaveClass("workspace-table-header-actions");
    expect(add.parentElement?.firstElementChild).toHaveAttribute(
      "aria-label",
      "Transactions controls",
    );
    expect(screen.getByText("No transactions yet.")).toBeInTheDocument();
  });

  it("renders icon-only actions with accessible names and tooltips", async () => {
    const expectIconButton = (name: string, iconClass: string) => {
      const button = screen.getByRole("button", { name });
      expect(button).toHaveAttribute("title", name);
      expect(button).toContainElement(button.querySelector(`.${iconClass}`));
      expect(button).not.toHaveTextContent(name);
    };
    const { rerender } = render(<LedgerPanel controller={controller({
      ...loadedState,
      entries: transactionEntries(),
    })} />);

    expectIconButton("Add transaction", "lucide-plus");
    await userEvent.click(screen.getByRole("checkbox", { name: "Select all visible transactions" }));
    expectIconButton("Archive selected transactions", "lucide-trash-2");

    rerender(<LedgerPanel leafTabId="accounts" controller={controller()} />);
    expectIconButton("Account settings", "lucide-settings");
    expectIconButton("Add account", "lucide-plus");
    await userEvent.click(screen.getByRole("checkbox", { name: "Select all visible accounts" }));
    expectIconButton("Delete selected", "lucide-trash-2");

    rerender(<LedgerPanel leafTabId="categories" controller={controller()} />);
    expectIconButton("Add category", "lucide-plus");
    await userEvent.click(screen.getByRole("checkbox", { name: "Select all visible categories" }));
    expectIconButton("Delete selected", "lucide-trash-2");
  });

  it("renders compact active logical transactions in default date order", () => {
    render(<LedgerPanel controller={controller({
      ...loadedState,
      entries: transactionEntries(),
    })} />);

    const table = screen.getByRole("table", { name: "Transactions" });
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent))
      .toEqual(["", "Date", "Content", "Account", "Category", "Amount"]);
    const rows = within(table).getAllByRole("button", { name: /Open details for/ });
    expect(rows.map((row) => within(row).getAllByRole("cell")[1]?.textContent))
      .toEqual(["2026-08-02", "2026-08-01", "2026-07-30"]);
    expect(within(table).getByText("Cash → Card")).toBeInTheDocument();
    expect(within(table).queryByText("Archived")).not.toBeInTheDocument();
    expect(within(table).queryByText("Type")).not.toBeInTheDocument();
    expect(within(table).queryByText("Actions")).not.toBeInTheDocument();

    expect(within(table).getByText("+5000 KRW")).toHaveClass("ledger-amount-positive");
    expect(within(table).getByText("−12000 KRW")).toHaveClass("ledger-amount-negative");
    expect(within(table).getByText("2500 KRW")).toHaveClass("ledger-amount-neutral");
    expect(within(table).queryByText(/[+−]2500 KRW/)).not.toBeInTheDocument();
    const transferRow = screen.getByRole("button", {
      name: "Open details for Move funds, 2026-08-01, Cash → Card",
    });
    expect(within(transferRow).getAllByRole("cell")[4]).toBeEmptyDOMElement();
  });

  it("applies transaction filter, sort, and group settings without changing row order", () => {
    const ledger = controller({
      ...loadedState,
      entries: [
        ...transactionEntries(),
        transactionEntry("expense-2", "Dinner", {
          date: "2026-08-04",
          entryType: "expense",
          amountMinor: 3000,
        }),
      ],
    });
    ledger.tableSettings = (scope) => scope === "ledger.transactions"
      ? transactionSettings({
          filterRules: [{
            id: "expense-only",
            field: "entry_type",
            type: "select",
            operator: "is",
            value: ["expense"],
          }],
          sortRules: [{ id: "content", field: "content", direction: "asc" }],
          groupSettings: {
            ...defaultLedgerTableSettings("ledger.transactions").groupSettings,
            groupBy: "day",
          },
        })
      : defaultLedgerTableSettings(scope);
    render(<LedgerPanel controller={ledger} />);

    const table = screen.getByRole("table", { name: "Transactions" });
    expect(within(table).getAllByRole("rowgroup", { name: /group/ })
      .map((group) => group.getAttribute("aria-label")))
      .toEqual(["2026-08-04 group", "2026-07-30 group"]);
    expect(within(table).getAllByRole("button", { name: /Open details for/ })
      .map((row) => row.getAttribute("aria-label")))
      .toEqual([
        "Open details for Dinner, 2026-08-04, Cash",
        "Open details for Lunch, 2026-07-30, Cash",
      ]);
  });

  it("sorts transaction amounts in the units shown by the table", () => {
    const ledger = controller({
      ...loadedState,
      entries: [
        transactionEntry("usd", "USD amount", {
          amountMinor: 1234,
          currencyId: "currency-usd",
        }, { currencyCode: "USD" }),
        transactionEntry("krw", "KRW amount", { amountMinor: 13 }),
      ],
    });
    ledger.tableSettings = (scope) => scope === "ledger.transactions"
      ? transactionSettings({
          sortRules: [{ id: "amount", field: "amount", direction: "asc" }],
        })
      : defaultLedgerTableSettings(scope);

    render(<LedgerPanel controller={ledger} />);

    expect(screen.getAllByRole("button", { name: /Open details for/ })
      .map((row) => row.getAttribute("aria-label")))
      .toEqual([
        "Open details for USD amount, 2026-07-30, Cash",
        "Open details for KRW amount, 2026-07-30, Cash",
      ]);
  });

  it.each([
    ["month", [["August 2026", "2"], ["July 2026", "1"]]],
    ["week", [["Week of 2026-07-27", "3"]]],
    ["day", [["2026-08-02", "1"], ["2026-08-01", "1"], ["2026-07-30", "1"]]],
    ["account", [["Cash", "3"]]],
    ["category", [["Uncategorized", "2"], ["Food", "1"]]],
    ["entry_type", [["Income", "1"], ["Transfer", "1"], ["Expense", "1"]]],
  ] as const)("counts active logical transaction %s groups", async (groupBy, expected) => {
    const user = userEvent.setup();
    const ledger = controller({ ...loadedState, entries: transactionEntries() });
    ledger.tableSettings = (scope) => scope === "ledger.transactions"
      ? transactionSettings({
          groupSettings: {
            ...defaultLedgerTableSettings("ledger.transactions").groupSettings,
            groupBy,
          },
        })
      : defaultLedgerTableSettings(scope);
    render(<LedgerPanel controller={ledger} />);

    await user.click(screen.getByRole("button", { name: "Group Transactions" }));
    const groups = screen.getByRole("list", { name: "Groups" });
    expect(within(groups).getAllByRole("listitem").map((item) => [
      item.querySelector(".planner-group-name")?.textContent,
      item.querySelector(".planner-group-count")?.textContent,
    ])).toEqual(expected.map((pair) => [...pair]));
    expect(within(groups).queryByText("Card")).toBeNull();
  });

  it("distinguishes no active logical transactions from no view matches", () => {
    const archived = transactionEntry("archived", "Archived", {
      deletedAt: "2026-08-01T00:00:00Z",
    });
    const ledger = controller({ ...loadedState, entries: [archived] });
    const view = render(<LedgerPanel controller={ledger} />);
    expect(screen.getByText("No transactions yet.")).toBeInTheDocument();

    const filtered = controller({
      ...loadedState,
      entries: [transactionEntry("expense", "Lunch")],
    });
    filtered.tableSettings = (scope) => scope === "ledger.transactions"
      ? transactionSettings({
          filterRules: [{
            id: "income-only",
            field: "entry_type",
            type: "select",
            operator: "is",
            value: ["income"],
          }],
        })
      : defaultLedgerTableSettings(scope);
    view.rerender(<LedgerPanel controller={filtered} />);
    expect(screen.getByText("No transactions match this view.")).toBeInTheDocument();
  });

  it("opens the detail-entry boundary from row pointer and keyboard activation only", async () => {
    const user = userEvent.setup();
    render(<LedgerPanel controller={controller({
      ...loadedState,
      entries: [transactionEntry("expense-1", "Lunch")],
    })} />);
    const row = screen.getByRole("button", {
      name: "Open details for Lunch, 2026-07-30, Cash",
    });
    const checkbox = screen.getByRole("checkbox", {
      name: "Select Lunch, 2026-07-30, Cash",
    });

    await user.click(checkbox);
    expect(screen.queryByRole("button", { name: "< Back" })).toBeNull();
    checkbox.focus();
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    expect(screen.queryByRole("button", { name: "< Back" })).toBeNull();

    await user.click(row);
    expect(screen.getByLabelText("Content")).toHaveValue("Lunch");
    await user.click(screen.getByRole("button", { name: "< Back" }));
    screen.getByRole("button", {
      name: "Open details for Lunch, 2026-07-30, Cash",
    }).focus();
    await user.keyboard("{Enter}");
    expect(screen.getByLabelText("Content")).toHaveValue("Lunch");
    await user.click(screen.getByRole("button", { name: "< Back" }));
    screen.getByRole("button", {
      name: "Open details for Lunch, 2026-07-30, Cash",
    }).focus();
    await user.keyboard(" ");
    expect(screen.getByLabelText("Content")).toHaveValue("Lunch");
  });

  it("renders a dedicated transaction detail with only user-facing fields", async () => {
    const user = userEvent.setup();
    render(<LedgerPanel controller={controller({
      ...loadedState,
      entries: transactionEntries(),
    })} />);

    await user.click(screen.getByRole("button", {
      name: "Open details for Lunch, 2026-07-30, Cash",
    }));
    const detail = screen.getByRole("region", { name: "Lunch details" });
    expect(screen.queryByRole("table", { name: "Transactions" })).toBeNull();
    expect(within(detail).getAllByRole("button").map((button) => button.getAttribute("aria-label")))
      .toEqual(["< Back", "Undo", "Redo", "Save", "Archive"]);
    for (const label of ["Content", "Date", "Type", "Account", "Category", "Amount", "Currency", "Note"]) {
      expect(within(detail).getByLabelText(label)).toBeInTheDocument();
    }
    expect(within(detail).queryByLabelText("Written at")).toBeNull();
    expect(within(detail).queryByLabelText("Source")).toBeNull();
    expect(within(detail).queryByText("expense-1")).toBeNull();

    await user.click(within(detail).getByRole("button", { name: "< Back" }));
    await user.click(screen.getByRole("button", {
      name: "Open details for Move funds, 2026-08-01, Cash → Card",
    }));
    const transferDetail = screen.getByRole("region", { name: "Move funds details" });
    expect(within(transferDetail).getByLabelText("Source account")).toHaveValue("account-cash");
    expect(within(transferDetail).getByLabelText("Destination account"))
      .toHaveValue("account-card");
    expect(within(transferDetail).queryByLabelText("Category")).toBeNull();
    expect(within(transferDetail).queryByLabelText("Type")).toBeNull();
  });

  it("keeps transaction Undo and Redo local until explicit Save", async () => {
    const user = userEvent.setup();
    const ledger = controller({
      ...loadedState,
      entries: [transactionEntry("expense-1", "Lunch")],
    });
    render(<LedgerPanel controller={ledger} />);
    await user.click(screen.getByRole("button", {
      name: "Open details for Lunch, 2026-07-30, Cash",
    }));
    const content = screen.getByLabelText("Content");
    const undo = screen.getByRole("button", { name: "Undo" });
    const redo = screen.getByRole("button", { name: "Redo" });
    const save = screen.getByRole("button", { name: "Save" });
    expect(undo).toBeDisabled();
    expect(redo).toBeDisabled();
    expect(save).toBeDisabled();

    await user.type(content, " updated");
    expect(ledger.updateEntry).not.toHaveBeenCalled();
    expect(undo).toBeEnabled();
    await user.click(undo);
    expect(content).toHaveValue("Lunch");
    expect(redo).toBeEnabled();
    await user.click(redo);
    expect(content).toHaveValue("Lunch updated");

    await user.click(save);
    expect(ledger.updateEntry).toHaveBeenCalledWith("expense-1", { content: "Lunch updated" });
    expect(save).toBeDisabled();
    await user.click(undo);
    expect(content).toHaveValue("Lunch");
    expect(save).toBeEnabled();
  });

  it("supports transaction history shortcuts and clears Redo after a new edit", async () => {
    const user = userEvent.setup();
    const ledger = controller({
      ...loadedState,
      entries: [transactionEntry("expense-1", "Lunch")],
    });
    render(<LedgerPanel controller={ledger} />);
    await user.click(screen.getByRole("button", {
      name: "Open details for Lunch, 2026-07-30, Cash",
    }));
    const content = screen.getByLabelText("Content");
    await user.type(content, " updated");

    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(content).toHaveValue("Lunch");
    fireEvent.keyDown(window, { key: "y", ctrlKey: true });
    expect(content).toHaveValue("Lunch updated");
    fireEvent.keyDown(window, { key: "z", metaKey: true });
    await user.type(content, " revised");
    expect(screen.getByRole("button", { name: "Redo" })).toBeDisabled();

    fireEvent.keyDown(window, { key: "s", metaKey: true });
    await waitFor(() => expect(ledger.updateEntry)
      .toHaveBeenCalledWith("expense-1", { content: "Lunch revised" }));
    fireEvent(window, new KeyboardEvent("keydown", {
      key: "z",
      ctrlKey: true,
      isComposing: true,
      bubbles: true,
    }));
    expect(content).toHaveValue("Lunch revised");
  });

  it("preserves the transaction draft and history when Save fails", async () => {
    const user = userEvent.setup();
    const ledger = controller({
      ...loadedState,
      entries: [transactionEntry("expense-1", "Lunch")],
    });
    ledger.updateEntry = vi.fn().mockRejectedValue(new Error("Transaction could not be saved"));
    render(<LedgerPanel controller={ledger} />);
    await user.click(screen.getByRole("button", {
      name: "Open details for Lunch, 2026-07-30, Cash",
    }));
    await user.type(screen.getByLabelText("Content"), " updated");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Transaction could not be saved");
    expect(screen.getByLabelText("Content")).toHaveValue("Lunch updated");
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByLabelText("Content")).toHaveValue("Lunch");
  });

  it("saves a transfer through the atomic transfer update boundary", async () => {
    const user = userEvent.setup();
    const ledger = controller({ ...loadedState, entries: transactionEntries() });
    render(<LedgerPanel controller={ledger} />);
    await user.click(screen.getByRole("button", {
      name: "Open details for Move funds, 2026-08-01, Cash → Card",
    }));
    const amount = screen.getByLabelText("Amount");
    await user.clear(amount);
    await user.type(amount, "3000");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(ledger.updateTransfer).toHaveBeenCalledWith("transfer-1", {
      date: "2026-08-01",
      content: "Move funds",
      fromAccount: "account-cash",
      toAccount: "account-card",
      amount: "3000",
      currency: "currency-krw",
      notes: null,
    });
    expect(ledger.updateEntry).not.toHaveBeenCalled();
  });

  it("guards Back only when the transaction draft is dirty", async () => {
    const user = userEvent.setup();
    const ledger = controller({
      ...loadedState,
      entries: [transactionEntry("expense-1", "Lunch")],
    });
    render(<LedgerPanel controller={ledger} />);
    await user.click(screen.getByRole("button", {
      name: "Open details for Lunch, 2026-07-30, Cash",
    }));
    await user.type(screen.getByLabelText("Content"), " updated");
    await user.click(screen.getByRole("button", { name: "< Back" }));

    const dialog = await screen.findByRole("dialog", { name: "Discard unsaved changes?" });
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.getByLabelText("Content")).toHaveValue("Lunch updated");
    await user.click(screen.getByRole("button", { name: "< Back" }));
    await user.click(within(await screen.findByRole("dialog", {
      name: "Discard unsaved changes?",
    })).getByRole("button", { name: "Discard changes" }));
    expect(screen.getByRole("table", { name: "Transactions" })).toBeInTheDocument();
  });

  it("archives a dirty transfer as one logical transaction after confirmation", async () => {
    const user = userEvent.setup();
    const ledger = controller({ ...loadedState, entries: transactionEntries() });
    render(<LedgerPanel controller={ledger} />);
    await user.click(screen.getByRole("button", {
      name: "Open details for Move funds, 2026-08-01, Cash → Card",
    }));
    await user.type(screen.getByLabelText("Content"), " updated");
    await user.click(screen.getByRole("button", { name: "Archive" }));

    const dialog = await screen.findByRole("dialog", { name: "Archive Move funds updated?" });
    expect(dialog).toHaveTextContent("Unsaved changes will be discarded");
    await user.click(within(dialog).getByRole("button", { name: "Archive" }));

    expect(ledger.archive).toHaveBeenCalledTimes(1);
    expect(ledger.archive).toHaveBeenCalledWith("transfer-out");
    expect(screen.queryByText("Move funds")).toBeNull();
    expect(screen.getByRole("table", { name: "Transactions" })).toBeInTheDocument();
  });

  it("keeps a failed transaction archive open for a safe retry", async () => {
    const user = userEvent.setup();
    const ledger = controller({
      ...loadedState,
      entries: [transactionEntry("expense-1", "Lunch")],
    });
    ledger.archive = vi.fn()
      .mockRejectedValueOnce(new Error("Transaction could not be archived"))
      .mockResolvedValueOnce(undefined);
    render(<LedgerPanel controller={ledger} />);
    await user.click(screen.getByRole("button", {
      name: "Open details for Lunch, 2026-07-30, Cash",
    }));
    await user.click(screen.getByRole("button", { name: "Archive" }));
    const dialog = await screen.findByRole("dialog", { name: "Archive Lunch?" });
    await user.click(within(dialog).getByRole("button", { name: "Archive" }));
    expect(await within(dialog).findByRole("alert"))
      .toHaveTextContent("Transaction could not be archived");
    expect(screen.getByLabelText("Content")).toHaveValue("Lunch");

    await user.click(within(dialog).getByRole("button", { name: "Archive" }));
    expect(ledger.archive).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("region", { name: "Lunch details" })).toBeNull();
  });

  it("gives duplicate transaction rows distinct contextual accessible names", () => {
    render(<LedgerPanel controller={controller({
      ...loadedState,
      entries: [
        transactionEntry("lunch-cash", "Lunch"),
        transactionEntry("lunch-card", "Lunch", {
          date: "2026-07-31",
          accountId: "account-card",
        }, { accountName: "Card" }),
      ],
    })} />);

    expect(screen.getByRole("button", {
      name: "Open details for Lunch, 2026-07-30, Cash",
    })).toBeInTheDocument();
    expect(screen.getByRole("button", {
      name: "Open details for Lunch, 2026-07-31, Card",
    })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", {
      name: "Select Lunch, 2026-07-30, Cash",
    })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", {
      name: "Select Lunch, 2026-07-31, Card",
    })).toBeInTheDocument();
  });

  it("invokes the transaction detail callback once per row activation only", async () => {
    const user = userEvent.setup();
    const ledger = controller({
      ...loadedState,
      entries: [transactionEntry("expense-1", "Lunch")],
    });
    const groups = deriveTransactionGroups(
      ledger.state.entries,
      ledger.tableSettings("ledger.transactions"),
    );
    const onOpen = vi.fn();
    render(
      <TransactionsTable
        controller={ledger}
        groups={groups}
        activeRowCount={1}
        selectedIds={[]}
        onOpen={onOpen}
        onToggle={vi.fn()}
        onToggleAll={vi.fn()}
        page={ledger.tablePage!("ledger.transactions")}
        onLoadMore={vi.fn()}
      />,
    );
    const row = screen.getByRole("button", {
      name: "Open details for Lunch, 2026-07-30, Cash",
    });

    await user.click(row);
    expect(onOpen).toHaveBeenCalledTimes(1);
    row.focus();
    await user.keyboard("{Enter}");
    expect(onOpen).toHaveBeenCalledTimes(2);
    await user.keyboard(" ");
    expect(onOpen).toHaveBeenCalledTimes(3);

    const checkbox = screen.getByRole("checkbox", {
      name: "Select Lunch, 2026-07-30, Cash",
    });
    await user.click(checkbox);
    checkbox.focus();
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    expect(onOpen).toHaveBeenCalledTimes(3);
  });

  it("closes an open transaction edit when its active logical row disappears", async () => {
    const user = userEvent.setup();
    const ledger = controller({
      ...loadedState,
      entries: [transactionEntry("expense-1", "Lunch")],
    });
    const view = render(<LedgerPanel controller={ledger} />);
    await user.click(screen.getByRole("button", {
      name: "Open details for Lunch, 2026-07-30, Cash",
    }));
    expect(screen.getByRole("button", { name: "< Back" }))
      .toBeInTheDocument();

    view.rerender(<LedgerPanel controller={controller({
      ...ledger.state,
      entries: [],
    })} />);

    await waitFor(() => expect(screen.queryByRole("button", {
      name: "< Back",
    })).toBeNull());
  });

  it("keeps an open transaction edit when only the current filter hides its row", async () => {
    const user = userEvent.setup();
    const ledger = controller({
      ...loadedState,
      entries: [transactionEntry("expense-1", "Lunch")],
    });
    const view = render(<LedgerPanel controller={ledger} />);
    await user.click(screen.getByRole("button", {
      name: "Open details for Lunch, 2026-07-30, Cash",
    }));
    const filtered: LedgerController = {
      ...ledger,
      tableSettings: (scope) => scope === "ledger.transactions"
          ? transactionSettings({
              filterRules: [{
                id: "income-only",
                field: "entry_type",
                type: "select",
                operator: "is",
                value: ["income"],
              }],
            })
          : ledger.tableSettings(scope),
    };

    view.rerender(<LedgerPanel controller={filtered} />);

    expect(screen.queryByRole("button", {
      name: "Open details for Lunch, 2026-07-30, Cash",
    })).toBeNull();
    expect(screen.getByRole("button", { name: "< Back" }))
      .toBeInTheDocument();
    expect(screen.getByLabelText("Content")).toHaveValue("Lunch");
  });

  it("selects visible logical rows and exposes indeterminate select-all state", async () => {
    const user = userEvent.setup();
    const ledger = controller({ ...loadedState, entries: transactionEntries() });
    const view = render(<LedgerPanel controller={ledger} />);
    const selectAll = screen.getByRole("checkbox", { name: "Select all visible transactions" });
    const deleteButton = screen.getByRole("button", {
      name: "Archive selected transactions",
    });
    expect(deleteButton).toBeDisabled();

    await user.click(screen.getByRole("checkbox", {
      name: "Select Salary, 2026-08-02, Cash",
    }));
    expect(selectAll).toHaveProperty("indeterminate", true);
    expect(deleteButton).toBeEnabled();
    await user.click(selectAll);
    expect(selectAll).toBeChecked();
    expect(selectAll).toHaveProperty("indeterminate", false);
    expect(screen.getAllByRole("checkbox", { name: /^Select (?!all)/ }))
      .toHaveLength(3);

    view.rerender(<LedgerPanel controller={controller({
      ...ledger.state,
      entries: [transactionEntry("expense-1", "Lunch")],
    })} />);
    await waitFor(() => expect(screen.getByRole("checkbox", {
      name: "Select Lunch, 2026-07-30, Cash",
    }))
      .toBeChecked());
    expect(screen.queryByRole("checkbox", {
      name: "Select Salary, 2026-08-02, Cash",
    })).toBeNull();
  });

  it("keeps Ledger tabs split from actions without changing the shared header alignment", async () => {
    render(<LedgerPanel controller={controller()} />);

    const tabs = screen.getByRole("tablist", { name: "Transactions views" });
    const add = screen.getByRole("button", { name: "Add transaction" });
    const remove = screen.getByRole("button", { name: "Archive selected transactions" });
    const actions = add.parentElement!;
    const row = actions.parentElement!;
    expect(row).toHaveClass("workspace-table-header-row", "ledger-table-header-row");
    expect(row.firstElementChild).toBe(tabs);
    expect(actions).toHaveClass("workspace-table-header-actions");
    expect([...actions.children]).toEqual([
      screen.getByRole("group", { name: "Transactions controls" }),
      add,
      remove,
    ]);

    const css = await fs.readFile(
      path.join(process.cwd(), "src/styles/globals.css"),
      "utf8",
    );
    const sharedRule = css.match(/\.workspace-table-header-row\s*\{([^}]*)\}/)?.[1];
    const ledgerRule = css.match(/\.ledger-table-header-row\s*\{([^}]*)\}/)?.[1];
    expect(sharedRule).toContain("justify-content: flex-end;");
    expect(ledgerRule).toContain("justify-content: space-between;");
  });

  it("uses the balanced Ledger report grid and stacks it at the narrow breakpoint", async () => {
    const css = await fs.readFile(
      path.join(process.cwd(), "src/styles/globals.css"),
      "utf8",
    );
    expect(css).toMatch(/\.ledger-report-compositions\s*\{[^}]*grid-template-columns:\s*repeat\(2,/s);
    const narrow = css.slice(css.indexOf("@media (max-width: 760px)"));
    expect(narrow).toMatch(/\.ledger-report-compositions\s*\{[^}]*grid-template-columns:\s*1fr/s);
    expect(css).toContain(".ledger-report-bars");
    expect(css).toContain(".ledger-report-bar-button:focus-visible");
  });

  it("uses the Transactions header structure for Accounts", () => {
    render(<LedgerPanel controller={controller()} leafTabId="accounts" />);

    const heading = screen.getByRole("heading", { name: "Accounts" });
    const header = heading.closest("header")!;
    const tabs = screen.getByRole("tablist", { name: "Accounts views" });
    const row = tabs.parentElement!;
    expect(row).toHaveClass("workspace-table-header-row", "ledger-table-header-row");
    expect(within(header).getByRole("button", { name: "Account settings" })).toBeInTheDocument();
    expect(within(header).getByRole("button", { name: "Add account" })).toBeInTheDocument();
    expect(within(header).getByRole("button", { name: "Delete selected" })).toBeDisabled();
  });

  it("uses the Transactions header structure for Categories", () => {
    render(<LedgerPanel controller={controller()} leafTabId="categories" />);

    const heading = screen.getByRole("heading", { name: "Categories" });
    const header = heading.closest("header")!;
    const tabs = screen.getByRole("tablist", { name: "Categories views" });
    const row = tabs.parentElement!;
    expect(row).toHaveClass("workspace-table-header-row", "ledger-table-header-row");
    expect(within(header).getByRole("button", { name: "Add category" })).toBeInTheDocument();
    expect(within(header).getByRole("button", { name: "Delete selected" })).toBeDisabled();
  });

  it("isolates a nested Ledger dialog without hiding its ancestors", async () => {
    const user = userEvent.setup();
    const view = render(
      <div className="workbench-shell">
        <aside>Navigation</aside>
        <main className="main-panel">
          <LedgerPanel controller={controller()} />
        </main>
      </div>,
    );

    await user.click(screen.getByRole("button", { name: "Add transaction" }));
    const dialog = screen.getByRole("dialog", { name: "Add transaction" });
    const header = within(dialog).getByRole("heading", { name: "Add transaction" }).closest("header")!;
    const close = within(dialog).getByRole("button", { name: "Close Add transaction" });
    const save = within(dialog).getByRole("button", { name: "Save" });
    const actions = close.parentElement!;

    expect(within(header).queryByRole("button")).toBeNull();
    expect(actions).toHaveClass("ledger-create-dialog-actions");
    expect(within(actions).getByRole("button", { name: "Save" })).toBe(save);
    expect(save).toHaveClass("ledger-create-dialog-save");
    expect(view.container).toHaveAttribute("aria-hidden", "true");
    expect(view.container).toHaveAttribute("inert");
    let ancestor = dialog.parentElement;
    while (ancestor) {
      expect(ancestor).not.toHaveAttribute("aria-hidden", "true");
      expect(ancestor).not.toHaveAttribute("inert");
      ancestor = ancestor.parentElement;
    }
  });

  it("keeps creation open and non-dismissible until the mutation resolves", async () => {
    const user = userEvent.setup();
    const save = deferred<void>();
    const ledger = controller();
    ledger.createEntry = vi.fn(() => save.promise);
    render(<LedgerPanel controller={ledger} />);

    const trigger = screen.getByRole("button", { name: "Add transaction" });
    await user.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Add transaction" });
    await user.type(screen.getByLabelText("Content"), "Lunch");
    await user.selectOptions(screen.getByLabelText("Account"), "account-cash");
    await user.type(screen.getByLabelText("Amount"), "12000");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close Add transaction" })).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(dialog).toBeInTheDocument();
    await user.click(dialog.parentElement!);
    expect(dialog).toBeInTheDocument();

    await act(async () => save.resolve());
    await waitFor(() => expect(screen.queryByRole("dialog", {
      name: "Add transaction",
    })).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it("keeps the production dialog mounted through its background refresh", async () => {
    const user = userEvent.setup();
    const supersededEntries = deferred<{ items: LedgerTableOccurrence[]; nextOffset: null }>();
    const refreshedEntries = deferred<{ items: LedgerTableOccurrence[]; nextOffset: null }>();
    vi.spyOn(ledgerApi, "queryTable")
      .mockResolvedValueOnce({ items: [], nextOffset: null })
      .mockReturnValueOnce(supersededEntries.promise)
      .mockReturnValueOnce(refreshedEntries.promise);
    vi.spyOn(ledgerApi, "tableLookups")
      .mockResolvedValue({ accounts: [], categories: [], currencies: [] });
    vi.spyOn(ledgerApi, "listEntries")
      .mockResolvedValue({ items: [], nextOffset: null });
    vi.spyOn(ledgerApi, "listCurrencies")
      .mockResolvedValue({ items: loadedState.currencies, nextOffset: null });
    vi.spyOn(ledgerApi, "listAccountCategories")
      .mockResolvedValue({ items: loadedState.accountCategories, nextOffset: null });
    vi.spyOn(ledgerApi, "listAccounts")
      .mockResolvedValue({ items: loadedState.accounts, nextOffset: null });
    vi.spyOn(ledgerApi, "listTransactionCategories")
      .mockResolvedValue({ items: loadedState.categories, nextOffset: null });
    vi.spyOn(ledgerApi, "listAccountBalances")
      .mockResolvedValue({ items: [], nextOffset: null });
    vi.spyOn(ledgerApi, "createEntry")
      .mockResolvedValue(entryView("created-entry", "Lunch").entry);

    let liveController!: LedgerController;
    function ProductionLedgerPanel() {
      liveController = useLedgerController();
      return <LedgerPanel controller={liveController} />;
    }

    render(<ProductionLedgerPanel />);
    const trigger = await screen.findByRole("button", { name: "Add transaction" });
    await user.click(trigger);
    await user.type(screen.getByLabelText("Content"), "Lunch");
    await user.selectOptions(screen.getByLabelText("Account"), "account-cash");
    await user.type(screen.getByLabelText("Amount"), "12000");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(ledgerApi.queryTable).toHaveBeenCalledTimes(2));
    act(() => {
      void liveController.refresh();
    });
    await waitFor(() => expect(ledgerApi.queryTable).toHaveBeenCalledTimes(3));

    expect(screen.getByRole("dialog", { name: "Add transaction" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close Add transaction" })).toBeDisabled();
    expect(screen.queryByText("Loading Ledger")).toBeNull();

    await act(async () => supersededEntries.resolve({
      items: [],
      nextOffset: null,
    }));
    expect(screen.getByRole("dialog", { name: "Add transaction" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close Add transaction" })).toBeDisabled();

    await act(async () => refreshedEntries.resolve({
      items: [transactionOccurrence("entry-1", "entry-1", "Lunch")],
      nextOffset: null,
    }));
    await waitFor(() => expect(screen.queryByRole("dialog", {
      name: "Add transaction",
    })).toBeNull());
    expect(screen.getByText("Lunch")).toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("keeps the production draft after the creation mutation rejects", async () => {
    const user = userEvent.setup();
    mockLedgerLoads();
    vi.spyOn(ledgerApi, "createEntry")
      .mockRejectedValue(new Error("Transaction could not be saved"));

    function ProductionLedgerPanel() {
      return <LedgerPanel controller={useLedgerController()} />;
    }

    render(<ProductionLedgerPanel />);
    await user.click(await screen.findByRole("button", { name: "Add transaction" }));
    await user.type(screen.getByLabelText("Content"), "Lunch");
    await user.selectOptions(screen.getByLabelText("Account"), "account-cash");
    await user.type(screen.getByLabelText("Amount"), "12000");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Transaction could not be saved",
    );
    expect(screen.getByRole("dialog", { name: "Add transaction" })).toBeInTheDocument();
    expect(screen.getByLabelText("Content")).toHaveValue("Lunch");
    expect(screen.getByLabelText("Amount")).toHaveValue("12000");
    const submit = screen.getByRole("button", { name: "Save" });
    expect(submit).not.toBeDisabled();
    expect(submit).toHaveFocus();
  });

  it("recovers a persisted creation with refresh-only retries", async () => {
    const user = userEvent.setup();
    vi.spyOn(ledgerApi, "queryTable")
      .mockResolvedValueOnce({ items: [], nextOffset: null })
      .mockRejectedValueOnce(new Error("Ledger refresh failed"))
      .mockRejectedValueOnce(new Error("Ledger refresh still failed"))
      .mockResolvedValue({
        items: [transactionOccurrence("entry-1", "entry-1", "Lunch")],
        nextOffset: null,
      });
    vi.spyOn(ledgerApi, "tableLookups")
      .mockResolvedValue({ accounts: [], categories: [], currencies: [] });
    vi.spyOn(ledgerApi, "listEntries")
      .mockResolvedValue({ items: [], nextOffset: null });
    vi.spyOn(ledgerApi, "listCurrencies")
      .mockResolvedValue({ items: loadedState.currencies, nextOffset: null });
    vi.spyOn(ledgerApi, "listAccountCategories")
      .mockResolvedValue({ items: loadedState.accountCategories, nextOffset: null });
    vi.spyOn(ledgerApi, "listAccounts")
      .mockResolvedValue({ items: loadedState.accounts, nextOffset: null });
    vi.spyOn(ledgerApi, "listTransactionCategories")
      .mockResolvedValue({ items: loadedState.categories, nextOffset: null });
    vi.spyOn(ledgerApi, "listAccountBalances")
      .mockResolvedValue({ items: [], nextOffset: null });
    vi.spyOn(ledgerApi, "createEntry")
      .mockResolvedValue(entryView("created-entry", "Lunch").entry);

    function ProductionLedgerPanel() {
      return <LedgerPanel controller={useLedgerController()} />;
    }

    render(<ProductionLedgerPanel />);
    await user.click(await screen.findByRole("button", { name: "Add transaction" }));
    await user.type(screen.getByLabelText("Content"), "Lunch");
    await user.selectOptions(screen.getByLabelText("Account"), "account-cash");
    await user.type(screen.getByLabelText("Amount"), "12000");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Transaction saved, but the list could not refresh.",
    );
    expect(ledgerApi.createEntry).toHaveBeenCalledOnce();
    expect(screen.getByRole("dialog", { name: "Add transaction" })).toBeInTheDocument();
    expect(screen.getByLabelText("Content")).toHaveValue("Lunch");
    expect(screen.getByRole("button", { name: "Saved" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Close Add transaction" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Retry refresh" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Transaction saved, but the list could not refresh.",
    );
    expect(screen.getByRole("dialog", { name: "Add transaction" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry refresh" })).not.toBeDisabled();
    expect(ledgerApi.createEntry).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("button", { name: "Retry refresh" }));
    await waitFor(() => expect(screen.queryByRole("dialog", {
      name: "Add transaction",
    })).toBeNull());
    expect(screen.getByText("Lunch")).toBeInTheDocument();
    expect(ledgerApi.createEntry).toHaveBeenCalledOnce();
  });

  it.each(["ordinary-first", "creation-first"] as const)(
    "keeps creation recovery mounted when %s refresh is superseded by a failed peer",
    async (order) => {
      const user = userEvent.setup();
      const older = deferred<{ items: LedgerTableOccurrence[]; nextOffset: null }>();
      const winner = deferred<{ items: LedgerTableOccurrence[]; nextOffset: null }>();
      vi.spyOn(ledgerApi, "queryTable")
        .mockResolvedValueOnce({ items: [], nextOffset: null })
        .mockReturnValueOnce(older.promise)
        .mockReturnValueOnce(winner.promise);
      vi.spyOn(ledgerApi, "tableLookups")
        .mockResolvedValue({ accounts: [], categories: [], currencies: [] });
      vi.spyOn(ledgerApi, "listEntries")
        .mockResolvedValue({ items: [], nextOffset: null });
      vi.spyOn(ledgerApi, "listCurrencies")
        .mockResolvedValue({ items: loadedState.currencies, nextOffset: null });
      vi.spyOn(ledgerApi, "listAccountCategories")
        .mockResolvedValue({ items: loadedState.accountCategories, nextOffset: null });
      vi.spyOn(ledgerApi, "listAccounts")
        .mockResolvedValue({ items: loadedState.accounts, nextOffset: null });
      vi.spyOn(ledgerApi, "listTransactionCategories")
        .mockResolvedValue({ items: loadedState.categories, nextOffset: null });
      vi.spyOn(ledgerApi, "listAccountBalances")
        .mockResolvedValue({ items: [], nextOffset: null });
      vi.spyOn(ledgerApi, "createEntry").mockResolvedValue({} as never);
      vi.spyOn(ledgerApi, "archiveEntry").mockResolvedValue({} as never);

      let liveController!: LedgerController;
      function ProductionLedgerPanel() {
        liveController = useLedgerController();
        return <LedgerPanel controller={liveController} />;
      }

      render(<ProductionLedgerPanel />);
      await user.click(await screen.findByRole("button", { name: "Add transaction" }));
      await user.type(screen.getByLabelText("Content"), "Lunch");
      await user.selectOptions(screen.getByLabelText("Account"), "account-cash");
      await user.type(screen.getByLabelText("Amount"), "12000");

      let ordinary!: Promise<void>;
      if (order === "ordinary-first") {
        act(() => {
          ordinary = liveController.archive("entry-existing");
        });
        await waitFor(() => expect(ledgerApi.queryTable).toHaveBeenCalledTimes(2));
        await user.click(screen.getByRole("button", { name: "Save" }));
      } else {
        await user.click(screen.getByRole("button", { name: "Save" }));
        await waitFor(() => expect(ledgerApi.queryTable).toHaveBeenCalledTimes(2));
        act(() => {
          ordinary = liveController.archive("entry-existing");
        });
      }
      await waitFor(() => expect(ledgerApi.queryTable).toHaveBeenCalledTimes(3));

      await act(async () => {
        winner.reject(new Error("Mixed refresh failed"));
        if (order === "creation-first") await ordinary;
      });
      await act(async () => {
        older.resolve({ items: [], nextOffset: null });
        if (order === "ordinary-first") await ordinary;
      });

      expect(await screen.findByText("Mixed refresh failed")).toBeInTheDocument();
      expect(await screen.findByText(
        "Transaction saved, but the list could not refresh.",
      )).toBeInTheDocument();
      expect(screen.getByRole("dialog", { name: "Add transaction" }))
        .toBeInTheDocument();
      expect(screen.getByLabelText("Content")).toHaveValue("Lunch");
      expect(screen.getByRole("button", { name: "Saved" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Close Add transaction" })).toBeDisabled();
    },
  );

  it("keeps the draft and inline error open after a rejected creation", async () => {
    const user = userEvent.setup();
    const save = deferred<void>();
    const ledger = controller();
    ledger.createEntry = vi.fn(() => save.promise);
    render(<LedgerPanel controller={ledger} />);

    const trigger = screen.getByRole("button", { name: "Add transaction" });
    await user.click(trigger);
    await user.type(screen.getByLabelText("Content"), "Lunch");
    await user.selectOptions(screen.getByLabelText("Account"), "account-cash");
    await user.type(screen.getByLabelText("Amount"), "12000");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await act(async () => save.reject(new Error("Transaction could not be saved")));

    expect(screen.getByRole("dialog", { name: "Add transaction" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Transaction could not be saved");
    expect(screen.getByLabelText("Content")).toHaveValue("Lunch");
    expect(screen.getByLabelText("Amount")).toHaveValue("12000");
    const close = screen.getByRole("button", { name: "Close Add transaction" });
    expect(close).not.toBeDisabled();
    await user.click(close);
    expect(screen.queryByRole("dialog", { name: "Add transaction" })).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("traps focus and restores the Add trigger when Escape closes the idle dialog", async () => {
    const user = userEvent.setup();
    render(<LedgerPanel controller={controller()} />);

    const trigger = screen.getByRole("button", { name: "Add transaction" });
    await user.click(trigger);
    const close = screen.getByRole("button", { name: "Close Add transaction" });
    const save = screen.getByRole("button", { name: "Save" });
    expect(close).toHaveFocus();

    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(save).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Add transaction" })).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("skips inactive transaction tabs in the Add transaction focus order", async () => {
    const user = userEvent.setup();
    render(<LedgerPanel controller={controller()} />);

    await user.click(screen.getByRole("button", { name: "Add transaction" }));
    await user.tab();
    expect(screen.getByRole("tab", { name: "Expense" })).toHaveFocus();

    await user.tab();
    expect(screen.getByLabelText("Date")).toHaveFocus();
  });

  it("renders blocking load errors and non-blocking loaded errors", async () => {
    const user = userEvent.setup();
    const loadedErrorController = controller({
      ...loadedState,
      error: "Ledger refresh failed",
    });
    const { rerender } = render(
      <LedgerPanel controller={controller({ ...loadedState, status: "loading" })} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Loading Ledger");

    rerender(
      <LedgerPanel
        controller={controller({
          ...loadedState,
          status: "error",
          error: "Ledger is unavailable",
        })}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Ledger is unavailable");

    rerender(<LedgerPanel controller={loadedErrorController} />);
    expect(screen.getByRole("heading", { name: "Transactions" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Ledger refresh failed");
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(loadedErrorController.refresh).toHaveBeenCalledOnce();
  });

  it("loads account and category references into their leaves", () => {
    const ledger = controller({
      ...loadedState,
      balances: [{
        account: loadedState.accounts[0]!,
        currencyCode: "KRW",
        decimalPlaces: 0,
        currentBalanceMinor: 0,
      }],
    });
    const { rerender } = render(
      <LedgerPanel leafTabId="accounts" controller={ledger} />,
    );
    expect(screen.getByRole("heading", { name: "Accounts" })).toBeInTheDocument();
    const accountsTable = screen.getByRole("table");
    expect(within(accountsTable).getAllByText("Cash")).toHaveLength(2);
    expect(within(accountsTable).getByText("0 KRW")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add transaction" })).toBeNull();

    rerender(<LedgerPanel leafTabId="categories" controller={ledger} />);
    expect(screen.getByRole("heading", { name: "Categories" })).toBeInTheDocument();
    expect(within(screen.getByRole("table")).getByText("Food")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add transaction" })).toBeNull();
  });

  it("confirms and archives selected logical rows sequentially", async () => {
    const user = userEvent.setup();
    const firstArchive = deferred<void>();
    const ledger = controller({ ...loadedState, entries: transactionEntries() });
    ledger.archive = vi.fn((id: string) => id === "expense-1"
      ? firstArchive.promise
      : Promise.resolve());
    render(<LedgerPanel controller={ledger} />);
    const addButton = screen.getByRole("button", { name: "Add transaction" });

    await user.click(screen.getByRole("checkbox", {
      name: "Select Lunch, 2026-07-30, Cash",
    }));
    await user.click(screen.getByRole("checkbox", {
      name: "Select Move funds, 2026-08-01, Cash → Card",
    }));
    await user.click(screen.getByRole("button", { name: "Archive selected transactions" }));
    const dialog = screen.getByRole("dialog", { name: "Archive selected transactions?" });
    expect(dialog).toHaveTextContent(
      "2 transactions will be archived and removed from Ledger views.",
    );
    await user.click(within(dialog).getByRole("button", { name: "Archive" }));
    expect(ledger.archive).toHaveBeenCalledTimes(1);
    expect(ledger.archive).toHaveBeenNthCalledWith(1, "expense-1");

    await act(async () => firstArchive.resolve());
    await waitFor(() => expect(ledger.archive).toHaveBeenCalledTimes(2));
    expect(ledger.archive).toHaveBeenNthCalledWith(2, "transfer-out");
    await waitFor(() => expect(screen.queryByRole("dialog", {
      name: "Archive selected transactions?",
    })).toBeNull());
    expect(screen.getByRole("button", { name: "Archive selected transactions" }))
      .toBeDisabled();
    expect(screen.queryByRole("checkbox", {
      name: "Select Lunch, 2026-07-30, Cash",
    })).toBeNull();
    expect(screen.queryByRole("checkbox", {
      name: "Select Move funds, 2026-08-01, Cash → Card",
    })).toBeNull();
    await waitFor(() => expect(addButton).toHaveFocus());
    expect(ledger.restore).not.toHaveBeenCalled();
    expect(ledger.purge).not.toHaveBeenCalled();
  });

  it("removes archived rows from stale transaction group candidates", async () => {
    const user = userEvent.setup();
    const ledger = controller({
      ...loadedState,
      entries: [transactionEntry("expense-1", "Lunch")],
    });
    ledger.tableSettings = (scope) => scope === "ledger.transactions"
      ? transactionSettings({
          groupSettings: {
            ...defaultLedgerTableSettings("ledger.transactions").groupSettings,
            groupBy: "account",
          },
        })
      : defaultLedgerTableSettings(scope);
    ledger.archive = vi.fn().mockResolvedValue(undefined);
    render(<LedgerPanel controller={ledger} />);

    await user.click(screen.getByRole("checkbox", {
      name: "Select Lunch, 2026-07-30, Cash",
    }));
    await user.click(screen.getByRole("button", { name: "Archive selected transactions" }));
    await user.click(within(screen.getByRole("dialog", {
      name: "Archive selected transactions?",
    })).getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(screen.queryByText("Lunch")).toBeNull());

    await user.click(screen.getByRole("button", { name: "Group Transactions" }));
    expect(within(screen.getByRole("list", { name: "Groups" })).queryByText("Cash"))
      .toBeNull();
  });

  it("retains failed and unattempted selections after a partial archive failure", async () => {
    const user = userEvent.setup();
    const ledger = controller({ ...loadedState, entries: transactionEntries() });
    ledger.archive = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("Could not archive selected transactions."))
      .mockResolvedValue(undefined);
    render(<LedgerPanel controller={ledger} />);

    await user.click(screen.getByRole("checkbox", {
      name: "Select Salary, 2026-08-02, Cash",
    }));
    await user.click(screen.getByRole("checkbox", {
      name: "Select Move funds, 2026-08-01, Cash → Card",
    }));
    await user.click(screen.getByRole("checkbox", {
      name: "Select Lunch, 2026-07-30, Cash",
    }));
    await user.click(screen.getByRole("button", { name: "Archive selected transactions" }));
    const dialog = screen.getByRole("dialog", { name: "Archive selected transactions?" });
    await user.click(within(dialog).getByRole("button", { name: "Archive" }));

    expect(await within(dialog).findByRole("alert"))
      .toHaveTextContent("Could not archive selected transactions.");
    expect(ledger.archive).toHaveBeenCalledTimes(2);
    expect(ledger.archive).toHaveBeenNthCalledWith(1, "income-1");
    expect(ledger.archive).toHaveBeenNthCalledWith(2, "transfer-out");
    expect(screen.queryByLabelText("Select Salary, 2026-08-02, Cash")).toBeNull();
    expect(screen.getByLabelText("Select Move funds, 2026-08-01, Cash → Card"))
      .toBeChecked();
    expect(screen.getByLabelText("Select Lunch, 2026-07-30, Cash")).toBeChecked();
    await user.click(within(dialog).getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(ledger.archive).toHaveBeenCalledTimes(4));
    expect(ledger.archive).toHaveBeenNthCalledWith(3, "transfer-out");
    expect(ledger.archive).toHaveBeenNthCalledWith(4, "expense-1");
    expect(vi.mocked(ledger.archive).mock.calls.filter(([id]) => id === "income-1"))
      .toHaveLength(1);
    await waitFor(() => expect(screen.queryByRole("dialog", {
      name: "Archive selected transactions?",
    })).toBeNull());
  });

  it("clears a failed archive error before reopening confirmation", async () => {
    const user = userEvent.setup();
    const ledger = controller({
      ...loadedState,
      entries: [transactionEntry("expense-1", "Lunch")],
    });
    ledger.archive = vi.fn().mockRejectedValue(new Error("Archive failed"));
    render(<LedgerPanel controller={ledger} />);

    await user.click(screen.getByRole("checkbox", {
      name: "Select Lunch, 2026-07-30, Cash",
    }));
    const archive = screen.getByRole("button", { name: "Archive selected transactions" });
    await user.click(archive);
    let dialog = screen.getByRole("dialog", { name: "Archive selected transactions?" });
    await user.click(within(dialog).getByRole("button", { name: "Archive" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Archive failed");

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await user.click(archive);
    dialog = screen.getByRole("dialog", { name: "Archive selected transactions?" });
    expect(within(dialog).queryByRole("alert")).toBeNull();
  });

  it("keeps a persisted archive hidden across Ledger tab unmounts", async () => {
    const user = userEvent.setup();
    mockLedgerLoads();
    vi.mocked(ledgerApi.queryTable)
      .mockResolvedValueOnce({
        items: [transactionOccurrence("expense-1", "expense-1", "Lunch")],
        nextOffset: null,
      })
      .mockRejectedValueOnce(new Error("Ledger refresh failed"))
      .mockResolvedValue({ items: [], nextOffset: null });
    vi.spyOn(ledgerApi, "archiveEntry").mockResolvedValue({} as never);

    function ProductionLedgerPanel({
      leafTabId = "transactions",
    }: {
      leafTabId?: "transactions" | "accounts";
    }) {
      return <LedgerPanel controller={useLedgerController()} leafTabId={leafTabId} />;
    }

    const view = render(<ProductionLedgerPanel />);
    await screen.findByRole("button", {
      name: "Open details for Lunch, 2026-07-30, Cash",
    });
    await user.click(screen.getByRole("checkbox", {
      name: "Select Lunch, 2026-07-30, Cash",
    }));
    await user.click(screen.getByRole("button", { name: "Archive selected transactions" }));
    await user.click(within(screen.getByRole("dialog", {
      name: "Archive selected transactions?",
    })).getByRole("button", { name: "Archive" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Ledger refresh failed");
    expect(screen.queryByRole("button", {
      name: "Open details for Lunch, 2026-07-30, Cash",
    })).toBeNull();
    expect(ledgerApi.archiveEntry).toHaveBeenCalledOnce();

    view.rerender(<ProductionLedgerPanel leafTabId="accounts" />);
    expect(screen.getByRole("heading", { name: "Accounts" })).toBeInTheDocument();
    view.rerender(<ProductionLedgerPanel />);
    expect(screen.getByRole("alert")).toHaveTextContent("Ledger refresh failed");
    expect(screen.queryByRole("button", {
      name: "Open details for Lunch, 2026-07-30, Cash",
    })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load rows.");
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(screen.queryByText("Lunch")).toBeNull();
    expect(ledgerApi.archiveEntry).toHaveBeenCalledOnce();
  });

  it("keeps offset-zero retry visible when every preserved transaction is tombstoned", async () => {
    const user = userEvent.setup();
    mockLedgerLoads();
    let transactionCalls = 0;
    vi.mocked(ledgerApi.queryTable).mockImplementation(async (scope, _settings, offset) => {
      if (scope !== "ledger.transactions") return { items: [], nextOffset: null };
      transactionCalls += 1;
      if (transactionCalls === 1) {
        return {
          items: [transactionOccurrence("expense-1", "expense-1", "Lunch")],
          nextOffset: 50,
        };
      }
      if (transactionCalls === 2) throw new Error("Ledger refresh failed");
      return {
        items: [transactionOccurrence("refilled", "refilled", "Refilled row")],
        nextOffset: null,
      };
    });
    vi.spyOn(ledgerApi, "archiveEntry").mockResolvedValue({} as never);

    function TombstoneRetryHarness() {
      const ledger = useLedgerController();
      return (
        <>
          <button type="button" onClick={() => void ledger.ensureTable?.("ledger.accounts")}>
            Load accounts scope
          </button>
          <LedgerPanel controller={ledger} />
        </>
      );
    }

    render(<TombstoneRetryHarness />);
    await screen.findByRole("button", {
      name: "Open details for Lunch, 2026-07-30, Cash",
    });
    await user.click(screen.getByRole("checkbox", {
      name: "Select Lunch, 2026-07-30, Cash",
    }));
    await user.click(screen.getByRole("button", { name: "Archive selected transactions" }));
    await user.click(within(screen.getByRole("dialog", {
      name: "Archive selected transactions?",
    })).getByRole("button", { name: "Archive" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Ledger refresh failed");
    expect(screen.queryByText("Lunch")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Load accounts scope" }));

    expect(await screen.findByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.queryByText("No transactions yet.")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("Refilled row")).toBeInTheDocument();
    expect(transactionCalls).toBe(3);
    expect(ledgerApi.queryTable).toHaveBeenLastCalledWith(
      "ledger.transactions", expect.anything(), 0, expect.any(Date),
    );
  });

  it("archives the snapshotted targets despite in-flight visibility changes", async () => {
    const user = userEvent.setup();
    const firstArchive = deferred<void>();
    const ledger = controller({ ...loadedState, entries: transactionEntries() });
    ledger.archive = vi.fn((id: string) => id === "expense-1"
      ? firstArchive.promise
      : Promise.resolve());
    const view = render(<LedgerPanel controller={ledger} />);

    await user.click(screen.getByRole("checkbox", {
      name: "Select Lunch, 2026-07-30, Cash",
    }));
    await user.click(screen.getByRole("checkbox", {
      name: "Select Move funds, 2026-08-01, Cash → Card",
    }));
    await user.click(screen.getByRole("button", { name: "Archive selected transactions" }));
    await user.click(within(screen.getByRole("dialog", {
      name: "Archive selected transactions?",
    })).getByRole("button", { name: "Archive" }));
    expect(ledger.archive).toHaveBeenCalledTimes(1);

    const changed = {
      ...ledger,
      state: {
        ...ledger.state,
        entries: [
          transactionEntry("income-1", "Salary", {
            date: "2026-08-02",
            entryType: "income" as const,
          }),
          transactionEntry("new-income", "Bonus", {
            date: "2026-08-05",
            entryType: "income" as const,
          }),
        ],
      },
    };
    view.rerender(<LedgerPanel controller={changed} />);
    await act(async () => firstArchive.resolve());

    await waitFor(() => expect(ledger.archive).toHaveBeenCalledTimes(2));
    expect(vi.mocked(ledger.archive).mock.calls).toEqual([
      ["expense-1"],
      ["transfer-out"],
    ]);
  });

  it("does not expose transaction edit, archive, restore, or purge action buttons", () => {
    render(<LedgerPanel controller={controller({
      ...loadedState,
      entries: transactionEntries(),
    })} />);

    expect(screen.queryByRole("button", { name: /^Edit / })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Archive (?!selected)/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Restore / })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Purge / })).toBeNull();
  });

  it("loads the current month once when Reports opens, including in StrictMode", async () => {
    const ledger = controller();
    render(
      <React.StrictMode>
        <LedgerPanel leafTabId="reports" controller={ledger} />
      </React.StrictMode>,
    );

    await waitFor(() => expect(ledger.runReports).toHaveBeenCalledTimes(1));
    expect(ledger.runReports).toHaveBeenCalledWith({ period: "current_month" });
    expect(screen.getByRole("button", { name: "Current month" }))
      .toHaveAttribute("aria-pressed", "true");
  });

  it("uses the initial report period and preserves its currency until options load", async () => {
    const ledger = controller();
    const view = render(
      <LedgerPanel
        leafTabId="reports"
        controller={ledger}
        initialReportSelection={{ period: "previous_month" }}
        initialReportCurrencyId="currency-usd"
      />,
    );

    await waitFor(() => expect(ledger.runReports).toHaveBeenCalledTimes(1));
    expect(ledger.runReports).toHaveBeenCalledWith({ period: "previous_month" });
    expect(ledger.runReports).not.toHaveBeenCalledWith({ period: "current_month" });

    view.rerender(
      <LedgerPanel
        leafTabId="reports"
        controller={controller(reportAnalysisState())}
      />,
    );

    expect(screen.getByRole("button", { name: "USD" }))
      .toHaveAttribute("aria-pressed", "true");
    expect(ledger.runReports).toHaveBeenCalledTimes(1);
  });

  it("submits each Reports period preset", async () => {
    const user = userEvent.setup();
    const ledger = controller();
    render(<LedgerPanel leafTabId="reports" controller={ledger} />);

    await user.click(screen.getByRole("button", { name: "Previous month" }));
    await user.click(screen.getByRole("button", { name: "Current year" }));

    expect(ledger.runReports).toHaveBeenNthCalledWith(2, { period: "previous_month" });
    expect(ledger.runReports).toHaveBeenNthCalledWith(3, { period: "current_year" });
  });

  it("opens Custom range and applies a valid range explicitly", async () => {
    const user = userEvent.setup();
    const runReports = vi.fn();
    const applyRequest = deferred<void>();

    function CustomRangeHarness() {
      const [reportSelection, setReportSelection] = React.useState<LedgerState["reportSelection"]>({
        period: "current_month",
      });
      const [reportStatus, setReportStatus] = React.useState<LedgerState["reportStatus"]>("idle");
      const ledger = controller({ ...loadedState, reportSelection, reportStatus });
      runReports.mockImplementation(async (selection: LedgerState["reportSelection"]) => {
        if (selection.period === "custom") {
          setReportStatus("loading");
          await applyRequest.promise;
        }
        setReportSelection(selection);
        setReportStatus("loaded");
      });
      ledger.runReports = runReports;
      return <LedgerPanel leafTabId="reports" controller={ledger} />;
    }

    render(<CustomRangeHarness />);

    const custom = screen.getByRole("button", { name: "Custom range" });
    expect(custom).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("Start")).toBeNull();

    await user.click(custom);
    expect(custom).toHaveAttribute("aria-expanded", "true");
    const apply = screen.getByRole("button", { name: "Apply" });
    expect(apply).toBeDisabled();

    await user.type(screen.getByLabelText("Start"), "2026-07-01");
    await user.type(screen.getByLabelText("End"), "2026-07-31");
    expect(runReports).toHaveBeenCalledTimes(1);
    expect(apply).toBeEnabled();

    await user.click(apply);

    expect(runReports).toHaveBeenLastCalledWith({
      period: "custom",
      from: "2026-07-01",
      to: "2026-07-31",
    });
    expect(screen.getByLabelText("Start")).toBeDisabled();
    expect(screen.getByLabelText("End")).toBeDisabled();

    await act(async () => applyRequest.resolve(undefined));

    await waitFor(() => expect(custom).toHaveAttribute("aria-expanded", "false"));
    expect(custom).toHaveAttribute("aria-pressed", "true");
    expect(custom).toHaveFocus();
    expect(screen.queryByLabelText("Start")).toBeNull();

    await user.click(custom);
    expect(screen.getByLabelText("Start")).toHaveValue("2026-07-01");
    expect(screen.getByLabelText("End")).toHaveValue("2026-07-31");
  });

  it("keeps invalid custom ranges disabled and collapses the editor for a preset", async () => {
    const user = userEvent.setup();
    const ledger = controller();
    render(<LedgerPanel leafTabId="reports" controller={ledger} />);

    await user.click(screen.getByRole("button", { name: "Custom range" }));
    await user.type(screen.getByLabelText("Start"), "2026-08-31");
    await user.type(screen.getByLabelText("End"), "2026-08-01");

    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
    expect(ledger.runReports).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Previous month" }));
    expect(screen.queryByLabelText("Start")).toBeNull();
    expect(ledger.runReports).toHaveBeenLastCalledWith({ period: "previous_month" });
  });

  it("keeps a failed custom range open with its entered dates", async () => {
    const user = userEvent.setup();
    const ledger = controller();
    ledger.runReports = vi.fn().mockRejectedValue(new Error("Custom range failed"));
    render(<LedgerPanel leafTabId="reports" controller={ledger} />);

    const custom = screen.getByRole("button", { name: "Custom range" });
    await user.click(custom);
    await user.type(screen.getByLabelText("Start"), "2026-07-01");
    await user.type(screen.getByLabelText("End"), "2026-07-31");
    await user.click(screen.getByRole("button", { name: "Apply" }));

    expect(custom).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText("Start")).toHaveValue("2026-07-01");
    expect(screen.getByLabelText("End")).toHaveValue("2026-07-31");
  });

  it("clears a rejected custom-range error after report retry succeeds", async () => {
    const user = userEvent.setup();

    function ReportRetryHarness() {
      const [reportError, setReportError] = React.useState<string | null>(null);
      const ledger = controller({
        ...loadedState,
        reportStatus: reportError ? "error" : "loaded",
        reportError,
      });
      ledger.runReports = vi.fn(async () => {
        setReportError("Custom range failed");
        throw new Error("Custom range failed");
      });
      ledger.retryReports = vi.fn(async () => {
        setReportError(null);
      });
      return <LedgerPanel leafTabId="reports" controller={ledger} />;
    }

    render(<ReportRetryHarness />);
    const custom = screen.getByRole("button", { name: "Custom range" });
    await user.click(custom);
    await user.type(screen.getByLabelText("Start"), "2026-07-01");
    await user.type(screen.getByLabelText("End"), "2026-07-31");
    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Custom range failed");
    expect(custom).toHaveAttribute("aria-expanded", "true");

    await user.click(screen.getByRole("button", { name: "Retry reports" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("keeps currencies separate and preserves the selected currency through loading and retry", async () => {
    const user = userEvent.setup();
    const retryReports = vi.fn().mockResolvedValue(undefined);
    const loaded = controller(reportAnalysisState());
    loaded.retryReports = retryReports;
    const view = render(<LedgerPanel leafTabId="reports" controller={loaded} />);

    const currencyGroup = screen.getByRole("group", { name: "Report currency" });
    const krw = within(currencyGroup).getByRole("button", { name: "KRW" });
    const usd = within(currencyGroup).getByRole("button", { name: "USD" });
    expect(screen.queryByRole("tablist", { name: "Report currency" })).toBeNull();
    expect(krw).toHaveAttribute("aria-pressed", "true");
    krw.focus();
    await user.tab();
    expect(usd).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(usd).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("region", { name: "Report analysis" })).toHaveTextContent("12.34 USD");
    expect(screen.getByRole("region", { name: "Report analysis" })).not.toHaveTextContent("3000 KRW");
    expect(screen.getByRole("img", { name: "Liability composition, total 0 USD" }))
      .toBeInTheDocument();
    expect(screen.getByText("No liability balances for this currency."))
      .toBeInTheDocument();

    view.rerender(<LedgerPanel leafTabId="reports" controller={controller(reportAnalysisState({
      reportStatus: "loading",
    }))} />);
    expect(screen.getByRole("button", { name: "USD" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("region", { name: "Report analysis" })).toHaveAttribute("aria-busy", "true");

    const failed = controller(reportAnalysisState({
      reportStatus: "error",
      reportError: "Report service unavailable",
    }));
    failed.retryReports = retryReports;
    view.rerender(<LedgerPanel leafTabId="reports" controller={failed} />);
    expect(screen.getByRole("button", { name: "USD" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Retry reports" }));
    expect(retryReports).toHaveBeenCalledTimes(1);
  });

  it("renders the balanced six-metric summary and separate asset and liability donuts", () => {
    render(<LedgerPanel leafTabId="reports" controller={controller(reportAnalysisState())} />);

    const summary = screen.getByRole("region", { name: "Summary" });
    for (const label of [
      "Total assets",
      "Total liabilities",
      "Net assets",
      "Income",
      "Spending",
      "Average daily spending",
    ]) expect(within(summary).getByRole("group", { name: label })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Asset composition/ })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Liability composition/ })).toBeInTheDocument();
  });

  it("includes each donut slice value in its accessible button name", () => {
    const state = reportAnalysisState();
    state.comparison!.currencies[0]!.current.incomeMinor = 3_650_000;
    state.comparison!.current.currencies[0]!.incomeMinor = 3_650_000;
    render(<LedgerPanel leafTabId="reports" controller={controller(state)} />);

    expect(within(screen.getByRole("region", { name: "Summary" }))
      .getByRole("group", { name: "Income" }))
      .toHaveTextContent("3,650,000 KRW");
    expect(screen.getByRole("button", { name: /Cash, 67%, 2,000 KRW/ }))
      .toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Food, 58%, 700 KRW/ }))
      .toBeInTheDocument();
  });

  it("groups signed and two-decimal account composition amounts", async () => {
    const user = userEvent.setup();
    const state = reportAnalysisState();
    state.balances = state.balances.map((balance) => balance.account.id === "account-card"
      ? { ...balance, currentBalanceMinor: -650_000 }
      : balance.account.id === "account-dollar-cash"
        ? { ...balance, currentBalanceMinor: 125_000 }
        : { ...balance, currentBalanceMinor: 0 });
    render(<LedgerPanel leafTabId="reports" controller={controller(state)} />);

    expect(within(screen.getByRole("region", { name: "Summary" }))
      .getByRole("group", { name: "Net assets" }))
      .toHaveTextContent("-650,000 KRW");
    expect(screen.getByRole("button", { name: /Credit card, 100%, 650,000 KRW/ }))
      .toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "USD" }));
    expect(screen.getByRole("img", { name: /Asset composition, total 1,250.00 USD/ }))
      .toBeInTheDocument();
  });

  it("shows one category heading and matching color keys for donut legend rows", () => {
    const { container } = render(
      <LedgerPanel leafTabId="reports" controller={controller(reportAnalysisState())} />,
    );

    expect(screen.getAllByRole("heading", { name: "Spending by category" }))
      .toHaveLength(1);
    const keys = container.querySelectorAll(".ledger-report-donut-key");
    expect(keys).toHaveLength(5);
    expect(keys[0]).toHaveStyle({ background: "var(--color-chart-primary)" });
    expect(keys[1]).toHaveStyle({ background: "var(--color-chart-secondary)" });
  });

  it("drills from Uncategorized while keeping Other noninteractive", async () => {
    const user = userEvent.setup();
    const onReportDrilldown = vi.fn();
    const categoryBreakdown = Array.from({ length: 8 }, (_, index) => ({
      currencyId: "currency-krw",
      currencyCode: "KRW",
      decimalPlaces: 0,
      referenceId: index === 0 ? null : `category-${index}`,
      name: index === 0 ? "Uncategorized" : `Category ${index}`,
      incomeMinor: 0,
      expenseMinor: 800 - index * 50,
      netChangeMinor: -(800 - index * 50),
      entryCount: 1,
    }));
    render(
      <LedgerPanel
        leafTabId="reports"
        controller={controller(reportAnalysisState({ categoryBreakdown }))}
        onReportDrilldown={onReportDrilldown}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Uncategorized.*expense category/ }));
    expect(screen.queryByRole("button", { name: /Other.*expense category/ })).toBeNull();
    expect(onReportDrilldown).toHaveBeenCalledWith({
      kind: "category",
      currencyId: "currency-krw",
      referenceId: null,
      range: { start: "2026-08-01", end: "2026-08-31" },
    });
  });

  it("renders distinct null-id composition slices without a duplicate-key warning", () => {
    const categoryBreakdown = Array.from({ length: 8 }, (_, index) => ({
      currencyId: "currency-krw",
      currencyCode: "KRW",
      decimalPlaces: 0,
      referenceId: index === 0 ? null : `category-${index}`,
      name: index === 0 ? "Uncategorized" : `Category ${index}`,
      incomeMinor: 0,
      expenseMinor: 800 - index * 50,
      netChangeMinor: -(800 - index * 50),
      entryCount: 1,
    }));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(<LedgerPanel leafTabId="reports" controller={controller(reportAnalysisState({
      categoryBreakdown,
    }))} />);

    expect(screen.getByText(/^Uncategorized/)).toBeInTheDocument();
    expect(screen.getByText(/^Other/)).toBeInTheDocument();
    const errors = consoleError.mock.calls.flat().join(" ");
    consoleError.mockRestore();
    expect(errors).not.toMatch(/same key|unique.*key/i);
  });

  it("drills from an account, both trend series, and an expense category", async () => {
    const user = userEvent.setup();
    const onReportDrilldown = vi.fn();
    render(
      <LedgerPanel
        leafTabId="reports"
        controller={controller(reportAnalysisState())}
        onReportDrilldown={onReportDrilldown}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Cash.*asset/ }));
    await user.click(screen.getByRole("button", { name: /2026-08-01.*Expense/ }));
    await user.click(screen.getByRole("tab", { name: "Income" }));
    await user.click(screen.getByRole("button", { name: /2026-08-01.*Income/ }));
    await user.click(screen.getByRole("button", { name: /Food.*expense category/ }));

    expect(onReportDrilldown).toHaveBeenNthCalledWith(1, {
      kind: "account",
      currencyId: "currency-krw",
      referenceId: "account-cash",
    });
    expect(onReportDrilldown).toHaveBeenNthCalledWith(2, {
      kind: "trend",
      currencyId: "currency-krw",
      entryType: "expense",
      range: { start: "2026-08-01", end: "2026-08-01" },
    });
    expect(onReportDrilldown).toHaveBeenNthCalledWith(3, {
      kind: "trend",
      currencyId: "currency-krw",
      entryType: "income",
      range: { start: "2026-08-01", end: "2026-08-01" },
    });
    expect(onReportDrilldown).toHaveBeenNthCalledWith(4, {
      kind: "category",
      currencyId: "currency-krw",
      referenceId: "category-food",
      range: { start: "2026-08-01", end: "2026-08-31" },
    });
  });

  it("exposes screen-reader text for only the selected trend series", async () => {
    const user = userEvent.setup();
    render(<LedgerPanel leafTabId="reports" controller={controller(reportAnalysisState())} />);

    expect(screen.getByText(/2026-08-01: Spending 700 KRW; Average daily pace/))
      .toBeInTheDocument();
    expect(screen.queryByText(/2026-08-01: Income/)).toBeNull();

    await user.click(screen.getByRole("tab", { name: "Income" }));
    expect(screen.getByText("2026-08-01: Income 1,000 KRW"))
      .toBeInTheDocument();
    expect(screen.queryByText(/2026-08-01: Spending/)).toBeNull();
  });

  it("shows Spending first and switches to an Income chart with grouped Y-axis values", async () => {
    const user = userEvent.setup();
    const state = reportAnalysisState();
    state.trend = {
      range: { start: "2026-08-01", end: "2026-08-02" },
      granularity: "daily",
      currencies: [{
        currencyId: "currency-krw",
        currencyCode: "KRW",
        points: [{
          start: "2026-08-01",
          end: "2026-08-01",
          incomeMinor: 3_200_000,
          expenseMinor: 800_000,
        }, {
          start: "2026-08-02",
          end: "2026-08-02",
          incomeMinor: 1_600_000,
          expenseMinor: 400_000,
        }],
      }],
    };
    render(<LedgerPanel leafTabId="reports" controller={controller(state)} />);

    expect(screen.getByRole("tab", { name: "Spending" }))
      .toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: "2026-08-01 Expense 800,000 KRW" }))
      .toBeInTheDocument();
    expect(screen.getByLabelText("Spending Y-axis"))
      .toHaveTextContent("800,000 KRW400,000 KRW0 KRW");
    expect(screen.getByText("Average daily pace")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Income" }));
    expect(screen.getByRole("button", { name: "2026-08-01 Income 3,200,000 KRW" }))
      .toBeInTheDocument();
    expect(screen.getByLabelText("Income Y-axis"))
      .toHaveTextContent("3,200,000 KRW1,600,000 KRW0 KRW");
    expect(screen.queryByText("Average daily pace")).toBeNull();
  });

  it("supports the complete keyboard pattern and ARIA links for trend tabs", async () => {
    const user = userEvent.setup();
    render(<LedgerPanel leafTabId="reports" controller={controller(reportAnalysisState())} />);

    const incomeTab = screen.getByRole("tab", { name: "Income" });
    const spendingTab = screen.getByRole("tab", { name: "Spending" });
    const panel = screen.getByRole("tabpanel");
    expect(spendingTab).toHaveAttribute("tabindex", "0");
    expect(incomeTab).toHaveAttribute("tabindex", "-1");
    expect(spendingTab).toHaveAttribute("aria-controls", panel.id);
    expect(panel).toHaveAttribute("aria-labelledby", spendingTab.id);

    spendingTab.focus();
    await user.keyboard("{ArrowRight}");
    expect(incomeTab).toHaveFocus();
    expect(incomeTab).toHaveAttribute("aria-selected", "true");
    expect(panel).toHaveAttribute("aria-labelledby", incomeTab.id);

    await user.keyboard("{End}");
    expect(spendingTab).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(incomeTab).toHaveFocus();
    await user.keyboard("{Home}");
    expect(incomeTab).toHaveFocus();
  });

  it("keeps zero-valued selected trend bars at zero height", async () => {
    const user = userEvent.setup();
    const onReportDrilldown = vi.fn();
    const state = reportAnalysisState();
    state.trend!.currencies[0]!.points = [{
      start: "2026-08-01",
      end: "2026-08-01",
      incomeMinor: 0,
      expenseMinor: 0,
    }];
    render(
      <LedgerPanel
        leafTabId="reports"
        controller={controller(state)}
        onReportDrilldown={onReportDrilldown}
      />,
    );

    const expenseButton = screen.getByRole("button", { name: "2026-08-01 Expense 0 KRW" });
    const expenseVisual = expenseButton.querySelector(".ledger-report-bar-expense");
    expect(expenseVisual)
      .toHaveStyle({ height: "0%", minHeight: "0" });
    expenseButton.focus();
    expect(expenseButton).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onReportDrilldown).toHaveBeenCalledWith({
      kind: "trend",
      currencyId: "currency-krw",
      entryType: "expense",
      range: { start: "2026-08-01", end: "2026-08-01" },
    });

    await user.click(screen.getByRole("tab", { name: "Income" }));
    const incomeButton = screen.getByRole("button", { name: "2026-08-01 Income 0 KRW" });
    expect(incomeButton.querySelector(".ledger-report-bar-income"))
      .toHaveStyle({ height: "0%", minHeight: "0" });
  });

  it("scales trend bars against the selected series and an expense average maximum", async () => {
    const user = userEvent.setup();
    const state = reportAnalysisState();
    state.comparison!.current.currencies[0]!.expenseMinor = 31_000;
    state.trend!.currencies[0]!.points = [{
      start: "2026-08-01",
      end: "2026-08-01",
      incomeMinor: 800,
      expenseMinor: 500,
    }, {
      start: "2026-08-02",
      end: "2026-08-02",
      incomeMinor: 400,
      expenseMinor: 250,
    }];
    render(<LedgerPanel leafTabId="reports" controller={controller(state)} />);

    expect(screen.getByLabelText("Spending Y-axis"))
      .toHaveTextContent("1,000 KRW500 KRW0 KRW");
    expect(document.querySelector(".ledger-report-average-marker"))
      .toHaveStyle({ bottom: "100%" });
    expect(screen.getByRole("button", { name: "2026-08-01 Expense 500 KRW" })
      .querySelector(".ledger-report-bar-expense"))
      .toHaveStyle({ height: "50%" });

    await user.click(screen.getByRole("tab", { name: "Income" }));
    expect(screen.getByRole("button", { name: "2026-08-01 Income 800 KRW" })
      .querySelector(".ledger-report-bar-income"))
      .toHaveStyle({ height: "100%" });
    expect(screen.getByRole("button", { name: "2026-08-02 Income 400 KRW" })
      .querySelector(".ledger-report-bar-income"))
      .toHaveStyle({ height: "50%" });
  });

  it("shows zero cards and section-specific messages for an empty report", () => {
    const empty = reportAnalysisState({
      comparison: {
        current: { range: { start: "2026-08-01", end: "2026-08-31" }, currencies: [] },
        previous: { range: { start: "2026-07-01", end: "2026-07-31" }, currencies: [] },
        currencies: [],
      },
      categoryBreakdown: [],
      balances: [],
      trend: {
        range: { start: "2026-08-01", end: "2026-08-31" },
        granularity: "daily",
        currencies: [],
      },
    });
    render(<LedgerPanel leafTabId="reports" controller={controller(empty)} />);

    expect(screen.getByText("No asset balances for this currency.")).toBeInTheDocument();
    expect(screen.getByText("No liability balances for this currency.")).toBeInTheDocument();
    expect(screen.getByText("No spending categories for this period.")).toBeInTheDocument();
    expect(screen.getByText("No income or spending for this period.")).toBeInTheDocument();
  });

  it("formats two-decimal transaction, balance, and report minor units exactly", () => {
    const ledger = controller({
      ...loadedState,
      entries: [{
        accountName: "Cash",
        categoryName: "Food",
        currencyCode: "USD",
        entry: {
          id: "entry-usd",
          date: "2026-07-30",
          writtenAt: "2026-07-30T00:00:00Z",
          content: "Coffee",
          transactionCategoryId: "category-food",
          accountId: "account-cash",
          entryType: "expense",
          amountMinor: 1234,
          currencyId: "currency-usd",
          transferGroupId: null,
          source: "ui",
          notes: null,
          createdAt: "2026-07-30T00:00:00Z",
          updatedAt: "2026-07-30T00:00:00Z",
          deletedAt: null,
        },
      }],
    });
    const { rerender } = render(<LedgerPanel controller={ledger} />);
    expect(screen.getByText("−12.34 USD")).toBeInTheDocument();

    rerender(
      <LedgerPanel
        leafTabId="accounts"
        controller={controller({
          ...loadedState,
          accounts: [{
            ...loadedState.accounts[0],
            currencyId: "currency-usd",
            openingBalanceMinor: 1234,
          }],
          balances: [{
            account: {
              ...loadedState.accounts[0],
              currencyId: "currency-usd",
              openingBalanceMinor: 1234,
            },
            currencyCode: "USD",
            decimalPlaces: 2,
            currentBalanceMinor: 5678,
          }],
        })}
      />,
    );
    expect(screen.getByText("56.78 USD")).toBeInTheDocument();

    const usdReportState = reportAnalysisState();
    usdReportState.currencies = usdReportState.currencies.filter(
      ({ id }) => id !== "currency-usd",
    );
    usdReportState.comparison = {
      ...usdReportState.comparison!,
      currencies: usdReportState.comparison!.currencies.filter(
        ({ currencyId }) => currencyId === "currency-usd",
      ),
    };
    usdReportState.trend = {
      ...usdReportState.trend!,
      currencies: usdReportState.trend!.currencies.filter(
        ({ currencyId }) => currencyId === "currency-usd",
      ),
    };
    rerender(
      <LedgerPanel
        leafTabId="reports"
        controller={controller(usdReportState)}
      />,
    );
    const reportSummary = screen.getByRole("region", { name: "Summary" });
    expect(within(reportSummary).getByRole("group", { name: "Income" }))
      .toHaveTextContent("12.34 USD");
    expect(within(reportSummary).getByRole("group", { name: "Spending" }))
      .toHaveTextContent("2.00 USD");
    expect(within(reportSummary).getByRole("group", { name: "Net assets" }))
      .toHaveTextContent("25.00 USD");
    expect(screen.queryByRole("region", { name: "Briefing" })).toBeNull();
  });

  it("does not load reports during the initial Ledger refresh", async () => {
    mockLedgerLoads();
    const compare = vi.spyOn(ledgerApi, "compare").mockResolvedValue(
      comparison("2026-08-01", "2026-08-31"),
    );

    const { result } = renderHook(() => useLedgerController());
    await waitFor(() => expect(result.current.state.status).toBe("loaded"));

    expect(compare).not.toHaveBeenCalled();
  });

  it("loads all report data from the comparison's canonical current range", async () => {
    const reportComparison = comparison("2026-08-01", "2026-08-31");
    const reportTrend = trend("2026-08-01", "2026-08-31");
    const firstBalanceRows = [{
      account: loadedState.accounts[0]!,
      currencyCode: "KRW",
      decimalPlaces: 0,
      currentBalanceMinor: 2_000,
    }];
    const secondBalanceRows = [{
      account: { ...loadedState.accounts[0]!, id: "account-bank", name: "Bank" },
      currencyCode: "KRW",
      decimalPlaces: 0,
      currentBalanceMinor: 3_000,
    }];
    const compare = vi.spyOn(ledgerApi, "compare").mockResolvedValue(reportComparison);
    const categories = vi.spyOn(ledgerApi, "categoryReport").mockResolvedValue([]);
    const requestTrend = vi.spyOn(ledgerApi, "trend").mockResolvedValue(reportTrend);
    vi.spyOn(ledgerApi, "listAccountBalances")
      .mockResolvedValueOnce({ items: firstBalanceRows, nextOffset: 200 })
      .mockResolvedValueOnce({ items: secondBalanceRows, nextOffset: null });

    const result = await loadLedgerReport({ period: "current_month" });

    expect(compare).toHaveBeenCalledWith({ period: "current_month" });
    expect(categories).toHaveBeenCalledWith({ from: "2026-08-01", to: "2026-08-31" });
    expect(requestTrend).toHaveBeenCalledWith({ from: "2026-08-01", to: "2026-08-31" });
    expect(ledgerApi.listAccountBalances).toHaveBeenNthCalledWith(
      1,
      { limit: 200, offset: undefined },
    );
    expect(ledgerApi.listAccountBalances).toHaveBeenNthCalledWith(
      2,
      { limit: 200, offset: 200 },
    );
    expect(ledgerApi.listAccountBalances).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      comparison: reportComparison,
      categoryBreakdown: [],
      trend: reportTrend,
      balances: [...firstBalanceRows, ...secondBalanceRows],
    });
  });

  it("does not render unknown report error details", async () => {
    mockLedgerLoads();
    const hostile = "sqlite /Users/private/ledger.sqlite: SELECT secret FROM audit";
    vi.spyOn(ledgerApi, "compare").mockRejectedValue(new Error(hostile));

    function ProductionLedgerReports() {
      return <LedgerPanel leafTabId="reports" controller={useLedgerController()} />;
    }

    render(<ProductionLedgerReports />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Could not load reports.");
    expect(alert).not.toHaveTextContent(hostile);
  });

  it.each([
    ["RavenApiError", new RavenApiError(
      "invalid_report_range",
      "Report range is invalid.",
      {},
      "00000000-0000-4000-8000-000000000001",
      400,
    ), "Report range is invalid."],
    ["RavenTransportError", new RavenTransportError("network"),
      "Raven API is unreachable."],
  ])("renders trusted %s messages for report failures", async (_name, error, message) => {
    mockLedgerLoads();
    vi.spyOn(ledgerApi, "compare").mockRejectedValue(error);

    function ProductionLedgerReports() {
      return <LedgerPanel leafTabId="reports" controller={useLedgerController()} />;
    }

    render(<ProductionLedgerReports />);

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
  });

  it("loads report analysis from the comparison's canonical current range", async () => {
    mockLedgerLoads();
    const firstBalanceRows = [{
      account: loadedState.accounts[0]!,
      currencyCode: "KRW",
      decimalPlaces: 0,
      currentBalanceMinor: 2_000,
    }];
    const secondBalanceRows = [{
      account: { ...loadedState.accounts[0]!, id: "account-bank", name: "Bank" },
      currencyCode: "KRW",
      decimalPlaces: 0,
      currentBalanceMinor: 3_000,
    }];
    const compare = vi.spyOn(ledgerApi, "compare").mockResolvedValue(
      comparison("2026-08-01", "2026-08-31"),
    );
    const accounts = vi.spyOn(ledgerApi, "accountReport").mockResolvedValue([]);
    const categories = vi.spyOn(ledgerApi, "categoryReport").mockResolvedValue([]);
    const reportTrend = vi.spyOn(ledgerApi, "trend").mockResolvedValue(
      trend("2026-08-01", "2026-08-31"),
    );
    const { result } = renderHook(() => useLedgerController());
    await waitFor(() => expect(result.current.state.status).toBe("loaded"));
    vi.mocked(ledgerApi.listAccountBalances)
      .mockClear()
      .mockResolvedValueOnce({ items: firstBalanceRows, nextOffset: 200 })
      .mockResolvedValueOnce({ items: secondBalanceRows, nextOffset: null });

    await act(async () => {
      await result.current.runReports({ period: "current_month" });
    });

    expect(compare).toHaveBeenCalledWith({ period: "current_month" });
    expect(accounts).not.toHaveBeenCalled();
    expect(categories).toHaveBeenCalledWith({ from: "2026-08-01", to: "2026-08-31" });
    expect(reportTrend).toHaveBeenCalledWith({ from: "2026-08-01", to: "2026-08-31" });
    expect(ledgerApi.listAccountBalances).toHaveBeenNthCalledWith(
      1,
      { limit: 200, offset: undefined },
    );
    expect(ledgerApi.listAccountBalances).toHaveBeenNthCalledWith(
      2,
      { limit: 200, offset: 200 },
    );
    expect(ledgerApi.listAccountBalances).toHaveBeenCalledTimes(2);
    expect(result.current.state.balances).toEqual([
      ...firstBalanceRows,
      ...secondBalanceRows,
    ]);
    expect(result.current.state.reportSelection).toEqual({ period: "current_month" });
    expect(result.current.state.comparison?.current.range).toEqual({
      start: "2026-08-01",
      end: "2026-08-31",
    });
  });

  it.each(["success", "failure"] as const)(
    "keeps a newer report result when an older report request completes late with %s",
    async (olderCompletion) => {
      mockLedgerLoads();
      const older = deferred<LedgerComparison>();
      vi.spyOn(ledgerApi, "compare")
        .mockReturnValueOnce(older.promise)
        .mockResolvedValueOnce(comparison("2026-08-01", "2026-08-31"));
      vi.spyOn(ledgerApi, "categoryReport").mockResolvedValue([]);
      vi.spyOn(ledgerApi, "trend").mockResolvedValue(trend("2026-08-01", "2026-08-31"));
      const { result } = renderHook(() => useLedgerController());
      await waitFor(() => expect(result.current.state.status).toBe("loaded"));

      let olderRequest!: Promise<void>;
      let newerRequest!: Promise<void>;
      act(() => {
        olderRequest = result.current.runReports({ period: "previous_month" });
        newerRequest = result.current.runReports({ period: "current_month" });
      });
      await act(async () => {
        await newerRequest;
      });
      await act(async () => {
        if (olderCompletion === "success") {
          older.resolve(comparison("2026-07-01", "2026-07-31"));
          await expect(olderRequest).resolves.toBeUndefined();
        } else {
          older.reject(new Error("Older report failed"));
          await expect(olderRequest).resolves.toBeUndefined();
        }
      });

      expect(result.current.state.reportStatus).toBe("loaded");
      expect(result.current.state.reportError).toBeNull();
      expect(result.current.state.reportSelection).toEqual({ period: "current_month" });
    },
  );

  it("retains report data after a failure and retries the last selection", async () => {
    mockLedgerLoads();
    const compare = vi.spyOn(ledgerApi, "compare")
      .mockResolvedValueOnce(comparison("2026-08-01", "2026-08-31"))
      .mockRejectedValueOnce(new Error("Report service unavailable"))
      .mockResolvedValueOnce(comparison("2026-08-01", "2026-08-31"));
    vi.spyOn(ledgerApi, "categoryReport").mockResolvedValue([]);
    vi.spyOn(ledgerApi, "trend").mockResolvedValue(trend("2026-08-01", "2026-08-31"));
    const { result } = renderHook(() => useLedgerController());
    await waitFor(() => expect(result.current.state.status).toBe("loaded"));
    await act(async () => {
      await result.current.runReports({ period: "current_month" });
    });
    const previousComparison = result.current.state.comparison;

    await act(async () => {
      await expect(result.current.runReports({ period: "previous_month" }))
        .rejects.toThrow("Report service unavailable");
    });

    expect(result.current.state.reportStatus).toBe("error");
    expect(result.current.state.comparison).toBe(previousComparison);
    expect(result.current.state.reportSelection).toEqual({ period: "previous_month" });
    await act(async () => {
      await result.current.retryReports();
    });
    expect(compare).toHaveBeenLastCalledWith({ period: "previous_month" });
  });

  it("retains all on-demand reference records across subsequent pages", async () => {
    const secondAccount = { ...loadedState.accounts[0], id: "account-bank", name: "Bank" };
    vi.spyOn(ledgerApi, "listEntries")
      .mockResolvedValueOnce({ items: [entryView("entry-1", "Lunch")], nextOffset: 100 })
      .mockResolvedValueOnce({ items: [entryView("entry-2", "Dinner")], nextOffset: null });
    vi.spyOn(ledgerApi, "listCurrencies")
      .mockResolvedValue({ items: loadedState.currencies, nextOffset: null });
    vi.spyOn(ledgerApi, "listAccountCategories")
      .mockResolvedValue({ items: loadedState.accountCategories, nextOffset: null });
    vi.spyOn(ledgerApi, "listAccounts")
      .mockResolvedValueOnce({ items: loadedState.accounts, nextOffset: 200 })
      .mockResolvedValueOnce({ items: [secondAccount], nextOffset: null });
    vi.spyOn(ledgerApi, "listTransactionCategories")
      .mockResolvedValue({ items: loadedState.categories, nextOffset: null });
    vi.spyOn(ledgerApi, "listAccountBalances")
      .mockResolvedValue({ items: [], nextOffset: null });

    const { result } = renderHook(() => useLedgerController());
    await waitFor(() => expect(result.current.state.status).toBe("loaded"));
    await act(async () => {
      expect(await result.current.ensureReferenceData!("ledger.transactions")).toBe(true);
    });

    expect(result.current.state.accounts.map((account) => account.name))
      .toEqual(["Cash", "Bank"]);
    expect(result.current.state.entries.map((entry) => entry.entry.content))
      .toEqual(["Lunch", "Dinner"]);
    expect(ledgerApi.listAccounts).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ offset: 200 }),
    );
  });

  it("loads one table page and appends deduplicated occurrences on demand", async () => {
    mockLedgerLoads();
    const next = deferred<{
      items: LedgerTableOccurrence[];
      nextOffset: number | null;
    }>();
    const first = transactionOccurrence("first", "entry-1", "Lunch");
    const second = transactionOccurrence("second", "entry-2", "Dinner");
    vi.spyOn(ledgerApi, "queryTable")
      .mockResolvedValueOnce({ items: [first], nextOffset: 50 })
      .mockReturnValueOnce(next.promise);

    const { result } = renderHook(() => useLedgerController());
    await waitFor(() => expect(result.current.state.status).toBe("loaded"));
    await act(async () => result.current.ensureTable!("ledger.transactions"));
    expect(ledgerApi.queryTable).toHaveBeenNthCalledWith(
      1,
      "ledger.transactions",
      result.current.tableSettings("ledger.transactions"),
      0,
      expect.any(Date),
    );

    act(() => {
      void result.current.loadMore!("ledger.transactions");
      void result.current.loadMore!("ledger.transactions");
    });
    expect(ledgerApi.queryTable).toHaveBeenCalledTimes(2);
    await act(async () => next.resolve({ items: [first, second], nextOffset: null }));
    expect(result.current.tablePage!("ledger.transactions").items.map(({ key }) => key))
      .toEqual(["first", "second"]);
  });

  it("preserves rows after a next-page failure and retries the same offset", async () => {
    mockLedgerLoads();
    const first = transactionOccurrence("first", "entry-1", "Lunch");
    vi.spyOn(ledgerApi, "queryTable")
      .mockResolvedValueOnce({ items: [first], nextOffset: 50 })
      .mockRejectedValueOnce(new Error("private storage detail"))
      .mockResolvedValueOnce({
        items: [transactionOccurrence("second", "entry-2", "Dinner")],
        nextOffset: null,
      });

    const { result } = renderHook(() => useLedgerController());
    await waitFor(() => expect(result.current.state.status).toBe("loaded"));
    await act(async () => result.current.ensureTable!("ledger.transactions"));
    await act(async () => result.current.loadMore!("ledger.transactions"));
    expect(result.current.tablePage!("ledger.transactions")).toMatchObject({
      items: [first],
      nextOffset: 50,
      moreStatus: "idle",
      moreError: "Could not load more rows.",
    });

    await act(async () => result.current.loadMore!("ledger.transactions"));
    expect(vi.mocked(ledgerApi.queryTable).mock.calls.slice(-2).map((call) => call[2]))
      .toEqual([50, 50]);
    expect(result.current.tablePage!("ledger.transactions").items).toHaveLength(2);
  });

  it("freezes the local reference date across appends and retries in one generation", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 22, 23, 59));
    mockLedgerLoads();
    vi.mocked(ledgerApi.queryTable)
      .mockResolvedValueOnce({ items: [], nextOffset: 50 })
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ items: [], nextOffset: null })
      .mockResolvedValueOnce({ items: [], nextOffset: null });
    try {
      const { result } = renderHook(() => useLedgerController());
      await act(async () => result.current.ensureTable!("ledger.transactions"));
      vi.setSystemTime(new Date(2026, 7, 23, 0, 1));
      await act(async () => result.current.loadMore!("ledger.transactions"));
      await act(async () => result.current.loadMore!("ledger.transactions"));
      expect(vi.mocked(ledgerApi.queryTable).mock.calls.slice(0, 3).map((call) =>
        [call[3]?.getFullYear(), call[3]?.getMonth(), call[3]?.getDate()],
      )).toEqual([[2026, 7, 22], [2026, 7, 22], [2026, 7, 22]]);

      await act(async () => result.current.updateTableSettings("ledger.transactions", (settings) => ({
        ...settings,
        filterMode: "or",
      })));
      expect(ledgerApi.queryTable).toHaveBeenCalledTimes(4);
      expect(vi.mocked(ledgerApi.queryTable).mock.calls[3]?.[3]?.getDate()).toBe(23);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not let a stale Ledger append latch block a new generation append", async () => {
    mockLedgerLoads();
    const firstAppend = deferred<Awaited<ReturnType<typeof ledgerApi.queryTable>>>();
    const secondAppend = deferred<Awaited<ReturnType<typeof ledgerApi.queryTable>>>();
    const appends = [firstAppend, secondAppend];
    let initialLoads = 0;
    vi.mocked(ledgerApi.queryTable).mockImplementation(async (_scope, _settings, offset) => {
      if (offset === 50) return appends.shift()!.promise;
      initialLoads += 1;
      return { items: [], nextOffset: 50 };
    });
    const { result } = renderHook(() => useLedgerController());
    await act(async () => result.current.ensureTable!("ledger.transactions"));
    let stale!: Promise<void>;
    act(() => { stale = result.current.loadMore!("ledger.transactions"); });
    act(() => result.current.updateTableSettings("ledger.transactions", (settings) => ({
      ...settings,
      filterMode: "or",
    })));
    await waitFor(() => expect(initialLoads).toBe(2));
    let current!: Promise<void>;
    act(() => { current = result.current.loadMore!("ledger.transactions"); });
    expect(vi.mocked(ledgerApi.queryTable).mock.calls.map((call) => call[2]))
      .toEqual([0, 50, 0, 50]);
    await act(async () => {
      secondAppend.resolve({ items: [], nextOffset: null });
      await current;
    });
    await act(async () => {
      firstAppend.resolve({
        items: [transactionOccurrence("stale", "entry-1", "Stale")],
        nextOffset: null,
      });
      await stale;
    });
    expect(result.current.tablePage!("ledger.transactions").items).toEqual([]);
  });

  it("resets only the changed table and ignores its stale page response", async () => {
    mockLedgerLoads();
    const stale = deferred<{ items: LedgerTableOccurrence[]; nextOffset: null }>();
    const current = deferred<{ items: LedgerTableOccurrence[]; nextOffset: null }>();
    vi.spyOn(ledgerApi, "queryTable")
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(current.promise);

    const { result } = renderHook(() => useLedgerController());
    await waitFor(() => expect(result.current.state.status).toBe("loaded"));
    let initial!: Promise<void>;
    act(() => {
      initial = result.current.ensureTable!("ledger.transactions");
    });
    act(() => result.current.updateTableSettings("ledger.transactions", (settings) => ({
      ...settings,
      sortRules: [{ id: "content", field: "content", direction: "asc" }],
    })));
    await act(async () => current.resolve({
      items: [transactionOccurrence("current", "entry-2", "Current")],
      nextOffset: null,
    }));
    await act(async () => {
      stale.resolve({
        items: [transactionOccurrence("stale", "entry-1", "Stale")],
        nextOffset: null,
      });
      await initial;
    });

    expect(result.current.tablePage!("ledger.transactions").items[0]?.key).toBe("current");
    expect(result.current.tablePage!("ledger.accounts").generation).toBe(0);
  });

  it("renders server-grouped occurrences and loads more from every table footer", async () => {
    const user = userEvent.setup();
    const ledger = controller({ ...loadedState, entries: [] });
    const grouped = {
      ...transactionOccurrence("cash:entry-1", "entry-1", "Server Lunch"),
      groupKey: "account-cash",
      groupLabel: "Cash",
      record: {
        ...transactionOccurrence("cash:entry-1", "entry-1", "Server Lunch").record,
        amountMinor: 123,
        currencyCode: "USD",
        currencyId: "currency-usd",
        decimalPlaces: 2,
      },
    } satisfies LedgerTableOccurrence;
    ledger.tablePage = vi.fn((scope) => ({
      items: scope === "ledger.transactions" ? [grouped] : [],
      nextOffset: 50,
      moreStatus: "idle" as const,
      moreError: null,
      generation: 1,
    }));
    ledger.ensureTable = vi.fn().mockResolvedValue(undefined);
    ledger.loadMore = vi.fn().mockResolvedValue(undefined);

    const view = render(<LedgerPanel controller={ledger} />);
    expect(screen.getByRole("rowgroup", { name: "Cash group" })).toHaveTextContent(
      "Server Lunch",
    );
    expect(screen.getByText("−1.23 USD")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Load more" }));
    expect(ledger.loadMore).toHaveBeenCalledWith("ledger.transactions");

    view.rerender(<LedgerPanel controller={ledger} leafTabId="accounts" />);
    await user.click(screen.getByRole("button", { name: "Load more" }));
    expect(ledger.loadMore).toHaveBeenCalledWith("ledger.accounts");

    view.rerender(<LedgerPanel controller={ledger} leafTabId="categories" />);
    await user.click(screen.getByRole("button", { name: "Load more" }));
    expect(ledger.loadMore).toHaveBeenCalledWith("ledger.categories");
  });

  it("enters Ledger without draining any legacy table or reference list", async () => {
    const lists = [
      vi.spyOn(ledgerApi, "listEntries"),
      vi.spyOn(ledgerApi, "listCurrencies"),
      vi.spyOn(ledgerApi, "listAccountCategories"),
      vi.spyOn(ledgerApi, "listAccounts"),
      vi.spyOn(ledgerApi, "listTransactionCategories"),
      vi.spyOn(ledgerApi, "listAccountBalances"),
    ];
    vi.spyOn(ledgerApi, "queryTable").mockResolvedValue({
      items: [transactionOccurrence("first", "entry-1", "Lazy Lunch")],
      nextOffset: null,
    });
    vi.spyOn(ledgerApi, "tableLookups").mockResolvedValue({
      accounts: [], categories: [], currencies: [],
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));

    function ProductionLedgerPanel() {
      return <LedgerPanel controller={useLedgerController()} />;
    }
    render(<ProductionLedgerPanel />);
    expect(await screen.findByText("Lazy Lunch")).toBeInTheDocument();
    expect(lists.every((list) => list.mock.calls.length === 0)).toBe(true);
    expect(ledgerApi.queryTable).toHaveBeenCalledOnce();
    expect(ledgerApi.tableLookups).toHaveBeenCalledWith("ledger.transactions");
  });

  it("loads rich group candidates once when the Group panel first opens", async () => {
    const user = userEvent.setup();
    vi.spyOn(ledgerApi, "queryTable").mockResolvedValue({ items: [], nextOffset: null });
    vi.spyOn(ledgerApi, "tableLookups").mockResolvedValue({
      accounts: [], categories: [], currencies: [],
    });
    const entries = vi.spyOn(ledgerApi, "listEntries")
      .mockResolvedValue({ items: transactionEntries(), nextOffset: null });
    const currencies = vi.spyOn(ledgerApi, "listCurrencies")
      .mockResolvedValue({ items: loadedState.currencies, nextOffset: null });
    const accounts = vi.spyOn(ledgerApi, "listAccounts")
      .mockResolvedValue({ items: loadedState.accounts, nextOffset: null });
    const categories = vi.spyOn(ledgerApi, "listTransactionCategories")
      .mockResolvedValue({ items: loadedState.categories, nextOffset: null });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));

    function ProductionLedgerPanel() {
      return <LedgerPanel controller={useLedgerController()} />;
    }
    render(<ProductionLedgerPanel />);
    const group = await screen.findByRole("button", { name: "Group Transactions" });
    await user.click(group);
    expect(await screen.findByRole("dialog", { name: "Group Transactions" }))
      .toBeInTheDocument();
    expect([entries, currencies, accounts, categories].map((spy) => spy.mock.calls.length))
      .toEqual([1, 1, 1, 1]);

    await user.keyboard("{Escape}");
    await user.click(group);
    expect(await screen.findByRole("dialog", { name: "Group Transactions" }))
      .toBeInTheDocument();
    expect([entries, currencies, accounts, categories].map((spy) => spy.mock.calls.length))
      .toEqual([1, 1, 1, 1]);
  });

  it("keeps a page-two account detail mounted after save reloads offset zero", async () => {
    const user = userEvent.setup();
    const updatedAccount = {
      ...loadedState.accounts[0]!, name: "Wallet", openingBalanceMinor: 2500,
    };
    const initialBalance = {
      account: loadedState.accounts[0]!,
      currencyCode: "KRW",
      decimalPlaces: 0,
      currentBalanceMinor: 0,
    };
    const updatedBalance = {
      ...initialBalance,
      account: updatedAccount,
      currentBalanceMinor: 2500,
    };
    vi.spyOn(ledgerApi, "queryTable")
      .mockResolvedValue({ items: [accountOccurrence()], nextOffset: null });
    vi.spyOn(ledgerApi, "tableLookups").mockResolvedValue({
      accountTypes: [], currencies: [],
    });
    vi.spyOn(ledgerApi, "listCurrencies")
      .mockResolvedValue({ items: loadedState.currencies, nextOffset: null });
    vi.spyOn(ledgerApi, "listAccountCategories")
      .mockResolvedValue({ items: loadedState.accountCategories, nextOffset: null });
    vi.spyOn(ledgerApi, "listAccounts")
      .mockResolvedValueOnce({ items: loadedState.accounts, nextOffset: null })
      .mockResolvedValue({ items: [updatedAccount], nextOffset: null });
    vi.spyOn(ledgerApi, "listAccountBalances")
      .mockResolvedValueOnce({ items: [initialBalance], nextOffset: 200 })
      .mockResolvedValueOnce({ items: [], nextOffset: null })
      .mockResolvedValue({ items: [updatedBalance], nextOffset: null });
    vi.spyOn(ledgerApi, "updateAccount").mockResolvedValue(updatedAccount);

    function ProductionAccounts() {
      return <LedgerPanel controller={useLedgerController()} leafTabId="accounts" />;
    }
    render(<ProductionAccounts />);
    const accountRow = await screen.findByRole("button", { name: /Open details for Cash/ });
    fireEvent.click(accountRow);
    fireEvent.click(accountRow);
    expect(await screen.findByRole("region", { name: "Cash details" })).toBeInTheDocument();
    expect(ledgerApi.listAccounts).toHaveBeenCalledOnce();
    expect(ledgerApi.listAccountBalances).toHaveBeenNthCalledWith(2, {
      limit: 200, offset: 200,
    });
    vi.mocked(ledgerApi.queryTable).mockResolvedValue({ items: [], nextOffset: null });
    await user.clear(screen.getByLabelText("Account name"));
    await user.type(screen.getByLabelText("Account name"), "Wallet");
    await user.clear(screen.getByLabelText("Opening balance"));
    await user.type(screen.getByLabelText("Opening balance"), "2500");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(ledgerApi.queryTable).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("region", { name: "Wallet details" })).toBeInTheDocument();
    expect(screen.getByLabelText("Current balance")).toHaveTextContent("2500 KRW");
    expect(ledgerApi.listAccountBalances).toHaveBeenCalledTimes(3);
  });

  it("keeps a page-two transaction detail mounted after save reloads offset zero", async () => {
    const user = userEvent.setup();
    const initial = transactionEntry("expense-1", "Lunch");
    const updated = transactionEntry("expense-1", "Dinner");
    vi.spyOn(ledgerApi, "queryTable")
      .mockResolvedValue({
        items: [transactionOccurrence("expense-1", "expense-1", "Lunch")],
        nextOffset: null,
      });
    vi.spyOn(ledgerApi, "tableLookups").mockResolvedValue({
      accounts: [], categories: [], currencies: [],
    });
    vi.spyOn(ledgerApi, "listEntries")
      .mockResolvedValueOnce({ items: [initial], nextOffset: null })
      .mockResolvedValue({ items: [updated], nextOffset: null });
    vi.spyOn(ledgerApi, "listCurrencies")
      .mockResolvedValue({ items: loadedState.currencies, nextOffset: null });
    vi.spyOn(ledgerApi, "listAccounts")
      .mockResolvedValue({ items: loadedState.accounts, nextOffset: null });
    vi.spyOn(ledgerApi, "listTransactionCategories")
      .mockResolvedValue({ items: loadedState.categories, nextOffset: null });
    vi.spyOn(ledgerApi, "updateEntry").mockResolvedValue(updated.entry);

    function ProductionTransactions() {
      return <LedgerPanel controller={useLedgerController()} />;
    }
    render(<ProductionTransactions />);
    await user.click(await screen.findByRole("button", {
      name: /Open details for Lunch/,
    }));
    vi.mocked(ledgerApi.queryTable).mockResolvedValue({ items: [], nextOffset: null });
    await user.clear(screen.getByLabelText("Content"));
    await user.type(screen.getByLabelText("Content"), "Dinner");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(ledgerApi.queryTable).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("region", { name: "Dinner details" })).toBeInTheDocument();
  });

  it("keeps a page-two category detail mounted after save reloads offset zero", async () => {
    const user = userEvent.setup();
    const updatedCategory = { ...loadedState.categories[0]!, name: "Meals" };
    vi.spyOn(ledgerApi, "queryTable")
      .mockResolvedValue({ items: [categoryOccurrence()], nextOffset: null });
    vi.spyOn(ledgerApi, "tableLookups").mockResolvedValue({ categories: [] });
    vi.spyOn(ledgerApi, "listTransactionCategories")
      .mockResolvedValueOnce({ items: loadedState.categories, nextOffset: null })
      .mockResolvedValue({ items: [updatedCategory], nextOffset: null });
    vi.spyOn(ledgerApi, "updateTransactionCategory").mockResolvedValue(updatedCategory);

    function ProductionCategories() {
      return <LedgerPanel controller={useLedgerController()} leafTabId="categories" />;
    }
    render(<ProductionCategories />);
    await user.click(await screen.findByRole("button", { name: /Open details for Food/ }));
    vi.mocked(ledgerApi.queryTable).mockResolvedValue({ items: [], nextOffset: null });
    await user.clear(screen.getByLabelText("Category name"));
    await user.type(screen.getByLabelText("Category name"), "Meals");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(ledgerApi.queryTable).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("region", { name: "Meals details" })).toBeInTheDocument();
  });

  it.each([
    ["transactions", "ledger.transactions", "No transactions match this view."],
    ["accounts", "ledger.accounts", "No accounts match this view."],
    ["categories", "ledger.categories", "No categories match this view."],
  ] as const)("shows a constrained zero result for %s without eager records", (
    leafTabId,
    scope,
    message,
  ) => {
    const ledger = controller({
      ...loadedState,
      entries: [], accounts: [], categories: [], balances: [],
    });
    ledger.tablePage = () => ({
      items: [], nextOffset: null, moreStatus: "idle", moreError: null, generation: 1,
    });
    ledger.tableSettings = (candidate) => candidate === scope
      ? {
          ...defaultLedgerTableSettings(candidate),
          filterRules: [{
            id: "zero-filter", field: "name", type: "text", operator: "contains", value: "x",
          }],
        }
      : defaultLedgerTableSettings(candidate);
    render(<LedgerPanel controller={ledger} leafTabId={leafTabId} />);
    expect(screen.getByText(message)).toBeInTheDocument();
  });

  it.each([
    ["transactions", "Loading transactions…", "No transactions yet."],
    ["accounts", "Loading accounts…", "No accounts yet."],
    ["categories", "Loading categories…", "No categories yet."],
  ] as const)("does not flash a false empty state while switching to %s", (
    leafTabId,
    loadingMessage,
    emptyMessage,
  ) => {
    const ledger = controller({
      ...loadedState,
      entries: [], accounts: [], categories: [], balances: [],
    });
    ledger.tablePage = () => ({
      items: [], nextOffset: null, moreStatus: "loading", moreError: null, generation: 1,
    });
    render(<LedgerPanel controller={ledger} leafTabId={leafTabId} />);
    expect(screen.getByText(loadingMessage)).toBeInTheDocument();
    expect(screen.queryByText(emptyMessage)).toBeNull();
  });

  it("suppresses duplicate Group preparation and stays closed after a safe failure", async () => {
    const prepare = deferred<boolean>();
    const ledger = controller();
    ledger.ensureReferenceData = vi.fn(() => prepare.promise);
    render(
      <LedgerTableViewHeader
        controller={ledger}
        scope="ledger.transactions"
        title="Transactions"
        headingId="transactions-heading"
      />,
    );
    const group = screen.getByRole("button", { name: "Group Transactions" });
    fireEvent.click(group);
    fireEvent.click(group);
    expect(ledger.ensureReferenceData).toHaveBeenCalledOnce();
    expect(group).toHaveAttribute("aria-disabled", "true");

    await act(async () => prepare.resolve(false));
    expect(screen.queryByRole("dialog", { name: "Group Transactions" })).toBeNull();
    expect(screen.queryByText(/storage|database|raw/i)).toBeNull();
  });

  it.each(["Filter", "Sort"] as const)(
    "keeps the %s menu open when stale Group preparation completes",
    async (menu) => {
      const prepare = deferred<boolean>();
      const ledger = controller();
      ledger.ensureReferenceData = vi.fn(() => prepare.promise);
      render(
        <LedgerTableViewHeader
          controller={ledger}
          scope="ledger.transactions"
          title="Transactions"
          headingId="transactions-heading"
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Group Transactions" }));
      fireEvent.click(screen.getByRole("button", { name: `${menu} Transactions` }));
      expect(screen.getByRole("dialog", { name: `${menu} Transactions` }))
        .toBeInTheDocument();

      await act(async () => prepare.resolve(true));

      expect(screen.getByRole("dialog", { name: `${menu} Transactions` }))
        .toBeInTheDocument();
      expect(screen.queryByRole("dialog", { name: "Group Transactions" })).toBeNull();
    },
  );

  it("recovers an initial scope after another scope clears its global error", async () => {
    const user = userEvent.setup();
    let transactionCalls = 0;
    vi.spyOn(ledgerApi, "queryTable").mockImplementation(async (scope, _settings, offset) => {
      if (scope === "ledger.transactions" && transactionCalls++ === 0) {
        throw new Error("raw transaction storage failure");
      }
      return scope === "ledger.transactions"
        ? { items: [transactionOccurrence("recovered", "entry-1", "Recovered")], nextOffset: null }
        : { items: [], nextOffset: null };
    });
    vi.spyOn(ledgerApi, "tableLookups").mockResolvedValue({
      accounts: [], categories: [], currencies: [],
    });

    function RecoveryHarness() {
      const ledger = useLedgerController();
      return (
        <>
          <button type="button" onClick={() => void ledger.ensureTable?.("ledger.accounts")}>
            Load accounts scope
          </button>
          <LedgerPanel controller={ledger} />
        </>
      );
    }
    render(<RecoveryHarness />);
    expect(await screen.findByRole("alert")).toHaveTextContent("raw transaction storage failure");
    await user.click(screen.getByRole("button", { name: "Load accounts scope" }));
    expect(await screen.findByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.queryByText("No transactions yet.")).toBeNull();
    expect(screen.queryByText("raw transaction storage failure")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Recovered")).toBeInTheDocument();
    expect(ledgerApi.queryTable).toHaveBeenCalledWith(
      "ledger.transactions", expect.anything(), 0, expect.any(Date),
    );
  });

  it("retries a failed offset-zero refresh beneath preserved scope rows", async () => {
    const user = userEvent.setup();
    let transactionCalls = 0;
    vi.spyOn(ledgerApi, "queryTable").mockImplementation(async (scope, _settings, offset) => {
      if (scope !== "ledger.transactions") return { items: [], nextOffset: null };
      transactionCalls += 1;
      if (transactionCalls === 1) {
        return {
          items: [transactionOccurrence("old", "old", "Old row")],
          nextOffset: 50,
        };
      }
      if (transactionCalls === 2) throw new Error("raw refresh failure");
      return {
        items: [transactionOccurrence("new", "new", "New row")],
        nextOffset: null,
      };
    });
    vi.spyOn(ledgerApi, "tableLookups").mockResolvedValue({
      accounts: [], categories: [], currencies: [],
    });

    function RefreshRecoveryHarness() {
      const ledger = useLedgerController();
      return (
        <>
          <button type="button" onClick={() => void ledger.refresh()}>Refresh tables</button>
          <button type="button" onClick={() => void ledger.ensureTable?.("ledger.accounts")}>
            Load accounts scope
          </button>
          <LedgerPanel controller={ledger} />
        </>
      );
    }
    render(<RefreshRecoveryHarness />);
    expect(await screen.findByText("Old row")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Refresh tables" }));
    expect(await screen.findByText("raw refresh failure")).toBeInTheDocument();
    expect(screen.getByText("Old row")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Load accounts scope" }));
    expect(await screen.findByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.getByText("Old row")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("New row")).toBeInTheDocument();
    expect(screen.queryByText("Old row")).toBeNull();
    expect(transactionCalls).toBe(3);
    expect(ledgerApi.queryTable).toHaveBeenLastCalledWith(
      "ledger.transactions", expect.anything(), 0, expect.any(Date),
    );
  });

  it("reports an initial table failure and recovers on retry", async () => {
    vi.spyOn(ledgerApi, "queryTable")
      .mockRejectedValueOnce(new Error("Initial Ledger load failed"))
      .mockResolvedValue({ items: [], nextOffset: null });
    vi.spyOn(ledgerApi, "tableLookups")
      .mockResolvedValue({ accounts: [], categories: [], currencies: [] });
    vi.spyOn(ledgerApi, "listCurrencies")
      .mockResolvedValue({ items: loadedState.currencies, nextOffset: null });
    vi.spyOn(ledgerApi, "listAccountCategories")
      .mockResolvedValue({ items: loadedState.accountCategories, nextOffset: null });
    vi.spyOn(ledgerApi, "listAccounts")
      .mockResolvedValue({ items: loadedState.accounts, nextOffset: null });
    vi.spyOn(ledgerApi, "listTransactionCategories")
      .mockResolvedValue({ items: loadedState.categories, nextOffset: null });
    vi.spyOn(ledgerApi, "listAccountBalances")
      .mockResolvedValue({ items: [], nextOffset: null });

    const { result } = renderHook(() => useLedgerController());
    await act(async () => result.current.ensureTable!("ledger.transactions"));
    await waitFor(() => expect(result.current.state.status).toBe("error"));
    expect(result.current.state.error).toBe("Initial Ledger load failed");

    await act(async () => expect(await result.current.refresh()).toBe(true));
    expect(result.current.state.status).toBe("loaded");
    expect(result.current.state.error).toBeNull();
  });

  it("limits persisted refresh failures to transaction creation methods", async () => {
    vi.spyOn(ledgerApi, "queryTable")
      .mockResolvedValueOnce({ items: [], nextOffset: null })
      .mockRejectedValue(new Error("Ledger refresh failed"));
    vi.spyOn(ledgerApi, "tableLookups")
      .mockResolvedValue({ accounts: [], categories: [], currencies: [] });
    vi.spyOn(ledgerApi, "listCurrencies")
      .mockResolvedValue({ items: loadedState.currencies, nextOffset: null });
    vi.spyOn(ledgerApi, "listAccountCategories")
      .mockResolvedValue({ items: loadedState.accountCategories, nextOffset: null });
    vi.spyOn(ledgerApi, "listAccounts")
      .mockResolvedValue({ items: loadedState.accounts, nextOffset: null });
    vi.spyOn(ledgerApi, "listTransactionCategories")
      .mockResolvedValue({ items: loadedState.categories, nextOffset: null });
    vi.spyOn(ledgerApi, "listAccountBalances")
      .mockResolvedValue({ items: [], nextOffset: null });
    vi.spyOn(ledgerApi, "createEntry").mockResolvedValue({} as never);
    vi.spyOn(ledgerApi, "updateEntry").mockResolvedValue({} as never);
    vi.spyOn(ledgerApi, "createTransfer").mockResolvedValue({} as never);
    vi.spyOn(ledgerApi, "archiveEntry").mockResolvedValue({} as never);
    vi.spyOn(ledgerApi, "restoreEntry").mockResolvedValue({} as never);
    vi.spyOn(ledgerApi, "purgeEntry").mockResolvedValue(undefined);
    vi.spyOn(ledgerApi, "createAccount").mockResolvedValue({} as never);
    vi.spyOn(ledgerApi, "updateAccount").mockResolvedValue({} as never);
    vi.spyOn(ledgerApi, "createTransactionCategory").mockResolvedValue({} as never);
    vi.spyOn(ledgerApi, "updateTransactionCategory").mockResolvedValue({} as never);
    vi.spyOn(ledgerApi, "purgeMaster").mockResolvedValue(undefined);

    const { result } = renderHook(() => useLedgerController());
    await waitFor(() => expect(result.current.state.status).toBe("loaded"));
    await act(async () => result.current.ensureTable!("ledger.transactions"));

    const ordinaryMutations = [
      () => result.current.updateEntry("entry", {} as never),
      () => result.current.archive("entry"),
      () => result.current.restore("entry"),
      () => result.current.purge("entry", "confirm"),
      () => result.current.createAccount({} as never),
      () => result.current.updateAccount("account", {}),
      () => result.current.archiveAccount("account"),
      () => result.current.restoreAccount("account"),
      () => result.current.purgeAccount("account", "confirm"),
      () => result.current.createCategory({} as never),
      () => result.current.updateCategory("category", {}),
      () => result.current.archiveCategory("category"),
      () => result.current.restoreCategory("category"),
      () => result.current.purgeCategory("category", "confirm"),
    ];
    for (const mutation of ordinaryMutations) {
      await act(async () => {
        await expect(mutation()).resolves.toBeUndefined();
      });
    }
    expect(result.current.state.status).toBe("loaded");
    expect(result.current.state.error).toBe("Ledger refresh failed");

    vi.mocked(ledgerApi.queryTable)
      .mockResolvedValueOnce({ items: [], nextOffset: null });
    await act(async () => {
      expect(await result.current.refresh()).toBe(true);
    });
    expect(result.current.state.error).toBeNull();

    await act(async () => {
      await expect(result.current.createEntry({} as never))
        .rejects.toBeInstanceOf(LedgerMutationRefreshError);
      expect(result.current.state.status).toBe("loaded");
      await expect(result.current.transfer({} as never))
        .rejects.toBeInstanceOf(LedgerMutationRefreshError);
      expect(result.current.state.status).toBe("loaded");
    });
  });

  it.each(["success", "error"] as const)(
    "coalesces a superseded refresh into the newer %s result",
    async (newerCompletion) => {
      const older = deferred<{ items: LedgerTableOccurrence[]; nextOffset: null }>();
      const newer = deferred<{ items: LedgerTableOccurrence[]; nextOffset: null }>();
      vi.spyOn(ledgerApi, "queryTable")
        .mockResolvedValueOnce({ items: [], nextOffset: null })
        .mockReturnValueOnce(older.promise)
        .mockReturnValueOnce(newer.promise);
      vi.spyOn(ledgerApi, "tableLookups")
        .mockResolvedValue({ accounts: [], categories: [], currencies: [] });
      vi.spyOn(ledgerApi, "listCurrencies")
        .mockResolvedValue({ items: loadedState.currencies, nextOffset: null });
      vi.spyOn(ledgerApi, "listAccountCategories")
        .mockResolvedValue({ items: loadedState.accountCategories, nextOffset: null });
      vi.spyOn(ledgerApi, "listAccounts")
        .mockResolvedValue({ items: loadedState.accounts, nextOffset: null });
      vi.spyOn(ledgerApi, "listTransactionCategories")
        .mockResolvedValue({ items: loadedState.categories, nextOffset: null });
      vi.spyOn(ledgerApi, "listAccountBalances")
        .mockResolvedValue({ items: [], nextOffset: null });

      const { result } = renderHook(() => useLedgerController());
      await waitFor(() => expect(result.current.state.status).toBe("loaded"));
      await act(async () => result.current.ensureTable!("ledger.transactions"));
      let olderRequest!: Promise<boolean>;
      let newerRequest!: Promise<boolean>;
      act(() => {
        olderRequest = result.current.refresh();
        newerRequest = result.current.refresh();
      });
      let olderSettled = false;
      void olderRequest.then(() => {
        olderSettled = true;
      });
      await act(async () => {
        older.resolve({
          items: [transactionOccurrence("older", "older", "Older")],
          nextOffset: null,
        });
        await Promise.resolve();
      });
      expect(olderSettled).toBe(false);

      let outcomes!: boolean[];
      await act(async () => {
        if (newerCompletion === "success") {
          newer.resolve({
            items: [transactionOccurrence("newer", "newer", "Newer")],
            nextOffset: null,
          });
        } else {
          newer.reject(new Error("Winning refresh failed"));
        }
        outcomes = await Promise.all([olderRequest, newerRequest]);
      });

      expect(result.current.state.status).toBe("loaded");
      expect(outcomes).toEqual(newerCompletion === "success"
        ? [true, true]
        : [false, false]);
      if (newerCompletion === "success") {
        expect(result.current.state.error).toBeNull();
        const item = result.current.tablePage!("ledger.transactions").items[0];
        expect(item?.scope === "ledger.transactions" ? item.record.content : undefined)
          .toBe("Newer");
      } else {
        expect(result.current.state.error).toBe("Winning refresh failed");
      }
    },
  );

  it("does not let a late stale refresh overwrite the applied result", async () => {
    const older = deferred<{ items: LedgerTableOccurrence[]; nextOffset: null }>();
    const newer = deferred<{ items: LedgerTableOccurrence[]; nextOffset: null }>();
    vi.spyOn(ledgerApi, "queryTable")
      .mockResolvedValueOnce({ items: [], nextOffset: null })
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);
    vi.spyOn(ledgerApi, "tableLookups")
      .mockResolvedValue({ accounts: [], categories: [], currencies: [] });
    vi.spyOn(ledgerApi, "listCurrencies")
      .mockResolvedValue({ items: loadedState.currencies, nextOffset: null });
    vi.spyOn(ledgerApi, "listAccountCategories")
      .mockResolvedValue({ items: loadedState.accountCategories, nextOffset: null });
    vi.spyOn(ledgerApi, "listAccounts")
      .mockResolvedValue({ items: loadedState.accounts, nextOffset: null });
    vi.spyOn(ledgerApi, "listTransactionCategories")
      .mockResolvedValue({ items: loadedState.categories, nextOffset: null });
    vi.spyOn(ledgerApi, "listAccountBalances")
      .mockResolvedValue({ items: [], nextOffset: null });

    const { result } = renderHook(() => useLedgerController());
    await waitFor(() => expect(result.current.state.status).toBe("loaded"));
    await act(async () => result.current.ensureTable!("ledger.transactions"));
    let olderRequest!: Promise<boolean>;
    let newerRequest!: Promise<boolean>;
    act(() => {
      olderRequest = result.current.refresh();
      newerRequest = result.current.refresh();
    });

    await act(async () => {
      newer.resolve({
        items: [transactionOccurrence("newer", "newer", "Newer")],
        nextOffset: null,
      });
      expect(await newerRequest).toBe(true);
    });
    await act(async () => {
      older.reject(new Error("Stale refresh failed"));
      expect(await olderRequest).toBe(true);
    });

    expect(result.current.state.status).toBe("loaded");
    expect(result.current.state.error).toBeNull();
    const item = result.current.tablePage!("ledger.transactions").items[0];
    expect(item?.scope === "ledger.transactions" ? item.record.content : undefined)
      .toBe("Newer");
  });

  it("exposes Ledger view save failures with a retry action", async () => {
    const user = userEvent.setup();
    const ledger = controller();
    ledger.tableViewSaveError = "Could not save Ledger views.";
    render(<LedgerPanel controller={ledger} />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not save Ledger views.",
    );
    await user.click(screen.getByRole("button", { name: "Retry view save" }));
    expect(ledger.retryTableViewSave).toHaveBeenCalledOnce();
  });

  it("reuses table tabs, Ledger field controls, pills, and focus dismissal", async () => {
    const user = userEvent.setup();
    const views = createLedgerTableViews({
      "ledger.transactions": {
        tabs: [{
          id: "all",
          name: "All",
          settings: {
            sortRules: [{ id: "amount", field: "amount", direction: "desc" }],
            groupSettings: { groupBy: "account" },
          },
        }, {
          id: "recent",
          name: "Recent",
          settings: {},
        }],
      },
    });
    const ledger = controller();
    ledger.tableTabs = (scope) => views[scope];
    ledger.tableSettings = (scope) => views[scope].draftSettings;
    ledger.tableIsDirty = vi.fn(() => false);
    render(<LedgerPanel controller={ledger} />);

    expect(screen.getByRole("tablist", { name: "Transactions views" }))
      .toBeInTheDocument();
    expect(screen.getByLabelText("Active Transactions controls"))
      .toHaveTextContent("Sorted by amount");
    expect(screen.getByLabelText("Active Transactions controls"))
      .toHaveTextContent("Grouped by account");

    const filter = screen.getByRole("button", { name: "Filter Transactions" });
    await user.click(filter);
    await user.click(screen.getByRole("button", { name: "Add filter rule" }));
    expect(screen.getByRole("option", { name: "Date" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Amount" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(filter).toHaveFocus());
    expect(screen.queryByRole("dialog", { name: "Filter Transactions" }))
      .not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Add Transactions view" }));
    const name = screen.getByRole("textbox", { name: "View name" });
    await user.clear(name);
    await user.type(name, "Monthly");
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(ledger.createTableTab).toHaveBeenCalledWith(
      "ledger.transactions",
      "Monthly",
    );

    await user.click(screen.getByRole("button", { name: "Open Recent view menu" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(ledger.requestDeleteTableTab).toHaveBeenCalledWith(
      "ledger.transactions",
      "recent",
    );
  });

  it("keeps transaction category and currency filter candidates separate", async () => {
    const user = userEvent.setup();
    render(<TransactionHeaderHarness />);

    await user.click(screen.getByRole("button", { name: "Filter Transactions" }));
    await user.click(screen.getByRole("button", { name: "Add filter rule" }));
    await user.click(screen.getByRole("option", { name: "Category" }));
    await user.click(screen.getByRole("button", { name: "Select Category filter values" }));
    expect(screen.getByText("Food")).toBeInTheDocument();
    expect(screen.queryByText("USD")).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Filter field"), "currency");
    expect(screen.getByText("USD")).toBeInTheDocument();
    expect(screen.getByText("KRW")).toBeInTheDocument();
    expect(screen.queryByText("Food")).not.toBeInTheDocument();
  });

  it("keeps saved view tabs independent across Ledger table leaves", () => {
    const views = createLedgerTableViews({
      "ledger.transactions": { tabs: [{ id: "tx", name: "Recent", settings: {} }] },
      "ledger.accounts": { tabs: [{ id: "account", name: "Balances", settings: {} }] },
      "ledger.categories": { tabs: [{ id: "category", name: "Income", settings: {} }] },
    });
    const ledger = controller();
    ledger.tableTabs = (scope) => views[scope];
    ledger.tableSettings = (scope) => views[scope].draftSettings;
    const { rerender } = render(<LedgerPanel controller={ledger} />);
    expect(screen.getByRole("tab", { name: "Recent" })).toBeInTheDocument();

    rerender(<LedgerPanel controller={ledger} leafTabId="accounts" />);
    expect(screen.getByRole("tab", { name: "Balances" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Recent" })).not.toBeInTheDocument();

    rerender(<LedgerPanel controller={ledger} leafTabId="categories" />);
    expect(screen.getByRole("tab", { name: "Income" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Balances" })).not.toBeInTheDocument();
  });

  it("loads, edits, and persists Ledger table views independently", async () => {
    mockLedgerLoads();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("ledger.views.v1")) {
        return new Response(JSON.stringify({
          "ledger.transactions": {
            tabs: [{
              id: "recent",
              name: "Recent",
              settings: {
                sortRules: [{ id: "date", field: "date", direction: "desc" }],
              },
            }],
          },
          "ledger.accounts": "broken",
          "ledger.categories": {
            tabs: [{ id: "income", name: "Income", settings: {} }],
          },
        }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useLedgerController());
    await waitFor(() => expect(result.current.state.status).toBe("loaded"));
    await waitFor(() => expect(
      result.current.tableTabs("ledger.transactions").activeTabId,
    ).toBe("recent"));

    expect(result.current.tableTabs("ledger.accounts").activeTabId)
      .toBe("ledger.accounts-table");
    expect(result.current.tableTabs("ledger.categories").activeTabId)
      .toBe("income");

    act(() => {
      expect(result.current.createTableTab("ledger.accounts", "By currency"))
        .toBe(true);
    });
    const createdAccountTabId = result.current.tableTabs("ledger.accounts").activeTabId;
    act(() => {
      result.current.renameTableTab(
        "ledger.accounts",
        createdAccountTabId,
        "Currencies",
      );
    });
    act(() => {
      result.current.updateTableSettings("ledger.accounts", (settings) => ({
        ...settings,
        groupSettings: { ...settings.groupSettings, groupBy: "currency" },
      }));
    });
    act(() => {
      result.current.saveTableTab("ledger.accounts");
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/preferences/ledger.views.v1",
      expect.objectContaining({ method: "PUT" }),
    ));
    expect(result.current.tableTabs("ledger.transactions").tabs[0]?.name)
      .toBe("Recent");
    expect(result.current.tableTabs("ledger.accounts").tabs[1]?.name)
      .toBe("Currencies");
    expect(result.current.tableTabs("ledger.accounts").tabs[1]?.settings.groupSettings.groupBy)
      .toBe("currency");

    const accountTabId = result.current.tableTabs("ledger.accounts").activeTabId;
    act(() => result.current.requestDeleteTableTab("ledger.accounts", accountTabId));
    expect(result.current.tableViewConfirmation).toMatchObject({
      kind: "delete",
      target: { scope: "ledger.accounts" },
      targetTabId: accountTabId,
    });
    act(() => result.current.confirmTableViewAction());
    expect(result.current.tableTabs("ledger.accounts").tabs).toHaveLength(1);
    expect(result.current.tableTabs("ledger.transactions").tabs).toHaveLength(1);
  });

  it("replays early view commands over a delayed stored preference", async () => {
    mockLedgerLoads();
    const stored = deferred<Response>();
    const putBodies: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (!init) return stored.promise;
      putBodies.push(JSON.parse(String(init.body)));
      return Promise.resolve(new Response("{}", { status: 200 }));
    }));

    const { result } = renderHook(() => useLedgerController());
    await waitFor(() => expect(result.current.state.status).toBe("loaded"));
    act(() => {
      expect(result.current.createTableTab("ledger.accounts", "Early"))
        .toBe(true);
    });
    expect(result.current.tableTabs("ledger.accounts").tabs.map(({ name }) => name))
      .toEqual(["Table", "Early"]);

    await act(async () => stored.resolve(new Response(JSON.stringify({
      "ledger.transactions": {
        tabs: [{ id: "stored-tx", name: "Stored transactions", settings: {} }],
      },
      "ledger.accounts": {
        tabs: [{ id: "stored-account", name: "Stored accounts", settings: {} }],
      },
    }), { status: 200 })));

    await waitFor(() => expect(
      result.current.tableTabs("ledger.accounts").tabs.map(({ name }) => name),
    ).toEqual(["Stored accounts", "Early"]));
    expect(result.current.tableTabs("ledger.transactions").tabs[0]?.name)
      .toBe("Stored transactions");
    await waitFor(() => expect(putBodies).toHaveLength(1));
    expect(putBodies[0]).toMatchObject({
      value: {
        "ledger.transactions": {
          tabs: [expect.objectContaining({ name: "Stored transactions" })],
        },
        "ledger.accounts": {
          tabs: [
            expect.objectContaining({ name: "Stored accounts" }),
            expect.objectContaining({ name: "Early" }),
          ],
        },
      },
    });
  });

  it("reports a failed view preference write and retries the current views", async () => {
    mockLedgerLoads();
    let putCount = 0;
    vi.stubGlobal("fetch", vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      if (!init) return Promise.resolve(new Response("{}", { status: 200 }));
      putCount += 1;
      return Promise.resolve(new Response("{}", { status: putCount === 1 ? 500 : 200 }));
    }));

    const { result } = renderHook(() => useLedgerController());
    await waitFor(() => expect(result.current.state.status).toBe("loaded"));
    await waitFor(() => expect(
      result.current.tableTabs("ledger.transactions").activeTabId,
    ).toBe("ledger.transactions-table"));
    act(() => {
      result.current.createTableTab("ledger.transactions", "Unsaved view");
    });

    await waitFor(() => expect(result.current.tableViewSaveError)
      .toBe("Could not save Ledger views."));
    act(() => result.current.retryTableViewSave());
    expect(result.current.tableViewSaveError).toBe("Could not save Ledger views.");
    await waitFor(() => expect(putCount).toBe(2));
    await waitFor(() => expect(result.current.tableViewSaveError).toBeNull());
    expect(result.current.tableTabs("ledger.transactions").tabs.at(-1)?.name)
      .toBe("Unsaved view");
  });

  it("ignores an older failed write after a newer queued view save succeeds", async () => {
    mockLedgerLoads();
    let putCount = 0;
    vi.stubGlobal("fetch", vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      if (!init) return Promise.resolve(new Response("{}", { status: 200 }));
      putCount += 1;
      return Promise.resolve(new Response("{}", { status: putCount === 1 ? 500 : 200 }));
    }));

    const { result } = renderHook(() => useLedgerController());
    await waitFor(() => expect(
      result.current.tableTabs("ledger.transactions").activeTabId,
    ).toBe("ledger.transactions-table"));
    act(() => {
      result.current.createTableTab("ledger.transactions", "Queued");
    });
    const tabId = result.current.tableTabs("ledger.transactions").activeTabId;
    act(() => {
      result.current.renameTableTab("ledger.transactions", tabId, "Queued latest");
    });

    await waitFor(() => expect(putCount).toBe(2));
    expect(result.current.tableViewSaveError).toBeNull();
  });
});
