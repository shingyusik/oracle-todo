import { afterEach, describe, expect, it, vi } from "vitest";

import {
  RavenApiError,
  RavenTransportError,
  requestJson,
} from "@/lib/raven-api";

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
      fields: { amount: "must be positive" },
      request_id: "00000000-0000-4000-8000-000000000001",
    }), 400)));

    const error = await requestJson("/api/v1/ledger/entries", { method: "POST" })
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(RavenApiError);
    expect(error).toMatchObject({
      code: "validation_error",
      fields: { amount: "must be positive" },
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
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("x-test")).toBe("yes");
    await expect(requestJson("https://evil.example/api/v1/dashboard"))
      .rejects.toMatchObject({ kind: "protocol" });
  });
});
