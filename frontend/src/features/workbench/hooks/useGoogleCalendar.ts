"use client";

import React from "react";

import {
  beginGoogleCalendarConnect,
  completeGoogleCalendarConnect,
  disconnectGoogleCalendar,
  fetchGoogleCalendarCalendars,
  fetchGoogleCalendarPreview,
  fetchGoogleCalendarStatus,
  googleCalendarDefaultSummary,
  googleCalendarDurationMaxMinutes,
  googleCalendarDurationMinMinutes,
  googleCalendarPollMaxSecs,
  googleCalendarPollMinSecs,
  isLoopbackHostname,
  runGoogleCalendarSync,
  selectGoogleCalendar,
  updateGoogleCalendarSettings,
  type GoogleCalendarListEntry,
  type GoogleCalendarPreview,
  type GoogleCalendarStatus,
  type GoogleCalendarSyncRun,
} from "@/features/workbench/api/google-calendar";
import { RavenApiError, RavenTransportError } from "@/lib/raven-api";

/** Browser seams for navigation and origin checks; tests replace them. */
export const googleCalendarBrowser = {
  hostname: (): string => window.location.hostname,
  assign: (url: string): void => window.location.assign(url),
};

export type GoogleCalendarRedirectResult = "connected" | "error";

export const googleCalendarRedirectParam = "google_calendar";

export const pollIntervalError =
  `Enter a whole number of seconds from ${googleCalendarPollMinSecs} to ${googleCalendarPollMaxSecs}.`;
export const durationError =
  `Enter a whole number of minutes from ${googleCalendarDurationMinMinutes} to ${googleCalendarDurationMaxMinutes}.`;

/** Radio value for the "Create Raven calendar" choice; Google calendar ids never look like it. */
export const createCalendarChoice = "raven:create";

export type GoogleCalendarLoad =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; status: GoogleCalendarStatus };

export type GoogleCalendarListState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; calendars: GoogleCalendarListEntry[] };

export type GoogleCalendarPreviewState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; preview: GoogleCalendarPreview };

export type GoogleCalendarConnectFlow =
  | { kind: "idle" }
  | { kind: "awaiting_redirect"; authorizationUrl: string };

export type GoogleCalendarConfirm =
  | { kind: "disconnect"; error: string | null }
  | { kind: "guard"; error: string | null };

export type GoogleCalendarAction =
  | "save"
  | "connect"
  | "complete"
  | "calendar"
  | "sync";

export type GoogleCalendarNotice = { ok: boolean; message: string };

export type GoogleCalendarController = {
  load: GoogleCalendarLoad;
  notice: GoogleCalendarNotice | null;
  pending: GoogleCalendarAction | null;
  loopback: boolean;
  enabled: boolean;
  syncNote: boolean;
  pollText: string;
  durationText: string;
  pollError: string | null;
  durationError: string | null;
  choosingCalendar: boolean;
  changingCalendar: boolean;
  calendars: GoogleCalendarListState;
  selection: string | null;
  preview: GoogleCalendarPreviewState;
  connectFlow: GoogleCalendarConnectFlow;
  redirectText: string;
  forgetLinks: boolean;
  confirm: GoogleCalendarConfirm | null;
  reload: () => void;
  setEnabled: (value: boolean) => void;
  setSyncNote: (value: boolean) => void;
  setPollText: (value: string) => void;
  setDurationText: (value: string) => void;
  saveSettings: () => Promise<void>;
  connect: () => Promise<void>;
  setRedirectText: (value: string) => void;
  completeConnect: () => Promise<void>;
  startCalendarChange: () => void;
  cancelCalendarChange: () => void;
  reloadCalendars: () => void;
  setSelection: (value: string) => void;
  submitCalendar: () => Promise<void>;
  reloadPreview: () => void;
  startSyncing: () => Promise<void>;
  syncNow: () => Promise<void>;
  setForgetLinks: (value: boolean) => void;
  openDisconnect: () => void;
  openGuard: () => void;
  cancelConfirm: () => void;
  confirmDisconnect: () => Promise<void>;
  confirmGuard: () => Promise<void>;
};

const redirectNotices: Record<GoogleCalendarRedirectResult, GoogleCalendarNotice> = {
  connected: { ok: true, message: "Google Calendar connected." },
  error: {
    ok: false,
    message: "Google Calendar connection didn't complete. Try connecting again.",
  },
};

export function useGoogleCalendar(
  redirectResult: GoogleCalendarRedirectResult | null = null,
): GoogleCalendarController {
  const [load, setLoad] = React.useState<GoogleCalendarLoad>({ kind: "loading" });
  const [notice, setNotice] = React.useState<GoogleCalendarNotice | null>(
    redirectResult ? redirectNotices[redirectResult] : null,
  );
  const [pending, setPending] = React.useState<GoogleCalendarAction | null>(null);
  const [loopback] = React.useState(() => isLoopbackHostname(googleCalendarBrowser.hostname()));
  const [enabled, setEnabled] = React.useState(false);
  const [syncNote, setSyncNote] = React.useState(true);
  const [pollText, setPollTextState] = React.useState("");
  const [durationText, setDurationTextState] = React.useState("");
  const [pollFieldError, setPollFieldError] = React.useState<string | null>(null);
  const [durationFieldError, setDurationFieldError] = React.useState<string | null>(null);
  const [changingCalendar, setChangingCalendar] = React.useState(false);
  const [calendars, setCalendars] = React.useState<GoogleCalendarListState>({ kind: "idle" });
  const [selection, setSelection] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState<GoogleCalendarPreviewState>({ kind: "idle" });
  const [connectFlow, setConnectFlow] = React.useState<GoogleCalendarConnectFlow>({ kind: "idle" });
  const [redirectText, setRedirectText] = React.useState("");
  const [forgetLinks, setForgetLinks] = React.useState(false);
  const [confirm, setConfirm] = React.useState<GoogleCalendarConfirm | null>(null);
  const mounted = React.useRef(true);
  const loadSequence = React.useRef(0);

  const applyStatus = React.useCallback((status: GoogleCalendarStatus) => {
    setLoad({ kind: "ready", status });
    setEnabled(status.settings.enabled);
    setSyncNote(status.settings.syncNote);
    setPollTextState(String(status.settings.pollIntervalSecs));
    setDurationTextState(String(status.settings.defaultDurationMinutes));
    setPollFieldError(null);
    setDurationFieldError(null);
  }, []);

  /** Resolves to the applied status, or `null` when it failed or was superseded. */
  const refresh = React.useCallback(async (showLoading: boolean): Promise<GoogleCalendarStatus | null> => {
    const sequence = ++loadSequence.current;
    if (showLoading) setLoad({ kind: "loading" });
    try {
      const status = await fetchGoogleCalendarStatus();
      if (mounted.current && sequence === loadSequence.current) {
        applyStatus(status);
        return status;
      }
    } catch {
      if (mounted.current && sequence === loadSequence.current && showLoading) {
        setLoad({ kind: "error" });
      }
    }
    return null;
  }, [applyStatus]);

  React.useEffect(() => {
    mounted.current = true;
    void refresh(true);
    return () => {
      mounted.current = false;
    };
  }, [refresh]);

  const status = load.kind === "ready" ? load.status : null;
  const connected = status !== null && status.configured && status.connection !== "disconnected";
  const choosingCalendar = connected && (status.calendar === null || changingCalendar);
  const previewDue = connected && !choosingCalendar && status.firstSyncPending;

  const loadCalendars = React.useCallback(async () => {
    setCalendars({ kind: "loading" });
    try {
      const list = await fetchGoogleCalendarCalendars();
      if (mounted.current) setCalendars({ kind: "ready", calendars: list });
    } catch {
      if (mounted.current) setCalendars({ kind: "error" });
    }
  }, []);

  const loadPreview = React.useCallback(async () => {
    setPreview({ kind: "loading" });
    try {
      const next = await fetchGoogleCalendarPreview();
      if (mounted.current) setPreview({ kind: "ready", preview: next });
    } catch {
      if (mounted.current) setPreview({ kind: "error" });
    }
  }, []);

  React.useEffect(() => {
    if (choosingCalendar && calendars.kind === "idle") void loadCalendars();
  }, [calendars.kind, choosingCalendar, loadCalendars]);

  React.useEffect(() => {
    if (previewDue && preview.kind === "idle") void loadPreview();
  }, [loadPreview, preview.kind, previewDue]);

  /**
   * Refreshes the status after a sync. The preview is reset only when the first sync is still
   * pending afterwards (for example after the guard tripped); resetting it earlier would refetch
   * it while the stale status still asks for a preview.
   */
  const refreshAfterSync = React.useCallback(async () => {
    const next = await refresh(false);
    if (mounted.current && next?.firstSyncPending) setPreview({ kind: "idle" });
  }, [refresh]);

  const failAction = React.useCallback((cause: unknown, fallback: string) => {
    setNotice({ ok: false, message: errorMessage(cause, fallback) });
    if (isStateConflict(cause)) void refresh(false);
  }, [refresh]);

  const saveSettings = React.useCallback(async () => {
    if (!status || pending) return;
    const pollIntervalSecs = parseWhole(pollText, googleCalendarPollMinSecs, googleCalendarPollMaxSecs);
    const defaultDurationMinutes = parseWhole(
      durationText,
      googleCalendarDurationMinMinutes,
      googleCalendarDurationMaxMinutes,
    );
    setPollFieldError(pollIntervalSecs === null ? pollIntervalError : null);
    setDurationFieldError(defaultDurationMinutes === null ? durationError : null);
    setNotice(null);
    if (pollIntervalSecs === null || defaultDurationMinutes === null) return;
    setPending("save");
    loadSequence.current += 1;
    try {
      const next = await updateGoogleCalendarSettings({
        enabled,
        syncNote,
        pollIntervalSecs,
        defaultDurationMinutes,
      });
      if (!mounted.current) return;
      applyStatus(next);
      setNotice({ ok: true, message: "Google Calendar settings saved." });
    } catch (cause) {
      if (mounted.current) failAction(cause, "Couldn't save Google Calendar settings. Try again.");
    } finally {
      if (mounted.current) setPending(null);
    }
  }, [applyStatus, durationText, enabled, failAction, pending, pollText, status, syncNote]);

  const connect = React.useCallback(async () => {
    if (pending) return;
    setNotice(null);
    setPending("connect");
    let navigating = false;
    try {
      const start = await beginGoogleCalendarConnect();
      if (!mounted.current) return;
      if (loopback) {
        navigating = true;
        googleCalendarBrowser.assign(start.authorizationUrl);
      } else {
        setRedirectText("");
        setConnectFlow({ kind: "awaiting_redirect", authorizationUrl: start.authorizationUrl });
      }
    } catch (cause) {
      if (mounted.current) failAction(cause, "Couldn't start connecting to Google. Try again.");
    } finally {
      // Keep the button busy while the browser leaves for Google.
      if (mounted.current && !navigating) setPending(null);
    }
  }, [failAction, loopback, pending]);

  const completeConnect = React.useCallback(async () => {
    const redirectUrl = redirectText.trim();
    if (pending || !redirectUrl) return;
    setNotice(null);
    setPending("complete");
    try {
      await completeGoogleCalendarConnect(redirectUrl);
      if (!mounted.current) return;
      setConnectFlow({ kind: "idle" });
      setRedirectText("");
      setNotice(redirectNotices.connected);
      await refresh(false);
    } catch (cause) {
      if (mounted.current) {
        failAction(
          cause,
          "Couldn't finish connecting. Paste the full address from the address bar, or connect again.",
        );
      }
    } finally {
      if (mounted.current) setPending(null);
    }
  }, [failAction, pending, redirectText, refresh]);

  const submitCalendar = React.useCallback(async () => {
    if (pending || selection === null) return;
    setNotice(null);
    setPending("calendar");
    try {
      await selectGoogleCalendar(selection === createCalendarChoice
        ? { create: googleCalendarDefaultSummary }
        : { select: selection });
      if (!mounted.current) return;
      // Keep the loaded list: resetting it here would refetch it while the stale status still
      // has no calendar. Starting a calendar change loads a fresh list.
      setChangingCalendar(false);
      setSelection(null);
      setPreview({ kind: "idle" });
      setNotice({ ok: true, message: "Calendar saved." });
      await refresh(false);
    } catch (cause) {
      if (mounted.current) failAction(cause, "Couldn't save the calendar. Try again.");
    } finally {
      if (mounted.current) setPending(null);
    }
  }, [failAction, pending, refresh, selection]);

  const syncNow = React.useCallback(async () => {
    if (pending) return;
    setNotice(null);
    setPending("sync");
    try {
      const result = await runGoogleCalendarSync({ allowMassDelete: false });
      if (!mounted.current) return;
      setNotice(syncNotice(result.lastSync));
      await refreshAfterSync();
    } catch (cause) {
      if (mounted.current) failAction(cause, "Couldn't sync with Google Calendar. Try again.");
    } finally {
      if (mounted.current) setPending(null);
    }
  }, [failAction, pending, refreshAfterSync]);

  const startSyncing = React.useCallback(async () => {
    if (pending || !status) return;
    setNotice(null);
    setPending("sync");
    try {
      const result = await runGoogleCalendarSync({ allowMassDelete: false });
      if (!mounted.current) return;
      setNotice(syncNotice(result.lastSync));
      if (!status.settings.enabled) {
        try {
          await updateGoogleCalendarSettings({ ...status.settings, enabled: true });
        } catch {
          if (mounted.current) {
            setNotice({
              ok: false,
              message: "The first sync finished, but automatic sync couldn't be turned on. Turn it on below.",
            });
          }
        }
      }
      if (mounted.current) await refreshAfterSync();
    } catch (cause) {
      if (mounted.current) failAction(cause, "Couldn't start syncing. Try again.");
    } finally {
      if (mounted.current) setPending(null);
    }
  }, [failAction, pending, refreshAfterSync, status]);

  const confirmDisconnect = React.useCallback(async () => {
    try {
      await disconnectGoogleCalendar({ forgetLinks });
      if (!mounted.current) return;
      setConfirm(null);
      setForgetLinks(false);
      setChangingCalendar(false);
      setConnectFlow({ kind: "idle" });
      setCalendars({ kind: "idle" });
      setPreview({ kind: "idle" });
      setNotice({ ok: true, message: "Google Calendar disconnected." });
      await refresh(false);
    } catch (cause) {
      if (!mounted.current) return;
      setConfirm({ kind: "disconnect", error: errorMessage(cause, "Couldn't disconnect. Try again.") });
      if (isStateConflict(cause)) void refresh(false);
    }
  }, [forgetLinks, refresh]);

  const confirmGuard = React.useCallback(async () => {
    try {
      const result = await runGoogleCalendarSync({ allowMassDelete: true });
      if (!mounted.current) return;
      setConfirm(null);
      setNotice(syncNotice(result.lastSync));
      await refreshAfterSync();
    } catch (cause) {
      if (!mounted.current) return;
      setConfirm({ kind: "guard", error: errorMessage(cause, "Couldn't sync with Google Calendar. Try again.") });
      if (isStateConflict(cause)) void refresh(false);
    }
  }, [refresh, refreshAfterSync]);

  return {
    load,
    notice,
    pending,
    loopback,
    enabled,
    syncNote,
    pollText,
    durationText,
    pollError: pollFieldError,
    durationError: durationFieldError,
    choosingCalendar,
    changingCalendar,
    calendars,
    selection,
    preview,
    connectFlow,
    redirectText,
    forgetLinks,
    confirm,
    reload: () => void refresh(true),
    setEnabled,
    setSyncNote,
    setPollText: (value) => {
      setPollTextState(value);
      setPollFieldError(null);
    },
    setDurationText: (value) => {
      setDurationTextState(value);
      setDurationFieldError(null);
    },
    saveSettings,
    connect,
    setRedirectText,
    completeConnect,
    startCalendarChange: () => {
      setNotice(null);
      setSelection(null);
      setCalendars({ kind: "idle" });
      setChangingCalendar(true);
    },
    cancelCalendarChange: () => {
      setChangingCalendar(false);
      setSelection(null);
    },
    reloadCalendars: () => void loadCalendars(),
    setSelection,
    submitCalendar,
    reloadPreview: () => void loadPreview(),
    startSyncing,
    syncNow,
    setForgetLinks,
    openDisconnect: () => {
      setNotice(null);
      setConfirm({ kind: "disconnect", error: null });
    },
    openGuard: () => {
      setNotice(null);
      setConfirm({ kind: "guard", error: null });
    },
    cancelConfirm: () => setConfirm(null),
    confirmDisconnect,
    confirmGuard,
  };
}

/**
 * Reads the OAuth callback result once on page load and removes it from the address bar so
 * a reload does not repeat it.
 */
export function useGoogleCalendarRedirect(
  onResult: (result: GoogleCalendarRedirectResult) => void,
): void {
  const callback = React.useRef(onResult);
  callback.current = onResult;

  React.useEffect(() => {
    const result = consumeGoogleCalendarRedirect();
    if (result) callback.current(result);
  }, []);
}

export function consumeGoogleCalendarRedirect(): GoogleCalendarRedirectResult | null {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(googleCalendarRedirectParam)) return null;
  const value = url.searchParams.get(googleCalendarRedirectParam);
  url.searchParams.delete(googleCalendarRedirectParam);
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  return value === "connected" || value === "error" ? value : null;
}

export function googleCalendarOutcomeLabel(outcome: string): string {
  switch (outcome) {
    case "ok":
      return "Completed";
    case "partial":
      return "Partially completed";
    case "failed":
      return "Failed";
    case "guard_tripped":
      return "Stopped before mass deletion";
    case "reauth_required":
      return "Reconnect required";
    case "nothing_to_do":
      return "Nothing to sync";
    default:
      return humanize(outcome);
  }
}

export function humanize(value: string): string {
  const text = value.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function syncNotice(run: GoogleCalendarSyncRun | null): GoogleCalendarNotice {
  if (!run) return { ok: true, message: "Sync finished." };
  return {
    ok: run.outcome !== "failed" && run.outcome !== "guard_tripped" && run.outcome !== "reauth_required",
    message: `Sync finished: ${googleCalendarOutcomeLabel(run.outcome)}.`,
  };
}

export function parseWhole(value: string, min: number, max: number): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return parsed >= min && parsed <= max ? parsed : null;
}

function errorStatus(cause: unknown): number | undefined {
  return cause instanceof RavenApiError || cause instanceof RavenTransportError
    ? cause.status
    : undefined;
}

function errorCode(cause: unknown): string | null {
  return cause instanceof RavenApiError ? cause.code.replace(/^google_calendar_/, "") : null;
}

function isStateConflict(cause: unknown): boolean {
  return errorStatus(cause) === 409;
}

function errorMessage(cause: unknown, fallback: string): string {
  const status = errorStatus(cause);
  switch (errorCode(cause)) {
    case "sync_in_progress":
      return "A sync is already in progress. Try again after it finishes.";
    case "reauth_required":
      return "Google access expired. Reconnect to continue syncing.";
    case "not_connected":
      return "Google Calendar isn't connected. Connect it and try again.";
    case "calendar_not_selected":
      return "Choose a calendar first.";
    case "not_configured":
      return "Google access isn't set up yet. Follow the setup steps first.";
    case "upstream_unavailable":
      return "Google Calendar didn't respond. Try again in a moment.";
    default:
      break;
  }
  if (status === 502) return "Google Calendar didn't respond. Try again in a moment.";
  // 401 expired session, 403 missing integration header, 421 wrong Origin/Host.
  if (status === 401 || status === 403 || status === 421) {
    return "Raven refused the request from this page. Reload the page and try again.";
  }
  return fallback;
}
