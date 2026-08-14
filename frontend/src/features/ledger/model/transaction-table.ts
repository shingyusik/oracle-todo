import type { LedgerEntryView } from "@/features/ledger/model/ledger-model";

export type TransactionRow = {
  id: string;
  archiveEntryId: string;
  detailEntry: LedgerEntryView;
  kind: "expense" | "income" | "transfer";
  date: string;
  content: string;
  accountIds: string[];
  accountLabel: string;
  categoryId: string | null;
  categoryLabel: string;
  amountMinor: number;
  currencyId: string;
  currencyCode: string;
  updatedAt: string;
};

export function projectTransactionRows(entries: LedgerEntryView[]): TransactionRow[] {
  const rows: TransactionRow[] = [];
  const transfers = new Map<string, {
    entries: LedgerEntryView[];
    out: LedgerEntryView[];
    in: LedgerEntryView[];
  }>();

  for (const detailEntry of entries) {
    const { entry } = detailEntry;
    if (entry.deletedAt !== null) continue;

    if (entry.transferGroupId !== null) {
      const group = transfers.get(entry.transferGroupId) ?? { entries: [], out: [], in: [] };
      group.entries.push(detailEntry);
      if (entry.entryType === "transfer_out") group.out.push(detailEntry);
      if (entry.entryType === "transfer_in") group.in.push(detailEntry);
      transfers.set(entry.transferGroupId, group);
      continue;
    }

    if (entry.entryType === "transfer_out" || entry.entryType === "transfer_in") continue;

    rows.push(projectEntry(detailEntry));
  }

  for (const [transferGroupId, group] of transfers) {
    if (group.out.length !== 1 || group.in.length !== 1) continue;
    const out = group.out[0];
    const incoming = group.in[0];
    if (group.entries.length !== 2 || !validTransferPair(transferGroupId, out, incoming)) continue;

    rows.push({
      id: transferGroupId,
      archiveEntryId: out.entry.id,
      detailEntry: out,
      kind: "transfer",
      date: out.entry.date,
      content: out.entry.content,
      accountIds: [out.entry.accountId, incoming.entry.accountId],
      accountLabel: `${out.accountName ?? ""} → ${incoming.accountName ?? ""}`,
      categoryId: null,
      categoryLabel: "",
      amountMinor: out.entry.amountMinor,
      currencyId: out.entry.currencyId,
      currencyCode: out.currencyCode ?? "",
      updatedAt: out.entry.updatedAt,
    });
  }

  return rows;
}

function validTransferPair(
  transferGroupId: string,
  out: LedgerEntryView,
  incoming: LedgerEntryView,
): boolean {
  const outEntry = out.entry;
  const inEntry = incoming.entry;
  return outEntry.transferGroupId === transferGroupId
    && inEntry.transferGroupId === transferGroupId
    && outEntry.id !== inEntry.id
    && outEntry.accountId !== inEntry.accountId
    && outEntry.amountMinor === inEntry.amountMinor
    && outEntry.currencyId === inEntry.currencyId
    && outEntry.date === inEntry.date
    && outEntry.writtenAt === inEntry.writtenAt
    && outEntry.content === inEntry.content
    && outEntry.source === inEntry.source
    && outEntry.notes === inEntry.notes
    && outEntry.transactionCategoryId === null
    && inEntry.transactionCategoryId === null
    && outEntry.createdAt === inEntry.createdAt
    && outEntry.updatedAt === inEntry.updatedAt
    && outEntry.deletedAt === inEntry.deletedAt;
}

function projectEntry(detailEntry: LedgerEntryView): TransactionRow {
  const { entry } = detailEntry;
  return {
    id: entry.id,
    archiveEntryId: entry.id,
    detailEntry,
    kind: entry.entryType === "income" || entry.entryType === "adjustment_in"
      ? "income"
      : "expense",
    date: entry.date,
    content: entry.content,
    accountIds: [entry.accountId],
    accountLabel: detailEntry.accountName ?? "",
    categoryId: entry.transactionCategoryId,
    categoryLabel: detailEntry.categoryName ?? "",
    amountMinor: entry.amountMinor,
    currencyId: entry.currencyId,
    currencyCode: detailEntry.currencyCode ?? "",
    updatedAt: entry.updatedAt,
  };
}
