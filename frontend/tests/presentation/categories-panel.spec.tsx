import "@testing-library/jest-dom/vitest";

import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LedgerController, LedgerState } from "@/features/ledger/hooks/useLedgerController";
import { deriveCategoryGroups } from "@/features/ledger/model/category-table";
import {
  createLedgerTableViews,
  defaultLedgerTableSettings,
} from "@/features/ledger/model/ledger-table-views";
import { CategoryCreateDialog } from "@/features/ledger/ui/CategoryCreateDialog";
import { CategoriesPanel } from "@/features/ledger/ui/CategoriesPanel";
import { CategoriesTable } from "@/features/ledger/ui/CategoriesTable";
import { RavenApiError, RavenTransportError } from "@/lib/raven-api";

const state: LedgerState = {
  status: "loaded",
  error: null,
  entries: [],
  currencies: [],
  accountCategories: [],
  accounts: [],
  categories: [{
    id: "category-food",
    name: "Food",
    parentId: null,
    kind: "expense",
    active: true,
  }, {
    id: "category-salary",
    name: "Salary",
    parentId: null,
    kind: "income",
    active: true,
  }, {
    id: "category-old",
    name: "Old category",
    parentId: null,
    kind: "expense",
    active: false,
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
    createAccount: vi.fn(),
    updateAccount: vi.fn(),
    archiveAccount: vi.fn(),
    restoreAccount: vi.fn(),
    previewAccountPurge: vi.fn(),
    purgeAccount: vi.fn(),
    createCategory: vi.fn().mockResolvedValue(undefined),
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

function CategoryCreateHarness({ ledger }: { ledger: LedgerController }) {
  const [open, setOpen] = React.useState(false);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  return (
    <main data-testid="category-background">
      <button ref={triggerRef} type="button" onClick={() => setOpen(true)}>Add category</button>
      {open ? (
        <CategoryCreateDialog
          controller={ledger}
          onClose={() => setOpen(false)}
          returnFocusRef={triggerRef}
        />
      ) : null}
    </main>
  );
}

async function fillDraft(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Category name"), "Dining");
  await user.selectOptions(screen.getByLabelText("Parent category"), "category-food");
}

describe("CategoryCreateDialog", () => {
  afterEach(() => vi.restoreAllMocks());

  it("opens with ordered fields, active same-type parents, and isolated background", async () => {
    const user = userEvent.setup();
    render(<CategoryCreateHarness ledger={controller()} />);

    await user.click(screen.getByRole("button", { name: "Add category" }));
    const dialog = screen.getByRole("dialog", { name: "Add category" });
    const parent = screen.getByLabelText("Parent category");

    expect(screen.getByLabelText("Category name")).toHaveFocus();
    expect(Array.from(dialog.querySelectorAll("input, select"))).toEqual([
      screen.getByLabelText("Category name"),
      screen.getByLabelText("Category type"),
      parent,
    ]);
    expect(within(parent).getByRole("option", { name: "Food" })).toBeInTheDocument();
    expect(within(parent).queryByRole("option", { name: "Salary" })).toBeNull();
    expect(within(parent).queryByRole("option", { name: "Old category" })).toBeNull();
    expect(screen.getByTestId("category-background").parentElement).toHaveAttribute("inert");
    expect(document.body.style.overflow).toBe("hidden");
  });

  it("clears the selected parent when type changes and offers only the new type", async () => {
    const user = userEvent.setup();
    render(<CategoryCreateHarness ledger={controller()} />);

    await user.click(screen.getByRole("button", { name: "Add category" }));
    await user.selectOptions(screen.getByLabelText("Parent category"), "category-food");
    await user.selectOptions(screen.getByLabelText("Category type"), "income");

    expect(screen.getByLabelText("Parent category")).toHaveValue("");
    expect(within(screen.getByLabelText("Parent category")).getByRole("option", { name: "Salary" }))
      .toBeInTheDocument();
    expect(within(screen.getByLabelText("Parent category")).queryByRole("option", { name: "Food" }))
      .toBeNull();
  });

  it("submits the category payload and restores trigger focus after success", async () => {
    const user = userEvent.setup();
    const ledger = controller();
    render(<CategoryCreateHarness ledger={ledger} />);

    const trigger = screen.getByRole("button", { name: "Add category" });
    await user.click(trigger);
    await fillDraft(user);
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(ledger.createCategory).toHaveBeenCalledWith({
      name: "Dining",
      kind: "expense",
      parent: "category-food",
    }));
    expect(screen.queryByRole("dialog", { name: "Add category" })).toBeNull();
    expect(trigger).toHaveFocus();
    expect(document.body.style.overflow).toBe("");
  });

  it.each([
    [new RavenApiError("invalid", "Category name is already used.", {}, "00000000-0000-0000-0000-000000000000", 409), "Category name is already used."],
    [new RavenTransportError("network"), "Raven API is unreachable."],
    [new Error("secret storage detail"), "Could not create category."],
  ])("keeps the draft and exposes only a safe error after failure", async (cause, message) => {
    const user = userEvent.setup();
    const ledger = controller();
    ledger.createCategory = vi.fn().mockRejectedValue(cause);
    render(<CategoryCreateHarness ledger={ledger} />);

    await user.click(screen.getByRole("button", { name: "Add category" }));
    await fillDraft(user);
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.getByLabelText("Category name")).toHaveValue("Dining");
    expect(screen.getByLabelText("Category type")).toHaveValue("expense");
    expect(screen.getByLabelText("Parent category")).toHaveValue("category-food");
  });

  it("blocks duplicate submit and close paths while creation is pending", async () => {
    const user = userEvent.setup();
    const request = deferred<void>();
    const ledger = controller();
    ledger.createCategory = vi.fn(() => request.promise);
    render(<CategoryCreateHarness ledger={ledger} />);

    await user.click(screen.getByRole("button", { name: "Add category" }));
    await fillDraft(user);
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(screen.getByRole("dialog", { name: "Add category" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByLabelText("Category name")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Close Add category" })).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "Add category" })).toBeInTheDocument();
    expect(ledger.createCategory).toHaveBeenCalledOnce();

    await act(async () => request.resolve(undefined));
  });

  it("traps Tab and restores focus when idle Escape closes the dialog", async () => {
    const user = userEvent.setup();
    render(<CategoryCreateHarness ledger={controller()} />);

    const trigger = screen.getByRole("button", { name: "Add category" });
    await user.click(trigger);
    const name = screen.getByLabelText("Category name");
    const close = screen.getByRole("button", { name: "Close Add category" });
    const add = screen.getByRole("button", { name: "Add" });

    close.focus();
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(add).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();
    await user.tab();
    expect(name).toHaveFocus();
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: "Add category" })).toBeNull();
    expect(trigger).toHaveFocus();
  });
});

function categoriesController(nextState: LedgerState = state): LedgerController {
  const ledger = controller();
  const views = createLedgerTableViews();
  ledger.state = nextState;
  ledger.tableTabs = (scope) => views[scope];
  ledger.tableSettings = (scope) => views[scope].draftSettings;
  return ledger;
}

const categoryGroups = deriveCategoryGroups(
  state.categories,
  defaultLedgerTableSettings("ledger.categories"),
);

describe("CategoriesTable", () => {
  it("renders compact columns and activates rows without activating checkboxes", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const onToggle = vi.fn();
    render(
      <CategoriesTable
        groups={categoryGroups}
        activeRowCount={2}
        selectedIds={[]}
        onOpen={onOpen}
        onToggle={onToggle}
        onToggleAll={vi.fn()}
      />,
    );

    expect(screen.getAllByRole("columnheader").map(({ textContent }) => textContent))
      .toEqual(["", "Category", "Type", "Parent category"]);
    const foodRow = screen.getByRole("button", {
      name: "Open details for Food, Expense, No parent",
    });
    await user.click(foodRow);
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "category-food" }));

    onOpen.mockClear();
    foodRow.focus();
    await user.keyboard(" ");
    expect(onOpen).toHaveBeenCalledOnce();

    onOpen.mockClear();
    await user.click(screen.getByRole("checkbox", {
      name: "Select Food, Expense, No parent",
    }));
    expect(onToggle).toHaveBeenCalledWith("category-food");
    expect(onOpen).not.toHaveBeenCalled();
    expect(screen.queryByText("Old category")).toBeNull();
  });

  it.each([
    [0, "No categories yet."],
    [1, "No categories match this view."],
  ])("shows the correct empty state for %i active categories", (activeRowCount, message) => {
    render(
      <CategoriesTable
        groups={[{ key: "all", label: null, rows: [] }]}
        activeRowCount={activeRowCount}
        selectedIds={[]}
        onOpen={vi.fn()}
        onToggle={vi.fn()}
        onToggleAll={vi.fn()}
      />,
    );

    expect(screen.getByText(message)).toBeInTheDocument();
  });

  it("renders group headings and an indeterminate visible selection", () => {
    render(
      <CategoriesTable
        groups={[{
          key: "expense",
          label: "Expense",
          rows: categoryGroups[0]!.rows.filter(({ kind }) => kind === "expense"),
        }, {
          key: "income",
          label: "Income",
          rows: categoryGroups[0]!.rows.filter(({ kind }) => kind === "income"),
        }]}
        activeRowCount={2}
        selectedIds={["category-food"]}
        onOpen={vi.fn()}
        onToggle={vi.fn()}
        onToggleAll={vi.fn()}
      />,
    );

    expect(screen.getByRole("rowgroup", { name: "Expense group" })).toBeInTheDocument();
    expect(screen.getByRole("rowgroup", { name: "Income group" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Select all visible categories" }))
      .toHaveProperty("indeterminate", true);
  });
});

describe("CategoriesPanel", () => {
  it("uses the shared header and opens the production create dialog", async () => {
    const user = userEvent.setup();
    render(<CategoriesPanel controller={categoriesController()} />);

    const tabs = screen.getByRole("tablist", { name: "Categories views" });
    expect(tabs.parentElement).toHaveClass("workspace-table-header-row", "ledger-table-header-row");
    const trigger = screen.getByRole("button", { name: "Add category" });
    expect(screen.getByRole("button", { name: "Delete selected" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /Archive|Restore|Purge/ })).toBeNull();

    const filter = screen.getByRole("button", { name: "Filter Categories" });
    await user.click(filter);
    await user.click(screen.getByRole("button", { name: "Add filter rule" }));
    expect(screen.getByRole("option", { name: "Type" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Parent category" })).toBeInTheDocument();
    await user.keyboard("{Escape}");

    await user.click(trigger);
    expect(screen.getByRole("dialog", { name: "Add category" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(trigger).toHaveFocus();
  });

  it("deactivates selected visible categories sequentially and retains failed selections", async () => {
    const user = userEvent.setup();
    const nextState: LedgerState = {
      ...state,
      categories: [...state.categories, {
        id: "category-dining",
        name: "Dining",
        parentId: "category-food",
        kind: "expense",
        active: true,
      }],
    };
    const ledger = categoriesController(nextState);
    ledger.archiveCategory = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("storage path should not be shown"));
    render(<CategoriesPanel controller={ledger} />);

    await user.click(screen.getByRole("checkbox", { name: "Select all visible categories" }));
    await user.click(screen.getByRole("button", { name: "Delete selected" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(ledger.archiveCategory).toHaveBeenNthCalledWith(1, "category-dining"));
    expect(ledger.archiveCategory).toHaveBeenNthCalledWith(2, "category-food");
    expect(ledger.archiveCategory).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("alert")).toHaveTextContent("Could not delete selected categories.");
    expect(screen.queryByText("storage path should not be shown")).toBeNull();
    expect(screen.getByRole("checkbox", { name: "Select Dining, Expense, Food", hidden: true }))
      .not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Select Food, Expense, No parent", hidden: true }))
      .toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Select Salary, Income, No parent", hidden: true }))
      .toBeChecked();
  });

  it("prunes selected IDs when refreshed state removes the category", async () => {
    const user = userEvent.setup();
    const ledger = categoriesController();
    const { rerender } = render(<CategoriesPanel controller={ledger} />);

    await user.click(screen.getByRole("checkbox", { name: "Select Food, Expense, No parent" }));
    expect(screen.getByRole("button", { name: "Delete selected" })).toBeEnabled();

    rerender(<CategoriesPanel controller={categoriesController({ ...state, categories: [] })} />);
    expect(screen.getByText("No categories yet.")).toBeInTheDocument();
    rerender(<CategoriesPanel controller={categoriesController()} />);

    expect(screen.getByRole("button", { name: "Delete selected" })).toBeDisabled();
  });
});
