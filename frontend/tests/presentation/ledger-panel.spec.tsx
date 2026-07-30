import "@testing-library/jest-dom/vitest";

import { render, screen, within } from "@testing-library/react";
import React from "react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type {
  LedgerController,
  LedgerState,
} from "@/features/ledger/hooks/useLedgerController";
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

describe("LedgerPanel", () => {
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

    await user.click(screen.getByRole("button", { name: "Archive Lunch" }));
    expect(ledger.archive).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Archive Lunch" }));
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
    await user.click(screen.getByRole("button", { name: "Restore Lunch" }));
    expect(ledger.restore).toHaveBeenCalledWith("entry-1");

    await user.click(screen.getByRole("button", { name: "Purge Lunch" }));
    expect(ledger.previewPurge).toHaveBeenCalledWith("entry-1");
    expect(ledger.purge).toHaveBeenCalledWith("entry-1", "confirm-entry");
    expect(confirm).toHaveBeenCalledTimes(4);
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
});
