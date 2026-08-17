"use client";

import React, { useEffect, useRef, useState } from "react";

import type { LedgerController } from "@/features/ledger/hooks/useLedgerController";
import {
  deriveAccountGroups,
  type AccountRow,
} from "@/features/ledger/model/account-table";
import { AccountCreateDialog } from "@/features/ledger/ui/AccountCreateDialog";
import { AccountDetail } from "@/features/ledger/ui/AccountDetail";
import { AccountSettingsDialog } from "@/features/ledger/ui/AccountSettingsDialog";
import { AccountsTable } from "@/features/ledger/ui/AccountsTable";
import { LedgerTableViewHeader } from "@/features/ledger/ui/LedgerTableViewHeader";
import { safeLedgerErrorMessage } from "@/features/ledger/ui/ledger-ui";
import { DestructiveConfirmationDialog } from "@/features/workbench/ui/DestructiveConfirmationDialog";

export function AccountsPanel({ controller }: { controller: LedgerController }) {
  const [selectedDetailId, setSelectedDetailId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deleteConfirmationOpen, setDeleteConfirmationOpen] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const deleteInFlight = useRef(false);
  const sectionRef = useRef<HTMLElement>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);

  const groups = deriveAccountGroups(
    controller.state.accounts,
    controller.state.balances,
    controller.state.accountCategories,
    controller.tableSettings("ledger.accounts"),
  );
  const visibleRows = groups.flatMap((group) => group.rows);
  const selectedDetail = selectedDetailId === null
    ? null
    : visibleRows.find(({ id }) => id === selectedDetailId) ?? null;
  const activeRowCount = controller.state.accounts.filter(({ active }) => active).length;
  const selectedVisibleIds = selectedIds.filter((id) =>
    visibleRows.some((row) => row.id === id),
  );

  useEffect(() => {
    const activeAccountIds = new Set(
      controller.state.accounts.filter(({ active }) => active).map(({ id }) => id),
    );
    setSelectedIds((current) => {
      const next = current.filter((id) => activeAccountIds.has(id));
      return next.length === current.length ? current : next;
    });
    if (selectedDetailId && !activeAccountIds.has(selectedDetailId)) setSelectedDetailId(null);
  }, [controller.state.accounts, selectedDetailId]);

  function toggleSelection(id: string) {
    setSelectedIds((current) => current.includes(id)
      ? current.filter((item) => item !== id)
      : [...current, id]);
  }

  function toggleAllVisible() {
    const visibleIds = visibleRows.map(({ id }) => id);
    setSelectedIds((current) => {
      const allSelected = visibleIds.length > 0 && visibleIds.every((id) => current.includes(id));
      const next = new Set(current);
      for (const id of visibleIds) {
        if (allSelected) next.delete(id);
        else next.add(id);
      }
      return [...next];
    });
  }

  async function deleteSelected() {
    if (deleteInFlight.current || selectedVisibleIds.length === 0) return;
    deleteInFlight.current = true;
    setDeletePending(true);
    setDeleteError(null);
    const successful: string[] = [];
    try {
      for (const id of selectedVisibleIds) {
        await controller.archiveAccount(id);
        successful.push(id);
      }
      setSelectedIds((current) => current.filter((id) => !successful.includes(id)));
      setDeleteConfirmationOpen(false);
    } catch (cause) {
      setSelectedIds((current) => current.filter((id) => !successful.includes(id)));
      setDeleteError(safeLedgerErrorMessage(cause, "Could not delete selected accounts."));
    } finally {
      deleteInFlight.current = false;
      setDeletePending(false);
    }
  }

  if (selectedDetail) {
    return (
      <AccountDetail
        controller={controller}
        row={selectedDetail}
        onBack={() => setSelectedDetailId(null)}
        onDeleted={() => setSelectedDetailId(null)}
      />
    );
  }

  return (
    <section ref={sectionRef} aria-labelledby="ledger-accounts-heading" tabIndex={-1}>
      <LedgerTableViewHeader
        controller={controller}
        scope="ledger.accounts"
        title="Accounts"
        headingId="ledger-accounts-heading"
        onAdd={() => setCreateOpen(true)}
        addButtonRef={addButtonRef}
        addLabel="Add account"
        onSettings={() => setSettingsOpen(true)}
        settingsButtonRef={settingsButtonRef}
        settingsLabel="Account settings"
        onArchiveSelected={() => {
          setDeleteError(null);
          setDeleteConfirmationOpen(true);
        }}
        archiveDisabled={selectedVisibleIds.length === 0 || deletePending}
        archiveSelectedLabel="Delete selected"
      />
      <AccountsTable
        groups={groups}
        activeRowCount={activeRowCount}
        selectedIds={selectedIds}
        onOpen={(row) => setSelectedDetailId(row.id)}
        onToggle={toggleSelection}
        onToggleAll={toggleAllVisible}
      />
      {createOpen ? (
        <AccountCreateDialog
          controller={controller}
          onClose={() => setCreateOpen(false)}
          returnFocusRef={addButtonRef}
        />
      ) : null}
      {deleteConfirmationOpen ? (
        <DestructiveConfirmationDialog
          title="Delete selected accounts?"
          description={`${selectedVisibleIds.length} accounts will be deactivated and removed from Ledger views.`}
          confirmLabel="Delete"
          error={deleteError}
          disabled={deletePending}
          fallbackFocusRef={sectionRef}
          onCancel={() => {
            setDeleteError(null);
            setDeleteConfirmationOpen(false);
          }}
          onConfirm={deleteSelected}
        />
      ) : null}
      {settingsOpen ? (
        <AccountSettingsDialog
          controller={controller}
          onClose={() => setSettingsOpen(false)}
          returnFocusRef={settingsButtonRef}
        />
      ) : null}
    </section>
  );
}
