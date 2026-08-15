import { describe, expect, it } from "vitest";

import {
  applyReportDrilldown,
  buildLedgerReportModel,
} from "@/features/ledger/model/ledger-reports";
import type {
  BreakdownRow,
  LedgerComparison,
  LedgerTrend,
} from "@/features/ledger/model/ledger-model";
import { defaultLedgerTableSettings } from "@/features/ledger/model/ledger-table-views";

const current = {
  currencyId: "currency-usd",
  currencyCode: "USD",
  incomeMinor: 1000,
  expenseMinor: 400,
  netChangeMinor: 600,
  entryCount: 2,
};
const previous = {
  currencyId: "currency-usd",
  currencyCode: "USD",
  incomeMinor: 800,
  expenseMinor: 500,
  netChangeMinor: 300,
  entryCount: 3,
};
const comparison: LedgerComparison = {
  current: { range: { start: "2026-08-01", end: "2026-08-31" }, currencies: [current] },
  previous: { range: { start: "2026-07-01", end: "2026-07-31" }, currencies: [previous] },
  currencies: [{ currencyId: "currency-usd", currencyCode: "USD", current, previous }],
};
const trend: LedgerTrend = {
  range: comparison.current.range,
  granularity: "daily",
  currencies: [{
    currencyId: "currency-usd",
    currencyCode: "USD",
    points: [{ start: "2026-08-01", end: "2026-08-01", incomeMinor: 100, expenseMinor: 25 }],
  }],
};
const categories: BreakdownRow[] = [
  breakdown("category-food", "Food", 0, 400, -400),
  breakdown("category-refund", "Refund", 100, 0, 100),
  { ...breakdown("category-eur", "EUR", 0, 900, -900), currencyId: "currency-eur" },
];
const accounts: BreakdownRow[] = [breakdown("account-cash", "Cash", 1000, 400, 600)];

describe("ledger report model", () => {
  it("derives one selected currency's cards, expense categories, and trend", () => {
    const model = buildLedgerReportModel(comparison, categories, accounts, trend, "currency-usd");

    expect(model.summary.map(({ valueMinor }) => valueMinor)).toEqual([1000, 400, 600]);
    expect(model.summary[3]?.count).toBe(2);
    expect(model.categories.reduce((sum, row) => sum + row.expenseMinor, 0)).toBe(400);
    expect(model.trend.points.map(({ incomeMinor, expenseMinor }) =>
      [incomeMinor, expenseMinor])).toEqual([[100, 25]]);
    expect(model.summary.map(({ changeMinor }) => changeMinor)).toEqual([200, -100, 300]);
  });

  it("uses three replacement AND rules for category and account drilldowns", () => {
    const settings = {
      ...defaultLedgerTableSettings("ledger.transactions"),
      filterMode: "or" as const,
      filterRules: [{
        id: "old", field: "content" as const, type: "text" as const,
        operator: "contains" as const, value: "lunch",
      }],
    };
    const next = applyReportDrilldown(settings, {
      range: { start: "2026-08-01", end: "2026-08-31" },
      currencyId: "currency-usd",
      kind: "category",
      referenceId: "category-food",
    });
    const account = applyReportDrilldown(settings, {
      range: { start: "2026-08-01", end: "2026-08-31" },
      currencyId: "currency-usd",
      kind: "account",
      referenceId: "account-cash",
    });

    expect(next.filterMode).toBe("and");
    expect(next.filterRules.map(({ field }) => field)).toEqual(["date", "currency", "category"]);
    expect(next.filterRules.map(({ id }) => id)).toEqual([
      "ledger-report-date", "ledger-report-currency", "ledger-report-category",
    ]);
    expect(account.filterRules.map(({ field }) => field)).toEqual(["date", "currency", "account"]);
    expect(settings.filterRules.map(({ id }) => id)).toEqual(["old"]);
  });

  it("returns zero cards and no sections for a currency without current rows", () => {
    const model = buildLedgerReportModel(comparison, categories, accounts, trend, "currency-eur");

    expect(model.summary.map(({ valueMinor }) => valueMinor)).toEqual([0, 0, 0]);
    expect(model.categories).toEqual([]);
    expect(model.accounts).toEqual([]);
    expect(model.trend.points).toEqual([]);
  });
});

function breakdown(
  referenceId: string,
  name: string,
  incomeMinor: number,
  expenseMinor: number,
  netChangeMinor: number,
): BreakdownRow {
  return {
    ...current,
    referenceId,
    name,
    incomeMinor,
    expenseMinor,
    netChangeMinor,
  };
}
