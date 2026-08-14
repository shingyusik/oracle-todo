import "@testing-library/jest-dom/vitest";

import { act, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { LedgerController } from "@/features/ledger/hooks/useLedgerController";
import { createLedgerTableViews } from "@/features/ledger/model/ledger-table-views";
import { TransactionForm } from "@/features/ledger/ui/TransactionForm";

function controller(
  overrides: Partial<LedgerController> = {},
): LedgerController {
  const views = createLedgerTableViews();
  return {
    state: {
      status: "loaded",
      error: null,
      entries: [],
      currencies: [
        {
          id: "currency-krw",
          code: "KRW",
          name: "Korean won",
          symbol: "₩",
          decimalPlaces: 0,
          active: true,
        },
        {
          id: "currency-usd",
          code: "USD",
          name: "US dollar",
          symbol: "$",
          decimalPlaces: 2,
          active: true,
        },
      ],
      accountCategories: [],
      accounts: [
        {
          id: "account-cash",
          name: "Cash",
          categoryId: "account-category-cash",
          currencyId: "currency-krw",
          openingBalanceMinor: 0,
          active: true,
        },
        {
          id: "account-bank",
          name: "Bank",
          categoryId: "account-category-bank",
          currencyId: "currency-krw",
          openingBalanceMinor: 0,
          active: true,
        },
      ],
      categories: [
        {
          id: "category-food",
          name: "Food",
          parentId: null,
          kind: "expense",
          active: true,
        },
      ],
      balances: [],
      reportStatus: "idle",
      reportError: null,
      summary: null,
      accountBreakdown: [],
      categoryBreakdown: [],
      briefing: null,
    },
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
    previewPurge: vi.fn(),
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
    ...overrides,
  };
}

describe("TransactionForm", () => {
  it("reports pending until the controller mutation and refresh boundary resolves", async () => {
    const user = userEvent.setup();
    let resolveSave!: () => void;
    const save = new Promise<void>((resolve) => {
      resolveSave = resolve;
    });
    const ledger = controller({
      createEntry: vi.fn().mockReturnValue(save),
    });
    const onPendingChange = vi.fn();
    const onSaved = vi.fn();
    render(
      <TransactionForm
        controller={ledger}
        onPendingChange={onPendingChange}
        onSaved={onSaved}
      />,
    );

    await user.type(screen.getByLabelText("Amount"), "12000");
    await user.type(screen.getByLabelText("Content"), "Lunch");
    await user.selectOptions(screen.getByLabelText("Account"), "account-cash");
    await user.selectOptions(screen.getByLabelText("Currency"), "currency-krw");
    await user.click(screen.getByRole("button", { name: "Save transaction" }));

    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(onPendingChange).toHaveBeenLastCalledWith(true);
    expect(onSaved).not.toHaveBeenCalled();

    await act(async () => resolveSave());
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(onPendingChange.mock.calls).toEqual([[true], [false]]);
  });

  it("submits only structured transaction fields", async () => {
    const user = userEvent.setup();
    const ledger = controller();
    render(<TransactionForm controller={ledger} />);

    await user.selectOptions(screen.getByLabelText("Type"), "expense");
    await user.type(screen.getByLabelText("Amount"), "12000");
    await user.type(screen.getByLabelText("Content"), "Lunch");
    await user.selectOptions(screen.getByLabelText("Account"), "account-cash");
    await user.selectOptions(screen.getByLabelText("Category"), "category-food");
    await user.selectOptions(screen.getByLabelText("Currency"), "currency-krw");
    await user.click(screen.getByRole("button", { name: "Save transaction" }));

    expect(ledger.createEntry).toHaveBeenCalledWith(expect.objectContaining({
      entryType: "expense",
      amount: "12000",
      content: "Lunch",
      account: "account-cash",
      category: "category-food",
      currency: "currency-krw",
    }));
  });

  it("submits a paired transfer with separate source and destination accounts", async () => {
    const user = userEvent.setup();
    const ledger = controller();
    render(<TransactionForm controller={ledger} />);

    await user.click(screen.getByRole("button", { name: "Transfer" }));
    await user.type(screen.getByLabelText("Amount"), "45000");
    await user.type(screen.getByLabelText("Content"), "Move savings");
    await user.selectOptions(screen.getByLabelText("From account"), "account-cash");
    await user.selectOptions(screen.getByLabelText("To account"), "account-bank");
    await user.selectOptions(screen.getByLabelText("Currency"), "currency-krw");
    await user.click(screen.getByRole("button", { name: "Save transfer" }));

    expect(ledger.transfer).toHaveBeenCalledWith(expect.objectContaining({
      amount: "45000",
      content: "Move savings",
      fromAccount: "account-cash",
      toAccount: "account-bank",
      currency: "currency-krw",
    }));
  });

  it("keeps entered values and exposes an error when the API rejects submission", async () => {
    const user = userEvent.setup();
    const ledger = controller({
      createEntry: vi.fn().mockRejectedValue(new Error("Amount is invalid")),
    });
    render(<TransactionForm controller={ledger} />);

    await user.type(screen.getByLabelText("Amount"), "bad");
    await user.type(screen.getByLabelText("Content"), "Lunch");
    await user.selectOptions(screen.getByLabelText("Account"), "account-cash");
    await user.selectOptions(screen.getByLabelText("Currency"), "currency-krw");
    await user.click(screen.getByRole("button", { name: "Save transaction" }));

    expect(screen.getByLabelText("Amount")).toHaveValue("bad");
    expect(screen.getByLabelText("Content")).toHaveValue("Lunch");
    expect(screen.getByRole("alert")).toHaveTextContent("Amount is invalid");
  });

  it("edits two-decimal minor units without changing their value", async () => {
    const user = userEvent.setup();
    const ledger = controller();
    render(
      <TransactionForm
        controller={ledger}
        entry={{
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
        }}
      />,
    );

    expect(screen.getByLabelText("Amount")).toHaveValue("12.34");
    await user.click(screen.getByRole("button", { name: "Save transaction" }));
    expect(ledger.updateEntry).toHaveBeenCalledWith(
      "entry-usd",
      expect.objectContaining({ amount: "12.34" }),
    );
  });

  it("round-trips RFC3339 through a non-UTC browser-local datetime", async () => {
    const previousTimezone = process.env.TZ;
    process.env.TZ = "Asia/Seoul";
    try {
      const user = userEvent.setup();
      const ledger = controller();
      render(
        <TransactionForm
          controller={ledger}
          entry={{
            accountName: "Cash",
            categoryName: "Food",
            currencyCode: "KRW",
            entry: {
              id: "entry-time",
              date: "2026-07-30",
              writtenAt: "2026-07-30T00:00:00Z",
              content: "Breakfast",
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
          }}
        />,
      );

      expect(screen.getByLabelText("Written at")).toHaveValue("2026-07-30T09:00");
      await user.click(screen.getByRole("button", { name: "Save transaction" }));
      expect(ledger.updateEntry).toHaveBeenCalledWith(
        "entry-time",
        expect.objectContaining({ writtenAt: "2026-07-30T00:00:00.000Z" }),
      );
    } finally {
      if (previousTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = previousTimezone;
    }
  });
});
