"use client";

import React from "react";

import type { HealthController } from "@/features/health/hooks/useHealthController";
import { MetricsForm } from "@/features/health/ui/HealthForms";
import {
  HealthCollectionStatus,
  HealthRecordTable,
} from "@/features/health/ui/TimelinePanel";

const metricCategories = new Set(["weight", "sleep", "symptom", "lab"]);

export function HealthMetricsPanel({
  controller,
}: {
  controller: HealthController;
}) {
  const items = controller.state.timeline.filter(
    (item) =>
      item.kind === "health_event" && metricCategories.has(item.record.category),
  );
  return (
    <section aria-labelledby="health-metrics-heading">
      <header className="workspace-table-header">
        <h1 id="health-metrics-heading">Health Metrics</h1>
      </header>
      <MetricsForm controller={controller} />
      {(controller.state.timeline.length > 0
        || controller.state.timelineStatus === "loaded") && (
        <HealthRecordTable
          controller={controller}
          items={items}
          emptyMessage="No health metrics yet."
        />
      )}
      <HealthCollectionStatus controller={controller} label="health metrics" />
    </section>
  );
}
