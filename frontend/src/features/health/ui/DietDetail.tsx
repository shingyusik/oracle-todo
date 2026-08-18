"use client";

import React, { useEffect, useReducer, useRef, useState } from "react";
import { ArrowLeft, Redo2, Save, Trash2, Undo2 } from "lucide-react";

import {
  HealthMutationRefreshError,
  type HealthController,
} from "@/features/health/hooks/useHealthController";
import type { DietUpdate, MealType } from "@/features/health/model/health-model";
import type { DietRow } from "@/features/health/model/diet-table";
import { DestructiveConfirmationDialog } from "@/features/workbench/ui/DestructiveConfirmationDialog";
import { TagsInput } from "@/features/workbench/ui/TagsInput";

type DietDetailProps = {
  controller: HealthController;
  row: DietRow;
  tagOptions: readonly string[];
  onBack(): void;
  onArchived(refreshWarning?: string): void;
};

type DietDraft = {
  occurredAt: string;
  mealType: MealType;
  foodName: string;
  tags: string[];
  note: string;
  newImage: File | null;
  removeImage: boolean;
};

type DraftHistory = {
  past: DietDraft[];
  present: DietDraft;
  future: DietDraft[];
  coalescingGroup: keyof DietDraft | null;
};

type DraftAction =
  | { type: "change"; name: keyof DietDraft; value: DietDraft[keyof DietDraft]; coalesce?: boolean }
  | { type: "image"; newImage: File | null; removeImage: boolean }
  | { type: "undo" | "redo" | "close-group" };

const mealTypes: Array<{ value: MealType; label: string }> = [
  { value: "breakfast", label: "Breakfast" },
  { value: "lunch", label: "Lunch" },
  { value: "dinner", label: "Dinner" },
  { value: "snack", label: "Snack" },
  { value: "late_night", label: "Late night" },
];

export function DietDetail({
  controller,
  row,
  tagOptions,
  onBack,
  onArchived,
}: DietDetailProps) {
  const initialDraft = dietDraft(row);
  const [history, dispatch] = useReducer(historyReducer, initialDraft, (present) => ({
    past: [],
    present,
    future: [],
    coalescingGroup: null,
  }));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshRecovery, setRefreshRecovery] = useState(false);
  const [confirmation, setConfirmation] = useState<"back" | "archive" | null>(null);
  const backButtonRef = useRef<HTMLButtonElement>(null);
  const deleteButtonRef = useRef<HTMLButtonElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const draft = history.present;
  const dirty = !sameDraft(draft, initialDraft);
  const readOnly = pending || refreshRecovery;

  function change<Name extends keyof DietDraft>(
    name: Name,
    value: DietDraft[Name],
    coalesce = false,
  ) {
    dispatch({ type: "change", name, value, coalesce });
  }

  function back() {
    if (pending || refreshRecovery) return;
    if (dirty) setConfirmation("back");
    else onBack();
  }

  async function save() {
    if (pending || refreshRecovery || !dirty) return;
    dispatch({ type: "close-group" });
    setPending(true);
    setError(null);
    try {
      await controller.updateDiet(
        row.id,
        dietPatch(initialDraft, draft, row),
        draft.newImage ?? undefined,
      );
      onBack();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save diet entry");
      if (cause instanceof HealthMutationRefreshError) setRefreshRecovery(true);
    } finally {
      setPending(false);
    }
  }

  async function retryRefresh() {
    if (pending) return;
    setPending(true);
    try {
      if (await controller.refresh()) onBack();
    } finally {
      setPending(false);
    }
  }

  async function archive() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await controller.archiveDiet(row.id);
      onArchived();
    } catch (cause) {
      if (cause instanceof HealthMutationRefreshError) {
        onArchived(cause.message);
      } else {
        setError(cause instanceof Error ? cause.message : "Could not archive diet entry");
      }
    } finally {
      setPending(false);
    }
  }

  useEffect(() => {
    if (!draft.newImage && imageInputRef.current) imageInputRef.current.value = "";
  }, [draft.newImage]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (
        event.isComposing || pending || refreshRecovery || confirmation ||
        !(event.ctrlKey || event.metaKey)
      ) return;
      const key = event.key.toLowerCase();
      if (key === "s") {
        event.preventDefault();
        void save();
      } else if (key === "z" && event.shiftKey) {
        event.preventDefault();
        dispatch({ type: "redo" });
      } else if (key === "z") {
        event.preventDefault();
        dispatch({ type: "undo" });
      } else if (key === "y" && event.ctrlKey && !event.metaKey && !event.shiftKey) {
        event.preventDefault();
        dispatch({ type: "redo" });
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  return (
    <section className="detail-view" aria-label={`${row.food} details`}>
      <header className="detail-header">
        <button ref={backButtonRef} type="button" className="detail-back" aria-label="< Back" onClick={back}>
          <ArrowLeft size={16} aria-hidden="true" />
        </button>
        <div className="detail-actions">
          <button type="button" aria-label="Undo" title="Undo (Ctrl/Cmd+Z)" disabled={pending || refreshRecovery || history.past.length === 0} onClick={() => dispatch({ type: "undo" })}>
            <Undo2 size={16} aria-hidden="true" />
          </button>
          <button type="button" aria-label="Redo" title="Redo (Ctrl/Cmd+Shift+Z or Ctrl+Y)" disabled={pending || refreshRecovery || history.future.length === 0} onClick={() => dispatch({ type: "redo" })}>
            <Redo2 size={16} aria-hidden="true" />
          </button>
          <button type="button" aria-label="Save" title="Save (Ctrl/Cmd+S)" disabled={pending || refreshRecovery || !dirty} onClick={() => void save()}>
            <Save size={16} aria-hidden="true" />
          </button>
          <button ref={deleteButtonRef} type="button" aria-label="Delete" title="Delete" disabled={pending || refreshRecovery} onClick={() => {
            setError(null);
            setConfirmation("archive");
          }}>
            <Trash2 size={16} aria-hidden="true" />
          </button>
        </div>
      </header>
      <div className="detail-layout">
        <div className="detail-heading">
          <div className="detail-kicker"><span>Diet entry details</span></div>
          <h1>{draft.foodName}</h1>
          <p>Created {formatTimestamp(row.entry.createdAt)}</p>
          <p>Updated {formatTimestamp(row.entry.updatedAt)}</p>
        </div>
        {error ? <p role="alert" className="form-error">{error}</p> : null}
        {refreshRecovery ? (
          <button type="button" disabled={pending} onClick={() => void retryRefresh()}>Retry</button>
        ) : null}
        <section
          className="detail-properties-list"
          aria-label="Edit diet properties"
          onBlurCapture={() => dispatch({ type: "close-group" })}
        >
          <label className="field-label">
            Time
            <input type="datetime-local" required disabled={readOnly} value={draft.occurredAt} onChange={(event) => change("occurredAt", event.target.value)} />
          </label>
          <label className="field-label">
            Meal
            <select disabled={readOnly} value={draft.mealType} onChange={(event) => change("mealType", event.target.value as MealType)}>
              {mealTypes.map((meal) => <option key={meal.value} value={meal.value}>{meal.label}</option>)}
            </select>
          </label>
          <label className="field-label">
            Food
            <input required maxLength={120} disabled={readOnly} value={draft.foodName} onChange={(event) => change("foodName", event.target.value, true)} />
          </label>
          <div className="field-label">
            Tags
            {readOnly
              ? draft.tags.map((tag) => <span className="tag-chip" key={tag}>{tag}</span>)
              : <TagsInput label="Tags" value={draft.tags} tagOptions={tagOptions} onCommit={(tags) => change("tags", tags)} />}
          </div>
          <label className="field-label">
            Photo
            <input
              ref={imageInputRef}
              type="file"
              aria-label="Photo"
              accept="image/*"
              disabled={readOnly}
              onChange={(event) => {
                const image = event.target.files?.[0] ?? null;
                if (image && !image.type.startsWith("image/")) {
                  setError("Meal image must be an image file");
                  event.target.value = "";
                  return;
                }
                setError(null);
                if (image) dispatch({ type: "image", newImage: image, removeImage: false });
              }}
            />
            {draft.newImage ? (
              <><span>{draft.newImage.name}</span><button type="button" disabled={readOnly} onClick={() => dispatch({ type: "image", newImage: null, removeImage: false })}>Remove selected photo</button></>
            ) : row.entry.mediaId && draft.removeImage ? (
              <><span>Photo will be removed</span><button type="button" disabled={readOnly} onClick={() => dispatch({ type: "image", newImage: null, removeImage: false })}>Keep photo</button></>
            ) : row.entry.mediaId ? (
              <><span>Current photo</span><button type="button" disabled={readOnly} onClick={() => dispatch({ type: "image", newImage: null, removeImage: true })}>Remove photo</button></>
            ) : <span>No photo</span>}
          </label>
          <label className="field-label">
            Note
            <textarea disabled={readOnly} value={draft.note} onChange={(event) => change("note", event.target.value, true)} />
          </label>
        </section>
      </div>
      {confirmation === "back" ? (
        <DestructiveConfirmationDialog
          title="Discard unsaved changes?"
          description="Your changes will be lost if you leave this detail."
          confirmLabel="Discard changes"
          fallbackFocusRef={backButtonRef}
          onCancel={() => setConfirmation(null)}
          onConfirm={async () => onBack()}
        />
      ) : null}
      {confirmation === "archive" ? (
        <DestructiveConfirmationDialog
          title={`Archive ${draft.foodName}?`}
          description={dirty
            ? "Move this diet entry to Archive? Unsaved changes will be discarded."
            : "Move this diet entry to Archive?"}
          confirmLabel="Archive"
          error={error}
          disabled={pending}
          fallbackFocusRef={deleteButtonRef}
          onCancel={() => {
            setError(null);
            setConfirmation(null);
          }}
          onConfirm={archive}
        />
      ) : null}
    </section>
  );
}

function historyReducer(state: DraftHistory, action: DraftAction): DraftHistory {
  if (action.type === "close-group") return { ...state, coalescingGroup: null };
  if (action.type === "undo") {
    const present = state.past.at(-1);
    return present
      ? { past: state.past.slice(0, -1), present, future: [state.present, ...state.future], coalescingGroup: null }
      : state;
  }
  if (action.type === "redo") {
    const [present, ...future] = state.future;
    return present
      ? { past: [...state.past, state.present], present, future, coalescingGroup: null }
      : state;
  }
  if (action.type === "image") {
    if (state.present.newImage === action.newImage && state.present.removeImage === action.removeImage) return state;
    return {
      past: [...state.past, state.present],
      present: { ...state.present, newImage: action.newImage, removeImage: action.removeImage },
      future: [],
      coalescingGroup: null,
    };
  }
  if (action.type !== "change") return state;
  if (sameValue(state.present[action.name], action.value)) return state;
  const present = { ...state.present, [action.name]: action.value } as DietDraft;
  return action.coalesce && state.coalescingGroup === action.name
    ? { ...state, present, future: [] }
    : {
        past: [...state.past, state.present],
        present,
        future: [],
        coalescingGroup: action.coalesce ? action.name : null,
      };
}

function dietDraft(row: DietRow): DietDraft {
  const occurredAt = new Date(row.entry.occurredAt);
  const local = new Date(occurredAt.getTime() - occurredAt.getTimezoneOffset() * 60_000);
  return {
    occurredAt: local.toISOString().slice(0, 16),
    mealType: row.entry.mealType,
    foodName: row.entry.foodName,
    tags: [...row.entry.tags],
    note: row.entry.note ?? "",
    newImage: null,
    removeImage: false,
  };
}

function sameDraft(left: DietDraft, right: DietDraft): boolean {
  return left.occurredAt === right.occurredAt &&
    left.mealType === right.mealType &&
    left.foodName === right.foodName &&
    sameValue(left.tags, right.tags) &&
    left.note === right.note &&
    left.newImage === right.newImage &&
    left.removeImage === right.removeImage;
}

function sameValue(left: DietDraft[keyof DietDraft], right: DietDraft[keyof DietDraft]): boolean {
  return Array.isArray(left) && Array.isArray(right)
    ? left.length === right.length && left.every((value, index) => value === right[index])
    : left === right;
}

function dietPatch(baseline: DietDraft, draft: DietDraft, row: DietRow): DietUpdate {
  const patch: DietUpdate = { expectedUpdatedAt: row.entry.updatedAt };
  if (draft.occurredAt !== baseline.occurredAt) patch.occurredAt = new Date(draft.occurredAt).toISOString();
  if (draft.mealType !== baseline.mealType) patch.mealType = draft.mealType;
  if (draft.foodName !== baseline.foodName) patch.foodName = draft.foodName.trim();
  if (!sameValue(draft.tags, baseline.tags)) patch.tags = draft.tags;
  if (draft.note !== baseline.note) patch.note = draft.note.trim() || null;
  if (!draft.newImage && row.entry.mediaId !== null && draft.removeImage) patch.removeImage = true;
  return patch;
}

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString();
}
