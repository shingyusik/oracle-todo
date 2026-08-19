"use client";

import React from "react";
import { createPortal } from "react-dom";

import type { HealthController } from "@/features/health/hooks/useHealthController";
import { BowelForm } from "@/features/health/ui/HealthForms";
import { useModalIsolation } from "@/features/workbench/ui/modal-lifecycle";

type BowelCreateDialogProps = {
  controller: HealthController;
  onClose(): void;
  returnFocusRef: React.RefObject<HTMLButtonElement | null>;
};

export function BowelCreateDialog(props: BowelCreateDialogProps): React.ReactNode {
  const [host, setHost] = React.useState<HTMLElement | null>(null);

  React.useLayoutEffect(() => {
    const element = document.createElement("div");
    element.dataset.ravenModalHost = "";
    document.body.append(element);
    setHost(element);
    return () => element.remove();
  }, []);

  return host ? createPortal(<BowelCreateDialogContent {...props} />, host) : null;
}

function BowelCreateDialogContent({
  controller,
  onClose,
  returnFocusRef,
}: BowelCreateDialogProps) {
  const [pending, setPending] = React.useState(false);
  const dialogRef = React.useRef<HTMLDivElement | null>(null);
  useModalIsolation(dialogRef, true, "body");

  React.useEffect(() => {
    dialogRef.current?.querySelector<HTMLElement>(
      'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])',
    )?.focus();
    return () => {
      if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus();
    };
  }, [returnFocusRef]);

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      if (!pending) onClose();
      return;
    }
    if (event.key !== "Tab" || !dialogRef.current) return;
    const focusables = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
      'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ));
    const index = focusables.indexOf(document.activeElement as HTMLElement);
    if (!event.shiftKey && index === focusables.length - 1) {
      event.preventDefault();
      focusables[0]?.focus();
    } else if (event.shiftKey && index === 0) {
      event.preventDefault();
      focusables.at(-1)?.focus();
    }
  }

  return (
    <div
      className="confirmation-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="confirmation-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Add bowel entry"
        aria-busy={pending}
        onKeyDown={handleKeyDown}
      >
        <header className="dashboard-widget-header">
          <h2>Add bowel entry</h2>
          <button
            type="button"
            aria-label="Close Add bowel entry"
            disabled={pending}
            onClick={onClose}
          >
            Close
          </button>
        </header>
        <BowelForm
          controller={controller}
          onSaved={onClose}
          onPendingChange={setPending}
        />
      </div>
    </div>
  );
}
