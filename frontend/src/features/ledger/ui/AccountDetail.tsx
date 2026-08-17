"use client";

import React, { useEffect, useReducer, useRef, useState } from "react";
import { ArrowLeft, Redo2, Save, Trash2, Undo2 } from "lucide-react";

import type { LedgerController } from "@/features/ledger/hooks/useLedgerController";
import type { AccountRow } from "@/features/ledger/model/account-table";
import { formatMinorUnits, formatMoney, safeLedgerErrorMessage } from "@/features/ledger/ui/ledger-ui";
import { DestructiveConfirmationDialog } from "@/features/workbench/ui/DestructiveConfirmationDialog";

type AccountDetailProps = {
  controller: LedgerController;
  row: AccountRow;
  onBack(): void;
  onDeleted(): void;
};

type AccountDraft = {
  name: string;
  category: string;
  currency: string;
  openingBalance: string;
};

type DraftHistory = {
  past: AccountDraft[];
  present: AccountDraft;
  future: AccountDraft[];
  group: keyof AccountDraft | null;
};

type DraftAction =
  | { type: "change"; name: keyof AccountDraft; value: string; group: boolean }
  | { type: "undo" | "redo" | "close-group" };

export function AccountDetail({ controller, row, onBack, onDeleted }: AccountDetailProps) {
  const initialDraft = accountDraft(row);
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
  const backButtonRef = useRef<HTMLButtonElement>(null);
  const deleteButtonRef = useRef<HTMLButtonElement>(null);
  const draft = history.present;
  const dirty = !sameDraft(draft, baseline);
  const activeAccountTypes = controller.state.accountCategories.filter(({ active }) => active);
  const activeCurrencies = controller.state.currencies.filter(({ active }) => active);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  function field(name: keyof AccountDraft, value: string, group = false) {
    dispatch({ type: "change", name, value, group });
  }

  async function save() {
    if (pending || actionInFlight.current || !dirty) return;
    const saved = draft;
    actionInFlight.current = true;
    dispatch({ type: "close-group" });
    setPending(true);
    setError(null);
    try {
      await controller.updateAccount(row.id, saved);
      if (mounted.current) setBaseline(saved);
    } catch (cause) {
      if (mounted.current) setError(safeLedgerErrorMessage(cause, "Could not save account."));
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
    if (pending || actionInFlight.current) return;
    actionInFlight.current = true;
    setPending(true);
    setDeleteError(null);
    let deleted = false;
    try {
      await controller.archiveAccount(row.id);
      deleted = true;
    } catch (cause) {
      if (mounted.current) setDeleteError(safeLedgerErrorMessage(cause, "Could not delete account."));
    } finally {
      actionInFlight.current = false;
      if (mounted.current) setPending(false);
    }
    if (deleted && mounted.current) onDeleted();
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (
        event.isComposing || pending || actionInFlight.current || confirmation ||
        !(event.ctrlKey || event.metaKey)
      ) return;
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
          <button type="button" aria-label="Undo" title="Undo (Ctrl/Cmd+Z)" disabled={pending || history.past.length === 0} onClick={() => dispatch({ type: "undo" })}>
            <Undo2 size={16} aria-hidden="true" />
          </button>
          <button type="button" aria-label="Redo" title="Redo (Ctrl/Cmd+Shift+Z or Ctrl+Y)" disabled={pending || history.future.length === 0} onClick={() => dispatch({ type: "redo" })}>
            <Redo2 size={16} aria-hidden="true" />
          </button>
          <button type="button" aria-label="Save" title="Save (Ctrl/Cmd+S)" disabled={pending || !dirty} onClick={() => void save()}>
            <Save size={16} aria-hidden="true" />
          </button>
          <button ref={deleteButtonRef} type="button" aria-label="Delete" title="Delete" disabled={pending} onClick={() => {
            setDeleteError(null);
            setConfirmation("delete");
          }}>
            <Trash2 size={16} aria-hidden="true" />
          </button>
        </div>
      </header>
      <div className="detail-layout">
        <div className="detail-heading"><h1>{draft.name}</h1></div>
        <section className="detail-editor" aria-label="Edit account properties" onBlurCapture={() => dispatch({ type: "close-group" })}>
          {error ? <p role="alert" className="form-error">{error}</p> : null}
          <div className="detail-properties"><div className="detail-properties-list">
            <label className="field-label">
              Account name
              <input required disabled={pending} value={draft.name} onChange={(event) => field("name", event.target.value, true)} />
            </label>
            <label className="field-label">
              Account type
              <select required disabled={pending} value={draft.category} onChange={(event) => field("category", event.target.value)}>
                {activeAccountTypes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                {!activeAccountTypes.some(({ id }) => id === draft.category) ? (
                  <option value={draft.category} disabled>{row.accountTypeLabel}</option>
                ) : null}
              </select>
            </label>
            <label className="field-label">
              Currency
              <select required disabled={pending} value={draft.currency} onChange={(event) => field("currency", event.target.value)}>
                {activeCurrencies.map((item) => <option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}
                {!activeCurrencies.some(({ id }) => id === draft.currency) ? (
                  <option value={draft.currency} disabled>{row.currencyCode}</option>
                ) : null}
              </select>
            </label>
            <label className="field-label">
              Opening balance
              <input required inputMode="decimal" disabled={pending} value={draft.openingBalance} onChange={(event) => field("openingBalance", event.target.value, true)} />
            </label>
            <div className="field-label">
              Current balance
              <output aria-label="Current balance">{formatMoney(row.currentBalanceMinor, {
                code: row.currencyCode,
                decimalPlaces: row.decimalPlaces,
              })}</output>
            </div>
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
          description={dirty
            ? "Deactivate this account? Unsaved changes will be discarded."
            : "Deactivate this account?"}
          confirmLabel="Delete"
          error={deleteError}
          disabled={pending}
          fallbackFocusRef={deleteButtonRef}
          onCancel={() => {
            setDeleteError(null);
            setConfirmation(null);
          }}
          onConfirm={remove}
        />
      ) : null}
    </section>
  );
}

function accountDraft(row: AccountRow): AccountDraft {
  return {
    name: row.name,
    category: row.accountTypeId,
    currency: row.currencyId,
    openingBalance: formatMinorUnits(row.account.openingBalanceMinor, row.decimalPlaces),
  };
}

function historyReducer(state: DraftHistory, action: DraftAction): DraftHistory {
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
  if (state.present[action.name] === action.value) return state;
  const present = { ...state.present, [action.name]: action.value } as AccountDraft;
  return action.group && state.group === action.name
    ? { ...state, present, future: [] }
    : { past: [...state.past, state.present], present, future: [], group: action.group ? action.name : null };
}

function sameDraft(left: AccountDraft, right: AccountDraft) {
  return left.name === right.name &&
    left.category === right.category &&
    left.currency === right.currency &&
    left.openingBalance === right.openingBalance;
}
