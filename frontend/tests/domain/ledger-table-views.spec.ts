import { describe, expect, it } from "vitest";

import {
  createLedgerTableViews,
  ledgerFilterFieldsForScope,
  ledgerGroupOptionsForScope,
  ledgerSortFieldsForScope,
  ledgerTableScopeIds,
} from "@/features/ledger/model/ledger-table-views";

describe("ledger table views", () => {
  it("defines independent stable scopes and scope-specific controls", () => {
    expect(ledgerTableScopeIds).toEqual([
      "ledger.transactions",
      "ledger.accounts",
      "ledger.categories",
    ]);
    expect(ledgerFilterFieldsForScope("ledger.transactions")).toEqual([
      "date",
      "content",
      "entry_type",
      "account",
      "category",
      "amount",
    ]);
    expect(ledgerSortFieldsForScope("ledger.accounts")).toEqual([
      "name",
      "account_type",
      "currency",
      "current_balance",
    ]);
    expect(ledgerSortFieldsForScope("ledger.transactions")).toEqual([
      "date", "content", "account", "category", "amount", "updated",
    ]);
    expect(ledgerGroupOptionsForScope("ledger.transactions")).toEqual([
      { value: "none", label: "None" },
      { value: "month", label: "Month" },
      { value: "week", label: "Week" },
      { value: "day", label: "Day" },
      { value: "account", label: "Account" },
      { value: "category", label: "Category" },
      { value: "entry_type", label: "Type" },
    ]);
    expect(ledgerGroupOptionsForScope("ledger.categories").map(({ value }) => value))
      .toEqual(["none", "kind", "parent"]);
  });

  it("uses the agreed defaults for each table", () => {
    const views = createLedgerTableViews();

    expect(views["ledger.transactions"].draftSettings).toMatchObject({
      filterMode: "and",
      filterRules: [],
      sortRules: [{
        id: "ledger.transactions-default-sort",
        field: "date",
        direction: "desc",
      }],
      groupSettings: { groupBy: "none" },
    });
    expect(views["ledger.accounts"].draftSettings.sortRules[0]?.field).toBe("name");
    expect(views["ledger.categories"].draftSettings.sortRules[0]?.field).toBe("name");
  });

  it("normalizes each persisted scope locally", () => {
    const views = createLedgerTableViews({
      "ledger.transactions": {
        tabs: [{
          id: "recent",
          name: "Recent",
          settings: {
            filterMode: "or",
            filterRules: [{
              id: "keep",
              field: "content",
              type: "text",
              operator: "contains",
              value: "lunch",
            }, {
              id: "drop",
              field: "name",
              type: "text",
              operator: "contains",
              value: "cash",
            }],
            sortRules: [{ id: "amount", field: "amount", direction: "asc" }],
            groupSettings: { groupBy: "account", sort: "alphabetical" },
          },
        }],
      },
      "ledger.accounts": "broken",
      "ledger.categories": {
        tabs: [{
          id: "income",
          name: "Income",
          settings: {
            filterRules: [{
              id: "kind",
              field: "kind",
              type: "select",
              operator: "is",
              value: ["income"],
            }],
          },
        }],
      },
    });

    expect(views["ledger.transactions"].tabs[0]?.settings).toMatchObject({
      filterMode: "or",
      filterRules: [expect.objectContaining({ id: "keep", field: "content" })],
      sortRules: [expect.objectContaining({ field: "amount" })],
      groupSettings: expect.objectContaining({ groupBy: "account" }),
    });
    expect(views["ledger.accounts"].tabs).toHaveLength(1);
    expect(views["ledger.accounts"].tabs[0]?.id).toBe("ledger.accounts-table");
    expect(views["ledger.categories"].tabs[0]?.id).toBe("income");
    expect(views["ledger.categories"].tabs[0]?.settings.filterRules[0]?.field)
      .toBe("kind");
  });
});
