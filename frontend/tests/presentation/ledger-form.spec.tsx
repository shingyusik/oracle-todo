import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import React from "react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { LedgerController } from "@/features/ledger/hooks/useLedgerController";
import { TransactionForm } from "@/features/ledger/ui/TransactionForm";

function controller(
  overrides: Partial<LedgerController> = {},
): LedgerController {
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
});
