import React from "react";
import { Plus, Trash2 } from "lucide-react";

import type { LeafTabId } from "@/domain/workbench/navigation";
import type {
  WorkbenchController,
  WorkspaceItemModel,
  WorkspaceItemsModel,
} from "@/features/workbench/model/workbench-model";

type MainPanelProps = {
  controller: WorkbenchController;
};

type ItemColumn = {
  label: string;
  value: (item: WorkspaceItemModel, workspaceItems: WorkspaceItemsModel) => string;
};

export function MainPanel({ controller }: MainPanelProps) {
  return (
    <main className="main-panel">
      <WorkspaceItemsTable controller={controller} />
    </main>
  );
}

function WorkspaceItemsTable({ controller }: MainPanelProps) {
  const { panel, workspaceItems } = controller;

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
      <div className="items-toolbar">
        <button
          className="items-toolbar-button"
          type="button"
          aria-label="Add item"
        >
          <Plus size={16} aria-hidden="true" />
        </button>
        <button
          className="items-toolbar-button"
          type="button"
          aria-label="Archive selected items"
          disabled={controller.selectedItemIds.length === 0}
          onClick={controller.requestArchiveSelected}
        >
          <Trash2 size={16} aria-hidden="true" />
        </button>
      </div>
      <table className="items-table" aria-label={`${panel.title} items`}>
        <thead>
          <tr>
            <th scope="col">
              <input
                type="checkbox"
                aria-label="Select all visible items"
                checked={
                  workspaceItems.items.length > 0 &&
                  workspaceItems.items.every((item) =>
                    controller.selectedItemIds.includes(item.id),
                  )
                }
                onChange={controller.toggleVisibleSelection}
              />
            </th>
            {columnsForPanel(panel.id).map((column) => (
              <th scope="col" key={column.label}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {workspaceItems.items.map((item) => (
            <tr key={item.id}>
              <td>
                <input
                  type="checkbox"
                  aria-label={`Select ${item.title}`}
                  checked={controller.selectedItemIds.includes(item.id)}
                  onClick={(event) => event.stopPropagation()}
                  onChange={() => controller.toggleItemSelection(item.id)}
                />
              </td>
              {columnsForPanel(panel.id).map((column) => (
                <td key={column.label}>{column.value(item, workspaceItems)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {controller.archiveConfirmationOpen ? (
        <div className="confirmation-backdrop">
          <section
            className="confirmation-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Archive selected items?"
          >
            <h2>Archive selected items?</h2>
            <p>
              {controller.selectedItemIds.length} items will be moved to archive.
              You can still find them in Archive.
            </p>
            <div className="dialog-actions">
              <button type="button" onClick={controller.cancelArchiveSelected}>
                Cancel
              </button>
              <button type="button" onClick={controller.confirmArchiveSelected}>
                Archive
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}

const sharedColumns: ItemColumn[] = [
  { label: "Title", value: (item) => item.title },
  { label: "Status", value: (item) => item.status },
];

const itemColumns: Partial<Record<LeafTabId, ItemColumn[]>> = {
  areas: [
    ...sharedColumns,
    { label: "Review Cycle", value: (item) => displayValue(item.review_cycle) },
    { label: "Standard", value: (item) => displayValue(item.standard) },
    { label: "Updated", value: (item) => formatDate(item.updated_at) },
  ],
  projects: [
    ...sharedColumns,
    { label: "Area", value: (item, items) => relatedTitle(items.relatedItems.areas, item.area_id) },
    {
      label: "Definition of Done",
      value: (item) => displayValue(item.definition_of_done),
    },
    { label: "Updated", value: (item) => formatDate(item.updated_at) },
  ],
  tasks: [
    ...sharedColumns,
    { label: "Area", value: (item, items) => relatedTitle(items.relatedItems.areas, item.area_id) },
    {
      label: "Project",
      value: (item, items) => relatedTitle(items.relatedItems.projects, item.project_id),
    },
    {
      label: "Routine",
      value: (item, items) => relatedTitle(items.relatedItems.routines, item.routine_id),
    },
    { label: "Updated", value: (item) => formatDate(item.updated_at) },
  ],
  routines: [
    ...sharedColumns,
    { label: "Area", value: (item, items) => relatedTitle(items.relatedItems.areas, item.area_id) },
    {
      label: "Recurrence Rule",
      value: (item) => displayValue(item.recurrence_rule),
    },
    {
      label: "Materialization Policy",
      value: (item) => displayValue(item.materialization_policy),
    },
    {
      label: "Last Materialized",
      value: (item) => formatDate(item.last_materialized_at),
    },
  ],
  events: [
    ...sharedColumns,
    { label: "Area", value: (item, items) => relatedTitle(items.relatedItems.areas, item.area_id) },
    { label: "Starts At", value: (item) => displayValue(item.scheduled) },
    { label: "Location", value: (item) => displayValue(item.metadata_?.location) },
    {
      label: "With",
      value: (item) => displayValue(item.metadata_?.participants?.join(", ")),
    },
    { label: "Updated", value: (item) => formatDate(item.updated_at) },
  ],
  goals: [
    ...sharedColumns,
    { label: "Horizon", value: (item) => displayValue(item.horizon) },
    { label: "Area", value: (item, items) => relatedTitle(items.relatedItems.areas, item.area_id) },
    { label: "Due", value: (item) => displayValue(item.due) },
    {
      label: "Parent",
      value: (item, items) => relatedTitle(items.relatedItems.goals, item.parent_id),
    },
    { label: "Updated", value: (item) => formatDate(item.updated_at) },
  ],
};

function columnsForPanel(panelId: LeafTabId): ItemColumn[] {
  return itemColumns[panelId] ?? [
    ...sharedColumns,
    { label: "Updated", value: (item) => formatDate(item.updated_at) },
  ];
}

function relatedTitle(
  titlesById: Record<string, string>,
  id: string | null | undefined,
): string {
  return id ? (titlesById[id] ?? id) : "-";
}

function displayValue(value: string | number | null | undefined): string {
  return value?.toString() || "-";
}

function formatDate(value: string | null | undefined): string {
  return value?.slice(0, 10) || "-";
}
