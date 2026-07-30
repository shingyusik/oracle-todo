"use client";

import React, { useState } from "react";

import type { LedgerController } from "@/features/ledger/hooks/useLedgerController";
import type { Account } from "@/features/ledger/model/ledger-model";

export function AccountsPanel({ controller }: { controller: LedgerController }) {
  const [editing, setEditing] = useState<Account | null>(null);
  const [draft, setDraft] = useState(accountDraft(null));
  const [error, setError] = useState<string | null>(null);

  function edit(account: Account | null) {
    setEditing(account);
    setDraft(accountDraft(account));
    setError(null);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      if (editing) await controller.updateAccount(editing.id, draft);
      else await controller.createAccount(draft);
      edit(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save account");
    }
  }

  async function purge(account: Account) {
    if (!window.confirm(`Permanently purge ${account.name}?`)) return;
    const preview = await controller.previewAccountPurge(account.id);
    await controller.purgeAccount(account.id, preview.confirmationId);
  }

  const categories = new Map(
    controller.state.accountCategories.map((category) => [category.id, category.name]),
  );
  const currencies = new Map(
    controller.state.currencies.map((currency) => [currency.id, currency]),
  );
  const balances = new Map(
    controller.state.balances.map((balance) => [
      balance.account.id,
      `${balance.currentBalanceMinor} ${balance.currencyCode}`,
    ]),
  );

  return (
    <section aria-labelledby="ledger-accounts-heading">
      <header className="workspace-table-header">
        <h1 id="ledger-accounts-heading">Accounts</h1>
      </header>
      <form aria-label={editing ? "Edit account" : "New account"} onSubmit={save}>
        <label className="field-label">
          Account name
          <input
            required
            value={draft.name}
            onChange={(event) =>
              setDraft((current) => ({ ...current, name: event.target.value }))}
          />
        </label>
        <label className="field-label">
          Account category
          <select
            required
            value={draft.category}
            onChange={(event) =>
              setDraft((current) => ({ ...current, category: event.target.value }))}
          >
            <option value="">Select category</option>
            {controller.state.accountCategories.filter((item) => item.active).map((item) => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select>
        </label>
        <label className="field-label">
          Account currency
          <select
            required
            value={draft.currency}
            onChange={(event) =>
              setDraft((current) => ({ ...current, currency: event.target.value }))}
          >
            <option value="">Select currency</option>
            {controller.state.currencies.filter((item) => item.active).map((item) => (
              <option key={item.id} value={item.id}>{item.code} — {item.name}</option>
            ))}
          </select>
        </label>
        <label className="field-label">
          Opening balance
          <input
            required
            inputMode="decimal"
            value={draft.openingBalance}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                openingBalance: event.target.value,
              }))}
          />
        </label>
        {error && <p role="alert" className="items-message">{error}</p>}
        <button type="submit">{editing ? "Update account" : "Add account"}</button>
        {editing && <button type="button" onClick={() => edit(null)}>Cancel edit</button>}
      </form>
      {controller.state.accounts.length === 0 ? (
        <p className="items-message">No accounts yet.</p>
      ) : (
        <div className="items-section">
          <table className="items-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Category</th>
                <th>Currency</th>
                <th>Opening balance</th>
                <th>Current balance</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {controller.state.accounts.map((account) => (
                <tr key={account.id}>
                  <td>{account.name}</td>
                  <td>{categories.get(account.categoryId) ?? "—"}</td>
                  <td>
                    {currencies.get(account.currencyId)?.name ?? "—"}
                  </td>
                  <td>{account.openingBalanceMinor}</td>
                  <td>{balances.get(account.id) ?? "—"}</td>
                  <td>{account.active ? "Active" : "Archived"}</td>
                  <td>
                    <button type="button" onClick={() => edit(account)}>
                      Edit {account.name}
                    </button>
                    {account.active ? (
                      <button
                        type="button"
                        onClick={() => {
                          if (window.confirm(`Archive ${account.name}?`)) {
                            void controller.archiveAccount(account.id);
                          }
                        }}
                      >
                        Archive {account.name}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          if (window.confirm(`Restore ${account.name}?`)) {
                            void controller.restoreAccount(account.id);
                          }
                        }}
                      >
                        Restore {account.name}
                      </button>
                    )}
                    <button type="button" onClick={() => void purge(account)}>
                      Purge {account.name}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function accountDraft(account: Account | null) {
  return {
    name: account?.name ?? "",
    category: account?.categoryId ?? "",
    currency: account?.currencyId ?? "",
    openingBalance: account ? String(account.openingBalanceMinor) : "0",
  };
}
