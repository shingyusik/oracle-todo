"use client";

import React from "react";

const focusableSelector =
  'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])';

type IsolationScope = "body" | "shell";

export function useDraftDirty(values: readonly unknown[], onDirtyChange?: (dirty: boolean) => void) {
  const snapshot = JSON.stringify(values);
  const initial = React.useRef(snapshot);
  React.useEffect(() => {
    onDirtyChange?.(snapshot !== initial.current);
  }, [onDirtyChange, snapshot]);
}

export function useModalIsolation(
  dialogRef: React.RefObject<HTMLElement>,
  active: boolean,
  scope: IsolationScope,
) {
  React.useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!active || !dialog) return;

    const background = backgroundElements(dialog, scope);
    for (const element of background) holdIsolation(element);

    const locksBody = !dialog.parentElement?.closest('[role="dialog"]');
    if (locksBody) holdBodyScrollLock();
    const keepFocusInside = (event: FocusEvent) => {
      if (event.target instanceof Node && !dialog.contains(event.target)) {
        event.stopPropagation();
        focusFirst(dialog);
      }
    };
    document.addEventListener("focusin", keepFocusInside, true);

    return () => {
      document.removeEventListener("focusin", keepFocusInside, true);
      if (locksBody) releaseBodyScrollLock();
      for (const element of background) releaseIsolation(element);
    };
  }, [active, dialogRef, scope]);
}

// Dialogs can nest or close in the same commit, in any order. Reference counts keep the first
// snapshot and restore it only when the last dialog holding an element or the body lets go.
type IsolationHold = {
  count: number;
  ariaHidden: AttributeSnapshot;
  inert: AttributeSnapshot;
};
const isolationHolds = new WeakMap<HTMLElement, IsolationHold>();
let bodyScrollLocks = 0;
let bodyOverflowBeforeLock = "";

function holdIsolation(element: HTMLElement) {
  const hold = isolationHolds.get(element) ?? {
    count: 0,
    ariaHidden: attributeSnapshot(element, "aria-hidden"),
    inert: attributeSnapshot(element, "inert"),
  };
  hold.count += 1;
  isolationHolds.set(element, hold);
  element.setAttribute("aria-hidden", "true");
  element.setAttribute("inert", "");
}

function releaseIsolation(element: HTMLElement) {
  const hold = isolationHolds.get(element);
  if (!hold) return;
  hold.count -= 1;
  if (hold.count > 0) return;
  isolationHolds.delete(element);
  restoreAttribute(element, "aria-hidden", hold.ariaHidden);
  restoreAttribute(element, "inert", hold.inert);
}

function holdBodyScrollLock() {
  if (bodyScrollLocks === 0) bodyOverflowBeforeLock = document.body.style.overflow;
  bodyScrollLocks += 1;
  document.body.style.overflow = "hidden";
}

function releaseBodyScrollLock() {
  bodyScrollLocks = Math.max(0, bodyScrollLocks - 1);
  if (bodyScrollLocks === 0) document.body.style.overflow = bodyOverflowBeforeLock;
}

export function focusFirst(dialog: HTMLElement) {
  dialog.querySelector<HTMLElement>(focusableSelector)?.focus();
}

function backgroundElements(
  dialog: HTMLElement,
  scope: IsolationScope,
): HTMLElement[] {
  if (scope === "body") {
    const parentDialog = dialog.parentElement?.closest<HTMLElement>('[role="dialog"]');
    if (parentDialog) {
      return Array.from(parentDialog.children).filter(
        (element): element is HTMLElement => element instanceof HTMLElement &&
          !element.contains(dialog),
      );
    }
    const host = dialog.closest<HTMLElement>("[data-raven-modal-host]");
    return Array.from(document.body.children).filter(
      (element): element is HTMLElement => element instanceof HTMLElement &&
        element !== host,
    );
  }

  const shell = dialog.closest<HTMLElement>(".workbench-shell");
  const modalContainer =
    dialog.closest<HTMLElement>(".confirmation-backdrop") ?? dialog;
  if (shell) {
    return Array.from(shell.children).filter(
      (element): element is HTMLElement => element instanceof HTMLElement &&
        element !== modalContainer &&
        !element.matches(".workbench-nav-overlay"),
    );
  }

  const bodyContainer = Array.from(document.body.children).find((element) =>
    element.contains(modalContainer));
  return Array.from(document.body.children).filter(
    (element): element is HTMLElement => element instanceof HTMLElement &&
      element !== bodyContainer,
  );
}

type AttributeSnapshot = {
  present: boolean;
  value: string | null;
};

function attributeSnapshot(
  element: HTMLElement,
  name: string,
): AttributeSnapshot {
  return {
    present: element.hasAttribute(name),
    value: element.getAttribute(name),
  };
}

function restoreAttribute(
  element: HTMLElement,
  name: string,
  snapshot: AttributeSnapshot,
) {
  if (snapshot.present) element.setAttribute(name, snapshot.value ?? "");
  else element.removeAttribute(name);
}
