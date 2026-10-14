"use client";

import { useEffect, useRef } from "react";

type DataDomain = "todo" | "ledger" | "health";
const listeners = new Set<(domains: DataDomain[]) => void>();
let source: EventSource | null = null;

function subscribe(listener: (domains: DataDomain[]) => void): () => void {
  if (typeof EventSource === "undefined") return () => {};
  listeners.add(listener);
  if (!source) {
    source = new EventSource("/api/v1/changes");
    source.addEventListener("changes", (event) => {
      let value: unknown;
      try {
        value = JSON.parse((event as MessageEvent<string>).data);
      } catch {
        return;
      }
      if (!value || typeof value !== "object" || !("domains" in value)
        || !Array.isArray(value.domains)) return;
      const domains = value.domains.filter((domain): domain is DataDomain =>
        domain === "todo" || domain === "ledger" || domain === "health");
      for (const notify of listeners) notify(domains);
    });
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      source?.close();
      source = null;
    }
  };
}

export function useDataChanges(domain: DataDomain, onChange: () => unknown): void {
  const callback = useRef(onChange);
  callback.current = onChange;
  useEffect(() => {
    let active = true;
    let running = false;
    let pending = false;
    const unsubscribe = subscribe((domains) => {
      if (!domains.includes(domain)) return;
      pending = true;
      if (running) return;
      running = true;
      void (async () => {
        try {
          while (active && pending) {
            pending = false;
            try {
              await callback.current();
            } catch {
              // Controllers retain data and expose their own refresh errors.
            }
          }
        } finally {
          running = false;
        }
      })();
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [domain]);
}
