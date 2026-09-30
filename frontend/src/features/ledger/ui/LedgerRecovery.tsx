"use client";

import React, { useState } from "react";
import type { LedgerController } from "@/features/ledger/hooks/useLedgerController";
import { ledgerApi } from "@/features/ledger/api/ledger-api";
import { LedgerHistory } from "./LedgerHistory";

type Kind = "entries" | "accounts" | "categories" | "currencies" | "account-types";
type RecoveryRecord = { id: string; label: string; recordType: string; historyId: string };

export function LedgerRecovery({ controller, kind }: { controller: LedgerController; kind: Kind }) {
  const [items, setItems] = useState<RecoveryRecord[]>([]);
  const [next, setNext] = useState<number | null>(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function load() {
    if (pending || next === null) return;
    setPending(true); setError(null);
    try {
      const query = { offset: next, limit: 100, includeInactive: true };
      let records: RecoveryRecord[];
      let nextOffset: number | null;
      if (kind === "entries") {
        const page = await ledgerApi.listEntries({ ...query, includeArchived: true });
        records = page.items.filter(({ entry }) => entry.deletedAt !== null).map(({ entry }) => ({
          id: entry.id, label: `${entry.date} · ${entry.content} · ${entry.entryType.replaceAll("_", " ")}`, recordType: entry.transferGroupId ? "transfer" : "ledger_entry", historyId: entry.transferGroupId ?? entry.id,
        })); nextOffset = page.nextOffset;
      } else {
        const page = kind === "accounts" ? await ledgerApi.listAccounts(query)
          : kind === "categories" ? await ledgerApi.listTransactionCategories(query)
          : kind === "currencies" ? await ledgerApi.listCurrencies(query)
          : await ledgerApi.listAccountCategories(query);
        records = page.items.filter(({ active }) => !active).map((item) => ({ id: item.id, label: item.name, historyId: item.id,
          recordType: kind === "accounts" ? "account" : kind === "categories" ? "transaction_category" : kind === "currencies" ? "currency" : "account_category" }));
        nextOffset = page.nextOffset;
      }
      setItems((current) => [...current, ...records]); setNext(nextOffset);
    } catch { setError("Could not load archived or inactive records."); }
    finally { setPending(false); }
  }
  async function restore(id: string) {
    if (pending) return;
    setPending(true); setError(null);
    try {
      if (kind === "entries") await controller.restore(id);
      else if (kind === "accounts") await controller.restoreAccount(id);
      else if (kind === "categories") await controller.restoreCategory(id);
      else if (kind === "currencies") await controller.updateCurrency(id, { active: true });
      else await controller.updateAccountCategory(id, { active: true });
      setItems([]); setNext(0);
    } catch { setError("Could not restore record."); }
    finally { setPending(false); }
  }
  return <details><summary onClick={() => { if (next === 0) void load(); }}>{kind === "entries" ? "Archived transactions" : `Inactive ${kind}`}</summary>
    {items.map((item) => <article key={item.id}><p>{item.label} <code>{item.id}</code></p>
      <button type="button" disabled={pending} onClick={() => void restore(item.id)}>Restore</button>
      <LedgerHistory recordType={item.recordType} recordId={item.historyId} />
    </article>)}
    {error ? <p role="alert">{error}</p> : null}
    {next !== null ? <button type="button" disabled={pending} onClick={() => void load()}>{pending ? "Loading…" : kind === "entries" ? "Load archived transactions" : `Load inactive ${kind}`}</button> : null}
  </details>;
}
