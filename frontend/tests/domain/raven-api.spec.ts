import { afterEach, describe, expect, it, vi } from "vitest";

import {
  RavenApiError,
  RavenTransportError,
  isoDate,
  jsonRequest,
  requestJson,
  timestamp,
} from "@/lib/raven-api";
import { healthApi } from "@/features/health/api/health-api";
import { defaultHealthTableSettings } from "@/features/health/model/health-table-views";

afterEach(() => vi.unstubAllGlobals());

function response(body: string | null, status = 200, contentType = "application/json") {
  return new Response(body, {
    status,
    headers: contentType ? { "content-type": contentType } : {},
  });
}

describe("Raven API transport", () => {
  it("preserves a valid Raven error envelope and status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(JSON.stringify({
      code: "validation_error",
      message: "invalid amount",
      fields: { amount: ["invalid"] },
      request_id: "00000000-0000-4000-8000-000000000001",
    }), 400)));

    const error = await requestJson("/api/v1/ledger/entries", { method: "POST" })
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(RavenApiError);
    expect(error).toMatchObject({
      code: "validation_error",
      fields: { amount: ["invalid"] },
      requestId: "00000000-0000-4000-8000-000000000001",
      status: 400,
    });
  });

  it("does not expose malformed or non-JSON response bodies", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      response("<html>secret token</html>", 500, "text/html"),
    ));

    const error = await requestJson("/api/v1/dashboard").catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(RavenTransportError);
    expect(error).toMatchObject({ kind: "protocol", status: 500 });
    expect(String(error)).not.toContain("secret token");
  });

  it("classifies malformed JSON and malformed envelopes without reflecting bodies", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(response("{secret", 500))
      .mockResolvedValueOnce(response(JSON.stringify({ message: "private" }), 400)));

    await expect(requestJson("/api/v1/dashboard")).rejects.toMatchObject({
      kind: "protocol",
      status: 500,
    });
    const error = await requestJson("/api/v1/dashboard").catch((cause: unknown) => cause);
    expect(error).toMatchObject({ kind: "protocol", status: 400 });
    expect(String(error)).not.toContain("private");
  });

  it("handles empty success and classifies network failure without JSON parser errors", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(response(null, 204, ""))
      .mockResolvedValueOnce(response("", 200, ""))
      .mockRejectedValueOnce(new TypeError("network details")));

    await expect(requestJson("/api/v1/health/events/id/purge", {
      method: "DELETE",
    })).resolves.toBeUndefined();
    await expect(requestJson("/api/v1/dashboard")).resolves.toBeUndefined();
    await expect(requestJson("/api/v1/dashboard")).rejects.toMatchObject({
      kind: "network",
      status: undefined,
    });
  });

  it("preserves AbortError and enforces relative same-origin JSON defaults", async () => {
    const abort = new DOMException("cancelled", "AbortError");
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(abort)
      .mockResolvedValueOnce(response("{}"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestJson("/api/v1/dashboard")).rejects.toBe(abort);
    await requestJson("/api/v1/ledger/entries", {
      method: "POST",
      body: "{}",
      headers: { "x-test": "yes" },
      credentials: "omit",
    });

    const [, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(init.credentials).toBe("same-origin");
    expect(headers.get("accept")).toBe("application/json");
    expect(headers.get("content-type")).toBeNull();
    expect(headers.get("x-test")).toBe("yes");
    await expect(requestJson("https://evil.example/api/v1/dashboard"))
      .rejects.toMatchObject({ kind: "protocol" });
  });

  it("sets JSON content type only through the JSON body helper", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(response("{}")));
    vi.stubGlobal("fetch", fetchMock);

    await requestJson("/api/v1/dashboard", { method: "POST", body: "plain text" });
    await requestJson("/api/v1/dashboard", jsonRequest("POST", { enabled: false }));

    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("content-type")).toBeNull();
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get("content-type"))
      .toBe("application/json");
    expect(() => jsonRequest("POST", "plain text" as never)).toThrow(/JSON body/);
    expect(() => jsonRequest("POST", new Blob() as never)).toThrow(/JSON body/);
  });

  it("rejects calendar normalization while accepting nanosecond RFC3339", () => {
    expect(() => isoDate("2026-02-31", "date")).toThrow();
    expect(isoDate("2024-02-29", "date")).toBe("2024-02-29");
    expect(() => isoDate("2025-02-29", "date")).toThrow();
    expect(timestamp("2026-07-31T01:02:03.123456789+09:00", "time"))
      .toBe("2026-07-31T01:02:03.123456789+09:00");
    expect(() => timestamp("2026-02-31T01:00:00Z", "time")).toThrow();
    expect(() => timestamp("2026-07-31T24:00:00Z", "time")).toThrow();
    expect(() => timestamp("2026-07-31T01:00:00+24:00", "time")).toThrow();
  });

  it("treats empty decoded success as a protocol error", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(response(null, 204, ""))
      .mockResolvedValueOnce(response("", 200, "")));
    const decode = (value: unknown) => ({ value });

    await expect(requestJson("/api/v1/dashboard", undefined, decode))
      .rejects.toMatchObject({ kind: "protocol", status: 204 });
    await expect(requestJson("/api/v1/dashboard", undefined, decode))
      .rejects.toMatchObject({ kind: "protocol", status: 200 });
  });
});

describe("Health table API", () => {
  it("posts one bounded page with saved table settings and a local reference date", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(JSON.stringify({
      items: [], next_offset: null,
    })));
    vi.stubGlobal("fetch", fetchMock);
    const settings = defaultHealthTableSettings("health.diet");
    settings.filterMode = "or";
    settings.filterRules = [{
      id: "tag", field: "tags", type: "multiSelect", operator: "is", value: ["a/b", "x y"],
    }];
    settings.sortRules = [{ id: "food", field: "food", direction: "asc" }];
    settings.groupSettings = {
      ...settings.groupSettings,
      groupBy: "tag",
      sort: "manual",
      manualOrder: ["a/b"],
      hiddenGroupKeys: ["x y"],
    };

    await healthApi.queryTable(
      "health.diet",
      settings,
      0,
      { getFullYear: () => 2026, getMonth: () => 7, getDate: () => 21 },
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/health/table/query");
    expect(JSON.parse(String(init.body))).toEqual({
      scope: "health.diet",
      offset: 0,
      limit: 50,
      filter_mode: "or",
      filters: [{ field: "tags", operator: "is", value: { list: ["a/b", "x y"] } }],
      sorts: [{ field: "food", direction: "asc" }],
      group_by: "tag",
      group_settings: {
        sort: "manual",
        hide_empty: true,
        manual_order: ["a/b"],
        hidden_group_keys: ["x y"],
      },
      context: { reference_date: "2026-08-21" },
    });
  });

  it("parses discriminated rows for every Health scope and compact escaped lookups", async () => {
    const baseEvent = {
      id: "00000000-0000-4000-8000-000000000002",
      occurred_at: "2026-08-21T01:00:00Z",
      category: "bowel",
      metric_key: "bowel",
      name: "Bowel",
      value_num: 4,
      unit: null,
      note: null,
      attributes: { bristol_scale: 4, blood_visible: false },
      created_at: "2026-08-21T01:00:00Z",
      updated_at: "2026-08-21T01:00:00Z",
      deleted_at: null,
    };
    const dietEntry = {
      id: "00000000-0000-4000-8000-000000000001",
      occurred_at: "2026-08-21T01:00:00Z",
      meal_type: "lunch",
      food_name: "Rice",
      note: null,
      tags: ["a/b"],
      media_id: null,
      created_at: "2026-08-21T01:00:00Z",
      updated_at: "2026-08-21T01:00:00Z",
      deleted_at: null,
    };
    const records = [
      { kind: "diet", id: dietEntry.id, entry: dietEntry, date: "2026-08-21", meal_label: "Lunch", food: "Rice", tags: ["a/b"], has_photo: false, note: "" },
      { kind: "bowel", id: baseEvent.id, event: baseEvent, date: "2026-08-21", bristol_scale: 4, blood_visible: false, blood_label: "No", note: "" },
      { kind: "medication", id: baseEvent.id, event: { ...baseEvent, category: "medication", metric_key: "medication", name: "A", value_num: 2, unit: "mg", attributes: { medication_name: "A", dose: 2, unit: "mg" } }, date: "2026-08-21", medication_name: "A", dose: 2, unit: "mg", unit_label: "mg", note: "" },
      { kind: "metrics", id: "2026-08-21", date: "2026-08-21", events: [], weight: 70, sleep: null, crp: null, calprotectin: null, condition: 8, note: "", created_at: "2026-08-21T01:00:00Z", updated_at: "2026-08-21T01:00:00Z" },
    ];
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(response(JSON.stringify({ items: [{ key: "7:a/b:id", group_key: "a/b", group_label: "a/b", record: records[0] }], next_offset: 50 }))))
      .mockImplementationOnce(() => Promise.resolve(response(JSON.stringify({ items: [{ key: "0::id", group_key: null, group_label: null, record: records[1] }], next_offset: null }))))
      .mockImplementationOnce(() => Promise.resolve(response(JSON.stringify({ items: [{ key: "0::id", group_key: null, group_label: null, record: records[2] }], next_offset: null }))))
      .mockImplementationOnce(() => Promise.resolve(response(JSON.stringify({ items: [{ key: "0::date", group_key: null, group_label: null, record: records[3] }], next_offset: null }))))
      .mockImplementationOnce(() => Promise.resolve(response(JSON.stringify({ tags: [{ id: "a/b?c#d", label: "a/b?c#d" }] }))));
    vi.stubGlobal("fetch", fetchMock);

    const scopes = ["health.diet", "health.bowel", "health.medication", "health.metrics"] as const;
    const pages = await Promise.all(scopes.map((scope) =>
      healthApi.queryTable(scope, defaultHealthTableSettings(scope))));
    expect(fetchMock.mock.calls.slice(0, 4).map(([, init]) => {
      const body = JSON.parse(String((init as RequestInit).body));
      return { ...body, context: { reference_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) } };
    })).toEqual(scopes.map((scope) => ({
      scope,
      offset: 0,
      limit: 50,
      filter_mode: "and",
      filters: [],
      sorts: [{ field: "date", direction: "desc" }],
      group_by: "none",
      group_settings: {
        sort: "manual", hide_empty: true, manual_order: [], hidden_group_keys: [],
      },
      context: { reference_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) },
    })));
    expect(pages.map((page) => page.items[0]?.scope)).toEqual(scopes);
    expect(pages[0]).toMatchObject({
      items: [{ key: "7:a/b:id", groupKey: "a/b", groupLabel: "a/b", record: { kind: "diet", food: "Rice" } }],
      nextOffset: 50,
    });
    await expect(healthApi.tableLookups("health.diet")).resolves.toEqual({
      tags: [{ id: "a/b?c#d", label: "a/b?c#d" }],
    });
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe(
      "/api/v1/health/table/lookups?scope=health.diet",
    );
  });
});
