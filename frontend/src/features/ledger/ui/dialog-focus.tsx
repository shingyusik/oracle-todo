"use client";

import React from "react";

const fieldSelector =
  'form input:not([disabled]), form select:not([disabled]), form textarea:not([disabled])';

/**
 * Moves focus into the dialog on open and hands it back to the trigger on close. The dialog
 * element itself takes focus first, so Escape and Tab keep working while reference data is
 * still loading and the loading state's buttons unmount.
 */
export function useDialogFocus(
  dialogRef: React.RefObject<HTMLElement | null>,
  returnFocusRef: React.RefObject<HTMLElement | null>,
) {
  React.useEffect(() => {
    const dialog = dialogRef.current;
    // A form that is already loaded has focused something inside itself in a layout effect.
    // Anything else (such as the loading state's cancel button, which unmounts) must not keep focus.
    const active = document.activeElement;
    const inForm = active instanceof HTMLElement && dialog?.contains(active) && active.closest("form");
    if (dialog && !inForm) dialog.focus();
    return () => {
      if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus();
    };
  }, [dialogRef, returnFocusRef]);
}

/** Rendered inside the loaded form: focuses the first field (or `selector`) unless the user already moved focus. */
export function InitialFieldFocus({ selector = fieldSelector }: { selector?: string }) {
  const markerRef = React.useRef<HTMLSpanElement>(null);
  React.useLayoutEffect(() => {
    const dialog = markerRef.current?.closest<HTMLElement>('[role="dialog"]');
    if (!dialog) return;
    const active = document.activeElement;
    if (active && active !== dialog && dialog.contains(active)) return;
    dialog.querySelector<HTMLElement>(selector)?.focus();
  }, []);
  return <span ref={markerRef} hidden />;
}
