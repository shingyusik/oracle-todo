import React, { useEffect, useRef } from "react";
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
  value: (
    item: WorkspaceItemModel,
    workspaceItems: WorkspaceItemsModel,
    controller: WorkbenchController,
  ) => React.ReactNode;
};

export function MainPanel({ controller }: MainPanelProps) {
  if (controller.detailItem) {
    return (
      <main className="main-panel">
        <DetailView controller={controller} />
      </main>
    );
  }

  return (
    <main className="main-panel">
      <WorkspaceItemsTable controller={controller} />
    </main>
  );
}

function DetailView({ controller }: MainPanelProps) {
  const item = controller.detailItem;
  const [title, setTitle] = React.useState(item?.title ?? "");
  const [note, setNote] = React.useState(item?.note ?? "");

  React.useEffect(() => {
    setTitle(item?.title ?? "");
    setNote(item?.note ?? "");
  }, [item]);

  if (!item) {
    return null;
  }

  return (
    <section className="detail-view" aria-label={`${item.title} details`}>
      <button type="button" className="detail-back" onClick={controller.closeDetailView}>
        {"< Back"}
      </button>
      <h1>{item.title}</h1>
      <div className="detail-properties">
        <h2>Properties</h2>
        <label className="field-label">
          Title
          <input value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <div className="property-row">
          <span>Status</span>
          <span>{item.status}</span>
        </div>
        <div className="property-row">
          <span>Type</span>
          <span>{item.type}</span>
        </div>
        <div className="property-row">
          <span>Updated</span>
          <span>{formatDate(item.updated_at)}</span>
        </div>
      </div>
      <label className="field-label detail-note">
        Note
        <textarea value={note} onChange={(event) => setNote(event.target.value)} />
      </label>
      <div className="detail-actions">
        <button type="button" onClick={() => void controller.saveDetailItem({ title, note })}>
          Save
        </button>
      </div>
    </section>
  );
}

function WorkspaceItemsTable({ controller }: MainPanelProps) {
  const { panel, workspaceItems } = controller;
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);
  const archiveButtonRef = useRef<HTMLButtonElement | null>(null);
  const selectAllCheckboxRef = useRef<HTMLInputElement | null>(null);

  const visibleSelectionCount = workspaceItems.items.reduce(
    (count, item) => count + Number(controller.selectedItemIds.includes(item.id)),
    0,
  );
  const allVisibleSelected =
    workspaceItems.items.length > 0 &&
    visibleSelectionCount === workspaceItems.items.length;
  const partiallySelected =
    visibleSelectionCount > 0 && visibleSelectionCount < workspaceItems.items.length;

  useEffect(() => {
    if (selectAllCheckboxRef.current) {
      selectAllCheckboxRef.current.indeterminate = partiallySelected;
    }
  }, [partiallySelected]);

  useEffect(() => {
    if (controller.archiveConfirmationOpen) {
      cancelButtonRef.current?.focus();
    }
  }, [controller.archiveConfirmationOpen]);

  function handleDialogKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      controller.cancelArchiveSelected();
      return;
    }

    if (event.key !== "Tab") {
      return;
    }

    const activeElement = document.activeElement;
    const isCancelFocused = activeElement === cancelButtonRef.current;
    const isArchiveFocused = activeElement === archiveButtonRef.current;

    if (event.shiftKey && isCancelFocused) {
      event.preventDefault();
      archiveButtonRef.current?.focus();
    } else if (!event.shiftKey && isArchiveFocused) {
      event.preventDefault();
      cancelButtonRef.current?.focus();
    }
  }

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

  return (
    <section className="items-section">
      <div className="items-toolbar">
        <button
          className="items-toolbar-button"
          type="button"
          aria-label="Add item"
          onClick={controller.openCreationDialog}
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
      {workspaceItems.items.length === 0 ? (
        <p className="items-message">No {panel.title.toLowerCase()} found.</p>
      ) : (
        <table className="items-table" aria-label={`${panel.title} items`}>
          <thead>
            <tr>
              <th scope="col">
                <input
                  ref={selectAllCheckboxRef}
                  type="checkbox"
                  aria-label="Select all visible items"
                  checked={allVisibleSelected}
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
              <tr
                key={item.id}
                role="button"
                tabIndex={0}
                aria-label={`Open details for ${item.title}`}
                onClick={() => controller.openDetailView(item)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " " || event.key === "Space") {
                    event.preventDefault();
                    controller.openDetailView(item);
                  }
                }}
              >
                <td>
                  <input
                    type="checkbox"
                    aria-label={`Select ${item.title}`}
                    checked={controller.selectedItemIds.includes(item.id)}
                    onKeyDown={(event) => event.stopPropagation()}
                    onClick={(event) => event.stopPropagation()}
                    onChange={() => controller.toggleItemSelection(item.id)}
                  />
                </td>
                {columnsForPanel(panel.id).map((column) => (
                  <td key={column.label}>{column.value(item, workspaceItems, controller)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {controller.archiveConfirmationOpen ? (
        <div className="confirmation-backdrop">
          <section
            className="confirmation-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Archive selected items?"
            onKeyDown={handleDialogKeyDown}
          >
            <h2>Archive selected items?</h2>
            <p>
              {controller.selectedItemIds.length} items will be moved to archive.
              You can still find them in Archive.
            </p>
            <div className="dialog-actions">
              <button
                ref={cancelButtonRef}
                type="button"
                onClick={controller.cancelArchiveSelected}
              >
                Cancel
              </button>
              <button
                ref={archiveButtonRef}
                type="button"
                onClick={controller.confirmArchiveSelected}
              >
                Archive
              </button>
            </div>
          </section>
        </div>
      ) : null}
      {controller.creationDialogOpen ? (
        <CreationDialog
          controller={controller}
        />
      ) : null}
    </section>
  );
}

type CreationDialogProps = {
  controller: WorkbenchController;
};

function CreationDialog({ controller }: CreationDialogProps) {
  const [title, setTitle] = React.useState("");
  const [scheduled, setScheduled] = React.useState("");
  const [horizon, setHorizon] = React.useState("month");
  const formRef = useRef<HTMLFormElement | null>(null);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const isGoal = controller.panel.id === "goals";
  const needsScheduled =
    controller.panel.id === "events" || isGoal;
  const needsHorizon = isGoal;

  useEffect(() => {
    titleInputRef.current?.focus();
  }, []);

  function handleKeyDown(event: React.KeyboardEvent<HTMLFormElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      controller.closeCreationDialog();
      return;
    }

    if (event.key !== "Tab" || !formRef.current) {
      return;
    }

    const focusables = Array.from(
      formRef.current.querySelectorAll<HTMLElement>(
        'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
    const activeIndex = focusables.indexOf(document.activeElement as HTMLElement);

    if (!event.shiftKey && activeIndex === focusables.length - 1) {
      event.preventDefault();
      focusables[0]?.focus();
    } else if (event.shiftKey && activeIndex === 0) {
      event.preventDefault();
      focusables[focusables.length - 1]?.focus();
    }
  }

  return (
    <div className="confirmation-backdrop">
      <form
        ref={formRef}
        className="confirmation-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`Create ${controller.panel.title} item`}
        onKeyDown={handleKeyDown}
        onSubmit={(event) => {
          event.preventDefault();
          void controller.createWorkspaceItem({ title, scheduled, horizon });
        }}
      >
        <h2>Create {controller.panel.title} item</h2>
        <label className="field-label">
          Title
          <input
            ref={titleInputRef}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
          />
        </label>
        {needsScheduled ? (
          <label className="field-label">
            Scheduled
            <input
              type="date"
              value={scheduled}
              onChange={(event) => setScheduled(event.target.value)}
              required={needsScheduled}
            />
          </label>
        ) : null}
        {needsHorizon ? (
          <label className="field-label">
            Horizon
            <select
              value={horizon}
              onChange={(event) => setHorizon(event.target.value)}
            >
              <option value="week">week</option>
              <option value="month">month</option>
              <option value="year">year</option>
            </select>
          </label>
        ) : null}
        <div className="dialog-actions">
          <button type="button" onClick={controller.closeCreationDialog}>
            Cancel
          </button>
          <button type="submit">Create</button>
        </div>
      </form>
    </div>
  );
}

function stopRowEvent(event: React.SyntheticEvent<HTMLElement>) {
  event.stopPropagation();
}

function InlineTextInput({
  label,
  type = "text",
  value,
  onCommit,
}: {
  label: string;
  type?: "text" | "date";
  value: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = React.useState(value);

  React.useEffect(() => {
    setDraft(value);
  }, [value]);

  return (
    <input
      className="inline-cell-control"
      type={type}
      aria-label={label}
      value={draft}
      onClick={stopRowEvent}
      onKeyDown={stopRowEvent}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft !== value) {
          onCommit(draft);
        }
      }}
    />
  );
}

function InlineNumberInput({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number | null | undefined;
  onCommit: (value: number) => void;
}) {
  const currentValue = value?.toString() ?? "";
  const [draft, setDraft] = React.useState(currentValue);

  React.useEffect(() => {
    setDraft(currentValue);
  }, [currentValue]);

  return (
    <input
      className="inline-cell-control inline-cell-number"
      type="number"
      aria-label={label}
      value={draft}
      onClick={stopRowEvent}
      onKeyDown={stopRowEvent}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft === currentValue || draft.trim() === "") {
          return;
        }

        onCommit(Number(draft));
      }}
    />
  );
}

function InlineRelationSelect({
  label,
  value,
  options,
  onCommit,
}: {
  label: string;
  value: string | null | undefined;
  options: Record<string, string>;
  onCommit: (value: string) => void;
}) {
  const selectedValue = value ?? "";

  return (
    <select
      className="inline-cell-control"
      aria-label={label}
      value={selectedValue}
      onClick={stopRowEvent}
      onKeyDown={stopRowEvent}
      onChange={(event) => {
        const nextValue = event.target.value;

        if (!nextValue || nextValue === selectedValue) {
          return;
        }

        onCommit(nextValue);
      }}
    >
      <option value="" disabled>
        -
      </option>
      {Object.entries(options).map(([id, title]) => (
        <option key={id} value={id}>
          {title}
        </option>
      ))}
    </select>
  );
}

function StatusSelect({
  item,
  controller,
}: {
  item: WorkspaceItemModel;
  controller: WorkbenchController;
}) {
  const supportedStatuses = ["approved", "active", "paused", "completed"];

  return (
    <select
      className="inline-cell-control"
      aria-label={`Status for ${item.title}`}
      value={item.status}
      onClick={stopRowEvent}
      onKeyDown={stopRowEvent}
      onChange={(event) => {
        const status = event.target.value;

        if (status === item.status) {
          return;
        }
        if (status === "approved") {
          void controller.transitionWorkspaceItem(item.id, "approve");
        }
        if (status === "active") {
          void controller.transitionWorkspaceItem(
            item.id,
            item.status === "paused" ? "resume" : "activate",
          );
        }
        if (status === "paused") {
          void controller.transitionWorkspaceItem(item.id, "pause");
        }
        if (status === "completed") {
          void controller.transitionWorkspaceItem(item.id, "complete");
        }
      }}
    >
      {!supportedStatuses.includes(item.status) ? (
        <option value={item.status}>{item.status}</option>
      ) : null}
      <option value="approved">approved</option>
      <option value="active">active</option>
      <option value="paused">paused</option>
      <option value="completed">completed</option>
    </select>
  );
}

const sharedColumns: ItemColumn[] = [
  { label: "Title", value: (item) => item.title },
  {
    label: "Status",
    value: (item, _items, controller) => (
      <StatusSelect item={item} controller={controller} />
    ),
  },
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
    {
      label: "Area",
      value: (item, items, controller) => (
        <InlineRelationSelect
          label={`Area for ${item.title}`}
          value={item.area_id}
          options={items.relatedItems.areas}
          onCommit={(area) => void controller.patchWorkspaceItem(item.id, { area })}
        />
      ),
    },
    {
      label: "Definition of Done",
      value: (item) => displayValue(item.definition_of_done),
    },
    { label: "Updated", value: (item) => formatDate(item.updated_at) },
  ],
  tasks: [
    ...sharedColumns,
    {
      label: "Area",
      value: (item, items, controller) => (
        <InlineRelationSelect
          label={`Area for ${item.title}`}
          value={item.area_id}
          options={items.relatedItems.areas}
          onCommit={(area) => void controller.patchWorkspaceItem(item.id, { area })}
        />
      ),
    },
    {
      label: "Project",
      value: (item, items, controller) => (
        <InlineRelationSelect
          label={`Project for ${item.title}`}
          value={item.project_id}
          options={items.relatedItems.projects}
          onCommit={(project_id) =>
            void controller.patchWorkspaceItem(item.id, { project_id })
          }
        />
      ),
    },
    {
      label: "Routine",
      value: (item, items, controller) => (
        <InlineRelationSelect
          label={`Routine for ${item.title}`}
          value={item.routine_id}
          options={items.relatedItems.routines}
          onCommit={(routine_id) =>
            void controller.patchWorkspaceItem(item.id, { routine_id })
          }
        />
      ),
    },
    {
      label: "Due",
      value: (item, _items, controller) => (
        <InlineTextInput
          label={`Due for ${item.title}`}
          type="date"
          value={item.due ?? ""}
          onCommit={(due) => void controller.patchWorkspaceItem(item.id, { due })}
        />
      ),
    },
    {
      label: "Scheduled",
      value: (item, _items, controller) => (
        <InlineTextInput
          label={`Scheduled for ${item.title}`}
          type="date"
          value={formatDateValue(item.scheduled)}
          onCommit={(scheduled) =>
            void controller.patchWorkspaceItem(item.id, { scheduled })
          }
        />
      ),
    },
    {
      label: "Priority",
      value: (item, _items, controller) => (
        <InlineNumberInput
          label={`Priority for ${item.title}`}
          value={item.priority}
          onCommit={(priority) =>
            void controller.patchWorkspaceItem(item.id, { priority })
          }
        />
      ),
    },
    { label: "Updated", value: (item) => formatDate(item.updated_at) },
  ],
  routines: [
    ...sharedColumns,
    {
      label: "Area",
      value: (item, items, controller) => (
        <InlineRelationSelect
          label={`Area for ${item.title}`}
          value={item.area_id}
          options={items.relatedItems.areas}
          onCommit={(area) => void controller.patchWorkspaceItem(item.id, { area })}
        />
      ),
    },
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
    {
      label: "Area",
      value: (item, items, controller) => (
        <InlineRelationSelect
          label={`Area for ${item.title}`}
          value={item.area_id}
          options={items.relatedItems.areas}
          onCommit={(area) => void controller.patchWorkspaceItem(item.id, { area })}
        />
      ),
    },
    {
      label: "Starts At",
      value: (item, _items, controller) => (
        <InlineTextInput
          label={`Scheduled for ${item.title}`}
          type="date"
          value={formatDateValue(item.scheduled)}
          onCommit={(scheduled) =>
            void controller.patchWorkspaceItem(item.id, { scheduled })
          }
        />
      ),
    },
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
    {
      label: "Area",
      value: (item, items, controller) => (
        <InlineRelationSelect
          label={`Area for ${item.title}`}
          value={item.area_id}
          options={items.relatedItems.areas}
          onCommit={(area) => void controller.patchWorkspaceItem(item.id, { area })}
        />
      ),
    },
    {
      label: "Scheduled",
      value: (item, _items, controller) => (
        <InlineTextInput
          label={`Scheduled for ${item.title}`}
          type="date"
          value={formatDateValue(item.scheduled)}
          onCommit={(scheduled) =>
            void controller.patchWorkspaceItem(item.id, { scheduled })
          }
        />
      ),
    },
    {
      label: "Due",
      value: (item, _items, controller) => (
        <InlineTextInput
          label={`Due for ${item.title}`}
          type="date"
          value={item.due ?? ""}
          onCommit={(due) => void controller.patchWorkspaceItem(item.id, { due })}
        />
      ),
    },
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

function formatDateValue(value: string | null | undefined): string {
  return value?.slice(0, 10) || "";
}

function formatDate(value: string | null | undefined): string {
  return value?.slice(0, 10) || "-";
}
