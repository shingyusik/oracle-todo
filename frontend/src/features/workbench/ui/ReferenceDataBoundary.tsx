"use client";

import React from "react";

export function ReferenceDataBoundary<Scope = undefined>({
  load, scope, onCancel, cancelLabel = "Back", children,
}: {
  load?: (scope: Scope) => Promise<boolean>;
  scope?: Scope;
  onCancel(): void;
  cancelLabel?: string;
  children: React.ReactNode;
}) {
  const [status, setStatus] = React.useState<"loading" | "loaded" | "error">(
    load ? "loading" : "loaded",
  );
  const [attempt, setAttempt] = React.useState(0);
  const contentRef = React.useRef<HTMLDivElement>(null);
  const restoreFocus = React.useRef(false);
  React.useLayoutEffect(() => {
    if (status !== "loaded" || !restoreFocus.current) return;
    restoreFocus.current = false;
    contentRef.current?.querySelector<HTMLElement>(
      'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])',
    )?.focus();
  }, [status]);
  React.useEffect(() => {
    let active = true;
    if (!load) { setStatus("loaded"); return; }
    setStatus("loading");
    void load(scope as Scope).then(
      (ok) => {
        if (!active) return;
        restoreFocus.current = !!contentRef.current?.contains(document.activeElement);
        setStatus(ok ? "loaded" : "error");
      },
      () => { if (active) setStatus("error"); },
    );
    return () => { active = false; };
  }, [load, scope, attempt]);

  return <div ref={contentRef} aria-busy={status === "loading"}>
    {status === "loaded" ? children : <>
    {status === "loading"
      ? <p role="status">Loading references…</p>
      : <><p role="alert">Could not load references.</p>
          <button type="button" onClick={() => setAttempt((value) => value + 1)}>Retry</button></>}
    <button autoFocus type="button" aria-label={cancelLabel} onClick={onCancel}>{cancelLabel}</button>
    </>}
  </div>;
}
