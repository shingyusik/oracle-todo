"use client";

import { IconRefresh } from "@tabler/icons-react";
import React from "react";
import { createPortal } from "react-dom";

import {
  useSystemUpdate,
  type SystemUpdateController,
} from "@/features/workbench/hooks/useSystemUpdate";
import { DestructiveConfirmationDialog } from "@/features/workbench/ui/DestructiveConfirmationDialog";

export const updateUnsupportedHint =
  "Restart Raven through the npm wrapper to enable updates";

export function SidebarVersion() {
  return <SidebarVersionView controller={useSystemUpdate()} />;
}

export function SidebarVersionView({ controller }: { controller: SystemUpdateController }) {
  const updateButtonRef = React.useRef<HTMLButtonElement>(null);
  const hintId = React.useId();
  const { version, availableVersion, phase, result } = controller;
  const supported = version?.updateSupported ?? false;

  return (
    <footer className="sidebar-version" aria-label="Raven version">
      {version ? (
        <span className="sidebar-version-current">Raven v{version.currentVersion}</span>
      ) : null}
      {version && (availableVersion || !supported) ? (
        <span
          className="sidebar-version-update-wrapper"
          title={supported ? undefined : updateUnsupportedHint}
        >
          <button
            ref={updateButtonRef}
            type="button"
            className="items-toolbar-button sidebar-version-update"
            disabled={!supported || phase.kind !== "idle"}
            aria-describedby={supported ? undefined : hintId}
            onClick={controller.openConfirmation}
          >
            {availableVersion ? `Update to v${availableVersion}` : "Update"}
          </button>
          {supported ? null : (
            <span id={hintId} className="sr-only">{updateUnsupportedHint}</span>
          )}
        </span>
      ) : null}
      <div className="sidebar-version-row">
        {controller.checkFailed ? (
          <span className="sidebar-version-hint">Couldn&apos;t check for updates</span>
        ) : null}
        <button
          type="button"
          className="sidebar-version-check"
          disabled={controller.checking || phase.kind === "restarting"}
          onClick={controller.checkNow}
        >
          <IconRefresh size={14} aria-hidden="true" />
          {controller.checking ? "Checking…" : "Check now"}
        </button>
      </div>
      {result ? (
        <div
          className="sidebar-version-result"
          data-ok={result.ok}
          role={result.ok ? "status" : "alert"}
        >
          <span>{result.message}</span>
          <button
            type="button"
            className="sidebar-version-check"
            aria-label="Dismiss update message"
            onClick={controller.dismissResult}
          >
            Dismiss
          </button>
        </div>
      ) : null}
      {phase.kind === "confirming" ? (
        <DestructiveConfirmationDialog
          title={`Update Raven to v${phase.targetVersion}?`}
          description={`Raven restarts to install v${phase.targetVersion}. It is unavailable for a few seconds and this page reloads automatically when it is back.`}
          confirmLabel="Update and restart"
          error={phase.error}
          fallbackFocusRef={updateButtonRef}
          onCancel={controller.cancelConfirmation}
          onConfirm={controller.confirmUpdate}
        />
      ) : null}
      {phase.kind === "restarting" ? (
        <UpdateOverlay targetVersion={phase.targetVersion} />
      ) : null}
    </footer>
  );
}

function UpdateOverlay({ targetVersion }: { targetVersion: string }) {
  const [host, setHost] = React.useState<HTMLElement | null>(null);

  React.useLayoutEffect(() => {
    const element = document.createElement("div");
    element.dataset.ravenModalHost = "";
    document.body.append(element);
    setHost(element);
    return () => element.remove();
  }, []);

  return host ? createPortal(
    <div
      className="update-overlay"
      role="alertdialog"
      aria-modal="true"
      aria-label={`Updating to v${targetVersion}`}
      aria-busy="true"
    >
      <div className="update-overlay-card">
        <span className="update-overlay-spinner" aria-hidden="true" />
        <h2>Updating to v{targetVersion}…</h2>
        <p>Raven is restarting. This page reloads automatically when it is back.</p>
      </div>
    </div>,
    host,
  ) : null;
}
