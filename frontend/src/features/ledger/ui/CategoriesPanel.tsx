"use client";

import React, { useEffect, useRef, useState } from "react";

import type { LedgerController } from "@/features/ledger/hooks/useLedgerController";
import { deriveCategoryGroups, type CategoryRowGroup } from "@/features/ledger/model/category-table";
import type { LedgerTableOccurrence } from "@/features/ledger/model/ledger-model";
import { defaultLedgerTableSettings } from "@/features/ledger/model/ledger-table-views";
import { CategoryCreateDialog } from "@/features/ledger/ui/CategoryCreateDialog";
import { CategoryDetail } from "@/features/ledger/ui/CategoryDetail";
import { CategoriesTable } from "@/features/ledger/ui/CategoriesTable";
import { LedgerTableViewHeader } from "@/features/ledger/ui/LedgerTableViewHeader";
import { safeLedgerErrorMessage } from "@/features/ledger/ui/ledger-ui";
import { DestructiveConfirmationDialog } from "@/features/workbench/ui/DestructiveConfirmationDialog";

export function CategoriesPanel({ controller }: { controller: LedgerController }) {
  const [selectedDetailId, setSelectedDetailId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTargets, setDeleteTargets] = useState<string[]>([]);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const deleteInFlight = useRef(false);
  const sectionRef = useRef<HTMLElement>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);

  const page = controller.tablePage?.("ledger.categories") ?? {
    items: [], nextOffset: null, moreStatus: "idle", moreError: null, generation: 0,
  };
  const groups = controller.tablePage
    ? categoryGroups(page.items.filter(isCategoryOccurrence))
    : deriveCategoryGroups(
      controller.state.categories,
      controller.tableSettings("ledger.categories"),
    );
  const visibleRows = groups.flatMap((group) => group.rows);
  const activeRows = controller.tablePage
    ? visibleRows
    : deriveCategoryGroups(
      controller.state.categories,
      defaultLedgerTableSettings("ledger.categories"),
    ).flatMap((group) => group.rows);
  const selectedDetail = selectedDetailId === null
    ? null
    : activeRows.find(({ id }) => id === selectedDetailId) ?? null;
  const activeRowCount = controller.state.categories.length > 0
    ? controller.state.categories.filter(({ active }) => active).length
    : activeRows.length;
  const selectedVisibleIds = selectedIds.filter((id) =>
    visibleRows.some((row) => row.id === id),
  );

  useEffect(() => {
    void controller.ensureTable?.("ledger.categories");
  }, [controller]);

  useEffect(() => {
    const activeIds = new Set(activeRows.map(({ id }) => id));
    setSelectedIds((current) => {
      const next = current.filter((id) => activeIds.has(id));
      return next.length === current.length ? current : next;
    });
    if (selectedDetailId && !activeIds.has(selectedDetailId)) setSelectedDetailId(null);
  }, [activeRows, selectedDetailId]);

  function returnToList() {
    setSelectedDetailId(null);
    requestAnimationFrame(() => sectionRef.current?.focus());
  }

  if (selectedDetail) {
    return (
      <CategoryDetail
        controller={controller}
        row={selectedDetail}
        onBack={returnToList}
        onDeleted={returnToList}
      />
    );
  }

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
    if (deleteInFlight.current || deleteTargets.length === 0) return;
    deleteInFlight.current = true;
    setDeletePending(true);
    setDeleteError(null);
    const successful: string[] = [];
    try {
      for (const id of deleteTargets) {
        await controller.archiveCategory(id);
        successful.push(id);
      }
      setSelectedIds((current) => current.filter((id) => !successful.includes(id)));
      setDeleteTargets([]);
    } catch (cause) {
      setSelectedIds((current) => current.filter((id) => !successful.includes(id)));
      setDeleteTargets((current) => current.filter((id) => !successful.includes(id)));
      setDeleteError(safeLedgerErrorMessage(cause, "Could not delete selected categories."));
    } finally {
      deleteInFlight.current = false;
      setDeletePending(false);
    }
  }

  return (
    <section ref={sectionRef} aria-labelledby="ledger-categories-heading" tabIndex={-1}>
      <LedgerTableViewHeader
        controller={controller}
        scope="ledger.categories"
        title="Categories"
        headingId="ledger-categories-heading"
        onAdd={() => void ensureReferences(controller).then((loaded) => {
          if (loaded) setCreateOpen(true);
        })}
        addButtonRef={addButtonRef}
        addLabel="Add category"
        onArchiveSelected={() => {
          setDeleteError(null);
          setDeleteTargets([...selectedVisibleIds]);
        }}
        archiveDisabled={selectedVisibleIds.length === 0 || deletePending}
        archiveSelectedLabel="Delete selected"
      />
      <CategoriesTable
        groups={groups}
        activeRowCount={activeRowCount}
        selectedIds={selectedIds}
        onOpen={(row) => void ensureReferences(controller).then((loaded) => {
          if (loaded) setSelectedDetailId(row.id);
        })}
        onToggle={toggleSelection}
        onToggleAll={toggleAllVisible}
        page={page}
        onLoadMore={() => void controller.loadMore?.("ledger.categories")}
      />
      {createOpen ? (
        <CategoryCreateDialog
          controller={controller}
          onClose={() => setCreateOpen(false)}
          returnFocusRef={addButtonRef}
        />
      ) : null}
      {deleteTargets.length > 0 ? (
        <DestructiveConfirmationDialog
          title="Delete selected categories?"
          description={`${deleteTargets.length} categories will be deactivated and removed from Ledger views.`}
          confirmLabel="Delete"
          error={deleteError}
          disabled={deletePending}
          fallbackFocusRef={sectionRef}
          onCancel={() => {
            setDeleteError(null);
            setDeleteTargets([]);
          }}
          onConfirm={deleteSelected}
        />
      ) : null}
    </section>
  );
}

function ensureReferences(controller: LedgerController): Promise<boolean> {
  return controller.ensureReferenceData?.("ledger.categories") ?? Promise.resolve(true);
}

function isCategoryOccurrence(
  item: LedgerTableOccurrence,
): item is Extract<LedgerTableOccurrence, { scope: "ledger.categories" }> {
  return item.scope === "ledger.categories";
}

function categoryGroups(
  items: Extract<LedgerTableOccurrence, { scope: "ledger.categories" }>[],
): CategoryRowGroup[] {
  const groups = new Map<string, CategoryRowGroup>();
  for (const { groupKey, groupLabel, record } of items) {
    const key = groupKey ?? "all";
    const group = groups.get(key) ?? { key, label: groupLabel, rows: [] };
    group.rows.push(record);
    groups.set(key, group);
  }
  return [...groups.values()];
}
