import type {
  BreakdownRow,
  LedgerComparison,
  LedgerTrend,
  ReportRange,
} from "@/features/ledger/model/ledger-model";
import {
  clonePlannerTableSettings,
  type PlannerTableSettings,
} from "@/features/workbench/model/planner-model";

export type LedgerReportCard = {
  id: "income" | "expense" | "net";
  valueMinor: number;
  changeMinor: number;
};

export type LedgerReportCount = {
  id: "entries";
  count: number;
  changeMinor: number;
};

export type LedgerReportSummary = {
  [index: number]: LedgerReportCard | LedgerReportCount;
  0: LedgerReportCard;
  1: LedgerReportCard;
  2: LedgerReportCard;
  3: LedgerReportCount;
  map<T>(callback: (card: LedgerReportCard, index: number) => T): T[];
};

export type LedgerReportModel = {
  currencyId: string;
  currencyCode: string;
  decimalPlaces: number;
  range: ReportRange | null;
  summary: LedgerReportSummary;
  categories: BreakdownRow[];
  accounts: BreakdownRow[];
  trend: { granularity: LedgerTrend["granularity"]; points: LedgerTrend["currencies"][number]["points"] };
};

export type ReportDrilldownTarget = {
  range: ReportRange;
  currencyId: string;
  kind: "category" | "account";
  referenceId: string;
};

export function buildLedgerReportModel(
  comparison: LedgerComparison,
  categories: BreakdownRow[],
  accounts: BreakdownRow[],
  trend: LedgerTrend,
  currencyId: string,
): LedgerReportModel {
  const selected = comparison.currencies.find((currency) => currency.currencyId === currencyId);
  if (!selected) return emptyReportModel(currencyId, trend.granularity);
  const matching = (row: BreakdownRow) => row.currencyId === currencyId;
  const selectedTrend = trend.currencies.find((currency) => currency.currencyId === currencyId);
  return {
    currencyId,
    currencyCode: selected.currencyCode,
    decimalPlaces: selected.current.decimalPlaces,
    range: comparison.current.range,
    summary: summaryCards(selected.current, selected.previous),
    categories: categories.filter((row) => matching(row) && row.expenseMinor > 0),
    accounts: accounts.filter(matching),
    trend: { granularity: trend.granularity, points: selectedTrend?.points ?? [] },
  };
}

export function applyReportDrilldown(
  settings: PlannerTableSettings,
  target: ReportDrilldownTarget,
): PlannerTableSettings {
  const next = clonePlannerTableSettings(settings);
  return {
    ...next,
    filterMode: "and",
    filterRules: [
      {
        id: "ledger-report-date",
        field: "date",
        type: "date",
        operator: "is_between",
        value: target.range,
      },
      {
        id: "ledger-report-currency",
        field: "currency",
        type: "relation",
        operator: "is",
        value: [target.currencyId],
      },
      {
        id: `ledger-report-${target.kind}`,
        field: target.kind,
        type: "relation",
        operator: "is",
        value: [target.referenceId],
      },
    ],
  };
}

function summaryCards(
  current: LedgerComparison["currencies"][number]["current"],
  previous: LedgerComparison["currencies"][number]["previous"],
): LedgerReportSummary {
  const values = [
    card("income", current.incomeMinor, previous.incomeMinor),
    card("expense", current.expenseMinor, previous.expenseMinor),
    card("net", current.netChangeMinor, previous.netChangeMinor),
  ];
  const entries: LedgerReportCount = {
    id: "entries",
    count: current.entryCount,
    changeMinor: current.entryCount - previous.entryCount,
  };
  return {
    0: values[0],
    1: values[1],
    2: values[2],
    3: entries,
    map: (callback) => values.map(callback),
  };
}

function card(
  id: LedgerReportCard["id"],
  valueMinor: number,
  previous: number,
): LedgerReportCard {
  return { id, valueMinor, changeMinor: valueMinor - previous };
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
    summary: summaryCards(
      { currencyId, currencyCode: "", decimalPlaces: 0, incomeMinor: 0, expenseMinor: 0, netChangeMinor: 0, entryCount: 0 },
      { currencyId, currencyCode: "", decimalPlaces: 0, incomeMinor: 0, expenseMinor: 0, netChangeMinor: 0, entryCount: 0 },
    ),
    categories: [],
    accounts: [],
    trend: { granularity, points: [] },
  };
}
