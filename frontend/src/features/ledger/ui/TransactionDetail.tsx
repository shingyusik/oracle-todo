"use client";

import React, { useEffect, useReducer, useRef, useState } from "react";
import { ArrowLeft, Redo2, Save, Trash2, Undo2 } from "lucide-react";

import type { LedgerController } from "@/features/ledger/hooks/useLedgerController";
import type {
  LedgerEntryUpdate,
  PublicLedgerEntryType,
  TransferUpdate,
} from "@/features/ledger/model/ledger-model";
import type { TransactionRow } from "@/features/ledger/model/transaction-table";
import { formatMinorUnits } from "@/features/ledger/ui/ledger-ui";
import { DestructiveConfirmationDialog } from "@/features/workbench/ui/DestructiveConfirmationDialog";

type TransactionDetailProps = {
  controller: LedgerController;
  row: TransactionRow;
  onBack(): void;
  onArchived(): void;
};

type TransactionDraft = {
  content: string;
  date: string;
  entryType: PublicLedgerEntryType;
  account: string;
  category: string;
  fromAccount: string;
  toAccount: string;
  amount: string;
  currency: string;
  notes: string;
};

type DraftHistory = {
  past: TransactionDraft[];
  present: TransactionDraft;
  future: TransactionDraft[];
  group: keyof TransactionDraft | null;
};

type DraftAction =
  | { type: "change"; name: keyof TransactionDraft; value: string; group: boolean }
  | { type: "undo" | "redo" | "close-group" };

export function TransactionDetail({ controller, row, onBack, onArchived }: TransactionDetailProps) {
  const initialDraft = transactionDraft(row, controller);
  const [history, dispatch] = useReducer(historyReducer, initialDraft, (present) => ({
    past: [],
    present,
    future: [],
    group: null,
  }));
  const [baseline, setBaseline] = useState(initialDraft);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<"back" | "archive" | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const backButtonRef = useRef<HTMLButtonElement>(null);
  const archiveButtonRef = useRef<HTMLButtonElement>(null);
  const draft = history.present;
  const dirty = !sameDraft(draft, baseline);
  const transfer = row.kind === "transfer";
  const activeAccounts = controller.state.accounts.filter(({ active }) => active);
  const activeCurrencies = controller.state.currencies.filter(({ active }) => active);
  const activeCategories = controller.state.categories.filter(({ active, kind }) =>
    active && kind === (draft.entryType === "income" || draft.entryType === "adjustment_in"
      ? "income"
      : "expense"));
  const source = activeAccounts.find(({ id }) => id === draft.fromAccount);

  function field(name: keyof TransactionDraft, value: string, group = false) {
    dispatch({ type: "change", name, value, group });
  }

  async function save() {
    if (pending || !dirty) return;
    const saved = draft;
    dispatch({ type: "close-group" });
    setPending(true);
    setError(null);
    try {
      if (transfer) {
        await controller.updateTransfer(row.id, transferUpdate(saved));
      } else {
        await controller.updateEntry(row.detailEntry.entry.id, entryUpdate(baseline, saved));
      }
      setBaseline(saved);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save transaction");
    } finally {
      setPending(false);
    }
  }

  function back() {
    if (pending) return;
    if (dirty) setConfirmation("back");
    else onBack();
  }

  async function archive() {
    if (pending) return;
    setPending(true);
    setArchiveError(null);
    try {
      await controller.archive(row.archiveEntryId);
      onArchived();
    } catch (cause) {
      setArchiveError(cause instanceof Error ? cause.message : "Could not archive transaction");
    } finally {
      setPending(false);
    }
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.isComposing || pending || confirmation || !(event.ctrlKey || event.metaKey)) return;
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
    <section className="detail-view" aria-label={`${row.content} details`}>
      <header className="detail-header">
        <button ref={backButtonRef} type="button" className="detail-back" aria-label="< Back" onClick={back}>
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
          <button ref={archiveButtonRef} type="button" aria-label="Archive" title="Archive" disabled={pending} onClick={() => {
            setArchiveError(null);
            setConfirmation("archive");
          }}>
            <Trash2 size={16} aria-hidden="true" />
          </button>
        </div>
      </header>
      <div className="detail-layout">
        <div className="detail-heading">
          <div className="detail-kicker"><span>{transfer ? "transfer" : draft.entryType}</span></div>
          <h1>{draft.content}</h1>
        </div>
        <section className="detail-editor" aria-label="Edit transaction properties" onBlurCapture={() => dispatch({ type: "close-group" })}>
          {error ? <p role="alert" className="form-error">{error}</p> : null}
          <div className="detail-properties">
            <div className="detail-properties-list">
              <label className="field-label">
                Content
                <input required value={draft.content} onChange={(event) => field("content", event.target.value, true)} />
              </label>
              <label className="field-label">
                Date
                <input type="date" required value={draft.date} onChange={(event) => field("date", event.target.value)} />
              </label>
              {!transfer ? (
                <>
                  <label className="field-label">
                    Type
                    <select value={draft.entryType} onChange={(event) => field("entryType", event.target.value)}>
                      <option value="expense">Expense</option>
                      <option value="income">Income</option>
                      {draft.entryType.startsWith("adjustment_") ? (
                        <option value={draft.entryType} disabled>Balance adjustment</option>
                      ) : null}
                    </select>
                  </label>
                  <label className="field-label">
                    Account
                    <select required value={draft.account} onChange={(event) => field("account", event.target.value)}>
                      {accountOptions(activeAccounts, draft.account, row.detailEntry.accountName)}
                    </select>
                  </label>
                  <label className="field-label">
                    Category
                    <select value={draft.category} onChange={(event) => field("category", event.target.value)}>
                      <option value="">No category</option>
                      {activeCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                      {draft.category && !activeCategories.some(({ id }) => id === draft.category) ? (
                        <option value={draft.category}>{row.detailEntry.categoryName ?? "Current category"}</option>
                      ) : null}
                    </select>
                  </label>
                </>
              ) : (
                <>
                  <label className="field-label">
                    Source account
                    <select required value={draft.fromAccount} onChange={(event) => field("fromAccount", event.target.value)}>
                      {accountOptions(activeAccounts, draft.fromAccount, row.detailEntry.accountName)}
                    </select>
                  </label>
                  <label className="field-label">
                    Destination account
                    <select required value={draft.toAccount} onChange={(event) => field("toAccount", event.target.value)}>
                      {accountOptions(
                        activeAccounts.filter((account) => !source || (account.id !== source.id && account.currencyId === source.currencyId)),
                        draft.toAccount,
                        row.transferEntry?.accountName ?? null,
                      )}
                    </select>
                  </label>
                </>
              )}
              <label className="field-label">
                Amount
                <input required inputMode="decimal" value={draft.amount} onChange={(event) => field("amount", event.target.value, true)} />
              </label>
              <label className="field-label">
                Currency
                <select required value={draft.currency} onChange={(event) => field("currency", event.target.value)}>
                  {activeCurrencies.map((currency) => <option key={currency.id} value={currency.id}>{currency.code} — {currency.name}</option>)}
                  {!activeCurrencies.some(({ id }) => id === draft.currency) ? (
                    <option value={draft.currency}>{row.currencyCode || "Current currency"}</option>
                  ) : null}
                </select>
              </label>
              <label className="field-label">
                Note
                <textarea value={draft.notes} onChange={(event) => field("notes", event.target.value, true)} />
              </label>
            </div>
          </div>
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
      {confirmation === "archive" ? (
        <DestructiveConfirmationDialog
          title={`Archive ${draft.content}?`}
          description={dirty
            ? "Move this transaction to Archive? Unsaved changes will be discarded."
            : "Move this transaction to Archive?"}
          confirmLabel="Archive"
          error={archiveError}
          disabled={pending}
          fallbackFocusRef={archiveButtonRef}
          onCancel={() => {
            setArchiveError(null);
            setConfirmation(null);
          }}
          onConfirm={archive}
        />
      ) : null}
    </section>
  );
}

function historyReducer(state: DraftHistory, action: DraftAction): DraftHistory {
  if (action.type === "close-group") return { ...state, group: null };
  if (action.type === "undo") {
    const present = state.past.at(-1);
    return present
      ? { past: state.past.slice(0, -1), present, future: [state.present, ...state.future], group: null }
      : state;
  }
  if (action.type === "redo") {
    const [present, ...future] = state.future;
    return present
      ? { past: [...state.past, state.present], present, future, group: null }
      : state;
  }
  if (action.type !== "change") return state;
  if (state.present[action.name] === action.value) return state;
  const present = { ...state.present, [action.name]: action.value } as TransactionDraft;
  return action.group && state.group === action.name
    ? { ...state, present, future: [] }
    : {
        past: [...state.past, state.present],
        present,
        future: [],
        group: action.group ? action.name : null,
      };
}

function sameDraft(left: TransactionDraft, right: TransactionDraft) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function entryUpdate(baseline: TransactionDraft, draft: TransactionDraft): LedgerEntryUpdate {
  const update: LedgerEntryUpdate = {};
  if (draft.date !== baseline.date) update.date = draft.date;
  if (draft.content !== baseline.content) update.content = draft.content;
  if (draft.entryType !== baseline.entryType) update.entryType = draft.entryType;
  if (draft.account !== baseline.account) update.account = draft.account;
  if (draft.category !== baseline.category) update.category = draft.category || null;
  if (draft.amount !== baseline.amount) update.amount = draft.amount;
  if (draft.currency !== baseline.currency) update.currency = draft.currency;
  if (draft.notes !== baseline.notes) update.notes = draft.notes || null;
  return update;
}

function transferUpdate(draft: TransactionDraft): TransferUpdate {
  return {
    date: draft.date,
    content: draft.content,
    fromAccount: draft.fromAccount,
    toAccount: draft.toAccount,
    amount: draft.amount,
    currency: draft.currency,
    notes: draft.notes || null,
  };
}

function transactionDraft(row: TransactionRow, controller: LedgerController): TransactionDraft {
  const entry = row.detailEntry.entry;
  const currency = controller.state.currencies.find(({ id }) => id === entry.currencyId);
  return {
    content: entry.content,
    date: entry.date,
    entryType: (entry.entryType === "transfer_out" || entry.entryType === "transfer_in"
      ? "expense"
      : entry.entryType) as PublicLedgerEntryType,
    account: entry.accountId,
    category: entry.transactionCategoryId ?? "",
    fromAccount: entry.accountId,
    toAccount: row.transferEntry?.entry.accountId ?? "",
    amount: formatMinorUnits(entry.amountMinor, currency?.decimalPlaces ?? 0),
    currency: entry.currencyId,
    notes: entry.notes ?? "",
  };
}

function accountOptions(
  accounts: LedgerController["state"]["accounts"],
  selected: string,
  selectedName: string | null,
) {
  return (
    <>
      {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
      {selected && !accounts.some(({ id }) => id === selected) ? (
        <option value={selected}>{selectedName ?? "Current account"}</option>
      ) : null}
    </>
  );
}
