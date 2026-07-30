"use client";

import React from "react";

import { useHealthController } from "@/features/health/hooks/useHealthController";
import {
  BowelForm,
  DietForm,
  MedicationForm,
  MetricsForm,
} from "@/features/health/ui/HealthForms";
import { useLedgerController } from "@/features/ledger/hooks/useLedgerController";
import { TransactionForm } from "@/features/ledger/ui/TransactionForm";
import type { WorkbenchController } from "@/features/workbench/model/workbench-model";

type QuickAddKind =
  | "select"
  | "ledger"
  | "diet"
  | "bowel"
  | "medication"
  | "metrics";

export function QuickAddDialog({
  controller,
  onClose,
}: {
  controller: WorkbenchController;
  onClose: () => void;
}) {
  const ledgerController = useLedgerController();
  const healthController = useHealthController();
  const [kind, setKind] = React.useState<QuickAddKind>("select");
  const dialog = React.useRef<HTMLDivElement | null>(null);
  const returnFocus = React.useRef<HTMLElement | null>(null);

  React.useEffect(() => {
    returnFocus.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    return () => {
      if (returnFocus.current?.isConnected) returnFocus.current.focus();
    };
  }, []);

  React.useEffect(() => {
    const focusable = dialog.current?.querySelector<HTMLElement>(
      'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])',
    );
    focusable?.focus();
  }, [kind]);

  function addTodo() {
    controller.selectTab("tasks");
    controller.openCreationDialog();
    onClose();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab" || !dialog.current) return;
    const focusables = Array.from(dialog.current.querySelectorAll<HTMLElement>(
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
    <div className="confirmation-backdrop">
      <div
        ref={dialog}
        className="confirmation-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={dialogLabel(kind)}
        onKeyDown={handleKeyDown}
      >
        <header className="dashboard-widget-header">
          <h2>{dialogLabel(kind)}</h2>
          <button type="button" onClick={onClose} aria-label="Close Quick Add">
            Close
          </button>
        </header>
        {kind === "select" ? (
          <div role="group" aria-label="Quick Add type">
            <button type="button" onClick={addTodo}>ToDo item</button>
            <button type="button" onClick={() => setKind("ledger")}>
              Ledger transaction
            </button>
            <button type="button" onClick={() => setKind("diet")}>Diet entry</button>
            <button type="button" onClick={() => setKind("bowel")}>Bowel entry</button>
            <button type="button" onClick={() => setKind("medication")}>
              Medication entry
            </button>
            <button type="button" onClick={() => setKind("metrics")}>
              Health metrics
            </button>
          </div>
        ) : (
          <>
            <button type="button" onClick={() => setKind("select")}>
              Back to Quick Add
            </button>
            {kind === "ledger" ? (
              <TransactionForm
                controller={ledgerController}
                onSaved={onClose}
              />
            ) : null}
            {kind === "diet" ? <DietForm controller={healthController} /> : null}
            {kind === "bowel" ? <BowelForm controller={healthController} /> : null}
            {kind === "medication" ? (
              <MedicationForm controller={healthController} />
            ) : null}
            {kind === "metrics" ? (
              <MetricsForm controller={healthController} />
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function dialogLabel(kind: QuickAddKind): string {
  switch (kind) {
    case "select": return "Quick Add";
    case "ledger": return "Add transaction";
    case "diet": return "Add diet entry";
    case "bowel": return "Add bowel entry";
    case "medication": return "Add medication entry";
    case "metrics": return "Add health metrics";
  }
}
