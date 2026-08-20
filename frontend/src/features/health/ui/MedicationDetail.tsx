"use client";

import React, { useEffect, useReducer, useRef, useState } from "react";
import { ArrowLeft, Redo2, Save, Trash2, Undo2 } from "lucide-react";

import { HealthMutationRefreshError, type HealthController } from "@/features/health/hooks/useHealthController";
import type { MedicationRow } from "@/features/health/model/medication-table";
import type { EventUpdate, MedicationUnit } from "@/features/health/model/health-model";
import { localDateTimeToRfc3339 } from "@/features/health/ui/HealthForms";
import type { BrowserDetailHistory } from "@/features/workbench/hooks/useBrowserDetailHistory";
import { DestructiveConfirmationDialog } from "@/features/workbench/ui/DestructiveConfirmationDialog";

type MedicationDetailProps = {
  controller: HealthController;
  row: MedicationRow;
  detailHistory: BrowserDetailHistory;
  onArchived(refreshWarning?: string): void;
};

type MedicationDraft = {
  occurredAt: string;
  medicationName: string;
  dose: string;
  unit: MedicationUnit;
  note: string;
};

type CanonicalMedicationDraft = {
  occurredAt: string | null;
  medicationName: string;
  dose: number | null;
  unit: MedicationUnit;
  note: string | null;
};

type DraftHistory = {
  past: MedicationDraft[];
  present: MedicationDraft;
  future: MedicationDraft[];
  coalescingGroup: keyof MedicationDraft | null;
};

type DraftAction =
  | { type: "change"; name: keyof MedicationDraft; value: MedicationDraft[keyof MedicationDraft]; coalesce?: boolean }
  | { type: "undo" | "redo" | "close-group" };

export const MEDICATION_HISTORY_LIMIT = 50;
const invalidLocalTimeMessage = "Time must be a valid local date and time";
const invalidDoseMessage = "Dose must be a finite number greater than zero";
const doseErrorId = "medication-dose-error";
const medicationUnits: Array<{ value: MedicationUnit; label: string }> = [
  { value: "tablet", label: "정" }, { value: "capsule", label: "캡슐" },
  { value: "packet", label: "포" }, { value: "mg", label: "mg" },
  { value: "g", label: "g" }, { value: "ml", label: "ml" },
  { value: "drop", label: "방울" }, { value: "dose", label: "회" },
];

export function MedicationDetail({ controller, row, detailHistory, onArchived }: MedicationDetailProps) {
  const [baseline] = useState(() => {
    const snapshot = snapshotRow(row);
    return { row: snapshot, draft: medicationDraft(snapshot) };
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
  const valid = canonicalPresent.occurredAt !== null && canonicalPresent.medicationName !== "" &&
    canonicalPresent.dose !== null;
  const timeError = draft.occurredAt && canonicalPresent.occurredAt === null
    ? invalidLocalTimeMessage : null;
  const doseError = draft.dose.trim() !== "" && canonicalPresent.dose === null
    ? invalidDoseMessage : null;
  const readOnly = pending || refreshRecovery || exitPending || confirmation !== null ||
    detailHistory.pendingBack;

  function change<Name extends keyof MedicationDraft>(name: Name, value: MedicationDraft[Name], coalesce = false) {
    dispatch({ type: "change", name, value, coalesce });
  }

  function closeCommittedDetail() {
    const closeDetail = () => {
      setPending(false);
      detailHistory.setDirty(false);
      detailHistory.requestBack();
    };
    if (detailHistory.deferUntilRestored(closeDetail)) return true;
    closeDetail();
    return false;
  }

  function cancelArchive() {
    if (actionInFlight.current) return;
    const closeDialog = () => {
      actionInFlight.current = false;
      setPending(false);
      setError(null);
      detailHistory.setDialogOpen(false);
      setConfirmation(null);
    };
    if (detailHistory.deferUntilRestored(closeDialog)) {
      actionInFlight.current = true;
      setPending(true);
    } else closeDialog();
  }

  function closeAfterArchive(refreshWarning?: string) {
    const closeDetail = () => {
      setPending(false);
      detailHistory.setDialogOpen(false);
      onArchived(refreshWarning);
    };
    if (detailHistory.deferUntilRestored(closeDetail)) return true;
    closeDetail();
    return false;
  }

  async function save() {
    if (actionInFlight.current || refreshRecovery || !dirty || !valid) return;
    actionInFlight.current = true;
    dispatch({ type: "close-group" });
    setPending(true);
    setError(null);
    let exiting = false;
    let deferred = false;
    try {
      await controller.updateMedication(
        baseline.row.id,
        medicationPatch(canonicalBaseline, canonicalPresent, baseline.row),
      );
      exiting = true;
      setExitPending(true);
      deferred = closeCommittedDetail();
    } catch (cause) {
      const showFailure = () => {
        actionInFlight.current = false;
        setPending(false);
        setError(cause instanceof Error ? cause.message : "Could not save medication entry");
        if (cause instanceof HealthMutationRefreshError) setRefreshRecovery(true);
      };
      deferred = detailHistory.deferUntilRestored(showFailure);
      if (!deferred) showFailure();
    } finally {
      if (!deferred) {
        actionInFlight.current = exiting;
        setPending(false);
      }
    }
  }

  async function retryRefresh() {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    setPending(true);
    let exiting = false;
    let deferred = false;
    try {
      if (await controller.refreshMedication()) {
        exiting = true;
        setExitPending(true);
        deferred = closeCommittedDetail();
      } else {
        const finishRetry = () => {
          actionInFlight.current = false;
          setPending(false);
        };
        deferred = detailHistory.deferUntilRestored(finishRetry);
        if (!deferred) finishRetry();
      }
    } finally {
      if (!deferred) {
        actionInFlight.current = exiting;
        setPending(false);
      }
    }
  }

  async function archive() {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    setPending(true);
    setError(null);
    let exiting = false;
    let deferred = false;
    try {
      await controller.archiveMedication(baseline.row.id);
      exiting = true;
      setExitPending(true);
      deferred = closeAfterArchive();
    } catch (cause) {
      if (cause instanceof HealthMutationRefreshError) {
        exiting = true;
        setExitPending(true);
        deferred = closeAfterArchive(cause.message);
      } else {
        const showFailure = () => {
          actionInFlight.current = false;
          setPending(false);
          setError(cause instanceof Error ? cause.message : "Could not archive medication entry");
          detailHistory.setDialogOpen(false);
          setConfirmation(null);
          requestAnimationFrame(() => deleteButtonRef.current?.focus());
        };
        deferred = detailHistory.deferUntilRestored(showFailure);
        if (deferred) exiting = true;
        else showFailure();
      }
    } finally {
      actionInFlight.current = exiting;
      if (!deferred) setPending(false);
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

  return <section className="detail-view" aria-label={`${baseline.row.medicationName} details`}>
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
        <div className="detail-kicker"><span>Medication entry</span></div>
        <h1>{draft.medicationName}</h1>
        <p>Created {formatTimestamp(baseline.row.event.createdAt)}</p>
        <p>Updated {formatTimestamp(baseline.row.event.updatedAt)}</p>
      </div>
      {error || timeError ? <div role="alert" className="form-error">
        {error ? <p>{error}</p> : null}
        {timeError && timeError !== error ? <p>{timeError}</p> : null}
      </div> : null}
      {refreshRecovery ? <button type="button" disabled={pending}
        onClick={() => void retryRefresh()}>Retry</button> : null}
      <section className="detail-properties-list" aria-label="Edit medication properties"
        onBlurCapture={() => dispatch({ type: "close-group" })}>
        <label className="field-label">Taken at
          <input type="datetime-local" required disabled={readOnly} value={draft.occurredAt}
            onChange={(event) => change("occurredAt", event.target.value, true)} />
        </label>
        <label className="field-label">Medication name
          <input required maxLength={120} disabled={readOnly} value={draft.medicationName}
            onChange={(event) => change("medicationName", event.target.value, true)} />
        </label>
        <label className="field-label">Dose
          <input type="number" min={Number.MIN_VALUE} step="any" required disabled={readOnly}
            aria-invalid={doseError ? "true" : undefined}
            aria-describedby={doseError ? doseErrorId : undefined} value={draft.dose}
            onChange={(event) => change("dose", event.target.value, true)} />
        </label>
        {doseError ? <p id={doseErrorId} className="form-error">{doseError}</p> : null}
        <label className="field-label">Unit
          <select disabled={readOnly} value={draft.unit}
            onChange={(event) => change("unit", event.target.value as MedicationUnit)}>
            {medicationUnits.map(({ value, label }) =>
              <option key={value} value={value}>{label}</option>)}
          </select>
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
      onCancel={() => {
        detailHistory.cancelBack();
        requestAnimationFrame(() => requestAnimationFrame(() => backButtonRef.current?.focus()));
      }} onConfirm={async () => detailHistory.discardBack()} /> : null}
    {confirmation === "archive" ? <DestructiveConfirmationDialog
      title={`Archive ${draft.medicationName}?`}
      description={dirty
        ? "Move this medication entry to Archive? Unsaved changes will be discarded."
        : "Move this medication entry to Archive?"}
      confirmLabel="Archive" error={error} disabled={pending} fallbackFocusRef={deleteButtonRef}
      onCancel={cancelArchive} onConfirm={archive} /> : null}
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
  const present = { ...state.present, [action.name]: action.value } as MedicationDraft;
  return action.coalesce && state.coalescingGroup === action.name
    ? { ...state, present, future: [] }
    : { past: pushHistory(state.past, state.present), present, future: [],
      coalescingGroup: action.coalesce ? action.name : null };
}

function pushHistory(past: MedicationDraft[], present: MedicationDraft): MedicationDraft[] {
  return [...past, present].slice(-MEDICATION_HISTORY_LIMIT);
}

function medicationDraft(row: MedicationRow): MedicationDraft {
  const occurredAt = new Date(row.event.occurredAt);
  const local = new Date(occurredAt.getTime() - occurredAt.getTimezoneOffset() * 60_000);
  return {
    occurredAt: local.toISOString().slice(0, 23).replace(/\.000$/, ""),
    medicationName: row.medicationName,
    dose: String(row.dose),
    unit: row.unit,
    note: row.event.note ?? "",
  };
}

function snapshotRow(row: MedicationRow): MedicationRow {
  return { ...row, event: { ...row.event, attributes: { ...row.event.attributes } } };
}

function canonicalDraft(draft: MedicationDraft): CanonicalMedicationDraft {
  return {
    occurredAt: canonicalTime(draft.occurredAt),
    medicationName: draft.medicationName.trim(),
    dose: canonicalDose(draft.dose),
    unit: draft.unit,
    note: draft.note.trim() || null,
  };
}

function canonicalTime(value: string): string | null {
  try { return localDateTimeToRfc3339(value); } catch { return null; }
}

function canonicalDose(value: string): number | null {
  const dose = Number(value);
  return value.trim() !== "" && Number.isFinite(dose) && dose > 0 ? dose : null;
}

function sameCanonicalDraft(left: CanonicalMedicationDraft, right: CanonicalMedicationDraft): boolean {
  return left.occurredAt === right.occurredAt && left.medicationName === right.medicationName &&
    left.dose === right.dose && left.unit === right.unit && left.note === right.note;
}

function medicationPatch(
  baseline: CanonicalMedicationDraft,
  present: CanonicalMedicationDraft,
  row: MedicationRow,
): EventUpdate {
  const patch: EventUpdate = { expectedUpdatedAt: row.event.updatedAt };
  if (present.occurredAt !== baseline.occurredAt) patch.occurredAt = present.occurredAt!;
  if (present.medicationName !== baseline.medicationName || present.dose !== baseline.dose ||
    present.unit !== baseline.unit) {
    patch.details = { kind: "medication", medicationName: present.medicationName,
      dose: present.dose!, unit: present.unit };
  }
  if (present.note !== baseline.note) patch.note = present.note;
  return patch;
}

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString();
}
