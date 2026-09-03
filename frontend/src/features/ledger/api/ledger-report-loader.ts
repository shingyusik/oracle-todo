import {
  ledgerApi,
  type Page,
  type ReportSelection,
} from "@/features/ledger/api/ledger-api";
import type {
  AccountBalance,
  BreakdownRow,
  LedgerComparison,
  LedgerSummary,
  LedgerTrend,
} from "@/features/ledger/model/ledger-model";
import { localCalendarDate } from "@/features/workbench/model/planner-model";

export type LedgerReportData = {
  comparison: LedgerComparison;
  categoryBreakdown: BreakdownRow[];
  trend: LedgerTrend;
  balances: AccountBalance[];
  summary: LedgerSummary | null;
};

export async function loadLedgerReport(
  selection: ReportSelection,
  today = localCalendarDate(new Date()),
): Promise<LedgerReportData> {
  const comparison = await ledgerApi.compare(selection);
  const range = {
    from: comparison.current.range.start,
    to: comparison.current.range.end,
  };
  const [summary, categoryBreakdown, trend, balances] = await Promise.all([
    range.from > today
      ? null
      : range.to <= today
        ? comparison.current
        : ledgerApi.summary({ from: range.from, to: today }),
    ledgerApi.categoryReport(range),
    ledgerApi.trend(range),
    drainPages((offset) => ledgerApi.listAccountBalances({ limit: 200, offset })),
  ]);
  return { comparison, categoryBreakdown, trend, balances, summary };
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
