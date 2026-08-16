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
import type {
  LedgerComparison,
  LedgerEntryView,
  LedgerTrend,
} from "@/features/ledger/model/ledger-model";
import { deriveTransactionGroups } from "@/features/ledger/model/transaction-table";
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
  reportStatus: "idle",
  reportError: null,
  reportSelection: { period: "current_month" },
  comparison: null,
  trend: null,
  summary: null,
  accountBreakdown: [],
  categoryBreakdown: [],
};

function controller(state: LedgerState = loadedState): LedgerController {
  const views = createLedgerTableViews();
  return {
    state,
    tableViewSaveError: null,
    retryTableViewSave: vi.fn(),
    tableViewConfirmation: null,
    tableTabs: (scope) => views[scope],
    tableSettings: (scope) => views[scope].draftSettings,
    tableIsDirty: vi.fn(() => false),
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
    runReports: vi.fn().mockResolvedValue(undefined),
    retryReports: vi.fn().mockResolvedValue(undefined),
  };
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
    accountBreakdown: [{
      currencyId: "currency-krw",
      currencyCode: "KRW",
      decimalPlaces: 0,
      referenceId: "account-cash",
      name: "Cash",
      incomeMinor: 3000,
      expenseMinor: 1200,
      netChangeMinor: 1800,
      entryCount: 3,
    }, {
      currencyId: "currency-krw",
      currencyCode: "KRW",
      decimalPlaces: 0,
      referenceId: null,
      name: "Unknown account",
      incomeMinor: 0,
      expenseMinor: 0,
      netChangeMinor: 0,
      entryCount: 0,
    }, {
      currencyId: "currency-usd",
      currencyCode: "USD",
      decimalPlaces: 2,
      referenceId: "account-card",
      name: "Card",
      incomeMinor: 1234,
      expenseMinor: 200,
      netChangeMinor: 1034,
      entryCount: 2,
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

  it("opens Account settings only from Accounts and restores the Accounts form after Escape", async () => {
    const user = userEvent.setup();
    const ledger = controller();
    const { rerender } = render(<LedgerPanel controller={ledger} leafTabId="accounts" />);

    const trigger = screen.getByRole("button", { name: "Account settings" });
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    await user.clear(screen.getByLabelText("Opening balance"));
    await user.type(screen.getByLabelText("Opening balance"), "1200");
    await user.click(trigger);
    expect(screen.getByRole("dialog", { name: "Account settings" })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Account settings" })).toBeNull();
    expect(trigger).toHaveFocus();
    expect(screen.getByLabelText("Opening balance")).toHaveValue("1200");
    expect(screen.getByRole("button", { name: "Edit Cash" })).toBeInTheDocument();

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
    await user.type(screen.getByLabelText("Account type name"), "Wallet");
    await user.click(screen.getByRole("button", { name: "Add account type" }));

    expect(screen.getByRole("dialog", { name: "Account settings" })).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(screen.getByRole("button", { name: "Close" })).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "Account settings" })).toBeInTheDocument();

    await act(async () => request.resolve(undefined));
  });

  it("uses complete, keyboard-operable tabs and shows only active settings", async () => {
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

    const tabs = screen.getByRole("tablist", { name: "Account settings sections" });
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
    expect(screen.getAllByText("Cash")).not.toHaveLength(0);
    expect(screen.queryByText("Old category")).toBeNull();

    accountTypes.focus();
    await user.keyboard("{ArrowRight}");
    expect(currencies).toHaveFocus();
    expect(screen.getByRole("tabpanel", { name: "Currencies" }))
      .toHaveAttribute("aria-labelledby", "currencies-tab");
    expect(screen.getByText("KRW")).toBeInTheDocument();
    expect(screen.queryByText("OLD")).toBeNull();
    await user.keyboard("{ArrowLeft}");
    expect(accountTypes).toHaveFocus();
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
    await user.click(screen.getByRole("button", { name: "Add account type" }));
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
    await user.click(screen.getByRole("button", { name: "Update account type" }));
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
    await user.click(screen.getByRole("button", { name: "Add account type" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save account type.");
    expect(screen.getByRole("alert")).not.toHaveTextContent("sqlite");
    expect(screen.getByLabelText("Account type name")).toHaveValue("Wallet");
    expect(screen.getByLabelText("Liability")).toBeChecked();
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
    await user.click(screen.getByRole("button", { name: "Add currency" }));
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
    await user.click(screen.getByRole("button", { name: "Update currency" }));
    expect(ledger.updateCurrency).toHaveBeenCalledWith("currency-krw", {
      code: "KWR",
      name: "Korean won updated",
      symbol: "W",
      decimalPlaces: 3,
    });

    await user.click(screen.getByRole("button", { name: "Edit USD" }));
    await user.clear(screen.getByLabelText("Decimal places"));
    await user.type(screen.getByLabelText("Decimal places"), "19");
    await user.click(screen.getByRole("button", { name: "Update currency" }));
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
    await user.click(screen.getByRole("button", { name: "Add currency" }));
    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
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

    const { result } = renderHook(() => useLedgerController());
    await waitFor(() => expect(result.current.state.status).toBe("loaded"));

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
    expect(ledgerApi.listAccountCategories).toHaveBeenCalledTimes(4);
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

    view.rerender(<LedgerPanel controller={{
      ...ledger,
      state: { ...ledger.state, entries: [] },
    }} />);

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

    view.rerender(<LedgerPanel controller={{
      ...ledger,
      state: { ...ledger.state, entries: [transactionEntry("expense-1", "Lunch")] },
    }} />);
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

  it.each([
    ["accounts", "Accounts"],
    ["categories", "Categories"],
  ] as const)("preserves the pre-Transactions %s header structure", (leafTabId, title) => {
    render(<LedgerPanel controller={controller()} leafTabId={leafTabId} />);

    const heading = screen.getByRole("heading", { name: title });
    const header = heading.closest("header")!;
    const row = within(header).getByRole("group", { name: `${title} controls` }).parentElement!;
    const tabs = screen.getByRole("tablist", { name: `${title} views` });
    expect(row).toHaveClass("workspace-table-header-row");
    expect(row).not.toHaveClass("ledger-table-header-row");
    expect(within(header).queryByRole("tablist")).toBeNull();
    expect(header.nextElementSibling).toBe(tabs);
    expect(screen.queryByRole("button", { name: "Archive selected transactions" })).toBeNull();
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
    await user.click(screen.getByRole("button", { name: "Save transaction" }));

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
    const supersededEntries = deferred<{ items: LedgerEntryView[]; nextOffset: null }>();
    const refreshedEntries = deferred<{ items: LedgerEntryView[]; nextOffset: null }>();
    vi.spyOn(ledgerApi, "listEntries")
      .mockResolvedValueOnce({ items: [], nextOffset: null })
      .mockReturnValueOnce(supersededEntries.promise)
      .mockReturnValueOnce(refreshedEntries.promise);
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
    await user.click(screen.getByRole("button", { name: "Save transaction" }));
    await waitFor(() => expect(ledgerApi.listEntries).toHaveBeenCalledTimes(2));
    act(() => {
      void liveController.refresh();
    });
    await waitFor(() => expect(ledgerApi.listEntries).toHaveBeenCalledTimes(3));

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
      items: [entryView("entry-1", "Lunch")],
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
    await user.click(screen.getByRole("button", { name: "Save transaction" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Transaction could not be saved",
    );
    expect(screen.getByRole("dialog", { name: "Add transaction" })).toBeInTheDocument();
    expect(screen.getByLabelText("Content")).toHaveValue("Lunch");
    expect(screen.getByLabelText("Amount")).toHaveValue("12000");
    const submit = screen.getByRole("button", { name: "Save transaction" });
    expect(submit).not.toBeDisabled();
    expect(submit).toHaveFocus();
  });

  it("recovers a persisted creation with refresh-only retries", async () => {
    const user = userEvent.setup();
    vi.spyOn(ledgerApi, "listEntries")
      .mockResolvedValueOnce({ items: [], nextOffset: null })
      .mockRejectedValueOnce(new Error("Ledger refresh failed"))
      .mockRejectedValueOnce(new Error("Ledger refresh still failed"))
      .mockResolvedValue({ items: [entryView("entry-1", "Lunch")], nextOffset: null });
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
    await user.click(screen.getByRole("button", { name: "Save transaction" }));

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
      const older = deferred<{ items: LedgerEntryView[]; nextOffset: null }>();
      const winner = deferred<{ items: LedgerEntryView[]; nextOffset: null }>();
      vi.spyOn(ledgerApi, "listEntries")
        .mockResolvedValueOnce({ items: [], nextOffset: null })
        .mockReturnValueOnce(older.promise)
        .mockReturnValueOnce(winner.promise);
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
        await waitFor(() => expect(ledgerApi.listEntries).toHaveBeenCalledTimes(2));
        await user.click(screen.getByRole("button", { name: "Save transaction" }));
      } else {
        await user.click(screen.getByRole("button", { name: "Save transaction" }));
        await waitFor(() => expect(ledgerApi.listEntries).toHaveBeenCalledTimes(2));
        act(() => {
          ordinary = liveController.archive("entry-existing");
        });
      }
      await waitFor(() => expect(ledgerApi.listEntries).toHaveBeenCalledTimes(3));

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
    await user.click(screen.getByRole("button", { name: "Save transaction" }));
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
    const save = screen.getByRole("button", { name: "Save transaction" });
    expect(close).toHaveFocus();

    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(save).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Add transaction" })).toBeNull();
    expect(trigger).toHaveFocus();
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
    const ledger = controller();
    const { rerender } = render(
      <LedgerPanel leafTabId="accounts" controller={ledger} />,
    );
    expect(screen.getByRole("heading", { name: "Accounts" })).toBeInTheDocument();
    const accountsTable = screen.getByRole("table");
    expect(within(accountsTable).getAllByText("Cash")).toHaveLength(2);
    expect(within(accountsTable).getByText("Korean won")).toBeInTheDocument();
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
    vi.mocked(ledgerApi.listEntries)
      .mockResolvedValueOnce({
        items: [transactionEntry("expense-1", "Lunch")],
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
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(screen.queryByText("Lunch")).toBeNull();
    expect(ledgerApi.archiveEntry).toHaveBeenCalledOnce();
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

  it("submits each Reports period preset", async () => {
    const user = userEvent.setup();
    const ledger = controller();
    render(<LedgerPanel leafTabId="reports" controller={ledger} />);

    await user.click(screen.getByRole("button", { name: "Previous month" }));
    await user.click(screen.getByRole("button", { name: "Current year" }));

    expect(ledger.runReports).toHaveBeenNthCalledWith(2, { period: "previous_month" });
    expect(ledger.runReports).toHaveBeenNthCalledWith(3, { period: "current_year" });
  });

  it("submits a custom Reports date range", async () => {
    const user = userEvent.setup();
    const ledger = controller();
    render(<LedgerPanel leafTabId="reports" controller={ledger} />);

    await user.type(screen.getByLabelText("From"), "2026-07-01");
    await user.type(screen.getByLabelText("To"), "2026-07-31");
    await user.click(screen.getByRole("button", { name: "Run reports" }));

    expect(ledger.runReports).toHaveBeenLastCalledWith({
      period: "custom",
      from: "2026-07-01",
      to: "2026-07-31",
    });
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
    await user.type(screen.getByLabelText("From"), "2026-07-01");
    await user.type(screen.getByLabelText("To"), "2026-07-31");
    await user.click(screen.getByRole("button", { name: "Run reports" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Custom range failed");

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

  it("renders four report summary cards with signed previous-period changes", () => {
    render(<LedgerPanel leafTabId="reports" controller={controller(reportAnalysisState())} />);

    const summary = screen.getByRole("region", { name: "Summary" });
    expect(within(summary).getByRole("group", { name: "Income" }))
      .toHaveTextContent("3000 KRW");
    expect(within(summary).getByRole("group", { name: "Income" }))
      .toHaveTextContent("+1000 KRW");
    expect(within(summary).getByRole("group", { name: "Expenses" }))
      .toHaveTextContent("−300 KRW");
    expect(within(summary).getByRole("group", { name: "Net" }))
      .toHaveTextContent("+1300 KRW");
    expect(within(summary).getByRole("group", { name: "Entries" }))
      .toHaveTextContent("+1");
  });

  it("uses the same expense rows and total for the category donut and table", () => {
    const onReportDrilldown = vi.fn();
    render(
      <LedgerPanel
        leafTabId="reports"
        controller={controller(reportAnalysisState())}
        onReportDrilldown={onReportDrilldown}
      />,
    );

    const categories = screen.getByRole("region", { name: "Expense categories" });
    expect(within(categories).getAllByText("1200 KRW")).toHaveLength(2);
    expect(within(categories).getByRole("button", { name: /Food, 700 KRW/ }))
      .toBeInTheDocument();
    expect(within(categories).getByRole("row", { name: /Transit 500 KRW/ }))
      .toBeInTheDocument();
  });

  it("renders account income, expense, and net while omitting invalid drilldowns", async () => {
    const user = userEvent.setup();
    const onReportDrilldown = vi.fn();
    render(
      <LedgerPanel
        leafTabId="reports"
        controller={controller(reportAnalysisState())}
        onReportDrilldown={onReportDrilldown}
      />,
    );

    const accounts = screen.getByRole("region", { name: "Accounts" });
    expect(within(accounts).getByRole("row", {
      name: /View Cash transactions 3000 KRW 1200 KRW 1800 KRW/,
    }))
      .toBeInTheDocument();
    expect(within(accounts).queryByRole("button", { name: /Unknown account/ })).toBeNull();
    await user.click(within(accounts).getByRole("button", { name: "View Cash transactions" }));
    expect(onReportDrilldown).toHaveBeenCalledWith({
      range: { start: "2026-08-01", end: "2026-08-31" },
      currencyId: "currency-krw",
      kind: "account",
      referenceId: "account-cash",
    });
  });

  it("announces trend granularity and exposes both series at every point", () => {
    render(<LedgerPanel leafTabId="reports" controller={controller(reportAnalysisState())} />);

    const trendChart = screen.getByRole("img", { name: "Income and expense trend" });
    expect(screen.getByRole("region", { name: "Trend" })).toHaveTextContent("Daily granularity");
    expect(trendChart.querySelectorAll("polyline")).toHaveLength(2);
    expect(screen.getByText("2026-08-01: Income 1000 KRW; Expense 700 KRW"))
      .toBeInTheDocument();
    expect(screen.getByText("2026-08-02: Income 2000 KRW; Expense 500 KRW"))
      .toBeInTheDocument();
  });

  it("shows zero cards and section-specific messages for an empty report", () => {
    const empty = reportAnalysisState({
      comparison: {
        current: { range: { start: "2026-08-01", end: "2026-08-31" }, currencies: [] },
        previous: { range: { start: "2026-07-01", end: "2026-07-31" }, currencies: [] },
        currencies: [],
      },
      accountBreakdown: [],
      categoryBreakdown: [],
      trend: {
        range: { start: "2026-08-01", end: "2026-08-31" },
        granularity: "daily",
        currencies: [],
      },
    });
    render(<LedgerPanel leafTabId="reports" controller={controller(empty)} />);

    expect(screen.getByRole("region", { name: "Summary" })).toHaveTextContent("Income0");
    expect(screen.getByText("No expense categories for this period.")).toBeInTheDocument();
    expect(screen.getByText("No account activity for this period.")).toBeInTheDocument();
    expect(screen.getByText("No trend data for this period.")).toBeInTheDocument();
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
            currentBalanceMinor: 5678,
          }],
        })}
      />,
    );
    expect(screen.getByText("12.34 USD")).toBeInTheDocument();
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
    expect(within(reportSummary).getByRole("group", { name: "Expenses" }))
      .toHaveTextContent("2.00 USD");
    expect(within(reportSummary).getByRole("group", { name: "Net" }))
      .toHaveTextContent("10.34 USD");
    expect(screen.queryByRole("region", { name: "Briefing" })).toBeNull();
  });

  it("reports account and category lifecycle action failures", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const accountController = controller();
    accountController.archiveAccount = vi.fn().mockRejectedValue(new Error("Account conflict"));
    const { rerender } = render(
      <LedgerPanel leafTabId="accounts" controller={accountController} />,
    );
    await user.click(screen.getByRole("button", { name: "Archive Cash" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Account conflict");

    const categoryController = controller();
    categoryController.archiveCategory =
      vi.fn().mockRejectedValue(new Error("Category conflict"));
    rerender(<LedgerPanel leafTabId="categories" controller={categoryController} />);
    await user.click(screen.getByRole("button", { name: "Archive Food" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Category conflict");
  });

  it("reports account and category purge preview failures", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const accountController = controller();
    const accountPreview = deferred<never>();
    accountController.previewAccountPurge = vi.fn(() => accountPreview.promise);
    const { rerender } = render(
      <LedgerPanel leafTabId="accounts" controller={accountController} />,
    );
    const accountPurge = screen.getByRole("button", { name: "Purge Cash" });
    await user.click(accountPurge);
    await user.click(screen.getByRole("button", { name: "Purge permanently" }));
    await act(async () => accountPreview.reject(new Error("Account preview failed")));
    expect(await screen.findByRole("alert")).toHaveTextContent("Account preview failed");
    await waitFor(() => expect(accountPurge).toHaveFocus());

    const categoryController = controller();
    const categoryPreview = deferred<never>();
    categoryController.previewCategoryPurge = vi.fn(() => categoryPreview.promise);
    rerender(<LedgerPanel leafTabId="categories" controller={categoryController} />);
    const categoryPurge = screen.getByRole("button", { name: "Purge Food" });
    await user.click(categoryPurge);
    await user.click(screen.getByRole("button", { name: "Purge permanently" }));
    await act(async () => categoryPreview.reject(new Error("Category preview failed")));
    expect(await screen.findByRole("alert")).toHaveTextContent("Category preview failed");
    await waitFor(() => expect(categoryPurge).toHaveFocus());
  });

  it("edits a two-decimal account opening balance without changing its value", async () => {
    const user = userEvent.setup();
    const ledger = controller({
      ...loadedState,
      accounts: [{
        ...loadedState.accounts[0],
        currencyId: "currency-usd",
        openingBalanceMinor: 1234,
      }],
    });
    render(<LedgerPanel leafTabId="accounts" controller={ledger} />);

    await user.click(screen.getByRole("button", { name: "Edit Cash" }));
    expect(screen.getByLabelText("Opening balance")).toHaveValue("12.34");
    await user.click(screen.getByRole("button", { name: "Update account" }));
    expect(ledger.updateAccount).toHaveBeenCalledWith(
      "account-cash",
      expect.objectContaining({ openingBalance: "12.34" }),
    );
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

    await act(async () => {
      await result.current.runReports({ period: "current_month" });
    });

    expect(compare).toHaveBeenCalledWith({ period: "current_month" });
    expect(accounts).toHaveBeenCalledWith({ from: "2026-08-01", to: "2026-08-31" });
    expect(categories).toHaveBeenCalledWith({ from: "2026-08-01", to: "2026-08-31" });
    expect(reportTrend).toHaveBeenCalledWith({ from: "2026-08-01", to: "2026-08-31" });
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
      vi.spyOn(ledgerApi, "accountReport").mockResolvedValue([]);
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
    vi.spyOn(ledgerApi, "accountReport").mockResolvedValue([]);
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

  it("retains all controller records across subsequent pages", async () => {
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

    expect(result.current.state.accounts.map((account) => account.name))
      .toEqual(["Cash", "Bank"]);
    expect(result.current.state.entries.map((entry) => entry.entry.content))
      .toEqual(["Lunch", "Dinner"]);
    expect(ledgerApi.listAccounts).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ offset: 200 }),
    );
  });

  it("reports an initial refresh failure and recovers on retry", async () => {
    vi.spyOn(ledgerApi, "listEntries")
      .mockRejectedValueOnce(new Error("Initial Ledger load failed"))
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

    const { result } = renderHook(() => useLedgerController());
    await waitFor(() => expect(result.current.state.status).toBe("error"));
    expect(result.current.state.error).toBe("Initial Ledger load failed");

    let refreshed!: boolean;
    await act(async () => {
      refreshed = await result.current.refresh();
    });
    expect(refreshed).toBe(true);
    expect(result.current.state.status).toBe("loaded");
    expect(result.current.state.error).toBeNull();
  });

  it("limits persisted refresh failures to transaction creation methods", async () => {
    vi.spyOn(ledgerApi, "listEntries")
      .mockResolvedValueOnce({ items: [], nextOffset: null })
      .mockRejectedValue(new Error("Ledger refresh failed"));
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

    vi.mocked(ledgerApi.listEntries)
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
      const older = deferred<{ items: LedgerEntryView[]; nextOffset: null }>();
      const newer = deferred<{ items: LedgerEntryView[]; nextOffset: null }>();
      vi.spyOn(ledgerApi, "listEntries")
        .mockResolvedValueOnce({ items: [], nextOffset: null })
        .mockReturnValueOnce(older.promise)
        .mockReturnValueOnce(newer.promise);
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
        older.resolve({ items: [entryView("older", "Older")], nextOffset: null });
        await Promise.resolve();
      });
      expect(olderSettled).toBe(false);

      let outcomes!: boolean[];
      await act(async () => {
        if (newerCompletion === "success") {
          newer.resolve({ items: [entryView("newer", "Newer")], nextOffset: null });
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
        expect(result.current.state.entries[0]?.entry.content).toBe("Newer");
      } else {
        expect(result.current.state.error).toBe("Winning refresh failed");
      }
    },
  );

  it("does not let a late stale refresh overwrite the applied result", async () => {
    const older = deferred<{ items: LedgerEntryView[]; nextOffset: null }>();
    const newer = deferred<{ items: LedgerEntryView[]; nextOffset: null }>();
    vi.spyOn(ledgerApi, "listEntries")
      .mockResolvedValueOnce({ items: [], nextOffset: null })
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);
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
    let olderRequest!: Promise<boolean>;
    let newerRequest!: Promise<boolean>;
    act(() => {
      olderRequest = result.current.refresh();
      newerRequest = result.current.refresh();
    });

    await act(async () => {
      newer.resolve({ items: [entryView("newer", "Newer")], nextOffset: null });
      expect(await newerRequest).toBe(true);
    });
    await act(async () => {
      older.reject(new Error("Stale refresh failed"));
      expect(await olderRequest).toBe(true);
    });

    expect(result.current.state.status).toBe("loaded");
    expect(result.current.state.error).toBeNull();
    expect(result.current.state.entries[0]?.entry.content).toBe("Newer");
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
