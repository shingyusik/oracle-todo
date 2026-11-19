"use client";

import React from "react";

import {
  fetchSystemVersion,
  probeHealthVersion,
  reloadRavenSession,
  requestSystemUpdate,
  type SystemVersion,
} from "@/features/workbench/api/system-update";
import { RavenApiError, RavenTransportError } from "@/lib/raven-api";

export const versionRefreshIntervalMs = 6 * 60 * 60 * 1000;
export const healthPollIntervalMs = 1500;
export const healthPollTimeoutMs = 3 * 60 * 1000;
const healthProbeTimeoutMs = 3000;
export const pendingUpdateStorageKey = "raven.update.pending";

export type UpdateResult = { ok: boolean; message: string };

export type SystemUpdatePhase =
  | { kind: "idle" }
  | { kind: "confirming"; targetVersion: string; error: string | null }
  | { kind: "restarting"; targetVersion: string };

export type SystemUpdateController = {
  version: SystemVersion | null;
  /** The last version check failed or GitHub could not be reached. */
  checkFailed: boolean;
  checking: boolean;
  /** Newer release offered by the server, or null. */
  availableVersion: string | null;
  phase: SystemUpdatePhase;
  result: UpdateResult | null;
  checkNow: () => void;
  openConfirmation: () => void;
  cancelConfirmation: () => void;
  confirmUpdate: () => Promise<void>;
  dismissResult: () => void;
};

type PendingUpdate = { from: string; target: string };

export function useSystemUpdate(): SystemUpdateController {
  const [version, setVersion] = React.useState<SystemVersion | null>(null);
  const [loadFailed, setLoadFailed] = React.useState(false);
  const [checking, setChecking] = React.useState(false);
  const [phase, setPhase] = React.useState<SystemUpdatePhase>({ kind: "idle" });
  const [result, setResult] = React.useState<UpdateResult | null>(null);
  const mounted = React.useRef(true);
  const loadSequence = React.useRef(0);
  const pollAbort = React.useRef<AbortController | null>(null);

  const load = React.useCallback(async (refresh: boolean) => {
    const sequence = ++loadSequence.current;
    if (refresh) setChecking(true);
    try {
      const next = await fetchSystemVersion({ refresh });
      if (!mounted.current || sequence !== loadSequence.current) return;
      setVersion(next);
      setLoadFailed(false);
      const pending = takePendingUpdate();
      if (pending) {
        setResult(next.currentVersion === pending.target
          ? { ok: true, message: `Updated to v${pending.target}` }
          : { ok: false, message: `Update failed, still on v${next.currentVersion}` });
      }
    } catch {
      if (mounted.current && sequence === loadSequence.current) setLoadFailed(true);
    } finally {
      if (mounted.current && sequence === loadSequence.current) setChecking(false);
    }
  }, []);

  React.useEffect(() => {
    mounted.current = true;
    void load(false);
    const timer = setInterval(() => void load(false), versionRefreshIntervalMs);
    return () => {
      mounted.current = false;
      clearInterval(timer);
      pollAbort.current?.abort();
    };
  }, [load]);

  const availableVersion = version?.updateAvailable
    && version.latestVersion
    && version.latestVersion !== version.currentVersion
    ? version.latestVersion
    : null;

  const waitForRestart = React.useCallback(async (pending: PendingUpdate) => {
    const controller = new AbortController();
    pollAbort.current = controller;
    const deadline = Date.now() + healthPollTimeoutMs;
    let sawDown = false;
    let lastVersion: string | null = null;
    while (Date.now() < deadline) {
      await sleep(healthPollIntervalMs, controller.signal);
      if (controller.signal.aborted) return;
      const answered = await probeHealthVersion(healthProbeTimeoutMs);
      if (controller.signal.aborted) return;
      if (answered === null) {
        sawDown = true;
        continue;
      }
      lastVersion = answered;
      if (sawDown || answered !== pending.from) {
        reloadRavenSession();
        return;
      }
    }
    if (!mounted.current) return;
    takePendingUpdate();
    setPhase({ kind: "idle" });
    setResult({
      ok: false,
      message: lastVersion
        ? `Update failed, still on v${lastVersion}`
        : "Update failed: Raven did not come back within 3 minutes. Reload to check.",
    });
  }, []);

  const confirmUpdate = React.useCallback(async () => {
    if (phase.kind !== "confirming" || !version) return;
    const target = phase.targetVersion;
    try {
      await requestSystemUpdate(target);
    } catch (cause) {
      if (!mounted.current) return;
      setPhase({ kind: "confirming", targetVersion: target, error: updateErrorMessage(cause) });
      return;
    }
    if (!mounted.current) return;
    const pending = { from: version.currentVersion, target };
    storePendingUpdate(pending);
    setResult(null);
    setPhase({ kind: "restarting", targetVersion: target });
    void waitForRestart(pending);
  }, [phase, version, waitForRestart]);

  return {
    version,
    checkFailed: loadFailed || version?.checkError != null,
    checking,
    availableVersion,
    phase,
    result,
    checkNow: () => void load(true),
    openConfirmation: () => {
      if (availableVersion && version?.updateSupported) {
        setPhase({ kind: "confirming", targetVersion: availableVersion, error: null });
      }
    },
    cancelConfirmation: () => setPhase({ kind: "idle" }),
    confirmUpdate,
    dismissResult: () => setResult(null),
  };
}

function updateErrorMessage(cause: unknown): string {
  const code = cause instanceof RavenApiError ? cause.code : null;
  const status = cause instanceof RavenApiError || cause instanceof RavenTransportError
    ? cause.status
    : undefined;
  if (code === "update_in_progress" || status === 409) {
    return "An update is already in progress.";
  }
  if (code === "update_not_available" || status === 422) {
    return "This version is no longer available. Check for updates again.";
  }
  if (code === "update_unsupported" || status === 501) {
    return "Restart Raven through the npm wrapper to enable updates.";
  }
  // 401 expired session, 403 missing update header, 421 wrong Origin/Host.
  if (status === 401 || status === 403 || status === 421) {
    return "Raven refused the update request from this page. Reload the page and try again.";
  }
  return "Couldn't start the update. Try again.";
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
  });
}

function storePendingUpdate(pending: PendingUpdate): void {
  try {
    window.sessionStorage.setItem(pendingUpdateStorageKey, JSON.stringify(pending));
  } catch {
    // Storage may be unavailable; the post-reload message is best effort.
  }
}

function takePendingUpdate(): PendingUpdate | null {
  try {
    const raw = window.sessionStorage.getItem(pendingUpdateStorageKey);
    if (raw === null) return null;
    window.sessionStorage.removeItem(pendingUpdateStorageKey);
    const value = JSON.parse(raw) as Partial<PendingUpdate> | null;
    return typeof value?.from === "string" && typeof value.target === "string"
      ? { from: value.from, target: value.target }
      : null;
  } catch {
    return null;
  }
}
