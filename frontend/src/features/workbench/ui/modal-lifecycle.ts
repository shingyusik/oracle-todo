"use client";

import React from "react";

const focusableSelector =
  'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])';

type IsolationScope = "body" | "shell";

export function useModalIsolation(
  dialogRef: React.RefObject<HTMLElement>,
  active: boolean,
  scope: IsolationScope,
) {
  React.useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!active || !dialog) return;

    const background = backgroundElements(dialog, scope);
    const snapshots = background.map((element) => ({
      element,
      ariaHidden: attributeSnapshot(element, "aria-hidden"),
      inert: attributeSnapshot(element, "inert"),
    }));
    for (const element of background) {
      element.setAttribute("aria-hidden", "true");
      element.setAttribute("inert", "");
    }

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const keepFocusInside = (event: FocusEvent) => {
      if (event.target instanceof Node && !dialog.contains(event.target)) {
        event.stopPropagation();
        focusFirst(dialog);
      }
    };
    document.addEventListener("focusin", keepFocusInside, true);

    return () => {
      document.removeEventListener("focusin", keepFocusInside, true);
      document.body.style.overflow = originalOverflow;
      for (const snapshot of snapshots) {
        restoreAttribute(snapshot.element, "aria-hidden", snapshot.ariaHidden);
        restoreAttribute(snapshot.element, "inert", snapshot.inert);
      }
    };
  }, [active, dialogRef, scope]);
}

export function focusFirst(dialog: HTMLElement) {
  dialog.querySelector<HTMLElement>(focusableSelector)?.focus();
}

function backgroundElements(
  dialog: HTMLElement,
  scope: IsolationScope,
): HTMLElement[] {
  if (scope === "body") {
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
