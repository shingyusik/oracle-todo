import "@testing-library/jest-dom/vitest";

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  LedgerMutationRefreshError,
  type LedgerController,
} from "@/features/ledger/hooks/useLedgerController";
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
          currencyId: "currency-usd",
          openingBalanceMinor: 0,
          active: true,
        },
        {
          id: "account-savings",
          name: "Savings",
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
      reportSelection: { period: "current_month" },
      comparison: null,
      trend: null,
      summary: null,
      accountBreakdown: [],
      categoryBreakdown: [],
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
    updateTransfer: vi.fn(),
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
    retryReports: vi.fn(),
    ...overrides,
  };
}

describe("TransactionForm", () => {
  it("shows the approved expense and income creation fields in order", async () => {
    const user = userEvent.setup();
    render(<TransactionForm controller={controller()} />);

    const tabs = screen.getByRole("tablist", { name: "Transaction type" });
    expect(within(tabs).getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Expense",
      "Income",
      "Transfer",
    ]);
    expect(within(tabs).getByRole("tab", { name: "Expense" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(visibleFieldLabels()).toEqual([
      "Date",
      "Content",
      "Account",
      "Category",
      "Amount",
      "Note",
    ]);
    expect(screen.queryByLabelText("Written at")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Currency")).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Adjustment/ })).not.toBeInTheDocument();

    await user.click(within(tabs).getByRole("tab", { name: "Income" }));

    expect(within(tabs).getByRole("tab", { name: "Income" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(visibleFieldLabels()).toEqual([
      "Date",
      "Content",
      "Account",
      "Category",
      "Amount",
      "Note",
    ]);
  });

  it("shows the approved transfer creation fields in order", async () => {
    const user = userEvent.setup();
    render(<TransactionForm controller={controller()} />);

    await user.click(screen.getByRole("tab", { name: "Transfer" }));

    expect(visibleFieldLabels()).toEqual([
      "Date",
      "Content",
      "Source account",
      "Destination account",
      "Amount",
      "Note",
    ]);
    expect(screen.queryByLabelText("Written at")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Currency")).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Destination account"), "account-bank");
    await user.selectOptions(screen.getByLabelText("Source account"), "account-cash");
    expect(screen.getByLabelText("Destination account")).toHaveValue("");
    expect(within(screen.getByLabelText("Destination account")).queryByRole("option", {
      name: "Cash",
    })).not.toBeInTheDocument();
    expect(within(screen.getByLabelText("Destination account")).queryByRole("option", {
      name: "Bank",
    })).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Destination account"), "account-savings");
    await user.selectOptions(screen.getByLabelText("Source account"), "account-savings");
    expect(screen.getByLabelText("Destination account")).toHaveValue("");
  });

  it("supports roving keyboard navigation and links tabs to the shared panel", async () => {
    const user = userEvent.setup();
    render(<TransactionForm controller={controller()} />);

    const expense = screen.getByRole("tab", { name: "Expense" });
    const income = screen.getByRole("tab", { name: "Income" });
    const transfer = screen.getByRole("tab", { name: "Transfer" });
    const panel = screen.getByRole("tabpanel");

    expect(expense).toHaveAttribute("tabindex", "0");
    expect(income).toHaveAttribute("tabindex", "-1");
    expect(expense).toHaveAttribute("aria-controls", panel.id);
    expect(panel).toHaveAttribute("aria-labelledby", expense.id);

    expense.focus();
    await user.keyboard("{ArrowRight}");
    expect(income).toHaveFocus();
    expect(income).toHaveAttribute("tabindex", "0");
    expect(expense).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{Enter}");
    expect(income).toHaveAttribute("aria-selected", "true");
    expect(panel).toHaveAttribute("aria-labelledby", income.id);

    await user.keyboard("{End}");
    expect(transfer).toHaveFocus();
    await user.keyboard("{Home}");
    expect(expense).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(transfer).toHaveFocus();
  });

  it("defaults creation Date from the browser-local calendar day", () => {
    const previousTimezone = process.env.TZ;
    process.env.TZ = "America/Los_Angeles";
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-08-15T00:30:00.000Z"));
      render(<TransactionForm controller={controller()} />);
      expect(screen.getByLabelText("Date")).toHaveValue("2026-08-14");
    } finally {
      vi.useRealTimers();
      if (previousTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = previousTimezone;
    }
  });

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
    await user.click(screen.getByRole("button", { name: "Save transaction" }));

    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(onPendingChange).toHaveBeenLastCalledWith(true);
    expect(onSaved).not.toHaveBeenCalled();

    await act(async () => resolveSave());
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(onPendingChange.mock.calls).toEqual([[true], [false]]);
  });

  it.each([
    ["Expense", "expense", "account-cash", "currency-krw"],
    ["Income", "income", "account-bank", "currency-usd"],
  ] as const)("submits an %s with account-derived creation metadata", async (
    tab,
    entryType,
    account,
    currency,
  ) => {
    const user = userEvent.setup();
    const ledger = controller();
    render(<TransactionForm controller={ledger} />);

    await user.click(screen.getByRole("tab", { name: tab }));
    await user.type(screen.getByLabelText("Amount"), "12000");
    await user.type(screen.getByLabelText("Content"), "Lunch");
    await user.selectOptions(screen.getByLabelText("Account"), account);
    if (entryType === "expense") {
      await user.selectOptions(screen.getByLabelText("Category"), "category-food");
    }
    await user.click(screen.getByRole("button", { name: "Save transaction" }));

    expect(ledger.createEntry).toHaveBeenCalledWith(expect.objectContaining({
      entryType,
      amount: "12000",
      content: "Lunch",
      account,
      currency,
      writtenAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
    }));
    expect(ledger.transfer).not.toHaveBeenCalled();
  });

  it("clears an expense category when switching to Income", async () => {
    const user = userEvent.setup();
    const ledger = controller();
    render(<TransactionForm controller={ledger} />);

    await user.selectOptions(screen.getByLabelText("Category"), "category-food");
    await user.click(screen.getByRole("tab", { name: "Income" }));
    await user.type(screen.getByLabelText("Amount"), "1000");
    await user.type(screen.getByLabelText("Content"), "Refund");
    await user.selectOptions(screen.getByLabelText("Account"), "account-bank");
    await user.click(screen.getByRole("button", { name: "Save transaction" }));

    expect(ledger.createEntry).toHaveBeenCalledWith(expect.objectContaining({
      entryType: "income",
      category: null,
    }));
  });

  it("generates writtenAt at submission time", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-08-14T00:00:00.000Z"));
      const ledger = controller();
      render(<TransactionForm controller={ledger} />);

      fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "1000" } });
      fireEvent.change(screen.getByLabelText("Content"), { target: { value: "Lunch" } });
      fireEvent.change(screen.getByLabelText("Account"), {
        target: { value: "account-cash" },
      });
      vi.setSystemTime(new Date("2026-08-14T00:05:00.000Z"));
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Save transaction" }));
      });

      expect(ledger.createEntry).toHaveBeenCalledWith(expect.objectContaining({
        writtenAt: "2026-08-14T00:05:00.000Z",
      }));
    } finally {
      vi.useRealTimers();
    }
  });

  it("submits a paired transfer with separate source and destination accounts", async () => {
    const user = userEvent.setup();
    const ledger = controller();
    render(<TransactionForm controller={ledger} />);

    await user.click(screen.getByRole("tab", { name: "Transfer" }));
    await user.type(screen.getByLabelText("Amount"), "45000");
    await user.type(screen.getByLabelText("Content"), "Move savings");
    await user.selectOptions(screen.getByLabelText("Source account"), "account-cash");
    await user.selectOptions(screen.getByLabelText("Destination account"), "account-savings");
    await user.click(screen.getByRole("button", { name: "Save transfer" }));

    expect(ledger.transfer).toHaveBeenCalledWith(expect.objectContaining({
      amount: "45000",
      content: "Move savings",
      fromAccount: "account-cash",
      toAccount: "account-savings",
      currency: "currency-krw",
      writtenAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
    }));
    expect(ledger.createEntry).not.toHaveBeenCalled();
  });

  it("clears a destination that collides with the changed source account", async () => {
    const user = userEvent.setup();
    const ledger = controller();
    render(<TransactionForm controller={ledger} />);

    await user.click(screen.getByRole("tab", { name: "Transfer" }));
    await user.type(screen.getByLabelText("Amount"), "45000");
    await user.type(screen.getByLabelText("Content"), "Move savings");
    await user.selectOptions(screen.getByLabelText("Destination account"), "account-bank");
    await user.selectOptions(screen.getByLabelText("Source account"), "account-bank");
    await user.click(screen.getByRole("button", { name: "Save transfer" }));

    expect(ledger.transfer).not.toHaveBeenCalled();

    await user.selectOptions(screen.getByLabelText("Source account"), "account-cash");
    expect(screen.getByLabelText("Destination account")).toHaveValue("");
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
    await user.click(screen.getByRole("button", { name: "Save transaction" }));

    expect(screen.getByLabelText("Amount")).toHaveValue("bad");
    expect(screen.getByLabelText("Content")).toHaveValue("Lunch");
    expect(screen.getByRole("alert")).toHaveTextContent("Amount is invalid");
  });

  it("keeps edits retryable when an update reports a refresh failure", async () => {
    const user = userEvent.setup();
    const ledger = controller();
    vi.mocked(ledger.updateEntry).mockRejectedValue(new LedgerMutationRefreshError());
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

    expect(visibleFieldLabels()).toEqual([
      "Date",
      "Written at",
      "Type",
      "Account",
      "Category",
      "Amount",
      "Currency",
      "Content",
      "Note",
    ]);
    expect(screen.getByLabelText("Amount")).toHaveValue("12.34");
    await user.click(screen.getByRole("button", { name: "Save transaction" }));
    expect(ledger.updateEntry).toHaveBeenCalledWith(
      "entry-usd",
      expect.objectContaining({ amount: "12.34" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Changes were saved, but Ledger could not refresh.",
    );
    expect(screen.getByRole("button", { name: "Save transaction" })).not.toBeDisabled();
    expect(screen.queryByRole("button", { name: "Retry refresh" })).toBeNull();
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

function visibleFieldLabels() {
  const form = screen.getByRole("form");
  return Array.from(form.querySelectorAll("label")).map((label) =>
    label.childNodes[0]?.textContent?.trim(),
  );
}
