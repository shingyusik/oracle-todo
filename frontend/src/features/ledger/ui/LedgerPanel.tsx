"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

import type { LedgerTabId } from "@/domain/workbench/navigation";
import type { LedgerController } from "@/features/ledger/hooks/useLedgerController";
import type { LedgerEntryView } from "@/features/ledger/model/ledger-model";
import {
  deriveTransactionGroups,
  projectTransactionRows,
  type TransactionRow,
} from "@/features/ledger/model/transaction-table";
import { AccountsPanel } from "@/features/ledger/ui/AccountsPanel";
import { CategoriesPanel } from "@/features/ledger/ui/CategoriesPanel";
import { LedgerReports } from "@/features/ledger/ui/LedgerReports";
import { TransactionCreateDialog } from "@/features/ledger/ui/TransactionCreateDialog";
import { TransactionForm } from "@/features/ledger/ui/TransactionForm";
import { TransactionsTable } from "@/features/ledger/ui/TransactionsTable";
import { LedgerTableViewHeader } from "@/features/ledger/ui/LedgerTableViewHeader";
import { useLifecycleAction } from "@/features/ledger/ui/ledger-ui";
import { DestructiveConfirmationDialog } from "@/features/workbench/ui/DestructiveConfirmationDialog";
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
      {controller.state.error ? (
        <div className="items-message">
          <p role="alert">{controller.state.error}</p>
          <button type="button" onClick={() => void controller.refresh()}>Retry</button>
        </div>
      ) : null}
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
  const [dialogOpen, setDialogOpen] = useState(false);
  const [archiveConfirmationOpen, setArchiveConfirmationOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const actions = useLifecycleAction();
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const archiveButtonRef = useRef<HTMLButtonElement>(null);
  const settings = controller.tableSettings("ledger.transactions");
  const activeRows = useMemo(
    () => projectTransactionRows(controller.state.entries),
    [controller.state.entries],
  );
  const groups = useMemo(
    () => deriveTransactionGroups(controller.state.entries, settings),
    [controller.state.entries, settings],
  );
  const visibleRows = useMemo(
    () => groups.flatMap((group) => group.rows),
    [groups],
  );

  useEffect(() => {
    const visibleIds = new Set(visibleRows.map(({ id }) => id));
    setSelectedIds((current) => {
      const next = current.filter((id) => visibleIds.has(id));
      return next.length === current.length ? current : next;
    });
  }, [visibleRows]);

  function toggleSelection(id: string) {
    setSelectedIds((current) => current.includes(id)
      ? current.filter((candidate) => candidate !== id)
      : [...current, id]);
  }

  function toggleAllVisible() {
    const visibleIds = new Set(visibleRows.map(({ id }) => id));
    const allSelected = visibleRows.length > 0 && visibleRows.every(
      ({ id }) => selectedIds.includes(id),
    );
    setSelectedIds((current) => allSelected
      ? current.filter((id) => !visibleIds.has(id))
      : [...new Set([...current, ...visibleIds])]);
  }

  async function archiveSelected() {
    const targets = selectedIds.flatMap((id) => {
      const row = visibleRows.find((candidate) => candidate.id === id);
      return row ? [row] : [];
    });
    let complete = false;
    await actions.run("archive-selected", async () => {
      for (const row of targets) {
        await controller.archive(row.archiveEntryId);
        setSelectedIds((current) => current.filter((id) => id !== row.id));
      }
      complete = true;
    });
    if (complete) setArchiveConfirmationOpen(false);
  }

  function openTransaction(row: TransactionRow) {
    setEditing(row.detailEntry);
  }

  return (
    <section aria-labelledby="ledger-transactions-heading">
      <LedgerTableViewHeader
        controller={controller}
        scope="ledger.transactions"
        title="Transactions"
        headingId="ledger-transactions-heading"
        onAdd={() => setDialogOpen(true)}
        addButtonRef={addButtonRef}
        onArchiveSelected={() => setArchiveConfirmationOpen(true)}
        archiveDisabled={selectedIds.length === 0 || actions.isPending("archive-selected")}
        archiveButtonRef={archiveButtonRef}
      />
      {editing ? (
        <TransactionForm
          key={editing.entry.id}
          controller={controller}
          entry={editing}
          onSaved={() => setEditing(null)}
        />
      ) : null}
      {editing && (
        <button type="button" onClick={() => setEditing(null)}>
          Cancel transaction edit
        </button>
      )}
      <TransactionsTable
        controller={controller}
        groups={groups}
        activeRowCount={activeRows.length}
        selectedIds={selectedIds}
        onOpen={openTransaction}
        onToggle={toggleSelection}
        onToggleAll={toggleAllVisible}
      />
      {dialogOpen ? (
        <TransactionCreateDialog
          controller={controller}
          onClose={() => setDialogOpen(false)}
          returnFocusRef={addButtonRef}
        />
      ) : null}
      {archiveConfirmationOpen ? (
        <DestructiveConfirmationDialog
          title="Archive selected transactions?"
          description={`${selectedIds.length} transactions will be archived and removed from Ledger views.`}
          confirmLabel="Archive"
          error={actions.error}
          disabled={actions.isPending("archive-selected")}
          fallbackFocusRef={archiveButtonRef}
          onCancel={() => setArchiveConfirmationOpen(false)}
          onConfirm={archiveSelected}
        />
      ) : null}
    </section>
  );
}
