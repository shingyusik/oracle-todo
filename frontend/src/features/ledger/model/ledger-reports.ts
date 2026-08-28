import type {
  AccountBalance,
  BreakdownRow,
  LedgerComparison,
  LedgerTrend,
  ReportRange,
} from "@/features/ledger/model/ledger-model";
import {
  clonePlannerTableSettings,
  type PlannerTableSettings,
} from "@/features/workbench/model/planner-model";

export type CompositionSlice = {
  id: string | null;
  label: string;
  valueMinor: number;
  percentage: number;
  interactive: boolean;
};
export type LedgerReportModel = {
  currencyId: string;
  currencyCode: string;
  decimalPlaces: number;
  range: ReportRange | null;
  metrics: {
    totalAssetsMinor: number;
    totalLiabilitiesMinor: number;
    netAssetsMinor: number;
    incomeMinor: number;
    expenseMinor: number;
    averageDailyExpenseMinor: number;
  };
  assets: CompositionSlice[];
  liabilities: CompositionSlice[];
  categories: CompositionSlice[];
  trend: {
    granularity: LedgerTrend["granularity"];
    points: Array<LedgerTrend["currencies"][number]["points"][number] & {
      averageExpensePaceMinor: number;
    }>;
  };
};
export type ReportDrilldownTarget =
  | { kind: "account"; currencyId: string; referenceId: string }
  | { kind: "category"; range: ReportRange; currencyId: string; referenceId: string | null }
  | { kind: "trend"; range: ReportRange; currencyId: string; entryType: "income" | "expense" };

export function buildLedgerReportModel(
  comparison: LedgerComparison,
  categories: BreakdownRow[],
  balances: AccountBalance[],
  trend: LedgerTrend,
  currencyId: string,
): LedgerReportModel {
  const selected = comparison.currencies.find((row) => row.currencyId === currencyId);
  const balanceMetadata = balances.find((row) => row.account.currencyId === currencyId);
  if (!selected && !balanceMetadata) return emptyReportModel(currencyId, trend.granularity);
  const range = comparison.current.range;
  const selectedBalances = balances.filter((row) => row.account.currencyId === currencyId);
  const assets = composition(selectedBalances
    .filter((row) => row.currentBalanceMinor > 0)
    .map((row) => ({
      id: row.account.id,
      label: row.account.name,
      valueMinor: row.currentBalanceMinor,
      interactive: true,
    })));
  const liabilities = composition(selectedBalances
    .filter((row) => row.currentBalanceMinor < 0)
    .map((row) => ({
      id: row.account.id,
      label: row.account.name,
      valueMinor: Math.abs(row.currentBalanceMinor),
      interactive: true,
    })));
  const totalAssetsMinor = sumSlices(assets);
  const totalLiabilitiesMinor = sumSlices(liabilities);
  const current = selected?.current ?? {
    incomeMinor: 0,
    expenseMinor: 0,
    netChangeMinor: 0,
    entryCount: 0,
  };
  const averageDailyExpenseMinor = Math.round(
    current.expenseMinor / inclusiveDays(range.start, range.end),
  );
  const selectedTrend = trend.currencies.find((row) => row.currencyId === currencyId);
  return {
    currencyId,
    currencyCode: selected?.currencyCode ?? balanceMetadata!.currencyCode,
    decimalPlaces: selected?.current.decimalPlaces ?? balanceMetadata!.decimalPlaces,
    range,
    metrics: {
      totalAssetsMinor,
      totalLiabilitiesMinor,
      netAssetsMinor: totalAssetsMinor - totalLiabilitiesMinor,
      incomeMinor: current.incomeMinor,
      expenseMinor: current.expenseMinor,
      averageDailyExpenseMinor,
    },
    assets,
    liabilities,
    categories: categorySlices(categories, currencyId),
    trend: {
      granularity: trend.granularity,
      points: (selectedTrend?.points ?? []).map((point) => ({
        ...point,
        averageExpensePaceMinor:
          averageDailyExpenseMinor * inclusiveDays(point.start, point.end),
      })),
    },
  };
}

export function reportCurrencyOptions(
  comparison: LedgerComparison | null,
  balances: AccountBalance[],
): Array<{ id: string; code: string }> {
  const options = new Map<string, string>();
  for (const row of comparison?.currencies ?? []) {
    options.set(row.currencyId, row.currencyCode);
  }
  for (const row of balances) {
    if (!options.has(row.account.currencyId)) {
      options.set(row.account.currencyId, row.currencyCode);
    }
  }
  return [...options].map(([id, code]) => ({ id, code }));
}

export function applyReportDrilldown(
  settings: PlannerTableSettings,
  target: ReportDrilldownTarget,
): PlannerTableSettings {
  const next = clonePlannerTableSettings(settings);
  const rules: PlannerTableSettings["filterRules"] = [{
    id: "ledger-report-currency",
    field: "currency",
    type: "relation",
    operator: "is",
    value: [target.currencyId],
  }];
  if (target.kind === "account") {
    rules.push({
      id: "ledger-report-account",
      field: "account",
      type: "relation",
      operator: "is",
      value: [target.referenceId],
    });
  } else {
    rules.unshift({
      id: "ledger-report-date",
      field: "date",
      type: "date",
      operator: "is_between",
      value: target.range,
    });
    if (target.kind === "category") {
      rules.push({
        id: "ledger-report-category",
        field: "category",
        type: "relation",
        operator: target.referenceId === null ? "is_empty" : "is",
        value: target.referenceId === null ? null : [target.referenceId],
      });
    } else {
      rules.push({
        id: "ledger-report-entry-type",
        field: "entry_type",
        type: "select",
        operator: "is",
        value: [target.entryType],
      });
    }
  }
  return { ...next, filterMode: "and", filterRules: rules };
}

type RawSlice = Omit<CompositionSlice, "percentage">;
function composition(rows: RawSlice[]): CompositionSlice[] {
  const sorted = [...rows].sort(
    (a, b) => b.valueMinor - a.valueMinor || a.label.localeCompare(b.label),
  );
  const total = sorted.reduce((sum, row) => sum + row.valueMinor, 0);
  return sorted.map((row) => ({
    ...row,
    percentage: total === 0 ? 0 : Math.round(row.valueMinor / total * 100),
  }));
}

function sumSlices(rows: CompositionSlice[]): number {
  return rows.reduce((sum, row) => sum + row.valueMinor, 0);
}

function categorySlices(rows: BreakdownRow[], currencyId: string): CompositionSlice[] {
  const sorted = rows
    .filter((row) => row.currencyId === currencyId && row.expenseMinor > 0)
    .sort((a, b) => b.expenseMinor - a.expenseMinor || a.name.localeCompare(b.name));
  const visible: RawSlice[] = sorted.slice(0, 7).map((row) => ({
    id: row.referenceId,
    label: row.name,
    valueMinor: row.expenseMinor,
    interactive: true,
  }));
  const otherMinor = sorted.slice(7).reduce((sum, row) => sum + row.expenseMinor, 0);
  if (otherMinor > 0) {
    visible.push({
      id: null,
      label: "Other",
      valueMinor: otherMinor,
      interactive: false,
    });
  }
  const total = visible.reduce((sum, row) => sum + row.valueMinor, 0);
  return visible.map((row) => ({
    ...row,
    percentage: total === 0 ? 0 : Math.round(row.valueMinor / total * 100),
  }));
}

function inclusiveDays(start: string, end: string): number {
  return Math.floor(
    (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000,
  ) + 1;
}

function emptyReportModel(
  currencyId: string,
  granularity: LedgerTrend["granularity"],
): LedgerReportModel {
  return {
    currencyId,
    currencyCode: "",
    decimalPlaces: 0,
    range: null,
    metrics: {
      totalAssetsMinor: 0,
      totalLiabilitiesMinor: 0,
      netAssetsMinor: 0,
      incomeMinor: 0,
      expenseMinor: 0,
      averageDailyExpenseMinor: 0,
    },
    assets: [],
    liabilities: [],
    categories: [],
    trend: { granularity, points: [] },
  };
}
