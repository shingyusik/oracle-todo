import "@testing-library/jest-dom/vitest";

import { act, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LedgerController, LedgerState } from "@/features/ledger/hooks/useLedgerController";
import { AccountCreateDialog } from "@/features/ledger/ui/AccountCreateDialog";
import { AccountsPanel } from "@/features/ledger/ui/AccountsPanel";
import { AccountsTable } from "@/features/ledger/ui/AccountsTable";
import { deriveAccountGroups, type AccountRow, type AccountRowGroup } from "@/features/ledger/model/account-table";
import type { LedgerTableOccurrence } from "@/features/ledger/model/ledger-model";
import { createLedgerTableViews } from "@/features/ledger/model/ledger-table-views";
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
    createAccount: vi.fn().mockResolvedValue(undefined),
    updateAccount: vi.fn(),
    archiveAccount: vi.fn(),
    restoreAccount: vi.fn(),
    createCategory: vi.fn(),
    updateCategory: vi.fn(),
    archiveCategory: vi.fn(),
    restoreCategory: vi.fn(),
    createCurrency: vi.fn(),
    updateCurrency: vi.fn(),
    deactivateCurrency: vi.fn(),
    createAccountCategory: vi.fn(),
    updateAccountCategory: vi.fn(),
    deactivateAccountCategory: vi.fn(),
    previewAccountCategoryPurge: vi.fn(),
    purgeAccountCategory: vi.fn(),
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

function AccountEditDialog({ controller: ledger, row, onClose }: {
  controller: LedgerController;
  row: AccountRow;
  onClose(): void;
}) {
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  return <AccountCreateDialog controller={ledger} record={row} onClose={onClose} returnFocusRef={triggerRef} />;
}

async function fillDraft(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Account name"), "Wallet");
  await user.selectOptions(screen.getByLabelText("Account type"), "account-type-cash");
  await user.selectOptions(screen.getByLabelText("Currency"), "currency-krw");
  await user.clear(screen.getByLabelText("Opening balance"));
  await user.type(screen.getByLabelText("Opening balance"), "12");
}

describe("AccountCreateDialog", () => {
  it("protects unsaved account input from Escape and Close", async () => {
    const user = userEvent.setup();
    render(<AccountCreateHarness ledger={controller()} />);
    await user.click(screen.getByRole("button", { name: "Add account" }));
    await user.type(screen.getByLabelText("Account name"), "Keep this draft");
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Close Add account" }));
    await user.keyboard("{Escape}");
    expect(screen.getByLabelText("Account name")).toHaveValue("Keep this draft");
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Discard" }));
    expect(screen.queryByRole("dialog", { name: "Add account" })).toBeNull();
  });

  afterEach(() => vi.restoreAllMocks());

  it("opens with the name focused, ordered fields, and active-only choices", async () => {
    const user = userEvent.setup();
    render(<AccountCreateHarness ledger={controller()} />);

    await user.click(screen.getByRole("button", { name: "Add account" }));
    const dialog = screen.getByRole("dialog", { name: "Add account" });
    const header = within(dialog).getByRole("heading", { name: "Add account" }).closest("header")!;
    const close = within(dialog).getByRole("button", { name: "Close Add account" });
    const save = within(dialog).getByRole("button", { name: "Save" });
    const actions = close.parentElement!;

    expect(within(header).queryByRole("button")).toBeNull();
    expect(actions).toHaveClass("ledger-create-dialog-actions");
    expect(within(actions).getByRole("button", { name: "Save" })).toBe(save);
    expect(save).toHaveClass("ledger-create-dialog-save");
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
    await user.click(screen.getByRole("button", { name: "Save" }));

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
    await user.click(screen.getByRole("button", { name: "Save" }));

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
    const save = screen.getByRole("button", { name: "Save" });
    await user.click(save);

    expect(screen.getByRole("dialog", { name: "Add account" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByLabelText("Account name")).toBeDisabled();
    expect(save).toBeDisabled();
    expect(save).toHaveAccessibleName("Saving…");
    expect(save).toHaveTextContent("Saving…");
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
    const openingBalance = screen.getByLabelText("Opening balance");
    const close = screen.getByRole("button", { name: "Close Add account" });
    const create = screen.getByRole("button", { name: "Save" });
    expect(name).toHaveFocus();

    openingBalance.focus();
    await user.tab();
    expect(close).toHaveFocus();
    await user.tab();
    expect(create).toHaveFocus();
    await user.tab();
    expect(name).toHaveFocus();
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(create).toHaveFocus();
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
  ledger.tablePage = (scope) => ({
    items: scope === "ledger.accounts" ? accountOccurrences(ledger) : [],
    nextOffset: null,
    moreStatus: "idle",
    moreError: null,
    generation: 1,
  });
  ledger.ensureTable = vi.fn().mockResolvedValue(undefined);
  ledger.ensureReferenceData = vi.fn().mockResolvedValue(true);
  ledger.hasReferenceData = (scope) => scope === "ledger.accounts";
  return ledger;
}

function accountOccurrences(ledger: LedgerController): LedgerTableOccurrence[] {
  return deriveAccountGroups(
    ledger.state.accounts,
    ledger.state.balances,
    ledger.state.accountCategories,
    ledger.tableSettings("ledger.accounts"),
  ).flatMap(({ key, label, rows }) => rows.map((record) => ({
    scope: "ledger.accounts" as const,
    key: `${key}:${record.id}`,
    groupKey: key,
    groupLabel: label,
    record,
  })));
}

function inactiveReferenceController(): LedgerController {
  const nextState = accountsState();
  nextState.accountCategories = [
    ...nextState.accountCategories.map((item) => item.id === "account-type-cash" ? { ...item, active: false } : item),
    { id: "account-type-bank", name: "Bank", parentId: null, liability: false, active: true },
  ];
  nextState.currencies = nextState.currencies.map((item) => item.id === "currency-usd" ? { ...item, active: false } : item);
  return accountsController(nextState);
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
  it("opens an edit popup from a row click and handles Escape with a discard confirmation", async () => {
    const user = userEvent.setup();
    render(<AccountsPanel controller={accountsController()} />);

    const row = screen.getByRole("button", { name: "Open details for Wallet, Cash" });
    await user.click(row);
    const dialog = await screen.findByRole("dialog", { name: "Edit account" });
    expect(within(dialog).queryByRole("button", { name: "< Back" })).toBeNull();
    expect(screen.queryByRole("dialog", { name: "Discard unsaved changes?" })).toBeNull();

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit account" })).toBeNull());
    expect(row).toHaveFocus();

    await user.click(row);
    await user.type(await screen.findByLabelText("Account name"), " draft");
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "Discard unsaved changes?" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByLabelText("Account name")).toHaveValue("Wallet draft");
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit account" })).toBeNull());
  });

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
    expect(await screen.findByText("No accounts yet.")).toBeInTheDocument();
    rerender(<AccountsPanel controller={accountsController()} />);

    expect(screen.getByRole("button", { name: "Delete selected" })).toBeDisabled();
  });
});

describe("AccountCreateDialog in edit mode", () => {
  it("prefills the Add form from the account, saves a partial payload, and closes", async () => {
    const user = userEvent.setup();
    const ledger = accountsController();
    const row = accountRows[0]!.rows[0]!;
    const onClose = vi.fn();
    render(
      <React.StrictMode>
        <AccountEditDialog controller={ledger} row={row} onClose={onClose} />
      </React.StrictMode>,
    );

    expect(screen.getByRole("dialog", { name: "Edit account" })).toBeInTheDocument();
    expect(await screen.findByLabelText("Account name")).toHaveValue("Wallet");
    expect(screen.getByLabelText("Opening balance")).toHaveValue("0.00");
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();

    await user.clear(screen.getByLabelText("Account name"));
    await user.type(screen.getByLabelText("Account name"), "Everyday wallet");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(ledger.updateAccount).toHaveBeenCalledWith("account-wallet", {
      name: "Everyday wallet",
    }));
    expect(ledger.createAccount).not.toHaveBeenCalled();
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it("saves a name-only edit without unavailable current references", async () => {
    const user = userEvent.setup();
    const ledger = inactiveReferenceController();
    render(<AccountEditDialog controller={ledger} row={accountRows[0]!.rows[0]!} onClose={vi.fn()} />);

    await user.clear(await screen.findByLabelText("Account name"));
    await user.type(screen.getByLabelText("Account name"), "Cash wallet");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(ledger.updateAccount).toHaveBeenCalledWith("account-wallet", { name: "Cash wallet" }));
  });

  it("saves an opening balance-only edit without unavailable current references", async () => {
    const user = userEvent.setup();
    const ledger = inactiveReferenceController();
    render(<AccountEditDialog controller={ledger} row={accountRows[0]!.rows[0]!} onClose={vi.fn()} />);

    await user.clear(await screen.findByLabelText("Opening balance"));
    await user.type(screen.getByLabelText("Opening balance"), "12.34");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(ledger.updateAccount).toHaveBeenCalledWith("account-wallet", { openingBalance: "12.34" }));
  });

  it("saves a category-only edit without unavailable current references", async () => {
    const user = userEvent.setup();
    const ledger = inactiveReferenceController();
    render(<AccountEditDialog controller={ledger} row={accountRows[0]!.rows[0]!} onClose={vi.fn()} />);

    await user.selectOptions(await screen.findByLabelText("Account type"), "account-type-bank");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(ledger.updateAccount).toHaveBeenCalledWith("account-wallet", { category: "account-type-bank" }));
  });

  it("saves a currency edit with the current opening balance", async () => {
    const user = userEvent.setup();
    const currencyLedger = inactiveReferenceController();
    render(<AccountEditDialog controller={currencyLedger} row={accountRows[0]!.rows[0]!} onClose={vi.fn()} />);
    await user.selectOptions(await screen.findByLabelText("Currency"), "currency-krw");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(currencyLedger.updateAccount).toHaveBeenCalledWith("account-wallet", {
      currency: "currency-krw",
      openingBalance: "0.00",
    }));
  });

  it("closes an unchanged account without calling update", async () => {
    const user = userEvent.setup();
    const ledger = accountsController();
    const onClose = vi.fn();
    render(<AccountEditDialog controller={ledger} row={accountRows[0]!.rows[0]!} onClose={onClose} />);

    await user.click(await screen.findByRole("button", { name: "Save" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(ledger.updateAccount).not.toHaveBeenCalled();
  });

  it("returns directly for a clean Close action", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<AccountEditDialog controller={accountsController()} row={accountRows[0]!.rows[0]!} onClose={onClose} />);

    await user.click(await screen.findByRole("button", { name: "Close Edit account" }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog", { name: "Discard unsaved changes?" })).toBeNull();
  });

  it("disables duplicate Save paths while a save is pending", async () => {
    const user = userEvent.setup();
    const request = deferred<void>();
    const ledger = accountsController();
    ledger.updateAccount = vi.fn(() => request.promise);
    render(<AccountEditDialog controller={ledger} row={accountRows[0]!.rows[0]!} onClose={vi.fn()} />);

    await user.clear(await screen.findByLabelText("Account name"));
    await user.type(screen.getByLabelText("Account name"), "Pending wallet");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByLabelText("Account name")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(ledger.updateAccount).toHaveBeenCalledOnce();

    await act(async () => request.resolve(undefined));
  });

  it.each([
    [new RavenApiError("conflict", "Currency cannot change after entries exist.", {}, "00000000-0000-0000-0000-000000000000", 409), "Currency cannot change after entries exist."],
    [new Error("sqlite path must stay private"), "Could not save account."],
  ])("keeps the draft and reveals only a safe error when save fails", async (cause, message) => {
    const user = userEvent.setup();
    const ledger = accountsController();
    ledger.updateAccount = vi.fn().mockRejectedValue(cause);
    const onClose = vi.fn();
    render(<AccountEditDialog controller={ledger} row={accountRows[0]!.rows[0]!} onClose={onClose} />);

    await user.clear(await screen.findByLabelText("Account name"));
    await user.type(screen.getByLabelText("Account name"), "Draft stays");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.getByLabelText("Account name")).toHaveValue("Draft stays");
    expect(screen.queryByText("sqlite path must stay private")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("confirms a dirty Close and keeps the draft when discard is cancelled", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<AccountEditDialog controller={accountsController()} row={accountRows[0]!.rows[0]!} onClose={onClose} />);

    await user.clear(await screen.findByLabelText("Account name"));
    await user.type(screen.getByLabelText("Account name"), "Unsaved wallet");
    await user.click(screen.getByRole("button", { name: "Close Edit account" }));
    expect(screen.getByRole("dialog", { name: "Discard unsaved changes?" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Account name")).toHaveValue("Unsaved wallet");
  });

  it("uses disabled fallback options for inactive references", async () => {
    const stale = accountsState();
    stale.accountCategories = stale.accountCategories.map((item) => ({ ...item, active: false }));
    stale.currencies = stale.currencies.map((item) => ({ ...item, active: false }));
    render(<AccountEditDialog controller={accountsController(stale)} row={accountRows[0]!.rows[0]!} onClose={vi.fn()} />);

    expect(within(await screen.findByLabelText("Account type")).getByRole("option", { name: "Cash" })).toBeDisabled();
    expect(within(screen.getByLabelText("Currency")).getByRole("option", { name: /USD/ })).toBeDisabled();
  });

  it("keeps the dialog and focus on the dialog while reference data is loading, so Escape still closes it", async () => {
    const user = userEvent.setup();
    const references = deferred<boolean>();
    const ledger = accountsController();
    ledger.ensureAccountFormReferences = vi.fn(() => references.promise);
    const onClose = vi.fn();
    render(<AccountEditDialog controller={ledger} row={accountRows[0]!.rows[0]!} onClose={onClose} />);

    const dialog = await screen.findByRole("dialog", { name: "Edit account" });
    await waitFor(() => expect(dialog).toHaveFocus());
    await act(async () => references.resolve(true));
    expect(dialog.contains(document.activeElement)).toBe(true);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("protects a disappearing edit draft when the refreshed account is gone", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<AccountsPanel controller={accountsController()} />);

    await user.click(screen.getByRole("button", { name: "Open details for Wallet, Cash" }));
    await user.type(await screen.findByLabelText("Account name"), " draft");
    rerender(<AccountsPanel controller={accountsController({ ...accountsState(), accounts: [], balances: [] })} />);
    expect(screen.getByLabelText("Account name")).toHaveValue("Wallet draft");
  });

  it("closes a clean edit popup when the refreshed account is gone", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<AccountsPanel controller={accountsController()} />);

    await user.click(screen.getByRole("button", { name: "Open details for Wallet, Cash" }));
    await screen.findByLabelText("Account name");
    rerender(<AccountsPanel controller={accountsController({ ...accountsState(), accounts: [], balances: [] })} />);
    expect(screen.getByText("No accounts yet.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Edit account" })).toBeNull();
  });

  it("preserves the opening balance draft verbatim when currency changes", async () => {
    const user = userEvent.setup();
    const ledger = accountsController();
    render(<AccountEditDialog controller={ledger} row={accountRows[0]!.rows[0]!} onClose={vi.fn()} />);

    await user.clear(await screen.findByLabelText("Opening balance"));
    await user.type(screen.getByLabelText("Opening balance"), "1.");
    await user.selectOptions(screen.getByLabelText("Currency"), "currency-krw");
    expect(screen.getByLabelText("Opening balance")).toHaveValue("1.");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(ledger.updateAccount).toHaveBeenCalledWith("account-wallet", {
      currency: "currency-krw",
      openingBalance: "1.",
    }));
  });

  it("returns focus to the clicked row after clean close, discard, and successful save", async () => {
    const user = userEvent.setup();
    const ledger = accountsController();
    render(<AccountsPanel controller={ledger} />);

    const walletRow = () => screen.getByRole("button", { name: "Open details for Wallet, Cash" });
    await user.click(walletRow());
    await user.click(await screen.findByRole("button", { name: "Close Edit account" }));
    await waitFor(() => expect(walletRow()).toHaveFocus());

    await user.click(walletRow());
    await user.type(await screen.findByLabelText("Account name"), " draft");
    await user.click(screen.getByRole("button", { name: "Close Edit account" }));
    await user.click(screen.getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(walletRow()).toHaveFocus());

    await user.click(walletRow());
    await user.type(await screen.findByLabelText("Account name"), " saved");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit account" })).toBeNull());
    await waitFor(() => expect(walletRow()).toHaveFocus());
    expect(ledger.updateAccount).toHaveBeenCalledWith("account-wallet", { name: "Wallet saved" });
  });

  it("opens the edit popup from Enter and Space on a focused row", async () => {
    const user = userEvent.setup();
    render(<AccountsPanel controller={accountsController()} />);
    const row = screen.getByRole("button", { name: "Open details for Wallet, Cash" });
    row.focus();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("dialog", { name: "Edit account" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(row).toHaveFocus());
    await user.keyboard(" ");
    expect(await screen.findByRole("dialog", { name: "Edit account" })).toBeInTheDocument();
  });
});
