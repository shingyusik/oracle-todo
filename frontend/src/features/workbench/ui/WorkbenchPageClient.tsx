"use client";

import React from "react";

import { useWorkbenchController } from "@/features/workbench/hooks/useWorkbenchController";
import { WorkbenchWireframe } from "@/features/workbench/ui/WorkbenchWireframe";

export function WorkbenchPageClient() {
  const controller = useWorkbenchController();

  return <WorkbenchWireframe controller={controller} />;
}
