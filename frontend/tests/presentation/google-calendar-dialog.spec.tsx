import "@testing-library/jest-dom/vitest";

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { googleCalendarBrowser } from "@/features/workbench/hooks/useGoogleCalendar";
import { GoogleCalendarDialog } from "@/features/workbench/ui/GoogleCalendarDialog";

const base = "/api/v1/integrations/google-calendar";
const authorizationUrl = "https://accounts.google.com/o/oauth2/v2/auth?client_id=x";

const zeroCounts = {
  google_created: 0,
  google_updated: 0,
  google_deleted: 0,
  raven_created: 0,
  raven_updated: 0,
  raven_archived: 0,
  conflicts: 0,
  skipped_recurring: 0,
  skipped_terminal: 0,
  failed: 0,
};

function lastSync(overrides: Record<string, unknown> = {}) {
  return {
    run_id: "run-1",
    trigger: "scheduled",
    started_at: "2026-11-20T03:00:00Z",
    finished_at: "2026-11-20T03:00:02Z",
    outcome: "ok",
    counts: { ...zeroCounts, google_created: 2, raven_updated: 1 },
    error_kind: null,
    ...overrides,
  };
}

function statusBody(overrides: Record<string, unknown> = {}) {
  return {
    configured: true,
    connection: "connected",
    scopes: [],
    calendar: { id: "cal-raven", summary: "Raven", time_zone: "Asia/Seoul", primary: false },
    settings: {
      enabled: true,
      calendar_id: "cal-raven",
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
    last_sync: lastSync(),
    links: { total: 12, error: 0 },
    ...overrides,
  };
}

const notConfigured = () => statusBody({
  configured: false,
  connection: "disconnected",
  calendar: null,
  last_sync: null,
});
const disconnected = () => statusBody({ connection: "disconnected", calendar: null, last_sync: null });
const withoutCalendar = () => statusBody({ calendar: null, last_sync: null, first_sync_pending: true });
const firstSyncPending = (enabled = false) => statusBody({
  first_sync_pending: true,
  last_sync: null,
  settings: { ...statusBody().settings, enabled },
});

const calendars = {
  calendars: [
    { id: "me@example.test", summary: "Personal", primary: true, access_role: "owner", time_zone: "Asia/Seoul" },
    { id: "work@example.test", summary: "Work", primary: false, access_role: "writer", time_zone: "Asia/Seoul" },
  ],
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function apiError(code: string, status: number): Response {
  return json({
    code,
    message: "server message",
    fields: {},
    request_id: "00000000-0000-4000-8000-000000000001",
  }, status);
}

type Handler = (path: string, method: string, body: unknown) => Response | undefined;

/** Serves the status from a mutable reference unless the handler answers first. */
function serve(initial: unknown, handler: Handler = () => undefined) {
  const state = { status: initial };
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input).split("?")[0]!;
    const method = init?.method ?? "GET";
    const body = init?.body === undefined ? undefined : JSON.parse(String(init.body));
    const answer = handler(path, method, body);
    if (answer) return Promise.resolve(answer);
    if (path === base && method === "GET") return Promise.resolve(json(state.status));
    if (path === `${base}/calendars`) return Promise.resolve(json(calendars));
    return Promise.resolve(json(state.status));
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, state };
}

function callsTo(fetchMock: ReturnType<typeof vi.fn>, path: string, method = "GET") {
  return fetchMock.mock.calls
    .filter(([input, init]) =>
      String(input).split("?")[0] === path && ((init as RequestInit | undefined)?.method ?? "GET") === method)
    .map(([, init]) => {
      const request = init as RequestInit | undefined;
      return {
        headers: new Headers(request?.headers),
        body: request?.body === undefined ? undefined : JSON.parse(String(request.body)),
      };
    });
}

function renderDialog(redirectResult: "connected" | "error" | null = null) {
  const returnFocusRef = React.createRef<HTMLButtonElement>();
  const onClose = vi.fn();
  render(
    <GoogleCalendarDialog
      onClose={onClose}
      returnFocusRef={returnFocusRef}
      redirectResult={redirectResult}
    />,
  );
  return { onClose };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("GoogleCalendarDialog", () => {
  it("explains client setup when no OAuth client is configured", async () => {
    serve(notConfigured());
    renderDialog();

    const dialog = await screen.findByRole("dialog", { name: "Google Calendar" });
    const setup = await within(dialog).findByRole("region", { name: "Set up Google access" });
    expect(within(setup).getByText(/raven google-calendar client set --file/)).toBeInTheDocument();
    expect(within(setup).getAllByRole("listitem").length).toBeGreaterThanOrEqual(3);
    expect(within(dialog).queryByRole("button", { name: "Connect Google Calendar" })).toBeNull();
  });

  it("connects on a loopback origin by navigating to Google", async () => {
    const user = userEvent.setup();
    const assign = vi.spyOn(googleCalendarBrowser, "assign").mockImplementation(() => undefined);
    vi.spyOn(googleCalendarBrowser, "hostname").mockReturnValue("127.0.0.1");
    const { fetchMock } = serve(disconnected(), (path, method) =>
      path === `${base}/connect` && method === "POST"
        ? json({ authorization_url: authorizationUrl, expires_at: "2026-11-20T03:10:00Z" })
        : undefined);
    renderDialog();

    await user.click(await screen.findByRole("button", { name: "Connect Google Calendar" }));

    await waitFor(() => expect(assign).toHaveBeenCalledWith(authorizationUrl));
    const posts = callsTo(fetchMock, `${base}/connect`, "POST");
    expect(posts).toHaveLength(1);
    expect(posts[0]!.headers.get("X-Raven-Integration")).toBe("1");
    expect(screen.queryByRole("textbox", { name: "Redirect URL" })).toBeNull();
  });

  it("offers the paste-the-redirect-URL fallback on a non-loopback origin", async () => {
    const user = userEvent.setup();
    const assign = vi.spyOn(googleCalendarBrowser, "assign").mockImplementation(() => undefined);
    vi.spyOn(googleCalendarBrowser, "hostname").mockReturnValue("raven.example.com");
    const { fetchMock, state } = serve(disconnected(), (path, method) =>
      path === `${base}/connect` && method === "POST"
        ? json({ authorization_url: authorizationUrl, expires_at: "2026-11-20T03:10:00Z" })
        : undefined);
    renderDialog();

    expect(await screen.findByText("Connect from the Mac running Raven")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Connect Google Calendar" }));

    const link = await screen.findByRole("link", { name: "Open Google sign-in" });
    expect(link).toHaveAttribute("href", authorizationUrl);
    expect(link).toHaveAttribute("target", "_blank");
    expect(assign).not.toHaveBeenCalled();

    const finish = screen.getByRole("button", { name: "Finish connecting" });
    expect(finish).toBeDisabled();
    const redirect = "http://127.0.0.1:3001/__raven/google-calendar/callback?state=s&code=c";
    state.status = withoutCalendar();
    await user.type(screen.getByRole("textbox", { name: "Redirect URL" }), redirect);
    await user.click(finish);

    const completes = callsTo(fetchMock, `${base}/connect/complete`, "POST");
    expect(completes).toHaveLength(1);
    expect(completes[0]!.body).toEqual({ redirect_url: redirect });
    expect(completes[0]!.headers.get("X-Raven-Integration")).toBe("1");
    expect(await screen.findByRole("status")).toHaveTextContent("Google Calendar connected.");
    expect(await screen.findByRole("radio", { name: "Personal (primary)" })).toBeInTheDocument();
  });

  it("shows a pasted redirect URL error from the server", async () => {
    const user = userEvent.setup();
    vi.spyOn(googleCalendarBrowser, "hostname").mockReturnValue("raven.example.com");
    serve(disconnected(), (path) => {
      if (path === `${base}/connect`) {
        return json({ authorization_url: authorizationUrl, expires_at: "2026-11-20T03:10:00Z" });
      }
      if (path === `${base}/connect/complete`) return apiError("validation_failed", 422);
      return undefined;
    });
    renderDialog();

    await user.click(await screen.findByRole("button", { name: "Connect Google Calendar" }));
    await user.type(await screen.findByRole("textbox", { name: "Redirect URL" }), "http://127.0.0.1/x");
    await user.click(screen.getByRole("button", { name: "Finish connecting" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't finish connecting");
  });

  it("selects an existing calendar from the list", async () => {
    const user = userEvent.setup();
    const { fetchMock, state } = serve(withoutCalendar(), (path, method) => {
      if (path === `${base}/calendar` && method === "POST") {
        state.status = firstSyncPending();
        return json(state.status);
      }
      if (path === `${base}/preview`) return json({ counts: zeroCounts });
      return undefined;
    });
    renderDialog();

    const group = await screen.findByRole("radiogroup", { name: "Calendar to sync" });
    expect(within(group).getByRole("radio", { name: "Personal (primary)" })).toBeInTheDocument();
    expect(within(group).getByRole("radio", { name: "Create Raven calendar" })).toBeInTheDocument();
    const use = screen.getByRole("button", { name: "Use this calendar" });
    expect(use).toBeDisabled();

    await user.click(within(group).getByRole("radio", { name: "Work" }));
    await user.click(use);

    const posts = callsTo(fetchMock, `${base}/calendar`, "POST");
    expect(posts).toHaveLength(1);
    expect(posts[0]!.body).toEqual({ select: "work@example.test" });
    expect(posts[0]!.headers.get("X-Raven-Integration")).toBe("1");
    expect(await screen.findByRole("button", { name: "Start syncing" })).toBeInTheDocument();
    await waitFor(() => expect(callsTo(fetchMock, `${base}/preview`)).toHaveLength(1));
    expect(callsTo(fetchMock, `${base}/calendars`)).toHaveLength(1);
  });

  it("creates a dedicated Raven calendar", async () => {
    const user = userEvent.setup();
    const { fetchMock, state } = serve(withoutCalendar(), (path, method) => {
      if (path === `${base}/calendar` && method === "POST") {
        state.status = firstSyncPending();
        return json(state.status);
      }
      if (path === `${base}/preview`) return json({ counts: zeroCounts });
      return undefined;
    });
    renderDialog();

    await user.click(await screen.findByRole("radio", { name: "Create Raven calendar" }));
    await user.click(screen.getByRole("button", { name: "Use this calendar" }));

    await waitFor(() => expect(callsTo(fetchMock, `${base}/calendar`, "POST")).toHaveLength(1));
    expect(callsTo(fetchMock, `${base}/calendar`, "POST")[0]!.body)
      .toEqual({ create: { summary: "Raven" } });
    expect(await screen.findByRole("button", { name: "Start syncing" })).toBeInTheDocument();
    await waitFor(() => expect(callsTo(fetchMock, `${base}/preview`)).toHaveLength(1));
    expect(callsTo(fetchMock, `${base}/calendars`)).toHaveLength(1);
  });

  it("previews the first sync and starts syncing", async () => {
    const user = userEvent.setup();
    const { fetchMock, state } = serve(firstSyncPending(false), (path, method, body) => {
      if (path === `${base}/preview`) {
        return json({ counts: { ...zeroCounts, google_created: 3, raven_created: 5, skipped_recurring: 2 } });
      }
      if (path === `${base}/sync` && method === "POST") {
        state.status = statusBody({ settings: { ...statusBody().settings, enabled: false } });
        return json({ last_sync: lastSync() });
      }
      if (path === base && method === "PUT") {
        state.status = statusBody({
          settings: { ...statusBody().settings, enabled: (body as { enabled: boolean }).enabled },
        });
        return json(state.status);
      }
      return undefined;
    });
    renderDialog();

    const preview = await screen.findByRole("region", { name: "First sync" });
    expect(await within(preview).findByText("Raven events to add to Google: 3")).toBeInTheDocument();
    expect(within(preview).getByText("Google events to add to Raven: 5")).toBeInTheDocument();
    expect(within(preview).getByText("Recurring Google events skipped: 2")).toBeInTheDocument();
    expect(callsTo(fetchMock, `${base}/sync`, "POST")).toHaveLength(0);

    await user.click(within(preview).getByRole("button", { name: "Start syncing" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Sync finished: Completed.");
    const syncs = callsTo(fetchMock, `${base}/sync`, "POST");
    expect(syncs).toHaveLength(1);
    expect(syncs[0]!.body).toEqual({ dry_run: false, allow_mass_delete: false });
    expect(syncs[0]!.headers.get("X-Raven-Integration")).toBe("1");
    const puts = callsTo(fetchMock, base, "PUT");
    expect(puts).toHaveLength(1);
    expect(puts[0]!.body).toMatchObject({ enabled: true });
    expect(await screen.findByRole("button", { name: "Sync now" })).toBeInTheDocument();
    expect(callsTo(fetchMock, `${base}/preview`)).toHaveLength(1);
  });

  it("shows the active state with last sync, next run, and links", async () => {
    serve(statusBody({ links: { total: 12, error: 2 } }));
    renderDialog();

    const last = await screen.findByRole("region", { name: "Last sync" });
    expect(within(last).getByText("Completed")).toBeInTheDocument();
    expect(within(last).getByText(/2 added to Google/)).toBeInTheDocument();
    expect(within(last).getByText(/1 updated in Raven/)).toBeInTheDocument();
    const summary = screen.getByRole("region", { name: "Sync status" });
    expect(within(summary).getByText("Raven")).toBeInTheDocument();
    expect(within(summary).getByText(/12 linked events, 2 with errors/)).toBeInTheDocument();
    expect(within(summary).getByText(/every 2 minutes/)).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Sync automatically" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Sync notes with event descriptions" })).toBeChecked();
    expect(screen.getByRole("spinbutton", { name: "Check every (seconds)" })).toHaveValue(120);
    expect(screen.getByRole("spinbutton", { name: "Default event length (minutes)" })).toHaveValue(60);
  });

  it("stacks the settings checkboxes in their own group", async () => {
    serve(statusBody());
    renderDialog();

    const auto = await screen.findByRole("checkbox", { name: "Sync automatically" });
    const notes = screen.getByRole("checkbox", { name: "Sync notes with event descriptions" });
    const group = auto.closest(".google-calendar-toggles");
    expect(group).not.toBeNull();
    expect(group).toContainElement(notes);
  });

  it("runs Sync now", async () => {
    const user = userEvent.setup();
    const { fetchMock } = serve(statusBody(), (path, method) =>
      path === `${base}/sync` && method === "POST"
        ? json({ last_sync: lastSync({ run_id: "run-2", outcome: "partial" }) })
        : undefined);
    renderDialog();

    await user.click(await screen.findByRole("button", { name: "Sync now" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Sync finished: Partially completed.");
    const syncs = callsTo(fetchMock, `${base}/sync`, "POST");
    expect(syncs).toHaveLength(1);
    expect(syncs[0]!.body).toEqual({ dry_run: false, allow_mass_delete: false });
  });

  it("saves settings with a PUT", async () => {
    const user = userEvent.setup();
    const { fetchMock } = serve(statusBody());
    renderDialog();

    await user.click(await screen.findByRole("checkbox", { name: "Sync notes with event descriptions" }));
    await user.click(screen.getByRole("checkbox", { name: "Sync automatically" }));
    const poll = screen.getByRole("spinbutton", { name: "Check every (seconds)" });
    await user.clear(poll);
    await user.type(poll, "600");
    const duration = screen.getByRole("spinbutton", { name: "Default event length (minutes)" });
    await user.clear(duration);
    await user.type(duration, "30");
    await user.click(screen.getByRole("button", { name: "Save settings" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Google Calendar settings saved.");
    const puts = callsTo(fetchMock, base, "PUT");
    expect(puts).toHaveLength(1);
    expect(puts[0]!.body).toEqual({
      enabled: false,
      sync_note: false,
      poll_interval_secs: 600,
      default_duration_minutes: 30,
    });
    expect(puts[0]!.headers.get("X-Raven-Integration")).toBe("1");
  });

  it.each(["59", "3601", "1.5", ""])("rejects poll interval %j without a request", async (value) => {
    const user = userEvent.setup();
    const { fetchMock } = serve(statusBody());
    renderDialog();

    const poll = await screen.findByRole("spinbutton", { name: "Check every (seconds)" });
    await user.clear(poll);
    if (value) await user.type(poll, value);
    await user.click(screen.getByRole("button", { name: "Save settings" }));

    expect(await screen.findByText("Enter a whole number of seconds from 60 to 3600."))
      .toBeInTheDocument();
    expect(poll).toHaveAttribute("aria-invalid", "true");
    expect(callsTo(fetchMock, base, "PUT")).toHaveLength(0);
  });

  it("changes the calendar after warning that links are released", async () => {
    const user = userEvent.setup();
    const { fetchMock, state } = serve(statusBody(), (path, method) => {
      if (path === `${base}/calendar` && method === "POST") {
        state.status = firstSyncPending(true);
        return json(state.status);
      }
      if (path === `${base}/preview`) return json({ counts: zeroCounts });
      return undefined;
    });
    renderDialog();

    await user.click(await screen.findByRole("button", { name: "Change calendar" }));
    expect(screen.getByText(/releases the links/)).toHaveTextContent(/stay in Google Calendar/);
    await user.click(await screen.findByRole("radio", { name: "Personal (primary)" }));
    await user.click(screen.getByRole("button", { name: "Use this calendar" }));

    await waitFor(() => expect(callsTo(fetchMock, `${base}/calendar`, "POST")).toHaveLength(1));
    expect(callsTo(fetchMock, `${base}/calendar`, "POST")[0]!.body).toEqual({ select: "me@example.test" });
    expect(await screen.findByRole("button", { name: "Start syncing" })).toBeInTheDocument();
    await waitFor(() => expect(callsTo(fetchMock, `${base}/preview`)).toHaveLength(1));
    expect(callsTo(fetchMock, `${base}/calendars`)).toHaveLength(1);
  });

  it("refetches the calendar list each time a change starts", async () => {
    const user = userEvent.setup();
    const { fetchMock } = serve(statusBody());
    renderDialog();

    await user.click(await screen.findByRole("button", { name: "Change calendar" }));
    await screen.findByRole("radio", { name: "Personal (primary)" });
    await user.click(screen.getByRole("button", { name: "Keep current calendar" }));
    await user.click(screen.getByRole("button", { name: "Change calendar" }));
    await screen.findByRole("radio", { name: "Personal (primary)" });

    expect(callsTo(fetchMock, `${base}/calendars`)).toHaveLength(2);
  });

  it("cancels a calendar change", async () => {
    const user = userEvent.setup();
    serve(statusBody());
    renderDialog();

    await user.click(await screen.findByRole("button", { name: "Change calendar" }));
    await user.click(await screen.findByRole("button", { name: "Keep current calendar" }));
    expect(screen.queryByRole("radiogroup", { name: "Calendar to sync" })).toBeNull();
    expect(screen.getByRole("button", { name: "Sync now" })).toBeInTheDocument();
  });

  it("disconnects and optionally forgets sync links", async () => {
    const user = userEvent.setup();
    const { fetchMock, state } = serve(statusBody(), (path, method) => {
      if (path === `${base}/disconnect` && method === "POST") {
        state.status = disconnected();
        return json(state.status);
      }
      return undefined;
    });
    renderDialog();

    await user.click(await screen.findByRole("checkbox", { name: "Also forget sync links" }));
    await user.click(screen.getByRole("button", { name: "Disconnect" }));
    const confirm = screen.getByRole("dialog", { name: "Disconnect Google Calendar?" });
    expect(confirm).toHaveTextContent(/forgets all sync links/);
    expect(callsTo(fetchMock, `${base}/disconnect`, "POST")).toHaveLength(0);
    await user.click(within(confirm).getByRole("button", { name: "Disconnect" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Disconnect Google Calendar?" }))
      .toBeNull());
    const posts = callsTo(fetchMock, `${base}/disconnect`, "POST");
    expect(posts).toHaveLength(1);
    expect(posts[0]!.body).toEqual({ forget_links: true });
    expect(posts[0]!.headers.get("X-Raven-Integration")).toBe("1");
    expect(await screen.findByRole("button", { name: "Connect Google Calendar" })).toBeInTheDocument();
  });

  it("keeps sync links by default when disconnecting", async () => {
    const user = userEvent.setup();
    const { fetchMock } = serve(statusBody());
    renderDialog();

    await user.click(await screen.findByRole("button", { name: "Disconnect" }));
    const confirm = screen.getByRole("dialog", { name: "Disconnect Google Calendar?" });
    expect(confirm).toHaveTextContent(/kept/);
    await user.click(within(confirm).getByRole("button", { name: "Disconnect" }));

    await waitFor(() => expect(callsTo(fetchMock, `${base}/disconnect`, "POST")).toHaveLength(1));
    expect(callsTo(fetchMock, `${base}/disconnect`, "POST")[0]!.body).toEqual({ forget_links: false });
  });

  it("shows a reauth banner with Reconnect", async () => {
    const user = userEvent.setup();
    const assign = vi.spyOn(googleCalendarBrowser, "assign").mockImplementation(() => undefined);
    vi.spyOn(googleCalendarBrowser, "hostname").mockReturnValue("localhost");
    serve(statusBody({ connection: "reauth_required" }), (path) =>
      path === `${base}/connect`
        ? json({ authorization_url: authorizationUrl, expires_at: "2026-11-20T03:10:00Z" })
        : undefined);
    renderDialog();

    expect(await screen.findByText(/Google access expired or was revoked/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reconnect" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith(authorizationUrl));
  });

  it("confirms a sync that allows mass deletions after the guard trips", async () => {
    const user = userEvent.setup();
    const { fetchMock, state } = serve(statusBody({ last_sync: lastSync({ outcome: "guard_tripped" }) }),
      (path, method) => {
        if (path === `${base}/sync` && method === "POST") {
          state.status = statusBody();
          return json({ last_sync: lastSync({ run_id: "run-3" }) });
        }
        return undefined;
      });
    renderDialog();

    expect(await screen.findByText(/stopped before deleting many events/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Sync and allow deletions" }));
    const confirm = screen.getByRole("dialog", { name: "Allow mass deletions?" });
    expect(callsTo(fetchMock, `${base}/sync`, "POST")).toHaveLength(0);
    await user.click(within(confirm).getByRole("button", { name: "Sync and allow deletions" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Allow mass deletions?" })).toBeNull());
    const syncs = callsTo(fetchMock, `${base}/sync`, "POST");
    expect(syncs).toHaveLength(1);
    expect(syncs[0]!.body).toEqual({ dry_run: false, allow_mass_delete: true });
    expect(await screen.findByRole("status")).toHaveTextContent("Sync finished: Completed.");
  });

  it("shows the environment override notice", async () => {
    serve(statusBody({ env_override: "disabled", schedule: { scheduler_active: false, next_run_at: null } }));
    renderDialog();

    expect(await screen.findByText(/turned off by the RAVEN_GOOGLE_CALENDAR environment setting/))
      .toBeInTheDocument();
    expect(screen.getByText("Turned off by RAVEN_GOOGLE_CALENDAR")).toBeInTheDocument();
  });

  it.each([
    ["google_calendar_sync_in_progress", 409, "A sync is already in progress."],
    ["google_calendar_reauth_required", 409, "Google access expired."],
    ["google_calendar_not_connected", 409, "Google Calendar isn't connected."],
    ["google_calendar_calendar_not_selected", 409, "Choose a calendar first."],
    ["google_calendar_not_configured", 409, "Google access isn't set up yet."],
    ["upstream_unavailable", 502, "Google Calendar didn't respond."],
    ["forbidden", 403, "Raven refused the request from this page."],
    ["misdirected", 421, "Raven refused the request from this page."],
  ])("explains a failed sync (%s)", async (code, status, message) => {
    const user = userEvent.setup();
    serve(statusBody(), (path, method) =>
      path === `${base}/sync` && method === "POST" ? apiError(code, status) : undefined);
    renderDialog();

    await user.click(await screen.findByRole("button", { name: "Sync now" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
  });

  it("explains a failed calendar list", async () => {
    const user = userEvent.setup();
    let fail = true;
    serve(withoutCalendar(), (path) =>
      path === `${base}/calendars` && fail ? apiError("upstream_unavailable", 502) : undefined);
    renderDialog();

    expect(await screen.findByText(/Couldn't load your calendars/)).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("radio", { name: "Work" })).toBeInTheDocument();
  });

  it("shows the redirect result passed in from the URL", async () => {
    serve(withoutCalendar());
    renderDialog("connected");
    expect(await screen.findByRole("status")).toHaveTextContent("Google Calendar connected.");
  });

  it("shows a failed redirect result", async () => {
    serve(disconnected());
    renderDialog("error");
    expect(await screen.findByRole("alert"))
      .toHaveTextContent("Google Calendar connection didn't complete.");
  });

  it("shows a load error with retry", async () => {
    const user = userEvent.setup();
    let fail = true;
    serve(statusBody(), (path, method) =>
      path === base && method === "GET" && fail ? apiError("internal", 500) : undefined);
    renderDialog();

    expect(await screen.findByText("Couldn't load Google Calendar settings.")).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("button", { name: "Sync now" })).toBeInTheDocument();
  });

  it("closes on Escape and Close", async () => {
    const user = userEvent.setup();
    serve(statusBody());
    const { onClose } = renderDialog();

    await screen.findByRole("button", { name: "Sync now" });
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
