import type { Currency, LedgerEntryView } from "@/features/ledger/model/ledger-model";
import {
  ledgerFilterFieldsForScope,
  ledgerSortFieldsForScope,
} from "@/features/ledger/model/ledger-table-views";
import {
  orderVisiblePlannerGroups,
  type PlannerGroupSettings,
} from "@/features/workbench/model/planner-group-settings";
import {
  effectivePlannerFilterRules,
  localCalendarDate,
  matchesPlannerFilterValue,
  type PlannerFilterField,
  type PlannerFilterRule,
  type PlannerGroupBy,
  type PlannerSortRule,
  type PlannerSortBy,
  type PlannerTableSettings,
} from "@/features/workbench/model/planner-model";

export type TransactionRow = {
  id: string;
  archiveEntryId: string;
  detailEntry: LedgerEntryView;
  transferEntry: LedgerEntryView | null;
  kind: "expense" | "income" | "transfer";
  date: string;
  content: string;
  accountIds: string[];
  accountLabels: string[];
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
      transferEntry: incoming,
      kind: "transfer",
      date: out.entry.date,
      content: out.entry.content,
      accountIds: [out.entry.accountId, incoming.entry.accountId],
      accountLabels: [out.accountName ?? "", incoming.accountName ?? ""],
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
    transferEntry: null,
    kind: entry.entryType === "income" || entry.entryType === "adjustment_in"
      ? "income"
      : "expense",
    date: entry.date,
    content: entry.content,
    accountIds: [entry.accountId],
    accountLabels: [detailEntry.accountName ?? ""],
    accountLabel: detailEntry.accountName ?? "",
    categoryId: entry.transactionCategoryId,
    categoryLabel: detailEntry.categoryName ?? "",
    amountMinor: entry.amountMinor,
    currencyId: entry.currencyId,
    currencyCode: detailEntry.currencyCode ?? "",
    updatedAt: entry.updatedAt,
  };
}

export type TransactionRowGroup = {
  key: string;
  label: string | null;
  rows: TransactionRow[];
};

const monthNames = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function deriveTransactionGroups(
  entries: LedgerEntryView[],
  settings: PlannerTableSettings,
  today = transactionToday(),
  currencies: readonly Currency[] = [],
): TransactionRowGroup[] {
  const decimalPlaces = new Map(currencies.map((currency) => [
    currency.id,
    currency.decimalPlaces,
  ]));
  const rules = effectivePlannerFilterRules(
    settings.filterRules,
    ledgerFilterFieldsForScope("ledger.transactions"),
  );
  const rows = projectTransactionRows(entries)
    .filter((row) => matchesTransactionRules(
      row,
      rules,
      settings.filterMode,
      today,
      decimalPlaces,
    ))
    .sort((left, right) => compareTransactionRows(
      left,
      right,
      settings.sortRules,
      decimalPlaces,
    ));
  return groupTransactionRows(rows, settings.groupSettings);
}

export function transactionToday(
  date: Pick<Date, "getFullYear" | "getMonth" | "getDate"> = new Date(),
): string {
  return localCalendarDate(date);
}

function matchesTransactionRules(
  row: TransactionRow,
  rules: readonly PlannerFilterRule[],
  mode: PlannerTableSettings["filterMode"],
  today: string,
  decimalPlaces: ReadonlyMap<string, number>,
): boolean {
  if (rules.length === 0) return true;
  const matches = rules.map((rule) =>
    matchesPlannerFilterValue(
      transactionFilterValue(row, rule.field, decimalPlaces),
      rule,
      today,
    ),
  );
  return mode === "and" ? matches.every(Boolean) : matches.some(Boolean);
}

function transactionFilterValue(
  row: TransactionRow,
  field: PlannerFilterField,
  decimalPlaces: ReadonlyMap<string, number>,
): string | string[] | number | null {
  if (field === "date") return row.date;
  if (field === "content") return row.content;
  if (field === "entry_type") return row.kind;
  if (field === "account") return uniqueValues([...row.accountIds, ...row.accountLabels]);
  if (field === "category") {
    return row.categoryId ? uniqueValues([row.categoryId, row.categoryLabel]) : [];
  }
  if (field === "currency") return [row.currencyId, row.currencyCode];
  if (field === "amount") return displayedAmount(row, decimalPlaces);
  return null;
}

function compareTransactionRows(
  left: TransactionRow,
  right: TransactionRow,
  rules: readonly PlannerSortRule[],
  decimalPlaces: ReadonlyMap<string, number>,
): number {
  const activeRules = rules.filter((rule) =>
    ledgerSortFieldsForScope("ledger.transactions").includes(rule.field),
  );
  const effectiveRules: readonly PlannerSortRule[] = activeRules.length > 0
    ? activeRules
    : [{ id: "transaction-default-sort", field: "date", direction: "desc" }];
  for (const rule of effectiveRules) {
    const result = compareTransactionValue(
      transactionSortValue(left, rule.field, decimalPlaces),
      transactionSortValue(right, rule.field, decimalPlaces),
    );
    if (result !== 0) return rule.direction === "asc" ? result : -result;
  }
  return compareString(left.id, right.id);
}

function transactionSortValue(
  row: TransactionRow,
  field: PlannerSortBy,
  decimalPlaces: ReadonlyMap<string, number>,
): string | number {
  if (field === "date") return row.date;
  if (field === "content") return row.content;
  if (field === "account") return row.accountLabel;
  if (field === "category") return row.categoryLabel;
  if (field === "amount") return displayedAmount(row, decimalPlaces);
  if (field === "updated") return row.updatedAt;
  return "";
}

function compareTransactionValue(left: string | number, right: string | number): number {
  return typeof left === "number" && typeof right === "number"
    ? left - right
    : compareString(String(left), String(right));
}

function compareString(left: string, right: string): number {
  return left.localeCompare(right);
}

function displayedAmount(
  row: TransactionRow,
  decimalPlaces: ReadonlyMap<string, number>,
): number {
  return row.amountMinor / 10 ** (decimalPlaces.get(row.currencyId) ?? 0);
}

function groupTransactionRows(
  rows: TransactionRow[],
  settings: PlannerGroupSettings,
): TransactionRowGroup[] {
  const { groupBy } = settings;
  if (groupBy === "none") return [{ key: "all", label: null, rows }];
  const groups = new Map<string, TransactionRowGroup>();
  for (const row of rows) {
    const { key, label } = transactionGroup(row, groupBy);
    const group = groups.get(key) ?? { key, label, rows: [] };
    group.rows.push(row);
    groups.set(key, group);
  }
  return orderVisiblePlannerGroups(
    [...groups.values()].map(({ key, label, rows }) => ({
      key,
      label: label ?? key,
      count: rows.length,
    })),
    settings,
  ).map(({ key }) => groups.get(key)!);
}

function transactionGroup(
  row: TransactionRow,
  groupBy: PlannerGroupBy,
): Pick<TransactionRowGroup, "key" | "label"> {
  if (groupBy === "month") {
    const key = row.date.slice(0, 7);
    return { key, label: `${monthNames[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}` };
  }
  if (groupBy === "week") {
    const key = isoMonday(row.date);
    return { key, label: `Week of ${key}` };
  }
  if (groupBy === "day") return { key: row.date, label: row.date };
  if (groupBy === "account") {
    return { key: row.accountIds[0] ?? "uncategorized", label: row.accountLabels[0] || "Uncategorized" };
  }
  if (groupBy === "category") {
    return row.categoryId
      ? { key: row.categoryId, label: row.categoryLabel || row.categoryId }
      : { key: "uncategorized", label: "Uncategorized" };
  }
  if (groupBy === "entry_type") return { key: row.kind, label: row.kind };
  return { key: "all", label: null };
}

function isoMonday(date: string): string {
  const value = new Date(`${date}T00:00:00Z`);
  const offset = (value.getUTCDay() + 6) % 7;
  value.setUTCDate(value.getUTCDate() - offset);
  return value.toISOString().slice(0, 10);
}

function uniqueValues(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
