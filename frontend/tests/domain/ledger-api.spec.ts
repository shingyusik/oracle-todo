import { afterEach, describe, expect, it, vi } from "vitest";

import { ledgerApi } from "@/features/ledger/api/ledger-api";
import { defaultLedgerTableSettings } from "@/features/ledger/model/ledger-table-views";

afterEach(() => vi.unstubAllGlobals());

const comparison = {
  current: { range: { start: [2026, 213], end: [2026, 243] }, currencies: [] },
  previous: { range: { start: [2026, 182], end: [2026, 212] }, currencies: [] },
  currencies: [],
};
const trend = {
  range: { start: [2026, 213], end: [2026, 214] },
  granularity: "daily",
  currencies: [],
};

describe("ledger report API", () => {
  it("uses preset or custom comparison query contracts and automatic trends", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(comparison))
      .mockResolvedValueOnce(response(comparison))
      .mockResolvedValueOnce(response(trend));
    vi.stubGlobal("fetch", fetchMock);

    await ledgerApi.compare({ period: "current_month" });
    await ledgerApi.compare({ period: "custom", from: "2026-08-01", to: "2026-08-31" });
    await ledgerApi.trend({ from: "2026-08-01", to: "2026-08-31" });

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/v1/ledger/reports/compare?period=current_month",
      "/api/v1/ledger/reports/compare?period=custom&from=2026-08-01&to=2026-08-31",
      "/api/v1/ledger/reports/trend?from=2026-08-01&to=2026-08-31&granularity=auto",
    ]);
  });
});

describe("ledger table API", () => {
  it("posts one strict server-side table page and parses occurrence rows", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({
      items: [{
        key: "0:entry-1",
        group_key: null,
        group_label: null,
        record: transactionRecord,
      }],
      next_offset: 50,
    }));
    vi.stubGlobal("fetch", fetchMock);
    const settings = defaultLedgerTableSettings("ledger.transactions");
    settings.filterRules = [{
      id: "content",
      field: "content",
      type: "text",
      operator: "contains",
      value: "Lunch",
    }];

    const page = await ledgerApi.queryTable(
      "ledger.transactions",
      settings,
      0,
      new Date(2026, 7, 21),
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/ledger/table/query",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          scope: "ledger.transactions",
          offset: 0,
          limit: 50,
          filter_mode: "and",
          filters: [{ field: "content", operator: "contains", value: { text: "Lunch" } }],
          sorts: [{ field: "date", direction: "desc" }],
          group_by: "none",
          group_settings: {
            sort: "manual",
            hide_empty: true,
            manual_order: [],
            hidden_group_keys: [],
          },
          context: { reference_date: "2026-08-21" },
        }),
      }),
    );
    expect(page.nextOffset).toBe(50);
    expect(page.items[0]).toMatchObject({
      key: "0:entry-1",
      groupKey: null,
      groupLabel: null,
      scope: "ledger.transactions",
      record: { id: "entry-1", content: "Lunch" },
    });
  });

  it("uses compact scope lookups instead of draining legacy lists", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({
      accounts: [{ id: "account-cash", label: "Cash" }],
      categories: [{ id: "category-food", label: "Food" }],
      currencies: [{ id: "currency-krw", label: "KRW" }],
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(ledgerApi.tableLookups("ledger.transactions")).resolves.toEqual({
      accounts: [{ id: "account-cash", label: "Cash" }],
      categories: [{ id: "category-food", label: "Food" }],
      currencies: [{ id: "currency-krw", label: "KRW" }],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/ledger/table/lookups?scope=ledger.transactions",
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });
});

const transactionRecord = {
  id: "entry-1",
  archive_entry_id: "entry-1",
  detail_entry: {
    entry: {
      id: "entry-1",
      date: "2026-08-21",
      written_at: "2026-08-21T00:00:00Z",
      content: "Lunch",
      transaction_category_id: "category-food",
      account_id: "account-cash",
      entry_type: "expense",
      amount: 12000,
      currency_id: "currency-krw",
      transfer_group_id: null,
      source: "ui",
      notes: null,
      created_at: "2026-08-21T00:00:00Z",
      updated_at: "2026-08-21T00:00:00Z",
      deleted_at: null,
    },
    account_name: "Cash",
    category_name: "Food",
    currency_code: "KRW",
  },
  transfer_entry: null,
  kind: "expense",
  date: "2026-08-21",
  content: "Lunch",
  account_ids: ["account-cash"],
  account_labels: ["Cash"],
  account_label: "Cash",
  category_id: "category-food",
  category_label: "Food",
  amount_minor: 12000,
  currency_id: "currency-krw",
  currency_code: "KRW",
  decimal_places: 0,
  updated_at: "2026-08-21T00:00:00Z",
};

function response(body: unknown) {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
}
