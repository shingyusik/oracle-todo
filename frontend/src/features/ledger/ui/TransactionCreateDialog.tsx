"use client";

import React from "react";
import { createPortal } from "react-dom";

import type { LedgerController } from "@/features/ledger/hooks/useLedgerController";
import { TransactionForm } from "@/features/ledger/ui/TransactionForm";
import { useModalIsolation } from "@/features/workbench/ui/modal-lifecycle";

type TransactionCreateDialogProps = {
  controller: LedgerController;
  onClose(): void;
  returnFocusRef: React.RefObject<HTMLButtonElement | null>;
};

export function TransactionCreateDialog({
  controller,
  onClose,
  returnFocusRef,
}: TransactionCreateDialogProps) {
  const [host, setHost] = React.useState<HTMLElement | null>(null);

  React.useLayoutEffect(() => {
    const element = document.createElement("div");
    element.dataset.ravenModalHost = "";
    document.body.append(element);
    setHost(element);
    return () => element.remove();
  }, []);

  return host
    ? createPortal(
        <TransactionCreateDialogContent
          controller={controller}
          onClose={onClose}
          returnFocusRef={returnFocusRef}
        />,
        host,
      )
    : null;
}

function TransactionCreateDialogContent({
  controller,
  onClose,
  returnFocusRef,
}: TransactionCreateDialogProps) {
  const [pending, setPending] = React.useState(false);
  const dialogRef = React.useRef<HTMLDivElement | null>(null);
  useModalIsolation(dialogRef, true, "body");

  React.useEffect(() => {
    const dialog = dialogRef.current;
    (dialog?.querySelector<HTMLElement>('[aria-label="Close Add transaction"]') ??
      dialog?.querySelector<HTMLElement>(
        'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])',
      ))?.focus();
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
    const closeIndex = focusables.findIndex(
      (element) => element.getAttribute("aria-label") === "Close Add transaction",
    );
    if (closeIndex > 0) focusables.unshift(...focusables.splice(closeIndex, 1));
    const index = focusables.indexOf(document.activeElement as HTMLElement);
    if (index < 0) return;
    event.preventDefault();
    const nextIndex = event.shiftKey
      ? (index - 1 + focusables.length) % focusables.length
      : (index + 1) % focusables.length;
    focusables[nextIndex]?.focus();
  }

  return (
    <div className="confirmation-backdrop">
      <div
        ref={dialogRef}
        className="confirmation-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Add transaction"
        onKeyDown={handleKeyDown}
      >
        <header className="dashboard-widget-header">
          <h2>Add transaction</h2>
        </header>
        <TransactionForm
          controller={controller}
          onClose={onClose}
          onSaved={onClose}
          onPendingChange={setPending}
        />
      </div>
    </div>
  );
}
