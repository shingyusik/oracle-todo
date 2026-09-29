import { array, isoDate, nonEmptyString, nullableString, record, safeInteger, string, RavenTransportError } from "@/lib/raven-api";

export type TransactionAnalysisBucket = {
  currencyId: string; currencyCode: string; decimalPlaces: number;
  month: string; kind: "expense" | "income" | "transfer";
  categoryId: string | null; categoryLabel: string; count: number; totalMinor: number;
};

export function mapTransactionAnalysis(value: unknown): TransactionAnalysisBucket[] {
  return array(record(value, "analysis").buckets, "analysis.buckets").map((item) => {
    const row = record(item, "analysis bucket");
    const kind = string(row.kind, "kind");
    const month = string(row.month, "month");
    isoDate(`${month}-01`, "month");
    const decimalPlaces = safeInteger(row.decimal_places, "decimal_places");
    const count = safeInteger(row.count, "count");
    const totalMinor = safeInteger(row.total_minor, "total_minor");
    if ((kind !== "expense" && kind !== "income" && kind !== "transfer") || decimalPlaces < 0 || decimalPlaces > 18 || count < 1 || totalMinor < 0) {
      throw new RavenTransportError("protocol");
    }
    return {
      currencyId: nonEmptyString(row.currency_id, "currency_id"), currencyCode: nonEmptyString(row.currency_code, "currency_code"),
      decimalPlaces, month, kind, count, totalMinor,
      categoryId: nullableString(row.category_id, "category_id"), categoryLabel: nonEmptyString(row.category_label, "category_label"),
    };
  });
}

export function buildTransactionAnalysis(buckets: readonly TransactionAnalysisBucket[], currencyId: string) {
  const rows = buckets.filter((row) => row.currencyId === currencyId);
  const months = new Map<string, { month: string; spending: number; income: number }>();
  const categories = new Map<string, { id: string; label: string; value: number }>();
  let count = 0, spending = 0, income = 0;
  for (const row of rows) {
    count = safeInteger(count + row.count, "transaction count");
    const point = months.get(row.month) ?? { month: row.month, spending: 0, income: 0 };
    if (row.kind === "expense") {
      spending = safeInteger(spending + row.totalMinor, "spending total");
      point.spending = safeInteger(point.spending + row.totalMinor, "monthly spending");
      const id = row.categoryId ?? "uncategorized";
      const category = categories.get(id) ?? { id, label: row.categoryLabel, value: 0 };
      category.value = safeInteger(category.value + row.totalMinor, "category spending");
      categories.set(id, category);
    } else if (row.kind === "income") {
      income = safeInteger(income + row.totalMinor, "income total");
      point.income = safeInteger(point.income + row.totalMinor, "monthly income");
    }
    months.set(row.month, point);
  }
  const ordered = [...months.keys()].sort();
  const points: Array<{ month: string; spending: number; income: number }> = [];
  if (ordered.length) {
    const monthIndex = (month: string) => Number(month.slice(0, 4)) * 12 + Number(month.slice(5)) - 1;
    for (let index = monthIndex(ordered[0]); index <= monthIndex(ordered[ordered.length - 1]); index++) {
      const month = `${Math.floor(index / 12).toString().padStart(4, "0")}-${(index % 12 + 1).toString().padStart(2, "0")}`;
      points.push(months.get(month) ?? { month, spending: 0, income: 0 });
    }
  }
  return { count, spending, income, months: points,
    averageMonthlySpending: points.length ? Math.round(spending / points.length) : 0,
    categories: [...categories.values()].filter((category) => category.value > 0).sort((a, b) => b.value - a.value),
  };
}
