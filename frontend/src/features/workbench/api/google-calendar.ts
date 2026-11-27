import {
  array,
  boolean,
  id,
  jsonRequest,
  nonEmptyString,
  nullableString,
  nullableTimestamp,
  RavenTransportError,
  record,
  requestJson,
  safeInteger,
  string,
  timestamp,
  type JsonObject,
} from "@/lib/raven-api";

export type GoogleCalendarConnection = "disconnected" | "connected" | "reauth_required";

export type GoogleCalendarCounts = {
  googleCreated: number;
  googleUpdated: number;
  googleDeleted: number;
  ravenCreated: number;
  ravenUpdated: number;
  ravenArchived: number;
  conflicts: number;
  skippedRecurring: number;
  skippedTerminal: number;
  failed: number;
};

export type GoogleCalendarCountKey = keyof GoogleCalendarCounts;

export type GoogleCalendarSettings = {
  enabled: boolean;
  pollIntervalSecs: number;
  defaultDurationMinutes: number;
  syncNote: boolean;
};

export type GoogleCalendarRef = {
  id: string;
  summary: string;
  timeZone: string | null;
  primary: boolean;
};

export type GoogleCalendarSyncRun = {
  runId: string;
  trigger: string;
  startedAt: string;
  finishedAt: string | null;
  outcome: string;
  counts: GoogleCalendarCounts;
  errorKind: string | null;
};

export type GoogleCalendarStatus = {
  configured: boolean;
  connection: GoogleCalendarConnection;
  scopes: string[];
  calendar: GoogleCalendarRef | null;
  settings: GoogleCalendarSettings;
  envOverride: "disabled" | null;
  schedule: { schedulerActive: boolean; nextRunAt: string | null };
  firstSyncPending: boolean;
  lastSync: GoogleCalendarSyncRun | null;
  links: { total: number; error: number };
};

export type GoogleCalendarListEntry = {
  id: string;
  summary: string;
  primary: boolean;
  accessRole: string;
  timeZone: string | null;
};

export type GoogleCalendarPreview = { counts: GoogleCalendarCounts };

export type GoogleCalendarSyncResult = { lastSync: GoogleCalendarSyncRun | null };

export type GoogleCalendarConnectStart = { authorizationUrl: string; expiresAt: string };

export type GoogleCalendarChoice = { select: string } | { create: string };

export const googleCalendarPollMinSecs = 60;
export const googleCalendarPollMaxSecs = 3600;
export const googleCalendarDurationMinMinutes = 1;
export const googleCalendarDurationMaxMinutes = 1440;
export const googleCalendarDefaultSummary = "Raven";

export const googleCalendarPath = "/api/v1/integrations/google-calendar";

const countFields: ReadonlyArray<readonly [GoogleCalendarCountKey, string]> = [
  ["googleCreated", "google_created"],
  ["googleUpdated", "google_updated"],
  ["googleDeleted", "google_deleted"],
  ["ravenCreated", "raven_created"],
  ["ravenUpdated", "raven_updated"],
  ["ravenArchived", "raven_archived"],
  ["conflicts", "conflicts"],
  ["skippedRecurring", "skipped_recurring"],
  ["skippedTerminal", "skipped_terminal"],
  ["failed", "failed"],
];

export function decodeGoogleCalendarStatus(value: unknown): GoogleCalendarStatus {
  const body = record(value, "google_calendar");
  const settings = record(body.settings, "settings");
  const schedule = record(body.schedule, "schedule");
  const links = record(body.links ?? { total: 0, error: 0 }, "links");
  const connection = body.connection;
  if (connection !== "disconnected" && connection !== "connected" && connection !== "reauth_required") {
    throw new RavenTransportError("protocol");
  }
  const envOverride = body.env_override ?? null;
  if (envOverride !== null && envOverride !== "disabled") {
    throw new RavenTransportError("protocol");
  }
  const calendar = body.calendar ?? null;
  return {
    configured: boolean(body.configured, "configured"),
    connection,
    scopes: array(body.scopes ?? [], "scopes").map((scope, index) =>
      string(scope, `scopes.${index}`)),
    calendar: calendar === null ? null : decodeCalendarRef(calendar),
    settings: {
      enabled: boolean(settings.enabled, "settings.enabled"),
      pollIntervalSecs: count(settings.poll_interval_secs, "settings.poll_interval_secs"),
      defaultDurationMinutes: count(
        settings.default_duration_minutes,
        "settings.default_duration_minutes",
      ),
      syncNote: boolean(settings.sync_note, "settings.sync_note"),
    },
    envOverride,
    schedule: {
      schedulerActive: boolean(schedule.scheduler_active, "schedule.scheduler_active"),
      nextRunAt: nullableTimestamp(schedule.next_run_at ?? null, "schedule.next_run_at"),
    },
    firstSyncPending: boolean(body.first_sync_pending ?? false, "first_sync_pending"),
    lastSync: decodeRun(body.last_sync ?? null),
    links: {
      total: count(links.total ?? 0, "links.total"),
      error: count(links.error ?? 0, "links.error"),
    },
  };
}

export function decodeGoogleCalendarCalendars(value: unknown): GoogleCalendarListEntry[] {
  const list = Array.isArray(value)
    ? value
    : array(record(value, "calendars").calendars, "calendars");
  return list.map((item, index) => {
    const field = `calendars.${index}`;
    const entry = record(item, field);
    return {
      id: nonEmptyString(entry.id, `${field}.id`),
      summary: string(entry.summary ?? "", `${field}.summary`),
      primary: boolean(entry.primary ?? false, `${field}.primary`),
      accessRole: string(entry.access_role ?? "", `${field}.access_role`),
      timeZone: nullableString(entry.time_zone ?? null, `${field}.time_zone`),
    };
  });
}

export function decodeGoogleCalendarPreview(value: unknown): GoogleCalendarPreview {
  const body = record(value, "preview");
  if (body.counts !== undefined) return { counts: decodeCounts(body.counts, "counts") };
  const run = record(body.last_sync, "last_sync");
  return { counts: decodeCounts(run.counts, "last_sync.counts") };
}

export function decodeGoogleCalendarSyncResult(value: unknown): GoogleCalendarSyncResult {
  const body = record(value, "sync");
  return { lastSync: decodeRun(body.last_sync ?? null) };
}

export function decodeGoogleCalendarConnectStart(value: unknown): GoogleCalendarConnectStart {
  const body = record(value, "connect");
  const authorizationUrl = nonEmptyString(body.authorization_url, "authorization_url");
  let parsed: URL;
  try {
    parsed = new URL(authorizationUrl);
  } catch {
    throw new RavenTransportError("protocol");
  }
  if (parsed.protocol !== "https:") throw new RavenTransportError("protocol");
  return { authorizationUrl, expiresAt: timestamp(body.expires_at, "expires_at") };
}

export function fetchGoogleCalendarStatus(signal?: AbortSignal): Promise<GoogleCalendarStatus> {
  return requestJson(googleCalendarPath, { signal }, decodeGoogleCalendarStatus);
}

export function updateGoogleCalendarSettings(
  settings: GoogleCalendarSettings,
): Promise<GoogleCalendarStatus> {
  return requestJson(
    googleCalendarPath,
    integrationRequest("PUT", {
      enabled: settings.enabled,
      sync_note: settings.syncNote,
      poll_interval_secs: settings.pollIntervalSecs,
      default_duration_minutes: settings.defaultDurationMinutes,
    }),
    decodeGoogleCalendarStatus,
  );
}

export function fetchGoogleCalendarCalendars(): Promise<GoogleCalendarListEntry[]> {
  return requestJson(`${googleCalendarPath}/calendars`, undefined, decodeGoogleCalendarCalendars);
}

export async function selectGoogleCalendar(choice: GoogleCalendarChoice): Promise<void> {
  await requestJson(
    `${googleCalendarPath}/calendar`,
    integrationRequest("POST", "select" in choice
      ? { select: choice.select }
      : { create: { summary: choice.create } }),
  );
}

export function fetchGoogleCalendarPreview(): Promise<GoogleCalendarPreview> {
  return requestJson(`${googleCalendarPath}/preview`, undefined, decodeGoogleCalendarPreview);
}

export function runGoogleCalendarSync(
  options: { allowMassDelete: boolean },
): Promise<GoogleCalendarSyncResult> {
  return requestJson(
    `${googleCalendarPath}/sync`,
    integrationRequest("POST", { dry_run: false, allow_mass_delete: options.allowMassDelete }),
    decodeGoogleCalendarSyncResult,
  );
}

export async function disconnectGoogleCalendar(
  options: { forgetLinks: boolean },
): Promise<void> {
  await requestJson(
    `${googleCalendarPath}/disconnect`,
    integrationRequest("POST", { forget_links: options.forgetLinks }),
  );
}

export function beginGoogleCalendarConnect(): Promise<GoogleCalendarConnectStart> {
  return requestJson(
    `${googleCalendarPath}/connect`,
    integrationRequest("POST", {}),
    decodeGoogleCalendarConnectStart,
  );
}

export async function completeGoogleCalendarConnect(redirectUrl: string): Promise<void> {
  await requestJson(
    `${googleCalendarPath}/connect/complete`,
    integrationRequest("POST", { redirect_url: redirectUrl }),
  );
}

/** The OAuth redirect URI is loopback-only, so connecting completes automatically only there. */
export function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "localhost" ||
    host === "[::1]" ||
    host === "::1" ||
    /^127(\.\d{1,3}){3}$/.test(host);
}

function integrationRequest(method: string, body: JsonObject): RequestInit {
  const init = jsonRequest(method, body);
  const headers = new Headers(init.headers);
  headers.set("X-Raven-Integration", "1");
  return { ...init, headers };
}

function decodeCalendarRef(value: unknown): GoogleCalendarRef {
  const calendar = record(value, "calendar");
  return {
    id: nonEmptyString(calendar.id, "calendar.id"),
    summary: string(calendar.summary ?? "", "calendar.summary"),
    timeZone: nullableString(calendar.time_zone ?? null, "calendar.time_zone"),
    primary: boolean(calendar.primary ?? false, "calendar.primary"),
  };
}

function decodeRun(value: unknown): GoogleCalendarSyncRun | null {
  if (value === null) return null;
  const run = record(value, "last_sync");
  return {
    runId: id(run.run_id, "last_sync.run_id"),
    trigger: nonEmptyString(run.trigger, "last_sync.trigger"),
    startedAt: timestamp(run.started_at, "last_sync.started_at"),
    finishedAt: nullableTimestamp(run.finished_at ?? null, "last_sync.finished_at"),
    outcome: nonEmptyString(run.outcome, "last_sync.outcome"),
    counts: decodeCounts(run.counts ?? {}, "last_sync.counts"),
    errorKind: nullableString(run.error_kind ?? null, "last_sync.error_kind"),
  };
}

function decodeCounts(value: unknown, field: string): GoogleCalendarCounts {
  const body = record(value, field);
  const result = {} as GoogleCalendarCounts;
  for (const [key, wire] of countFields) {
    result[key] = count(body[wire] ?? 0, `${field}.${wire}`);
  }
  return result;
}

function count(value: unknown, field: string): number {
  const result = safeInteger(value, field);
  if (result < 0) throw new RavenTransportError("protocol");
  return result;
}
