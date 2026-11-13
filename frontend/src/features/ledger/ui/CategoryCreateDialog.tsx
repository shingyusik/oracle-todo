"use client";

import { ReferenceDataBoundary } from "@/features/workbench/ui/ReferenceDataBoundary";

import React from "react";
import { createPortal } from "react-dom";

import type { TransactionCategoryInput } from "@/features/ledger/api/ledger-api";
import type { LedgerController } from "@/features/ledger/hooks/useLedgerController";
import { categoryParentOptions, type CategoryRow } from "@/features/ledger/model/category-table";
import type { TransactionCategoryKind } from "@/features/ledger/model/ledger-model";
import { InitialFieldFocus, useDialogFocus } from "@/features/ledger/ui/dialog-focus";
import { safeLedgerErrorMessage } from "@/features/ledger/ui/ledger-ui";
import { useDraftDirty, useModalIsolation } from "@/features/workbench/ui/modal-lifecycle";
import { useDiscardConfirmation } from "@/features/workbench/ui/use-discard-confirmation";

type CategoryCreateDialogProps = {
  controller: LedgerController;
  /** Existing category to edit; the dialog creates a new one when omitted. */
  record?: CategoryRow;
  onClose(): void;
  onDirtyChange?(dirty: boolean): void;
  returnFocusRef: React.RefObject<HTMLElement | null>;
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

export function CategoryCreateDialog(props: CategoryCreateDialogProps): React.ReactNode {
  const [host, setHost] = React.useState<HTMLElement | null>(null);

  React.useLayoutEffect(() => {
    const element = document.createElement("div");
    element.dataset.ravenModalHost = "";
    document.body.append(element);
    setHost(element);
    return () => element.remove();
  }, []);

  return host ? createPortal(
    <CategoryCreateDialogContent {...props} />,
    host,
  ) : null;
}

function CategoryCreateDialogContent({
  controller,
  record,
  onClose,
  onDirtyChange: reportDirty,
  returnFocusRef,
}: CategoryCreateDialogProps) {
  const title = record ? "Edit category" : "Add category";
  const closeLabel = `Close ${title}`;
  const [initial] = React.useState<CategoryDraft>(() => (
    record ? { name: record.name, kind: record.kind, parent: record.parentId ?? "" } : emptyDraft
  ));
  const [draft, setDraft] = React.useState(initial);
  const nameRef = React.useRef<HTMLInputElement>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const mounted = React.useRef(true);
  const dialogRef = React.useRef<HTMLDivElement | null>(null);
  useModalIsolation(dialogRef, true, "body");
  const { onDirtyChange: markDirty, requestDiscard, discardConfirmation } = useDiscardConfirmation(dialogRef);
  const onDirtyChange = React.useCallback((dirty: boolean) => {
    markDirty(dirty);
    reportDirty?.(dirty);
  }, [markDirty, reportDirty]);
  useDraftDirty([draft], onDirtyChange);

  function close() {
    if (!pending) requestDiscard(onClose);
  }

  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useDialogFocus(dialogRef, returnFocusRef);

  function field(name: "name" | "parent", value: string) {
    setDraft((current) => ({ ...current, [name]: value }));
  }

  function changeKind(kind: TransactionCategoryKind) {
    setDraft((current) => ({ ...current, kind, parent: "" }));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (record && !draft.name.trim()) {
      setError("Category name is required.");
      nameRef.current?.focus();
      return;
    }
    setPending(true);
    setError(null);
    let saved = false;
    try {
      if (record) {
        const update = categoryUpdate(initial, draft);
        if (Object.keys(update).length > 0) await controller.updateCategory(record.id, update);
      } else {
        await controller.createCategory({
          name: draft.name,
          kind: draft.kind,
          parent: draft.parent || null,
        });
      }
      saved = true;
    } catch (cause) {
      if (mounted.current) {
        setError(safeLedgerErrorMessage(cause, record ? "Could not save category." : "Could not create category."));
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
      close();
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

  const parents = categoryParentOptions(controller.state.categories, draft.kind, record?.id);

  return (
    <div className="confirmation-backdrop">
      <div
        ref={dialogRef}
        className="confirmation-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        aria-busy={pending}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        {discardConfirmation}
        <header className="dashboard-widget-header">
          <h2>{title}</h2>
        </header>
        <ReferenceDataBoundary load={controller.ensureReferenceData} scope="ledger.categories" onCancel={close} cancelLabel={closeLabel}>
        <InitialFieldFocus />
        <form aria-label={record ? "Edit category" : "New category"} onSubmit={submit}>
          <label className="field-label">
            Category name
            <input
              ref={nameRef}
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
              {record && draft.parent && !parents.some(({ id }) => id === draft.parent) ? (
                <option value={draft.parent} disabled>{record.parentLabel}</option>
              ) : null}
            </select>
          </label>
          {error ? <p role="alert" className="items-message">{error}</p> : null}
          <div className="ledger-create-dialog-actions">
            <button
              type="button"
              className="items-toolbar-button"
              aria-label={closeLabel}
              disabled={pending}
              onClick={close}
            >
              Close
            </button>
            <button
              type="submit"
              className="items-toolbar-button ledger-create-dialog-save"
              disabled={pending}
            >
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
        </ReferenceDataBoundary>
      </div>
    </div>
  );
}

function categoryUpdate(baseline: CategoryDraft, draft: CategoryDraft): Partial<TransactionCategoryInput> {
  return {
    ...(draft.name !== baseline.name ? { name: draft.name } : {}),
    ...(draft.kind !== baseline.kind ? { kind: draft.kind } : {}),
    ...(draft.parent !== baseline.parent ? { parent: draft.parent || null } : {}),
  };
}
