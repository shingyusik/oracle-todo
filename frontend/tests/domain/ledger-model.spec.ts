import { afterEach, describe, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";

import { ledgerApi } from "@/features/ledger/api/ledger-api";
import {
  mapCurrency,
  mapLedgerComparison,
  mapLedgerEntry,
  mapLedgerSummary,
  mapLedgerTrend,
  mapPage,
} from "@/features/ledger/model/ledger-model";

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

function transferInput(content: string) {
  return {
    date: "2026-07-31",
    writtenAt: "2026-07-31T01:00:00Z",
    content,
    fromAccount: "Wallet",
    toAccount: "Bank",
    amount: "1000",
    currency: "KRW",
  };
}

function transferResponse() {
  const outEntry = {
    entry: {
      ...entry,
      id: "out-1",
      content: "Move",
      transaction_category_id: null,
      entry_type: "transfer_out",
      transfer_group_id: "transfer-1",
    },
    account_name: "Wallet",
    category_name: null,
    currency_code: "KRW",
  };
  return {
    transfer_group_id: "transfer-1",
    out_entry: outEntry,
    in_entry: {
      ...outEntry,
      entry: {
        ...outEntry.entry,
        id: "in-1",
        account_id: "account-2",
        entry_type: "transfer_in",
      },
      account_name: "Bank",
    },
    amount_minor: 1000,
    currency_code: "KRW",
    from_account_name: "Wallet",
    to_account_name: "Bank",
  };
}

function stubCrypto() {
  let next = 0;
  const randomUUID = vi.fn(() =>
    `00000000-0000-4000-8000-${String(++next).padStart(12, "0")}`);
  vi.stubGlobal("crypto", { subtle: webcrypto.subtle, randomUUID });
  return randomUUID;
}

describe("Ledger wire boundary", () => {
  it("maps aligned comparison and trend ordinal dates", () => {
    const currencySummary = (
      currencyId: string,
      currencyCode: string,
      incomeMinor: number,
      expenseMinor: number,
      netChangeMinor: number,
      entryCount: number,
    ) => ({
      currency_id: currencyId,
      currency_code: currencyCode,
      income_minor: incomeMinor,
      expense_minor: expenseMinor,
      net_change_minor: netChangeMinor,
      entry_count: entryCount,
    });
    const summary = (start: number[], end: number[]) => ({
      range: { start, end },
      currencies: [],
    });

    const mappedComparison = mapLedgerComparison({
      current: summary([2026, 213], [2026, 243]),
      previous: summary([2026, 182], [2026, 212]),
      currencies: [{
        currency_id: "currency-usd",
        currency_code: "USD",
        current: currencySummary("currency-usd", "USD", 1000, 400, 600, 2),
        previous: currencySummary("currency-usd", "USD", 800, 500, 300, 3),
      }],
    });
    expect(mappedComparison.current.range).toEqual({ start: "2026-08-01", end: "2026-08-31" });
    expect(mappedComparison.currencies).toMatchObject([{
      currencyId: "currency-usd",
      currencyCode: "USD",
      current: { incomeMinor: 1000, expenseMinor: 400, entryCount: 2 },
      previous: { incomeMinor: 800, expenseMinor: 500, entryCount: 3 },
    }]);

    expect(mapLedgerTrend({
      range: { start: [2026, 213], end: [2026, 214] },
      granularity: "daily",
      currencies: [{ currency_id: "currency-usd", currency_code: "USD", points: [{
        start: [2026, 213], end: [2026, 213], income_minor: 100, expense_minor: 25,
      }] }],
    }).currencies[0]?.points[0]?.start).toBe("2026-08-01");
    expect(mapLedgerTrend({
      range: { start: [0, 1], end: [0, 1] },
      granularity: "daily",
      currencies: [],
    }).range.start).toBe("0000-01-01");
  });

  it("rejects invalid ordinal report dates", () => {
    expect(() => mapLedgerTrend({
      range: { start: [2026, 366], end: [2026, 366] },
      granularity: "daily",
      currencies: [],
    })).toThrow(/range.start/);
    expect(() => mapLedgerTrend({
      range: { start: [2026, 213], end: [2026, 213] },
      granularity: "daily",
      currencies: [{ currency_id: "currency-usd", currency_code: "USD", points: [{
        start: [2026, 213], end: [2026, 213],
        income_minor: Number.MAX_SAFE_INTEGER + 1, expense_minor: 0,
      }] }],
    })).toThrow(/income_minor/);
  });

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
    expect(() => mapLedgerEntry({ ...entry, amount: 0 })).toThrow(/amount/);
    expect(() => mapLedgerEntry({ ...entry, amount: -1 })).toThrow(/amount/);
  });

  it("rejects impossible unsigned and precision values but keeps signed totals", () => {
    expect(() => mapCurrency({
      id: "currency-1", code: "KRW", name: "Won", symbol: "₩",
      decimal_places: 19, active: true,
    })).toThrow(/decimal_places/);
    expect(() => mapPage({ items: [], next_offset: -1 }, mapLedgerEntry)).toThrow(/next_offset/);
    expect(() => mapLedgerSummary({
      range: { start: "2026-07-01", end: "2026-07-31" },
      currencies: [{
        currency_id: "currency-1", currency_code: "KRW",
        income_minor: 1, expense_minor: 1, net_change_minor: -2, entry_count: -1,
      }],
    })).toThrow(/entry_count/);
    expect(mapLedgerSummary({
      range: { start: "2026-07-01", end: "2026-07-31" },
      currencies: [{
        currency_id: "currency-1", currency_code: "KRW",
        income_minor: 1, expense_minor: 3, net_change_minor: -2, entry_count: 1,
      }],
    }).currencies[0]?.netChangeMinor).toBe(-2);
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

  it("reuses an internal operation key for equal retry values in a new object", async () => {
    const randomUUID = stubCrypto();
    const failed = vi.fn().mockRejectedValue(new TypeError("offline"));
    vi.stubGlobal("fetch", failed);

    await ledgerApi.createTransfer(transferInput("retry-equal")).catch(() => undefined);
    await ledgerApi.createTransfer(transferInput("retry-equal")).catch(() => undefined);

    expect(randomUUID).toHaveBeenCalledTimes(1);
    expect(failed.mock.calls.map(([, init]) => JSON.parse(String(init.body)).operation_key))
      .toEqual([
        "00000000-0000-4000-8000-000000000001",
        "00000000-0000-4000-8000-000000000001",
      ]);
  });

  it("shares an operation key across concurrent equal submissions", async () => {
    const randomUUID = stubCrypto();
    const failed = vi.fn().mockRejectedValue(new TypeError("offline"));
    vi.stubGlobal("fetch", failed);

    await Promise.allSettled([
      ledgerApi.createTransfer(transferInput("concurrent")),
      ledgerApi.createTransfer(transferInput("concurrent")),
    ]);

    expect(randomUUID).toHaveBeenCalledTimes(1);
    expect(failed.mock.calls.map(([, init]) => JSON.parse(String(init.body)).operation_key))
      .toEqual([
        "00000000-0000-4000-8000-000000000001",
        "00000000-0000-4000-8000-000000000001",
      ]);
  });

  it("clears a confirmed transfer so an intentional identical transfer gets a new key", async () => {
    const randomUUID = stubCrypto();
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(
      JSON.stringify(transferResponse()),
      { status: 201, headers: { "content-type": "application/json" } },
    )));
    vi.stubGlobal("fetch", fetchMock);

    await ledgerApi.createTransfer(transferInput("confirmed"));
    await ledgerApi.createTransfer(transferInput("confirmed"));

    expect(randomUUID).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init.body)).operation_key))
      .toEqual([
        "00000000-0000-4000-8000-000000000001",
        "00000000-0000-4000-8000-000000000002",
      ]);
  });

  it("uses different operation keys for different transfer payloads", async () => {
    const randomUUID = stubCrypto();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));

    await ledgerApi.createTransfer(transferInput("different-a")).catch(() => undefined);
    await ledgerApi.createTransfer(transferInput("different-b")).catch(() => undefined);

    expect(randomUUID).toHaveBeenCalledTimes(2);
  });

  it("updates a transfer without sending creation-only metadata", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify(transferResponse()),
      { headers: { "content-type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchMock);

    await ledgerApi.updateTransfer("transfer/1", {
      date: "2026-08-15",
      content: "Move more",
      fromAccount: "Bank",
      toAccount: "Wallet",
      amount: "2500",
      currency: "KRW",
      notes: null,
      reason: "correct transfer",
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/ledger/transfers/transfer%2F1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({
      date: "2026-08-15",
      content: "Move more",
      from_account: "Bank",
      to_account: "Wallet",
      amount: "2500",
      currency: "KRW",
      notes: null,
      reason: "correct transfer",
    });
  });

  it("bounds retained uncertain transfer keys with oldest-first eviction", async () => {
    const randomUUID = stubCrypto();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));

    for (let index = 0; index < 65; index += 1) {
      await ledgerApi.createTransfer(transferInput(`bounded-${index}`)).catch(() => undefined);
    }
    await ledgerApi.createTransfer(transferInput("bounded-0")).catch(() => undefined);

    expect(randomUUID).toHaveBeenCalledTimes(66);
  });
});
