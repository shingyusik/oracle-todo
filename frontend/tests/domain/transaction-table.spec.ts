import { describe, expect, it, vi } from "vitest";

import type { LedgerEntryType, LedgerEntryView } from "@/features/ledger/model/ledger-model";
import { defaultLedgerTableSettings } from "@/features/ledger/model/ledger-table-views";
import {
  deriveTransactionGroups,
  projectTransactionRows,
  transactionToday,
} from "@/features/ledger/model/transaction-table";
import type { PlannerTableSettings } from "@/features/workbench/model/planner-model";

const baseEntry = {
  date: "2026-08-01",
  writtenAt: "2026-08-01T01:00:00Z",
  content: "Entry",
  transactionCategoryId: "category-1",
  accountId: "account-1",
  entryType: "expense" as LedgerEntryType,
  amountMinor: 1000,
  currencyId: "currency-1",
  transferGroupId: null,
  source: "api",
  notes: null,
  createdAt: "2026-08-01T01:00:00Z",
  updatedAt: "2026-08-01T01:00:00Z",
  deletedAt: null,
};

type EntryOverrides = Partial<
  Omit<typeof baseEntry, "transactionCategoryId" | "transferGroupId" | "deletedAt">
> & {
  transactionCategoryId?: string | null;
  transferGroupId?: string | null;
  deletedAt?: string | null;
  accountName?: string | null;
  categoryName?: string | null;
  currencyCode?: string | null;
};

function entryView(
  id: string,
  entryType: LedgerEntryType,
  overrides: EntryOverrides = {},
): LedgerEntryView {
  const { accountName = "Cash", categoryName = "Food", currencyCode = "KRW", ...entry } = overrides;
  return {
    entry: { ...baseEntry, ...entry, id, entryType },
    accountName,
    categoryName,
    currencyCode,
  };
}

describe("projectTransactionRows", () => {
  it("projects active entries and complete transfers into logical rows", () => {
    const entries = [
      entryView("transfer-in-1", "transfer_in", {
        accountId: "account-2",
        content: "Move to bank",
        transactionCategoryId: null,
        categoryName: null,
        transferGroupId: "transfer-group-1",
        accountName: "Bank",
      }),
      entryView("archived-expense-1", "expense", { deletedAt: "2026-08-02T01:00:00Z" }),
      entryView("income-1", "income", {
        content: "Salary",
        transactionCategoryId: "income-category-1",
        categoryName: "Salary",
      }),
      entryView("transfer-out-1", "transfer_out", {
        content: "Move to bank",
        transactionCategoryId: null,
        categoryName: null,
        transferGroupId: "transfer-group-1",
        accountName: "Cash",
      }),
      entryView("expense-1", "expense", { content: "Lunch" }),
      entryView("unmatched-transfer-in-1", "transfer_in", {
        transactionCategoryId: null,
        categoryName: null,
        transferGroupId: "unmatched-group",
      }),
    ];

    const rows = projectTransactionRows(entries);

    expect(rows.map(({ id }) => id).sort()).toEqual([
      "expense-1",
      "income-1",
      "transfer-group-1",
    ]);
    expect(rows.find(({ id }) => id === "transfer-group-1")).toMatchObject({
      kind: "transfer",
      accountLabel: "Cash → Bank",
      categoryLabel: "",
      archiveEntryId: "transfer-out-1",
    });
    expect(rows.map(({ id }) => id)).not.toContain("archived-expense-1");
    expect(rows.map(({ id }) => id)).not.toContain("unmatched-transfer-in-1");
  });

  it("keeps adjustments visible and omits malformed transfer groups", () => {
    const adjustment = entryView("adjustment-1", "adjustment_out");
    const incomeAdjustment = entryView("adjustment-in-1", "adjustment_in");
    const malformed = entryView("malformed-out", "transfer_out", {
      transferGroupId: "malformed-group",
    });
    const mismatched = entryView("mismatched-in", "transfer_in", {
      accountId: "account-2",
      transferGroupId: "malformed-group",
      amountMinor: 2_000,
    });

    expect(projectTransactionRows([mismatched, incomeAdjustment, adjustment, malformed])).toEqual([
      expect.objectContaining({ id: "adjustment-in-1", kind: "income" }),
      expect.objectContaining({ id: "adjustment-1", kind: "expense" }),
    ]);
  });

  function validPair(): LedgerEntryView[] {
    return [
      entryView("regression-out", "transfer_out", {
        content: "Regression transfer",
        transactionCategoryId: null,
        categoryName: null,
        transferGroupId: "regression-group",
        accountName: "Cash",
      }),
      entryView("regression-in", "transfer_in", {
        content: "Regression transfer",
        transactionCategoryId: null,
        categoryName: null,
        transferGroupId: "regression-group",
        accountId: "account-2",
        accountName: "Bank",
      }),
    ];
  }

  const malformedPairs: { name: string; entries: () => LedgerEntryView[] }[] = [
    {
      name: "currency mismatches",
      entries: () => {
        const [out, incoming] = validPair();
        return [out, { ...incoming, entry: { ...incoming.entry, currencyId: "currency-2" } }];
      },
    },
    {
      name: "uses the same account",
      entries: () => {
        const [out, incoming] = validPair();
        return [out, { ...incoming, entry: { ...incoming.entry, accountId: out.entry.accountId } }];
      },
    },
    {
      name: "uses duplicate entry identities",
      entries: () => {
        const [out, incoming] = validPair();
        return [out, { ...incoming, entry: { ...incoming.entry, id: out.entry.id } }];
      },
    },
    {
      name: "has duplicate transfer sides",
      entries: () => {
        const [out, incoming] = validPair();
        return [out, incoming, { ...incoming, entry: { ...incoming.entry, id: "duplicate-in" } }];
      },
    },
    {
      name: "has a non-null category",
      entries: () => {
        const [out, incoming] = validPair();
        return [out, { ...incoming, entry: { ...incoming.entry, transactionCategoryId: "category-1" } }];
      },
    },
    {
      name: "has mismatched shared metadata",
      entries: () => {
        const [out, incoming] = validPair();
        return [out, { ...incoming, entry: { ...incoming.entry, content: "Different content" } }];
      },
    },
  ];

  for (const { name, entries } of malformedPairs) {
    it(`omits transfer pair when it ${name}`, () => {
      expect(projectTransactionRows(entries()).some(({ kind }) => kind === "transfer")).toBe(false);
    });
  }
});

function transactionEntries(): LedgerEntryView[] {
  return [
    entryView("archived", "expense", { date: "2026-01-06", deletedAt: "2026-01-07T00:00:00Z" }),
    entryView("food", "expense", {
      date: "2026-01-02", content: "Lunch", amountMinor: 200, updatedAt: "2026-01-03T00:00:00Z",
    }),
    entryView("transfer-in", "transfer_in", {
      date: "2025-12-31", content: "Move", amountMinor: 300, accountId: "account-2",
      accountName: "Bank", categoryName: null, transactionCategoryId: null, transferGroupId: "move",
    }),
    entryView("salary", "income", {
      date: "2026-01-05", content: "Alpha", amountMinor: 1_000, accountId: "account-2",
      accountName: "Bank", categoryName: "Salary", transactionCategoryId: "category-2",
      updatedAt: "2026-01-02T00:00:00Z",
    }),
    entryView("coffee", "expense", {
      date: "2026-01-01", content: "Bean", amountMinor: 200, accountId: "account-3",
      accountName: "Card", categoryName: "Groceries", transactionCategoryId: "category-3",
      updatedAt: "2026-01-04T00:00:00Z",
    }),
    entryView("transfer-out", "transfer_out", {
      date: "2025-12-31", content: "Move", amountMinor: 300, accountId: "account-1",
      accountName: "Cash", categoryName: null, transactionCategoryId: null, transferGroupId: "move",
    }),
  ];
}

function transactionSettings(
  patch: Omit<Partial<PlannerTableSettings>, "groupSettings"> & {
    groupSettings?: Partial<PlannerTableSettings["groupSettings"]>;
  } = {},
): PlannerTableSettings {
  const defaults = defaultLedgerTableSettings("ledger.transactions");
  const { groupSettings, ...settings } = patch;
  return {
    ...defaults,
    ...settings,
    groupSettings: {
      ...defaults.groupSettings,
      ...groupSettings,
    },
  };
}

function groupIds(settings?: PlannerTableSettings): string[][] {
  return deriveTransactionGroups(transactionEntries(), settings ?? transactionSettings(), "2026-01-04")
    .map((group) => group.rows.map((row) => row.id));
}

describe("deriveTransactionGroups", () => {
  it("projects active logical rows into one ungrouped date-descending result", () => {
    const groups = deriveTransactionGroups(transactionEntries(), transactionSettings(), "2026-01-04");

    expect(groups.map((group) => group.key)).toEqual(["all"]);
    expect(groups[0]?.label).toBeNull();
    expect(groups[0]?.rows.map((row) => row.id)).toEqual(["salary", "food", "coffee", "move"]);
    expect(groups[0]?.rows.map((row) => row.id)).not.toContain("archived");
  });

  it("applies Ledger filter fields with effective rules and AND/OR semantics", () => {
    const rule = (id: string, field: "date" | "entry_type" | "account" | "category" | "amount" | "content", type: "date" | "select" | "relation" | "number" | "text", operator: "is" | "contains", value: string | string[]) => ({ id, field, type, operator, value } as const);
    const each = [
      [rule("date", "date", "date", "is", "2026-01-02"), ["food"]],
      [rule("type", "entry_type", "select", "is", ["income"]), ["salary"]],
      [rule("account", "account", "relation", "contains", ["Bank"]), ["salary", "move"]],
      [rule("category", "category", "relation", "is", ["Food"]), ["food"]],
      [rule("amount", "amount", "number", "is", "200"), ["food", "coffee"]],
      [rule("content", "content", "text", "contains", "bean"), ["coffee"]],
    ] as const;

    for (const [filterRule, expected] of each) {
      expect(groupIds(transactionSettings({ filterRules: [filterRule] }))[0]).toEqual(expected);
    }
    expect(groupIds(transactionSettings({
      filterRules: [each[0][0], each[5][0]], filterMode: "or",
    }))[0]).toEqual(["food", "coffee"]);
    expect(groupIds(transactionSettings({
      filterRules: [each[0][0], each[5][0]], filterMode: "and",
    }))[0]).toEqual([]);
    expect(groupIds(transactionSettings({
      filterRules: [rule("empty", "content", "text", "contains", "")],
    }))[0]).toEqual(["salary", "food", "coffee", "move"]);
  });

  it("uses the local calendar date for default relative-date filtering", () => {
    expect(transactionToday({
      getFullYear: () => 2026,
      getMonth: () => 0,
      getDate: () => 2,
    })).toBe("2026-01-02");
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 2, 0, 30));
    const groups = deriveTransactionGroups(transactionEntries(), transactionSettings({
      filterRules: [{
        id: "today", field: "date", type: "date", operator: "is_relative_to_today",
        value: { amount: "0", unit: "day" },
      }],
    }));
    vi.useRealTimers();

    expect(groups[0]?.rows.map((row) => row.id)).toEqual(["food"]);
  });

  it("sorts each supported field stably and breaks final ties by row id", () => {
    const expected: Record<string, string[]> = {
      date: ["move", "coffee", "food", "salary"],
      content: ["salary", "coffee", "food", "move"],
      account: ["salary", "coffee", "food", "move"],
      category: ["move", "food", "coffee", "salary"],
      amount: ["coffee", "food", "move", "salary"],
      updated: ["salary", "food", "coffee", "move"],
    };
    for (const [field, ids] of Object.entries(expected)) {
      expect(groupIds(transactionSettings({
        sortRules: [{ id: field, field: field as "date", direction: "asc" }],
      }))[0]).toEqual(ids);
    }
    expect(groupIds(transactionSettings({
      sortRules: [
        { id: "amount", field: "amount", direction: "asc" },
        { id: "content", field: "content", direction: "desc" },
      ],
    }))[0]).toEqual(["food", "coffee", "move", "salary"]);
  });

  it.each([
    ["month", ["2026-01", "2025-12"], ["January 2026", "December 2025"], [["salary", "food", "coffee"], ["move"]]],
    ["week", ["2026-01-05", "2025-12-29"], ["Week of 2026-01-05", "Week of 2025-12-29"], [["salary"], ["food", "coffee", "move"]]],
    ["day", ["2026-01-05", "2026-01-02", "2026-01-01", "2025-12-31"], ["2026-01-05", "2026-01-02", "2026-01-01", "2025-12-31"], [["salary"], ["food"], ["coffee"], ["move"]]],
    ["account", ["account-2", "account-1", "account-3"], ["Bank", "Cash", "Card"], [["salary"], ["food", "move"], ["coffee"]]],
    ["category", ["category-2", "category-1", "category-3", "uncategorized"], ["Salary", "Food", "Groceries", "Uncategorized"], [["salary"], ["food"], ["coffee"], ["move"]]],
    ["entry_type", ["income", "expense", "transfer"], ["income", "expense", "transfer"], [["salary"], ["food", "coffee"], ["move"]]],
  ] as const)("groups sorted rows by %s", (groupBy, keys, labels, rows) => {
    const groups = deriveTransactionGroups(transactionEntries(), transactionSettings({
      groupSettings: { groupBy },
    }), "2026-01-04");

    expect(groups.map((group) => group.key)).toEqual(keys);
    expect(groups.map((group) => group.label)).toEqual(labels);
    expect(groups.map((group) => group.rows.map((row) => row.id))).toEqual(rows);
  });

  it.each([
    [
      { hideEmpty: false },
      ["category-2", "category-1", "category-3", "uncategorized"],
      [["salary"], ["food"], ["coffee"], ["move"]],
    ],
    [
      { hiddenGroupKeys: ["category-1"] },
      ["category-2", "category-3", "uncategorized"],
      [["salary"], ["coffee"], ["move"]],
    ],
    [
      { sort: "alphabetical" as const },
      ["category-1", "category-3", "category-2", "uncategorized"],
      [["food"], ["coffee"], ["salary"], ["move"]],
    ],
    [
      { sort: "reverse_alphabetical" as const },
      ["uncategorized", "category-2", "category-3", "category-1"],
      [["move"], ["salary"], ["coffee"], ["food"]],
    ],
    [
      { manualOrder: ["uncategorized", "category-1"] },
      ["uncategorized", "category-1", "category-2", "category-3"],
      [["move"], ["food"], ["salary"], ["coffee"]],
    ],
  ])("honors category group settings", (groupSettings, keys, rows) => {
    const groups = deriveTransactionGroups(transactionEntries(), transactionSettings({
      groupSettings: { groupBy: "category", ...groupSettings },
    }), "2026-01-04");

    expect(groups.map((group) => group.key)).toEqual(keys);
    expect(groups.map((group) => group.rows.map((row) => row.id))).toEqual(rows);
  });
});
