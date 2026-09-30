"use client";

import React, { useState } from "react";
import { apiPath, requestJson, record, array } from "@/lib/raven-api";

export function LedgerHistory({ recordType, recordId }: { recordType: string; recordId: string }) {
  const [events, setEvents] = useState<Record<string, unknown>[]>([]);
  const [next, setNext] = useState<number | null>(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function load() {
    if (pending || next === null) return;
    setPending(true); setError(null);
    try {
      const page = record(await requestJson(apiPath(`/api/v1/ledger/audit/${encodeURIComponent(recordType)}/${encodeURIComponent(recordId)}`, { offset: next, limit: 50 })), "audit page");
      setEvents((current) => [...current, ...array(page.items, "audit items").map((item) => record(item, "audit event"))]);
      setNext(typeof page.next_offset === "number" ? page.next_offset : null);
    } catch { setError("Could not load history."); }
    finally { setPending(false); }
  }
  return <details><summary onClick={() => { if (next === 0) void load(); }}>History</summary>
    {events.map((event, index) => <article key={String(event.id ?? index)}>
      <p>{String(event.occurred_at)} · {String(event.action)} · {String(event.actor)}</p>
      {event.reason ? <p>{String(event.reason)}</p> : null}
      <pre>{JSON.stringify({ before: event.before, after: event.after }, null, 2)}</pre>
    </article>)}
    {error ? <p role="alert">{error}</p> : null}
    {next !== null ? <button type="button" disabled={pending} onClick={() => void load()}>{pending ? "Loading…" : "Load history"}</button> : null}
  </details>;
}
