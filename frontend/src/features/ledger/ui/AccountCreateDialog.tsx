"use client";

import { ReferenceDataBoundary } from "@/features/workbench/ui/ReferenceDataBoundary";

import React from "react";
import { createPortal } from "react-dom";

import type { AccountInput } from "@/features/ledger/api/ledger-api";
import type { LedgerController } from "@/features/ledger/hooks/useLedgerController";
import type { AccountRow } from "@/features/ledger/model/account-table";
import { InitialFieldFocus, useDialogFocus } from "@/features/ledger/ui/dialog-focus";
import { formatMinorUnits, safeLedgerErrorMessage } from "@/features/ledger/ui/ledger-ui";
import { useDraftDirty, useModalIsolation } from "@/features/workbench/ui/modal-lifecycle";
import { useDiscardConfirmation } from "@/features/workbench/ui/use-discard-confirmation";

type AccountCreateDialogProps = {
  controller: LedgerController;
  /** Existing account to edit; the dialog creates a new one when omitted. */
  record?: AccountRow;
  onClose(): void;
  onDirtyChange?(dirty: boolean): void;
  returnFocusRef: React.RefObject<HTMLElement | null>;
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

export function AccountCreateDialog(props: AccountCreateDialogProps): React.ReactNode {
  const [host, setHost] = React.useState<HTMLElement | null>(null);

  React.useLayoutEffect(() => {
    const element = document.createElement("div");
    element.dataset.ravenModalHost = "";
    document.body.append(element);
    setHost(element);
    return () => element.remove();
  }, []);

  return host ? createPortal(
    <AccountCreateDialogContent {...props} />,
    host,
  ) : null;
}

function AccountCreateDialogContent({
  controller,
  record,
  onClose,
  onDirtyChange: reportDirty,
  returnFocusRef,
}: AccountCreateDialogProps) {
  const title = record ? "Edit account" : "Add account";
  const closeLabel = `Close ${title}`;
  const [initial] = React.useState(() => (record ? accountDraft(record) : emptyDraft));
  const [draft, setDraft] = React.useState(initial);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const mounted = React.useRef(true);
  const dialogRef = React.useRef<HTMLDivElement | null>(null);
  useModalIsolation(dialogRef, true, "body");
  const { onDirtyChange: markDirty, requestDiscard, discardConfirmation } = useDiscardConfirmation(dialogRef);
  const onDirtyChange = React.useCallback((dirty: boolean) => {
    markDirty(dirty);
    reportDirty?.(dirty);
  }, [markDirty, reportDirty]);
  useDraftDirty([draft], onDirtyChange);

  function close() {
    if (!pending) requestDiscard(onClose);
  }

  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useDialogFocus(dialogRef, returnFocusRef);

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
      if (record) {
        const update = accountUpdate(initial, draft);
        if (Object.keys(update).length > 0) await controller.updateAccount(record.id, update);
      } else {
        await controller.createAccount(draft);
      }
      saved = true;
    } catch (cause) {
      if (mounted.current) {
        setError(safeLedgerErrorMessage(cause, record ? "Could not save account." : "Could not create account."));
      }
    } finally {
      if (!mounted.current) return;
      setPending(false);
      if (saved) onClose();
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
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
        aria-label={title}
        aria-busy={pending}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        {discardConfirmation}
        <header className="dashboard-widget-header">
          <h2>{title}</h2>
        </header>
        <ReferenceDataBoundary load={controller.ensureAccountFormReferences} onCancel={close} cancelLabel={closeLabel}>
        <InitialFieldFocus />
        <form aria-label={record ? "Edit account" : "New account"} onSubmit={submit}>
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
              {record && draft.category && !accountTypes.some(({ id }) => id === draft.category) ? (
                <option value={draft.category} disabled>{record.accountTypeLabel}</option>
              ) : null}
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
              {record && draft.currency && !currencies.some(({ id }) => id === draft.currency) ? (
                <option value={draft.currency} disabled>{record.currencyCode}</option>
              ) : null}
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
          <div className="ledger-create-dialog-actions">
            <button
              type="button"
              className="items-toolbar-button"
              aria-label={closeLabel}
              disabled={pending}
              onClick={close}
            >
              Close
            </button>
            <button
              type="submit"
              className="items-toolbar-button ledger-create-dialog-save"
              disabled={pending}
            >
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
        </ReferenceDataBoundary>
      </div>
    </div>
  );
}

function accountDraft(row: AccountRow): AccountDraft {
  return {
    name: row.name,
    category: row.accountTypeId,
    currency: row.currencyId,
    openingBalance: formatMinorUnits(row.account.openingBalanceMinor, row.decimalPlaces),
  };
}

function accountUpdate(baseline: AccountDraft, draft: AccountDraft): Partial<AccountInput> {
  return {
    ...(draft.name !== baseline.name ? { name: draft.name } : {}),
    ...(draft.category !== baseline.category ? { category: draft.category } : {}),
    ...(draft.currency !== baseline.currency ? { currency: draft.currency, openingBalance: draft.openingBalance } : {}),
    ...(draft.currency === baseline.currency && draft.openingBalance !== baseline.openingBalance
      ? { openingBalance: draft.openingBalance }
      : {}),
  };
}
