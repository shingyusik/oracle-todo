"use client";

import React, { useState } from "react";
import type { LedgerController } from "@/features/ledger/hooks/useLedgerController";
import { ledgerApi } from "@/features/ledger/api/ledger-api";
import { LedgerHistory } from "./LedgerHistory";

type Kind = "currencies" | "account-types";
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
      const page = kind === "currencies"
        ? await ledgerApi.listCurrencies(query)
        : await ledgerApi.listAccountCategories(query);
      const records: RecoveryRecord[] = page.items.filter(({ active }) => !active).map((item) => ({
        id: item.id, label: item.name, historyId: item.id,
        recordType: kind === "currencies" ? "currency" : "account_category",
      }));
      const nextOffset = page.nextOffset;
      setItems((current) => [...current, ...records]); setNext(nextOffset);
    } catch { setError("Could not load inactive records."); }
    finally { setPending(false); }
  }
  async function restore(id: string) {
    if (pending) return;
    setPending(true); setError(null);
    try {
      if (kind === "currencies") await controller.updateCurrency(id, { active: true });
      else await controller.updateAccountCategory(id, { active: true });
      setItems([]); setNext(0);
    } catch { setError("Could not restore record."); }
    finally { setPending(false); }
  }
  return <details><summary onClick={() => { if (next === 0) void load(); }}>{`Inactive ${kind}`}</summary>
    {items.map((item) => <article key={item.id}><p>{item.label} <code>{item.id}</code></p>
      <button type="button" disabled={pending} onClick={() => void restore(item.id)}>Restore</button>
      <LedgerHistory recordType={item.recordType} recordId={item.historyId} />
    </article>)}
    {error ? <p role="alert">{error}</p> : null}
    {next !== null ? <button type="button" disabled={pending} onClick={() => void load()}>{pending ? "Loading…" : `Load inactive ${kind}`}</button> : null}
  </details>;
}
