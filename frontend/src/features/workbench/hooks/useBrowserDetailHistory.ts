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
  const [pendingBack, setPendingBack] = useState(false);

  useEffect(() => {
    window.history.replaceState(withHistoryState(window.history.state, stateKey, currentIdRef.current), "");

    function restoreCurrentEntry() {
      restoringCurrentEntryRef.current = true;
      window.history.forward();
    }

    function finishDiscard() {
      pendingBackRef.current = false;
      setPendingBack(false);
      dirtyRef.current = false;
      window.history.back();
    }

    function handlePopState(event: PopStateEvent) {
      const activeId = currentIdRef.current;
      const requestedId = idFromHistoryState(event.state, stateKey);
      if (restoringCurrentEntryRef.current && requestedId === activeId) {
        restoringCurrentEntryRef.current = false;
        const consume = consumeRestorationRef.current;
        consumeRestorationRef.current = false;
        const deferred = deferredRestorationActionRef.current;
        deferredRestorationActionRef.current = null;
        if (deferred) {
          discardAfterRestoreRef.current = false;
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
        restoreCurrentEntry();
        return;
      }
      const value = requestedId ? callbacks.current.resolve(requestedId) : null;
      const nextId = value ? requestedId : null;
      if (requestedId && !value) {
        window.history.replaceState(withHistoryState(event.state, stateKey, null), "");
      }
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
    if (currentId) window.history.pushState(withHistoryState(window.history.state, stateKey, currentId), "");
    else if (previousId) window.history.replaceState(withHistoryState(window.history.state, stateKey, null), "");
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

function withHistoryState(state: unknown, key: string, id: string | null) {
  const existing = state && typeof state === "object" && !Array.isArray(state)
    ? state as Record<string, unknown>
    : {};
  return { ...existing, [key]: id };
}
