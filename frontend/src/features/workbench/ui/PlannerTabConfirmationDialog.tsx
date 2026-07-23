import React, { useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";

import type { WorkbenchController } from "@/features/workbench/model/workbench-model";

export function PlannerTabConfirmationDialog({
  controller,
}: {
  controller: WorkbenchController;
}): React.JSX.Element | null {
  const confirmation = controller.plannerTabConfirmation;
  const cancelRef = useRef<HTMLButtonElement>(null);
  const deleteRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    if (confirmation?.kind !== "delete") return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    cancelRef.current?.focus();
  }, [confirmation]);

  if (confirmation?.kind !== "delete") return null;
  const deleteConfirmation = confirmation;

  const tableTabs = controller.plannerTableTabs(deleteConfirmation.tableId);
  const discardsDirtySettings =
    tableTabs.activeTabId === deleteConfirmation.targetTabId &&
    controller.plannerTableIsDirty(deleteConfirmation.tableId);

  function focusActiveTab() {
    const tablist = Array.from(
      document.querySelectorAll<HTMLElement>("[data-planner-table-id]"),
    ).find((element) => element.dataset.plannerTableId === deleteConfirmation.tableId);
    tablist?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
  }

  function cancel() {
    const returnTarget = returnFocusRef.current;
    controller.cancelPlannerTabAction();
    requestAnimationFrame(() => {
      if (returnTarget?.isConnected) {
        returnTarget.focus();
      } else {
        focusActiveTab();
      }
    });
  }

  function confirm() {
    controller.confirmPlannerTabAction();
    requestAnimationFrame(focusActiveTab);
  }

  return createPortal(
    <div className="confirmation-backdrop planner-tab-confirmation-backdrop">
      <section
        className="confirmation-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Delete this view?"
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
              deleteRef.current?.focus();
            } else {
              cancelRef.current?.focus();
            }
          }
        }}
      >
        <h2>Delete this view?</h2>
        <p>The saved view will be removed. This cannot be undone.</p>
        {discardsDirtySettings ? (
          <p>Its unsaved filter, sort, and group changes will also be discarded.</p>
        ) : null}
        <div className="dialog-actions">
          <button ref={cancelRef} type="button" onClick={cancel}>Cancel</button>
          <button ref={deleteRef} type="button" onClick={confirm}>Delete</button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
