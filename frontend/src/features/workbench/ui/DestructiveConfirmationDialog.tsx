"use client";

import React, { useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";

export function DestructiveConfirmationDialog({
  title,
  description,
  onCancel,
  onConfirm,
}: {
  title: string;
  description: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    cancelRef.current?.focus();
  }, []);

  function close(action: () => void) {
    const returnTarget = returnFocusRef.current;
    action();
    requestAnimationFrame(() => returnTarget?.isConnected && returnTarget.focus());
  }

  return createPortal(
    <div className="confirmation-backdrop">
      <section
        className="confirmation-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            close(onCancel);
          } else if (event.key === "Tab") {
            event.preventDefault();
            if (document.activeElement === cancelRef.current && event.shiftKey) {
              confirmRef.current?.focus();
            } else if (document.activeElement === confirmRef.current && !event.shiftKey) {
              cancelRef.current?.focus();
            } else {
              (event.shiftKey ? cancelRef : confirmRef).current?.focus();
            }
          }
        }}
      >
        <h2>{title}</h2>
        <p>{description}</p>
        <div className="dialog-actions">
          <button ref={cancelRef} type="button" onClick={() => close(onCancel)}>
            Cancel
          </button>
          <button ref={confirmRef} type="button" onClick={() => close(onConfirm)}>
            Purge permanently
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
