"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

import { HealthMutationRefreshError, type HealthController } from "@/features/health/hooks/useHealthController";
import { deriveHealthMetricsGroups, type HealthMetricsRow } from "@/features/health/model/health-metrics-table";
import { defaultHealthTableSettings } from "@/features/health/model/health-table-views";
import { HealthMetricsCreateDialog } from "@/features/health/ui/HealthMetricsCreateDialog";
import { HealthMetricsDetail } from "@/features/health/ui/HealthMetricsDetail";
import { HealthMetricsTable } from "@/features/health/ui/HealthMetricsTable";
import { HealthTableViewHeader } from "@/features/health/ui/HealthTableViewHeader";
import { useBrowserDetailHistory } from "@/features/workbench/hooks/useBrowserDetailHistory";
import { DestructiveConfirmationDialog } from "@/features/workbench/ui/DestructiveConfirmationDialog";

type HealthMetricsPanelProps = {
  controller: HealthController;
  tombstonedIds: ReadonlySet<string>;
  onArchiveCommitted(ids: readonly string[], refreshWarning?: string): void;
  refreshWarning: string | null;
  refreshPending: boolean;
  onRetryRefresh(): Promise<boolean>;
};

export function HealthMetricsPanel({
  controller, tombstonedIds, onArchiveCommitted, refreshWarning, refreshPending,
  onRetryRefresh,
}: HealthMetricsPanelProps) {
  const [selectedDates, setSelectedDates] = useState<string[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [detailRow, setDetailRow] = useState<HealthMetricsRow | null>(null);
  const [archiveTargets, setArchiveTargets] = useState<HealthMetricsRow[] | null>(null);
  const [archivePending, setArchivePending] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const archiveButtonRef = useRef<HTMLButtonElement>(null);
  const tableRef = useRef<HTMLElement>(null);
  const detailOriginRef = useRef<{ occurrence: string; date: string } | null>(null);
  const entries = useMemo(() => controller.state.metricsEntries.filter(({ deletedAt, id }) =>
    deletedAt === null && !tombstonedIds.has(id)), [controller.state.metricsEntries, tombstonedIds]);
  const settings = controller.tableSettings("health.metrics");
  const activeRows = useMemo(() => uniqueRows(deriveHealthMetricsGroups(
    entries, defaultHealthTableSettings("health.metrics")).flatMap(({ rows }) => rows)), [entries]);
  const groups = useMemo(() => deriveHealthMetricsGroups(entries, settings), [entries, settings]);
  const visibleRows = useMemo(() => uniqueRows(groups.flatMap(({ rows }) => rows)), [groups]);
  const selectedVisibleRows = visibleRows.filter(({ date }) => selectedDates.includes(date));
  const candidates = useMemo(() => deriveHealthMetricsGroups(entries, {
    ...defaultHealthTableSettings("health.metrics"),
    groupSettings: { ...settings.groupSettings, hideEmpty: false, manualOrder: [], hiddenGroupKeys: [] },
  }).filter(({ label }) => label !== null).map(({ key, label, rows }) => ({
    key, label: label!, count: uniqueRows(rows).length,
  })), [entries, settings.groupSettings]);
  const currentDetailRow = detailRow
    ? activeRows.find(({ date }) => date === detailRow.date) ?? null
    : null;
  const detailHistory = useBrowserDetailHistory({
    stateKey: "__ravenHealthMetricsDetailDate",
    currentId: currentDetailRow?.date ?? null,
    resolve: (date) => activeRows.find((row) => row.date === date) ?? null,
    open: (row) => {
      if (detailOriginRef.current?.date !== row.date) {
        detailOriginRef.current = { occurrence: "", date: row.date };
      }
      setDetailRow(row);
    },
    close: () => { setDetailRow(null); restoreDetailFocus(); },
    clearOnUnmount: true,
  });

  useEffect(() => {
    const activeDates = new Set(activeRows.map(({ date }) => date));
    setSelectedDates((current) => {
      const next = current.filter((date) => activeDates.has(date));
      return next.length === current.length ? current : next;
    });
    if (detailRow && !activeDates.has(detailRow.date)) {
      setDetailRow(null);
      restoreDetailFocus();
    }
  }, [activeRows]);

  function restoreDetailFocus() {
    requestAnimationFrame(() => {
      const origin = detailOriginRef.current;
      const exact = origin
        ? tableRef.current?.querySelector<HTMLElement>(`[data-health-metrics-occurrence="${origin.occurrence}"]`)
        : null;
      const sameDate = origin
        ? [...(tableRef.current?.querySelectorAll<HTMLElement>("[data-health-metrics-date]") ?? [])]
          .find((element) => element.dataset.healthMetricsDate === origin.date)
        : null;
      (exact ?? sameDate ?? addButtonRef.current)?.focus();
    });
  }

  function toggle(date: string) {
    setSelectedDates((current) => current.includes(date)
      ? current.filter((candidate) => candidate !== date) : [...current, date]);
  }
  function toggleAll() {
    const visibleDates = new Set(visibleRows.map(({ date }) => date));
    const allSelected = visibleRows.length > 0 && visibleRows.every(({ date }) => selectedDates.includes(date));
    setSelectedDates((current) => allSelected
      ? current.filter((date) => !visibleDates.has(date)) : [...new Set([...current, ...visibleDates])]);
  }
  function markArchived(row: HealthMetricsRow, warning?: string) {
    onArchiveCommitted(metricEvents(row).map(({ id }) => id), warning);
    setSelectedDates((current) => current.filter((date) => date !== row.date));
  }
  async function archiveSelected() {
    if (!archiveTargets || archivePending) return;
    setArchivePending(true);
    setArchiveError(null);
    let current: HealthMetricsRow | null = null;
    try {
      for (const row of archiveTargets) {
        current = row;
        await controller.saveMetrics({ metrics: [], archives: metricEvents(row)
          .map(({ id, updatedAt }) => ({ id, expectedUpdatedAt: updatedAt })) });
        markArchived(row);
      }
      setArchiveTargets(null);
      addButtonRef.current?.focus();
    } catch (error) {
      if (error instanceof HealthMutationRefreshError) {
        if (current) markArchived(current, error.message);
      } else {
        setArchiveError(error instanceof Error ? error.message : "Could not archive health metrics.");
      }
      setArchiveTargets(null);
      archiveButtonRef.current?.focus();
    } finally {
      setArchivePending(false);
    }
  }
  async function retryRefresh() {
    if (await onRetryRefresh()) addButtonRef.current?.focus();
  }

  const initial = controller.state.metricsEntries.length === 0;
  if (controller.state.metricsStatus === "loading" && initial) {
    return <p role="status" className="items-message">Loading health metrics…</p>;
  }
  if (controller.state.metricsStatus === "error" && initial) {
    return <section><h1>Health Metrics</h1><p role="alert" className="items-message">
      {controller.state.metricsError ?? "Health metrics are unavailable"}</p>
      <button type="button" onClick={() => void controller.refreshMetrics()}>Retry</button></section>;
  }

  if (currentDetailRow) {
    return <HealthMetricsDetail key={currentDetailRow.date} controller={controller}
      row={currentDetailRow} detailHistory={detailHistory}
      onSaved={(date) => { detailOriginRef.current = { occurrence: "", date }; }}
      onArchived={(warning) => {
        detailHistory.setDirty(false);
        detailHistory.requestBack();
        markArchived(currentDetailRow, warning);
      }} />;
  }

  return <section ref={tableRef} aria-labelledby="health-metrics-heading">
    <HealthTableViewHeader controller={controller} scope="health.metrics" title="Health Metrics"
      headingId="health-metrics-heading"
      fieldLabels={{ weight: "Weight", sleep: "Sleep", crp: "CRP",
        calprotectin: "Calprotectin", condition: "Condition" }} fieldOptions={{}}
      candidates={candidates} onAdd={() => setCreateOpen(true)} addButtonRef={addButtonRef}
      onArchiveSelected={() => { setArchiveError(null); setArchiveTargets([...selectedVisibleRows]); }}
      archiveButtonRef={archiveButtonRef}
      archiveDisabled={selectedVisibleRows.length === 0 || archivePending} />
    <HealthMetricsTable groups={groups} activeRowCount={activeRows.length}
      selectedDates={selectedDates} onOpen={(row, occurrence) => {
        detailOriginRef.current = { occurrence, date: row.date };
        setDetailRow(row);
      }} onToggle={toggle} onToggleAll={toggleAll} />
    {refreshWarning ? <div className="items-message"><p role="alert">{refreshWarning}</p>
      <button type="button" disabled={refreshPending} onClick={() => void retryRefresh()}>Retry</button></div>
      : controller.state.metricsError ? <p role="alert" className="items-message">
        {controller.state.metricsError}</p> : null}
    {archiveError && archiveTargets === null
      ? <p role="alert" className="items-message">{archiveError}</p> : null}
    {createOpen ? <HealthMetricsCreateDialog controller={controller} metricsEntries={entries}
      onClose={() => setCreateOpen(false)} returnFocusRef={addButtonRef} /> : null}
    {archiveTargets ? <DestructiveConfirmationDialog title="Archive selected health metrics?"
      description={`${archiveTargets.length} health metric dates will be archived and removed from Health views.`}
      confirmLabel="Archive" error={archiveError} disabled={archivePending}
      fallbackFocusRef={addButtonRef}
      onCancel={() => { setArchiveError(null); setArchiveTargets(null); }}
      onConfirm={archiveSelected} /> : null}
  </section>;
}

function uniqueRows(rows: readonly HealthMetricsRow[]): HealthMetricsRow[] {
  const dates = new Set<string>();
  return rows.filter(({ date }) => dates.has(date) ? false : (dates.add(date), true));
}

function metricEvents(row: HealthMetricsRow) {
  return (["weight", "sleep", "crp", "calprotectin", "condition"] as const)
    .flatMap((field) => row.events[field] ? [row.events[field]] : []);
}
