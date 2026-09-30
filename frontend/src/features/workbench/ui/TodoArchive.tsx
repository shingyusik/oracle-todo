import React from "react";
import { mapWorkspaceItem } from "@/features/workbench/api/table-api";
import type { WorkspaceItemModel } from "@/features/workbench/model/workbench-model";
import { apiPath, array, record, requestJson, safeInteger } from "@/lib/raven-api";

export function TodoArchive({ onOpen }: { onOpen: (item: WorkspaceItemModel) => void }) {
  const [open, setOpen] = React.useState(false);
  const [items, setItems] = React.useState<WorkspaceItemModel[]>([]);
  const [status, setStatus] = React.useState("Loading archive...");
  const [next, setNext] = React.useState<number | null>(0);
  const [pending, setPending] = React.useState(false);
  const generation = React.useRef(0);
  const busy = React.useRef(false);
  async function load(offset: number, current = generation.current) {
    if (busy.current) return;
    busy.current = true; setPending(true);
    try {
      const page = record(await requestJson(apiPath("/api/v1/todo/items/archive", { offset, limit: 50 })), "todo archive");
      const records = array(page.items, "todo archive.items").map(mapWorkspaceItem);
      const nextOffset = page.next === null ? null : safeInteger(page.next, "todo archive.next");
      if (current !== generation.current) return;
      setItems((previous) => offset === 0 ? records : [...previous, ...records]);
      setNext(nextOffset); setStatus(offset === 0 && records.length === 0 ? "Archive is empty." : "");
    } catch {
      if (current === generation.current) setStatus("Could not load archive. Retry to continue.");
    } finally {
      if (current === generation.current) { busy.current = false; setPending(false); }
    }
  }
  React.useEffect(() => {
    generation.current += 1;
    busy.current = false;
    if (!open) return;
    setItems([]); setNext(0); setStatus("Loading archive...");
    void load(0);
    return () => { generation.current += 1; };
  }, [open]);
  return <section aria-label="ToDo archive">
    <button type="button" className="items-toolbar-button" aria-expanded={open}
      onClick={() => setOpen((value) => !value)}>Browse archive</button>
    {open && <div>
      <p>Archived items are read-only.</p>
      {status && <p role="status">{status}</p>}
      <ul>{items.map((item) => <li key={item.id}>
        <button type="button" onClick={() => onOpen(item)}>{item.title}</button> ({item.type})
      </li>)}</ul>
      {next !== null && <button type="button" disabled={pending} onClick={() => void load(next)}>
        {pending ? "Loading archive..." : "Load more archive"}
      </button>}
    </div>}
  </section>;
}
