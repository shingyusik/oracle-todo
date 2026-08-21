"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

import {
  HealthMutationRefreshError,
  type HealthController,
} from "@/features/health/hooks/useHealthController";
import { deriveDietGroups, type DietRow } from "@/features/health/model/diet-table";
import type { HealthTableOccurrence } from "@/features/health/model/health-model";
import {
  defaultHealthTableSettings,
  healthDietFilterSelectOptions,
} from "@/features/health/model/health-table-views";
import { DietCreateDialog } from "@/features/health/ui/DietCreateDialog";
import { DietDetail } from "@/features/health/ui/DietDetail";
import { DietTable } from "@/features/health/ui/DietTable";
import { HealthTableViewHeader } from "@/features/health/ui/HealthTableViewHeader";
import { useBrowserDetailHistory } from "@/features/workbench/hooks/useBrowserDetailHistory";
import { DestructiveConfirmationDialog } from "@/features/workbench/ui/DestructiveConfirmationDialog";

type DietPanelProps = {
  controller: HealthController;
  tombstonedIds?: ReadonlySet<string>;
  onArchiveCommitted?: (id: string, refreshWarning?: string) => void;
  refreshWarning?: string | null;
  refreshPending?: boolean;
  onRetryRefresh?: () => Promise<void>;
};

const noDietTombstones: ReadonlySet<string> = new Set();

export function DietPanel({
  controller,
  tombstonedIds = noDietTombstones,
  onArchiveCommitted,
  refreshWarning = null,
  refreshPending = false,
  onRetryRefresh,
}: DietPanelProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [detailRow, setDetailRow] = useState<DietRow | null>(null);
  const [archiveTargets, setArchiveTargets] = useState<string[] | null>(null);
  const [archivePending, setArchivePending] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const archiveButtonRef = useRef<HTMLButtonElement>(null);
  const tableRef = useRef<HTMLElement>(null);
  const detailOriginRef = useRef<{ occurrence: string; rowId: string } | null>(null);
  const interactionTokenRef = useRef(0);

  useEffect(() => { void controller.ensureTable("health.diet"); }, [controller]);
  const page = controller.tablePage("health.diet");
  const activeViewId = controller.tableTabs("health.diet").activeTabId;
  useEffect(() => {
    interactionTokenRef.current += 1;
    return () => { interactionTokenRef.current += 1; };
  }, [activeViewId, page.generation]);

  const entries = useMemo(
    () => controller.state.dietEntries.filter(({ deletedAt, id }) =>
      deletedAt === null && !tombstonedIds.has(id)),
    [controller.state.dietEntries, tombstonedIds],
  );
  const groups = useMemo(() => dietOccurrenceGroups(page.items.filter(isDietOccurrence)
    .filter(({ record }) => !tombstonedIds.has(record.id))), [page.items, tombstonedIds]);
  const activeRows = useMemo(() => uniqueRows(deriveDietGroups(
    entries, defaultHealthTableSettings("health.diet")).flatMap(({ rows }) => rows)), [entries]);
  const candidates = useMemo(() => deriveDietGroups(entries, {
    ...defaultHealthTableSettings("health.diet"),
    groupSettings: {
      ...controller.tableSettings("health.diet").groupSettings,
      hideEmpty: false, manualOrder: [], hiddenGroupKeys: [],
    },
  }).filter(({ label }) => label !== null).map(({ key, label, rows }) => ({
    key, label: label!, count: rows.length,
  })), [controller, entries]);
  const visibleRows = useMemo(() => groups.flatMap(({ rows }) => rows), [groups]);
  const logicalVisibleRows = useMemo(() => uniqueRows(visibleRows), [visibleRows]);
  const selectedVisibleIds = useMemo(
    () => logicalVisibleRows.filter(({ id }) => selectedIds.includes(id)).map(({ id }) => id),
    [logicalVisibleRows, selectedIds],
  );
  const detailTags = useMemo(
    () => [...new Set(entries.flatMap(({ tags }) => tags))],
    [entries],
  );
  const currentDetailRow = detailRow ? resolveDietDetail(detailRow, entries) : null;
  const detailHistory = useBrowserDetailHistory({
    stateKey: "__ravenHealthDietDetailId",
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
        ? [...(tableRef.current?.querySelectorAll<HTMLElement>("[data-diet-occurrence]") ?? [])]
          .find((element) => element.dataset.dietOccurrence === origin.occurrence)
        : null;
      const target = exact ?? (origin
        ? [...(tableRef.current?.querySelectorAll<HTMLElement>("[data-diet-row-id]") ?? [])]
          .find((element) => element.dataset.dietRowId === origin.rowId)
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
    const visibleIds = new Set(logicalVisibleRows.map(({ id }) => id));
    const allSelected = logicalVisibleRows.length > 0 && logicalVisibleRows.every(({ id }) =>
      selectedIds.includes(id));
    setSelectedIds((current) => allSelected
      ? current.filter((id) => !visibleIds.has(id))
      : [...new Set([...current, ...visibleIds])]);
  }

  async function archiveSelected() {
    if (!archiveTargets || archivePending) return;
    setArchivePending(true);
    setArchiveError(null);
    let currentId: string | null = null;
    try {
      for (const id of archiveTargets) {
        currentId = id;
        await controller.archiveDiet(id);
        markArchived(id);
      }
      setArchiveTargets(null);
    } catch (error) {
      if (error instanceof HealthMutationRefreshError) {
        if (currentId) markArchived(currentId, error.message);
      } else {
        setArchiveError(error instanceof Error ? error.message : "Could not archive diet entries.");
      }
      setArchiveTargets(null);
    } finally {
      setArchivePending(false);
    }
  }

  function markArchived(id: string, warning?: string) {
    onArchiveCommitted?.(id, warning);
    setSelectedIds((current) => current.filter((candidate) => candidate !== id));
    setArchiveTargets((current) => current?.filter((candidate) => candidate !== id) ?? null);
  }

  async function retryRefresh() {
    if (onRetryRefresh) await onRetryRefresh();
    else await controller.refresh();
  }

  function openCreateAfterReferences() {
    const token = ++interactionTokenRef.current;
    void controller.ensureReferenceData("health.diet").then((ok) => {
      if (!ok || token !== interactionTokenRef.current) return;
      setDetailRow(null);
      setCreateOpen(true);
    });
  }

  function openDetailAfterReferences(row: DietRow, occurrence: string) {
    const token = ++interactionTokenRef.current;
    void controller.ensureReferenceData("health.diet").then((ok) => {
      if (!ok || token !== interactionTokenRef.current) return;
      setCreateOpen(false);
      detailOriginRef.current = { occurrence, rowId: row.id };
      setDetailRow(row);
    });
  }

  if (currentDetailRow) {
    return (
      <DietDetail
        key={currentDetailRow.id}
        controller={controller}
        row={currentDetailRow}
        tagOptions={detailTags}
        detailHistory={detailHistory}
        onArchived={(warning) => {
          detailHistory.setDirty(false);
          detailHistory.requestBack();
          markArchived(currentDetailRow.id, warning);
        }}
      />
    );
  }

  return (
    <section ref={tableRef} aria-labelledby="health-diet-heading">
      <HealthTableViewHeader
        controller={controller}
        scope="health.diet"
        title="Diet"
        headingId="health-diet-heading"
        fieldLabels={{ meal_type: "Meal", has_photo: "Photo" }}
        fieldOptions={{
          ...healthDietFilterSelectOptions,
          tags: detailTags.map((tag) => ({ value: tag, label: tag })),
        }}
        candidates={candidates}
        onAdd={openCreateAfterReferences}
        addButtonRef={addButtonRef}
        onArchiveSelected={() => {
          setArchiveError(null);
          setArchiveTargets(selectedVisibleIds);
        }}
        archiveButtonRef={archiveButtonRef}
        archiveDisabled={selectedVisibleIds.length === 0 || archivePending}
      />
      <DietTable
        groups={groups}
        activeRowCount={activeRows.length}
        selectedIds={selectedIds}
        onOpen={openDetailAfterReferences}
        onToggle={toggle}
        onToggleAll={toggleAll}
        page={page}
        onLoadMore={() => void controller.loadMore("health.diet")}
        emptyMessage={healthEmptyMessage(controller, page, "diet entries")}
      />
      {refreshWarning ? (
        <div className="items-message">
          <p role="alert">{refreshWarning}</p>
          <button type="button" disabled={refreshPending} onClick={() => void retryRefresh()}>
            Retry
          </button>
        </div>
      ) : controller.state.dietError && page.moreStatus !== "error" ? (
        <p role="alert" className="items-message">{controller.state.dietError}</p>
      ) : null}
      {archiveError && archiveTargets === null ? (
        <p role="alert" className="items-message">{archiveError}</p>
      ) : null}
      {createOpen ? (
        <DietCreateDialog
          controller={controller}
          onClose={() => setCreateOpen(false)}
          returnFocusRef={addButtonRef}
          tagOptions={detailTags}
        />
      ) : null}
      {archiveTargets ? (
        <DestructiveConfirmationDialog
          title="Archive selected diet entries?"
          description={`${archiveTargets.length} diet entries will be archived and removed from Health views.`}
          confirmLabel="Archive"
          error={archiveError}
          disabled={archivePending}
          fallbackFocusRef={addButtonRef}
          onCancel={() => {
            setArchiveError(null);
            setArchiveTargets(null);
          }}
          onConfirm={archiveSelected}
        />
      ) : null}
    </section>
  );
}

function isDietOccurrence(item: HealthTableOccurrence): item is Extract<HealthTableOccurrence, { scope: "health.diet" }> {
  return item.scope === "health.diet";
}

function dietOccurrenceGroups(items: Extract<HealthTableOccurrence, { scope: "health.diet" }>[]) {
  const groups = new Map<string, { key: string; label: string | null; rows: DietRow[] }>();
  for (const { key: occurrenceKey, groupKey, groupLabel, record } of items) {
    const key = groupKey ?? "all";
    const group = groups.get(key) ?? { key, label: groupLabel, rows: [] };
    const occurredAt = new Date(record.entry.occurredAt);
    group.rows.push({ ...record, mealType: record.entry.mealType,
      timeLabel: occurredAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      occurrenceKey } as DietRow & { occurrenceKey: string });
    groups.set(key, group);
  }
  return [...groups.values()];
}

function resolveDietDetail(fallback: DietRow, entries: readonly import("@/features/health/model/health-model").DietEntry[]): DietRow {
  const entry = entries.find(({ id, deletedAt }) => id === fallback.id && deletedAt === null);
  return entry ? deriveDietGroups([entry], defaultHealthTableSettings("health.diet"))[0]?.rows[0] ?? fallback : fallback;
}

function healthEmptyMessage(controller: HealthController, page: ReturnType<HealthController["tablePage"]>, noun: string): string {
  if (page.items.length === 0 && (page.generation === 0 || page.moreStatus === "loading")) return `Loading ${noun}\u2026`;
  const settings = controller.tableSettings("health.diet");
  return settings.filterRules.length > 0 || settings.groupSettings.hiddenGroupKeys.length > 0
    ? `No ${noun} match this view.` : `No ${noun} yet.`;
}

function uniqueRows(rows: readonly DietRow[]): DietRow[] {
  const ids = new Set<string>();
  return rows.filter(({ id }) => {
    if (ids.has(id)) return false;
    ids.add(id);
    return true;
  });
}
