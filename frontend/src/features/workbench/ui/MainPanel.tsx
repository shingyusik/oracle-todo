import React from "react";

import type {
  WorkbenchPanelModel,
  WorkspaceItemModel,
  WorkspaceItemsModel,
} from "@/features/workbench/model/workbench-model";

type MainPanelProps = {
  panel: WorkbenchPanelModel;
  workspaceItems: WorkspaceItemsModel;
};

export function MainPanel({ panel, workspaceItems }: MainPanelProps) {
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
      <WorkspaceItemsTable panel={panel} workspaceItems={workspaceItems} />
    </main>
  );
}

function WorkspaceItemsTable({ panel, workspaceItems }: MainPanelProps) {
  if (workspaceItems.status === "idle") {
    return null;
  }

  if (workspaceItems.status === "loading") {
    return (
      <section className="items-section" aria-label={`${panel.title} items`}>
        <p className="items-message" role="status">
          Loading {panel.title.toLowerCase()}...
        </p>
      </section>
    );
  }

  if (workspaceItems.status === "error") {
    return (
      <section className="items-section" aria-label={`${panel.title} items`}>
        <p className="items-message" role="alert">
          Could not load todo-engine items.
        </p>
      </section>
    );
  }

  if (workspaceItems.items.length === 0) {
    return (
      <section className="items-section" aria-label={`${panel.title} items`}>
        <p className="items-message">No {panel.title.toLowerCase()} found.</p>
      </section>
    );
  }

  return (
    <section className="items-section">
      <table className="items-table" aria-label={`${panel.title} items`}>
        <thead>
          <tr>
            <th scope="col">Title</th>
            <th scope="col">Status</th>
            <th scope="col">Detail</th>
            <th scope="col">Updated</th>
          </tr>
        </thead>
        <tbody>
          {workspaceItems.items.map((item) => (
            <tr key={item.id}>
              <td>{item.title}</td>
              <td>{item.status}</td>
              <td>{itemDetail(item)}</td>
              <td>{formatDate(item.updated_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function itemDetail(item: WorkspaceItemModel): string {
  return (
    item.review_cycle ??
    item.standard ??
    item.outcome ??
    item.recurrence_rule ??
    item.scheduled ??
    item.due ??
    item.priority?.toString() ??
    "-"
  );
}

function formatDate(value: string | null | undefined): string {
  return value?.slice(0, 10) || "-";
}
