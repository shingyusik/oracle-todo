"use client";

import React, { useEffect, useRef, useState } from "react";

import type { LedgerController } from "@/features/ledger/hooks/useLedgerController";
import {
  deriveAccountGroups,
  type AccountRow,
  type AccountRowGroup,
} from "@/features/ledger/model/account-table";
import type { LedgerTableOccurrence } from "@/features/ledger/model/ledger-model";
import { defaultLedgerTableSettings } from "@/features/ledger/model/ledger-table-views";
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

  const page = controller.tablePage?.("ledger.accounts") ?? {
    items: [], nextOffset: null, moreStatus: "idle", moreError: null, generation: 0,
  };
  const groups = controller.tablePage
    ? accountGroups(page.items.filter(isAccountOccurrence))
    : deriveAccountGroups(
      controller.state.accounts,
      controller.state.balances,
      controller.state.accountCategories,
      controller.tableSettings("ledger.accounts"),
    );
  const visibleRows = groups.flatMap((group) => group.rows);
  const activeRows = controller.tablePage
    ? visibleRows
    : deriveAccountGroups(
      controller.state.accounts,
      controller.state.balances,
      controller.state.accountCategories,
      defaultLedgerTableSettings("ledger.accounts"),
    ).flatMap((group) => group.rows);
  const selectedDetail = selectedDetailId === null
    ? null
    : activeRows.find(({ id }) => id === selectedDetailId) ?? null;
  const activeRowCount = controller.state.accounts.length > 0
    ? controller.state.accounts.filter(({ active }) => active).length
    : activeRows.length;
  const selectedVisibleIds = selectedIds.filter((id) =>
    visibleRows.some((row) => row.id === id),
  );

  useEffect(() => {
    void controller.ensureTable?.("ledger.accounts");
  }, [controller]);

  useEffect(() => {
    const activeAccountIds = new Set(activeRows.map(({ id }) => id));
    setSelectedIds((current) => {
      const next = current.filter((id) => activeAccountIds.has(id));
      return next.length === current.length ? current : next;
    });
    if (selectedDetailId && !activeAccountIds.has(selectedDetailId)) setSelectedDetailId(null);
  }, [activeRows, selectedDetailId]);

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

  function returnToList() {
    setSelectedDetailId(null);
    requestAnimationFrame(() => sectionRef.current?.focus());
  }

  if (selectedDetail) {
    return (
      <AccountDetail
        controller={controller}
        row={selectedDetail}
        onBack={returnToList}
        onDeleted={returnToList}
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
        onAdd={() => void ensureReferences(controller).then((loaded) => {
          if (loaded) setCreateOpen(true);
        })}
        addButtonRef={addButtonRef}
        addLabel="Add account"
        onSettings={() => void ensureReferences(controller).then((loaded) => {
          if (loaded) setSettingsOpen(true);
        })}
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
        onOpen={(row) => void ensureReferences(controller).then((loaded) => {
          if (loaded) setSelectedDetailId(row.id);
        })}
        onToggle={toggleSelection}
        onToggleAll={toggleAllVisible}
        page={page}
        onLoadMore={() => void controller.loadMore?.("ledger.accounts")}
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

function ensureReferences(controller: LedgerController): Promise<boolean> {
  return controller.ensureReferenceData?.("ledger.accounts") ?? Promise.resolve(true);
}

function isAccountOccurrence(
  item: LedgerTableOccurrence,
): item is Extract<LedgerTableOccurrence, { scope: "ledger.accounts" }> {
  return item.scope === "ledger.accounts";
}

function accountGroups(
  items: Extract<LedgerTableOccurrence, { scope: "ledger.accounts" }>[],
): AccountRowGroup[] {
  const groups = new Map<string, AccountRowGroup>();
  for (const { groupKey, groupLabel, record } of items) {
    const key = groupKey ?? "all";
    const group = groups.get(key) ?? { key, label: groupLabel, rows: [] };
    group.rows.push(record);
    groups.set(key, group);
  }
  return [...groups.values()];
}
