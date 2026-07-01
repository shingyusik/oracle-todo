import React, { useEffect, useRef } from "react";
import { Plus, Trash2 } from "lucide-react";

import type { LeafTabId } from "@/domain/workbench/navigation";
import type {
  WorkbenchController,
  WorkspaceItemModel,
  WorkspaceItemsModel,
  WorkspaceItemPatch,
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
  const [draft, setDraft] = React.useState(() => detailDraftForItem(item));

  React.useEffect(() => {
    setDraft(detailDraftForItem(item));
  }, [item]);

  if (!item) {
    return null;
  }

  function setField(field: keyof DetailDraft, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
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
          <input
            value={draft.title}
            onChange={(event) => setField("title", event.target.value)}
          />
        </label>
        <DetailTypeFields
          item={item}
          draft={draft}
          setField={setField}
          workspaceItems={controller.workspaceItems}
        />
        <div className="property-row">
          <span>Status</span>
          <span>{item.status}</span>
        </div>
        <div className="property-row">
          <span>Type</span>
          <span>{item.type}</span>
        </div>
        <div className="property-row">
          <span>Created</span>
          <span>{formatDate(item.created_at)}</span>
        </div>
        <div className="property-row">
          <span>Updated</span>
          <span>{formatDate(item.updated_at)}</span>
        </div>
      </div>
      <div className="detail-actions">
        <button
          type="button"
          onClick={() => void controller.saveDetailItem(detailPatchForItem(item, draft))}
        >
          Save
        </button>
      </div>
    </section>
  );
}

type DetailDraft = {
  title: string;
  description: string;
  note: string;
  outcome: string;
  horizon: string;
  parent_id: string;
  definition_of_done: string;
  review_cycle: string;
  standard: string;
  recurrence_rule: string;
  materialization_policy: string;
  location: string;
  participants: string;
  commitment_type: string;
  due: string;
  scheduled: string;
  priority: string;
};

type StringWorkspaceItemPatchField = {
  [Key in keyof WorkspaceItemPatch]: WorkspaceItemPatch[Key] extends string | undefined
    ? Key
    : never;
}[keyof WorkspaceItemPatch] & string;

function detailDraftForItem(item: WorkspaceItemModel | null): DetailDraft {
  return {
    title: item?.title ?? "",
    description: itemDescription(item) ?? "",
    note: item?.note ?? "",
    outcome: item?.outcome ?? "",
    horizon: item?.horizon ?? "month",
    parent_id: item?.parent_id ?? "",
    definition_of_done: item?.definition_of_done ?? "",
    review_cycle: item?.review_cycle ?? "",
    standard: item?.standard ?? "",
    recurrence_rule: item?.recurrence_rule ?? "",
    materialization_policy: item?.materialization_policy ?? "single_open",
    location: item?.metadata_?.location ?? "",
    participants: item?.metadata_?.participants?.join(", ") ?? "",
    commitment_type: item?.metadata_?.commitment_type ?? "",
    due: item?.due ?? "",
    scheduled:
      item?.type === "event"
        ? formatDateTimeLocalValue(item.scheduled)
        : formatDateValue(item?.scheduled),
    priority: item?.priority?.toString() ?? "",
  };
}

function detailPatchForItem(
  item: WorkspaceItemModel,
  draft: DetailDraft,
): WorkspaceItemPatch {
  const patch: WorkspaceItemPatch = {
    title: draft.title,
    note: draft.note,
  };

  addStringPatch(patch, "description", draft.description, itemDescription(item));

  if (item.type === "project") {
    addStringPatch(patch, "outcome", draft.outcome, item.outcome);
    addStringPatch(
      patch,
      "definition_of_done",
      draft.definition_of_done,
      item.definition_of_done,
    );
    addStringPatch(patch, "due", draft.due, item.due);
  }
  if (item.type === "routine") {
    addStringPatch(
      patch,
      "recurrence_rule",
      draft.recurrence_rule,
      item.recurrence_rule,
    );
    addStringPatch(
      patch,
      "materialization_policy",
      draft.materialization_policy,
      item.materialization_policy,
    );
  }
  if (item.type === "task") {
    addStringPatch(patch, "due", draft.due, item.due);
    addStringPatch(patch, "scheduled", draft.scheduled, item.scheduled);
    addPriorityPatch(patch, draft.priority);
  }
  if (item.type === "event") {
    addStringPatch(
      patch,
      "scheduled",
      formatDateTimeCommitValue(draft.scheduled),
      item.scheduled,
    );
    addStringPatch(patch, "due", draft.due, item.due);
    addPriorityPatch(patch, draft.priority);
    addStringPatch(patch, "location", draft.location, item.metadata_?.location);
    patch.participants = draft.participants
      .split(",")
      .map((participant) => participant.trim())
      .filter(Boolean);
    addStringPatch(
      patch,
      "commitment_type",
      draft.commitment_type,
      item.metadata_?.commitment_type,
    );
  }
  if (item.type === "area") {
    addStringPatch(patch, "review_cycle", draft.review_cycle, item.review_cycle);
    addStringPatch(patch, "standard", draft.standard, item.standard);
  }
  if (item.type === "goal") {
    addStringPatch(patch, "horizon", draft.horizon, item.horizon);
    addStringPatch(patch, "scheduled", draft.scheduled, item.scheduled);
    addStringPatch(patch, "due", draft.due, item.due);
    addStringPatch(patch, "parent_id", draft.parent_id, item.parent_id);
  }

  return patch;
}

function addStringPatch(
  patch: WorkspaceItemPatch,
  field: StringWorkspaceItemPatchField,
  value: string,
  currentValue: string | null | undefined,
) {
  if (currentValue != null || value !== "") {
    patch[field] = value;
  }
}

function addPriorityPatch(patch: WorkspaceItemPatch, priority: string) {
  if (priority.trim() !== "") {
    patch.priority = Number(priority);
  }
}

function itemDescription(item: WorkspaceItemModel | null | undefined): string | null | undefined {
  return (item as WorkspaceItemModel & { description?: string | null } | null | undefined)
    ?.description;
}

function DetailTypeFields({
  item,
  draft,
  setField,
  workspaceItems,
}: {
  item: WorkspaceItemModel;
  draft: DetailDraft;
  setField: (field: keyof DetailDraft, value: string) => void;
  workspaceItems: WorkspaceItemsModel;
}) {
  if (item.type === "project") {
    return (
      <>
        <div className="property-row">
          <span>Area</span>
          <span>{relatedTitle(workspaceItems.relatedItems.areas, item.area_id)}</span>
        </div>
        <DetailTextField
          label="Definition of Done"
          value={draft.definition_of_done}
          onChange={(value) => setField("definition_of_done", value)}
        />
        <DetailTextField
          label="Due"
          type="date"
          value={draft.due}
          onChange={(value) => setField("due", value)}
        />
        <DetailTextField
          label="Outcome"
          value={draft.outcome}
          onChange={(value) => setField("outcome", value)}
        />
        <DetailTextAreaField
          label="Note"
          value={draft.note}
          onChange={(value) => setField("note", value)}
        />
      </>
    );
  }
  if (item.type === "routine") {
    return (
      <>
        <div className="property-row">
          <span>Area</span>
          <span>{relatedTitle(workspaceItems.relatedItems.areas, item.area_id)}</span>
        </div>
        <DetailTextField
          label="Recurrence Rule"
          value={draft.recurrence_rule}
          onChange={(value) => setField("recurrence_rule", value)}
        />
        <label className="field-label">
          Materialization Policy
          <select
            value={draft.materialization_policy}
            onChange={(event) => setField("materialization_policy", event.target.value)}
          >
            <option value="single_open">single_open</option>
            <option value="per_occurrence">per_occurrence</option>
          </select>
        </label>
        <DetailTextAreaField
          label="Note"
          value={draft.note}
          onChange={(value) => setField("note", value)}
        />
      </>
    );
  }
  if (item.type === "task") {
    return (
      <>
        <div className="property-row">
          <span>Area</span>
          <span>{relatedTitle(workspaceItems.relatedItems.areas, item.area_id)}</span>
        </div>
        <div className="property-row">
          <span>Project</span>
          <span>{relatedTitle(workspaceItems.relatedItems.projects, item.project_id)}</span>
        </div>
        <div className="property-row">
          <span>Routine</span>
          <span>{relatedTitle(workspaceItems.relatedItems.routines, item.routine_id)}</span>
        </div>
        <DetailTextAreaField
          label="Description"
          value={draft.description}
          onChange={(value) => setField("description", value)}
        />
        <DetailTextField
          label="Due"
          type="date"
          value={draft.due}
          onChange={(value) => setField("due", value)}
        />
        <DetailTextField
          label="Scheduled"
          type="date"
          value={draft.scheduled}
          onChange={(value) => setField("scheduled", value)}
        />
        <DetailTextField
          label="Priority"
          type="number"
          value={draft.priority}
          onChange={(value) => setField("priority", value)}
        />
        <DetailTextAreaField
          label="Note"
          value={draft.note}
          onChange={(value) => setField("note", value)}
        />
      </>
    );
  }
  if (item.type === "event") {
    return (
      <>
        <div className="property-row">
          <span>Area</span>
          <span>{relatedTitle(workspaceItems.relatedItems.areas, item.area_id)}</span>
        </div>
        <div className="property-row">
          <span>Project</span>
          <span>{relatedTitle(workspaceItems.relatedItems.projects, item.project_id)}</span>
        </div>
        <DetailTextAreaField
          label="Description"
          value={draft.description}
          onChange={(value) => setField("description", value)}
        />
        <DetailTextField
          label="Starts At"
          type="datetime-local"
          value={draft.scheduled}
          onChange={(value) => setField("scheduled", value)}
        />
        <DetailTextField
          label="Due"
          type="date"
          value={draft.due}
          onChange={(value) => setField("due", value)}
        />
        <DetailTextField
          label="Priority"
          type="number"
          value={draft.priority}
          onChange={(value) => setField("priority", value)}
        />
        <DetailTextField
          label="Location"
          value={draft.location}
          onChange={(value) => setField("location", value)}
        />
        <DetailTextField
          label="Participants"
          value={draft.participants}
          onChange={(value) => setField("participants", value)}
        />
        <DetailTextField
          label="Commitment Type"
          value={draft.commitment_type}
          onChange={(value) => setField("commitment_type", value)}
        />
        <DetailTextAreaField
          label="Note"
          value={draft.note}
          onChange={(value) => setField("note", value)}
        />
      </>
    );
  }
  if (item.type === "area") {
    return (
      <>
        <DetailTextField
          label="Review Cycle"
          value={draft.review_cycle}
          onChange={(value) => setField("review_cycle", value)}
        />
        <DetailTextField
          label="Standard"
          value={draft.standard}
          onChange={(value) => setField("standard", value)}
        />
        <DetailTextAreaField
          label="Note"
          value={draft.note}
          onChange={(value) => setField("note", value)}
        />
      </>
    );
  }
  if (item.type === "goal") {
    return (
      <>
        <label className="field-label">
          Horizon
          <select value={draft.horizon} onChange={(event) => setField("horizon", event.target.value)}>
            <option value="week">week</option>
            <option value="month">month</option>
            <option value="year">year</option>
          </select>
        </label>
        <DetailTextField
          label="Scheduled"
          type="date"
          value={draft.scheduled}
          onChange={(value) => setField("scheduled", value)}
        />
        <DetailTextField
          label="Due"
          type="date"
          value={draft.due}
          onChange={(value) => setField("due", value)}
        />
        <label className="field-label">
          Parent
          <select value={draft.parent_id} onChange={(event) => setField("parent_id", event.target.value)}>
            <option value="">-</option>
            {Object.entries(workspaceItems.relatedItems.goals).map(([id, title]) => (
              <option key={id} value={id}>
                {title}
              </option>
            ))}
          </select>
        </label>
        <DetailTextAreaField
          label="Note"
          value={draft.note}
          onChange={(value) => setField("note", value)}
        />
      </>
    );
  }

  return null;
}

function DetailTextField({
  label,
  type = "text",
  value,
  onChange,
}: {
  label: string;
  type?: "text" | "date" | "datetime-local" | "number";
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="field-label">
      {label}
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function DetailTextAreaField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="field-label">
      {label}
      <textarea value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
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
  type?: "text" | "date" | "datetime-local";
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

function InlineSelect({
  label,
  value,
  options,
  onCommit,
}: {
  label: string;
  value: string | null | undefined;
  options: string[];
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

        if (nextValue === selectedValue) {
          return;
        }

        onCommit(nextValue);
      }}
    >
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
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
  const supportedStatuses = statusOptionsForItem(item);

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
      {supportedStatuses.map((status) => (
        <option key={status} value={status}>
          {status}
        </option>
      ))}
    </select>
  );
}

function statusOptionsForItem(item: WorkspaceItemModel): string[] {
  const options = [item.status];
  const canRun = item.type !== "area";
  const canActivate =
    canRun &&
    (item.type !== "project" || hasText(item.definition_of_done)) &&
    (item.type !== "routine" || hasText(item.recurrence_rule));

  if (item.status === "proposed") {
    options.push("approved");
  }
  if (item.status === "approved" && canActivate) {
    options.push("active");
  }
  if (item.status === "paused" && canActivate) {
    options.push("active");
  }
  if (item.status === "active" && canRun) {
    options.push("paused", "completed");
  }

  return options;
}

function hasText(value: string | null | undefined): boolean {
  return Boolean(value?.trim());
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

function areaColumn(): ItemColumn {
  return {
    label: "Area",
    value: (item, items, controller) => (
      <InlineRelationSelect
        label={`Area for ${item.title}`}
        value={item.area_id}
        options={items.relatedItems.areas}
        onCommit={(area) => void controller.patchWorkspaceItem(item.id, { area })}
      />
    ),
  };
}

function projectColumn(): ItemColumn {
  return {
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
  };
}

function routineColumn(): ItemColumn {
  return {
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
  };
}

function dueColumn(): ItemColumn {
  return {
    label: "Due",
    value: (item, _items, controller) => (
      <InlineTextInput
        label={`Due for ${item.title}`}
        type="date"
        value={item.due ?? ""}
        onCommit={(due) => void controller.patchWorkspaceItem(item.id, { due })}
      />
    ),
  };
}

function scheduledDateColumn(): ItemColumn {
  return {
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
  };
}

function startsAtColumn(): ItemColumn {
  return {
    label: "Starts At",
    value: (item, _items, controller) => (
      <InlineTextInput
        label={`Starts At for ${item.title}`}
        type="datetime-local"
        value={formatDateTimeLocalValue(item.scheduled)}
        onCommit={(scheduled) =>
          void controller.patchWorkspaceItem(item.id, {
            scheduled: formatDateTimeCommitValue(scheduled),
          })
        }
      />
    ),
  };
}

function priorityColumn(): ItemColumn {
  return {
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
  };
}

function horizonColumn(): ItemColumn {
  return {
    label: "Horizon",
    value: (item, _items, controller) => (
      <InlineSelect
        label={`Horizon for ${item.title}`}
        value={item.horizon}
        options={["week", "month", "year"]}
        onCommit={(horizon) => void controller.patchWorkspaceItem(item.id, { horizon })}
      />
    ),
  };
}

function parentGoalColumn(): ItemColumn {
  return {
    label: "Parent",
    value: (item, items, controller) => (
      <InlineRelationSelect
        label={`Parent for ${item.title}`}
        value={item.parent_id}
        options={items.relatedItems.goals}
        onCommit={(parent_id) =>
          void controller.patchWorkspaceItem(item.id, { parent_id })
        }
      />
    ),
  };
}

function locationColumn(): ItemColumn {
  return {
    label: "Location",
    value: (item, _items, controller) => (
      <InlineTextInput
        label={`Location for ${item.title}`}
        value={item.metadata_?.location ?? ""}
        onCommit={(location) =>
          void controller.patchWorkspaceItem(item.id, { location })
        }
      />
    ),
  };
}

function commitmentTypeColumn(): ItemColumn {
  return {
    label: "Commitment Type",
    value: (item, _items, controller) => (
      <InlineTextInput
        label={`Commitment Type for ${item.title}`}
        value={item.metadata_?.commitment_type ?? ""}
        onCommit={(commitment_type) =>
          void controller.patchWorkspaceItem(item.id, { commitment_type })
        }
      />
    ),
  };
}

const itemColumns: Partial<Record<LeafTabId, ItemColumn[]>> = {
  areas: [
    ...sharedColumns,
    {
      label: "Review Cycle",
      value: (item, _items, controller) => (
        <InlineTextInput
          label={`Review Cycle for ${item.title}`}
          value={item.review_cycle ?? ""}
          onCommit={(review_cycle) =>
            void controller.patchWorkspaceItem(item.id, { review_cycle })
          }
        />
      ),
    },
    { label: "Standard", value: (item) => displayValue(item.standard) },
    { label: "Note", value: (item) => displayValue(item.note) },
    { label: "Created", value: (item) => formatDate(item.created_at) },
    { label: "Updated", value: (item) => formatDate(item.updated_at) },
  ],
  projects: [
    ...sharedColumns,
    areaColumn(),
    dueColumn(),
    { label: "Outcome", value: (item) => displayValue(item.outcome) },
    { label: "Definition of Done", value: (item) => displayValue(item.definition_of_done) },
    { label: "Note", value: (item) => displayValue(item.note) },
    { label: "Created", value: (item) => formatDate(item.created_at) },
    { label: "Updated", value: (item) => formatDate(item.updated_at) },
  ],
  tasks: [
    ...sharedColumns,
    areaColumn(),
    projectColumn(),
    routineColumn(),
    scheduledDateColumn(),
    dueColumn(),
    priorityColumn(),
    { label: "Description", value: (item) => displayValue(itemDescription(item)) },
    { label: "Note", value: (item) => displayValue(item.note) },
    { label: "Created", value: (item) => formatDate(item.created_at) },
    { label: "Updated", value: (item) => formatDate(item.updated_at) },
  ],
  routines: [
    ...sharedColumns,
    areaColumn(),
    { label: "Recurrence Rule", value: (item) => displayValue(item.recurrence_rule) },
    {
      label: "Materialization Policy",
      value: (item, _items, controller) => (
        <InlineSelect
          label={`Materialization Policy for ${item.title}`}
          value={item.materialization_policy}
          options={["single_open", "per_occurrence"]}
          onCommit={(materialization_policy) =>
            void controller.patchWorkspaceItem(item.id, { materialization_policy })
          }
        />
      ),
    },
    { label: "Note", value: (item) => displayValue(item.note) },
    {
      label: "Last Materialized",
      value: (item) => formatDate(item.last_materialized_at),
    },
    { label: "Created", value: (item) => formatDate(item.created_at) },
    { label: "Updated", value: (item) => formatDate(item.updated_at) },
  ],
  events: [
    ...sharedColumns,
    areaColumn(),
    projectColumn(),
    startsAtColumn(),
    dueColumn(),
    priorityColumn(),
    { label: "Description", value: (item) => displayValue(itemDescription(item)) },
    { label: "Note", value: (item) => displayValue(item.note) },
    locationColumn(),
    {
      label: "Participants",
      value: (item) => displayValue(item.metadata_?.participants?.join(", ")),
    },
    commitmentTypeColumn(),
    { label: "Created", value: (item) => formatDate(item.created_at) },
    { label: "Updated", value: (item) => formatDate(item.updated_at) },
  ],
  goals: [
    ...sharedColumns,
    horizonColumn(),
    scheduledDateColumn(),
    dueColumn(),
    parentGoalColumn(),
    { label: "Note", value: (item) => displayValue(item.note) },
    { label: "Created", value: (item) => formatDate(item.created_at) },
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

function formatDateTimeLocalValue(value: string | null | undefined): string {
  const match = value?.trim().match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);

  return match ? `${match[1]}T${match[2]}` : "";
}

function formatDateTimeCommitValue(value: string): string {
  const match = value.trim().match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::(\d{2}))?/);

  return match ? `${match[1]}T${match[2]}:${match[3] ?? "00"}Z` : value;
}

function formatDate(value: string | null | undefined): string {
  return value?.slice(0, 10) || "-";
}
