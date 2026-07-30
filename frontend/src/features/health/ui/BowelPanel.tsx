"use client";

import React from "react";

import type { HealthController } from "@/features/health/hooks/useHealthController";
import { BowelForm } from "@/features/health/ui/HealthForms";
import {
  HealthCollectionStatus,
  HealthRecordTable,
} from "@/features/health/ui/TimelinePanel";

export function BowelPanel({ controller }: { controller: HealthController }) {
  const items = controller.state.timeline.filter(
    (item) => item.kind === "health_event" && item.record.category === "bowel",
  );
  return (
    <section aria-labelledby="health-bowel-heading">
      <header className="workspace-table-header">
        <h1 id="health-bowel-heading">Bowel</h1>
      </header>
      <BowelForm controller={controller} />
      {(controller.state.timeline.length > 0
        || controller.state.timelineStatus === "loaded") && (
        <HealthRecordTable
          controller={controller}
          items={items}
          emptyMessage="No bowel entries yet."
        />
      )}
      <HealthCollectionStatus controller={controller} label="bowel entries" />
    </section>
  );
}
