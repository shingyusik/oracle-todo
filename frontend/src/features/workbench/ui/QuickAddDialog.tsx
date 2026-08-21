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
import { useModalIsolation } from "@/features/workbench/ui/modal-lifecycle";

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
  returnFocusRef,
}: {
  controller: WorkbenchController;
  onClose: () => void;
  returnFocusRef?: React.RefObject<HTMLElement | null>;
}) {
  const [kind, setKind] = React.useState<QuickAddKind>("select");
  const [pending, setPending] = React.useState(false);
  const dialog = React.useRef<HTMLDivElement | null>(null);
  const returnFocus = React.useRef<HTMLElement | null>(null);
  useModalIsolation(dialog, true, "shell");

  React.useEffect(() => {
    returnFocus.current = returnFocusRef?.current
      ?? (document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null);
    return () => {
      if (returnFocus.current?.isConnected) returnFocus.current.focus();
    };
  }, [returnFocusRef]);

  React.useEffect(() => {
    const focusable = dialog.current?.querySelector<HTMLElement>(
      'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])',
    );
    focusable?.focus();
  }, [kind]);

  function addTodo() {
    controller.openTaskCreation();
    onClose();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      if (pending) return;
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
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Quick Add"
            disabled={pending}
          >
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
            <button
              type="button"
              onClick={() => setKind("select")}
              disabled={pending}
            >
              Back to Quick Add
            </button>
            {pending ? (
              <p role="status">
                Operation in progress. Close is disabled until it finishes.
              </p>
            ) : null}
            {kind === "ledger" ? (
              <LedgerQuickAdd
                onSaved={onClose}
                onPendingChange={setPending}
              />
            ) : null}
            {kind !== "ledger" ? (
              <HealthQuickAdd
                kind={kind}
                onSaved={onClose}
                onPendingChange={setPending}
              />
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

type QuickAddFormProps = {
  onSaved: () => void;
  onPendingChange: (pending: boolean) => void;
};

function LedgerQuickAdd({
  onSaved,
  onPendingChange,
}: QuickAddFormProps) {
  const controller = useLedgerController();
  const references = useReferencePreload(
    controller.ensureReferenceData ?? controller.refresh,
    "ledger.transactions",
  );

  if (references.status === "loading") {
    return <p role="status">Loading Ledger references…</p>;
  }
  if (references.status === "error") {
    return (
      <>
        <p role="alert" className="items-message">{controller.state.error}</p>
        <button type="button" onClick={references.retry}>
          Retry Ledger
        </button>
      </>
    );
  }
  return (
    <TransactionForm
      controller={controller}
      onSaved={onSaved}
      onPendingChange={onPendingChange}
    />
  );
}

function HealthQuickAdd({
  kind,
  onSaved,
  onPendingChange,
}: QuickAddFormProps & {
  kind: Exclude<QuickAddKind, "select" | "ledger">;
}) {
  const controller = useHealthController();
  const scope = `health.${kind}` as const;
  const references = useReferencePreload(controller.ensureReferenceData, scope);
  const props = { controller, onSaved, onPendingChange };

  if (references.status === "loading") {
    return <p role="status">Loading Health references…</p>;
  }
  if (references.status === "error") {
    return (
      <>
        <p role="alert" className="items-message">{healthReferenceError(controller, kind)}</p>
        <button type="button" onClick={references.retry}>Retry Health</button>
      </>
    );
  }

  switch (kind) {
    case "diet": return <DietForm {...props} />;
    case "bowel": return <BowelForm {...props} />;
    case "medication": return <MedicationForm {...props} />;
    case "metrics": return <MetricsForm {...props} />;
  }
}

function useReferencePreload<Scope>(
  ensure: (scope: Scope) => Promise<boolean>,
  scope: Scope,
) {
  const [status, setStatus] = React.useState<"loading" | "loaded" | "error">("loading");
  const generation = React.useRef(0);
  const retry = React.useCallback(() => {
    const request = ++generation.current;
    setStatus("loading");
    void ensure(scope).then((ok) => {
      if (generation.current === request) setStatus(ok ? "loaded" : "error");
    });
  }, [ensure, scope]);
  React.useEffect(() => {
    retry();
    return () => { ++generation.current; };
  }, [retry]);
  return { status, retry };
}

function healthReferenceError(
  controller: ReturnType<typeof useHealthController>,
  kind: Exclude<QuickAddKind, "select" | "ledger">,
): string {
  const error = kind === "diet"
    ? controller.state.dietError
    : kind === "bowel"
      ? controller.state.bowelError
      : kind === "medication"
        ? controller.state.medicationError
        : controller.state.metricsError;
  return error ?? "Health references unavailable";
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
