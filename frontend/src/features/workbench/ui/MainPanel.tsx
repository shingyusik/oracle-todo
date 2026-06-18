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
      <section className="panel-grid" aria-label={panel.overviewLabel}>
        {panel.summaryCards.map((summaryCard, index) => (
          <article
            className={
              index === 0 ? "summary-card" : "summary-card summary-card-accent"
            }
            key={summaryCard.label}
          >
            <span className="summary-card-label">{summaryCard.label}</span>
            <strong>{summaryCard.title}</strong>
            <p>{summaryCard.summary}</p>
          </article>
        ))}
      </section>
    </main>
  );
}
