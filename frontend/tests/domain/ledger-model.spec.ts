import { afterEach, describe, expect, it, vi } from "vitest";

import { ledgerApi } from "@/features/ledger/api/ledger-api";
import { mapLedgerEntry, mapLedgerSummary } from "@/features/ledger/model/ledger-model";

afterEach(() => vi.unstubAllGlobals());

const entry = {
  id: "entry-1",
  date: "2026-07-31",
  written_at: "2026-07-31T01:00:00Z",
  content: "Lunch",
  transaction_category_id: "category-1",
  account_id: "account-1",
  entry_type: "expense",
  amount: 12000,
  currency_id: "currency-1",
  transfer_group_id: null,
  source: "api",
  notes: null,
  created_at: "2026-07-31T01:00:00Z",
  updated_at: "2026-07-31T01:00:00Z",
  deleted_at: null,
};

describe("Ledger wire boundary", () => {
  it("maps exact minor-unit entry and report fields", () => {
    expect(mapLedgerEntry(entry)).toMatchObject({
      writtenAt: "2026-07-31T01:00:00Z",
      entryType: "expense",
      amountMinor: 12000,
      currencyId: "currency-1",
    });
    expect(mapLedgerSummary({
      range: { start: "2026-07-01", end: "2026-07-31" },
      currencies: [{
        currency_id: "currency-1",
        currency_code: "KRW",
        income_minor: 50000,
        expense_minor: 12000,
        net_change_minor: 38000,
        entry_count: 2,
      }],
    }).currencies[0]).toEqual({
      currencyId: "currency-1",
      currencyCode: "KRW",
      incomeMinor: 50000,
      expenseMinor: 12000,
      netChangeMinor: 38000,
      entryCount: 2,
    });
  });

  it("rejects unsafe integer money at the boundary", () => {
    expect(() => mapLedgerEntry({ ...entry, amount: Number.MAX_SAFE_INTEGER + 1 }))
      .toThrow(/amount/);
  });

  it("builds encoded queries while preserving false and zero", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      items: [], next_offset: null,
    }), { headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await ledgerApi.listEntries({ offset: 0, includeArchived: false, content: "a&b" });

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("/api/v1/ledger/entries?offset=0&include_archived=false&content=a%26b");
  });
});
