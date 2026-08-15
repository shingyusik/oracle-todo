import {
  array,
  boolean,
  id,
  isoDate,
  nullableString,
  nullableTimestamp,
  nonEmptyString,
  record,
  safeInteger,
  string,
  timestamp,
} from "@/lib/raven-api";

export type LedgerEntryType =
  | "expense"
  | "income"
  | "transfer_out"
  | "transfer_in"
  | "adjustment_out"
  | "adjustment_in";
export type PublicLedgerEntryType = Exclude<LedgerEntryType, "transfer_out" | "transfer_in">;
export type TransactionCategoryKind = "expense" | "income";

export type LedgerEntry = {
  id: string;
  date: string;
  writtenAt: string;
  content: string;
  transactionCategoryId: string | null;
  accountId: string;
  entryType: LedgerEntryType;
  amountMinor: number;
  currencyId: string;
  transferGroupId: string | null;
  source: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type LedgerEntryView = {
  entry: LedgerEntry;
  accountName: string | null;
  categoryName: string | null;
  currencyCode: string | null;
};

export type LedgerEntryInput = {
  date: string;
  writtenAt: string;
  content: string;
  category?: string | null;
  account: string;
  entryType: PublicLedgerEntryType;
  amount: string;
  currency: string;
  source?: string;
  notes?: string | null;
  actor?: string;
};

export type LedgerEntryUpdate = Partial<Omit<LedgerEntryInput, "category" | "notes">> & {
  category?: string | null;
  notes?: string | null;
  reason?: string | null;
};

export type TransferInput = {
  date: string;
  writtenAt: string;
  content: string;
  fromAccount: string;
  toAccount: string;
  amount: string;
  currency: string;
  source?: string;
  notes?: string | null;
  actor?: string;
};

export type TransferUpdate = Omit<TransferInput, "writtenAt" | "source"> & {
  reason?: string | null;
};

export type Currency = {
  id: string;
  code: string;
  name: string;
  symbol: string;
  decimalPlaces: number;
  active: boolean;
};
export type AccountCategory = {
  id: string;
  name: string;
  parentId: string | null;
  liability: boolean;
  active: boolean;
};
export type Account = {
  id: string;
  name: string;
  categoryId: string;
  currencyId: string;
  openingBalanceMinor: number;
  active: boolean;
};
export type TransactionCategory = {
  id: string;
  name: string;
  parentId: string | null;
  kind: TransactionCategoryKind;
  active: boolean;
};
export type AccountBalance = {
  account: Account;
  currencyCode: string;
  currentBalanceMinor: number;
};
export type TransferView = {
  transferGroupId: string;
  outEntry: LedgerEntryView;
  inEntry: LedgerEntryView;
  amountMinor: number;
  currencyCode: string | null;
  fromAccountName: string | null;
  toAccountName: string | null;
};

export type ReportRange = { start: string; end: string };
export type CurrencySummary = {
  currencyId: string;
  currencyCode: string;
  incomeMinor: number;
  expenseMinor: number;
  netChangeMinor: number;
  entryCount: number;
};
export type LedgerSummary = { range: ReportRange; currencies: CurrencySummary[] };
export type BreakdownRow = CurrencySummary & {
  referenceId: string | null;
  name: string;
};
export type LedgerComparison = { current: LedgerSummary; previous: LedgerSummary };
export type LedgerBriefing = { summary: LedgerSummary; markdown: string };
export type PurgePreview = {
  confirmationId: string;
  transferGroupId: string | null;
  entryIds: string[];
};
export type MasterPurgePreview = { confirmationId: string; recordType: string };

export function mapLedgerEntry(value: unknown): LedgerEntry {
  const wire = record(value, "ledger entry");
  return {
    id: id(wire.id, "ledger entry.id"),
    date: isoDate(wire.date, "ledger entry.date"),
    writtenAt: timestamp(wire.written_at, "ledger entry.written_at"),
    content: nonEmptyString(wire.content, "ledger entry.content"),
    transactionCategoryId: nullableString(
      wire.transaction_category_id,
      "ledger entry.transaction_category_id",
    ),
    accountId: id(wire.account_id, "ledger entry.account_id"),
    entryType: entryType(wire.entry_type),
    amountMinor: positiveInteger(wire.amount, "ledger entry.amount"),
    currencyId: id(wire.currency_id, "ledger entry.currency_id"),
    transferGroupId: nullableString(wire.transfer_group_id, "ledger entry.transfer_group_id"),
    source: string(wire.source, "ledger entry.source"),
    notes: nullableString(wire.notes, "ledger entry.notes"),
    createdAt: timestamp(wire.created_at, "ledger entry.created_at"),
    updatedAt: timestamp(wire.updated_at, "ledger entry.updated_at"),
    deletedAt: nullableTimestamp(wire.deleted_at, "ledger entry.deleted_at"),
  };
}

export function mapLedgerEntryView(value: unknown): LedgerEntryView {
  const wire = record(value, "ledger entry view");
  return {
    entry: mapLedgerEntry(wire.entry),
    accountName: nullableString(wire.account_name, "ledger entry view.account_name"),
    categoryName: nullableString(wire.category_name, "ledger entry view.category_name"),
    currencyCode: nullableString(wire.currency_code, "ledger entry view.currency_code"),
  };
}

export function mapCurrency(value: unknown): Currency {
  const wire = record(value, "currency");
  return {
    id: id(wire.id, "currency.id"),
    code: nonEmptyString(wire.code, "currency.code"),
    name: nonEmptyString(wire.name, "currency.name"),
    symbol: nonEmptyString(wire.symbol, "currency.symbol"),
    decimalPlaces: rangeInteger(wire.decimal_places, "currency.decimal_places", 0, 18),
    active: boolean(wire.active, "currency.active"),
  };
}

export function mapAccountCategory(value: unknown): AccountCategory {
  const wire = record(value, "account category");
  return {
    id: id(wire.id, "account category.id"),
    name: nonEmptyString(wire.name, "account category.name"),
    parentId: nullableString(wire.parent_id, "account category.parent_id"),
    liability: boolean(wire.liability, "account category.liability"),
    active: boolean(wire.active, "account category.active"),
  };
}

export function mapAccount(value: unknown): Account {
  const wire = record(value, "account");
  return {
    id: id(wire.id, "account.id"),
    name: nonEmptyString(wire.name, "account.name"),
    categoryId: id(wire.category_id, "account.category_id"),
    currencyId: id(wire.currency_id, "account.currency_id"),
    openingBalanceMinor: safeInteger(wire.opening_balance, "account.opening_balance"),
    active: boolean(wire.active, "account.active"),
  };
}

export function mapTransactionCategory(value: unknown): TransactionCategory {
  const wire = record(value, "transaction category");
  return {
    id: id(wire.id, "transaction category.id"),
    name: nonEmptyString(wire.name, "transaction category.name"),
    parentId: nullableString(wire.parent_id, "transaction category.parent_id"),
    kind: categoryKind(wire.kind),
    active: boolean(wire.active, "transaction category.active"),
  };
}

export function mapAccountBalance(value: unknown): AccountBalance {
  const wire = record(value, "account balance");
  return {
    account: mapAccount(wire.account),
    currencyCode: nonEmptyString(wire.currency_code, "account balance.currency_code"),
    currentBalanceMinor: safeInteger(
      wire.current_balance_minor,
      "account balance.current_balance_minor",
    ),
  };
}

export function mapTransfer(value: unknown): TransferView {
  const wire = record(value, "transfer");
  return {
    transferGroupId: id(wire.transfer_group_id, "transfer.transfer_group_id"),
    outEntry: mapLedgerEntryView(wire.out_entry),
    inEntry: mapLedgerEntryView(wire.in_entry),
    amountMinor: positiveInteger(wire.amount_minor, "transfer.amount_minor"),
    currencyCode: nullableString(wire.currency_code, "transfer.currency_code"),
    fromAccountName: nullableString(wire.from_account_name, "transfer.from_account_name"),
    toAccountName: nullableString(wire.to_account_name, "transfer.to_account_name"),
  };
}

export function mapPurgePreview(value: unknown): PurgePreview {
  const wire = record(value, "purge preview");
  return {
    confirmationId: id(wire.confirmation_id, "purge preview.confirmation_id"),
    transferGroupId: nullableString(wire.transfer_group_id, "purge preview.transfer_group_id"),
    entryIds: array(wire.entry_ids, "purge preview.entry_ids")
      .map((item) => id(item, "purge preview.entry_ids[]")),
  };
}

export function mapMasterPurgePreview(value: unknown): MasterPurgePreview {
  const wire = record(value, "master purge preview");
  return {
    confirmationId: id(wire.confirmation_id, "master purge preview.confirmation_id"),
    recordType: nonEmptyString(wire.record_type, "master purge preview.record_type"),
  };
}

export function mapLedgerSummary(value: unknown): LedgerSummary {
  const wire = record(value, "ledger summary");
  const range = record(wire.range, "ledger summary.range");
  return {
    range: {
      start: isoDate(range.start, "ledger summary.range.start"),
      end: isoDate(range.end, "ledger summary.range.end"),
    },
    currencies: array(wire.currencies, "ledger summary.currencies")
      .map(mapCurrencySummary),
  };
}

export function mapBreakdown(value: unknown): BreakdownRow[] {
  return array(value, "ledger breakdown").map((item) => {
    const wire = record(item, "ledger breakdown row");
    return {
      ...mapCurrencySummary(wire),
      referenceId: nullableString(wire.reference_id, "ledger breakdown row.reference_id"),
      name: nonEmptyString(wire.name, "ledger breakdown row.name"),
    };
  });
}

export function mapLedgerComparison(value: unknown): LedgerComparison {
  const wire = record(value, "ledger comparison");
  return { current: mapLedgerSummary(wire.current), previous: mapLedgerSummary(wire.previous) };
}

export function mapLedgerBriefing(value: unknown): LedgerBriefing {
  const wire = record(value, "ledger briefing");
  return {
    summary: mapLedgerSummary(wire.summary),
    markdown: string(wire.markdown, "ledger briefing.markdown"),
  };
}

export function mapPage<T>(
  value: unknown,
  mapItem: (item: unknown) => T,
): { items: T[]; nextOffset: number | null } {
  const wire = record(value, "page");
  return {
    items: array(wire.items, "page.items").map(mapItem),
    nextOffset: wire.next_offset === null
      ? null
      : rangeInteger(wire.next_offset, "page.next_offset", 0, 4_294_967_295),
  };
}

function mapCurrencySummary(value: unknown): CurrencySummary {
  const wire = record(value, "currency summary");
  return {
    currencyId: id(wire.currency_id, "currency summary.currency_id"),
    currencyCode: nonEmptyString(wire.currency_code, "currency summary.currency_code"),
    incomeMinor: unsignedInteger(wire.income_minor, "currency summary.income_minor"),
    expenseMinor: unsignedInteger(wire.expense_minor, "currency summary.expense_minor"),
    netChangeMinor: safeInteger(wire.net_change_minor, "currency summary.net_change_minor"),
    entryCount: unsignedInteger(wire.entry_count, "currency summary.entry_count"),
  };
}

function entryType(value: unknown): LedgerEntryType {
  const result = string(value, "ledger entry.entry_type");
  if (![
    "expense", "income", "transfer_out", "transfer_in", "adjustment_out", "adjustment_in",
  ].includes(result)) throw new TypeError("invalid ledger entry.entry_type");
  return result as LedgerEntryType;
}

function categoryKind(value: unknown): TransactionCategoryKind {
  const result = string(value, "transaction category.kind");
  if (result !== "expense" && result !== "income") {
    throw new TypeError("invalid transaction category.kind");
  }
  return result;
}

function positiveInteger(value: unknown, field: string): number {
  return rangeInteger(value, field, 1, Number.MAX_SAFE_INTEGER);
}

function unsignedInteger(value: unknown, field: string): number {
  return rangeInteger(value, field, 0, Number.MAX_SAFE_INTEGER);
}

function rangeInteger(value: unknown, field: string, min: number, max: number): number {
  const result = safeInteger(value, field);
  if (result < min || result > max) throw new TypeError(`invalid ${field}`);
  return result;
}
