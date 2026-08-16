"use client";

import React, { useRef, useState } from "react";

import type { LedgerController } from "@/features/ledger/hooks/useLedgerController";
import type { Account, Currency } from "@/features/ledger/model/ledger-model";
import {
  formatMinorUnits,
  formatMoney,
  useLifecycleAction,
} from "@/features/ledger/ui/ledger-ui";
import { AccountSettingsDialog } from "@/features/ledger/ui/AccountSettingsDialog";
import { DestructiveConfirmationDialog } from "@/features/workbench/ui/DestructiveConfirmationDialog";
import { LedgerTableViewHeader } from "@/features/ledger/ui/LedgerTableViewHeader";

export function AccountsPanel({ controller }: { controller: LedgerController }) {
  const [editing, setEditing] = useState<Account | null>(null);
  const [draft, setDraft] = useState(accountDraft(null, controller.state.currencies));
  const [error, setError] = useState<string | null>(null);
  const [purgeTarget, setPurgeTarget] = useState<Account | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const actions = useLifecycleAction();
  const sectionRef = useRef<HTMLElement>(null);
  const settingsButtonRef = useRef<HTMLButtonElement | null>(null);

  function edit(account: Account | null) {
    setEditing(account);
    setDraft(accountDraft(account, controller.state.currencies));
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
    await actions.run(`purge:${account.id}`, async () => {
      const preview = await controller.previewAccountPurge(account.id);
      await controller.purgeAccount(account.id, preview.confirmationId);
    });
    setPurgeTarget(null);
  }

  const categories = new Map(
    controller.state.accountCategories.map((category) => [category.id, category.name]),
  );
  const currencies = new Map(
    controller.state.currencies.map((currency) => [currency.id, currency]),
  );
  const balances = new Map(
    controller.state.balances.map((balance) => {
      const currency = currencies.get(balance.account.currencyId);
      return [
        balance.account.id,
        formatMoney(balance.currentBalanceMinor, currency, balance.currencyCode),
      ];
    }),
  );

  return (
    <section
      ref={sectionRef}
      aria-labelledby="ledger-accounts-heading"
      tabIndex={-1}
    >
      <LedgerTableViewHeader
        controller={controller}
        scope="ledger.accounts"
        title="Accounts"
        headingId="ledger-accounts-heading"
        onSettings={() => setSettingsOpen(true)}
        settingsButtonRef={settingsButtonRef}
        settingsLabel="Account settings"
      />
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
      {actions.error && <p role="alert" className="items-message">{actions.error}</p>}
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
                  <td>
                    {formatMoney(
                      account.openingBalanceMinor,
                      currencies.get(account.currencyId),
                    )}
                  </td>
                  <td>{balances.get(account.id) ?? "—"}</td>
                  <td>{account.active ? "Active" : "Archived"}</td>
                  <td>
                    <button type="button" onClick={() => edit(account)}>
                      Edit {account.name}
                    </button>
                    {account.active ? (
                      <button
                        type="button"
                        disabled={actions.isPending(`archive:${account.id}`)}
                        onClick={() => {
                          if (window.confirm(`Archive ${account.name}?`)) {
                            void actions.run(
                              `archive:${account.id}`,
                              () => controller.archiveAccount(account.id),
                            );
                          }
                        }}
                      >
                        Archive {account.name}
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={actions.isPending(`restore:${account.id}`)}
                        onClick={() => {
                          if (window.confirm(`Restore ${account.name}?`)) {
                            void actions.run(
                              `restore:${account.id}`,
                              () => controller.restoreAccount(account.id),
                            );
                          }
                        }}
                      >
                        Restore {account.name}
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={actions.isPending(`purge:${account.id}`)}
                      onClick={() => setPurgeTarget(account)}
                    >
                      Purge {account.name}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {purgeTarget ? (
        <DestructiveConfirmationDialog
          title={`Permanently purge ${purgeTarget.name}?`}
          description="This account will be permanently removed. This cannot be undone."
          fallbackFocusRef={sectionRef}
          onCancel={() => setPurgeTarget(null)}
          onConfirm={() => purge(purgeTarget)}
        />
      ) : null}
      {settingsOpen ? (
        <AccountSettingsDialog
          controller={controller}
          onClose={() => setSettingsOpen(false)}
          returnFocusRef={settingsButtonRef}
        />
      ) : null}
    </section>
  );
}

function accountDraft(account: Account | null, currencies: Currency[]) {
  const currency = currencies.find((item) => item.id === account?.currencyId);
  return {
    name: account?.name ?? "",
    category: account?.categoryId ?? "",
    currency: account?.currencyId ?? "",
    openingBalance: account
      ? formatMinorUnits(account.openingBalanceMinor, currency?.decimalPlaces ?? 0)
      : "0",
  };
}
