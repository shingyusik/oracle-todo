import { describe, expect, it } from "vitest";

import {
  decodeRetentionPreview,
  decodeRetentionRunResult,
  decodeRetentionStatus,
} from "@/features/workbench/api/retention";
import { RavenTransportError } from "@/lib/raven-api";

const status = {
  settings: { enabled: true, retention_days: 30, backup_keep: 3 },
  env_override: null,
  schedule: {
    interval_hours: 24,
    scheduler_active: true,
    next_run_at: "2026-11-20T03:00:00Z",
  },
  last_run: {
    run_id: "run-1",
    trigger: "scheduled",
    started_at: "2026-11-19T03:00:00Z",
    finished_at: "2026-11-19T03:00:05Z",
    outcome: "partial",
    domains: {
      todo: { status: "ok", purged: { todo_item: 4 }, skipped: { referenced: 1 } },
      ledger: { status: "failed", purged: {}, skipped: {} },
      health: { status: "nothing_due", purged: {}, skipped: {} },
    },
    backup: { name: "20261119T030000Z" },
    media_cleanup_pending: 2,
  },
};

describe("retention API decoders", () => {
  it("decodes the settings response", () => {
    expect(decodeRetentionStatus(status)).toEqual({
      settings: { enabled: true, retentionDays: 30, backupKeep: 3 },
      envOverride: null,
      schedule: {
        intervalHours: 24,
        schedulerActive: true,
        nextRunAt: "2026-11-20T03:00:00Z",
      },
      lastRun: {
        runId: "run-1",
        trigger: "scheduled",
        startedAt: "2026-11-19T03:00:00Z",
        finishedAt: "2026-11-19T03:00:05Z",
        outcome: "partial",
        domains: {
          todo: { status: "ok", purged: { todo_item: 4 }, skipped: { referenced: 1 } },
          ledger: { status: "failed", purged: {}, skipped: {} },
          health: { status: "nothing_due", purged: {}, skipped: {} },
        },
        backupName: "20261119T030000Z",
        mediaCleanupPending: 2,
      },
    });
  });

  it("accepts a never-run, env-disabled store", () => {
    const decoded = decodeRetentionStatus({
      ...status,
      env_override: "disabled",
      schedule: { interval_hours: 24, scheduler_active: false, next_run_at: null },
      last_run: null,
    });
    expect(decoded.envOverride).toBe("disabled");
    expect(decoded.lastRun).toBeNull();
    expect(decoded.schedule.nextRunAt).toBeNull();
  });

  it("rejects malformed counts and unknown env overrides", () => {
    expect(() => decodeRetentionStatus({ ...status, env_override: "off" }))
      .toThrow(RavenTransportError);
    expect(() => decodeRetentionStatus({
      ...status,
      last_run: {
        ...status.last_run,
        domains: { todo: { status: "ok", purged: { todo_item: -1 }, skipped: {} } },
      },
    })).toThrow(RavenTransportError);
  });

  it("decodes the run result", () => {
    expect(decodeRetentionRunResult({ last_run: status.last_run }).lastRun?.runId)
      .toBe("run-1");
  });

  it("decodes previews including unavailable domains", () => {
    expect(decodeRetentionPreview({
      cutoff: "2026-10-20T00:00:00Z",
      retention_days: 30,
      domains: {
        todo: {
          status: "ok",
          counts: { todo_item: 3 },
          skipped: { routine_anchor: 1 },
          items: [{
            kind: "todo_item",
            id: "a",
            label: "Old task",
            archived_at: "2026-09-01T00:00:00Z",
          }],
          truncated: true,
        },
        ledger: { status: "not_initialized", counts: {}, skipped: {}, items: [], truncated: false },
        health: { status: "unavailable" },
      },
    })).toEqual({
      cutoff: "2026-10-20T00:00:00Z",
      retentionDays: 30,
      domains: {
        todo: {
          status: "ok",
          counts: { todo_item: 3 },
          skipped: { routine_anchor: 1 },
          items: [{
            kind: "todo_item",
            id: "a",
            label: "Old task",
            archivedAt: "2026-09-01T00:00:00Z",
          }],
          truncated: true,
        },
        ledger: { status: "not_initialized", counts: {}, skipped: {}, items: [], truncated: false },
        health: { status: "unavailable", counts: {}, skipped: {}, items: [], truncated: false },
      },
    });
  });
});
