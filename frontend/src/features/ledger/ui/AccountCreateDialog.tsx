"use client";

import React from "react";
import { createPortal } from "react-dom";

import type { LedgerController } from "@/features/ledger/hooks/useLedgerController";
import { safeLedgerErrorMessage } from "@/features/ledger/ui/ledger-ui";
import { useModalIsolation } from "@/features/workbench/ui/modal-lifecycle";

type AccountCreateDialogProps = {
  controller: LedgerController;
  onClose(): void;
  returnFocusRef: React.RefObject<HTMLButtonElement | null>;
};

type AccountDraft = {
  name: string;
  category: string;
  currency: string;
  openingBalance: string;
};

const emptyDraft: AccountDraft = {
  name: "",
  category: "",
  currency: "",
  openingBalance: "0",
};

export function AccountCreateDialog({
  controller,
  onClose,
  returnFocusRef,
}: AccountCreateDialogProps): React.ReactNode {
  const [host, setHost] = React.useState<HTMLElement | null>(null);

  React.useLayoutEffect(() => {
    const element = document.createElement("div");
    element.dataset.ravenModalHost = "";
    document.body.append(element);
    setHost(element);
    return () => element.remove();
  }, []);

  return host ? createPortal(
    <AccountCreateDialogContent
      controller={controller}
      onClose={onClose}
      returnFocusRef={returnFocusRef}
    />,
    host,
  ) : null;
}

function AccountCreateDialogContent({
  controller,
  onClose,
  returnFocusRef,
}: AccountCreateDialogProps) {
  const [draft, setDraft] = React.useState(emptyDraft);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const mounted = React.useRef(true);
  const dialogRef = React.useRef<HTMLDivElement | null>(null);
  useModalIsolation(dialogRef, true, "body");

  React.useEffect(() => {
    mounted.current = true;
    dialogRef.current?.querySelector<HTMLElement>(
      'form input:not([disabled]), form select:not([disabled]), form textarea:not([disabled]), form button:not([disabled])',
    )?.focus();
    return () => {
      mounted.current = false;
      if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus();
    };
  }, [returnFocusRef]);

  function field(name: keyof AccountDraft, value: string) {
    setDraft((current) => ({ ...current, [name]: value }));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    let saved = false;
    try {
      await controller.createAccount(draft);
      saved = true;
    } catch (cause) {
      if (mounted.current) setError(safeLedgerErrorMessage(cause, "Could not create account."));
    } finally {
      if (!mounted.current) return;
      setPending(false);
      if (saved) onClose();
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      if (!pending) onClose();
      return;
    }
    if (event.key !== "Tab" || !dialogRef.current) return;
    const focusables = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
      'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ));
    const index = focusables.indexOf(document.activeElement as HTMLElement);
    if (!event.shiftKey && index === focusables.length - 1) {
      event.preventDefault();
      focusables[0]?.focus();
    } else if (event.shiftKey && index === 0) {
      event.preventDefault();
      focusables.at(-1)?.focus();
    }
  }

  const accountTypes = controller.state.accountCategories.filter(({ active }) => active);
  const currencies = controller.state.currencies.filter(({ active }) => active);

  return (
    <div className="confirmation-backdrop">
      <div
        ref={dialogRef}
        className="confirmation-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Add account"
        aria-busy={pending}
        onKeyDown={handleKeyDown}
      >
        <header className="dashboard-widget-header">
          <h2>Add account</h2>
          <button
            type="button"
            aria-label="Close Add account"
            disabled={pending}
            onClick={onClose}
          >
            Close
          </button>
        </header>
        <form aria-label="New account" onSubmit={submit}>
          <label className="field-label">
            Account name
            <input
              required
              disabled={pending}
              value={draft.name}
              onChange={(event) => field("name", event.target.value)}
            />
          </label>
          <label className="field-label">
            Account type
            <select
              required
              disabled={pending}
              value={draft.category}
              onChange={(event) => field("category", event.target.value)}
            >
              <option value="">Select account type</option>
              {accountTypes.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
          </label>
          <label className="field-label">
            Currency
            <select
              required
              disabled={pending}
              value={draft.currency}
              onChange={(event) => field("currency", event.target.value)}
            >
              <option value="">Select currency</option>
              {currencies.map((item) => (
                <option key={item.id} value={item.id}>{item.code} — {item.name}</option>
              ))}
            </select>
          </label>
          <label className="field-label">
            Opening balance
            <input
              required
              inputMode="decimal"
              disabled={pending}
              value={draft.openingBalance}
              onChange={(event) => field("openingBalance", event.target.value)}
            />
          </label>
          {error ? <p role="alert" className="items-message">{error}</p> : null}
          <button type="submit" disabled={pending}>Create account</button>
        </form>
      </div>
    </div>
  );
}
