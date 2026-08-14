"use client";

import React, { useEffect, useRef, useState } from "react";

import type { LedgerController } from "@/features/ledger/hooks/useLedgerController";
import type {
  Currency,
  LedgerEntryInput,
  LedgerEntryView,
  PublicLedgerEntryType,
  TransferInput,
} from "@/features/ledger/model/ledger-model";
import {
  formatMinorUnits,
  localDateTime,
  utcDateTime,
} from "@/features/ledger/ui/ledger-ui";

type TransactionFormProps = {
  controller: LedgerController;
  entry?: LedgerEntryView | null;
  onSaved?: () => void;
  onPendingChange?: (pending: boolean) => void;
};

type CreationMode = "expense" | "income" | "transfer";

export function TransactionForm({
  controller,
  entry = null,
  onSaved,
  onPendingChange,
}: TransactionFormProps) {
  const initial = transactionDraft(entry, controller.state.currencies);
  const [mode, setMode] = useState<CreationMode>("expense");
  const [draft, setDraft] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => () => {
    mounted.current = false;
  }, []);

  function field(name: keyof typeof draft, value: string) {
    setDraft((current) => ({ ...current, [name]: value }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    onPendingChange?.(true);
    setError(null);
    let saved = false;
    try {
      if (mode === "transfer") {
        const currency = controller.state.accounts.find(
          (account) => account.active && account.id === draft.fromAccount,
        )?.currencyId ?? "";
        const input: TransferInput = {
          date: draft.date,
          writtenAt: new Date().toISOString(),
          content: draft.content,
          fromAccount: draft.fromAccount,
          toAccount: draft.toAccount,
          amount: draft.amount,
          currency,
          source: "ui",
          notes: draft.notes || null,
        };
        await controller.transfer(input);
      } else {
        const currency = entry
          ? draft.currency
          : controller.state.accounts.find(
              (account) => account.active && account.id === draft.account,
            )?.currencyId ?? "";
        const input: LedgerEntryInput = {
          date: draft.date,
          writtenAt: entry ? utcDateTime(draft.writtenAt) : new Date().toISOString(),
          content: draft.content,
          category: draft.category || null,
          account: draft.account,
          entryType: entry ? draft.entryType : mode,
          amount: draft.amount,
          currency,
          source: "ui",
          notes: draft.notes || null,
        };
        if (entry) await controller.updateEntry(entry.entry.id, input);
        else await controller.createEntry(input);
      }
      saved = true;
    } catch (cause) {
      if (mounted.current) {
        setError(cause instanceof Error ? cause.message : "Could not save transaction");
      }
    } finally {
      if (mounted.current) {
        if (saved) setDraft(transactionDraft(null, controller.state.currencies));
        setPending(false);
        onPendingChange?.(false);
        if (saved) onSaved?.();
      }
    }
  }

  const activeAccounts = controller.state.accounts.filter((account) => account.active);
  const activeCurrencies = controller.state.currencies.filter((currency) => currency.active);
  const activeCategories = controller.state.categories.filter(
    (category) =>
      category.active &&
      category.kind ===
        categoryKind(entry ? draft.entryType : mode === "income" ? "income" : "expense"),
  );

  return (
    <form aria-label={entry ? "Edit transaction" : "New transaction"} onSubmit={submit}>
      {!entry && (
        <div role="tablist" aria-label="Transaction type" className="items-toolbar">
          {(["expense", "income", "transfer"] as const).map((type) => (
            <button
              key={type}
              type="button"
              role="tab"
              className="items-toolbar-button"
              aria-selected={mode === type}
              onClick={() => setMode(type)}
            >
              {type[0].toUpperCase() + type.slice(1)}
            </button>
          ))}
        </div>
      )}
      <label className="field-label">
        Date
        <input
          type="date"
          required
          value={draft.date}
          onChange={(event) => field("date", event.target.value)}
        />
      </label>
      {entry && (
        <label className="field-label">
          Written at
          <input
            type="datetime-local"
            required
            value={draft.writtenAt}
            onChange={(event) => field("writtenAt", event.target.value)}
          />
        </label>
      )}
      {!entry && (
        <label className="field-label">
          Content
          <input
            required
            value={draft.content}
            onChange={(event) => field("content", event.target.value)}
          />
        </label>
      )}
      {mode !== "transfer" ? (
        <>
          {entry && (
            <label className="field-label">
              Type
              <select
                value={draft.entryType}
                onChange={(event) =>
                  field("entryType", event.target.value as PublicLedgerEntryType)}
              >
                <option value="expense">Expense</option>
                <option value="income">Income</option>
                <option value="adjustment_out">Adjustment out</option>
                <option value="adjustment_in">Adjustment in</option>
              </select>
            </label>
          )}
          <label className="field-label">
            Account
            <select
              required
              value={draft.account}
              onChange={(event) => field("account", event.target.value)}
            >
              <option value="">Select account</option>
              {activeAccounts.map((account) => (
                <option key={account.id} value={account.id}>{account.name}</option>
              ))}
            </select>
          </label>
          <label className="field-label">
            Category
            <select
              value={draft.category}
              onChange={(event) => field("category", event.target.value)}
            >
              <option value="">No category</option>
              {activeCategories.map((category) => (
                <option key={category.id} value={category.id}>{category.name}</option>
              ))}
            </select>
          </label>
        </>
      ) : (
        <>
          <label className="field-label">
            From account
            <select
              required
              value={draft.fromAccount}
              onChange={(event) => field("fromAccount", event.target.value)}
            >
              <option value="">Select account</option>
              {activeAccounts.map((account) => (
                <option key={account.id} value={account.id}>{account.name}</option>
              ))}
            </select>
          </label>
          <label className="field-label">
            To account
            <select
              required
              value={draft.toAccount}
              onChange={(event) => field("toAccount", event.target.value)}
            >
              <option value="">Select account</option>
              {activeAccounts
                .filter((account) => account.id !== draft.fromAccount)
                .map((account) => (
                  <option key={account.id} value={account.id}>{account.name}</option>
                ))}
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
      {entry && (
        <label className="field-label">
          Currency
          <select
            required
            value={draft.currency}
            onChange={(event) => field("currency", event.target.value)}
          >
            <option value="">Select currency</option>
            {activeCurrencies.map((currency) => (
              <option key={currency.id} value={currency.id}>
                {currency.code} — {currency.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {entry && (
        <label className="field-label">
          Content
          <input
            required
            value={draft.content}
            onChange={(event) => field("content", event.target.value)}
          />
        </label>
      )}
      <label className="field-label">
        Notes
        <textarea
          value={draft.notes}
          onChange={(event) => field("notes", event.target.value)}
        />
      </label>
      {error && <p role="alert" className="items-message">{error}</p>}
      <button type="submit" className="items-toolbar-button" disabled={pending}>
        {pending
          ? "Saving…"
          : mode === "transfer"
            ? "Save transfer"
            : "Save transaction"}
      </button>
    </form>
  );
}

function transactionDraft(entry: LedgerEntryView | null, currencies: Currency[]) {
  const now = new Date().toISOString();
  const currency = currencies.find((item) => item.id === entry?.entry.currencyId);
  return {
    date: entry?.entry.date ?? now.slice(0, 10),
    writtenAt: localDateTime(entry?.entry.writtenAt ?? now),
    entryType: (entry?.entry.entryType === "transfer_in" ||
      entry?.entry.entryType === "transfer_out"
      ? "expense"
      : entry?.entry.entryType ?? "expense") as PublicLedgerEntryType,
    account: entry?.entry.accountId ?? "",
    category: entry?.entry.transactionCategoryId ?? "",
    fromAccount: "",
    toAccount: "",
    amount: entry
      ? formatMinorUnits(entry.entry.amountMinor, currency?.decimalPlaces ?? 0)
      : "",
    currency: entry?.entry.currencyId ?? "",
    content: entry?.entry.content ?? "",
    notes: entry?.entry.notes ?? "",
  };
}

function categoryKind(type: PublicLedgerEntryType): "expense" | "income" {
  return type === "income" || type === "adjustment_in" ? "income" : "expense";
}
