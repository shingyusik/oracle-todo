"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

import type { LedgerTabId } from "@/domain/workbench/navigation";
import type { ReportSelection } from "@/features/ledger/api/ledger-api";
import type { LedgerController } from "@/features/ledger/hooks/useLedgerController";
import type { LedgerTableOccurrence } from "@/features/ledger/model/ledger-model";
import {
  deriveTransactionGroups,
  projectTransactionRows,
  type TransactionRow,
  type TransactionRowGroup,
} from "@/features/ledger/model/transaction-table";
import type { ReportDrilldownTarget } from "@/features/ledger/model/ledger-reports";
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
  onReportDrilldown?: (target: ReportDrilldownTarget) => void;
  initialReportSelection?: ReportSelection;
  initialReportCurrencyId?: string;
};

export function LedgerPanel({
  controller,
  leafTabId = "transactions",
  onReportDrilldown,
  initialReportSelection,
  initialReportCurrencyId,
}: LedgerPanelProps) {
  const [tombstonedIds, setTombstonedIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (controller.state.status !== "loaded" || tombstonedIds.size === 0) return;
    const activeIds = new Set(
      (controller.tablePage?.("ledger.transactions").items ?? [])
        .filter(isTransactionOccurrence)
        .map(({ record }) => record.id),
    );
    const next = new Set([...tombstonedIds].filter((id) => activeIds.has(id)));
    if (next.size !== tombstonedIds.size) setTombstonedIds(next);
  }, [controller, controller.state.status, tombstonedIds]);

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
        ? (
            <LedgerReports
              controller={controller}
              onDrilldown={onReportDrilldown}
              initialReportSelection={initialReportSelection}
              initialReportCurrencyId={initialReportCurrencyId}
            />
          )
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
  const page = controller.tablePage?.("ledger.transactions") ?? {
    items: [], nextOffset: null, moreStatus: "idle", moreError: null, generation: 0,
  };
  useEffect(() => {
    void controller.ensureTable?.("ledger.transactions");
  }, [controller]);
  const occurrences = page.items
    .filter(isTransactionOccurrence)
    .filter(({ record }) => !tombstonedIds.has(record.id));
  const legacyEntries = controller.state.entries.filter(({ entry }) =>
    !tombstonedIds.has(entry.transferGroupId ?? entry.id));
  const groups = controller.tablePage
    ? transactionGroups(occurrences)
    : deriveTransactionGroups(
      legacyEntries,
      controller.tableSettings("ledger.transactions"),
      undefined,
      controller.state.currencies,
    );
  const activeRows = controller.tablePage
    ? occurrences.map(({ record }) => record)
    : projectTransactionRows(legacyEntries);
  const referenceRows = legacyEntries.length > 0
    ? projectTransactionRows(legacyEntries)
    : activeRows;
  const resolvedEditing = editing === null
    ? null
    : controller.hasReferenceData?.("ledger.transactions")
      ? projectTransactionRows(legacyEntries).find(({ id }) => id === editing.id) ?? null
      : referenceRows.find(({ id }) => id === editing.id) ?? null;
  const displayedEntries = legacyEntries.length > 0
    ? legacyEntries
    : activeRows.flatMap(({ detailEntry, transferEntry }) =>
      transferEntry ? [detailEntry, transferEntry] : [detailEntry]);
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
      editing && !resolvedEditing
    ) {
      setEditing(null);
    }
  }, [resolvedEditing, editing]);

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

  async function openTransaction(row: TransactionRow) {
    if (await ensureLedgerReferences(controller, "ledger.transactions")) setEditing(row);
  }

  if (resolvedEditing) {
    return (
      <TransactionDetail
        controller={controller}
        row={resolvedEditing}
        onBack={() => setEditing(null)}
        onArchived={() => {
          setTombstonedIds((current) => new Set(current).add(resolvedEditing.id));
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
        onAdd={() => void ensureLedgerReferences(controller, "ledger.transactions").then((loaded) => {
          if (loaded) setDialogOpen(true);
        })}
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
        activeRowCount={referenceRows.length}
        selectedIds={selectedIds}
        onOpen={openTransaction}
        onToggle={toggleSelection}
        onToggleAll={toggleAllVisible}
        page={visibleTablePage(
          page,
          controller.state.error,
          occurrences.length === 0 && page.items.length > 0,
        )}
        onLoadMore={() => void controller.loadMore?.("ledger.transactions")}
        emptyMessage={transactionEmptyMessage(controller, page)}
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

function transactionEmptyMessage(
  controller: LedgerController,
  page: ReturnType<NonNullable<LedgerController["tablePage"]>>,
): string {
  if (page.items.length === 0 && (page.generation === 0 || page.moreStatus === "loading")) {
    return "Loading transactions\u2026";
  }
  const settings = controller.tableSettings("ledger.transactions");
  return settings.filterRules.length > 0 || settings.groupSettings.hiddenGroupKeys.length > 0
    ? "No transactions match this view."
    : "No transactions yet.";
}

function visibleTablePage(
  page: ReturnType<NonNullable<LedgerController["tablePage"]>>,
  globalError: string | null,
  allRowsTombstoned = false,
) {
  const hideNextOffset = page.moreStatus === "error"
    ? Boolean(globalError)
    : allRowsTombstoned;
  return hideNextOffset
    ? { ...page, nextOffset: null }
    : page;
}

function ensureLedgerReferences(
  controller: LedgerController,
  scope: "ledger.transactions",
): Promise<boolean> {
  return controller.ensureReferenceData?.(scope) ?? Promise.resolve(true);
}

function isTransactionOccurrence(
  item: LedgerTableOccurrence,
): item is Extract<LedgerTableOccurrence, { scope: "ledger.transactions" }> {
  return item.scope === "ledger.transactions";
}

function transactionGroups(
  items: Extract<LedgerTableOccurrence, { scope: "ledger.transactions" }>[],
): TransactionRowGroup[] {
  const groups = new Map<string, TransactionRowGroup>();
  for (const { groupKey, groupLabel, record } of items) {
    const key = groupKey ?? "all";
    const group = groups.get(key) ?? { key, label: groupLabel, rows: [] };
    group.rows.push(record);
    groups.set(key, group);
  }
  return [...groups.values()];
}
