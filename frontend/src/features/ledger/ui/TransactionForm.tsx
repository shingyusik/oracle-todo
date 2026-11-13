"use client";

import React, { useEffect, useRef, useState } from "react";
import { useDraftDirty } from "@/features/workbench/ui/modal-lifecycle";
import { RavenApiError } from "@/lib/raven-api";

import {
  LedgerMutationRefreshError,
  type LedgerController,
} from "@/features/ledger/hooks/useLedgerController";
import type {
  LedgerEntryInput,
  LedgerEntryUpdate,
  PublicLedgerEntryType,
  TransferInput,
} from "@/features/ledger/model/ledger-model";
import type { TransactionRow } from "@/features/ledger/model/transaction-table";
import { formatMinorUnits } from "@/features/ledger/ui/ledger-ui";


type TransactionFormProps = {
  controller: LedgerController;
  /** Existing transaction to edit; omitted when creating. */
  record?: TransactionRow;
  /** Called when saving finds that the transaction no longer exists. */
  onMissing?: () => void;
  onClose?: () => void;
  onSaved?: () => void;
  onPendingChange?: (pending: boolean) => void;
  onRefreshRecoveryChange?: (recovering: boolean) => void;
  onDirtyChange?: (dirty: boolean) => void;
};

type CreationMode = "expense" | "income" | "transfer";
const creationModes: CreationMode[] = ["expense", "income", "transfer"];

export function TransactionForm({
  controller,
  record,
  onMissing,
  onClose,
  onSaved,
  onPendingChange,
  onRefreshRecoveryChange,
  onDirtyChange,
}: TransactionFormProps) {
  const [initial] = useState(() => (record ? recordDraft(record, controller) : transactionDraft()));
  const initialMode: CreationMode = record ? recordMode(record) : "expense";
  const editing = record !== undefined;
  const [mode, setMode] = useState<CreationMode>(initialMode);
  const [focusedMode, setFocusedMode] = useState<CreationMode>(initialMode);
  const [draft, setDraft] = useState(initial);
  useDraftDirty([mode, draft], onDirtyChange);
  const [pending, setPending] = useState(false);
  const [refreshRecovery, setRefreshRecovery] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const tabRefs = useRef(new Map<CreationMode, HTMLButtonElement>());
  const tabPanelId = React.useId();

  useEffect(() => () => {
    mounted.current = false;
  }, []);

  useEffect(() => {
    onRefreshRecoveryChange?.(refreshRecovery);
    return () => onRefreshRecoveryChange?.(false);
  }, [refreshRecovery, onRefreshRecoveryChange]);

  function field(name: keyof typeof draft, value: string) {
    setDraft((current) => ({ ...current, [name]: value }));
  }

  function selectMode(nextMode: CreationMode) {
    if (editing && (nextMode === "transfer") !== (initialMode === "transfer")) return;
    if (nextMode !== mode && nextMode !== "transfer") field("category", "");
    setFocusedMode(nextMode);
    setMode(nextMode);
  }

  function moveTabFocus(event: React.KeyboardEvent, index: number) {
    let nextIndex: number | undefined;
    if (event.key === "ArrowLeft") nextIndex = index - 1;
    if (event.key === "ArrowRight") nextIndex = index + 1;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = creationModes.length - 1;
    if (nextIndex === undefined) return;
    event.preventDefault();
    const nextMode = creationModes[(nextIndex + creationModes.length) % creationModes.length];
    if (tabLocked(nextMode)) return;
    setFocusedMode(nextMode);
    tabRefs.current.get(nextMode)?.focus();
  }

  // Editing never converts between a transfer and an ordinary entry.
  function tabLocked(type: CreationMode) {
    return editing && (type === "transfer") !== (initialMode === "transfer");
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending || refreshRecovery) return;
    setPending(true);
    onPendingChange?.(true);
    setError(null);
    let saved = false;
    let persistedWithoutRefresh = false;
    try {
      if (record) {
        await saveEdit(record);
      } else if (mode === "transfer") {
        const currency = controller.state.accounts.find(
          (account) => account.active && account.id === draft.fromAccount,
        )?.currencyId ?? "";
        const input: TransferInput = {
          date: draft.date,
          content: draft.content,
          fromAccount: draft.fromAccount,
          toAccount: draft.toAccount,
          amount: draft.amount,
          currency,
          notes: draft.notes || null,
        };
        await controller.transfer(input);
      } else {
        const currency = controller.state.accounts.find(
          (account) => account.active && account.id === draft.account,
        )?.currencyId ?? "";
        const input: LedgerEntryInput = {
          date: draft.date,
          content: draft.content,
          category: draft.category || null,
          account: draft.account,
          entryType: mode,
          amount: draft.amount,
          currency,
          notes: draft.notes || null,
        };
        await controller.createEntry(input);
      }
      saved = true;
    } catch (cause) {
      if (cause instanceof MissingTransactionError) {
        onMissing?.();
        return;
      }
      if (mounted.current) {
        if (cause instanceof LedgerMutationRefreshError) {
          persistedWithoutRefresh = true;
          setRefreshRecovery(true);
          setError("Transaction saved, but the list could not refresh.");
        } else {
          setError(cause instanceof Error ? cause.message : "Could not save transaction");
        }
      }
    } finally {
      if (mounted.current) {
        if (saved && !editing) setDraft(transactionDraft());
        setPending(false);
        if (!persistedWithoutRefresh) {
          onPendingChange?.(false);
          if (saved) onSaved?.();
        }
      }
    }
  }

  async function saveEdit(row: TransactionRow) {
    const currencyOf = (accountId: string) =>
      controller.state.accounts.find((account) => account.id === accountId)?.currencyId;
    try {
      if (row.kind === "transfer") {
        if (JSON.stringify(draft) === JSON.stringify(initial)) return;
        await controller.updateTransfer(row.id, {
          date: draft.date,
          content: draft.content,
          fromAccount: draft.fromAccount,
          toAccount: draft.toAccount,
          amount: draft.amount,
          currency: currencyOf(draft.fromAccount) ?? row.detailEntry.entry.currencyId,
          notes: draft.notes || null,
        });
        return;
      }
      const update: LedgerEntryUpdate = {};
      if (draft.date !== initial.date) update.date = draft.date;
      if (draft.content !== initial.content) update.content = draft.content;
      if (mode !== initialMode) update.entryType = mode as PublicLedgerEntryType;
      if (draft.account !== initial.account) {
        update.account = draft.account;
        const currency = currencyOf(draft.account);
        if (currency && currency !== row.detailEntry.entry.currencyId) update.currency = currency;
      }
      if (draft.category !== initial.category) update.category = draft.category || null;
      if (draft.amount !== initial.amount) update.amount = draft.amount;
      if (draft.notes !== initial.notes) update.notes = draft.notes || null;
      if (Object.keys(update).length === 0) return;
      await controller.updateEntry(row.detailEntry.entry.id, update);
    } catch (cause) {
      if (cause instanceof RavenApiError && cause.status === 404 && onMissing) {
        throw new MissingTransactionError();
      }
      throw cause;
    }
  }

  async function retryRefresh() {
    if (pending || !refreshRecovery) return;
    setPending(true);
    const refreshed = await controller.refresh();
    if (!mounted.current) return;
    setPending(false);
    if (!refreshed) {
      setError("Transaction saved, but the list could not refresh.");
      return;
    }
    setRefreshRecovery(false);
    setDraft(transactionDraft());
    onPendingChange?.(false);
    onSaved?.();
  }

  const activeAccounts = controller.state.accounts.filter((account) => account.active);
  const activeCategories = controller.state.categories.filter(
    (category) =>
      category.active &&
      category.kind ===
        (mode === "income" ? "income" : "expense"),
  );
  const selectedSource = activeAccounts.find((account) => account.id === draft.fromAccount);

  return (
    <form aria-label={editing ? "Edit transaction" : "New transaction"} onSubmit={submit}>
      <div role="tablist" aria-label="Transaction type" className="transaction-type-tabs">
          {creationModes.map((type, index) => (
            <button
              key={type}
              ref={(element) => {
                if (element) tabRefs.current.set(type, element);
                else tabRefs.current.delete(type);
              }}
              id={`${tabPanelId}-${type}`}
              type="button"
              role="tab"
              className="items-toolbar-button transaction-type-tab"
              aria-selected={mode === type}
              disabled={tabLocked(type)}
              aria-controls={tabPanelId}
              tabIndex={focusedMode === type ? 0 : -1}
              onClick={() => selectMode(type)}
              onKeyDown={(event) => moveTabFocus(event, index)}
            >
              {type[0].toUpperCase() + type.slice(1)}
            </button>
          ))}
        </div>
      <div
        id={tabPanelId}
        role="tabpanel"
        aria-labelledby={`${tabPanelId}-${mode}`}
      >
      <label className="field-label">
        Date
        <input
          type="date"
          required
          value={draft.date}
          onChange={(event) => field("date", event.target.value)}
        />
      </label>

      <label className="field-label">
          Content
          <input
            required
            value={draft.content}
            onChange={(event) => field("content", event.target.value)}
          />
        </label>
      {mode !== "transfer" ? (
        <>
          <label className="field-label">Account
            <select required value={draft.account} onChange={(event) => field("account", event.target.value)}>
              <option value="">Select account</option>
              {accountOptions(activeAccounts, draft.account, record?.detailEntry.accountName)}
            </select>
          </label>
          <label className="field-label">Category
            <select value={draft.category} onChange={(event) => field("category", event.target.value)}>
              <option value="">No category</option>
              {activeCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
              {draft.category && !activeCategories.some(({ id }) => id === draft.category) ? (
                <option value={draft.category}>{record?.detailEntry.categoryName ?? "Current category"}</option>
              ) : null}
            </select>
          </label>
        </>
      ) : (
        <>
          <label className="field-label">Source account
            <select required value={draft.fromAccount} onChange={(event) => setDraft((current) => ({ ...current, fromAccount: event.target.value, toAccount: "" }))}>
              <option value="">Select account</option>
              {accountOptions(activeAccounts, draft.fromAccount, record?.detailEntry.accountName)}
            </select>
          </label>
          <label className="field-label">Destination account
            <select required value={draft.toAccount} onChange={(event) => field("toAccount", event.target.value)}>
              <option value="">Select account</option>
              {accountOptions(
                activeAccounts.filter((account) => !selectedSource || (account.id !== selectedSource.id && account.currencyId === selectedSource.currencyId)),
                draft.toAccount,
                record?.transferEntry?.accountName,
              )}
            </select>
          </label>
        </>
      )}
      <label className="field-label">
        Amount
        <input
          required
          inputMode="decimal"
          value={draft.amount}
          onChange={(event) => field("amount", event.target.value)}
        />
      </label>


      <label className="field-label">
        Note
        <textarea
          value={draft.notes}
          onChange={(event) => field("notes", event.target.value)}
        />
      </label>
      </div>
      {error && <p role="alert" className="items-message">{error}</p>}
      <footer className="ledger-create-dialog-actions">
        {onClose && (
          <button
            type="button"
            aria-label={editing ? "Close Edit transaction" : "Close Add transaction"}
            className="items-toolbar-button"
            disabled={pending || refreshRecovery}
            onClick={onClose}
          >
            Close
          </button>
        )}
        <button
          type="submit"
          className="items-toolbar-button ledger-create-dialog-save"
          disabled={pending || refreshRecovery}
        >
          {refreshRecovery
            ? "Saved"
            : pending
              ? "Saving…"
              : onClose
                  ? "Save"
                  : mode === "transfer"
                    ? "Save transfer"
                    : "Save transaction"}
        </button>
      </footer>
      {refreshRecovery && (
        <button
          type="button"
          className="items-toolbar-button"
          disabled={pending}
          onClick={() => void retryRefresh()}
        >
          {pending ? "Refreshing…" : "Retry refresh"}
        </button>
      )}
    </form>
  );
}

class MissingTransactionError extends Error {}

function accountOptions(
  accounts: LedgerController["state"]["accounts"],
  selected: string,
  selectedName: string | null | undefined,
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

function recordMode(row: TransactionRow): CreationMode {
  if (row.kind === "transfer") return "transfer";
  const type = row.detailEntry.entry.entryType;
  return type === "income" || type === "adjustment_in" ? "income" : "expense";
}

function recordDraft(row: TransactionRow, controller: LedgerController) {
  const entry = row.detailEntry.entry;
  const currency = controller.state.currencies.find(({ id }) => id === entry.currencyId);
  return {
    date: entry.date,
    account: entry.accountId,
    category: entry.transactionCategoryId ?? "",
    fromAccount: entry.accountId,
    toAccount: row.transferEntry?.entry.accountId ?? "",
    amount: formatMinorUnits(entry.amountMinor, currency?.decimalPlaces ?? 0),
    content: entry.content,
    notes: entry.notes ?? "",
  };
}

function transactionDraft() {
  return {
    date: localCalendarDate(new Date()),
    account: "",
    category: "",
    fromAccount: "",
    toAccount: "",
    amount: "",
    content: "",
    notes: "",
  };
}

function localCalendarDate(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
