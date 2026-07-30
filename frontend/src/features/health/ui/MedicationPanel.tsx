"use client";

import React from "react";

import type { HealthController } from "@/features/health/hooks/useHealthController";
import { MedicationForm } from "@/features/health/ui/HealthForms";
import {
  HealthCollectionStatus,
  HealthRecordTable,
} from "@/features/health/ui/TimelinePanel";

export function MedicationPanel({ controller }: { controller: HealthController }) {
  const items = controller.state.timeline.filter(
    (item) => item.kind === "health_event" && item.record.category === "medication",
  );
  return (
    <section aria-labelledby="health-medication-heading">
      <header className="workspace-table-header">
        <h1 id="health-medication-heading">Medication</h1>
      </header>
      <MedicationForm controller={controller} />
      {(controller.state.timeline.length > 0
        || controller.state.timelineStatus === "loaded") && (
        <HealthRecordTable
          controller={controller}
          items={items}
          emptyMessage="No medication entries yet."
        />
      )}
      <HealthCollectionStatus controller={controller} label="medication entries" />
    </section>
  );
}
