import "@testing-library/jest-dom/vitest";

import { act, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LedgerController, LedgerState } from "@/features/ledger/hooks/useLedgerController";
import { AccountCreateDialog } from "@/features/ledger/ui/AccountCreateDialog";
import { AccountsPanel } from "@/features/ledger/ui/AccountsPanel";
import { AccountsTable } from "@/features/ledger/ui/AccountsTable";
import type { AccountRowGroup } from "@/features/ledger/model/account-table";
import {
  createLedgerTableViews,
} from "@/features/ledger/model/ledger-table-views";
import { RavenApiError, RavenTransportError } from "@/lib/raven-api";

const state: LedgerState = {
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
    id: "currency-old",
    code: "OLD",
    name: "Old currency",
    symbol: "O",
    decimalPlaces: 2,
    active: false,
  }],
  accountCategories: [{
    id: "account-type-cash",
    name: "Cash",
    parentId: null,
    liability: false,
    active: true,
  }, {
    id: "account-type-old",
    name: "Old type",
    parentId: null,
    liability: false,
    active: false,
  }],
  accounts: [],
  categories: [],
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

function controller(): LedgerController {
  return {
    state,
    tableViewSaveError: null,
    retryTableViewSave: vi.fn(),
    tableViewConfirmation: null,
    tableTabs: vi.fn() as LedgerController["tableTabs"],
    tableSettings: vi.fn() as LedgerController["tableSettings"],
    tableIsDirty: vi.fn(() => false),
    updateTableSettings: vi.fn(),
    selectTableTab: vi.fn(),
    saveTableTab: vi.fn(),
    createTableTab: vi.fn(() => true),
    renameTableTab: vi.fn(() => true),
    requestDeleteTableTab: vi.fn(),
    confirmTableViewAction: vi.fn(),
    cancelTableViewAction: vi.fn(),
    refresh: vi.fn().mockResolvedValue(true),
    createEntry: vi.fn(),
    updateEntry: vi.fn(),
    transfer: vi.fn(),
    updateTransfer: vi.fn(),
    archive: vi.fn(),
    restore: vi.fn(),
    previewPurge: vi.fn(),
    purge: vi.fn(),
    createAccount: vi.fn().mockResolvedValue(undefined),
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
    runReports: vi.fn(),
    retryReports: vi.fn(),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function AccountCreateHarness({ ledger }: { ledger: LedgerController }) {
  const [open, setOpen] = React.useState(false);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={triggerRef} type="button" onClick={() => setOpen(true)}>Add account</button>
      {open ? (
        <AccountCreateDialog
          controller={ledger}
          onClose={() => setOpen(false)}
          returnFocusRef={triggerRef}
        />
      ) : null}
    </>
  );
}

async function fillDraft(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Account name"), "Wallet");
  await user.selectOptions(screen.getByLabelText("Account type"), "account-type-cash");
  await user.selectOptions(screen.getByLabelText("Currency"), "currency-krw");
  await user.clear(screen.getByLabelText("Opening balance"));
  await user.type(screen.getByLabelText("Opening balance"), "12");
}

describe("AccountCreateDialog", () => {
  afterEach(() => vi.restoreAllMocks());

  it("opens with the name focused, ordered fields, and active-only choices", async () => {
    const user = userEvent.setup();
    render(<AccountCreateHarness ledger={controller()} />);

    await user.click(screen.getByRole("button", { name: "Add account" }));
    const dialog = screen.getByRole("dialog", { name: "Add account" });

    expect(screen.getByLabelText("Account name")).toHaveFocus();
    expect(Array.from(dialog.querySelectorAll("input, select"))).toEqual([
      screen.getByLabelText("Account name"),
      screen.getByLabelText("Account type"),
      screen.getByLabelText("Currency"),
      screen.getByLabelText("Opening balance"),
    ]);
    expect(within(screen.getByLabelText("Account type")).queryByRole("option", { name: "Old type" }))
      .toBeNull();
    expect(within(screen.getByLabelText("Currency")).queryByRole("option", { name: /OLD/ }))
      .toBeNull();
  });

  it("submits the existing AccountInput and restores Add account focus after success", async () => {
    const user = userEvent.setup();
    const ledger = controller();
    render(
      <React.StrictMode>
        <AccountCreateHarness ledger={ledger} />
      </React.StrictMode>,
    );

    const trigger = screen.getByRole("button", { name: "Add account" });
    await user.click(trigger);
    await fillDraft(user);
    await user.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => expect(ledger.createAccount).toHaveBeenCalledWith({
      name: "Wallet",
      category: "account-type-cash",
      currency: "currency-krw",
      openingBalance: "12",
    }));
    expect(screen.queryByRole("dialog", { name: "Add account" })).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it.each([
    [new RavenApiError("invalid", "Account name is already used.", {}, "00000000-0000-0000-0000-000000000000", 409), "Account name is already used."],
    [new RavenTransportError("network"), "Raven API is unreachable."],
    [new Error("secret storage detail"), "Could not create account."],
  ])("keeps the draft and shows only a safe error after create fails", async (cause, message) => {
    const user = userEvent.setup();
    const ledger = controller();
    ledger.createAccount = vi.fn().mockRejectedValue(cause);
    render(<AccountCreateHarness ledger={ledger} />);

    await user.click(screen.getByRole("button", { name: "Add account" }));
    await fillDraft(user);
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.getByLabelText("Account name")).toHaveValue("Wallet");
    expect(screen.getByLabelText("Account type")).toHaveValue("account-type-cash");
    expect(screen.getByLabelText("Currency")).toHaveValue("currency-krw");
    expect(screen.getByLabelText("Opening balance")).toHaveValue("12");
  });

  it("disables controls and prevents duplicate close paths while create is pending", async () => {
    const user = userEvent.setup();
    const request = deferred<void>();
    const ledger = controller();
    ledger.createAccount = vi.fn(() => request.promise);
    render(<AccountCreateHarness ledger={ledger} />);

    await user.click(screen.getByRole("button", { name: "Add account" }));
    await fillDraft(user);
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(screen.getByRole("dialog", { name: "Add account" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByLabelText("Account name")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Create account" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Close Add account" })).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "Add account" })).toBeInTheDocument();
    expect(ledger.createAccount).toHaveBeenCalledOnce();

    await act(async () => request.resolve(undefined));
  });

  it("traps Tab and restores focus when idle Escape closes the dialog", async () => {
    const user = userEvent.setup();
    render(<AccountCreateHarness ledger={controller()} />);

    const trigger = screen.getByRole("button", { name: "Add account" });
    await user.click(trigger);
    const name = screen.getByLabelText("Account name");
    const close = screen.getByRole("button", { name: "Close Add account" });
    const create = screen.getByRole("button", { name: "Create account" });
    expect(name).toHaveFocus();

    close.focus();
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(create).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();
    await user.tab();
    expect(name).toHaveFocus();
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: "Add account" })).toBeNull();
    expect(trigger).toHaveFocus();
    expect(close).not.toBeInTheDocument();
  });
});

const accountRows: AccountRowGroup[] = [{
  key: "account-type-cash",
  label: "Cash",
  rows: [{
    id: "account-wallet",
    account: {
      id: "account-wallet",
      name: "Wallet",
      categoryId: "account-type-cash",
      currencyId: "currency-usd",
      openingBalanceMinor: 0,
      active: true,
    },
    name: "Wallet",
    accountTypeId: "account-type-cash",
    accountTypeLabel: "Cash",
    currencyId: "currency-usd",
    currencyCode: "USD",
    decimalPlaces: 2,
    currentBalanceMinor: 123456,
  }, {
    id: "account-card",
    account: {
      id: "account-card",
      name: "Card",
      categoryId: "account-type-cash",
      currencyId: "currency-krw",
      openingBalanceMinor: 0,
      active: true,
    },
    name: "Card",
    accountTypeId: "account-type-cash",
    accountTypeLabel: "Cash",
    currencyId: "currency-krw",
    currencyCode: "KRW",
    decimalPlaces: 0,
    currentBalanceMinor: 5000,
  }],
}];

function accountsState(): LedgerState {
  return {
    ...state,
    currencies: [...state.currencies, {
      id: "currency-usd",
      code: "USD",
      name: "US dollar",
      symbol: "$",
      decimalPlaces: 2,
      active: true,
    }],
    accounts: accountRows.flatMap((group) => group.rows.map(({ account }) => account)),
    balances: accountRows.flatMap((group) => group.rows.map((row) => ({
      account: row.account,
      currencyCode: row.currencyCode,
      decimalPlaces: row.decimalPlaces,
      currentBalanceMinor: row.currentBalanceMinor,
    }))),
  };
}

function accountsController(nextState = accountsState()): LedgerController {
  const ledger = controller();
  const views = createLedgerTableViews();
  ledger.state = nextState;
  ledger.tableTabs = (scope) => views[scope];
  ledger.tableSettings = (scope) => views[scope].draftSettings;
  ledger.tableIsDirty = vi.fn(() => false);
  return ledger;
}

describe("AccountsTable", () => {
  it("renders the compact balance columns and activates rows without activating checkboxes", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const onToggle = vi.fn();
    render(
      <AccountsTable
        groups={accountRows}
        activeRowCount={2}
        selectedIds={[]}
        onOpen={onOpen}
        onToggle={onToggle}
        onToggleAll={vi.fn()}
      />,
    );

    expect(screen.getAllByRole("columnheader").map(({ textContent }) => textContent)).toEqual([
      "",
      "Account",
      "Account type",
      "Current balance",
    ]);
    expect(screen.getByText("1234.56 USD")).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Opening balance" })).toBeNull();

    const row = screen.getByRole("button", { name: "Open details for Wallet, Cash" });
    await user.click(row);
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    await user.click(screen.getByRole("checkbox", { name: "Select Wallet, Cash" }));

    expect(onOpen).toHaveBeenCalledTimes(3);
    expect(onToggle).toHaveBeenCalledWith("account-wallet");
  });

  it("limits select-all to visible rows and exposes indeterminate selection", () => {
    const onToggleAll = vi.fn();
    render(
      <AccountsTable
        groups={accountRows}
        activeRowCount={2}
        selectedIds={["account-wallet"]}
        onOpen={vi.fn()}
        onToggle={vi.fn()}
        onToggleAll={onToggleAll}
      />,
    );

    const selectAll = screen.getByRole<HTMLInputElement>("checkbox", { name: "Select all visible accounts" });
    expect(selectAll).not.toBeChecked();
    expect(selectAll.indeterminate).toBe(true);
    selectAll.click();
    expect(onToggleAll).toHaveBeenCalledOnce();
  });

  it.each([
    [[], 0, "No accounts yet."],
    [[], 1, "No accounts match this view."],
  ])("shows the correct empty message", (groups, activeRowCount, message) => {
    render(
      <AccountsTable
        groups={groups}
        activeRowCount={activeRowCount}
        selectedIds={[]}
        onOpen={vi.fn()}
        onToggle={vi.fn()}
        onToggleAll={vi.fn()}
      />,
    );

    expect(screen.getByText(message)).toBeInTheDocument();
  });
});

describe("AccountsPanel", () => {
  it("opens the production create dialog and restores Add account focus", async () => {
    const user = userEvent.setup();
    render(<AccountsPanel controller={accountsController()} />);

    const trigger = screen.getByRole("button", { name: "Add account" });
    await user.click(trigger);
    expect(screen.getByRole("dialog", { name: "Add account" })).toBeInTheDocument();
    expect(screen.getByLabelText("Account name")).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Add account" })).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("uses Ledger account view settings and keeps settings, add, and selected delete in the header", () => {
    const ledger = accountsController();
    render(<AccountsPanel controller={ledger} />);

    expect(screen.getByRole("button", { name: "Account settings" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add account" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete selected" })).toBeDisabled();
    expect(screen.getByRole("tab", { name: "Table" })).toBeInTheDocument();
  });

  it("deactivates selected visible accounts sequentially and retains the failed selection safely", async () => {
    const user = userEvent.setup();
    const savings = {
      ...accountRows[0]!.rows[0]!,
      id: "account-savings",
      account: {
        ...accountRows[0]!.rows[0]!.account,
        id: "account-savings",
        name: "Savings",
      },
      name: "Savings",
    };
    const nextState = accountsState();
    nextState.accounts = [...nextState.accounts, savings.account];
    nextState.balances = [...nextState.balances, {
      account: savings.account,
      currencyCode: savings.currencyCode,
      decimalPlaces: savings.decimalPlaces,
      currentBalanceMinor: savings.currentBalanceMinor,
    }];
    const ledger = accountsController(nextState);
    ledger.archiveAccount = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("storage path should not be shown"));
    render(<AccountsPanel controller={ledger} />);

    await user.click(screen.getByRole("checkbox", { name: "Select all visible accounts" }));
    await user.click(screen.getByRole("button", { name: "Delete selected" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(ledger.archiveAccount).toHaveBeenNthCalledWith(1, "account-card"));
    expect(ledger.archiveAccount).toHaveBeenNthCalledWith(2, "account-savings");
    expect(ledger.archiveAccount).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("alert")).toHaveTextContent("Could not delete selected accounts.");
    expect(screen.queryByText("storage path should not be shown")).toBeNull();
    expect(screen.getByRole("checkbox", { name: "Select Card, Cash", hidden: true })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Select Savings, Cash", hidden: true })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Select Wallet, Cash", hidden: true })).toBeChecked();
  });

  it("prunes selected IDs when a refreshed state no longer contains the account", async () => {
    const user = userEvent.setup();
    const ledger = accountsController();
    const { rerender } = render(<AccountsPanel controller={ledger} />);

    await user.click(screen.getByRole("checkbox", { name: "Select Wallet, Cash" }));
    expect(screen.getByRole("button", { name: "Delete selected" })).toBeEnabled();

    rerender(<AccountsPanel controller={accountsController({ ...accountsState(), accounts: [], balances: [] })} />);
    expect(screen.getByText("No accounts yet.")).toBeInTheDocument();
    rerender(<AccountsPanel controller={accountsController()} />);

    expect(screen.getByRole("button", { name: "Delete selected" })).toBeDisabled();
  });
});
