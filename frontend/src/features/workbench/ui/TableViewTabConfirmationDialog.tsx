import React, { useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";

export type TableViewConfirmationTarget = {
  scope: string;
};

export type TableViewTabConfirmation<TTarget extends TableViewConfirmationTarget> =
  | {
      kind: "select" | "delete";
      target: TTarget;
      targetTabId: string;
    }
  | {
      kind: "navigate";
    };

export type TableViewTabConfirmationDialogAdapter<
  TTarget extends TableViewConfirmationTarget,
> = {
  confirmation: TableViewTabConfirmation<TTarget> | null;
  confirm(): void;
  cancel(): void;
  isDirty(target: TTarget): boolean;
  activeTabId(target: TTarget): string;
};

export function TableViewTabConfirmationDialog<
  TTarget extends TableViewConfirmationTarget,
>({
  adapter,
}: {
  adapter: TableViewTabConfirmationDialogAdapter<TTarget>;
}): React.JSX.Element | null {
  const confirmation = adapter.confirmation;
  const cancelRef = useRef<HTMLButtonElement>(null);
  const actionRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    if (!confirmation) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    cancelRef.current?.focus();
  }, [confirmation]);

  if (!confirmation) return null;
  const activeConfirmation = confirmation;
  const title = activeConfirmation.kind === "delete"
    ? "Delete this view?"
    : "Discard unsaved view changes?";
  const discardsDirtySettings =
    activeConfirmation.kind === "delete" &&
    adapter.isDirty(activeConfirmation.target) &&
    adapter.activeTabId(activeConfirmation.target) ===
      activeConfirmation.targetTabId;

  function focusActiveTab() {
    if (activeConfirmation.kind === "navigate") return;
    const scope = activeConfirmation.target.scope;
    const tablist = Array.from(
      document.querySelectorAll<HTMLElement>("[data-table-view-scope]"),
    ).find((element) => element.dataset.tableViewScope === scope);
    tablist?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
  }

  function cancel() {
    const returnTarget = returnFocusRef.current;
    adapter.cancel();
    requestAnimationFrame(() => {
      if (returnTarget?.isConnected) {
        returnTarget.focus();
      } else {
        focusActiveTab();
      }
    });
  }

  function confirm() {
    const returnTarget = returnFocusRef.current;
    const returnToNavigation = activeConfirmation.kind === "navigate";
    adapter.confirm();
    requestAnimationFrame(() => {
      if (returnToNavigation && returnTarget?.isConnected) {
        returnTarget.focus();
      } else {
        focusActiveTab();
      }
    });
  }

  return createPortal(
    <div
      className="confirmation-backdrop table-view-tab-confirmation-backdrop planner-tab-confirmation-backdrop"
      data-table-view-confirmation=""
    >
      <section
        className="confirmation-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            cancel();
            return;
          }
          if (event.key === "Tab") {
            event.preventDefault();
            if (document.activeElement === cancelRef.current) {
              actionRef.current?.focus();
            } else {
              cancelRef.current?.focus();
            }
          }
        }}
      >
        <h2>{title}</h2>
        <p>
          {activeConfirmation.kind === "delete"
            ? "The saved view will be removed. This cannot be undone."
            : "Your unsaved filter, sort, and group changes will be lost."}
        </p>
        {discardsDirtySettings ? (
          <p>Its unsaved filter, sort, and group changes will also be discarded.</p>
        ) : null}
        <div className="dialog-actions">
          <button ref={cancelRef} type="button" onClick={cancel}>Cancel</button>
          <button ref={actionRef} type="button" onClick={confirm}>
            {activeConfirmation.kind === "delete" ? "Delete" : "Discard changes"}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
