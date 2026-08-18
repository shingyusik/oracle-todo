"use client";

import React, { useEffect, useReducer, useRef, useState } from "react";
import { ArrowLeft, Redo2, Save, Trash2, Undo2 } from "lucide-react";

import type { TransactionCategoryInput } from "@/features/ledger/api/ledger-api";
import type { LedgerController } from "@/features/ledger/hooks/useLedgerController";
import { categoryParentOptions, type CategoryRow } from "@/features/ledger/model/category-table";
import type { TransactionCategoryKind } from "@/features/ledger/model/ledger-model";
import { safeLedgerErrorMessage } from "@/features/ledger/ui/ledger-ui";
import { DestructiveConfirmationDialog } from "@/features/workbench/ui/DestructiveConfirmationDialog";

type CategoryDetailProps = {
  controller: LedgerController;
  row: CategoryRow;
  onBack(): void;
  onDeleted(): void;
};

type CategoryDraft = {
  name: string;
  kind: TransactionCategoryKind;
  parent: string;
};

type DraftHistory = {
  past: CategoryDraft[];
  present: CategoryDraft;
  future: CategoryDraft[];
  group: keyof CategoryDraft | null;
};

type DraftAction =
  | { type: "change"; patch: Partial<CategoryDraft>; group?: keyof CategoryDraft }
  | { type: "reset"; present: CategoryDraft }
  | { type: "undo" | "redo" | "close-group" };

export function CategoryDetail({ controller, row, onBack, onDeleted }: CategoryDetailProps) {
  const initialDraft = categoryDraft(row);
  const [history, dispatch] = useReducer(historyReducer, initialDraft, (present) => ({
    past: [], present, future: [], group: null,
  }));
  const [baseline, setBaseline] = useState(initialDraft);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<"back" | "delete" | null>(null);
  const actionInFlight = useRef(false);
  const mounted = useRef(true);
  const nameRef = useRef<HTMLInputElement>(null);
  const backButtonRef = useRef<HTMLButtonElement>(null);
  const deleteButtonRef = useRef<HTMLButtonElement>(null);
  const draft = history.present;
  const dirty = !sameDraft(draft, baseline);
  const parents = categoryParentOptions(controller.state.categories, draft.kind, row.id);
  const hasActiveChildren = controller.state.categories.some(
    (category) => category.active && category.parentId === row.id,
  );

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  async function save() {
    if (pending || actionInFlight.current || !dirty) return;
    if (!draft.name.trim()) {
      setError("Category name is required.");
      nameRef.current?.focus();
      return;
    }
    const saved = draft;
    actionInFlight.current = true;
    dispatch({ type: "close-group" });
    setPending(true);
    setError(null);
    try {
      await controller.updateCategory(row.id, categoryUpdate(baseline, saved));
      if (mounted.current) {
        setBaseline(saved);
        dispatch({ type: "reset", present: saved });
      }
    } catch (cause) {
      if (mounted.current) setError(safeLedgerErrorMessage(cause, "Could not save category."));
    } finally {
      actionInFlight.current = false;
      if (mounted.current) setPending(false);
    }
  }

  function back() {
    if (pending || actionInFlight.current) return;
    if (dirty) setConfirmation("back");
    else onBack();
  }

  async function remove() {
    if (pending || actionInFlight.current || hasActiveChildren) return;
    actionInFlight.current = true;
    setPending(true);
    setDeleteError(null);
    let deleted = false;
    try {
      await controller.archiveCategory(row.id);
      deleted = true;
    } catch (cause) {
      if (mounted.current) setDeleteError(safeLedgerErrorMessage(cause, "Could not delete category."));
    } finally {
      actionInFlight.current = false;
      if (mounted.current) setPending(false);
    }
    if (deleted && mounted.current) onDeleted();
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.isComposing || pending || actionInFlight.current || confirmation || !(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === "s") {
        event.preventDefault();
        void save();
      } else if (key === "z" && event.shiftKey) {
        event.preventDefault();
        dispatch({ type: "redo" });
      } else if (key === "z") {
        event.preventDefault();
        dispatch({ type: "undo" });
      } else if (key === "y") {
        event.preventDefault();
        dispatch({ type: "redo" });
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  return (
    <section className="detail-view" aria-label={`${row.name} details`}>
      <header className="detail-header">
        <button ref={backButtonRef} type="button" className="detail-back" aria-label="< Back" disabled={pending} onClick={back}>
          <ArrowLeft size={16} aria-hidden="true" />
        </button>
        <div className="detail-actions">
          <button type="button" aria-label="Undo" title="Undo (Ctrl/Cmd+Z)" disabled={pending || history.past.length === 0} onClick={() => dispatch({ type: "undo" })}><Undo2 size={16} aria-hidden="true" /></button>
          <button type="button" aria-label="Redo" title="Redo (Ctrl/Cmd+Shift+Z or Ctrl+Y)" disabled={pending || history.future.length === 0} onClick={() => dispatch({ type: "redo" })}><Redo2 size={16} aria-hidden="true" /></button>
          <button type="button" aria-label="Save" title="Save (Ctrl/Cmd+S)" disabled={pending || !dirty} onClick={() => void save()}><Save size={16} aria-hidden="true" /></button>
          <button
            ref={deleteButtonRef}
            type="button"
            aria-label="Delete"
            title={hasActiveChildren ? "Delete child categories first" : "Delete"}
            disabled={pending || hasActiveChildren}
            onClick={() => { setDeleteError(null); setConfirmation("delete"); }}
          ><Trash2 size={16} aria-hidden="true" /></button>
        </div>
      </header>
      <div className="detail-layout">
        <div className="detail-heading"><h1>{draft.name}</h1></div>
        <section className="detail-editor" aria-label="Edit category properties" onBlurCapture={() => dispatch({ type: "close-group" })}>
          {error ? <p role="alert" className="form-error">{error}</p> : null}
          <div className="detail-properties"><div className="detail-properties-list">
            <label className="field-label">
              Category name
              <input ref={nameRef} required disabled={pending} value={draft.name} onChange={(event) => dispatch({ type: "change", patch: { name: event.target.value }, group: "name" })} />
            </label>
            <label className="field-label">
              Category type
              <select disabled={pending} value={draft.kind} onChange={(event) => dispatch({ type: "change", patch: { kind: event.target.value as TransactionCategoryKind, parent: "" } })}>
                <option value="expense">Expense</option>
                <option value="income">Income</option>
              </select>
            </label>
            <label className="field-label">
              Parent category
              <select disabled={pending} value={draft.parent} onChange={(event) => dispatch({ type: "change", patch: { parent: event.target.value } })}>
                <option value="">No parent</option>
                {parents.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                {draft.parent && !parents.some(({ id }) => id === draft.parent) ? (
                  <option value={draft.parent} disabled>{row.parentLabel}</option>
                ) : null}
              </select>
            </label>
          </div></div>
        </section>
      </div>
      {confirmation === "back" ? (
        <DestructiveConfirmationDialog
          title="Discard unsaved changes?"
          description="Your changes will be lost if you leave this detail."
          confirmLabel="Discard changes"
          fallbackFocusRef={backButtonRef}
          onCancel={() => setConfirmation(null)}
          onConfirm={async () => onBack()}
        />
      ) : null}
      {confirmation === "delete" ? (
        <DestructiveConfirmationDialog
          title={`Delete ${draft.name}?`}
          description={dirty ? "Deactivate this category? Unsaved changes will be discarded." : "Deactivate this category?"}
          confirmLabel="Delete"
          error={deleteError}
          disabled={pending}
          fallbackFocusRef={deleteButtonRef}
          onCancel={() => { setDeleteError(null); setConfirmation(null); }}
          onConfirm={remove}
        />
      ) : null}
    </section>
  );
}

function categoryDraft(row: CategoryRow): CategoryDraft {
  return { name: row.name, kind: row.kind, parent: row.parentId ?? "" };
}

function historyReducer(state: DraftHistory, action: DraftAction): DraftHistory {
  if (action.type === "reset") return { past: [], present: action.present, future: [], group: null };
  if (action.type === "close-group") return { ...state, group: null };
  if (action.type === "undo") {
    const present = state.past.at(-1);
    return present ? { past: state.past.slice(0, -1), present, future: [state.present, ...state.future], group: null } : state;
  }
  if (action.type === "redo") {
    const [present, ...future] = state.future;
    return present ? { past: [...state.past, state.present], present, future, group: null } : state;
  }
  if (action.type !== "change") return state;
  const present = { ...state.present, ...action.patch };
  if (sameDraft(present, state.present)) return state;
  return action.group && state.group === action.group
    ? { ...state, present, future: [] }
    : { past: [...state.past, state.present], present, future: [], group: action.group ?? null };
}

function sameDraft(left: CategoryDraft, right: CategoryDraft) {
  return left.name === right.name && left.kind === right.kind && left.parent === right.parent;
}

function categoryUpdate(baseline: CategoryDraft, draft: CategoryDraft): Partial<TransactionCategoryInput> {
  return {
    ...(draft.name !== baseline.name ? { name: draft.name } : {}),
    ...(draft.kind !== baseline.kind ? { kind: draft.kind } : {}),
    ...(draft.parent !== baseline.parent ? { parent: draft.parent || null } : {}),
  };
}
