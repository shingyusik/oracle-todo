"use client";

import React from "react";
import { createPortal } from "react-dom";

import {
  googleCalendarDurationMaxMinutes,
  googleCalendarDurationMinMinutes,
  googleCalendarPollMaxSecs,
  googleCalendarPollMinSecs,
  type GoogleCalendarCountKey,
  type GoogleCalendarCounts,
  type GoogleCalendarStatus,
} from "@/features/workbench/api/google-calendar";
import {
  createCalendarChoice,
  googleCalendarOutcomeLabel,
  humanize,
  useGoogleCalendar,
  type GoogleCalendarController,
  type GoogleCalendarRedirectResult,
} from "@/features/workbench/hooks/useGoogleCalendar";
import { DestructiveConfirmationDialog } from "@/features/workbench/ui/DestructiveConfirmationDialog";
import { useModalIsolation } from "@/features/workbench/ui/modal-lifecycle";

type GoogleCalendarDialogProps = {
  onClose: () => void;
  /** Receives focus when the dialog closes. */
  returnFocusRef: React.RefObject<HTMLElement | null>;
  /** Result of the OAuth callback redirect that opened the dialog, if any. */
  redirectResult?: GoogleCalendarRedirectResult | null;
};

const changeLabels: ReadonlyArray<readonly [GoogleCalendarCountKey, string]> = [
  ["googleCreated", "added to Google"],
  ["googleUpdated", "updated in Google"],
  ["googleDeleted", "deleted from Google"],
  ["ravenCreated", "added to Raven"],
  ["ravenUpdated", "updated in Raven"],
  ["ravenArchived", "archived in Raven"],
  ["conflicts", "conflicts resolved"],
  ["skippedRecurring", "recurring events skipped"],
  ["skippedTerminal", "closed events skipped"],
  ["failed", "failed"],
];

const previewLabels: ReadonlyArray<readonly [GoogleCalendarCountKey, string, boolean]> = [
  ["googleCreated", "Raven events to add to Google", true],
  ["ravenCreated", "Google events to add to Raven", true],
  ["googleUpdated", "Google events to update", false],
  ["ravenUpdated", "Raven events to update", false],
  ["conflicts", "Conflicts", false],
  ["skippedRecurring", "Recurring Google events skipped", false],
  ["skippedTerminal", "Closed Raven events skipped", false],
  ["failed", "Events that can't be synced", false],
];

export function GoogleCalendarDialog(props: GoogleCalendarDialogProps) {
  const [host, setHost] = React.useState<HTMLElement | null>(null);

  React.useLayoutEffect(() => {
    const element = document.createElement("div");
    element.dataset.ravenModalHost = "";
    document.body.append(element);
    setHost(element);
    return () => element.remove();
  }, []);

  return host ? createPortal(<GoogleCalendarDialogContent {...props} />, host) : null;
}

function GoogleCalendarDialogContent({
  onClose,
  returnFocusRef,
  redirectResult = null,
}: GoogleCalendarDialogProps) {
  const controller = useGoogleCalendar(redirectResult);
  const dialogRef = React.useRef<HTMLElement>(null);
  const disconnectButtonRef = React.useRef<HTMLButtonElement>(null);
  const guardButtonRef = React.useRef<HTMLButtonElement>(null);
  const busy = controller.pending !== null;
  useModalIsolation(dialogRef, controller.confirm === null, "body");

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
      "input:not([disabled]), button:not([disabled]), a[href]",
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

  const { load, notice, confirm } = controller;
  const status = load.kind === "ready" ? load.status : null;

  return (
    <div className="confirmation-backdrop">
      <section
        ref={dialogRef}
        className="confirmation-dialog retention-dialog google-calendar-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Google Calendar"
        aria-busy={busy || load.kind === "loading"}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <h2>Google Calendar</h2>
        <p className="retention-intro">
          Two-way sync between ToDo events and one Google calendar. Tasks and other ToDo
          items stay in Raven.
        </p>
        {notice ? (
          <p
            className="retention-result"
            data-ok={notice.ok}
            role={notice.ok ? "status" : "alert"}
          >
            {notice.message}
          </p>
        ) : null}
        {load.kind === "loading" ? (
          <p className="items-message">Loading Google Calendar settings…</p>
        ) : null}
        {load.kind === "error" ? (
          <div className="items-message ledger-load-error">
            <p>Couldn&apos;t load Google Calendar settings.</p>
            <button type="button" className="items-toolbar-button" onClick={controller.reload}>
              Retry
            </button>
          </div>
        ) : null}
        {status ? (
          <GoogleCalendarBody
            controller={controller}
            status={status}
            disconnectButtonRef={disconnectButtonRef}
            guardButtonRef={guardButtonRef}
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
      {status && confirm?.kind === "disconnect" ? (
        <DestructiveConfirmationDialog
          title="Disconnect Google Calendar?"
          description={controller.forgetLinks
            ? "Raven revokes its Google access and forgets all sync links. Events stay in Raven and in Google Calendar, but after reconnecting Raven treats them as unrelated and may create duplicates."
            : "Raven revokes its Google access. Events stay in Raven and in Google Calendar, and sync links are kept so reconnecting resumes where syncing left off."}
          confirmLabel="Disconnect"
          error={confirm.error}
          fallbackFocusRef={disconnectButtonRef}
          onCancel={controller.cancelConfirm}
          onConfirm={controller.confirmDisconnect}
        />
      ) : null}
      {status && confirm?.kind === "guard" ? (
        <DestructiveConfirmationDialog
          title="Allow mass deletions?"
          description="Raven syncs again without the safety limit: Google events whose Raven events were closed are deleted, and Raven events whose Google events were deleted are archived. Raven can't undo these deletions."
          confirmLabel="Sync and allow deletions"
          error={confirm.error}
          fallbackFocusRef={guardButtonRef}
          onCancel={controller.cancelConfirm}
          onConfirm={controller.confirmGuard}
        />
      ) : null}
    </div>
  );
}

function GoogleCalendarBody({
  controller,
  status,
  disconnectButtonRef,
  guardButtonRef,
}: {
  controller: GoogleCalendarController;
  status: GoogleCalendarStatus;
  disconnectButtonRef: React.RefObject<HTMLButtonElement>;
  guardButtonRef: React.RefObject<HTMLButtonElement>;
}) {
  const busy = controller.pending !== null;
  const envNotice = status.envOverride !== null ? (
    <p className="items-message retention-notice">
      Automatic sync is turned off by the RAVEN_GOOGLE_CALENDAR environment setting. Remove it
      and restart Raven to sync on a schedule.
    </p>
  ) : null;

  if (!status.configured) {
    return (
      <>
        {envNotice}
        <SetupSteps onRecheck={controller.reload} />
      </>
    );
  }

  if (status.connection === "disconnected") {
    return (
      <>
        {envNotice}
        <section className="retention-section" aria-label="Connect">
          <p>Connect your Google account, then choose which calendar to sync.</p>
          <ConnectControls controller={controller} label="Connect Google Calendar" />
        </section>
      </>
    );
  }

  const guardTripped = status.lastSync?.outcome === "guard_tripped" && status.calendar !== null;

  return (
    <>
      {envNotice}
      {status.connection === "reauth_required" ? (
        <section className="retention-section" aria-label="Reconnect">
          <p className="retention-warning">
            Google access expired or was revoked. Reconnect to resume syncing.
          </p>
          <ConnectControls controller={controller} label="Reconnect" />
        </section>
      ) : null}
      {guardTripped ? (
        <section className="retention-section" aria-label="Sync stopped">
          <p className="retention-warning">
            The last sync stopped before deleting many events at once. If those deletions are
            expected, sync again and allow them.
          </p>
          <div className="dialog-actions">
            <button
              ref={guardButtonRef}
              type="button"
              className="items-toolbar-button retention-button retention-danger"
              disabled={busy || controller.confirm !== null}
              onClick={controller.openGuard}
            >
              Sync and allow deletions
            </button>
          </div>
        </section>
      ) : null}
      {controller.choosingCalendar ? (
        <CalendarChooser controller={controller} status={status} />
      ) : status.firstSyncPending ? (
        <FirstSync controller={controller} status={status} />
      ) : (
        <ActiveSync controller={controller} status={status} />
      )}
      <section className="retention-section" aria-label="Disconnect">
        <h3>Disconnect</h3>
        <label className="field-checkbox">
          <input
            type="checkbox"
            checked={controller.forgetLinks}
            disabled={busy}
            onChange={(event) => controller.setForgetLinks(event.target.checked)}
          />
          Also forget sync links
        </label>
        <p className="retention-hint">
          Events are never deleted when you disconnect. Forgetting links means a later
          reconnect starts over with a first sync.
        </p>
        <div className="dialog-actions">
          <button
            ref={disconnectButtonRef}
            type="button"
            className="items-toolbar-button retention-button retention-danger"
            disabled={busy || controller.confirm !== null}
            onClick={controller.openDisconnect}
          >
            Disconnect
          </button>
        </div>
      </section>
    </>
  );
}

function SetupSteps({ onRecheck }: { onRecheck: () => void }) {
  return (
    <section className="retention-section" aria-label="Set up Google access">
      <h3>Set up Google access</h3>
      <p>Raven needs your own Google OAuth client before it can connect:</p>
      <ol className="google-calendar-steps">
        <li>In Google Cloud Console, create a project and enable the Google Calendar API.</li>
        <li>
          Configure the OAuth consent screen with the Calendar scopes and publish the app
          to In production.
        </li>
        <li>Create an OAuth client of type Desktop app and download its JSON file.</li>
        <li>
          On the Mac running Raven, run{" "}
          <code>raven google-calendar client set --file &lt;downloaded.json&gt;</code>, then
          delete the download.
        </li>
      </ol>
      <div className="dialog-actions">
        <button type="button" className="items-toolbar-button retention-button" onClick={onRecheck}>
          Check again
        </button>
      </div>
    </section>
  );
}

function ConnectControls({
  controller,
  label,
}: {
  controller: GoogleCalendarController;
  label: string;
}) {
  const redirectId = React.useId();
  const hintId = `${redirectId}-hint`;
  const busy = controller.pending !== null;
  const { connectFlow } = controller;

  return (
    <>
      {!controller.loopback ? (
        <p className="retention-hint">
          <strong>Connect from the Mac running Raven</strong>
          {" "}Google returns to Raven at 127.0.0.1, which only opens on that Mac. On another
          device, sign in with Google, then paste the address of the page that fails to load.
        </p>
      ) : null}
      <div className="dialog-actions">
        <button
          type="button"
          className="items-toolbar-button button-primary retention-button"
          disabled={busy}
          aria-busy={controller.pending === "connect"}
          onClick={() => void controller.connect()}
        >
          {label}
        </button>
      </div>
      {connectFlow.kind === "awaiting_redirect" ? (
        <form
          className="retention-settings-form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void controller.completeConnect();
          }}
        >
          <p>
            <a
              className="items-toolbar-button retention-button"
              href={connectFlow.authorizationUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open Google sign-in
            </a>
          </p>
          <label className="field-label" htmlFor={redirectId}>
            Redirect URL
            <input
              id={redirectId}
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              value={controller.redirectText}
              disabled={busy}
              aria-describedby={hintId}
              onChange={(event) => controller.setRedirectText(event.target.value)}
            />
          </label>
          <p id={hintId} className="retention-hint">
            After approving access, copy the full address from the page that failed to load. It
            starts with http://127.0.0.1:3001/.
          </p>
          <div className="dialog-actions">
            <button
              type="submit"
              className="items-toolbar-button button-primary retention-button"
              disabled={busy || controller.redirectText.trim() === ""}
            >
              {controller.pending === "complete" ? "Connecting…" : "Finish connecting"}
            </button>
          </div>
        </form>
      ) : null}
    </>
  );
}

function CalendarChooser({
  controller,
  status,
}: {
  controller: GoogleCalendarController;
  status: GoogleCalendarStatus;
}) {
  const name = React.useId();
  const { calendars } = controller;
  const busy = controller.pending !== null;
  const current = controller.changingCalendar ? status.calendar : null;

  return (
    <section className="retention-section" aria-label="Choose a calendar">
      <h3>{current ? "Change calendar" : "Choose a calendar"}</h3>
      {current ? (
        <p className="retention-warning">
          Changing the calendar releases the links to events in “{calendarLabel(current)}”.
          Those events stay in Google Calendar, and the new calendar starts with a first sync.
        </p>
      ) : (
        <p>Pick a calendar Raven can write to, or create a dedicated Raven calendar.</p>
      )}
      {calendars.kind === "loading" || calendars.kind === "idle" ? (
        <p>Loading calendars…</p>
      ) : null}
      {calendars.kind === "error" ? (
        <div className="items-message ledger-load-error">
          <p>Couldn&apos;t load your calendars.</p>
          <button
            type="button"
            className="items-toolbar-button"
            onClick={controller.reloadCalendars}
          >
            Retry
          </button>
        </div>
      ) : null}
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void controller.submitCalendar();
        }}
      >
        <div role="radiogroup" aria-label="Calendar to sync" className="google-calendar-choices">
          {calendars.kind === "ready" ? calendars.calendars.map((calendar) => (
            <label key={calendar.id} className="field-checkbox">
              <input
                type="radio"
                name={name}
                value={calendar.id}
                checked={controller.selection === calendar.id}
                disabled={busy}
                onChange={() => controller.setSelection(calendar.id)}
              />
              {calendarLabel(calendar)}
            </label>
          )) : null}
          <label className="field-checkbox">
            <input
              type="radio"
              name={name}
              value={createCalendarChoice}
              checked={controller.selection === createCalendarChoice}
              disabled={busy}
              onChange={() => controller.setSelection(createCalendarChoice)}
            />
            Create Raven calendar
          </label>
        </div>
        {calendars.kind === "ready" && calendars.calendars.length === 0 ? (
          <p className="retention-muted">
            No calendars you can edit were found. Create a Raven calendar instead.
          </p>
        ) : null}
        <div className="dialog-actions">
          {current ? (
            <button
              type="button"
              className="items-toolbar-button retention-button"
              disabled={busy}
              onClick={controller.cancelCalendarChange}
            >
              Keep current calendar
            </button>
          ) : null}
          <button
            type="submit"
            className="items-toolbar-button button-primary retention-button"
            disabled={busy || controller.selection === null}
          >
            {controller.pending === "calendar" ? "Saving…" : "Use this calendar"}
          </button>
        </div>
      </form>
    </section>
  );
}

function FirstSync({
  controller,
  status,
}: {
  controller: GoogleCalendarController;
  status: GoogleCalendarStatus;
}) {
  const { preview } = controller;
  const busy = controller.pending !== null;

  return (
    <section className="retention-section" aria-label="First sync">
      <h3>First sync</h3>
      <p>
        {status.calendar ? `Calendar: ${calendarLabel(status.calendar)}. ` : null}
        Active and paused Raven events from the last 7 days onward go to Google, and
        single (non-recurring) Google events from the same period come into Raven.
      </p>
      {preview.kind === "loading" || preview.kind === "idle" ? <p>Loading preview…</p> : null}
      {preview.kind === "error" ? (
        <div className="items-message ledger-load-error">
          <p>Couldn&apos;t load the preview.</p>
          <button type="button" className="items-toolbar-button" onClick={controller.reloadPreview}>
            Retry
          </button>
        </div>
      ) : null}
      {preview.kind === "ready" ? (
        <ul className="google-calendar-preview">
          {previewLabels
            .filter(([key, , always]) => always || preview.preview.counts[key] > 0)
            .map(([key, label]) => (
              <li key={key}>{`${label}: ${preview.preview.counts[key]}`}</li>
            ))}
        </ul>
      ) : null}
      <div className="dialog-actions retention-run-actions">
        <button
          type="button"
          className="items-toolbar-button retention-button"
          disabled={busy}
          onClick={controller.startCalendarChange}
        >
          Change calendar
        </button>
        <button
          type="button"
          className="items-toolbar-button button-primary retention-button"
          disabled={busy || preview.kind === "loading"}
          aria-busy={controller.pending === "sync"}
          onClick={() => void controller.startSyncing()}
        >
          {controller.pending === "sync" ? "Syncing…" : "Start syncing"}
        </button>
      </div>
    </section>
  );
}

function ActiveSync({
  controller,
  status,
}: {
  controller: GoogleCalendarController;
  status: GoogleCalendarStatus;
}) {
  const busy = controller.pending !== null;
  const reauth = status.connection === "reauth_required";

  return (
    <>
      <section className="retention-section" aria-label="Sync status">
        <dl className="retention-summary">
          <dt>Calendar</dt>
          <dd>{status.calendar ? calendarLabel(status.calendar) : "None"}</dd>
          <dt>Links</dt>
          <dd>{linksText(status)}</dd>
          <dt>Next sync</dt>
          <dd>{nextRunText(status)}</dd>
        </dl>
      </section>
      <LastSync status={status} />
      <div className="dialog-actions retention-run-actions">
        <button
          type="button"
          className="items-toolbar-button retention-button"
          disabled={busy}
          onClick={controller.startCalendarChange}
        >
          Change calendar
        </button>
        <button
          type="button"
          className="items-toolbar-button button-primary retention-button"
          disabled={busy || reauth}
          aria-busy={controller.pending === "sync"}
          onClick={() => void controller.syncNow()}
        >
          {controller.pending === "sync" ? "Syncing…" : "Sync now"}
        </button>
      </div>
      <SettingsForm controller={controller} />
    </>
  );
}

function SettingsForm({ controller }: { controller: GoogleCalendarController }) {
  const pollId = React.useId();
  const durationId = React.useId();
  const busy = controller.pending !== null;

  return (
    <section className="retention-section" aria-label="Settings">
      <h3>Settings</h3>
      <form
        className="retention-settings-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void controller.saveSettings();
        }}
      >
        <div className="google-calendar-toggles">
          <label className="field-checkbox">
            <input
              type="checkbox"
              checked={controller.enabled}
              disabled={busy}
              onChange={(event) => controller.setEnabled(event.target.checked)}
            />
            Sync automatically
          </label>
          <label className="field-checkbox">
            <input
              type="checkbox"
              checked={controller.syncNote}
              disabled={busy}
              onChange={(event) => controller.setSyncNote(event.target.checked)}
            />
            Sync notes with event descriptions
          </label>
        </div>
        <NumberField
          id={pollId}
          label="Check every (seconds)"
          value={controller.pollText}
          min={googleCalendarPollMinSecs}
          max={googleCalendarPollMaxSecs}
          error={controller.pollError}
          hint={`How often Raven checks for changes (${googleCalendarPollMinSecs}–${googleCalendarPollMaxSecs} seconds).`}
          disabled={busy}
          onChange={controller.setPollText}
        />
        <NumberField
          id={durationId}
          label="Default event length (minutes)"
          value={controller.durationText}
          min={googleCalendarDurationMinMinutes}
          max={googleCalendarDurationMaxMinutes}
          error={controller.durationError}
          hint="Length of Google events created from timed Raven events, which have no end time."
          disabled={busy}
          onChange={controller.setDurationText}
        />
        <div className="dialog-actions">
          <button
            type="submit"
            className="items-toolbar-button button-primary retention-button"
            disabled={busy}
          >
            {controller.pending === "save" ? "Saving…" : "Save settings"}
          </button>
        </div>
      </form>
    </section>
  );
}

function NumberField({
  id,
  label,
  value,
  min,
  max,
  error,
  hint,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  min: number;
  max: number;
  error: string | null;
  hint: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  return (
    <>
      <label className="field-label" htmlFor={id}>
        {label}
        <input
          id={id}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          step={1}
          value={value}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${errorId} ${hintId}` : hintId}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
      {error ? <p id={errorId} className="retention-field-error">{error}</p> : null}
      <p id={hintId} className="retention-hint">{hint}</p>
    </>
  );
}

function LastSync({ status }: { status: GoogleCalendarStatus }) {
  const run = status.lastSync;
  return (
    <section className="retention-section" aria-label="Last sync">
      <h3>Last sync</h3>
      {run === null ? <p>Raven hasn&apos;t synced yet.</p> : (
        <dl className="retention-summary">
          <dt>Finished</dt>
          <dd>{formatDateTime(run.finishedAt ?? run.startedAt)}</dd>
          <dt>Outcome</dt>
          <dd>{googleCalendarOutcomeLabel(run.outcome)}</dd>
          <dt>Trigger</dt>
          <dd>{run.trigger === "api" ? "Manual" : humanize(run.trigger)}</dd>
          <dt>Changes</dt>
          <dd>{changesText(run.counts)}</dd>
          {run.errorKind ? (
            <>
              <dt>Error</dt>
              <dd>{humanize(run.errorKind)}</dd>
            </>
          ) : null}
        </dl>
      )}
    </section>
  );
}

function changesText(counts: GoogleCalendarCounts): string {
  const parts = changeLabels
    .filter(([key]) => counts[key] > 0)
    .map(([key, label]) => `${counts[key]} ${label}`);
  return parts.length > 0 ? parts.join(", ") : "No changes";
}

function linksText(status: GoogleCalendarStatus): string {
  const { total, error } = status.links;
  const linked = total === 1 ? "1 linked event" : `${total} linked events`;
  return error > 0 ? `${linked}, ${error} with errors` : linked;
}

function nextRunText(status: GoogleCalendarStatus): string {
  if (status.envOverride !== null) return "Turned off by RAVEN_GOOGLE_CALENDAR";
  if (status.connection === "reauth_required") return "Paused until you reconnect";
  if (!status.settings.enabled) return "Automatic sync is off";
  if (!status.schedule.schedulerActive) return "Runs only while Raven UI or API is running";
  const every = intervalText(status.settings.pollIntervalSecs);
  return status.schedule.nextRunAt
    ? `${formatDateTime(status.schedule.nextRunAt)} (every ${every})`
    : `Every ${every}`;
}

function intervalText(seconds: number): string {
  if (seconds % 60 === 0) {
    const minutes = seconds / 60;
    return minutes === 1 ? "minute" : `${minutes} minutes`;
  }
  return `${seconds} seconds`;
}

function calendarLabel(calendar: { id: string; summary: string; primary: boolean }): string {
  const label = calendar.summary || calendar.id;
  return calendar.primary ? `${label} (primary)` : label;
}

const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatDateTime(value: string): string {
  return dateTimeFormat.format(new Date(value));
}
