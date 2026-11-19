import {
  apiPath,
  array,
  boolean,
  id,
  jsonRequest,
  nonEmptyString,
  nullableTimestamp,
  RavenTransportError,
  record,
  requestJson,
  safeInteger,
  string,
  timestamp,
} from "@/lib/raven-api";

export const retentionDomains = ["todo", "ledger", "health"] as const;
export type RetentionDomain = typeof retentionDomains[number];

/** Non-negative counts keyed by record kind or skip reason. */
export type RetentionCounts = Record<string, number>;

export type RetentionSettings = {
  enabled: boolean;
  retentionDays: number;
  backupKeep: number;
};

export type RetentionDomainRun = {
  status: string;
  purged: RetentionCounts;
  skipped: RetentionCounts;
};

export type RetentionRun = {
  runId: string;
  trigger: string;
  startedAt: string;
  finishedAt: string | null;
  outcome: string;
  domains: Partial<Record<RetentionDomain, RetentionDomainRun>>;
  backupName: string | null;
  mediaCleanupPending: number;
};

export type RetentionStatus = {
  settings: RetentionSettings;
  envOverride: "disabled" | null;
  schedule: {
    intervalHours: number;
    schedulerActive: boolean;
    nextRunAt: string | null;
  };
  lastRun: RetentionRun | null;
};

export type RetentionPreviewItem = {
  kind: string;
  id: string;
  label: string;
  archivedAt: string;
};

export type RetentionDomainPreview = {
  status: "ok" | "unavailable" | "not_initialized";
  counts: RetentionCounts;
  skipped: RetentionCounts;
  items: RetentionPreviewItem[];
  truncated: boolean;
};

export type RetentionPreview = {
  cutoff: string;
  retentionDays: number;
  domains: Partial<Record<RetentionDomain, RetentionDomainPreview>>;
};

export type RetentionRunResult = { lastRun: RetentionRun | null };

export type RetentionSettingsUpdate = {
  enabled: boolean;
  retentionDays: number;
};

export const retentionMinDays = 7;
export const retentionMaxDays = 3650;
export const retentionPreviewLimit = 50;

export const retentionPath = "/api/v1/maintenance/retention";
export const retentionPreviewPath = "/api/v1/maintenance/retention/preview";
export const retentionRunPath = "/api/v1/maintenance/retention/run";

export function decodeRetentionStatus(value: unknown): RetentionStatus {
  const body = record(value, "retention");
  const settings = record(body.settings, "settings");
  const schedule = record(body.schedule, "schedule");
  const envOverride = body.env_override ?? null;
  if (envOverride !== null && envOverride !== "disabled") {
    throw new RavenTransportError("protocol");
  }
  return {
    settings: {
      enabled: boolean(settings.enabled, "settings.enabled"),
      retentionDays: count(settings.retention_days, "settings.retention_days"),
      backupKeep: count(settings.backup_keep, "settings.backup_keep"),
    },
    envOverride,
    schedule: {
      intervalHours: count(schedule.interval_hours, "schedule.interval_hours"),
      schedulerActive: boolean(schedule.scheduler_active, "schedule.scheduler_active"),
      nextRunAt: nullableTimestamp(schedule.next_run_at ?? null, "schedule.next_run_at"),
    },
    lastRun: decodeRun(body.last_run ?? null),
  };
}

export function decodeRetentionRunResult(value: unknown): RetentionRunResult {
  const body = record(value, "retention_run");
  return { lastRun: decodeRun(body.last_run ?? null) };
}

export function decodeRetentionPreview(value: unknown): RetentionPreview {
  const body = record(value, "retention_preview");
  const domains = record(body.domains, "domains");
  const decoded: Partial<Record<RetentionDomain, RetentionDomainPreview>> = {};
  for (const domain of retentionDomains) {
    if (domains[domain] === undefined) continue;
    decoded[domain] = decodeDomainPreview(domains[domain], `domains.${domain}`);
  }
  return {
    cutoff: timestamp(body.cutoff, "cutoff"),
    retentionDays: count(body.retention_days, "retention_days"),
    domains: decoded,
  };
}

export function fetchRetentionStatus(signal?: AbortSignal): Promise<RetentionStatus> {
  return requestJson(retentionPath, { signal }, decodeRetentionStatus);
}

export function updateRetentionSettings(
  update: RetentionSettingsUpdate,
): Promise<RetentionStatus> {
  return requestJson(
    retentionPath,
    jsonRequest("PUT", {
      enabled: update.enabled,
      retention_days: update.retentionDays,
    }),
    decodeRetentionStatus,
  );
}

export function fetchRetentionPreview(
  limit = retentionPreviewLimit,
): Promise<RetentionPreview> {
  return requestJson(
    apiPath(retentionPreviewPath, { limit }),
    undefined,
    decodeRetentionPreview,
  );
}

export function runRetentionNow(): Promise<RetentionRunResult> {
  const init = jsonRequest("POST");
  return requestJson(
    retentionRunPath,
    { ...init, headers: { "X-Raven-Maintenance": "1" } },
    decodeRetentionRunResult,
  );
}

function decodeRun(value: unknown): RetentionRun | null {
  if (value === null) return null;
  const run = record(value, "last_run");
  const domains = record(run.domains, "last_run.domains");
  const decodedDomains: Partial<Record<RetentionDomain, RetentionDomainRun>> = {};
  for (const domain of retentionDomains) {
    if (domains[domain] === undefined) continue;
    const field = `last_run.domains.${domain}`;
    const entry = record(domains[domain], field);
    decodedDomains[domain] = {
      status: nonEmptyString(entry.status, `${field}.status`),
      purged: counts(entry.purged ?? {}, `${field}.purged`),
      skipped: counts(entry.skipped ?? {}, `${field}.skipped`),
    };
  }
  const backup = run.backup ?? null;
  return {
    runId: id(run.run_id, "last_run.run_id"),
    trigger: nonEmptyString(run.trigger, "last_run.trigger"),
    startedAt: timestamp(run.started_at, "last_run.started_at"),
    finishedAt: nullableTimestamp(run.finished_at ?? null, "last_run.finished_at"),
    outcome: nonEmptyString(run.outcome, "last_run.outcome"),
    domains: decodedDomains,
    backupName: backup === null
      ? null
      : nonEmptyString(record(backup, "last_run.backup").name, "last_run.backup.name"),
    mediaCleanupPending: count(run.media_cleanup_pending ?? 0, "last_run.media_cleanup_pending"),
  };
}

function decodeDomainPreview(value: unknown, field: string): RetentionDomainPreview {
  const entry = record(value, field);
  const status = entry.status;
  if (status !== "ok" && status !== "unavailable" && status !== "not_initialized") {
    throw new RavenTransportError("protocol");
  }
  return {
    status,
    counts: counts(entry.counts ?? {}, `${field}.counts`),
    skipped: counts(entry.skipped ?? {}, `${field}.skipped`),
    items: array(entry.items ?? [], `${field}.items`).map((item, index) => {
      const itemField = `${field}.items.${index}`;
      const body = record(item, itemField);
      return {
        kind: nonEmptyString(body.kind, `${itemField}.kind`),
        id: id(body.id, `${itemField}.id`),
        label: string(body.label, `${itemField}.label`),
        archivedAt: timestamp(body.archived_at, `${itemField}.archived_at`),
      };
    }),
    truncated: boolean(entry.truncated ?? false, `${field}.truncated`),
  };
}

function counts(value: unknown, field: string): RetentionCounts {
  return Object.fromEntries(Object.entries(record(value, field))
    .map(([key, item]) => [key, count(item, `${field}.${key}`)]));
}

function count(value: unknown, field: string): number {
  const result = safeInteger(value, field);
  if (result < 0) throw new RavenTransportError("protocol");
  return result;
}
