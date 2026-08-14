import { describe, expect, it } from "vitest";

import type { LedgerEntryType, LedgerEntryView } from "@/features/ledger/model/ledger-model";
import { projectTransactionRows } from "@/features/ledger/model/transaction-table";

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
