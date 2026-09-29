import { describe, expect, it } from "vitest";
import { buildTransactionAnalysis, mapTransactionAnalysis } from "@/features/ledger/model/ledger-analysis";

describe("filtered transaction analysis", () => {
  it("keeps currencies separate, excludes transfers from cash flow and fills empty months", () => {
    const bucket = { currency_id: "krw", currency_code: "KRW", decimal_places: 0, month: "2026-07", kind: "expense", category_id: "food", category_label: "Food", count: 60, total_minor: 6000 };
    const buckets = mapTransactionAnalysis({ buckets: [bucket,
      { ...bucket, month: "2026-09", kind: "income", total_minor: 3000, count: 1 },
      { ...bucket, kind: "transfer", total_minor: 999999, count: 1 },
      { ...bucket, currency_id: "usd", currency_code: "USD", decimal_places: 2, total_minor: 1500, count: 1 },
    ] });
    const model = buildTransactionAnalysis(buckets, "krw");
    expect(model.count).toBe(62);
    expect(model.spending).toBe(6000);
    expect(model.income).toBe(3000);
    expect(model.months).toEqual([
      { month: "2026-07", spending: 6000, income: 0 },
      { month: "2026-08", spending: 0, income: 0 },
      { month: "2026-09", spending: 0, income: 3000 },
    ]);
    expect(model.averageMonthlySpending).toBe(2000);
    expect(model.categories).toEqual([{ id: "food", label: "Food", value: 6000 }]);
    expect(buildTransactionAnalysis(buckets, "usd").spending).toBe(1500);
  });

  it("rejects unsafe amounts and handles empty results", () => {
    expect(() => mapTransactionAnalysis({ buckets: [{ total_minor: Number.MAX_SAFE_INTEGER + 1 }] })).toThrow();
    expect(buildTransactionAnalysis([], "krw").months).toEqual([]);
  });
});
