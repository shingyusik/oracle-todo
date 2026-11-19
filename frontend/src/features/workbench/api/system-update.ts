import {
  apiPath,
  boolean,
  jsonRequest,
  nonEmptyString,
  nullableString,
  nullableTimestamp,
  RavenTransportError,
  record,
  requestJson,
} from "@/lib/raven-api";

export type SystemVersion = {
  currentVersion: string;
  uiVersion: string | null;
  latestVersion: string | null;
  updateAvailable: boolean;
  updateSupported: boolean;
  checkedAt: string | null;
  checkError: string | null;
  releaseUrl: string | null;
};

export type SystemUpdateAccepted = {
  status: "restarting";
  targetVersion: string;
};

export const systemVersionPath = "/api/v1/system/version";
export const systemUpdatePath = "/api/v1/system/update";
export const healthPath = "/healthz";
export const sessionBootstrapPath = "/__raven/session";

export function decodeSystemVersion(value: unknown): SystemVersion {
  const body = record(value, "system_version");
  return {
    currentVersion: nonEmptyString(body.current_version, "current_version"),
    uiVersion: nullableString(body.ui_version ?? null, "ui_version"),
    latestVersion: nullableString(body.latest_version ?? null, "latest_version"),
    updateAvailable: boolean(body.update_available, "update_available"),
    updateSupported: boolean(body.update_supported, "update_supported"),
    checkedAt: nullableTimestamp(body.checked_at ?? null, "checked_at"),
    checkError: nullableString(body.check_error ?? null, "check_error"),
    releaseUrl: nullableString(body.release_url ?? null, "release_url"),
  };
}

export function decodeSystemUpdateAccepted(value: unknown): SystemUpdateAccepted {
  const body = record(value, "system_update");
  if (body.status !== "restarting") {
    throw new RavenTransportError("protocol");
  }
  return {
    status: "restarting",
    targetVersion: nonEmptyString(body.target_version, "target_version"),
  };
}

export function fetchSystemVersion(
  options: { refresh?: boolean; signal?: AbortSignal } = {},
): Promise<SystemVersion> {
  return requestJson(
    apiPath(systemVersionPath, options.refresh ? { refresh: 1 } : undefined),
    { signal: options.signal },
    decodeSystemVersion,
  );
}

export function requestSystemUpdate(
  targetVersion: string,
): Promise<SystemUpdateAccepted> {
  const init = jsonRequest("POST", { target_version: targetVersion });
  return requestJson(
    systemUpdatePath,
    {
      ...init,
      headers: {
        ...init.headers as Record<string, string>,
        "X-Raven-Update": "1",
      },
    },
    decodeSystemUpdateAccepted,
  );
}

/**
 * Probes the unauthenticated health endpoint. Resolves to the reported version, or
 * `null` while Raven is restarting (unreachable, non-OK, or malformed answer).
 */
export async function probeHealthVersion(timeoutMs: number): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(healthPath, {
      cache: "no-store",
      credentials: "same-origin",
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const body = record(await response.json(), "healthz");
    return body.status === "ok" && typeof body.version === "string" && body.version
      ? body.version
      : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function reloadRavenSession(): void {
  window.location.assign(sessionBootstrapPath);
}
