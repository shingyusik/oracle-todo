"use client";

import React, { useEffect, useReducer, useRef, useState } from "react";
import { ArrowLeft, Redo2, Save, Trash2, Undo2 } from "lucide-react";

import { HealthMutationRefreshError, type HealthController } from "@/features/health/hooks/useHealthController";
import type { BowelRow } from "@/features/health/model/bowel-table";
import type { EventUpdate } from "@/features/health/model/health-model";
import { localDateTimeToRfc3339 } from "@/features/health/ui/HealthForms";
import type { BrowserDetailHistory } from "@/features/workbench/hooks/useBrowserDetailHistory";
import { DestructiveConfirmationDialog } from "@/features/workbench/ui/DestructiveConfirmationDialog";

type BowelDetailProps = {
  controller: HealthController;
  row: BowelRow;
  detailHistory: BrowserDetailHistory;
  onArchived(refreshWarning?: string): void;
};

type BowelDraft = {
  occurredAt: string;
  bristolScale: number;
  bloodVisible: boolean;
  note: string;
};

type CanonicalBowelDraft = {
  occurredAt: string | null;
  bristolScale: number;
  bloodVisible: boolean;
  note: string | null;
};

type DraftHistory = {
  past: BowelDraft[];
  present: BowelDraft;
  future: BowelDraft[];
  coalescingGroup: keyof BowelDraft | null;
};

type DraftAction =
  | { type: "change"; name: keyof BowelDraft; value: BowelDraft[keyof BowelDraft]; coalesce?: boolean }
  | { type: "undo" | "redo" | "close-group" };

export const BOWEL_HISTORY_LIMIT = 50;
const invalidLocalTimeMessage = "Time must be a valid local date and time";

export function BowelDetail({ controller, row, detailHistory, onArchived }: BowelDetailProps) {
  const [baseline] = useState(() => {
    const snapshot = snapshotRow(row);
    return { row: snapshot, draft: bowelDraft(snapshot) };
  });
  const [history, dispatch] = useReducer(historyReducer, baseline.draft, (present) => ({
    past: [], present, future: [], coalescingGroup: null,
  }));
  const [pending, setPending] = useState(false);
  const [exitPending, setExitPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshRecovery, setRefreshRecovery] = useState(false);
  const [confirmation, setConfirmation] = useState<"archive" | null>(null);
  const backButtonRef = useRef<HTMLButtonElement>(null);
  const deleteButtonRef = useRef<HTMLButtonElement>(null);
  const actionInFlight = useRef(false);
  const draft = history.present;
  const canonicalBaseline = canonicalDraft(baseline.draft);
  const canonicalPresent = canonicalDraft(draft);
  const dirty = !sameCanonicalDraft(canonicalPresent, canonicalBaseline);
  const valid = canonicalPresent.occurredAt !== null &&
    Number.isInteger(canonicalPresent.bristolScale) &&
    canonicalPresent.bristolScale >= 1 && canonicalPresent.bristolScale <= 7;
  const timeError = draft.occurredAt && canonicalPresent.occurredAt === null
    ? invalidLocalTimeMessage : null;
  const readOnly = pending || refreshRecovery || exitPending;

  function change<Name extends keyof BowelDraft>(name: Name, value: BowelDraft[Name], coalesce = false) {
    dispatch({ type: "change", name, value, coalesce });
  }

  function closeCommittedDetail() {
    detailHistory.setDirty(false);
    detailHistory.requestBack();
  }

  async function save() {
    if (actionInFlight.current || refreshRecovery || !dirty || !valid) return;
    actionInFlight.current = true;
    dispatch({ type: "close-group" });
    setPending(true);
    setError(null);
    let exiting = false;
    try {
      await controller.updateBowel(
        baseline.row.id,
        bowelPatch(canonicalBaseline, canonicalPresent, baseline.row),
      );
      exiting = true;
      setExitPending(true);
      closeCommittedDetail();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save bowel entry");
      if (cause instanceof HealthMutationRefreshError) setRefreshRecovery(true);
    } finally {
      actionInFlight.current = exiting;
      setPending(false);
    }
  }

  async function retryRefresh() {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    setPending(true);
    let exiting = false;
    try {
      if (await controller.refreshBowel()) {
        exiting = true;
        setExitPending(true);
        closeCommittedDetail();
      }
    } finally {
      actionInFlight.current = exiting;
      setPending(false);
    }
  }

  async function archive() {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    setPending(true);
    setError(null);
    let exiting = false;
    try {
      await controller.archiveBowel(baseline.row.id);
      exiting = true;
      setExitPending(true);
      onArchived();
    } catch (cause) {
      if (cause instanceof HealthMutationRefreshError) {
        exiting = true;
        setExitPending(true);
        onArchived(cause.message);
      } else {
        setError(cause instanceof Error ? cause.message : "Could not archive bowel entry");
        setConfirmation(null);
        requestAnimationFrame(() => deleteButtonRef.current?.focus());
      }
    } finally {
      actionInFlight.current = exiting;
      setPending(false);
    }
  }

  useEffect(() => {
    detailHistory.setDirty(dirty);
    return () => detailHistory.setDirty(false);
  }, [detailHistory.setDirty, dirty]);

  useEffect(() => {
    detailHistory.setDialogOpen(confirmation !== null || detailHistory.pendingBack);
    return () => detailHistory.setDialogOpen(false);
  }, [confirmation, detailHistory.pendingBack, detailHistory.setDialogOpen]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.isComposing || actionInFlight.current || refreshRecovery || confirmation ||
        detailHistory.pendingBack || !(event.ctrlKey || event.metaKey)) return;
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

  return <section className="detail-view" aria-label={`Bowel Type ${baseline.row.bristolScale} details`}>
    <header className="detail-header">
      <button ref={backButtonRef} type="button" className="detail-back" aria-label="< Back"
        disabled={readOnly} onClick={() => {
          if (!actionInFlight.current && !refreshRecovery) {
            if (!dirty) actionInFlight.current = true;
            if (!dirty) setExitPending(true);
            detailHistory.requestBack();
          }
        }}><ArrowLeft size={16} aria-hidden="true" /></button>
      <div className="detail-actions">
        <button type="button" aria-label="Undo" title="Undo (Ctrl/Cmd+Z)"
          disabled={readOnly || history.past.length === 0} onClick={() => dispatch({ type: "undo" })}>
          <Undo2 size={16} aria-hidden="true" />
        </button>
        <button type="button" aria-label="Redo" title="Redo (Ctrl/Cmd+Shift+Z or Ctrl+Y)"
          disabled={readOnly || history.future.length === 0} onClick={() => dispatch({ type: "redo" })}>
          <Redo2 size={16} aria-hidden="true" />
        </button>
        <button type="button" aria-label="Save" title="Save (Ctrl/Cmd+S)"
          disabled={readOnly || !dirty || !valid} onClick={() => void save()}>
          <Save size={16} aria-hidden="true" />
        </button>
        <button ref={deleteButtonRef} type="button" aria-label="Delete" title="Delete"
          disabled={readOnly} onClick={() => {
            if (actionInFlight.current || refreshRecovery) return;
            setError(null);
            setConfirmation("archive");
          }}><Trash2 size={16} aria-hidden="true" /></button>
      </div>
    </header>
    <div className="detail-layout">
      <div className="detail-heading">
        <div className="detail-kicker"><span>Bowel entry details</span></div>
        <h1>{`Bowel · Type ${draft.bristolScale}`}</h1>
        <p>Created {formatTimestamp(baseline.row.event.createdAt)}</p>
        <p>Updated {formatTimestamp(baseline.row.event.updatedAt)}</p>
      </div>
      {timeError || error ? <p role="alert" className="form-error">{timeError ?? error}</p> : null}
      {refreshRecovery ? <button type="button" disabled={pending}
        onClick={() => void retryRefresh()}>Retry</button> : null}
      <section className="detail-properties-list" aria-label="Edit bowel properties"
        onBlurCapture={() => dispatch({ type: "close-group" })}>
        <label className="field-label">Time
          <input type="datetime-local" required disabled={readOnly} value={draft.occurredAt}
            onChange={(event) => change("occurredAt", event.target.value, true)} />
        </label>
        <label className="field-label">Bristol Scale
          <select disabled={readOnly} value={draft.bristolScale}
            onChange={(event) => change("bristolScale", Number(event.target.value))}>
            {Array.from({ length: 7 }, (_, index) => index + 1).map((value) =>
              <option key={value} value={value}>{`Type ${value}`}</option>)}
          </select>
        </label>
        <label className="field-label">Blood Visible
          <input type="checkbox" disabled={readOnly} checked={draft.bloodVisible}
            onChange={(event) => change("bloodVisible", event.target.checked)} />
        </label>
        <label className="field-label">Note
          <textarea disabled={readOnly} value={draft.note}
            onChange={(event) => change("note", event.target.value, true)} />
        </label>
      </section>
    </div>
    {detailHistory.pendingBack ? <DestructiveConfirmationDialog
      title="Discard unsaved changes?"
      description="Your changes will be lost if you leave this detail."
      confirmLabel="Discard changes" fallbackFocusRef={backButtonRef}
      onCancel={detailHistory.cancelBack} onConfirm={async () => detailHistory.discardBack()} /> : null}
    {confirmation === "archive" ? <DestructiveConfirmationDialog
      title={`Archive Bowel · Type ${draft.bristolScale}?`}
      description={dirty
        ? "Move this bowel entry to Archive? Unsaved changes will be discarded."
        : "Move this bowel entry to Archive?"}
      confirmLabel="Archive" error={error} disabled={pending} fallbackFocusRef={deleteButtonRef}
      onCancel={() => { setError(null); setConfirmation(null); }} onConfirm={archive} /> : null}
  </section>;
}

function historyReducer(state: DraftHistory, action: DraftAction): DraftHistory {
  if (action.type === "close-group") return { ...state, coalescingGroup: null };
  if (action.type === "undo") {
    const present = state.past.at(-1);
    return present ? {
      past: state.past.slice(0, -1), present, future: [state.present, ...state.future],
      coalescingGroup: null,
    } : state;
  }
  if (action.type === "redo") {
    const [present, ...future] = state.future;
    return present ? {
      past: pushHistory(state.past, state.present), present, future, coalescingGroup: null,
    } : state;
  }
  if (action.type !== "change" || state.present[action.name] === action.value) return state;
  const present = { ...state.present, [action.name]: action.value } as BowelDraft;
  return action.coalesce && state.coalescingGroup === action.name
    ? { ...state, present, future: [] }
    : { past: pushHistory(state.past, state.present), present, future: [],
      coalescingGroup: action.coalesce ? action.name : null };
}

function pushHistory(past: BowelDraft[], present: BowelDraft): BowelDraft[] {
  return [...past, present].slice(-BOWEL_HISTORY_LIMIT);
}

function bowelDraft(row: BowelRow): BowelDraft {
  const occurredAt = new Date(row.event.occurredAt);
  const local = new Date(occurredAt.getTime() - occurredAt.getTimezoneOffset() * 60_000);
  return {
    occurredAt: local.toISOString().slice(0, 23).replace(/\.000$/, ""),
    bristolScale: row.bristolScale,
    bloodVisible: row.bloodVisible,
    note: row.event.note ?? "",
  };
}

function snapshotRow(row: BowelRow): BowelRow {
  return { ...row, event: { ...row.event, attributes: { ...row.event.attributes } } };
}

function canonicalDraft(draft: BowelDraft): CanonicalBowelDraft {
  return {
    occurredAt: canonicalTime(draft.occurredAt),
    bristolScale: draft.bristolScale,
    bloodVisible: draft.bloodVisible,
    note: draft.note.trim() || null,
  };
}

function canonicalTime(value: string): string | null {
  try { return localDateTimeToRfc3339(value); } catch { return null; }
}

function sameCanonicalDraft(left: CanonicalBowelDraft, right: CanonicalBowelDraft): boolean {
  return left.occurredAt === right.occurredAt && left.bristolScale === right.bristolScale &&
    left.bloodVisible === right.bloodVisible && left.note === right.note;
}

function bowelPatch(
  baseline: CanonicalBowelDraft,
  present: CanonicalBowelDraft,
  row: BowelRow,
): EventUpdate {
  const patch: EventUpdate = { expectedUpdatedAt: row.event.updatedAt };
  if (present.occurredAt !== baseline.occurredAt) patch.occurredAt = present.occurredAt!;
  if (present.bristolScale !== baseline.bristolScale || present.bloodVisible !== baseline.bloodVisible) {
    patch.details = { kind: "bowel", bristolScale: present.bristolScale,
      bloodVisible: present.bloodVisible };
  }
  if (present.note !== baseline.note) patch.note = present.note;
  return patch;
}

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString();
}
