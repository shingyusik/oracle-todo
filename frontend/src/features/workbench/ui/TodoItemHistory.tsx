import * as React from "react";
import { array, nonEmptyString, nullableString, record, requestJson, safeInteger, timestamp } from "@/lib/raven-api";

type HistoryEvent = { id: string; at: string; action: string; actor: string; reason: string | null; before: unknown; after: unknown };

export function TodoItemHistory({ itemId, version }: { itemId: string; version?: string | null }) {
  const [open, setOpen] = React.useState(false);
  const [events, setEvents] = React.useState<HistoryEvent[]>([]);
  const [next, setNext] = React.useState<number | null>(0);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState(false);
  const generation = React.useRef(0);
  const busy = React.useRef(false);
  React.useEffect(() => {
    generation.current += 1; busy.current = false;
    setOpen(false); setEvents([]); setNext(0); setPending(false); setError(false);
  }, [itemId, version]);
  async function load(offset: number) {
    if (busy.current) return;
    busy.current = true;
    const current = generation.current;
    setPending(true); setError(false);
    try {
      const page = await requestJson(`/api/v1/todo/items/${encodeURIComponent(itemId)}/history?offset=${offset}&limit=50`, undefined, decodeHistoryPage);
      if (current !== generation.current) return;
      setEvents((previous) => offset === 0 ? page.items : [...previous, ...page.items]);
      setNext(page.next);
    } catch {
      if (current === generation.current) setError(true);
    } finally {
      if (current === generation.current) { busy.current = false; setPending(false); }
    }
  }
  return <section aria-label="Item history">
    <button type="button" aria-expanded={open} onClick={() => {
      setOpen(!open);
      if (!open && events.length === 0) void load(0);
    }}>History</button>
    {open ? <>
      {error ? <p role="alert">History could not be loaded.</p> : null}
      {events.map((event) => <article key={event.id}>
        <p><time dateTime={event.at}>{event.at}</time> · {event.action} · {event.actor}</p>
        {event.reason ? <p>{event.reason}</p> : null}
        <details><summary>Record changes</summary>
          <table><thead><tr><th>Property</th><th>Before</th><th>After</th></tr></thead>
            <tbody>{historyChanges(event).map(({ field, before, after }) => <tr key={field}>
              <th>{field.replaceAll("_", " ")}</th><td style={{ whiteSpace: "pre-wrap" }}>{before}</td><td style={{ whiteSpace: "pre-wrap" }}>{after}</td>
            </tr>)}</tbody>
          </table>
        </details>
      </article>)}
      {!pending && !error && events.length === 0 ? <p>No history.</p> : null}
      {next !== null ? <button type="button" disabled={pending} onClick={() => void load(next)}>{pending ? "Loading history…" : error ? "Retry history" : "Load more history"}</button> : null}
    </> : null}
  </section>;
}

function decodeHistoryPage(value: unknown): { items: HistoryEvent[]; next: number | null } {
  const page = record(value, "todo history");
  const items = array(page.items, "todo history.items").map((entry) => {
    const event = record(entry, "todo history.event");
    return {
      id: nonEmptyString(event.id, "todo history.id"), at: timestamp(event.at, "todo history.at"),
      action: nonEmptyString(event.action, "todo history.action"), actor: nonEmptyString(event.actor, "todo history.actor"),
      reason: nullableString(event.reason, "todo history.reason"),
      before: event.before === null ? null : record(event.before, "todo history.before"),
      after: event.after === null ? null : record(event.after, "todo history.after"),
    };
  });
  const next = page.next === null ? null : safeInteger(page.next, "todo history.next");
  if (items.length > 50 || next !== null && next < 0) throw new TypeError("Invalid todo history page");
  return { items, next };
}

function historyChanges(event: HistoryEvent): { field: string; before: string; after: string }[] {
  const before = event.before === null ? {} : event.before as Record<string, unknown>;
  const after = event.after === null ? {} : event.after as Record<string, unknown>;
  const display = (value: unknown): string => value === null || value === undefined ? "—" : typeof value === "string" ? value : JSON.stringify(value);
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((field) => JSON.stringify(before[field]) !== JSON.stringify(after[field])).map((field) => ({ field, before: display(before[field]), after: display(after[field]) }));
}
