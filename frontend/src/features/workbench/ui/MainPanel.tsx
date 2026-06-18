import React from "react";

import type { WorkbenchPanelModel } from "@/features/workbench/model/workbench-model";

type MainPanelProps = {
  panel: WorkbenchPanelModel;
};

export function MainPanel({ panel }: MainPanelProps) {
  return (
    <main className="main-panel">
      <section className="panel-hero" aria-labelledby="panel-title">
        <p className="panel-eyebrow">{panel.eyebrow}</p>
        <h1 id="panel-title">{panel.title}</h1>
        <p className="panel-summary">{panel.summary}</p>
      </section>
      <section className="panel-grid" aria-label={`${panel.title} overview`}>
        <article className="summary-card">
          <span className="summary-card-label">Focus</span>
          <strong>{panel.title}</strong>
          <p>{panel.summary}</p>
        </article>
        <article className="summary-card summary-card-accent">
          <span className="summary-card-label">Status</span>
          <strong>Ready</strong>
          <p>This static shell is prepared for service-backed data.</p>
        </article>
      </section>
    </main>
  );
}
