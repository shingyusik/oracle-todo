"use client";

import React from "react";
import { createPortal } from "react-dom";

import type { HealthController } from "@/features/health/hooks/useHealthController";
import { MetricsForm } from "@/features/health/ui/HealthForms";
import { useModalIsolation } from "@/features/workbench/ui/modal-lifecycle";

type HealthMetricsCreateDialogProps = {
  controller: HealthController;
  onClose(): void;
  returnFocusRef: React.RefObject<HTMLButtonElement | null>;
};

function useIsomorphicLayoutEffect(
  effect: React.EffectCallback,
  dependencies: React.DependencyList,
) {
  const useEffect = typeof window === "undefined" ? React.useEffect : React.useLayoutEffect;
  useEffect(effect, dependencies);
}

export function HealthMetricsCreateDialog(
  props: HealthMetricsCreateDialogProps,
): React.ReactNode {
  const [host, setHost] = React.useState<HTMLElement | null>(null);

  useIsomorphicLayoutEffect(() => {
    const element = document.createElement("div");
    element.dataset.ravenModalHost = "";
    document.body.append(element);
    setHost(element);
    return () => element.remove();
  }, []);

  return host ? createPortal(<HealthMetricsCreateDialogContent {...props} />, host) : null;
}

function HealthMetricsCreateDialogContent({
  controller,
  onClose,
  returnFocusRef,
}: HealthMetricsCreateDialogProps) {
  const [pending, setPending] = React.useState(false);
  const [recovering, setRecovering] = React.useState(false);
  const pendingRef = React.useRef(false);
  const recoveringRef = React.useRef(false);
  const mountedRef = React.useRef(true);
  const dialogRef = React.useRef<HTMLDivElement | null>(null);
  useModalIsolation(dialogRef, true, "body");

  React.useEffect(() => {
    mountedRef.current = true;
    dialogRef.current?.querySelector<HTMLElement>(
      'form input:not([disabled]), form select:not([disabled]), form textarea:not([disabled]), form button:not([disabled])',
    )?.focus();
    return () => {
      mountedRef.current = false;
      if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus();
    };
  }, [returnFocusRef]);

  React.useEffect(() => {
    if (pending && dialogRef.current?.contains(document.activeElement)) dialogRef.current.focus();
  }, [pending]);

  function updatePending(nextPending: boolean) {
    pendingRef.current = nextPending;
    if (mountedRef.current) setPending(nextPending);
  }

  function close() {
    if (!pendingRef.current && !recoveringRef.current) onClose();
  }

  function updateRecovery(nextRecovering: boolean) {
    recoveringRef.current = nextRecovering;
    if (mountedRef.current) setRecovering(nextRecovering);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab" || !dialogRef.current) return;
    const focusables = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
      'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )).filter((element) => !element.matches(":disabled"));
    if (focusables.length === 0) {
      event.preventDefault();
      dialogRef.current.focus();
      return;
    }
    const index = focusables.indexOf(document.activeElement as HTMLElement);
    if (index === -1) {
      event.preventDefault();
      (event.shiftKey ? focusables.at(-1) : focusables[0])?.focus();
    } else if (!event.shiftKey && index === focusables.length - 1) {
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
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        ref={dialogRef}
        className="confirmation-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Add health metrics"
        aria-busy={pending || recovering}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <header className="dashboard-widget-header">
          <h2>Add health metrics</h2>
          <button
            type="button"
            aria-label="Close Add health metrics"
            disabled={pending || recovering}
            onClick={close}
          >
            Close
          </button>
        </header>
        <MetricsForm
          controller={controller}
          mode="create"
          onSaved={onClose}
          onPendingChange={updatePending}
          onRecoveryChange={updateRecovery}
        />
      </div>
    </div>
  );
}
