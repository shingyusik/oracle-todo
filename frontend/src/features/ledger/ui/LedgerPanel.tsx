"use client";

import React, { useState } from "react";

import type { LedgerTabId } from "@/domain/workbench/navigation";
import type { LedgerController } from "@/features/ledger/hooks/useLedgerController";
import type { LedgerEntryView } from "@/features/ledger/model/ledger-model";
import { AccountsPanel } from "@/features/ledger/ui/AccountsPanel";
import { CategoriesPanel } from "@/features/ledger/ui/CategoriesPanel";
import { LedgerReports } from "@/features/ledger/ui/LedgerReports";
import { TransactionForm } from "@/features/ledger/ui/TransactionForm";
import { TransactionsTable } from "@/features/ledger/ui/TransactionsTable";
import { LedgerTableViewHeader } from "@/features/ledger/ui/LedgerTableViewHeader";
import { TableViewTabConfirmationDialog } from "@/features/workbench/ui/TableViewTabConfirmationDialog";

type LedgerPanelProps = {
  controller: LedgerController;
  leafTabId?: LedgerTabId;
};

export function LedgerPanel({
  controller,
  leafTabId = "transactions",
}: LedgerPanelProps) {
  if (controller.state.status === "loading") {
    return <p role="status" className="items-message">Loading Ledger…</p>;
  }

  if (controller.state.status === "error") {
    return (
      <section>
        <h1>Ledger</h1>
        <p role="alert" className="items-message">
          {controller.state.error ?? "Ledger is unavailable"}
        </p>
        <button type="button" onClick={() => void controller.refresh()}>Retry</button>
      </section>
    );
  }

  const panel = leafTabId === "accounts"
    ? <AccountsPanel controller={controller} />
    : leafTabId === "categories"
      ? <CategoriesPanel controller={controller} />
      : leafTabId === "reports"
        ? <LedgerReports controller={controller} />
        : <TransactionsPanel controller={controller} />;
  return (
    <>
      {panel}
      {controller.tableViewSaveError ? (
        <div className="items-message">
          <p role="alert">{controller.tableViewSaveError}</p>
          <button type="button" onClick={controller.retryTableViewSave}>
            Retry view save
          </button>
        </div>
      ) : null}
      <TableViewTabConfirmationDialog
        adapter={{
          confirmation: controller.tableViewConfirmation,
          confirm: controller.confirmTableViewAction,
          cancel: controller.cancelTableViewAction,
          isDirty: ({ scope }) => controller.tableIsDirty(scope),
          activeTabId: ({ scope }) => controller.tableTabs(scope).activeTabId,
        }}
      />
    </>
  );
}

function TransactionsPanel({ controller }: { controller: LedgerController }) {
  const [editing, setEditing] = useState<LedgerEntryView | null>(null);

  return (
    <section aria-labelledby="ledger-transactions-heading">
      <LedgerTableViewHeader
        controller={controller}
        scope="ledger.transactions"
        title="Transactions"
        headingId="ledger-transactions-heading"
      />
      <TransactionForm
        key={editing?.entry.id ?? "new"}
        controller={controller}
        entry={editing}
        onSaved={() => setEditing(null)}
      />
      {editing && (
        <button type="button" onClick={() => setEditing(null)}>
          Cancel transaction edit
        </button>
      )}
      <TransactionsTable controller={controller} onEdit={setEditing} />
    </section>
  );
}
