"use client";

import { ReferenceDataBoundary } from "@/features/workbench/ui/ReferenceDataBoundary";

import React from "react";
import { createPortal } from "react-dom";

import type { LedgerController } from "@/features/ledger/hooks/useLedgerController";
import type { TransactionRow } from "@/features/ledger/model/transaction-table";
import { InitialFieldFocus, useDialogFocus } from "@/features/ledger/ui/dialog-focus";
import { TransactionForm } from "@/features/ledger/ui/TransactionForm";
import { useModalIsolation } from "@/features/workbench/ui/modal-lifecycle";
import { useDiscardConfirmation } from "@/features/workbench/ui/use-discard-confirmation";

type TransactionCreateDialogProps = {
  controller: LedgerController;
  /** Existing transaction to edit; the dialog creates a new one when omitted. */
  record?: TransactionRow;
  onClose(): void;
  onRefreshRecoveryChange?(recovering: boolean): void;
  /** Called when the edited transaction no longer exists on the server. */
  onMissing?(): void;
  /** Status line shown above the form (edit mode only). */
  notice?: string | null;
  onDirtyChange?(dirty: boolean): void;
  returnFocusRef: React.RefObject<HTMLElement | null>;
};

export function TransactionCreateDialog(props: TransactionCreateDialogProps) {
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
        <TransactionCreateDialogContent {...props} />,
        host,
      )
    : null;
}

function TransactionCreateDialogContent({
  controller,
  record,
  onClose,
  returnFocusRef,
  onRefreshRecoveryChange,
  onMissing,
  notice,
  onDirtyChange: reportDirty,
}: TransactionCreateDialogProps) {
  const title = record ? "Edit transaction" : "Add transaction";
  const closeLabel = `Close ${title}`;
  const [pending, setPending] = React.useState(false);
  const dialogRef = React.useRef<HTMLDivElement | null>(null);
  useModalIsolation(dialogRef, true, "body");
  const { onDirtyChange: markDirty, requestDiscard, discardConfirmation } = useDiscardConfirmation(dialogRef);
  const onDirtyChange = React.useCallback((dirty: boolean) => {
    markDirty(dirty);
    reportDirty?.(dirty);
  }, [markDirty, reportDirty]);

  function close() {
    if (!pending) requestDiscard(onClose);
  }

  useDialogFocus(dialogRef, returnFocusRef);

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab" || !dialogRef.current) return;
    const focusables = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
      'input:not([disabled]):not([tabindex="-1"]), select:not([disabled]):not([tabindex="-1"]), textarea:not([disabled]):not([tabindex="-1"]), button:not([disabled]):not([tabindex="-1"]), [tabindex]:not([tabindex="-1"]):not([disabled])',
    ));
    const closeIndex = focusables.findIndex(
      (element) => element.getAttribute("aria-label") === closeLabel,
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
        aria-label={title}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        {discardConfirmation}
        <header className="dashboard-widget-header">
          <h2>{title}</h2>
        </header>
        {notice ? <p role="status" className="items-message">{notice}</p> : null}
        <ReferenceDataBoundary load={controller.ensureTransactionFormReferences} onCancel={close} cancelLabel={closeLabel}>
        <InitialFieldFocus selector={record ? undefined : `button[aria-label="${closeLabel}"]`} />
        <TransactionForm
          controller={controller}
          record={record}
          onMissing={onMissing}
          onClose={close}
          onSaved={onClose}
          onDirtyChange={onDirtyChange}
          onPendingChange={setPending}
          onRefreshRecoveryChange={onRefreshRecoveryChange}
        />
        </ReferenceDataBoundary>
      </div>
    </div>
  );
}
