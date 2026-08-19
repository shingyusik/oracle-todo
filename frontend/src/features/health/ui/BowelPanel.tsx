"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

import { HealthMutationRefreshError, type HealthController } from "@/features/health/hooks/useHealthController";
import { deriveBowelGroups, type BowelRow } from "@/features/health/model/bowel-table";
import { defaultHealthTableSettings, healthBowelFilterSelectOptions } from "@/features/health/model/health-table-views";
import { BowelCreateDialog } from "@/features/health/ui/BowelCreateDialog";
import { BowelDetail } from "@/features/health/ui/BowelDetail";
import { BowelTable } from "@/features/health/ui/BowelTable";
import { HealthTableViewHeader } from "@/features/health/ui/HealthTableViewHeader";
import { useBrowserDetailHistory } from "@/features/workbench/hooks/useBrowserDetailHistory";
import { DestructiveConfirmationDialog } from "@/features/workbench/ui/DestructiveConfirmationDialog";

type BowelPanelProps = {
  controller: HealthController;
  tombstonedIds: ReadonlySet<string>;
  onArchiveCommitted: (id: string, refreshWarning?: string) => void;
  refreshWarning: string | null;
  refreshPending: boolean;
  onRetryRefresh: () => Promise<void>;
};

export function BowelPanel({ controller, tombstonedIds, onArchiveCommitted,
  refreshWarning, refreshPending, onRetryRefresh }: BowelPanelProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [detailRow, setDetailRow] = useState<BowelRow | null>(null);
  const [archiveTargets, setArchiveTargets] = useState<string[] | null>(null);
  const [archivePending, setArchivePending] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const archiveButtonRef = useRef<HTMLButtonElement>(null);
  const tableRef = useRef<HTMLElement>(null);
  const detailOriginRef = useRef<{ occurrence: string; rowId: string } | null>(null);

  useEffect(() => {
    if (controller.state.bowelStatus === "idle") void controller.refreshBowel();
  }, [controller]);

  const entries = useMemo(() => controller.state.bowelEntries.filter(({ deletedAt, id }) =>
    deletedAt === null && !tombstonedIds.has(id)), [controller.state.bowelEntries, tombstonedIds]);
  const activeGroups = useMemo(() => deriveBowelGroups(
    entries, defaultHealthTableSettings("health.bowel")), [entries]);
  const activeRows = useMemo(() => uniqueRows(activeGroups.flatMap(({ rows }) => rows)), [activeGroups]);
  const settings = controller.tableSettings("health.bowel");
  const groups = useMemo(() => deriveBowelGroups(entries, settings), [entries, settings]);
  const visibleRows = useMemo(() => uniqueRows(groups.flatMap(({ rows }) => rows)), [groups]);
  const selectedVisibleIds = useMemo(() => visibleRows
    .filter(({ id }) => selectedIds.includes(id)).map(({ id }) => id), [selectedIds, visibleRows]);
  const candidates = useMemo(() => deriveBowelGroups(entries, {
    ...defaultHealthTableSettings("health.bowel"),
    groupSettings: { ...settings.groupSettings, hideEmpty: false, manualOrder: [], hiddenGroupKeys: [] },
  }).filter(({ label }) => label !== null).map(({ key, label, rows }) => ({
    key, label: label!, count: uniqueRows(rows).length,
  })), [entries, settings.groupSettings]);
  const currentDetailRow = detailRow
    ? activeRows.find(({ id }) => id === detailRow.id) ?? null
    : null;
  const detailHistory = useBrowserDetailHistory({
    stateKey: "__ravenHealthBowelDetailId",
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
        ? tableRef.current?.querySelector<HTMLElement>(`[data-bowel-occurrence="${origin.occurrence}"]`)
        : null;
      const target = exact ?? (origin
        ? [...(tableRef.current?.querySelectorAll<HTMLElement>("[data-bowel-row-id]") ?? [])]
          .find((element) => element.dataset.bowelRowId === origin.rowId)
        : null);
      (target ?? addButtonRef.current)?.focus();
    });
  }

  function toggle(id: string) {
    setSelectedIds((current) => current.includes(id)
      ? current.filter((candidate) => candidate !== id) : [...current, id]);
  }
  function toggleAll() {
    const visibleIds = new Set(visibleRows.map(({ id }) => id));
    const allSelected = visibleRows.length > 0 && visibleRows.every(({ id }) => selectedIds.includes(id));
    setSelectedIds((current) => allSelected
      ? current.filter((id) => !visibleIds.has(id)) : [...new Set([...current, ...visibleIds])]);
  }
  function markArchived(id: string, warning?: string) {
    onArchiveCommitted(id, warning);
    setSelectedIds((current) => current.filter((candidate) => candidate !== id));
    setArchiveTargets((current) => current?.filter((candidate) => candidate !== id) ?? null);
  }
  async function archiveSelected() {
    if (!archiveTargets || archivePending) return;
    setArchivePending(true);
    setArchiveError(null);
    let currentId: string | null = null;
    try {
      for (const id of archiveTargets) {
        currentId = id;
        await controller.archiveBowel(id);
        markArchived(id);
      }
      setArchiveTargets(null);
    } catch (error) {
      if (error instanceof HealthMutationRefreshError) {
        if (currentId) markArchived(currentId, error.message);
      } else {
        setArchiveError(error instanceof Error ? error.message : "Could not archive bowel entries.");
      }
      setArchiveTargets(null);
    } finally {
      setArchivePending(false);
    }
  }

  const initial = controller.state.bowelEntries.length === 0;
  if (controller.state.bowelStatus === "loading" && initial) {
    return <p role="status" className="items-message">Loading bowel entries…</p>;
  }
  if (controller.state.bowelStatus === "error" && initial) {
    return <section><h1>Bowel</h1><p role="alert" className="items-message">
      {controller.state.bowelError ?? "Bowel entries are unavailable"}</p>
      <button type="button" onClick={() => void controller.refreshBowel()}>Retry</button></section>;
  }

  if (currentDetailRow) {
    return <BowelDetail key={currentDetailRow.id} controller={controller} row={currentDetailRow}
      detailHistory={detailHistory} onArchived={(warning) => {
        detailHistory.setDirty(false);
        detailHistory.requestBack();
        markArchived(currentDetailRow.id, warning);
      }} />;
  }

  return <section ref={tableRef} aria-labelledby="health-bowel-heading">
    <HealthTableViewHeader controller={controller} scope="health.bowel" title="Bowel"
      headingId="health-bowel-heading"
      fieldLabels={{ bristol_scale: "Bristol Scale", blood_visible: "Blood Visible" }}
      fieldOptions={healthBowelFilterSelectOptions} candidates={candidates}
      onAdd={() => setCreateOpen(true)} addButtonRef={addButtonRef}
      onArchiveSelected={() => { setArchiveError(null); setArchiveTargets(selectedVisibleIds); }}
      archiveButtonRef={archiveButtonRef}
      archiveDisabled={selectedVisibleIds.length === 0 || archivePending} />
    <BowelTable groups={groups} activeRowCount={activeRows.length} selectedIds={selectedIds}
      onOpen={(row, occurrence) => {
        detailOriginRef.current = { occurrence, rowId: row.id };
        setDetailRow(row);
      }} onToggle={toggle} onToggleAll={toggleAll} />
    {refreshWarning ? <div className="items-message"><p role="alert">{refreshWarning}</p>
      <button type="button" disabled={refreshPending}
        onClick={() => void onRetryRefresh()}>Retry</button></div>
      : controller.state.bowelError ? <p role="alert" className="items-message">
        {controller.state.bowelError}</p> : null}
    {archiveError && archiveTargets === null
      ? <p role="alert" className="items-message">{archiveError}</p> : null}
    {createOpen ? <BowelCreateDialog controller={controller} onClose={() => setCreateOpen(false)}
      returnFocusRef={addButtonRef} /> : null}
    {archiveTargets ? <DestructiveConfirmationDialog title="Archive selected bowel entries?"
      description={`${archiveTargets.length} bowel entries will be archived and removed from Health views.`}
      confirmLabel="Archive" error={archiveError} disabled={archivePending}
      fallbackFocusRef={addButtonRef}
      onCancel={() => { setArchiveError(null); setArchiveTargets(null); }}
      onConfirm={archiveSelected} /> : null}
  </section>;
}

function uniqueRows(rows: readonly BowelRow[]): BowelRow[] {
  const ids = new Set<string>();
  return rows.filter(({ id }) => ids.has(id) ? false : (ids.add(id), true));
}
