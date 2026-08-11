"use client";

import React, { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  useModalIsolation,
} from "@/features/workbench/ui/modal-lifecycle";

type DestructiveConfirmationDialogProps = {
  title: string;
  description: string;
  confirmLabel?: string;
  error?: string | null;
  disabled?: boolean;
  fallbackFocusRef: React.RefObject<HTMLElement>;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
};

export function DestructiveConfirmationDialog(
  props: DestructiveConfirmationDialogProps,
) {
  const [host, setHost] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const element = document.createElement("div");
    element.dataset.ravenModalHost = "";
    document.body.append(element);
    setHost(element);
    return () => element.remove();
  }, []);

  return host
    ? createPortal(<DestructiveDialogContent {...props} />, host)
    : null;
}

function DestructiveDialogContent({
  title,
  description,
  confirmLabel = "Purge permanently",
  error = null,
  disabled = false,
  fallbackFocusRef,
  onCancel,
  onConfirm,
}: DestructiveConfirmationDialogProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const activeConfirmation = useRef(false);
  const [pending, setPending] = useState(false);
  useModalIsolation(dialogRef, true, "body");

  useLayoutEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    cancelRef.current?.focus();
    return () => {
      const returnTarget = returnFocusRef.current;
      requestAnimationFrame(() => {
        if (isEnabledFocusTarget(returnTarget)) returnTarget.focus();
        else fallbackFocusRef.current?.focus();
      });
    };
  }, [fallbackFocusRef]);

  async function confirm() {
    if (activeConfirmation.current || disabled) return;
    activeConfirmation.current = true;
    setPending(true);
    try {
      await onConfirm();
    } finally {
      activeConfirmation.current = false;
      setPending(false);
    }
  }

  return (
    <div className="confirmation-backdrop">
      <section
        ref={dialogRef}
        className="confirmation-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        aria-busy={pending || disabled}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            if (!pending && !disabled) onCancel();
          } else if (event.key === "Tab") {
            event.preventDefault();
            if (document.activeElement === cancelRef.current && event.shiftKey) {
              confirmRef.current?.focus();
            } else if (
              document.activeElement === confirmRef.current &&
              !event.shiftKey
            ) {
              cancelRef.current?.focus();
            } else {
              (event.shiftKey ? cancelRef : confirmRef).current?.focus();
            }
          }
        }}
      >
        <h2>{title}</h2>
        <p>{description}</p>
        {error !== null ? (
          <p className="items-message" role="alert">
            {error}
          </p>
        ) : null}
        <div className="dialog-actions">
          <button
            ref={cancelRef}
            type="button"
            aria-disabled={pending || disabled}
            onClick={() => {
              if (!pending && !disabled) onCancel();
            }}
          >
            Cancel
          </button>
          <button
            ref={confirmRef}
            type="button"
            aria-disabled={pending || disabled}
            onClick={() => void confirm()}
          >
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}

function isEnabledFocusTarget(
  target: HTMLElement | null,
): target is HTMLElement {
  return Boolean(
    target?.isConnected &&
    !target.matches(":disabled, [aria-disabled='true']"),
  );
}
