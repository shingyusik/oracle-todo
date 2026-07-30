"use client";

import React from "react";

import type { HealthTabId } from "@/domain/workbench/navigation";
import type { HealthController } from "@/features/health/hooks/useHealthController";
import { BowelPanel } from "@/features/health/ui/BowelPanel";
import { DietPanel } from "@/features/health/ui/DietPanel";
import { HealthMetricsPanel } from "@/features/health/ui/HealthMetricsPanel";
import { HealthTrendsPanel } from "@/features/health/ui/HealthTrendsPanel";
import { MedicationPanel } from "@/features/health/ui/MedicationPanel";
import { TimelinePanel } from "@/features/health/ui/TimelinePanel";

export function HealthPanel({
  controller,
  leafTabId = "timeline",
}: {
  controller: HealthController;
  leafTabId?: HealthTabId;
}) {
  if (leafTabId === "diet") return <DietPanel controller={controller} />;
  if (leafTabId === "bowel") return <BowelPanel controller={controller} />;
  if (leafTabId === "medication") return <MedicationPanel controller={controller} />;
  if (leafTabId === "health-metrics") {
    return <HealthMetricsPanel controller={controller} />;
  }
  if (leafTabId === "trends") return <HealthTrendsPanel controller={controller} />;
  return <TimelinePanel controller={controller} />;
}
