"use client";

import React, { useRef, useState } from "react";
import { healthApi } from "@/features/health/api/health-api";
import type { HealthRecord } from "@/features/health/model/health-model";
import { RavenApiError } from "@/lib/raven-api";

export function HealthRecordsInspector({ onChanged }: { onChanged: () => Promise<unknown> }) {
  const [records, setRecords] = useState<HealthRecord[]>([]);
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<HealthRecord | null>(null);
  const [audit, setAudit] = useState<Record<string, unknown>[]>([]);
  const [auditOffset, setAuditOffset] = useState(0);
  const [auditMore, setAuditMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);

  async function run(operation: () => Promise<void>) {
    if (busy.current) return;
    busy.current = true; setPending(true); setError(null);
    try { await operation(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Health request failed"); }
    finally { busy.current = false; setPending(false); }
  }
  async function load(next = 0) {
    const items = await healthApi.records({ offset: next, limit: 50 });
    setRecords(items); setOffset(next); setSelected(null); setAudit([]);
  }
  async function history(item: HealthRecord, next = 0) {
    const items = await healthApi.audit(item.kind === "diet" ? "diet_entry" : "health_event", item.record.id, { offset: next, limit: 50 });
    setAudit((previous) => next === 0 ? items : [...previous, ...items]);
    setAuditOffset(next); setAuditMore(items.length === 50);
  }
  async function transition(item: HealthRecord) {
    const action = item.record.deletedAt ? "restore" : "archive";
    if (!window.confirm(`${action === "restore" ? "Restore" : "Archive"} this record?`)) return;
    try {
      if (item.kind === "diet") {
        await healthApi[action === "restore" ? "restoreDiet" : "archiveDiet"](item.record.id, item.record.updatedAt);
      } else {
        await healthApi[action === "restore" ? "restoreEvent" : "archiveEvent"](item.record.id, item.record.updatedAt);
      }
    } catch (cause) {
      if (cause instanceof RavenApiError && cause.committed === true) {
        await load(offset); await onChanged();
        throw new Error("Saved; media cleanup pending.");
      }
      throw cause;
    }
    await load(offset); await onChanged();
  }
  return <details className="health-records-inspector" onToggle={(event) => {
    if (event.currentTarget.open) void run(() => load());
  }}>
    <summary>Records, archive & history</summary>
    <p>Inspect all stored records, including older custom metrics. Archived records can be restored; custom metrics remain here for reconciliation.</p>
    {error ? <p role="alert">{error}</p> : null}
    <button type="button" disabled={pending} onClick={() => void run(() => load(offset))}>Refresh records</button>
    <ul>{records.map((item) => <li key={`${item.kind}:${item.record.id}`}>
      <button type="button" disabled={pending} onClick={() => void run(async () => { setSelected(item); await history(item); })}>
        {item.kind === "diet" ? item.record.foodName : item.record.name} · {item.record.occurredAt} · {item.record.deletedAt ? "Archived" : "Active"}
      </button>
    </li>)}</ul>
    <button type="button" disabled={pending || offset === 0} onClick={() => void run(() => load(Math.max(0, offset - 50)))}>Previous records</button>
    <button type="button" disabled={pending || records.length < 50} onClick={() => void run(() => load(offset + 50))}>Next records</button>
    {selected ? <section aria-label="Record inspection">
      <h3>Record details</h3>
      <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify(selected.record, null, 2)}</pre>
      {selected.kind === "diet" && selected.record.mediaId ? <img src={healthApi.photoUrl(selected.record.id)} alt="Saved meal" style={{ maxWidth: "100%", maxHeight: 280 }} /> : null}
      <button type="button" disabled={pending} onClick={() => void run(() => transition(selected))}>{selected.record.deletedAt ? "Restore record" : "Archive record"}</button>
      <h3>Audit history</h3>
      <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify(audit, null, 2)}</pre>
      {auditMore ? <button type="button" disabled={pending} onClick={() => void run(() => history(selected, auditOffset + 50))}>More history</button> : null}
    </section> : null}
  </details>;
}
