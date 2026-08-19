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
  const [bowelTombstonedIds, setBowelTombstonedIds] = useState<Set<string>>(() => new Set());
  const [bowelRefreshWarning, setBowelRefreshWarning] = useState<string | null>(null);
  const [bowelRefreshPending, setBowelRefreshPending] = useState(false);
  const dietRecoveryBaselines = useRef(new Map<
    string,
    HealthController["state"]["dietEntries"]
  >());
  const bowelRecoveryBaselines = useRef(new Map<
    string,
    HealthController["state"]["bowelEntries"]
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

  useEffect(() => {
    if (controller.state.bowelStatus !== "loaded" || controller.state.bowelError !== null ||
      bowelRefreshPending || bowelRefreshWarning !== null || bowelTombstonedIds.size === 0) return;
    const activeIds = new Set(controller.state.bowelEntries
      .filter(({ deletedAt }) => deletedAt === null).map(({ id }) => id));
    const next = new Set<string>();
    for (const id of bowelTombstonedIds) {
      const baseline = bowelRecoveryBaselines.current.get(id);
      if (baseline === controller.state.bowelEntries) next.add(id);
      else {
        bowelRecoveryBaselines.current.delete(id);
        if (activeIds.has(id)) next.add(id);
      }
    }
    if (next.size !== bowelTombstonedIds.size) setBowelTombstonedIds(next);
  }, [controller.state.bowelEntries, controller.state.bowelError, controller.state.bowelStatus,
    bowelRefreshPending, bowelRefreshWarning, bowelTombstonedIds]);

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

  function bowelArchiveCommitted(id: string, refreshWarning?: string) {
    if (refreshWarning) {
      bowelRecoveryBaselines.current.set(id, controller.state.bowelEntries);
      setBowelRefreshWarning(refreshWarning);
    }
    setBowelTombstonedIds((current) => current.has(id) ? current : new Set(current).add(id));
  }

  async function retryBowelRefresh() {
    for (const id of bowelTombstonedIds) {
      bowelRecoveryBaselines.current.set(id, controller.state.bowelEntries);
    }
    setBowelRefreshPending(true);
    try {
      if (await controller.refreshBowel()) setBowelRefreshWarning(null);
    } finally {
      setBowelRefreshPending(false);
    }
  }

  const panel = leafTabId === "bowel"
    ? <BowelPanel controller={controller} tombstonedIds={bowelTombstonedIds}
        onArchiveCommitted={bowelArchiveCommitted} refreshWarning={bowelRefreshWarning}
        refreshPending={bowelRefreshPending} onRetryRefresh={retryBowelRefresh} />
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
