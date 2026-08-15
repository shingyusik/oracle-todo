import { afterEach, describe, expect, it, vi } from "vitest";

import { ledgerApi } from "@/features/ledger/api/ledger-api";

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

function response(body: unknown) {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
}
