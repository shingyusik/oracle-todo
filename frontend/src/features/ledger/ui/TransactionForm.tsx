"use client";

import React, { useState } from "react";

import type { LedgerController } from "@/features/ledger/hooks/useLedgerController";
import type {
  LedgerEntryInput,
  LedgerEntryView,
  PublicLedgerEntryType,
  TransferInput,
} from "@/features/ledger/model/ledger-model";

type TransactionFormProps = {
  controller: LedgerController;
  entry?: LedgerEntryView | null;
  onSaved?: () => void;
};

type FormMode = "entry" | "transfer";

export function TransactionForm({
  controller,
  entry = null,
  onSaved,
}: TransactionFormProps) {
  const initial = transactionDraft(entry);
  const [mode, setMode] = useState<FormMode>("entry");
  const [draft, setDraft] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function field(name: keyof typeof draft, value: string) {
    setDraft((current) => ({ ...current, [name]: value }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      if (mode === "transfer") {
        const input: TransferInput = {
          date: draft.date,
          writtenAt: timestamp(draft.writtenAt),
          content: draft.content,
          fromAccount: draft.fromAccount,
          toAccount: draft.toAccount,
          amount: draft.amount,
          currency: draft.currency,
          source: "ui",
          notes: draft.notes || null,
        };
        await controller.transfer(input);
      } else {
        const input: LedgerEntryInput = {
          date: draft.date,
          writtenAt: timestamp(draft.writtenAt),
          content: draft.content,
          category: draft.category || null,
          account: draft.account,
          entryType: draft.entryType,
          amount: draft.amount,
          currency: draft.currency,
          source: "ui",
          notes: draft.notes || null,
        };
        if (entry) await controller.updateEntry(entry.entry.id, input);
        else await controller.createEntry(input);
      }
      setDraft(transactionDraft(null));
      onSaved?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save transaction");
    } finally {
      setPending(false);
    }
  }

  const activeAccounts = controller.state.accounts.filter((account) => account.active);
  const activeCurrencies = controller.state.currencies.filter((currency) => currency.active);
  const activeCategories = controller.state.categories.filter(
    (category) => category.active && category.kind === categoryKind(draft.entryType),
  );

  return (
    <form aria-label={entry ? "Edit transaction" : "New transaction"} onSubmit={submit}>
      {!entry && (
        <div role="group" aria-label="Transaction mode" className="items-toolbar">
          <button
            type="button"
            className="items-toolbar-button"
            aria-pressed={mode === "entry"}
            onClick={() => setMode("entry")}
          >
            Entry
          </button>
          <button
            type="button"
            className="items-toolbar-button"
            aria-pressed={mode === "transfer"}
            onClick={() => setMode("transfer")}
          >
            Transfer
          </button>
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
      <label className="field-label">
        Written at
        <input
          type="datetime-local"
          required
          value={draft.writtenAt}
          onChange={(event) => field("writtenAt", event.target.value)}
        />
      </label>
      {mode === "entry" ? (
        <>
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
              {activeAccounts.map((account) => (
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
      <label className="field-label">
        Content
        <input
          required
          value={draft.content}
          onChange={(event) => field("content", event.target.value)}
        />
      </label>
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

function transactionDraft(entry: LedgerEntryView | null) {
  const now = new Date().toISOString();
  return {
    date: entry?.entry.date ?? now.slice(0, 10),
    writtenAt: entry?.entry.writtenAt.slice(0, 16) ?? now.slice(0, 16),
    entryType: (entry?.entry.entryType === "transfer_in" ||
      entry?.entry.entryType === "transfer_out"
      ? "expense"
      : entry?.entry.entryType ?? "expense") as PublicLedgerEntryType,
    account: entry?.entry.accountId ?? "",
    category: entry?.entry.transactionCategoryId ?? "",
    fromAccount: "",
    toAccount: "",
    amount: entry ? String(entry.entry.amountMinor) : "",
    currency: entry?.entry.currencyId ?? "",
    content: entry?.entry.content ?? "",
    notes: entry?.entry.notes ?? "",
  };
}

function categoryKind(type: PublicLedgerEntryType): "expense" | "income" {
  return type === "income" || type === "adjustment_in" ? "income" : "expense";
}

function timestamp(value: string): string {
  return value.length === 16 ? `${value}:00Z` : value;
}
