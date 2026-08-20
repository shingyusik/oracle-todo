"use client";

import React, { useEffect, useReducer, useRef, useState } from "react";
import { ArrowLeft, Redo2, Save, Trash2, Undo2 } from "lucide-react";

import type { DailyMetricInput } from "@/features/health/api/health-api";
import { HealthMutationRefreshError, type HealthController } from "@/features/health/hooks/useHealthController";
import type { HealthMetricField, HealthMetricsRow } from "@/features/health/model/health-metrics-table";
import { localDateTimeToRfc3339 } from "@/features/health/ui/HealthForms";
import type { BrowserDetailHistory } from "@/features/workbench/hooks/useBrowserDetailHistory";
import { DestructiveConfirmationDialog } from "@/features/workbench/ui/DestructiveConfirmationDialog";

type Props = {
  controller: HealthController;
  row: HealthMetricsRow;
  detailHistory: BrowserDetailHistory;
  onSaved(date: string): void;
  onArchived(refreshWarning?: string): void;
};
type Draft = { date: string; weight: string; sleep: string; crp: string;
  calprotectin: string; condition: string; note: string };
type Canonical = { date: string | null; weight: number | null; sleep: number | null;
  crp: number | null; calprotectin: number | null; condition: number | null; note: string | null };
type History = { past: Draft[]; present: Draft; future: Draft[]; coalescing: keyof Draft | null };
type Action = { type: "change"; name: keyof Draft; value: string; coalesce?: boolean }
  | { type: "undo" | "redo" | "close-group" | "clear-condition" };

export const HEALTH_METRICS_HISTORY_LIMIT = 50;
const fields: HealthMetricField[] = ["weight", "sleep", "crp", "calprotectin", "condition"];

export function HealthMetricsDetail({ controller, row, detailHistory, onSaved, onArchived }: Props) {
  const [baseline] = useState(() => ({ row: snapshotRow(row), draft: rowDraft(row) }));
  const [history, dispatch] = useReducer(reducer, baseline.draft, (present) => ({
    past: [], present, future: [], coalescing: null,
  }));
  const [pending, setPending] = useState(false);
  const [exitPending, setExitPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshRecovery, setRefreshRecovery] = useState(false);
  const [confirmation, setConfirmation] = useState(false);
  const actionInFlight = useRef(false);
  const backButtonRef = useRef<HTMLButtonElement>(null);
  const deleteButtonRef = useRef<HTMLButtonElement>(null);
  const draft = history.present;
  const original = canonical(baseline.draft);
  const present = canonical(draft);
  const dirty = !sameCanonical(original, present);
  const valid = validCanonical(present) && fields.some((field) => present[field] !== null);
  const readOnly = pending || refreshRecovery || exitPending || confirmation || detailHistory.pendingBack;

  function change(name: keyof Draft, value: string, coalesce = false) {
    dispatch({ type: "change", name, value, coalesce });
  }
  function closeCommitted(date: string) {
    const close = () => {
      setPending(false);
      detailHistory.setDirty(false);
      onSaved(date);
      detailHistory.requestBack();
    };
    if (detailHistory.deferUntilRestored(close)) return true;
    close();
    return false;
  }
  function closeArchived(warning?: string) {
    const close = () => {
      setPending(false);
      detailHistory.setDialogOpen(false);
      onArchived(warning);
    };
    if (detailHistory.deferUntilRestored(close)) return true;
    close();
    return false;
  }
  function showFailure(cause: unknown, fallback: string) {
    const show = () => {
      actionInFlight.current = false;
      setPending(false);
      setError(cause instanceof Error ? cause.message : fallback);
      if (cause instanceof HealthMutationRefreshError) setRefreshRecovery(true);
    };
    const deferred = detailHistory.deferUntilRestored(show);
    if (!deferred) show();
    return deferred;
  }

  async function save() {
    if (actionInFlight.current || refreshRecovery || !dirty || !valid) return;
    actionInFlight.current = true;
    dispatch({ type: "close-group" });
    setPending(true); setError(null);
    let exiting = false; let deferred = false;
    try {
      await controller.saveMetrics(buildMutation(original, present, baseline.row));
      exiting = true; setExitPending(true); deferred = closeCommitted(present.date!);
    } catch (cause) {
      deferred = showFailure(cause, "Could not save health metrics");
    } finally {
      if (!deferred) { actionInFlight.current = exiting; setPending(false); }
    }
  }
  async function retryRefresh() {
    if (actionInFlight.current) return;
    actionInFlight.current = true; setPending(true);
    let exiting = false; let deferred = false;
    try {
      if (await controller.refreshMetrics()) {
        exiting = true; setExitPending(true); deferred = closeCommitted(present.date!);
      } else {
        const finish = () => { actionInFlight.current = false; setPending(false); };
        deferred = detailHistory.deferUntilRestored(finish); if (!deferred) finish();
      }
    } finally { if (!deferred) { actionInFlight.current = exiting; setPending(false); } }
  }
  async function archive() {
    if (actionInFlight.current) return;
    actionInFlight.current = true; setPending(true); setError(null);
    let exiting = false; let deferred = false;
    try {
      await controller.saveMetrics({ metrics: [], archives: memberEvents(baseline.row)
        .map(({ id, updatedAt }) => ({ id, expectedUpdatedAt: updatedAt })) });
      exiting = true; setExitPending(true); deferred = closeArchived();
    } catch (cause) {
      if (cause instanceof HealthMutationRefreshError) {
        exiting = true; setExitPending(true); deferred = closeArchived(cause.message);
      } else {
        const show = () => {
          actionInFlight.current = false; setPending(false);
          setError(cause instanceof Error ? cause.message : "Could not archive health metrics");
          detailHistory.setDialogOpen(false); setConfirmation(false);
          requestAnimationFrame(() => deleteButtonRef.current?.focus());
        };
        deferred = detailHistory.deferUntilRestored(show);
        if (deferred) exiting = true; else show();
      }
    } finally { actionInFlight.current = exiting; if (!deferred) setPending(false); }
  }
  function cancelArchive() {
    if (actionInFlight.current) return;
    const close = () => {
      actionInFlight.current = false;
      setPending(false);
      setError(null);
      detailHistory.setDialogOpen(false);
      setConfirmation(false);
    };
    if (detailHistory.deferUntilRestored(close)) { actionInFlight.current = true; setPending(true); }
    else close();
  }

  useEffect(() => { detailHistory.setDirty(dirty); return () => detailHistory.setDirty(false); },
    [detailHistory.setDirty, dirty]);
  useEffect(() => {
    detailHistory.setDialogOpen(confirmation || detailHistory.pendingBack);
    return () => detailHistory.setDialogOpen(false);
  }, [confirmation, detailHistory.pendingBack, detailHistory.setDialogOpen]);
  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if (event.isComposing || readOnly || !(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === "s") { event.preventDefault(); void save(); }
      else if (key === "z" && event.shiftKey) { event.preventDefault(); dispatch({ type: "redo" }); }
      else if (key === "z") { event.preventDefault(); dispatch({ type: "undo" }); }
      else if (key === "y" && event.ctrlKey && !event.metaKey && !event.shiftKey) {
        event.preventDefault(); dispatch({ type: "redo" });
      }
    }
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  });

  return <section className="detail-view" aria-label={`Health Metrics ${baseline.row.date} details`}>
    <header className="detail-header">
      <button ref={backButtonRef} type="button" className="detail-back" aria-label="< Back"
        disabled={readOnly} onClick={() => {
          if (!dirty) { actionInFlight.current = true; setExitPending(true); }
          detailHistory.requestBack();
        }}><ArrowLeft size={16} aria-hidden="true" /></button>
      <div className="detail-actions">
        <button type="button" aria-label="Undo" title="Undo (Ctrl/Cmd+Z)"
          disabled={readOnly || history.past.length === 0} onClick={() => dispatch({ type: "undo" })}>
          <Undo2 size={16} aria-hidden="true" /></button>
        <button type="button" aria-label="Redo" title="Redo (Ctrl/Cmd+Shift+Z or Ctrl+Y)"
          disabled={readOnly || history.future.length === 0} onClick={() => dispatch({ type: "redo" })}>
          <Redo2 size={16} aria-hidden="true" /></button>
        <button type="button" aria-label="Save" title="Save (Ctrl/Cmd+S)"
          disabled={readOnly || !dirty || !valid} onClick={() => void save()}>
          <Save size={16} aria-hidden="true" /></button>
        <button ref={deleteButtonRef} type="button" aria-label="Delete" title="Delete"
          disabled={readOnly} onClick={() => { setError(null); setConfirmation(true); }}>
          <Trash2 size={16} aria-hidden="true" /></button>
      </div>
    </header>
    <div className="detail-layout">
      <div className="detail-heading"><div className="detail-kicker"><span>Daily health metrics</span></div>
        <h1>{`Health Metrics · ${baseline.row.date}`}</h1>
        <p>Created {formatTimestamp(baseline.row.createdAt)}</p>
        <p>Updated {formatTimestamp(baseline.row.updatedAt)}</p>
      </div>
      {error ? <p role="alert" className="form-error">{error}</p> : null}
      {refreshRecovery ? <button type="button" disabled={pending}
        onClick={() => void retryRefresh()}>Retry</button> : null}
      <section className="detail-properties-list" aria-label="Edit health metrics"
        onBlurCapture={() => dispatch({ type: "close-group" })}>
        <label className="field-label">Date<input type="date" disabled value={draft.date} /></label>
        <MetricInput label="Weight" unit="kg" value={draft.weight} disabled={readOnly}
          onChange={(value) => change("weight", value, true)} />
        <MetricInput label="Sleep" unit="hours" value={draft.sleep} disabled={readOnly}
          max="24" onChange={(value) => change("sleep", value, true)} />
        <MetricInput label="CRP" unit="mg/L" value={draft.crp} disabled={readOnly} min="0"
          onChange={(value) => change("crp", value, true)} />
        <MetricInput label="Calprotectin" unit="µg/g" value={draft.calprotectin} disabled={readOnly}
          min="0" onChange={(value) => change("calprotectin", value, true)} />
        <label className="field-label">Condition<select disabled={readOnly} value={draft.condition}
          onChange={(event) => {
            if (event.target.value) change("condition", event.target.value);
            else dispatch({ type: "clear-condition" });
          }}><option value="">None</option>{Array.from({ length: 10 }, (_, i) => i + 1)
            .map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        <label className="field-label">Note<textarea disabled={readOnly || !draft.condition}
          value={draft.note} onChange={(event) => change("note", event.target.value, true)} /></label>
      </section>
    </div>
    {detailHistory.pendingBack ? <DestructiveConfirmationDialog title="Discard unsaved changes?"
      description="Your changes will be lost if you leave this detail." confirmLabel="Discard changes"
      fallbackFocusRef={backButtonRef} onCancel={() => {
        detailHistory.cancelBack();
        requestAnimationFrame(() => requestAnimationFrame(() => backButtonRef.current?.focus()));
      }} onConfirm={async () => detailHistory.discardBack()} /> : null}
    {confirmation ? <DestructiveConfirmationDialog title={`Archive Health Metrics · ${baseline.row.date}?`}
      description={dirty ? "Move these health metrics to Archive? Unsaved changes will be discarded."
        : "Move these health metrics to Archive?"} confirmLabel="Archive" error={error}
      disabled={pending} fallbackFocusRef={deleteButtonRef} onCancel={cancelArchive} onConfirm={archive} /> : null}
  </section>;
}

function MetricInput({ label, unit, value, disabled, onChange, min = Number.MIN_VALUE, max }: {
  label: string; unit: string; value: string; disabled: boolean; min?: number | string;
  max?: number | string; onChange(value: string): void;
}) {
  return <label className="field-label">{label}<span>{unit}</span><input aria-label={label}
    type="number" min={min} max={max} step="any" disabled={disabled} value={value}
    onChange={(event) => onChange(event.target.value)} /></label>;
}

function reducer(state: History, action: Action): History {
  if (action.type === "close-group") return { ...state, coalescing: null };
  if (action.type === "clear-condition") {
    if (state.present.condition === "" && state.present.note === "") return state;
    return { past: push(state.past, state.present),
      present: { ...state.present, condition: "", note: "" }, future: [], coalescing: null };
  }
  if (action.type === "undo") {
    const present = state.past.at(-1);
    return present ? { past: state.past.slice(0, -1), present,
      future: [state.present, ...state.future], coalescing: null } : state;
  }
  if (action.type === "redo") {
    const [present, ...future] = state.future;
    return present ? { past: push(state.past, state.present), present, future, coalescing: null } : state;
  }
  if (action.type !== "change") return state;
  if (state.present[action.name] === action.value) return state;
  const present = { ...state.present, [action.name]: action.value };
  return action.coalesce && state.coalescing === action.name
    ? { ...state, present, future: [] }
    : { past: push(state.past, state.present), present, future: [],
      coalescing: action.coalesce ? action.name : null };
}
function push(past: Draft[], present: Draft) { return [...past, present].slice(-HEALTH_METRICS_HISTORY_LIMIT); }
function rowDraft(row: HealthMetricsRow): Draft {
  return { date: row.date, weight: value(row.weight), sleep: value(row.sleep), crp: value(row.crp),
    calprotectin: value(row.calprotectin), condition: value(row.condition), note: row.note };
}
function value(input: number | null) { return input === null ? "" : String(input); }
function snapshotRow(row: HealthMetricsRow): HealthMetricsRow {
  return { ...row, events: Object.fromEntries(Object.entries(row.events)
    .map(([key, event]) => [key, event && { ...event, attributes: { ...event.attributes } }])) };
}
function canonical(draft: Draft): Canonical {
  const condition = metricNumber(draft.condition, 1, 10, true);
  return { date: /^\d{4}-\d{2}-\d{2}$/.test(draft.date) ? draft.date : null,
    weight: metricNumber(draft.weight, Number.MIN_VALUE), sleep: metricNumber(draft.sleep, Number.MIN_VALUE, 24),
    crp: metricNumber(draft.crp, 0), calprotectin: metricNumber(draft.calprotectin, 0),
    condition, note: condition === null ? null : draft.note.trim() || null };
}
function metricNumber(value: string, min: number, max = Number.POSITIVE_INFINITY, integer = false) {
  if (value.trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max && (!integer || Number.isInteger(number))
    ? number : Number.NaN;
}
function validCanonical(value: Canonical) {
  return value.date !== null && fields.every((field) => value[field] === null || Number.isFinite(value[field]!));
}
function sameCanonical(a: Canonical, b: Canonical) {
  return a.date === b.date && fields.every((field) => a[field] === b[field]) && a.note === b.note;
}
function buildMutation(original: Canonical, present: Canonical, row: HealthMetricsRow) {
  const metrics: DailyMetricInput[] = [];
  const archives: Array<{ id: string; expectedUpdatedAt: string }> = [];
  const occurredAt = localDateTimeToRfc3339(`${present.date}T12:00`);
  for (const field of fields) {
    const existing = row.events[field];
    const changed = original[field] !== present[field]
      || (field === "condition" && original.note !== present.note);
    if (!changed) continue;
    if (present[field] === null) {
      if (existing) archives.push({ id: existing.id, expectedUpdatedAt: existing.updatedAt });
      continue;
    }
    metrics.push({ occurredAt, details: details(field, present[field]!, present.note),
      ...(existing ? { expectedUpdatedAt: existing.updatedAt } : {}) });
  }
  return { metrics, archives };
}
function details(field: HealthMetricField, value: number, note: string | null): DailyMetricInput["details"] {
  if (field === "weight") return { kind: "weight", value, unit: "kg" };
  if (field === "sleep") return { kind: "sleep", value };
  if (field === "crp") return { kind: "lab", key: "crp", name: "CRP", value, unit: "mg/L" };
  if (field === "calprotectin") return { kind: "lab", key: "fecal_calprotectin",
    name: "Fecal calprotectin", value, unit: "µg/g" };
  return { kind: "overall_condition", score: value, conditionNote: note };
}
function memberEvents(row: HealthMetricsRow) { return fields.flatMap((field) => row.events[field] ? [row.events[field]!] : []); }
function formatTimestamp(value: string) { return new Date(value).toLocaleString(); }
