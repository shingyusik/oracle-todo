"use client";

import React, { useEffect, useRef, useState } from "react";

import type { HealthTabId } from "@/domain/workbench/navigation";
import type { HealthController } from "@/features/health/hooks/useHealthController";
import { BowelPanel } from "@/features/health/ui/BowelPanel";
import { DietPanel } from "@/features/health/ui/DietPanel";
import { HealthMetricsPanel } from "@/features/health/ui/HealthMetricsPanel";
import { HealthTrendsPanel } from "@/features/health/ui/HealthTrendsPanel";
import { MedicationPanel } from "@/features/health/ui/MedicationPanel";
import { TableViewTabConfirmationDialog } from "@/features/workbench/ui/TableViewTabConfirmationDialog";

export function HealthPanel({
  controller,
  leafTabId = "diet",
}: {
  controller: HealthController;
  leafTabId?: HealthTabId;
}) {
  const [dietTombstonedIds, setDietTombstonedIds] = useState<Set<string>>(() => new Set());
  const [dietRefreshWarning, setDietRefreshWarning] = useState<string | null>(null);
  const [dietRefreshPending, setDietRefreshPending] = useState(false);
  const dietRecoveryBaselines = useRef(new Map<
    string,
    HealthController["state"]["dietEntries"]
  >());

  useEffect(() => {
    if (
      controller.state.dietStatus !== "loaded" ||
      controller.state.dietError !== null ||
      dietRefreshPending ||
      dietRefreshWarning !== null ||
      dietTombstonedIds.size === 0
    ) return;
    const activeIds = new Set(controller.state.dietEntries
      .filter(({ deletedAt }) => deletedAt === null)
      .map(({ id }) => id));
    const next = new Set<string>();
    for (const id of dietTombstonedIds) {
      const baseline = dietRecoveryBaselines.current.get(id);
      if (baseline === controller.state.dietEntries) {
        next.add(id);
        continue;
      }
      dietRecoveryBaselines.current.delete(id);
      if (activeIds.has(id)) next.add(id);
    }
    if (next.size !== dietTombstonedIds.size) setDietTombstonedIds(next);
  }, [
    controller.state.dietEntries,
    controller.state.dietError,
    controller.state.dietStatus,
    dietRefreshPending,
    dietRefreshWarning,
    dietTombstonedIds,
  ]);

  function archiveCommitted(id: string, refreshWarning?: string) {
    if (refreshWarning) {
      dietRecoveryBaselines.current.set(id, controller.state.dietEntries);
      setDietRefreshWarning(refreshWarning);
    }
    setDietTombstonedIds((current) => current.has(id)
      ? current
      : new Set(current).add(id));
  }

  async function retryDietRefresh() {
    for (const id of dietTombstonedIds) {
      dietRecoveryBaselines.current.set(id, controller.state.dietEntries);
    }
    setDietRefreshPending(true);
    try {
      if (await controller.refresh()) setDietRefreshWarning(null);
    } finally {
      setDietRefreshPending(false);
    }
  }

  const panel = leafTabId === "bowel"
    ? <BowelPanel controller={controller} />
    : leafTabId === "medication"
      ? <MedicationPanel controller={controller} />
      : leafTabId === "health-metrics"
        ? <HealthMetricsPanel controller={controller} />
        : leafTabId === "trends"
          ? <HealthTrendsPanel controller={controller} />
          : (
      <DietPanel
        controller={controller}
        tombstonedIds={dietTombstonedIds}
        onArchiveCommitted={archiveCommitted}
        refreshWarning={dietRefreshWarning}
        refreshPending={dietRefreshPending}
        onRetryRefresh={retryDietRefresh}
      />
    );

  return (
    <>
      {panel}
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
