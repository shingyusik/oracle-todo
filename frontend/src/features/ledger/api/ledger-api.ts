import {
  type Account,
  type AccountBalance,
  type AccountCategory,
  type BreakdownRow,
  type Currency,
  type LedgerBriefing,
  type LedgerComparison,
  type LedgerEntry,
  type LedgerEntryInput,
  type LedgerEntryUpdate,
  type LedgerEntryView,
  type LedgerSummary,
  type MasterPurgePreview,
  type PurgePreview,
  type TransactionCategory,
  type TransactionCategoryKind,
  type TransferInput,
  type TransferUpdate,
  type TransferView,
  mapAccount,
  mapAccountBalance,
  mapAccountCategory,
  mapBreakdown,
  mapCurrency,
  mapLedgerBriefing,
  mapLedgerComparison,
  mapLedgerEntry,
  mapLedgerEntryView,
  mapLedgerSummary,
  mapMasterPurgePreview,
  mapPage,
  mapPurgePreview,
  mapTransactionCategory,
  mapTransfer,
} from "@/features/ledger/model/ledger-model";
import {
  apiPath,
  jsonRequest,
  requestJson,
  type JsonObject,
  type JsonValue,
} from "@/lib/raven-api";

const ROOT = "/api/v1/ledger";
const MAX_PENDING_TRANSFER_KEYS = 64;
const pendingTransferKeys = new Map<string, string>();

export type Page<T> = { items: T[]; nextOffset: number | null };
export type PageQuery = { offset?: number; limit?: number };
export type EntryQuery = PageQuery & {
  dateFrom?: string;
  dateTo?: string;
  entryType?: string;
  account?: string;
  category?: string;
  currency?: string;
  content?: string;
  includeArchived?: boolean;
};
export type ReportRangeInput = { from: string; to: string };
export type MonthlyReportInput = { year: number; month: number };

export type CurrencyInput = {
  code: string; name: string; symbol: string; decimalPlaces: number; actor?: string;
};
export type AccountCategoryInput = {
  name: string; parent?: string | null; liability?: boolean; actor?: string;
};
export type AccountInput = {
  name: string; category: string; currency: string; openingBalance: string; actor?: string;
};
export type TransactionCategoryInput = {
  name: string; parent?: string | null; kind: TransactionCategoryKind; actor?: string;
};

export const ledgerApi = {
  async listEntries(query: EntryQuery = {}): Promise<Page<LedgerEntryView>> {
    const value = await requestJson(apiPath(`${ROOT}/entries`, {
      offset: query.offset,
      limit: query.limit,
      include_archived: query.includeArchived,
      date_from: query.dateFrom,
      date_to: query.dateTo,
      entry_type: query.entryType,
      account: query.account,
      category: query.category,
      currency: query.currency,
      content: query.content,
    }));
    return mapPage(value, mapLedgerEntryView);
  },
  async getEntry(id: string): Promise<LedgerEntry> {
    return mapLedgerEntry(await requestJson(`${ROOT}/entries/${segment(id)}`));
  },
  async createEntry(input: LedgerEntryInput): Promise<LedgerEntry> {
    return mapLedgerEntry(await requestJson(`${ROOT}/entries`, jsonRequest("POST", entryBody(input))));
  },
  async updateEntry(id: string, input: LedgerEntryUpdate): Promise<LedgerEntry> {
    return mapLedgerEntry(await requestJson(
      `${ROOT}/entries/${segment(id)}`,
      jsonRequest("PATCH", entryUpdateBody(input)),
    ));
  },
  async archiveEntry(id: string): Promise<LedgerEntry> {
    return mapLedgerEntry(await requestJson(`${ROOT}/entries/${segment(id)}/archive`, {
      method: "POST",
    }));
  },
  async restoreEntry(id: string): Promise<LedgerEntry> {
    return mapLedgerEntry(await requestJson(`${ROOT}/entries/${segment(id)}/restore`, {
      method: "POST",
    }));
  },
  async previewEntryPurge(id: string): Promise<PurgePreview> {
    return mapPurgePreview(await requestJson(`${ROOT}/entries/${segment(id)}/purge`));
  },
  async purgeEntry(id: string, confirmation: string): Promise<void> {
    await requestJson(
      `${ROOT}/entries/${segment(id)}/purge`,
      jsonRequest("DELETE", { confirmation }),
    );
  },
  async createTransfer(input: TransferInput): Promise<TransferView> {
    const payload = transferBody(input);
    const fingerprint = await transferFingerprint(payload);
    let operationKey = pendingTransferKeys.get(fingerprint);
    if (operationKey === undefined) {
      operationKey = crypto.randomUUID();
      if (pendingTransferKeys.size >= MAX_PENDING_TRANSFER_KEYS) {
        const oldest = pendingTransferKeys.keys().next().value;
        if (oldest !== undefined) pendingTransferKeys.delete(oldest);
      }
      pendingTransferKeys.set(fingerprint, operationKey);
    }
    const transfer = mapTransfer(await requestJson(`${ROOT}/transfers`, jsonRequest("POST", {
      operation_key: operationKey,
      ...payload,
    })));
    if (pendingTransferKeys.get(fingerprint) === operationKey) {
      pendingTransferKeys.delete(fingerprint);
    }
    return transfer;
  },
  async getTransfer(id: string): Promise<TransferView> {
    return mapTransfer(await requestJson(`${ROOT}/transfers/${segment(id)}`));
  },
  async updateTransfer(id: string, input: TransferUpdate): Promise<TransferView> {
    return mapTransfer(await requestJson(
      `${ROOT}/transfers/${segment(id)}`,
      jsonRequest("PATCH", transferUpdateBody(input)),
    ));
  },
  listCurrencies: (query: PageQuery = {}) =>
    masterPage(`${ROOT}/currencies`, query, mapCurrency),
  createCurrency: async (input: CurrencyInput): Promise<Currency> =>
    mapCurrency(await requestJson(`${ROOT}/currencies`, jsonRequest("POST", clean({
      code: input.code,
      name: input.name,
      symbol: input.symbol,
      decimal_places: input.decimalPlaces,
      actor: input.actor,
    })))),
  updateCurrency: async (
    id: string,
    input: Partial<CurrencyInput> & { active?: boolean; reason?: string | null },
  ): Promise<Currency> =>
    mapCurrency(await requestJson(`${ROOT}/currencies/${segment(id)}`, jsonRequest("PATCH", clean({
      code: input.code,
      name: input.name,
      symbol: input.symbol,
      decimal_places: input.decimalPlaces,
      active: input.active,
      actor: input.actor,
      reason: input.reason,
    })))),
  listAccountCategories: (query: PageQuery = {}) =>
    masterPage(`${ROOT}/account-categories`, query, mapAccountCategory),
  createAccountCategory: async (input: AccountCategoryInput): Promise<AccountCategory> =>
    mapAccountCategory(await requestJson(
      `${ROOT}/account-categories`,
      jsonRequest("POST", clean({
        name: input.name, parent: input.parent, liability: input.liability, actor: input.actor,
      })),
    )),
  updateAccountCategory: async (
    id: string,
    input: Partial<AccountCategoryInput> & { active?: boolean; reason?: string | null },
  ): Promise<AccountCategory> =>
    mapAccountCategory(await requestJson(
      `${ROOT}/account-categories/${segment(id)}`,
      jsonRequest("PATCH", clean({
        name: input.name,
        parent: input.parent,
        liability: input.liability,
        active: input.active,
        actor: input.actor,
        reason: input.reason,
      })),
    )),
  listAccounts: (query: PageQuery = {}) => masterPage(`${ROOT}/accounts`, query, mapAccount),
  createAccount: async (input: AccountInput): Promise<Account> =>
    mapAccount(await requestJson(`${ROOT}/accounts`, jsonRequest("POST", clean({
      name: input.name,
      category: input.category,
      currency: input.currency,
      opening_balance: input.openingBalance,
      actor: input.actor,
    })))),
  updateAccount: async (
    id: string,
    input: Partial<AccountInput> & { active?: boolean; reason?: string | null },
  ): Promise<Account> =>
    mapAccount(await requestJson(`${ROOT}/accounts/${segment(id)}`, jsonRequest("PATCH", clean({
      name: input.name,
      category: input.category,
      currency: input.currency,
      opening_balance: input.openingBalance,
      active: input.active,
      actor: input.actor,
      reason: input.reason,
    })))),
  listTransactionCategories: (query: PageQuery = {}) =>
    masterPage(`${ROOT}/transaction-categories`, query, mapTransactionCategory),
  createTransactionCategory: async (
    input: TransactionCategoryInput,
  ): Promise<TransactionCategory> =>
    mapTransactionCategory(await requestJson(
      `${ROOT}/transaction-categories`,
      jsonRequest("POST", clean({
        name: input.name, parent: input.parent, kind: input.kind, actor: input.actor,
      })),
    )),
  updateTransactionCategory: async (
    id: string,
    input: Partial<TransactionCategoryInput> & { active?: boolean; reason?: string | null },
  ): Promise<TransactionCategory> =>
    mapTransactionCategory(await requestJson(
      `${ROOT}/transaction-categories/${segment(id)}`,
      jsonRequest("PATCH", clean({
        name: input.name,
        parent: input.parent,
        kind: input.kind,
        active: input.active,
        actor: input.actor,
        reason: input.reason,
      })),
    )),
  listAccountBalances: (query: PageQuery = {}) =>
    masterPage(`${ROOT}/account-balances`, query, mapAccountBalance),
  async previewMasterPurge(
    kind: "currencies" | "account-categories" | "accounts" | "transaction-categories",
    id: string,
  ): Promise<MasterPurgePreview> {
    return mapMasterPurgePreview(await requestJson(`${ROOT}/${kind}/${segment(id)}/purge`));
  },
  async purgeMaster(
    kind: "currencies" | "account-categories" | "accounts" | "transaction-categories",
    id: string,
    confirmation: string,
  ): Promise<void> {
    await requestJson(`${ROOT}/${kind}/${segment(id)}`, jsonRequest("DELETE", { confirmation }));
  },
  async summary(input: ReportRangeInput | MonthlyReportInput): Promise<LedgerSummary> {
    return mapLedgerSummary(await requestJson(apiPath(`${ROOT}/reports/summary`, reportQuery(input))));
  },
  async accountReport(input: ReportRangeInput): Promise<BreakdownRow[]> {
    return mapBreakdown(await requestJson(apiPath(`${ROOT}/reports/accounts`, reportQuery(input))));
  },
  async categoryReport(input: ReportRangeInput): Promise<BreakdownRow[]> {
    return mapBreakdown(await requestJson(apiPath(`${ROOT}/reports/categories`, reportQuery(input))));
  },
  async compare(
    current: ReportRangeInput,
    previous: ReportRangeInput,
  ): Promise<LedgerComparison> {
    return mapLedgerComparison(await requestJson(apiPath(`${ROOT}/reports/compare`, {
      current_from: current.from,
      current_to: current.to,
      previous_from: previous.from,
      previous_to: previous.to,
    })));
  },
  async briefing(input: ReportRangeInput): Promise<LedgerBriefing> {
    return mapLedgerBriefing(await requestJson(
      apiPath(`${ROOT}/reports/briefing`, reportQuery(input)),
    ));
  },
};

async function masterPage<T>(
  path: string,
  query: PageQuery,
  mapper: (value: unknown) => T,
): Promise<Page<T>> {
  return mapPage(
    await requestJson(apiPath(path, { offset: query.offset, limit: query.limit })),
    mapper,
  );
}

function entryBody(input: LedgerEntryInput): JsonObject {
  return clean({
    date: input.date,
    written_at: input.writtenAt,
    content: input.content,
    category: input.category,
    account: input.account,
    entry_type: input.entryType,
    amount: input.amount,
    currency: input.currency,
    source: input.source,
    notes: input.notes,
    actor: input.actor,
  });
}

function entryUpdateBody(input: LedgerEntryUpdate): JsonObject {
  return clean({
    date: input.date,
    written_at: input.writtenAt,
    content: input.content,
    category: input.category,
    account: input.account,
    entry_type: input.entryType,
    amount: input.amount,
    currency: input.currency,
    source: input.source,
    notes: input.notes,
    actor: input.actor,
    reason: input.reason,
  });
}

function transferBody(input: TransferInput): JsonObject {
  return clean({
    date: input.date,
    written_at: input.writtenAt,
    content: input.content,
    from_account: input.fromAccount,
    to_account: input.toAccount,
    amount: input.amount,
    currency: input.currency,
    source: input.source,
    notes: input.notes,
    actor: input.actor,
  });
}

function transferUpdateBody(input: TransferUpdate): JsonObject {
  return clean({
    date: input.date,
    content: input.content,
    from_account: input.fromAccount,
    to_account: input.toAccount,
    amount: input.amount,
    currency: input.currency,
    notes: input.notes,
    actor: input.actor,
    reason: input.reason,
  });
}

async function transferFingerprint(payload: JsonObject): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function reportQuery(input: ReportRangeInput | MonthlyReportInput) {
  return "year" in input
    ? { year: input.year, month: input.month }
    : { from: input.from, to: input.to };
}

function clean(value: Record<string, JsonValue | undefined>): JsonObject {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as JsonObject;
}

function segment(value: string): string {
  return encodeURIComponent(value);
}
