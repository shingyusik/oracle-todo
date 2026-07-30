"use client";

import React from "react";

import type { HealthController } from "@/features/health/hooks/useHealthController";
import { DietForm } from "@/features/health/ui/HealthForms";
import {
  HealthCollectionStatus,
  HealthRecordTable,
} from "@/features/health/ui/TimelinePanel";

export function DietPanel({ controller }: { controller: HealthController }) {
  const items = controller.state.timeline.filter((item) => item.kind === "diet");
  return (
    <section aria-labelledby="health-diet-heading">
      <header className="workspace-table-header">
        <h1 id="health-diet-heading">Diet</h1>
      </header>
      <DietForm controller={controller} />
      {(controller.state.timeline.length > 0
        || controller.state.timelineStatus === "loaded") && (
        <HealthRecordTable
          controller={controller}
          items={items}
          emptyMessage="No diet entries yet."
        />
      )}
      <HealthCollectionStatus controller={controller} label="diet entries" />
    </section>
  );
}
