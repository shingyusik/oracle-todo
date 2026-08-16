"use client";

import React from "react";
import { createPortal } from "react-dom";

import type { LedgerController } from "@/features/ledger/hooks/useLedgerController";
import type {
  AccountCategory,
  Currency,
} from "@/features/ledger/model/ledger-model";
import { DestructiveConfirmationDialog } from "@/features/workbench/ui/DestructiveConfirmationDialog";
import { useModalIsolation } from "@/features/workbench/ui/modal-lifecycle";
import { RavenApiError, RavenTransportError } from "@/lib/raven-api";

type AccountSettingsDialogProps = {
  controller: LedgerController;
  onClose(): void;
  returnFocusRef: React.RefObject<HTMLButtonElement | null>;
};

type AccountSettingsTab = "account-types" | "currencies";

const tabs = [
  { id: "account-types", label: "Account types" },
  { id: "currencies", label: "Currencies" },
] as const;

type AccountCategoryDraft = {
  name: string;
  parent: string;
  liability: boolean;
};

const emptyAccountCategoryDraft: AccountCategoryDraft = {
  name: "",
  parent: "",
  liability: false,
};

type CurrencyDraft = {
  code: string;
  name: string;
  symbol: string;
  decimalPlaces: string;
};

const emptyCurrencyDraft: CurrencyDraft = {
  code: "",
  name: "",
  symbol: "",
  decimalPlaces: "2",
};

type DeactivationTarget =
  | { kind: "account-type"; item: AccountCategory }
  | { kind: "currency"; item: Currency };

export function AccountSettingsDialog({
  controller,
  onClose,
  returnFocusRef,
}: AccountSettingsDialogProps): React.ReactNode {
  const [host, setHost] = React.useState<HTMLElement | null>(null);

  React.useLayoutEffect(() => {
    const element = document.createElement("div");
    element.dataset.ravenModalHost = "";
    document.body.append(element);
    setHost(element);
    return () => element.remove();
  }, []);

  return host
    ? createPortal(
        <AccountSettingsDialogContent
          controller={controller}
          onClose={onClose}
          returnFocusRef={returnFocusRef}
        />,
        host,
      )
    : null;
}

function AccountSettingsDialogContent({
  controller,
  onClose,
  returnFocusRef,
}: AccountSettingsDialogProps) {
  const [activeTab, setActiveTab] = React.useState<AccountSettingsTab>("account-types");
  const [accountEditing, setAccountEditing] = React.useState<AccountCategory | null>(null);
  const [accountDraft, setAccountDraft] = React.useState(emptyAccountCategoryDraft);
  const [currencyEditing, setCurrencyEditing] = React.useState<Currency | null>(null);
  const [currencyDraft, setCurrencyDraft] = React.useState(emptyCurrencyDraft);
  const [deactivationTarget, setDeactivationTarget] = React.useState<DeactivationTarget | null>(
    null,
  );
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const dialogRef = React.useRef<HTMLDivElement>(null);
  const closeButtonRef = React.useRef<HTMLButtonElement>(null);
  useModalIsolation(dialogRef, deactivationTarget === null, "body");

  React.useEffect(() => {
    dialogRef.current?.querySelector<HTMLElement>(
      "input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])",
    )?.focus();
    return () => {
      if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus();
    };
  }, [returnFocusRef]);

  function resetAccountEditor() {
    setAccountEditing(null);
    setAccountDraft(emptyAccountCategoryDraft);
  }

  function resetCurrencyEditor() {
    setCurrencyEditing(null);
    setCurrencyDraft(emptyCurrencyDraft);
  }

  function selectTab(tab: AccountSettingsTab) {
    setActiveTab(tab);
    resetAccountEditor();
    resetCurrencyEditor();
    setDeactivationTarget(null);
    setError(null);
  }

  function editAccountCategory(item: AccountCategory) {
    setAccountEditing(item);
    setAccountDraft({
      name: item.name,
      parent: item.parentId ?? "",
      liability: item.liability,
    });
    setError(null);
  }

  function editCurrency(item: Currency) {
    setCurrencyEditing(item);
    setCurrencyDraft({
      code: item.code,
      name: item.name,
      symbol: item.symbol,
      decimalPlaces: item.decimalPlaces.toString(),
    });
    setError(null);
  }

  async function saveAccountCategory(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setError(null);
    setPending(true);
    const input = {
      name: accountDraft.name,
      parent: accountDraft.parent || null,
      liability: accountDraft.liability,
    };
    try {
      if (accountEditing) await controller.updateAccountCategory(accountEditing.id, input);
      else await controller.createAccountCategory(input);
      resetAccountEditor();
    } catch (cause) {
      setError(safeErrorMessage(cause, "Could not save account type."));
    } finally {
      setPending(false);
    }
  }

  async function saveCurrency(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const decimalPlaces = Number(currencyDraft.decimalPlaces);
    if (
      currencyDraft.decimalPlaces === "" ||
      !Number.isInteger(decimalPlaces) ||
      decimalPlaces < 0 ||
      decimalPlaces > 18
    ) {
      setError("Decimal places must be an integer from 0 to 18.");
      return;
    }
    setError(null);
    setPending(true);
    const input = {
      code: currencyDraft.code,
      name: currencyDraft.name,
      symbol: currencyDraft.symbol,
      decimalPlaces,
    };
    try {
      if (currencyEditing) await controller.updateCurrency(currencyEditing.id, input);
      else await controller.createCurrency(input);
      resetCurrencyEditor();
    } catch (cause) {
      setError(safeErrorMessage(cause, "Could not save currency."));
    } finally {
      setPending(false);
    }
  }

  async function deactivate() {
    const target = deactivationTarget;
    if (!target || pending) return;
    setError(null);
    setPending(true);
    try {
      if (target.kind === "account-type") {
        await controller.deactivateAccountCategory(target.item.id);
      } else {
        await controller.deactivateCurrency(target.item.id);
      }
      setDeactivationTarget(null);
    } catch (cause) {
      setError(safeErrorMessage(
        cause,
        target.kind === "account-type" ? "Could not deactivate account type." : "Could not deactivate currency.",
      ));
    } finally {
      setPending(false);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLElement>) {
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

  const activeAccountCategories = controller.state.accountCategories.filter(({ active }) => active);
  const activeCurrencies = controller.state.currencies.filter(({ active }) => active);
  const currentTab = tabs.find(({ id }) => id === activeTab)!;

  return (
    <div className="confirmation-backdrop">
      <div
        ref={dialogRef}
        className="confirmation-dialog ledger-account-settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Account settings"
        aria-busy={pending}
        onKeyDown={handleKeyDown}
      >
        <header className="dashboard-widget-header">
          <h2>Account settings</h2>
          <button
            ref={closeButtonRef}
            type="button"
            aria-label="Close"
            disabled={pending}
            onClick={onClose}
          >
            Close
          </button>
        </header>
        <div role="tablist" aria-label="Account settings sections">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              id={`${tab.id}-tab`}
              type="button"
              role="tab"
              aria-controls={`${tab.id}-panel`}
              aria-selected={activeTab === tab.id}
              tabIndex={activeTab === tab.id ? 0 : -1}
              disabled={pending}
              onClick={() => selectTab(tab.id)}
              onKeyDown={(event) => {
                if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                event.preventDefault();
                const index = tabs.findIndex(({ id }) => id === tab.id);
                const offset = event.key === "ArrowRight" ? 1 : -1;
                const next = tabs[(index + offset + tabs.length) % tabs.length]!;
                selectTab(next.id);
                document.getElementById(`${next.id}-tab`)?.focus();
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <section
          id={`${currentTab.id}-panel`}
          role="tabpanel"
          aria-labelledby={`${currentTab.id}-tab`}
        >
          {activeTab === "account-types" ? (
            <AccountTypes
              items={activeAccountCategories}
              draft={accountDraft}
              editing={accountEditing}
              pending={pending}
              error={error}
              onCancel={resetAccountEditor}
              onChange={setAccountDraft}
              onDeactivate={(item) => {
                setError(null);
                setDeactivationTarget({ kind: "account-type", item });
              }}
              onEdit={editAccountCategory}
              onSubmit={saveAccountCategory}
            />
          ) : (
            <Currencies
              items={activeCurrencies}
              draft={currencyDraft}
              editing={currencyEditing}
              pending={pending}
              error={error}
              onCancel={resetCurrencyEditor}
              onChange={setCurrencyDraft}
              onDeactivate={(item) => {
                setError(null);
                setDeactivationTarget({ kind: "currency", item });
              }}
              onEdit={editCurrency}
              onSubmit={saveCurrency}
            />
          )}
        </section>
      </div>
      {deactivationTarget ? (
        <DestructiveConfirmationDialog
          title={`Deactivate ${deactivationTarget.item.name}?`}
          description="This setting will no longer be available for new records."
          confirmLabel="Deactivate"
          error={error}
          disabled={pending}
          fallbackFocusRef={closeButtonRef}
          onCancel={() => {
            if (!pending) {
              setDeactivationTarget(null);
              setError(null);
            }
          }}
          onConfirm={deactivate}
        />
      ) : null}
    </div>
  );
}

function AccountTypes({
  items,
  draft,
  editing,
  pending,
  error,
  onCancel,
  onChange,
  onDeactivate,
  onEdit,
  onSubmit,
}: {
  items: AccountCategory[];
  draft: AccountCategoryDraft;
  editing: AccountCategory | null;
  pending: boolean;
  error: string | null;
  onCancel(): void;
  onChange(value: React.SetStateAction<AccountCategoryDraft>): void;
  onDeactivate(item: AccountCategory): void;
  onEdit(item: AccountCategory): void;
  onSubmit(event: React.FormEvent<HTMLFormElement>): void;
}) {
  const names = new Map(items.map((item) => [item.id, item.name]));
  return (
    <>
      <form aria-label={editing ? "Edit account type" : "New account type"} onSubmit={onSubmit}>
        <label className="field-label">
          Account type name
          <input
            required
            disabled={pending}
            value={draft.name}
            onChange={(event) => onChange((current) => ({ ...current, name: event.target.value }))}
          />
        </label>
        <label className="field-label">
          Parent account type
          <select
            disabled={pending}
            value={draft.parent}
            onChange={(event) => onChange((current) => ({ ...current, parent: event.target.value }))}
          >
            <option value="">No parent</option>
            {items.filter((item) => item.id !== editing?.id).map((item) => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select>
        </label>
        <label className="field-label">
          <input
            type="checkbox"
            disabled={pending}
            checked={draft.liability}
            onChange={(event) => onChange((current) => ({ ...current, liability: event.target.checked }))}
          />
          Liability
        </label>
        {error ? <p role="alert" className="items-message">{error}</p> : null}
        <button type="submit" disabled={pending}>
          {editing ? "Update account type" : "Add account type"}
        </button>
        {editing ? (
          <button type="button" disabled={pending} onClick={onCancel}>Cancel edit</button>
        ) : null}
      </form>
      {items.length === 0 ? <p className="items-message">No account types yet.</p> : (
        <table className="items-table">
          <thead>
            <tr><th>Name</th><th>Parent</th><th>Liability</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>{item.name}</td>
                <td>{item.parentId ? names.get(item.parentId) ?? "—" : "—"}</td>
                <td>{item.liability ? "Yes" : "No"}</td>
                <td>
                  <button type="button" disabled={pending} onClick={() => onEdit(item)}>
                    Edit {item.name}
                  </button>
                  <button type="button" disabled={pending} onClick={() => onDeactivate(item)}>
                    Deactivate {item.name}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function Currencies({
  items,
  draft,
  editing,
  pending,
  error,
  onCancel,
  onChange,
  onDeactivate,
  onEdit,
  onSubmit,
}: {
  items: Currency[];
  draft: CurrencyDraft;
  editing: Currency | null;
  pending: boolean;
  error: string | null;
  onCancel(): void;
  onChange(value: React.SetStateAction<CurrencyDraft>): void;
  onDeactivate(item: Currency): void;
  onEdit(item: Currency): void;
  onSubmit(event: React.FormEvent<HTMLFormElement>): void;
}) {
  return (
    <>
      <form
        noValidate
        aria-label={editing ? "Edit currency" : "New currency"}
        onSubmit={onSubmit}
      >
        <label className="field-label">
          Currency code
          <input
            required
            disabled={pending}
            value={draft.code}
            onChange={(event) => onChange((current) => ({ ...current, code: event.target.value }))}
          />
        </label>
        <label className="field-label">
          Currency name
          <input
            required
            disabled={pending}
            value={draft.name}
            onChange={(event) => onChange((current) => ({ ...current, name: event.target.value }))}
          />
        </label>
        <label className="field-label">
          Currency symbol
          <input
            required
            disabled={pending}
            value={draft.symbol}
            onChange={(event) => onChange((current) => ({ ...current, symbol: event.target.value }))}
          />
        </label>
        <label className="field-label">
          Decimal places
          <input
            required
            type="number"
            min={0}
            max={18}
            step={1}
            disabled={pending}
            value={draft.decimalPlaces}
            onChange={(event) => onChange((current) => ({
              ...current,
              decimalPlaces: event.target.value,
            }))}
          />
        </label>
        {error ? <p role="alert" className="items-message">{error}</p> : null}
        <button type="submit" disabled={pending}>
          {editing ? "Update currency" : "Add currency"}
        </button>
        {editing ? (
          <button type="button" disabled={pending} onClick={onCancel}>Cancel edit</button>
        ) : null}
      </form>
      {items.length === 0 ? <p className="items-message">No currencies yet.</p> : (
        <table className="items-table">
          <thead>
            <tr><th>Code</th><th>Name</th><th>Symbol</th><th>Decimal places</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>{item.code}</td>
                <td>{item.name}</td>
                <td>{item.symbol}</td>
                <td>{item.decimalPlaces}</td>
                <td>
                  <button type="button" disabled={pending} onClick={() => onEdit(item)}>
                    Edit {item.code}
                  </button>
                  <button type="button" disabled={pending} onClick={() => onDeactivate(item)}>
                    Deactivate {item.code}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function safeErrorMessage(error: unknown, fallback: string): string {
  return error instanceof RavenApiError || error instanceof RavenTransportError
    ? error.message
    : fallback;
}
