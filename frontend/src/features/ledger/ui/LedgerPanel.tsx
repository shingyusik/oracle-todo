"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

import type { LedgerTabId } from "@/domain/workbench/navigation";
import type { LedgerController } from "@/features/ledger/hooks/useLedgerController";
import {
  deriveTransactionGroups,
  projectTransactionRows,
  type TransactionRow,
} from "@/features/ledger/model/transaction-table";
import { AccountsPanel } from "@/features/ledger/ui/AccountsPanel";
import { CategoriesPanel } from "@/features/ledger/ui/CategoriesPanel";
import { LedgerReports } from "@/features/ledger/ui/LedgerReports";
import { TransactionCreateDialog } from "@/features/ledger/ui/TransactionCreateDialog";
import { TransactionDetail } from "@/features/ledger/ui/TransactionDetail";
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
  const [tombstonedIds, setTombstonedIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (controller.state.status !== "loaded" || tombstonedIds.size === 0) return;
    const activeIds = new Set(
      projectTransactionRows(controller.state.entries).map(({ id }) => id),
    );
    const next = new Set([...tombstonedIds].filter((id) => activeIds.has(id)));
    if (next.size !== tombstonedIds.size) setTombstonedIds(next);
  }, [controller.state.entries, controller.state.status, tombstonedIds]);

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
        : (
            <TransactionsPanel
              controller={controller}
              tombstonedIds={tombstonedIds}
              setTombstonedIds={setTombstonedIds}
            />
          );
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

function TransactionsPanel({
  controller,
  tombstonedIds,
  setTombstonedIds,
}: {
  controller: LedgerController;
  tombstonedIds: ReadonlySet<string>;
  setTombstonedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
}) {
  const [editing, setEditing] = useState<TransactionRow | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [archiveConfirmationOpen, setArchiveConfirmationOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const actions = useLifecycleAction();
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const settings = controller.tableSettings("ledger.transactions");
  const displayedEntries = useMemo(
    () => controller.state.entries.filter(({ entry }) =>
      !tombstonedIds.has(entry.transferGroupId ?? entry.id)),
    [controller.state.entries, tombstonedIds],
  );
  const activeRows = useMemo(
    () => projectTransactionRows(displayedEntries),
    [displayedEntries],
  );
  const groups = useMemo(
    () => deriveTransactionGroups(
      displayedEntries,
      settings,
      undefined,
      controller.state.currencies,
    ),
    [controller.state.currencies, displayedEntries, settings],
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

  useEffect(() => {
    if (
      editing &&
      !activeRows.some(({ id }) => id === editing.id)
    ) {
      setEditing(null);
    }
  }, [activeRows, editing]);

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
        setTombstonedIds((current) => new Set(current).add(row.id));
        setSelectedIds((current) => current.filter((id) => id !== row.id));
      }
      complete = true;
    });
    if (complete) setArchiveConfirmationOpen(false);
  }

  function openTransaction(row: TransactionRow) {
    setEditing(row);
  }

  if (editing) {
    return (
      <TransactionDetail
        controller={controller}
        row={editing}
        onBack={() => setEditing(null)}
        onArchived={() => {
          setTombstonedIds((current) => new Set(current).add(editing.id));
          setEditing(null);
        }}
      />
    );
  }

  return (
    <section aria-labelledby="ledger-transactions-heading">
      <LedgerTableViewHeader
        controller={controller}
        scope="ledger.transactions"
        title="Transactions"
        headingId="ledger-transactions-heading"
        transactionEntries={displayedEntries}
        onAdd={() => setDialogOpen(true)}
        addButtonRef={addButtonRef}
        onArchiveSelected={() => {
          actions.clearError();
          setArchiveConfirmationOpen(true);
        }}
        archiveDisabled={selectedIds.length === 0 || actions.isPending("archive-selected")}
      />
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
          fallbackFocusRef={addButtonRef}
          onCancel={() => {
            actions.clearError();
            setArchiveConfirmationOpen(false);
          }}
          onConfirm={archiveSelected}
        />
      ) : null}
    </section>
  );
}
