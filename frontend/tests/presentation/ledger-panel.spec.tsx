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
  return {
    state,
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

describe("LedgerPanel", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses Transactions as the default leaf and has no Overview", () => {
    render(<LedgerPanel controller={controller()} />);

    expect(screen.getByRole("heading", { name: "Transactions" })).toBeInTheDocument();
    expect(screen.queryByText("Overview")).not.toBeInTheDocument();
    expect(screen.getByText("No transactions yet.")).toBeInTheDocument();
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

    rerender(<LedgerPanel leafTabId="categories" controller={ledger} />);
    expect(screen.getByRole("heading", { name: "Categories" })).toBeInTheDocument();
    expect(within(screen.getByRole("table")).getByText("Food")).toBeInTheDocument();
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
});
