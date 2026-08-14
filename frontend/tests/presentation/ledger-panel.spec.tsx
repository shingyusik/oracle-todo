import "@testing-library/jest-dom/vitest";

import {
  act,
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
import type { LedgerEntryView } from "@/features/ledger/model/ledger-model";
import { createLedgerTableViews } from "@/features/ledger/model/ledger-table-views";
import type {
  LedgerController,
  LedgerState,
} from "@/features/ledger/hooks/useLedgerController";
import { useLedgerController } from "@/features/ledger/hooks/useLedgerController";
import { LedgerPanel } from "@/features/ledger/ui/LedgerPanel";

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
  summary: null,
  accountBreakdown: [],
  categoryBreakdown: [],
  briefing: null,
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
    runReports: vi.fn(),
  };
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

describe("LedgerPanel", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("uses Transactions as the default leaf and has no Overview", () => {
    render(<LedgerPanel controller={controller()} />);

    expect(screen.getByRole("heading", { name: "Transactions" })).toBeInTheDocument();
    expect(screen.queryByText("Overview")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("New transaction")).not.toBeInTheDocument();
    const add = screen.getByRole("button", { name: "Add transaction" });
    expect(add).toHaveClass("items-toolbar-button");
    expect(add.parentElement).toHaveClass("workspace-table-header-row");
    expect(add.previousElementSibling).toHaveAttribute(
      "aria-label",
      "Transactions controls",
    );
    expect(screen.getByText("No transactions yet.")).toBeInTheDocument();
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
    const refreshedEntries = deferred<{ items: LedgerEntryView[]; nextOffset: null }>();
    vi.spyOn(ledgerApi, "listEntries")
      .mockResolvedValueOnce({ items: [], nextOffset: null })
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

    function ProductionLedgerPanel() {
      return <LedgerPanel controller={useLedgerController()} />;
    }

    render(<ProductionLedgerPanel />);
    const trigger = await screen.findByRole("button", { name: "Add transaction" });
    await user.click(trigger);
    await user.type(screen.getByLabelText("Content"), "Lunch");
    await user.selectOptions(screen.getByLabelText("Account"), "account-cash");
    await user.type(screen.getByLabelText("Amount"), "12000");
    await user.click(screen.getByRole("button", { name: "Save transaction" }));
    await waitFor(() => expect(ledgerApi.listEntries).toHaveBeenCalledTimes(2));

    expect(screen.getByRole("dialog", { name: "Add transaction" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close Add transaction" })).toBeDisabled();
    expect(screen.queryByText("Loading Ledger")).toBeNull();

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

  it("closes a persisted creation and exposes its failed refresh for retry", async () => {
    const user = userEvent.setup();
    vi.spyOn(ledgerApi, "listEntries")
      .mockResolvedValueOnce({ items: [], nextOffset: null })
      .mockRejectedValueOnce(new Error("Ledger refresh failed"))
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

    expect(await screen.findByRole("alert")).toHaveTextContent("Ledger refresh failed");
    expect(ledgerApi.createEntry).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog", { name: "Add transaction" })).toBeNull();
    expect(screen.queryByLabelText("New transaction")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Lunch")).toBeInTheDocument();
    expect(ledgerApi.createEntry).toHaveBeenCalledOnce();
  });

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

  it("renders distinct loading and error states", () => {
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

  it("requires confirmation before archive, restore, and purge", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm")
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(true);
    const activeState: LedgerState = {
      ...loadedState,
      entries: [{
        accountName: "Cash",
        categoryName: "Food",
        currencyCode: "KRW",
        entry: {
          id: "entry-1",
          date: "2026-07-30",
          writtenAt: "2026-07-30T09:00:00Z",
          content: "Lunch",
          transactionCategoryId: "category-food",
          accountId: "account-cash",
          entryType: "expense",
          amountMinor: 12000,
          currencyId: "currency-krw",
          transferGroupId: null,
          source: "ui",
          notes: null,
          createdAt: "2026-07-30T09:00:00Z",
          updatedAt: "2026-07-30T09:00:00Z",
          deletedAt: null,
        },
      }],
    };
    const ledger = controller(activeState);
    const { rerender } = render(<LedgerPanel controller={ledger} />);

    await user.click(screen.getByRole("button", { name: /Archive Lunch/ }));
    expect(ledger.archive).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /Archive Lunch/ }));
    expect(ledger.archive).toHaveBeenCalledWith("entry-1");

    const archivedLedger = {
      ...ledger,
      state: {
        ...activeState,
        entries: [{
          ...activeState.entries[0],
          entry: {
            ...activeState.entries[0].entry,
            deletedAt: "2026-07-30T10:00:00Z",
          },
        }],
      },
    };
    rerender(<LedgerPanel controller={archivedLedger} />);
    await user.click(screen.getByRole("button", { name: /Restore Lunch/ }));
    expect(ledger.restore).toHaveBeenCalledWith("entry-1");

    const purgeTrigger = screen.getByRole("button", { name: /Purge Lunch/ });
    await user.click(purgeTrigger);
    const purgeDialog = screen.getByRole("dialog", {
      name: /Permanently purge Lunch/,
    });
    await user.click(within(purgeDialog).getByRole("button", {
      name: "Purge permanently",
    }));
    expect(ledger.previewPurge).toHaveBeenCalledWith("entry-1");
    expect(ledger.purge).toHaveBeenCalledWith("entry-1", "confirm-entry");
    expect(confirm).toHaveBeenCalledTimes(3);
  });

  it("traps purge confirmation focus and restores the trigger on Escape", async () => {
    const user = userEvent.setup();
    const ledger = controller({
      ...loadedState,
      entries: [entryView("entry-1", "Lunch")],
    });
    const view = render(<LedgerPanel controller={ledger} />);
    const appRoot = view.container;
    appRoot?.setAttribute("aria-hidden", "false");
    appRoot?.setAttribute("inert", "existing");

    const trigger = screen.getByRole("button", { name: /Purge Lunch/ });
    await user.click(trigger);
    const dialog = screen.getByRole("dialog", {
      name: /Permanently purge Lunch/,
    });
    const cancel = within(dialog).getByRole("button", { name: "Cancel" });
    const confirm = within(dialog).getByRole("button", {
      name: "Purge permanently",
    });
    expect(cancel).toHaveFocus();
    expect(appRoot).toHaveAttribute("aria-hidden", "true");
    expect(appRoot).toHaveAttribute("inert");
    trigger.focus();
    expect(cancel).toHaveFocus();

    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(confirm).toHaveFocus();
    await user.tab();
    expect(cancel).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: /Permanently purge Lunch/ }))
      .toBeNull();
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(ledger.previewPurge).not.toHaveBeenCalled();
    expect(appRoot).toHaveAttribute("aria-hidden", "false");
    expect(appRoot).toHaveAttribute("inert", "existing");
  });

  it("distinguishes duplicate transaction actions and purge dialogs by row context", async () => {
    const user = userEvent.setup();
    const first = entryView("entry-1", "Lunch");
    const second = {
      ...entryView("entry-2", "Lunch"),
      accountName: "Card",
      entry: {
        ...entryView("entry-2", "Lunch").entry,
        date: "2026-07-31",
      },
    };
    render(
      <LedgerPanel
        controller={controller({ ...loadedState, entries: [first, second] })}
      />,
    );

    const firstPurge = screen.getByRole("button", {
      name: "Purge Lunch, 2026-07-30, Cash (entry-1)",
    });
    expect(firstPurge).toHaveTextContent("Purge Lunch");
    expect(screen.getByRole("button", {
      name: "Purge Lunch, 2026-07-31, Card (entry-2)",
    })).toBeInTheDocument();
    expect(screen.getByRole("button", {
      name: "Edit Lunch, 2026-07-30, Cash (entry-1)",
    })).toBeInTheDocument();
    expect(screen.getByRole("button", {
      name: "Archive Lunch, 2026-07-31, Card (entry-2)",
    })).toBeInTheDocument();

    await user.click(firstPurge);
    expect(screen.getByRole("dialog", {
      name: "Permanently purge Lunch, 2026-07-30, Cash (entry-1)?",
    })).toBeInTheDocument();
  });

  it("submits the selected Reports date range", async () => {
    const user = userEvent.setup();
    const ledger = controller();
    render(<LedgerPanel leafTabId="reports" controller={ledger} />);

    await user.type(screen.getByLabelText("From"), "2026-07-01");
    await user.type(screen.getByLabelText("To"), "2026-07-31");
    await user.click(screen.getByRole("button", { name: "Run reports" }));

    expect(ledger.runReports).toHaveBeenCalledWith({
      from: "2026-07-01",
      to: "2026-07-31",
    });
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
    expect(screen.getByText("12.34 USD")).toBeInTheDocument();

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

    rerender(
      <LedgerPanel
        leafTabId="reports"
        controller={controller({
          ...loadedState,
          reportStatus: "loaded",
          summary: {
            range: { start: "2026-07-01", end: "2026-07-31" },
            currencies: [{
              currencyId: "currency-usd",
              currencyCode: "USD",
              incomeMinor: 1234,
              expenseMinor: 200,
              netChangeMinor: 1034,
              entryCount: 2,
            }],
          },
          briefing: {
            summary: {
              range: { start: "2026-07-01", end: "2026-07-31" },
              currencies: [{
                currencyId: "currency-usd",
                currencyCode: "USD",
                incomeMinor: 1234,
                expenseMinor: 200,
                netChangeMinor: 1034,
                entryCount: 2,
              }],
            },
            markdown: "Raw briefing: income 1234, expense 200, net 1034",
          },
        })}
      />,
    );
    expect(screen.getAllByText("12.34 USD")).toHaveLength(2);
    expect(screen.getAllByText("2.00 USD")).toHaveLength(2);
    expect(screen.getAllByText("10.34 USD")).toHaveLength(2);
    const briefing = screen.getByRole("region", { name: "Briefing" });
    expect(briefing).toHaveTextContent("2026-07-01 to 2026-07-31");
    expect(briefing).not.toHaveTextContent("Raw briefing");
    expect(briefing).not.toHaveTextContent(/\b1234\b/);
  });

  it("renders an empty structured Briefing without exposing raw markdown", () => {
    render(
      <LedgerPanel
        leafTabId="reports"
        controller={controller({
          ...loadedState,
          reportStatus: "loaded",
          summary: {
            range: { start: "2026-07-01", end: "2026-07-31" },
            currencies: [],
          },
          briefing: {
            summary: {
              range: { start: "2026-07-01", end: "2026-07-31" },
              currencies: [],
            },
            markdown: "Raw 1234",
          },
        })}
      />,
    );

    const briefing = screen.getByRole("region", { name: "Briefing" });
    expect(briefing).toHaveTextContent("No briefing data for this range.");
    expect(briefing).not.toHaveTextContent("Raw 1234");
  });

  it("reports purge preview failures and re-enables only the active transaction action", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    let rejectPreview: (reason: Error) => void = () => undefined;
    const preview = new Promise<never>((_, reject) => {
      rejectPreview = reject;
    });
    const ledger = controller({
      ...loadedState,
      entries: [{
        accountName: "Cash",
        categoryName: "Food",
        currencyCode: "KRW",
        entry: {
          id: "entry-1",
          date: "2026-07-30",
          writtenAt: "2026-07-30T00:00:00Z",
          content: "Lunch",
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
      }],
    });
    ledger.previewPurge = vi.fn(() => preview);
    render(<LedgerPanel controller={ledger} />);

    const purge = screen.getByRole("button", { name: /Purge Lunch/ });
    const archive = screen.getByRole("button", { name: /Archive Lunch/ });
    await user.click(purge);
    const confirmPurge = screen.getByRole("button", {
      name: "Purge permanently",
    });
    await user.click(confirmPurge);
    expect(purge).toBeDisabled();
    expect(archive).not.toBeDisabled();
    expect(confirmPurge).toHaveFocus();
    expect(confirmPurge).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("dialog", {
      name: /Permanently purge Lunch/,
    })).toBeInTheDocument();
    rejectPreview(new Error("Preview expired"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Preview expired");
    expect(purge).not.toBeDisabled();
    await waitFor(() => expect(purge).toHaveFocus());

    ledger.archive = vi.fn().mockRejectedValue(new Error("Archive conflict"));
    await user.click(archive);
    expect(await screen.findByRole("alert")).toHaveTextContent("Archive conflict");
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

  it.each(["success", "error"] as const)(
    "ignores an older refresh %s after a newer refresh completes",
    async (olderCompletion) => {
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
      let olderRequest!: Promise<void>;
      let newerRequest!: Promise<void>;
      act(() => {
        olderRequest = result.current.refresh();
        newerRequest = result.current.refresh();
      });
      await act(async () => {
        newer.resolve({ items: [entryView("newer", "Newer")], nextOffset: null });
        await newerRequest;
      });
      expect(result.current.state.entries[0]?.entry.content).toBe("Newer");

      await act(async () => {
        if (olderCompletion === "success") {
          older.resolve({ items: [entryView("older", "Older")], nextOffset: null });
        } else {
          older.reject(new Error("Stale refresh failed"));
        }
        await olderRequest;
      });

      expect(result.current.state.status).toBe("loaded");
      expect(result.current.state.error).toBeNull();
      expect(result.current.state.entries[0]?.entry.content).toBe("Newer");
    },
  );

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
