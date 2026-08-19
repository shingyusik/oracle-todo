"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type BrowserDetailHistory = {
  pendingBack: boolean;
  setDirty(dirty: boolean): void;
  setDialogOpen(open: boolean): void;
  deferUntilRestored(action: () => void): boolean;
  requestBack(): void;
  cancelBack(): void;
  discardBack(): void;
};

export function useBrowserDetailHistory<T>({
  stateKey,
  currentId,
  resolve,
  open,
  close,
  clearOnUnmount = false,
}: {
  stateKey: string;
  currentId: string | null;
  resolve(id: string): T | null;
  open(value: T): void;
  close(): void;
  clearOnUnmount?: boolean;
}): BrowserDetailHistory {
  const callbacks = useRef({ resolve, open, close });
  callbacks.current = { resolve, open, close };
  const currentIdRef = useRef(currentId);
  const dirtyRef = useRef(false);
  const applyingHistoryRef = useRef(false);
  const restoringCurrentEntryRef = useRef(false);
  const consumeRestorationRef = useRef(false);
  const deferredRestorationActionRef = useRef<(() => void) | null>(null);
  const pendingBackRef = useRef(false);
  const dialogOpenRef = useRef(false);
  const discardAfterRestoreRef = useRef(false);
  const historyIndexRef = useRef(0);
  const pendingTraversalRef = useRef<-1 | 1 | null>(null);
  const [pendingBack, setPendingBack] = useState(false);

  useEffect(() => {
    const indexKey = historyIndexKey(stateKey);
    historyIndexRef.current = indexFromHistoryState(window.history.state, indexKey) ?? 0;
    window.history.replaceState(withHistoryState(
      window.history.state, stateKey, currentIdRef.current, indexKey, historyIndexRef.current,
    ), "");

    function restoreCurrentEntry(requestedIndex: number | null) {
      const traversal: -1 | 1 = requestedIndex !== null && requestedIndex > historyIndexRef.current ? 1 : -1;
      pendingTraversalRef.current ??= traversal;
      restoringCurrentEntryRef.current = true;
      traverseHistory(traversal === 1 ? -1 : 1);
    }

    function finishDiscard() {
      const traversal = pendingTraversalRef.current ?? -1;
      pendingTraversalRef.current = null;
      pendingBackRef.current = false;
      setPendingBack(false);
      dirtyRef.current = false;
      traverseHistory(traversal);
    }

    function handlePopState(event: PopStateEvent) {
      const activeId = currentIdRef.current;
      const requestedId = idFromHistoryState(event.state, stateKey);
      const requestedIndex = indexFromHistoryState(event.state, indexKey);
      if (restoringCurrentEntryRef.current && requestedId === activeId) {
        restoringCurrentEntryRef.current = false;
        historyIndexRef.current = requestedIndex ?? historyIndexRef.current;
        const consume = consumeRestorationRef.current;
        consumeRestorationRef.current = false;
        const deferred = deferredRestorationActionRef.current;
        deferredRestorationActionRef.current = null;
        if (deferred) {
          discardAfterRestoreRef.current = false;
          pendingTraversalRef.current = null;
          deferred();
        } else if (discardAfterRestoreRef.current) {
          discardAfterRestoreRef.current = false;
          finishDiscard();
        } else if (!consume && !dialogOpenRef.current && !pendingBackRef.current) {
          pendingBackRef.current = true;
          setPendingBack(true);
        }
        return;
      }
      if (pendingBackRef.current || dialogOpenRef.current || (activeId && dirtyRef.current)) {
        restoreCurrentEntry(requestedIndex);
        return;
      }
      const value = requestedId ? callbacks.current.resolve(requestedId) : null;
      const nextId = value ? requestedId : null;
      if (requestedId && !value) {
        window.history.replaceState(withHistoryState(
          event.state, stateKey, null, indexKey, requestedIndex ?? historyIndexRef.current,
        ), "");
      }
      historyIndexRef.current = requestedIndex ?? historyIndexRef.current;
      if (nextId === activeId) return;
      applyingHistoryRef.current = true;
      if (value) callbacks.current.open(value);
      else callbacks.current.close();
    }

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
      if (clearOnUnmount && idFromHistoryState(window.history.state, stateKey) !== null) {
        window.history.replaceState(withHistoryState(window.history.state, stateKey, null), "");
      }
    };
  }, [clearOnUnmount, stateKey]);

  useEffect(() => {
    const previousId = currentIdRef.current;
    if (currentId === previousId) return;
    currentIdRef.current = currentId;
    if (applyingHistoryRef.current) {
      applyingHistoryRef.current = false;
      return;
    }
    const indexKey = historyIndexKey(stateKey);
    if (currentId) {
      historyIndexRef.current += 1;
      window.history.pushState(withHistoryState(
        window.history.state, stateKey, currentId, indexKey, historyIndexRef.current,
      ), "");
    } else if (previousId) {
      window.history.replaceState(withHistoryState(
        window.history.state, stateKey, null, indexKey, historyIndexRef.current,
      ), "");
    }
  }, [currentId, stateKey]);

  const setDirty = useCallback((dirty: boolean) => { dirtyRef.current = dirty; }, []);
  const setDialogOpen = useCallback((open: boolean) => { dialogOpenRef.current = open; }, []);

  return {
    pendingBack,
    setDirty,
    setDialogOpen,
    deferUntilRestored(action) {
      if (!restoringCurrentEntryRef.current) return false;
      deferredRestorationActionRef.current ??= action;
      return true;
    },
    requestBack() {
      if (pendingBackRef.current || restoringCurrentEntryRef.current) return;
      if (dirtyRef.current) {
        pendingBackRef.current = true;
        setPendingBack(true);
      } else window.history.back();
    },
    cancelBack() {
      consumeRestorationRef.current = restoringCurrentEntryRef.current;
      discardAfterRestoreRef.current = false;
      pendingTraversalRef.current = null;
      pendingBackRef.current = false;
      setPendingBack(false);
    },
    discardBack() {
      if (!pendingBackRef.current) return;
      if (restoringCurrentEntryRef.current) {
        discardAfterRestoreRef.current = true;
        return;
      }
      pendingBackRef.current = false;
      setPendingBack(false);
      dirtyRef.current = false;
      window.history.back();
    },
  };
}

function idFromHistoryState(state: unknown, key: string): string | null {
  if (!state || typeof state !== "object") return null;
  const value = (state as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

function historyIndexKey(stateKey: string) {
  return `${stateKey}__index`;
}

function traverseHistory(delta: -1 | 1) {
  if (delta === 1) window.history.forward();
  else window.history.back();
}

function indexFromHistoryState(state: unknown, key: string): number | null {
  if (!state || typeof state !== "object") return null;
  const value = (state as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function withHistoryState(
  state: unknown,
  key: string,
  id: string | null,
  indexKey?: string,
  index?: number,
) {
  const existing = state && typeof state === "object" && !Array.isArray(state)
    ? state as Record<string, unknown>
    : {};
  return {
    ...existing,
    [key]: id,
    ...(indexKey && index !== undefined ? { [indexKey]: index } : {}),
  };
}
