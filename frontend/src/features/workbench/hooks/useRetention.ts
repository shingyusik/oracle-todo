"use client";

import React from "react";

import {
  fetchRetentionPreview,
  fetchRetentionStatus,
  retentionMaxDays,
  retentionMinDays,
  runRetentionNow,
  updateRetentionSettings,
  type RetentionPreview,
  type RetentionStatus,
} from "@/features/workbench/api/retention";
import { RavenApiError, RavenTransportError } from "@/lib/raven-api";

export const retentionDaysError =
  `Enter a whole number of days from ${retentionMinDays} to ${retentionMaxDays}.`;

export type RetentionLoad =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; status: RetentionStatus };

export type RetentionPreviewState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; preview: RetentionPreview };

export type RetentionRunPhase =
  | { kind: "idle" }
  | { kind: "confirming"; error: string | null };

export type RetentionNotice = { ok: boolean; message: string };

export type RetentionController = {
  load: RetentionLoad;
  enabled: boolean;
  daysText: string;
  daysError: string | null;
  saving: boolean;
  notice: RetentionNotice | null;
  preview: RetentionPreviewState;
  run: RetentionRunPhase;
  reload: () => void;
  setEnabled: (enabled: boolean) => void;
  setDaysText: (value: string) => void;
  save: () => Promise<void>;
  loadPreview: () => Promise<void>;
  openRun: () => void;
  cancelRun: () => void;
  confirmRun: () => Promise<void>;
};

export function useRetention(): RetentionController {
  const [load, setLoad] = React.useState<RetentionLoad>({ kind: "loading" });
  const [enabled, setEnabled] = React.useState(true);
  const [daysText, setDaysTextState] = React.useState("");
  const [daysError, setDaysError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [notice, setNotice] = React.useState<RetentionNotice | null>(null);
  const [preview, setPreview] = React.useState<RetentionPreviewState>({ kind: "idle" });
  const [run, setRun] = React.useState<RetentionRunPhase>({ kind: "idle" });
  const mounted = React.useRef(true);
  const loadSequence = React.useRef(0);

  const applyStatus = React.useCallback((status: RetentionStatus) => {
    setLoad({ kind: "ready", status });
    setEnabled(status.settings.enabled);
    setDaysTextState(String(status.settings.retentionDays));
    setDaysError(null);
  }, []);

  const refresh = React.useCallback(async (showLoading: boolean) => {
    const sequence = ++loadSequence.current;
    if (showLoading) setLoad({ kind: "loading" });
    try {
      const status = await fetchRetentionStatus();
      if (mounted.current && sequence === loadSequence.current) applyStatus(status);
    } catch {
      if (mounted.current && sequence === loadSequence.current && showLoading) {
        setLoad({ kind: "error" });
      }
    }
  }, [applyStatus]);

  React.useEffect(() => {
    mounted.current = true;
    void refresh(true);
    return () => {
      mounted.current = false;
    };
  }, [refresh]);

  const save = React.useCallback(async () => {
    if (load.kind !== "ready" || load.status.envOverride !== null || saving) return;
    const retentionDays = parseDays(daysText);
    if (retentionDays === null) {
      setDaysError(retentionDaysError);
      setNotice(null);
      return;
    }
    setDaysError(null);
    setNotice(null);
    setSaving(true);
    loadSequence.current += 1;
    try {
      const status = await updateRetentionSettings({ enabled, retentionDays });
      if (!mounted.current) return;
      applyStatus(status);
      setPreview({ kind: "idle" });
      setNotice({ ok: true, message: "Retention settings saved." });
    } catch (cause) {
      if (!mounted.current) return;
      setNotice({ ok: false, message: saveErrorMessage(cause) });
    } finally {
      if (mounted.current) setSaving(false);
    }
  }, [applyStatus, daysText, enabled, load, saving]);

  const loadPreview = React.useCallback(async () => {
    setPreview({ kind: "loading" });
    try {
      const next = await fetchRetentionPreview();
      if (mounted.current) setPreview({ kind: "ready", preview: next });
    } catch {
      if (mounted.current) setPreview({ kind: "error" });
    }
  }, []);

  const confirmRun = React.useCallback(async () => {
    try {
      const result = await runRetentionNow();
      if (!mounted.current) return;
      setRun({ kind: "idle" });
      setPreview({ kind: "idle" });
      setNotice({
        ok: result.lastRun?.outcome !== "failed",
        message: result.lastRun
          ? `Retention run finished: ${retentionOutcomeLabel(result.lastRun.outcome)}.`
          : "Retention run finished.",
      });
      setLoad((current) => current.kind === "ready"
        ? { kind: "ready", status: { ...current.status, lastRun: result.lastRun } }
        : current);
      void refresh(false);
    } catch (cause) {
      if (!mounted.current) return;
      setRun({ kind: "confirming", error: runErrorMessage(cause) });
      void refresh(false);
    }
  }, [refresh]);

  return {
    load,
    enabled,
    daysText,
    daysError,
    saving,
    notice,
    preview,
    run,
    reload: () => void refresh(true),
    setEnabled,
    setDaysText: (value) => {
      setDaysTextState(value);
      setDaysError(null);
    },
    save,
    loadPreview,
    openRun: () => {
      setNotice(null);
      setRun({ kind: "confirming", error: null });
    },
    cancelRun: () => setRun({ kind: "idle" }),
    confirmRun,
  };
}

export function parseDays(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const days = Number(trimmed);
  return days >= retentionMinDays && days <= retentionMaxDays ? days : null;
}

export function retentionOutcomeLabel(outcome: string): string {
  switch (outcome) {
    case "ok":
      return "Completed";
    case "partial":
      return "Partially completed";
    case "nothing_due":
      return "Nothing due";
    case "failed":
      return "Failed";
    case "skipped":
      return "Skipped";
    default:
      return humanize(outcome);
  }
}

export function humanize(value: string): string {
  const text = value.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function errorStatus(cause: unknown): number | undefined {
  return cause instanceof RavenApiError || cause instanceof RavenTransportError
    ? cause.status
    : undefined;
}

function isRefused(status: number | undefined): boolean {
  // 401 expired session, 403 missing maintenance header, 421 wrong Origin/Host.
  return status === 401 || status === 403 || status === 421;
}

const refusedMessage =
  "Raven refused the request from this page. Reload the page and try again.";

function saveErrorMessage(cause: unknown): string {
  if (isRefused(errorStatus(cause))) return refusedMessage;
  if (cause instanceof RavenApiError && cause.fields.retention_days?.length) {
    return `Couldn't save retention settings. ${retentionDaysError}`;
  }
  return "Couldn't save retention settings. Try again.";
}

function runErrorMessage(cause: unknown): string {
  const status = errorStatus(cause);
  const code = cause instanceof RavenApiError ? cause.code : null;
  if (code === "retention_in_progress" || status === 409) {
    return "A retention run is already in progress. Try again after it finishes.";
  }
  if (isRefused(status)) return refusedMessage;
  return "Couldn't run retention. Check the last run below before trying again.";
}
