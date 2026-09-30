"use client";

import React, { useEffect, useRef, useState } from "react";
import { useDraftDirty } from "@/features/workbench/ui/modal-lifecycle";

import {
  LedgerMutationRefreshError,
  type LedgerController,
} from "@/features/ledger/hooks/useLedgerController";
import type {
  LedgerEntryInput,
  TransferInput,
} from "@/features/ledger/model/ledger-model";


type TransactionFormProps = {
  controller: LedgerController;
  onClose?: () => void;
  onSaved?: () => void;
  onPendingChange?: (pending: boolean) => void;
  onDirtyChange?: (dirty: boolean) => void;
};

type CreationMode = "expense" | "income" | "transfer";
const creationModes: CreationMode[] = ["expense", "income", "transfer"];

export function TransactionForm({
  controller,
  onClose,
  onSaved,
  onPendingChange,
  onDirtyChange,
}: TransactionFormProps) {
  const initial = transactionDraft();
  const [mode, setMode] = useState<CreationMode>("expense");
  const [focusedMode, setFocusedMode] = useState<CreationMode>("expense");
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

  function field(name: keyof typeof draft, value: string) {
    setDraft((current) => ({ ...current, [name]: value }));
  }

  function selectMode(nextMode: CreationMode) {
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
    setFocusedMode(nextMode);
    tabRefs.current.get(nextMode)?.focus();
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
      if (mode === "transfer") {
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
        if (saved) setDraft(transactionDraft());
        setPending(false);
        if (!persistedWithoutRefresh) {
          onPendingChange?.(false);
          if (saved) onSaved?.();
        }
      }
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
    <form aria-label="New transaction" onSubmit={submit}>
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
              {activeAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
            </select>
          </label>
          <label className="field-label">Category
            <select value={draft.category} onChange={(event) => field("category", event.target.value)}>
              <option value="">No category</option>
              {activeCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
          </label>
        </>
      ) : (
        <>
          <label className="field-label">Source account
            <select required value={draft.fromAccount} onChange={(event) => setDraft((current) => ({ ...current, fromAccount: event.target.value, toAccount: "" }))}>
              <option value="">Select account</option>
              {activeAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
            </select>
          </label>
          <label className="field-label">Destination account
            <select required value={draft.toAccount} onChange={(event) => field("toAccount", event.target.value)}>
              <option value="">Select account</option>
              {activeAccounts.filter((account) => !selectedSource || (account.id !== selectedSource.id && account.currencyId === selectedSource.currencyId)).map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
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
            aria-label="Close Add transaction"
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
