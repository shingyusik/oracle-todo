"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

import type { HealthController } from "@/features/health/hooks/useHealthController";
import { deriveDietGroups, type DietRow } from "@/features/health/model/diet-table";
import { defaultHealthTableSettings } from "@/features/health/model/health-table-views";
import { DietCreateDialog } from "@/features/health/ui/DietCreateDialog";
import { DietTable } from "@/features/health/ui/DietTable";
import { HealthTableViewHeader } from "@/features/health/ui/HealthTableViewHeader";
import { DestructiveConfirmationDialog } from "@/features/workbench/ui/DestructiveConfirmationDialog";

export function DietPanel({ controller }: { controller: HealthController }) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [tombstones, setTombstones] = useState<Set<string>>(() => new Set());
  const [createOpen, setCreateOpen] = useState(false);
  const [detailRow, setDetailRow] = useState<DietRow | null>(null);
  const [archiveTargets, setArchiveTargets] = useState<string[] | null>(null);
  const [archivePending, setArchivePending] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const archiveButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (controller.state.dietStatus === "idle") void controller.refreshDiet();
  }, [controller]);

  const entries = useMemo(
    () => controller.state.dietEntries.filter(({ deletedAt, id }) =>
      deletedAt === null && !tombstones.has(id)),
    [controller.state.dietEntries, tombstones],
  );
  const activeGroups = useMemo(
    () => deriveDietGroups(entries, defaultHealthTableSettings("health.diet")),
    [entries],
  );
  const activeRows = useMemo(
    () => activeGroups.flatMap(({ rows }) => rows),
    [activeGroups],
  );
  const groups = useMemo(
    () => deriveDietGroups(entries, controller.tableSettings("health.diet")),
    [controller, entries],
  );
  const visibleRows = useMemo(() => groups.flatMap(({ rows }) => rows), [groups]);
  const selectedVisibleIds = useMemo(
    () => visibleRows.filter(({ id }) => selectedIds.includes(id)).map(({ id }) => id),
    [selectedIds, visibleRows],
  );

  useEffect(() => {
    const activeIds = new Set(activeRows.map(({ id }) => id));
    setSelectedIds((current) => {
      const next = current.filter((id) => activeIds.has(id));
      return next.length === current.length ? current : next;
    });
    if (detailRow && !activeIds.has(detailRow.id)) setDetailRow(null);
  }, [activeRows, detailRow]);

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

  async function archiveSelected() {
    if (!archiveTargets || archivePending) return;
    setArchivePending(true);
    setArchiveError(null);
    try {
      for (const id of archiveTargets) {
        await controller.archiveDiet(id);
        setTombstones((current) => new Set(current).add(id));
        setSelectedIds((current) => current.filter((candidate) => candidate !== id));
        setArchiveTargets((current) => current?.filter((candidate) => candidate !== id) ?? null);
      }
      setArchiveTargets(null);
    } catch (error) {
      setArchiveError(error instanceof Error ? error.message : "Could not archive diet entries.");
      setArchiveTargets(null);
    } finally {
      setArchivePending(false);
    }
  }

  const initial = controller.state.dietEntries.length === 0;
  if (controller.state.dietStatus === "loading" && initial) {
    return <p role="status" className="items-message">Loading diet entries…</p>;
  }
  if (controller.state.dietStatus === "error" && initial) {
    return <section>
      <h1>Diet</h1>
      <p role="alert" className="items-message">
        {controller.state.dietError ?? "Diet entries are unavailable"}
      </p>
      <button type="button" onClick={() => void controller.refreshDiet()}>Retry</button>
    </section>;
  }

  return (
    <section aria-labelledby="health-diet-heading">
      <HealthTableViewHeader
        controller={controller}
        entries={entries}
        onAdd={() => setCreateOpen(true)}
        addButtonRef={addButtonRef}
        onArchiveSelected={() => {
          setArchiveError(null);
          setArchiveTargets(selectedVisibleIds);
        }}
        archiveButtonRef={archiveButtonRef}
        archiveDisabled={selectedVisibleIds.length === 0 || archivePending}
      />
      {detailRow ? <p aria-live="polite"><span>Diet entry details</span>: {detailRow.food}</p> : null}
      <DietTable
        groups={groups}
        activeRowCount={activeRows.length}
        selectedIds={selectedIds}
        onOpen={setDetailRow}
        onToggle={toggle}
        onToggleAll={toggleAll}
      />
      {controller.state.dietError ? (
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
          tagOptions={[...new Set(entries.flatMap(({ tags }) => tags))]}
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
