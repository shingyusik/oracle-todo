import { describe, expect, it } from "vitest";

import {
  applyReportDrilldown,
  buildLedgerReportModel,
  reportCurrencyOptions,
} from "@/features/ledger/model/ledger-reports";
import type {
  AccountBalance,
  BreakdownRow,
  LedgerComparison,
  LedgerTrend,
} from "@/features/ledger/model/ledger-model";
import { defaultLedgerTableSettings } from "@/features/ledger/model/ledger-table-views";

const current = { currencyId: "currency-usd", currencyCode: "USD", decimalPlaces: 2, incomeMinor: 1000, expenseMinor: 400, netChangeMinor: 600, entryCount: 2 };
const previous = { ...current, incomeMinor: 800, expenseMinor: 500, netChangeMinor: 300, entryCount: 3 };
const comparison: LedgerComparison = {
  current: { range: { start: "2026-08-01", end: "2026-08-31" }, currencies: [current] },
  previous: { range: { start: "2026-07-01", end: "2026-07-31" }, currencies: [previous] },
  currencies: [{ currencyId: "currency-usd", currencyCode: "USD", current, previous }],
};
const trend: LedgerTrend = { range: comparison.current.range, granularity: "daily", currencies: [{ currencyId: "currency-usd", currencyCode: "USD", points: [{ start: "2026-08-01", end: "2026-08-01", incomeMinor: 100, expenseMinor: 25 }] }] };
const categories: BreakdownRow[] = [breakdown("category-food", "Food", 0, 400, -400), breakdown("category-refund", "Refund", 100, 0, 100), { ...breakdown("category-eur", "EUR", 0, 900, -900), currencyId: "currency-eur" }];
const balances: AccountBalance[] = [balance("asset-cash", "Cash", "currency-usd", 12000), balance("asset-savings", "Savings", "currency-usd", 8000), balance("debt-card", "Card", "currency-usd", -5000), balance("asset-eur", "EUR cash", "currency-eur", 99000)];

describe("ledger report model", () => {
  it("derives current assets, liabilities, net assets, and inclusive daily spending", () => {
    const model = buildLedgerReportModel(comparison, categories, balances, trend, "currency-usd");
    expect(model.metrics).toEqual({ totalAssetsMinor: 20000, totalLiabilitiesMinor: 5000, netAssetsMinor: 15000, incomeMinor: 1000, expenseMinor: 400, averageDailyExpenseMinor: 13 });
    expect(model.assets.map(({ label, valueMinor, percentage }) => [label, valueMinor, percentage])).toEqual([["Cash", 12000, 60], ["Savings", 8000, 40]]);
    expect(model.liabilities).toMatchObject([{ id: "debt-card", label: "Card", valueMinor: 5000, percentage: 100 }]);
    expect(model.trend.points[0]).toMatchObject({ averageExpensePaceMinor: 13 });
  });

  it("keeps seven categories and combines the rest into Other", () => {
    const rows = Array.from({ length: 9 }, (_, index) => breakdown(`category-${index}`, `Category ${index}`, 0, 900 - index * 100, 0));
    const model = buildLedgerReportModel(comparison, rows, balances, trend, "currency-usd");
    expect(model.categories).toHaveLength(8);
    expect(model.categories.at(-1)).toMatchObject({ id: null, label: "Other", valueMinor: 300, interactive: false });
  });

  it("keeps a balance-only currency visible with zero period activity", () => {
    expect(reportCurrencyOptions(comparison, balances)).toContainEqual({ id: "currency-eur", code: "EUR" });
    const model = buildLedgerReportModel(comparison, categories, balances, trend, "currency-eur");
    expect(model.metrics.incomeMinor).toBe(0);
    expect(model.metrics.expenseMinor).toBe(0);
    expect(model.metrics.totalAssetsMinor).toBe(99000);
  });

  it("uses currency and account rules for account drilldowns", () => {
    const settings = { ...defaultLedgerTableSettings("ledger.transactions"), filterRules: [] };
    const account = applyReportDrilldown(settings, { kind: "account", currencyId: "currency-usd", referenceId: "asset-cash" });
    expect(account.filterRules.map(({ field }) => field)).toEqual(["currency", "account"]);
  });

  it("keeps period rules for category and trend drilldowns", () => {
    const settings = { ...defaultLedgerTableSettings("ledger.transactions"), filterRules: [] };
    const range = comparison.current.range;
    const category = applyReportDrilldown(settings, { kind: "category", range, currencyId: "currency-usd", referenceId: "category-food" });
    const incomeBucket = applyReportDrilldown(settings, { kind: "trend", range, currencyId: "currency-usd", entryType: "income" });
    expect(category.filterRules.map(({ field }) => field)).toEqual(["date", "currency", "category"]);
    expect(incomeBucket.filterRules.map(({ field }) => field)).toEqual(["date", "currency", "entry_type"]);
    expect(incomeBucket.filterRules.at(-1)).toMatchObject({ type: "select", operator: "is", value: ["income"] });
  });
});

function breakdown(referenceId: string, name: string, incomeMinor: number, expenseMinor: number, netChangeMinor: number): BreakdownRow {
  return { ...current, referenceId, name, incomeMinor, expenseMinor, netChangeMinor };
}
function balance(id: string, name: string, currencyId: string, currentBalanceMinor: number): AccountBalance {
  return { account: { id, name, categoryId: "account-category-cash", currencyId, openingBalanceMinor: 0, active: true }, currencyCode: currencyId === "currency-usd" ? "USD" : "EUR", decimalPlaces: 2, currentBalanceMinor };
}
