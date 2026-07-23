import React from "react";

import { workbenchCopy } from "@/design/copy";
import type { WorkbenchController } from "@/features/workbench/model/workbench-model";
import { MainPanel } from "@/features/workbench/ui/MainPanel";
import { PlannerTabConfirmationDialog } from "@/features/workbench/ui/PlannerTabConfirmationDialog";
import { TreeSidebar } from "@/features/workbench/ui/TreeSidebar";

type WorkbenchWireframeProps = {
  controller: WorkbenchController;
};

export function WorkbenchWireframe({ controller }: WorkbenchWireframeProps) {
  return (
    <div className="workbench-shell">
      <aside className="workbench-nav">
        <div className="workbench-logo">
          <img
            className="workbench-logo-image"
            src="/merovingian-mark.png"
            alt={workbenchCopy.logoAlt}
          />
          <div className="workbench-logo-copy">
            <span className="workbench-logo-wordmark">
              {workbenchCopy.logoWordmark}
            </span>
            <span className="workbench-logo-tagline">
              {workbenchCopy.logoTagline}
            </span>
          </div>
        </div>
        <TreeSidebar
          controller={controller}
          ariaLabel={workbenchCopy.navigation.shellLabel}
        />
      </aside>
      <MainPanel controller={controller} />
      <PlannerTabConfirmationDialog controller={controller} />
    </div>
  );
}
