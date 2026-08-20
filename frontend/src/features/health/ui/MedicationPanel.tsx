"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

import {
  HealthMutationRefreshError,
  type HealthController,
} from "@/features/health/hooks/useHealthController";
import {
  deriveMedicationGroups,
  type MedicationRow,
} from "@/features/health/model/medication-table";
import {
  defaultHealthTableSettings,
  healthMedicationFilterSelectOptions,
} from "@/features/health/model/health-table-views";
import { MedicationCreateDialog } from "@/features/health/ui/MedicationCreateDialog";
import { MedicationDetail } from "@/features/health/ui/MedicationDetail";
import { MedicationTable } from "@/features/health/ui/MedicationTable";
import { HealthTableViewHeader } from "@/features/health/ui/HealthTableViewHeader";
import { useBrowserDetailHistory } from "@/features/workbench/hooks/useBrowserDetailHistory";
import { DestructiveConfirmationDialog } from "@/features/workbench/ui/DestructiveConfirmationDialog";

type MedicationPanelProps = {
  controller: HealthController;
  tombstonedIds: ReadonlySet<string>;
  onArchiveCommitted: (id: string, refreshWarning?: string) => void;
  refreshWarning: string | null;
  refreshPending: boolean;
  onRetryRefresh: () => Promise<boolean>;
};

export function MedicationPanel({
  controller,
  tombstonedIds,
  onArchiveCommitted,
  refreshWarning,
  refreshPending,
  onRetryRefresh,
}: MedicationPanelProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [detailRow, setDetailRow] = useState<MedicationRow | null>(null);
  const [archiveTargets, setArchiveTargets] = useState<string[] | null>(null);
  const [archivePending, setArchivePending] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const archiveButtonRef = useRef<HTMLButtonElement>(null);
  const tableRef = useRef<HTMLElement>(null);
  const detailOriginRef = useRef<{ occurrence: string; rowId: string } | null>(null);

  const entries = useMemo(() => controller.state.medicationEntries.filter(({ deletedAt, id }) =>
    deletedAt === null && !tombstonedIds.has(id)),
  [controller.state.medicationEntries, tombstonedIds]);
  const activeGroups = useMemo(() => deriveMedicationGroups(
    entries, defaultHealthTableSettings("health.medication")), [entries]);
  const activeRows = useMemo(() => uniqueRows(activeGroups.flatMap(({ rows }) => rows)), [activeGroups]);
  const settings = controller.tableSettings("health.medication");
  const groups = useMemo(() => deriveMedicationGroups(entries, settings), [entries, settings]);
  const visibleRows = useMemo(() => uniqueRows(groups.flatMap(({ rows }) => rows)), [groups]);
  const selectedVisibleIds = useMemo(() => visibleRows
    .filter(({ id }) => selectedIds.includes(id)).map(({ id }) => id), [selectedIds, visibleRows]);
  const candidates = useMemo(() => deriveMedicationGroups(entries, {
    ...defaultHealthTableSettings("health.medication"),
    groupSettings: {
      ...settings.groupSettings,
      hideEmpty: false,
      manualOrder: [],
      hiddenGroupKeys: [],
    },
  }).filter(({ label }) => label !== null).map(({ key, label, rows }) => ({
    key, label: label!, count: uniqueRows(rows).length,
  })), [entries, settings.groupSettings]);
  const currentDetailRow = detailRow
    ? activeRows.find(({ id }) => id === detailRow.id) ?? null
    : null;
  const detailHistory = useBrowserDetailHistory({
    stateKey: "__ravenHealthMedicationDetailId",
    currentId: currentDetailRow?.id ?? null,
    resolve: (id) => activeRows.find((row) => row.id === id) ?? null,
    open: (row) => {
      if (detailOriginRef.current?.rowId !== row.id) {
        detailOriginRef.current = { occurrence: "", rowId: row.id };
      }
      setDetailRow(row);
    },
    close: () => {
      setDetailRow(null);
      restoreDetailFocus();
    },
    clearOnUnmount: true,
  });

  useEffect(() => {
    const activeIds = new Set(activeRows.map(({ id }) => id));
    setSelectedIds((current) => {
      const next = current.filter((id) => activeIds.has(id));
      return next.length === current.length ? current : next;
    });
    if (detailRow && !activeIds.has(detailRow.id)) {
      setDetailRow(null);
      restoreDetailFocus();
    }
  }, [activeRows, detailRow]);

  function restoreDetailFocus() {
    requestAnimationFrame(() => {
      const origin = detailOriginRef.current;
      const exact = origin
        ? tableRef.current?.querySelector<HTMLElement>(`[data-medication-occurrence="${origin.occurrence}"]`)
        : null;
      const target = exact ?? (origin
        ? [...(tableRef.current?.querySelectorAll<HTMLElement>("[data-medication-row-id]") ?? [])]
          .find((element) => element.dataset.medicationRowId === origin.rowId)
        : null);
      (target ?? addButtonRef.current)?.focus();
    });
  }

  function toggle(id: string) {
    setSelectedIds((current) => current.includes(id)
      ? current.filter((candidate) => candidate !== id)
      : [...current, id]);
  }

  function toggleAll() {
    const visibleIds = new Set(visibleRows.map(({ id }) => id));
    const allSelected = visibleRows.length > 0 && visibleRows.every(({ id }) =>
      selectedIds.includes(id));
    setSelectedIds((current) => allSelected
      ? current.filter((id) => !visibleIds.has(id))
      : [...new Set([...current, ...visibleIds])]);
  }

  function markArchived(id: string, warning?: string) {
    onArchiveCommitted(id, warning);
    setSelectedIds((current) => current.filter((candidate) => candidate !== id));
    setArchiveTargets((current) => current?.filter((candidate) => candidate !== id) ?? null);
  }

  async function retryRefresh() {
    if (await onRetryRefresh()) addButtonRef.current?.focus();
  }

  async function archiveSelected() {
    if (!archiveTargets || archivePending) return;
    setArchivePending(true);
    setArchiveError(null);
    let currentId: string | null = null;
    try {
      for (const id of archiveTargets) {
        currentId = id;
        await controller.archiveMedication(id);
        markArchived(id);
      }
      setArchiveTargets(null);
    } catch (error) {
      if (error instanceof HealthMutationRefreshError) {
        if (currentId) markArchived(currentId, error.message);
      } else {
        setArchiveError(error instanceof Error
          ? error.message
          : "Could not archive medication entries.");
      }
      setArchiveTargets(null);
    } finally {
      setArchivePending(false);
    }
  }

  const initial = controller.state.medicationEntries.length === 0;
  if (controller.state.medicationStatus === "loading" && initial) {
    return <p role="status" className="items-message">Loading medication entries…</p>;
  }
  if (controller.state.medicationStatus === "error" && initial) {
    return <section><h1>Medication</h1><p role="alert" className="items-message">
      {controller.state.medicationError ?? "Medication entries are unavailable"}</p>
      <button type="button" onClick={() => void controller.refreshMedication()}>Retry</button>
    </section>;
  }

  if (currentDetailRow) {
    return <MedicationDetail key={currentDetailRow.id} controller={controller} row={currentDetailRow}
      detailHistory={detailHistory} onArchived={(warning) => {
        detailHistory.setDirty(false);
        detailHistory.requestBack();
        markArchived(currentDetailRow.id, warning);
      }} />;
  }

  return <section ref={tableRef} aria-labelledby="health-medication-heading">
    <HealthTableViewHeader controller={controller} scope="health.medication" title="Medication"
      headingId="health-medication-heading"
      fieldLabels={{ medication_name: "Medication", medication_unit: "Unit", dose: "Dose" }}
      fieldOptions={healthMedicationFilterSelectOptions} candidates={candidates}
      onAdd={() => setCreateOpen(true)} addButtonRef={addButtonRef}
      onArchiveSelected={() => { setArchiveError(null); setArchiveTargets(selectedVisibleIds); }}
      archiveButtonRef={archiveButtonRef}
      archiveDisabled={selectedVisibleIds.length === 0 || archivePending} />
    <MedicationTable groups={groups} activeRowCount={activeRows.length} selectedIds={selectedIds}
      onOpen={(row, occurrence) => {
        detailOriginRef.current = { occurrence, rowId: row.id };
        setDetailRow(row);
      }} onToggle={toggle} onToggleAll={toggleAll} />
    {refreshWarning ? <div className="items-message"><p role="alert">{refreshWarning}</p>
      <button type="button" disabled={refreshPending}
        onClick={() => void retryRefresh()}>Retry</button></div>
      : controller.state.medicationError ? <p role="alert" className="items-message">
        {controller.state.medicationError}</p> : null}
    {archiveError && archiveTargets === null
      ? <p role="alert" className="items-message">{archiveError}</p> : null}
    {createOpen ? <MedicationCreateDialog controller={controller} onClose={() => setCreateOpen(false)}
      returnFocusRef={addButtonRef} /> : null}
    {archiveTargets ? <DestructiveConfirmationDialog
      title="Archive selected medication entries?"
      description={`${archiveTargets.length} medication entries will be archived and removed from Health views.`}
      confirmLabel="Archive" error={archiveError} disabled={archivePending}
      fallbackFocusRef={addButtonRef}
      onCancel={() => { setArchiveError(null); setArchiveTargets(null); }}
      onConfirm={archiveSelected} /> : null}
  </section>;
}

function uniqueRows(rows: readonly MedicationRow[]): MedicationRow[] {
  const ids = new Set<string>();
  return rows.filter(({ id }) => ids.has(id) ? false : (ids.add(id), true));
}
