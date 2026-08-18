"use client";

import React from "react";
import { createPortal } from "react-dom";

import type { LedgerController } from "@/features/ledger/hooks/useLedgerController";
import { categoryParentOptions } from "@/features/ledger/model/category-table";
import type { TransactionCategoryKind } from "@/features/ledger/model/ledger-model";
import { safeLedgerErrorMessage } from "@/features/ledger/ui/ledger-ui";
import { useModalIsolation } from "@/features/workbench/ui/modal-lifecycle";

type CategoryCreateDialogProps = {
  controller: LedgerController;
  onClose(): void;
  returnFocusRef: React.RefObject<HTMLButtonElement | null>;
};

type CategoryDraft = {
  name: string;
  kind: TransactionCategoryKind;
  parent: string;
};

const emptyDraft: CategoryDraft = {
  name: "",
  kind: "expense",
  parent: "",
};

export function CategoryCreateDialog({
  controller,
  onClose,
  returnFocusRef,
}: CategoryCreateDialogProps): React.ReactNode {
  const [host, setHost] = React.useState<HTMLElement | null>(null);

  React.useLayoutEffect(() => {
    const element = document.createElement("div");
    element.dataset.ravenModalHost = "";
    document.body.append(element);
    setHost(element);
    return () => element.remove();
  }, []);

  return host ? createPortal(
    <CategoryCreateDialogContent
      controller={controller}
      onClose={onClose}
      returnFocusRef={returnFocusRef}
    />,
    host,
  ) : null;
}

function CategoryCreateDialogContent({
  controller,
  onClose,
  returnFocusRef,
}: CategoryCreateDialogProps) {
  const [draft, setDraft] = React.useState(emptyDraft);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const mounted = React.useRef(true);
  const dialogRef = React.useRef<HTMLDivElement | null>(null);
  useModalIsolation(dialogRef, true, "body");

  React.useEffect(() => {
    mounted.current = true;
    dialogRef.current?.querySelector<HTMLElement>(
      "form input:not([disabled]), form select:not([disabled]), form button:not([disabled])",
    )?.focus();
    return () => {
      mounted.current = false;
      if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus();
    };
  }, [returnFocusRef]);

  function field(name: "name" | "parent", value: string) {
    setDraft((current) => ({ ...current, [name]: value }));
  }

  function changeKind(kind: TransactionCategoryKind) {
    setDraft((current) => ({ ...current, kind, parent: "" }));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    let saved = false;
    try {
      await controller.createCategory({
        name: draft.name,
        kind: draft.kind,
        parent: draft.parent || null,
      });
      saved = true;
    } catch (cause) {
      if (mounted.current) {
        setError(safeLedgerErrorMessage(cause, "Could not create category."));
      }
    } finally {
      if (!mounted.current) return;
      setPending(false);
      if (saved) onClose();
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      if (!pending) onClose();
      return;
    }
    if (event.key !== "Tab" || !dialogRef.current) return;
    const focusables = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
      'input:not([disabled]), select:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])',
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

  const parents = categoryParentOptions(controller.state.categories, draft.kind);

  return (
    <div className="confirmation-backdrop">
      <div
        ref={dialogRef}
        className="confirmation-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Add category"
        aria-busy={pending}
        onKeyDown={handleKeyDown}
      >
        <header className="dashboard-widget-header">
          <h2>Add category</h2>
          <button
            type="button"
            aria-label="Close Add category"
            disabled={pending}
            onClick={onClose}
          >
            Close
          </button>
        </header>
        <form aria-label="New category" onSubmit={submit}>
          <label className="field-label">
            Category name
            <input
              required
              disabled={pending}
              value={draft.name}
              onChange={(event) => field("name", event.target.value)}
            />
          </label>
          <label className="field-label">
            Category type
            <select
              disabled={pending}
              value={draft.kind}
              onChange={(event) => changeKind(event.target.value as TransactionCategoryKind)}
            >
              <option value="expense">Expense</option>
              <option value="income">Income</option>
            </select>
          </label>
          <label className="field-label">
            Parent category
            <select
              disabled={pending}
              value={draft.parent}
              onChange={(event) => field("parent", event.target.value)}
            >
              <option value="">No parent</option>
              {parents.map((parent) => (
                <option key={parent.id} value={parent.id}>{parent.name}</option>
              ))}
            </select>
          </label>
          {error ? <p role="alert" className="items-message">{error}</p> : null}
          <button type="submit" disabled={pending}>Add</button>
        </form>
      </div>
    </div>
  );
}
