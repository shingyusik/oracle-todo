"use client";

import React from "react";
import { createPortal } from "react-dom";

import {
  retentionDomains,
  retentionMaxDays,
  retentionMinDays,
  type RetentionCounts,
  type RetentionDomain,
  type RetentionDomainPreview,
  type RetentionDomainRun,
  type RetentionPreview,
  type RetentionStatus,
} from "@/features/workbench/api/retention";
import {
  humanize,
  retentionOutcomeLabel,
  useRetention,
  type RetentionController,
} from "@/features/workbench/hooks/useRetention";
import { DestructiveConfirmationDialog } from "@/features/workbench/ui/DestructiveConfirmationDialog";
import { useModalIsolation } from "@/features/workbench/ui/modal-lifecycle";

type RetentionSettingsDialogProps = {
  onClose: () => void;
  /** Receives focus when the dialog closes. */
  returnFocusRef: React.RefObject<HTMLElement | null>;
};

const domainLabels: Record<RetentionDomain, string> = {
  todo: "ToDo",
  ledger: "Ledger",
  health: "Health Journal",
};

const kindLabels: Record<string, readonly [string, string]> = {
  todo_item: ["ToDo item", "ToDo items"],
  ledger_entry: ["transaction", "transactions"],
  ledger_transfer: ["transfer", "transfers"],
  health_diet: ["diet record", "diet records"],
  health_bowel: ["bowel record", "bowel records"],
  health_medication: ["medication record", "medication records"],
  health_metric: ["health metric", "health metrics"],
  health_media: ["media file", "media files"],
};

const skipReasonLabels: Record<string, string> = {
  referenced: "still referenced",
  routine_anchor: "routine anchor",
  future_occurrence: "future occurrence",
  unparseable_timestamp: "unreadable timestamp",
  invalid_transfer_pair: "invalid transfer pair",
  media_shared: "shared media",
  changed_since_plan: "changed during the run",
};

export function RetentionSettingsDialog(props: RetentionSettingsDialogProps) {
  const [host, setHost] = React.useState<HTMLElement | null>(null);

  React.useLayoutEffect(() => {
    const element = document.createElement("div");
    element.dataset.ravenModalHost = "";
    document.body.append(element);
    setHost(element);
    return () => element.remove();
  }, []);

  return host ? createPortal(<RetentionDialogContent {...props} />, host) : null;
}

function RetentionDialogContent({ onClose, returnFocusRef }: RetentionSettingsDialogProps) {
  const controller = useRetention();
  const dialogRef = React.useRef<HTMLElement>(null);
  const runButtonRef = React.useRef<HTMLButtonElement>(null);
  const busy = controller.saving;
  useModalIsolation(dialogRef, controller.run.kind === "idle", "body");

  React.useEffect(() => {
    dialogRef.current?.focus();
    return () => {
      if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus();
    };
  }, [returnFocusRef]);

  function handleKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (!busy) onClose();
      return;
    }
    if (event.key !== "Tab" || !dialogRef.current) return;
    event.stopPropagation();
    const focusables = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
      "input:not([disabled]), button:not([disabled])",
    ));
    const index = focusables.indexOf(document.activeElement as HTMLElement);
    if (!event.shiftKey && index === focusables.length - 1) {
      event.preventDefault();
      focusables[0]?.focus();
    } else if (event.shiftKey && index <= 0) {
      event.preventDefault();
      focusables.at(-1)?.focus();
    }
  }

  const { load } = controller;
  const status = load.kind === "ready" ? load.status : null;

  return (
    <div className="confirmation-backdrop">
      <section
        ref={dialogRef}
        className="confirmation-dialog retention-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Data retention"
        aria-busy={busy || load.kind === "loading"}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <h2>Data retention</h2>
        <p className="retention-intro">
          Archived, dropped, and cancelled ToDo items, archived Ledger transactions, and
          archived Health Journal records are permanently deleted once they are older than the
          retention period. Raven backs up the affected data before each run.
        </p>
        {load.kind === "loading" ? (
          <p className="items-message">Loading retention settings…</p>
        ) : null}
        {load.kind === "error" ? (
          <div className="items-message ledger-load-error" role="alert">
            <p>Couldn&apos;t load retention settings.</p>
            <button type="button" className="items-toolbar-button" onClick={controller.reload}>
              Retry
            </button>
          </div>
        ) : null}
        {status ? (
          <RetentionBody
            controller={controller}
            status={status}
            runButtonRef={runButtonRef}
          />
        ) : null}
        <div className="dialog-actions retention-dialog-footer">
          <button
            type="button"
            className="items-toolbar-button"
            disabled={busy}
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </section>
      {status && controller.run.kind === "confirming" ? (
        <DestructiveConfirmationDialog
          title="Permanently delete archived data?"
          description={`Raven first backs up the affected databases, then permanently deletes ToDo, Ledger, and Health Journal records archived more than ${status.settings.retentionDays} days ago, including their history and attached media. Deleted records can only be restored from that backup.`}
          confirmLabel="Back up and delete"
          error={controller.run.error}
          fallbackFocusRef={runButtonRef}
          onCancel={controller.cancelRun}
          onConfirm={controller.confirmRun}
        />
      ) : null}
    </div>
  );
}

function RetentionBody({
  controller,
  status,
  runButtonRef,
}: {
  controller: RetentionController;
  status: RetentionStatus;
  runButtonRef: React.RefObject<HTMLButtonElement>;
}) {
  const daysId = React.useId();
  const daysHintId = `${daysId}-hint`;
  const daysErrorId = `${daysId}-error`;
  const locked = status.envOverride !== null;
  const controlsDisabled = locked || controller.saving;
  const { notice, preview } = controller;

  return (
    <>
      {locked ? (
        <p className="items-message retention-notice">
          Retention is turned off by the RAVEN_RETENTION environment setting. Settings and
          manual runs are unavailable until it is removed and Raven restarts.
        </p>
      ) : null}
      <form
        className="retention-settings-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void controller.save();
        }}
      >
        <label className="field-checkbox">
          <input
            type="checkbox"
            checked={controller.enabled}
            disabled={controlsDisabled}
            onChange={(event) => controller.setEnabled(event.target.checked)}
          />
          Delete archived data automatically
        </label>
        <label className="field-label" htmlFor={daysId}>
          Retention days
          <input
            id={daysId}
            type="number"
            inputMode="numeric"
            min={retentionMinDays}
            max={retentionMaxDays}
            step={1}
            value={controller.daysText}
            disabled={controlsDisabled}
            aria-invalid={controller.daysError ? true : undefined}
            aria-describedby={controller.daysError ? `${daysErrorId} ${daysHintId}` : daysHintId}
            onChange={(event) => controller.setDaysText(event.target.value)}
          />
        </label>
        {controller.daysError ? (
          <p id={daysErrorId} className="retention-field-error">{controller.daysError}</p>
        ) : null}
        <p id={daysHintId} className="retention-hint">
          Records are deleted this many days after they were archived ({retentionMinDays}–
          {retentionMaxDays}).
        </p>
        <div className="dialog-actions">
          <button
            type="submit"
            className="items-toolbar-button button-primary retention-button"
            disabled={controlsDisabled}
          >
            {controller.saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
      {notice ? (
        <p
          className="retention-result"
          data-ok={notice.ok}
          role={notice.ok ? "status" : "alert"}
        >
          {notice.message}
        </p>
      ) : null}
      <section className="retention-section" aria-label="Schedule">
        <dl className="retention-summary">
          <dt>Next run</dt>
          <dd>{nextRunText(status)}</dd>
        </dl>
      </section>
      <LastRun status={status} />
      <div className="dialog-actions retention-run-actions">
        <button
          type="button"
          className="items-toolbar-button retention-button"
          disabled={preview.kind === "loading"}
          aria-busy={preview.kind === "loading"}
          onClick={() => void controller.loadPreview()}
        >
          Preview
        </button>
        <button
          ref={runButtonRef}
          type="button"
          className="items-toolbar-button retention-button retention-danger"
          disabled={locked || controller.run.kind !== "idle"}
          onClick={controller.openRun}
        >
          Run now
        </button>
      </div>
      {preview.kind !== "idle" ? (
        <section className="retention-section" aria-label="Preview">
          <h3>Preview</h3>
          {preview.kind === "loading" ? <p>Loading preview…</p> : null}
          {preview.kind === "error" ? (
            <p className="retention-field-error">Couldn&apos;t load the preview. Try again.</p>
          ) : null}
          {preview.kind === "ready" ? <PreviewResult preview={preview.preview} /> : null}
        </section>
      ) : null}
    </>
  );
}

function nextRunText(status: RetentionStatus): string {
  if (status.envOverride !== null) return "Turned off by RAVEN_RETENTION";
  if (!status.settings.enabled) return "Automatic deletion is off";
  if (!status.schedule.schedulerActive) return "Runs only while Raven UI or API is running";
  return status.schedule.nextRunAt
    ? `${formatDateTime(status.schedule.nextRunAt)} (every ${status.schedule.intervalHours} hours)`
    : `Every ${status.schedule.intervalHours} hours`;
}

function LastRun({ status }: { status: RetentionStatus }) {
  const run = status.lastRun;
  return (
    <section className="retention-section" aria-label="Last run">
      <h3>Last run</h3>
      {run === null ? <p>Retention has not run yet.</p> : (
        <>
          <dl className="retention-summary">
            <dt>Finished</dt>
            <dd>{formatDateTime(run.finishedAt ?? run.startedAt)}</dd>
            <dt>Outcome</dt>
            <dd>{retentionOutcomeLabel(run.outcome)}</dd>
            <dt>Trigger</dt>
            <dd>{humanize(run.trigger)}</dd>
            {retentionDomains.map((domain) => {
              const entry = run.domains[domain];
              return entry ? (
                <React.Fragment key={domain}>
                  <dt>{domainLabels[domain]}</dt>
                  <dd><DomainRunSummary entry={entry} /></dd>
                </React.Fragment>
              ) : null;
            })}
            {run.backupName ? (
              <>
                <dt>Backup</dt>
                <dd><code>{run.backupName}</code></dd>
              </>
            ) : null}
          </dl>
          {run.mediaCleanupPending > 0 ? (
            <p className="retention-warning">
              {run.mediaCleanupPending === 1
                ? "1 media file is waiting for cleanup."
                : `${run.mediaCleanupPending} media files are waiting for cleanup.`}
              {" "}Raven retries removing them later.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

function DomainRunSummary({ entry }: { entry: RetentionDomainRun }) {
  const skipped = skippedText(entry.skipped);
  let main: string;
  if (entry.status === "ok") main = countsText(entry.purged) ?? "Nothing deleted";
  else if (entry.status === "failed") main = "Failed";
  else if (entry.status === "nothing_due") main = "Nothing due";
  else if (entry.status === "unavailable") main = "Unavailable";
  else main = humanize(entry.status);
  return (
    <span className="retention-domain-summary">
      <span>{main}</span>
      {skipped ? <span className="retention-muted">{skipped}</span> : null}
    </span>
  );
}

function PreviewResult({ preview }: { preview: RetentionPreview }) {
  return (
    <>
      <p>
        Records archived before {formatDateTime(preview.cutoff)} ({preview.retentionDays}{" "}
        days) would be deleted.
      </p>
      {retentionDomains.map((domain) => {
        const entry = preview.domains[domain];
        return entry
          ? <PreviewDomain key={domain} domain={domain} entry={entry} />
          : null;
      })}
    </>
  );
}

function PreviewDomain({
  domain,
  entry,
}: {
  domain: RetentionDomain;
  entry: RetentionDomainPreview;
}) {
  const headingId = React.useId();
  const label = domainLabels[domain];
  const total = Object.values(entry.counts).reduce((sum, value) => sum + value, 0);
  const remaining = entry.truncated ? Math.max(0, total - entry.items.length) : 0;
  const counts = countsText(entry.counts);
  const skipped = skippedText(entry.skipped);

  return (
    <div className="retention-preview-domain" role="group" aria-labelledby={headingId}>
      <h4 id={headingId}>{label}</h4>
      {entry.status === "not_initialized" ? <p>Not set up yet.</p> : null}
      {entry.status === "unavailable" ? (
        <p className="retention-field-error">Couldn&apos;t read this store.</p>
      ) : null}
      {entry.status === "ok" ? (
        <>
          <p>{counts ?? "Nothing due."}</p>
          {skipped ? <p className="retention-muted">{skipped}</p> : null}
          {entry.items.length > 0 ? (
            <div className="retention-preview-table-wrap">
              <table
                className="retention-preview-table"
                aria-label={`${label} records due for deletion`}
              >
                <thead>
                  <tr>
                    <th scope="col">Kind</th>
                    <th scope="col">Record</th>
                    <th scope="col">Archived</th>
                  </tr>
                </thead>
                <tbody>
                  {entry.items.map((item) => (
                    <tr key={`${item.kind}:${item.id}`}>
                      <td>{capitalize(kindLabel(item.kind, 1))}</td>
                      <td>{item.label || "Untitled"}</td>
                      <td><time dateTime={item.archivedAt}>{formatDate(item.archivedAt)}</time></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {remaining > 0 ? <p className="retention-muted">and {remaining} more</p> : null}
        </>
      ) : null}
    </div>
  );
}

function countsText(counts: RetentionCounts): string | null {
  const parts = Object.entries(counts)
    .filter(([, value]) => value > 0)
    .map(([kind, value]) => `${value} ${kindLabel(kind, value)}`);
  return parts.length > 0 ? parts.join(", ") : null;
}

function skippedText(skipped: RetentionCounts): string | null {
  const parts = Object.entries(skipped)
    .filter(([, value]) => value > 0)
    .map(([reason, value]) =>
      `${value} skipped: ${skipReasonLabels[reason] ?? reason.replace(/_/g, " ")}`);
  return parts.length > 0 ? parts.join(", ") : null;
}

function kindLabel(kind: string, count: number): string {
  const labels = kindLabels[kind];
  if (!labels) return kind.replace(/_/g, " ");
  return count === 1 ? labels[0] : labels[1];
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

function formatDateTime(value: string): string {
  return dateTimeFormat.format(new Date(value));
}

function formatDate(value: string): string {
  return dateFormat.format(new Date(value));
}
