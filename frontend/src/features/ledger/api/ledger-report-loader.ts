import {
  ledgerApi,
  type Page,
  type ReportSelection,
} from "@/features/ledger/api/ledger-api";
import type {
  AccountBalance,
  BreakdownRow,
  LedgerComparison,
  LedgerTrend,
} from "@/features/ledger/model/ledger-model";

export type LedgerReportData = {
  comparison: LedgerComparison;
  categoryBreakdown: BreakdownRow[];
  trend: LedgerTrend;
  balances: AccountBalance[];
};

export async function loadLedgerReport(
  selection: ReportSelection,
): Promise<LedgerReportData> {
  const comparison = await ledgerApi.compare(selection);
  const range = {
    from: comparison.current.range.start,
    to: comparison.current.range.end,
  };
  const [categoryBreakdown, trend, balances] = await Promise.all([
    ledgerApi.categoryReport(range),
    ledgerApi.trend(range),
    drainPages((offset) => ledgerApi.listAccountBalances({ limit: 200, offset })),
  ]);
  return { comparison, categoryBreakdown, trend, balances };
}

async function drainPages<T>(
  load: (offset?: number) => Promise<Page<T>>,
): Promise<T[]> {
  const items: T[] = [];
  let offset: number | undefined;
  do {
    const page = await load(offset);
    items.push(...page.items);
    offset = page.nextOffset ?? undefined;
  } while (offset !== undefined);
  return items;
}
