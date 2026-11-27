import { afterEach, describe, expect, it, vi } from "vitest";

import {
  beginGoogleCalendarConnect,
  completeGoogleCalendarConnect,
  decodeGoogleCalendarCalendars,
  decodeGoogleCalendarPreview,
  decodeGoogleCalendarStatus,
  disconnectGoogleCalendar,
  fetchGoogleCalendarCalendars,
  fetchGoogleCalendarPreview,
  fetchGoogleCalendarStatus,
  isLoopbackHostname,
  runGoogleCalendarSync,
  selectGoogleCalendar,
  updateGoogleCalendarSettings,
} from "@/features/workbench/api/google-calendar";
import { RavenTransportError } from "@/lib/raven-api";

const counts = {
  google_created: 1,
  google_updated: 2,
  google_deleted: 0,
  raven_created: 3,
  raven_updated: 0,
  raven_archived: 0,
  conflicts: 1,
  skipped_recurring: 4,
  skipped_terminal: 0,
  failed: 0,
};

const status = {
  configured: true,
  connection: "connected",
  scopes: ["https://www.googleapis.com/auth/calendar.events"],
  calendar: { id: "cal-1", summary: "Raven", time_zone: "Asia/Seoul", primary: false },
  settings: {
    enabled: true,
    calendar_id: "cal-1",
    calendar_summary: "Raven",
    time_zone: "Asia/Seoul",
    poll_interval_secs: 120,
    default_duration_minutes: 60,
    sync_note: true,
    push_since: null,
  },
  env_override: null,
  schedule: { scheduler_active: true, next_run_at: "2026-11-20T03:02:00Z" },
  first_sync_pending: false,
  last_sync: {
    run_id: "run-1",
    trigger: "scheduled",
    started_at: "2026-11-20T03:00:00Z",
    finished_at: "2026-11-20T03:00:02Z",
    outcome: "ok",
    counts,
    error_kind: null,
  },
  links: { total: 12, error: 1 },
};

function json(body: unknown, statusCode = 200): Response {
  return new Response(JSON.stringify(body), {
    status: statusCode,
    headers: { "content-type": "application/json" },
  });
}

function serve(body: unknown) {
  const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
    Promise.resolve(json(body)));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function lastCall(fetchMock: ReturnType<typeof serve>) {
  const [input, init] = fetchMock.mock.calls.at(-1)!;
  return {
    url: String(input),
    method: init?.method ?? "GET",
    headers: new Headers(init?.headers),
    body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Google Calendar API decoders", () => {
  it("decodes the status response", () => {
    expect(decodeGoogleCalendarStatus(status)).toEqual({
      configured: true,
      connection: "connected",
      scopes: ["https://www.googleapis.com/auth/calendar.events"],
      calendar: { id: "cal-1", summary: "Raven", timeZone: "Asia/Seoul", primary: false },
      settings: {
        enabled: true,
        pollIntervalSecs: 120,
        defaultDurationMinutes: 60,
        syncNote: true,
      },
      envOverride: null,
      schedule: { schedulerActive: true, nextRunAt: "2026-11-20T03:02:00Z" },
      firstSyncPending: false,
      lastSync: {
        runId: "run-1",
        trigger: "scheduled",
        startedAt: "2026-11-20T03:00:00Z",
        finishedAt: "2026-11-20T03:00:02Z",
        outcome: "ok",
        counts: {
          googleCreated: 1,
          googleUpdated: 2,
          googleDeleted: 0,
          ravenCreated: 3,
          ravenUpdated: 0,
          ravenArchived: 0,
          conflicts: 1,
          skippedRecurring: 4,
          skippedTerminal: 0,
          failed: 0,
        },
        errorKind: null,
      },
      links: { total: 12, error: 1 },
    });
  });

  it("decodes an unconfigured status with null calendar and no last sync", () => {
    const decoded = decodeGoogleCalendarStatus({
      ...status,
      configured: false,
      connection: "disconnected",
      scopes: [],
      calendar: null,
      env_override: "disabled",
      schedule: { scheduler_active: false, next_run_at: null },
      last_sync: null,
    });
    expect(decoded.configured).toBe(false);
    expect(decoded.calendar).toBeNull();
    expect(decoded.envOverride).toBe("disabled");
    expect(decoded.lastSync).toBeNull();
  });

  it.each([
    ["unknown connection", { ...status, connection: "pending" }],
    ["unknown env override", { ...status, env_override: "on" }],
    ["negative count", {
      ...status,
      last_sync: { ...status.last_sync, counts: { ...counts, failed: -1 } },
    }],
    ["missing settings", { ...status, settings: undefined }],
  ])("rejects %s", (_label, body) => {
    expect(() => decodeGoogleCalendarStatus(body)).toThrow(RavenTransportError);
  });

  it("decodes calendars from an object or a bare list", () => {
    const entry = {
      id: "primary@example.test",
      summary: "Personal",
      primary: true,
      access_role: "owner",
      time_zone: "Asia/Seoul",
    };
    const expected = [{
      id: "primary@example.test",
      summary: "Personal",
      primary: true,
      accessRole: "owner",
      timeZone: "Asia/Seoul",
    }];
    expect(decodeGoogleCalendarCalendars({ calendars: [entry] })).toEqual(expected);
    expect(decodeGoogleCalendarCalendars([entry])).toEqual(expected);
  });

  it("decodes preview counts", () => {
    expect(decodeGoogleCalendarPreview({ counts }).counts.ravenCreated).toBe(3);
    expect(decodeGoogleCalendarPreview({ last_sync: status.last_sync }).counts.googleUpdated)
      .toBe(2);
  });

  it("recognizes loopback hostnames", () => {
    expect(isLoopbackHostname("127.0.0.1")).toBe(true);
    expect(isLoopbackHostname("localhost")).toBe(true);
    expect(isLoopbackHostname("[::1]")).toBe(true);
    expect(isLoopbackHostname("raven.example.com")).toBe(false);
    expect(isLoopbackHostname("192.168.0.10")).toBe(false);
  });
});

describe("Google Calendar API calls", () => {
  const base = "/api/v1/integrations/google-calendar";

  it("reads status, calendars, and preview with GET", async () => {
    let fetchMock = serve(status);
    await fetchGoogleCalendarStatus();
    expect(lastCall(fetchMock)).toMatchObject({ url: base, method: "GET" });

    fetchMock = serve({ calendars: [] });
    await fetchGoogleCalendarCalendars();
    expect(lastCall(fetchMock)).toMatchObject({ url: `${base}/calendars`, method: "GET" });

    fetchMock = serve({ counts });
    await fetchGoogleCalendarPreview();
    expect(lastCall(fetchMock)).toMatchObject({ url: `${base}/preview`, method: "GET" });
  });

  it("sends the integration header and JSON bodies on every write", async () => {
    const cases: Array<[() => Promise<unknown>, unknown, string, string, unknown]> = [
      [
        () => updateGoogleCalendarSettings({
          enabled: false,
          syncNote: true,
          pollIntervalSecs: 300,
          defaultDurationMinutes: 30,
        }),
        status,
        base,
        "PUT",
        {
          enabled: false,
          sync_note: true,
          poll_interval_secs: 300,
          default_duration_minutes: 30,
        },
      ],
      [() => selectGoogleCalendar({ select: "cal-2" }), status, `${base}/calendar`, "POST", { select: "cal-2" }],
      [
        () => selectGoogleCalendar({ create: "Raven" }),
        status,
        `${base}/calendar`,
        "POST",
        { create: { summary: "Raven" } },
      ],
      [
        () => runGoogleCalendarSync({ allowMassDelete: true }),
        { last_sync: status.last_sync },
        `${base}/sync`,
        "POST",
        { dry_run: false, allow_mass_delete: true },
      ],
      [
        () => disconnectGoogleCalendar({ forgetLinks: true }),
        status,
        `${base}/disconnect`,
        "POST",
        { forget_links: true },
      ],
      [
        () => beginGoogleCalendarConnect(),
        {
          authorization_url: "https://accounts.google.com/o/oauth2/v2/auth?x=1",
          expires_at: "2026-11-20T03:10:00Z",
        },
        `${base}/connect`,
        "POST",
        {},
      ],
      [
        () => completeGoogleCalendarConnect("http://127.0.0.1:3001/cb?state=s&code=c"),
        status,
        `${base}/connect/complete`,
        "POST",
        { redirect_url: "http://127.0.0.1:3001/cb?state=s&code=c" },
      ],
    ];
    for (const [call, response, url, method, body] of cases) {
      const fetchMock = serve(response);
      await call();
      const request = lastCall(fetchMock);
      expect(request).toMatchObject({ url, method, body });
      expect(request.headers.get("X-Raven-Integration")).toBe("1");
      expect(request.headers.get("content-type")).toBe("application/json");
    }
  });

  it("returns the last sync from a sync response", async () => {
    serve({ last_sync: status.last_sync });
    await expect(runGoogleCalendarSync({ allowMassDelete: false }))
      .resolves.toMatchObject({ lastSync: { outcome: "ok" } });
  });

  it("rejects a non-HTTPS authorization URL", async () => {
    serve({ authorization_url: "javascript:alert(1)", expires_at: "2026-11-20T03:10:00Z" });
    await expect(beginGoogleCalendarConnect()).rejects.toBeInstanceOf(RavenTransportError);
  });
});
