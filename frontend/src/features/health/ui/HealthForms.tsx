"use client";

import { healthLocalDateTime } from "@/features/health/model/health-date";

import React, { useEffect, useRef, useState } from "react";

import type { DailyMetricInput } from "@/features/health/api/health-api";
import {
  HealthMutationRefreshError,
  type HealthController,
} from "@/features/health/hooks/useHealthController";
import { healthApi } from "@/features/health/api/health-api";
import type { BowelRow } from "@/features/health/model/bowel-table";
import type { DietRow } from "@/features/health/model/diet-table";
import type { MedicationRow } from "@/features/health/model/medication-table";
import type {
  DietInput,
  DietUpdate,
  EventInput,
  EventUpdate,
  HealthEvent,
  MealType,
  MedicationUnit,
} from "@/features/health/model/health-model";
import {
  deriveHealthMetricsGroups,
  type HealthMetricsRow,
} from "@/features/health/model/health-metrics-table";
import { defaultHealthTableSettings } from "@/features/health/model/health-table-views";
import { TagsInput } from "@/features/workbench/ui/TagsInput";
import { useDraftDirty } from "@/features/workbench/ui/modal-lifecycle";
import { PhotoInput } from "@/features/health/ui/PhotoInput";

const mealTypes: Array<{ value: MealType; label: string }> = [
  { value: "breakfast", label: "Breakfast" },
  { value: "lunch", label: "Lunch" },
  { value: "dinner", label: "Dinner" },
  { value: "snack", label: "Snack" },
  { value: "late_night", label: "Late night" },
];
const medicationUnits: Array<{ value: MedicationUnit; label: string }> = [
  { value: "tablet", label: "정" },
  { value: "capsule", label: "캡슐" },
  { value: "packet", label: "포" },
  { value: "mg", label: "mg" },
  { value: "g", label: "g" },
  { value: "ml", label: "ml" },
  { value: "drop", label: "방울" },
  { value: "dose", label: "회" },
];

type HealthFormProps = {
  controller: HealthController;
  onSaved?: () => void;
  onPendingChange?: (pending: boolean) => void;
  onRecoveryChange?: (recovering: boolean) => void;
  onDirtyChange?: (dirty: boolean) => void;
  dialogActions?: { closeLabel: string; onClose(): void };
};

export function DietForm({
  controller,
  onSaved,
  onPendingChange,
  onRecoveryChange,
  onDirtyChange,
  dialogActions,
  tagOptions,
  entry,
}: HealthFormProps & { tagOptions?: readonly string[]; entry?: DietRow }) {
  const [baseline] = useState(() => entry && {
    row: entry,
    values: {
      occurredAt: healthLocalDateTime(new Date(entry.entry.occurredAt)),
      mealType: entry.entry.mealType,
      foodName: entry.entry.foodName,
      note: entry.entry.note ?? "",
      tags: [...entry.entry.tags],
    },
  });
  const [occurredAt, setOccurredAt] = useState(baseline?.values.occurredAt ?? defaultLocalDateTime());
  const [mealType, setMealType] = useState<MealType>(baseline?.values.mealType ?? "breakfast");
  const [foodName, setFoodName] = useState(baseline?.values.foodName ?? "");
  const [note, setNote] = useState(baseline?.values.note ?? "");
  const [tags, setTags] = useState<string[]>(baseline?.values.tags ?? []);
  const [image, setImage] = useState<File | null>(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [refreshRecovery, setRefreshRecovery] = useState(false);
  const [recoveryMessage, setRecoveryMessage] = useState(new HealthMutationRefreshError().message);
  const imageInput = useRef<HTMLInputElement | null>(null);
  useDraftDirty([occurredAt, mealType, foodName, note, tags, image?.name ?? null, removeImage], onDirtyChange);
  const action = useFormAction(onPendingChange);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (refreshRecovery) return;
    await action.run(async () => {
      if (image && !image.type.startsWith("image/")) {
        throw new Error("Meal image must be an image file");
      }
      const input: DietInput = {
        occurredAt: localDateTimeToRfc3339(occurredAt),
        mealType,
        foodName: foodName.trim(),
        note: nullable(note),
        tags,
      };
      let patch: DietUpdate | null = null;
      if (baseline) {
        patch = dietPatch(baseline.row, baseline.values, input, tags, image, removeImage);
        if (patch === null) {
          if (action.isMounted()) onSaved?.();
          return;
        }
      }
      try {
        if (baseline && patch) {
          await controller.updateDiet(baseline.row.id, patch, image ?? undefined);
        } else {
          await controller.createDiet(input, image ?? undefined);
        }
      } catch (cause) {
        if (cause instanceof HealthMutationRefreshError) {
          if (action.isMounted()) {
            setRefreshRecovery(true);
            setRecoveryMessage(cause.message);
            onRecoveryChange?.(true);
          }
          return;
        }
        throw cause;
      }
      if (!action.isMounted()) return;
      if (!baseline) {
        setFoodName("");
        setNote("");
        setTags([]);
        setImage(null);
        if (imageInput.current) imageInput.current.value = "";
      }
      onSaved?.();
    });
  }

  const dietTagOptions = tagOptions ?? Array.from(new Set(
    controller.state.dietEntries.flatMap((entry) => entry.tags),
  ));

  async function retryRefresh() {
    await action.run(async () => {
      if (await controller.refresh() && action.isMounted()) {
        onRecoveryChange?.(false);
        onSaved?.();
      }
    });
  }

  return (
    <form onSubmit={(event) => void submit(event)} aria-label="Diet entry">
      <fieldset disabled={refreshRecovery || action.pending}>
      <label className="field-label">
        Time
        <input
          type="datetime-local"
          value={occurredAt}
          onChange={(event) => setOccurredAt(event.target.value)}
          required
        />
      </label>
      <label className="field-label">
        Meal
        <select
          value={mealType}
          onChange={(event) => setMealType(event.target.value as MealType)}
        >
          {mealTypes.map((meal) => (
            <option key={meal.value} value={meal.value}>{meal.label}</option>
          ))}
        </select>
      </label>
      <label className="field-label">
        Food
        <input
          value={foodName}
          maxLength={120}
          onChange={(event) => setFoodName(event.target.value)}
          required
        />
      </label>
      <div className="field-label">
        Tags
        <TagsInput
          label="Tags"
          value={tags}
          tagOptions={dietTagOptions}
          onCommit={setTags}
          disabled={refreshRecovery || action.pending}
        />
      </div>
      <label className="field-label">
        Photo
        <PhotoInput
          ref={imageInput}
          selectedName={image?.name}
          disabled={refreshRecovery || action.pending}
          onChange={(event) => {
            const next = event.target.files?.[0] ?? null;
            setImage(next);
            if (next) setRemoveImage(false);
          }}
        />
        {baseline ? (
          image ? (
            <button type="button" disabled={refreshRecovery || action.pending} onClick={() => {
              setImage(null);
              if (imageInput.current) imageInput.current.value = "";
            }}>Remove selected photo</button>
          ) : baseline.row.entry.mediaId && removeImage ? (
            <><span>Photo will be removed</span>
              <button type="button" disabled={refreshRecovery || action.pending}
                onClick={() => setRemoveImage(false)}>Keep photo</button></>
          ) : baseline.row.entry.mediaId ? (
            <><img src={healthApi.photoUrl(baseline.row.id)} alt="Saved meal"
              style={{ maxWidth: "100%", maxHeight: 280 }} />
              <span>Current photo</span>
              <button type="button" disabled={refreshRecovery || action.pending}
                onClick={() => setRemoveImage(true)}>Remove photo</button></>
          ) : <span>No photo</span>
        ) : null}
      </label>
      <label className="field-label">
        Note
        <textarea value={note} onChange={(event) => setNote(event.target.value)} />
      </label>
      <FormResult action={action} />
      {dialogActions ? (
        <footer className="ledger-create-dialog-actions">
          <button
            type="button"
            className="items-toolbar-button"
            aria-label={dialogActions.closeLabel}
            disabled={action.pending || refreshRecovery}
            onClick={dialogActions.onClose}
          >
            Close
          </button>
          <button
            type="submit"
            className="items-toolbar-button ledger-create-dialog-save"
            disabled={action.pending || refreshRecovery}
          >
            {action.pending ? "Saving…" : "Save"}
          </button>
        </footer>
      ) : <button type="submit" disabled={action.pending}>Save diet entry</button>}
      </fieldset>
      {refreshRecovery ? <div className="items-message">
        <p role="alert">{recoveryMessage}</p>
        <button type="button" disabled={action.pending} onClick={() => void retryRefresh()}>
          Retry refresh
        </button>
      </div> : null}
    </form>
  );
}

export function BowelForm({
  controller,
  onSaved,
  onPendingChange,
  onRecoveryChange,
  onDirtyChange,
  dialogActions,
  row,
}: HealthFormProps & { row?: BowelRow }) {
  const [baseline] = useState(() => row && {
    row,
    values: {
      occurredAt: healthLocalDateTime(new Date(row.event.occurredAt)),
      bristol: String(row.bristolScale),
      bloodVisible: row.bloodVisible,
      note: row.event.note ?? "",
    },
  });
  const [occurredAt, setOccurredAt] = useState(baseline?.values.occurredAt ?? defaultLocalDateTime());
  const [bristol, setBristol] = useState(baseline?.values.bristol ?? "4");
  const [bloodVisible, setBloodVisible] = useState(baseline?.values.bloodVisible ?? false);
  const [note, setNote] = useState(baseline?.values.note ?? "");
  useDraftDirty([occurredAt, bristol, bloodVisible, note], onDirtyChange);
  const [refreshRecovery, setRefreshRecovery] = useState(false);
  const [recoveryMessage, setRecoveryMessage] = useState(new HealthMutationRefreshError().message);
  const action = useFormAction(onPendingChange);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (refreshRecovery) return;
    await action.run(async () => {
      const input: EventInput = {
        occurredAt: localDateTimeToRfc3339(occurredAt),
        details: {
          kind: "bowel",
          bristolScale: Number(bristol),
          bloodVisible,
        },
        note: nullable(note),
      };
      let patch: EventUpdate | null = null;
      if (baseline) {
        patch = bowelPatch(baseline.row, baseline.values, input);
        if (patch === null) {
          if (action.isMounted()) onSaved?.();
          return;
        }
      }
      try {
        if (baseline && patch) await controller.updateBowel(baseline.row.id, patch);
        else await controller.createBowel(input);
      } catch (cause) {
        if (cause instanceof HealthMutationRefreshError) {
          if (action.isMounted()) {
            setRefreshRecovery(true);
            setRecoveryMessage(cause.message);
            onRecoveryChange?.(true);
          }
          return;
        }
        throw cause;
      }
      if (!action.isMounted()) return;
      if (!baseline) {
        setNote("");
        setBloodVisible(false);
      }
      onSaved?.();
    });
  }

  async function retryRefresh() {
    await action.run(async () => {
      if (await controller.refreshBowel() && action.isMounted()) {
        onRecoveryChange?.(false);
        onSaved?.();
      }
    });
  }

  return (
    <form onSubmit={(event) => void submit(event)} aria-label="Bowel entry">
      <fieldset disabled={refreshRecovery || action.pending}>
      <label className="field-label">
        Time
        <input
          type="datetime-local"
          value={occurredAt}
          onChange={(event) => setOccurredAt(event.target.value)}
          required
        />
      </label>
      <label className="field-label">
        Bristol Scale
        <select
          value={bristol}
          onChange={(event) => setBristol(event.target.value)}
          required
        >
          {Array.from({ length: 7 }, (_, index) => index + 1).map((value) => (
            <option key={value} value={value}>Type {value}</option>
          ))}
        </select>
      </label>
      <label className="field-checkbox">
        <input
          type="checkbox"
          checked={bloodVisible}
          onChange={(event) => setBloodVisible(event.target.checked)}
        />
        Blood Visible
      </label>
      <label className="field-label">
        Note
        <textarea value={note} onChange={(event) => setNote(event.target.value)} />
      </label>
      <FormResult action={action} />
      {dialogActions ? (
        <footer className="ledger-create-dialog-actions">
          <button
            type="button"
            className="items-toolbar-button"
            aria-label={dialogActions.closeLabel}
            disabled={action.pending || refreshRecovery}
            onClick={dialogActions.onClose}
          >
            Close
          </button>
          <button
            type="submit"
            className="items-toolbar-button ledger-create-dialog-save"
            disabled={action.pending || refreshRecovery}
          >
            {action.pending ? "Saving…" : "Save"}
          </button>
        </footer>
      ) : <button type="submit" disabled={action.pending}>Save bowel entry</button>}
      </fieldset>
      {refreshRecovery ? <div className="items-message">
        <p role="alert">{recoveryMessage}</p>
        <button type="button" disabled={action.pending} onClick={() => void retryRefresh()}>
          Retry refresh
        </button>
      </div> : null}
    </form>
  );
}

export function MedicationForm({
  controller,
  onSaved,
  onPendingChange,
  onRecoveryChange,
  onDirtyChange,
  dialogActions,
  row,
}: HealthFormProps & { row?: MedicationRow }) {
  const [baseline] = useState(() => row && {
    row,
    values: {
      occurredAt: healthLocalDateTime(new Date(row.event.occurredAt)),
      name: row.medicationName,
      dose: String(row.dose),
      unit: row.unit,
      note: row.event.note ?? "",
    },
  });
  const [occurredAt, setOccurredAt] = useState(baseline?.values.occurredAt ?? defaultLocalDateTime());
  const [name, setName] = useState(baseline?.values.name ?? "");
  const [dose, setDose] = useState(baseline?.values.dose ?? "");
  const [unit, setUnit] = useState<MedicationUnit>(baseline?.values.unit ?? "tablet");
  const [note, setNote] = useState(baseline?.values.note ?? "");
  useDraftDirty([occurredAt, name, dose, unit, note], onDirtyChange);
  const [refreshRecovery, setRefreshRecovery] = useState(false);
  const [recoveryMessage, setRecoveryMessage] = useState(new HealthMutationRefreshError().message);
  const action = useFormAction(onPendingChange);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (refreshRecovery) return;
    await action.run(async () => {
      const medicationName = name.trim();
      if (!medicationName) throw new Error("Medication name is required");
      const doseValue = positiveNumber(dose, "Dose");
      const input: EventInput = {
        occurredAt: localDateTimeToRfc3339(occurredAt),
        details: {
          kind: "medication",
          medicationName,
          dose: doseValue,
          unit,
        },
        note: nullable(note),
      };
      let patch: EventUpdate | null = null;
      if (baseline) {
        patch = medicationPatch(baseline.row, baseline.values, input);
        if (patch === null) {
          if (action.isMounted()) onSaved?.();
          return;
        }
      }
      try {
        if (baseline && patch) await controller.updateMedication(baseline.row.id, patch);
        else await controller.createMedication(input);
      } catch (cause) {
        if (cause instanceof HealthMutationRefreshError) {
          if (action.isMounted()) {
            setRefreshRecovery(true);
            setRecoveryMessage(cause.message);
            onRecoveryChange?.(true);
          }
          return;
        }
        throw cause;
      }
      if (!action.isMounted()) return;
      if (!baseline) {
        setName("");
        setDose("");
        setNote("");
      }
      onSaved?.();
    });
  }

  async function retryRefresh() {
    await action.run(async () => {
      if (await controller.refreshMedication() && action.isMounted()) {
        onRecoveryChange?.(false);
        onSaved?.();
      }
    });
  }

  return (
    <form
      noValidate
      onSubmit={(event) => void submit(event)}
      aria-label="Medication entry"
    >
      <fieldset disabled={refreshRecovery || action.pending}>
      <label className="field-label">
        Taken at
        <input
          type="datetime-local"
          value={occurredAt}
          onChange={(event) => setOccurredAt(event.target.value)}
          required
        />
      </label>
      <label className="field-label">
        Medication name
        <input value={name} onChange={(event) => setName(event.target.value)} required />
      </label>
      <label className="field-label">
        Dose
        <input
          type="number"
          min={Number.MIN_VALUE}
          step="any"
          value={dose}
          onChange={(event) => setDose(event.target.value)}
          required
        />
      </label>
      <label className="field-label">
        Unit
        <select
          value={unit}
          onChange={(event) => setUnit(event.target.value as MedicationUnit)}
        >
          {medicationUnits.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>
      <label className="field-label">
        Note
        <textarea value={note} onChange={(event) => setNote(event.target.value)} />
      </label>
      <FormResult action={action} />
      {dialogActions ? (
        <footer className="ledger-create-dialog-actions">
          <button
            type="button"
            className="items-toolbar-button"
            aria-label={dialogActions.closeLabel}
            disabled={action.pending || refreshRecovery}
            onClick={dialogActions.onClose}
          >
            Close
          </button>
          <button
            type="submit"
            className="items-toolbar-button ledger-create-dialog-save"
            disabled={action.pending || refreshRecovery}
          >
            {action.pending ? "Saving…" : "Save"}
          </button>
        </footer>
      ) : <button type="submit" disabled={action.pending}>Save medication</button>}
      </fieldset>
      {refreshRecovery ? <div className="items-message">
        <p role="alert">{recoveryMessage}</p>
        <button type="button" disabled={action.pending} onClick={() => void retryRefresh()}>
          Retry refresh
        </button>
      </div> : null}
    </form>
  );
}

export function MetricsForm({
  controller,
  metricsEntries = controller.state.metricsEntries,
  initialRow,
  mode = "create",
  onSaved,
  onPendingChange,
  onRecoveryChange,
  onDirtyChange,
  dialogActions,
}: HealthFormProps & {
  metricsEntries?: readonly HealthEvent[];
  initialRow?: HealthMetricsRow;
  mode?: "create" | "edit";
}) {
  const [dateRecords, setDateRecords] = useState<HealthEvent[] | null>(null);
  const [dateStatus, setDateStatus] = useState<"loading" | "loaded" | "error">(
    mode === "create" && controller.loadMetricsForDate ? "loading" : "loaded",
  );
  const [dateAttempt, setDateAttempt] = useState(0);
  const rows = React.useMemo(() => deriveHealthMetricsGroups(
    dateRecords ?? metricsEntries,
    defaultHealthTableSettings("health.metrics"),
  ).flatMap((group) => group.rows), [dateRecords, metricsEntries]);
  const [date, setDate] = useState(initialRow?.date ?? defaultLocalDate);
  const [weight, setWeight] = useState("");
  const [sleep, setSleep] = useState("");
  const [crp, setCrp] = useState("");
  const [calprotectin, setCalprotectin] = useState("");
  const [conditionScore, setConditionScore] = useState("");
  const [conditionNote, setConditionNote] = useState("");
  const [refreshRecovery, setRefreshRecovery] = useState(false);
  const [recoveryMessage, setRecoveryMessage] = useState(new HealthMutationRefreshError().message);
  const action = useFormAction(onPendingChange);
  const selectedDateRef = useRef<string | null>(null);
  const snapshotRef = useRef<HealthMetricsRow | undefined>(undefined);
  const pristineRef = useRef(true);
  const initialDate = useRef(date);
  useEffect(() => {
    onDirtyChange?.(!pristineRef.current || date !== initialDate.current);
  });

  React.useEffect(() => {
    if (mode !== "create" || !controller.loadMetricsForDate) return;
    let active = true;
    setDateStatus("loading");
    setDateRecords(null);
    void controller.loadMetricsForDate(date).then((records) => {
      if (!active) return;
      setDateRecords(records);
      setDateStatus("loaded");
    }, () => { if (active) setDateStatus("error"); });
    return () => { active = false; };
  }, [controller.loadMetricsForDate, date, dateAttempt, mode]);

  React.useEffect(() => {
    if (dateStatus !== "loaded") return;
    const row = mode === "edit" && initialRow
      ? initialRow
      : rows.find((candidate) => candidate.date === date)
        ?? (initialRow?.date === date ? initialRow : undefined);
    const selectedNewDate = selectedDateRef.current !== date;
    const receivedInitialRow = !snapshotRef.current && pristineRef.current && Boolean(row);
    if ((!selectedNewDate && !receivedInitialRow) || action.pending || refreshRecovery) return;
    selectedDateRef.current = date;
    snapshotRef.current = row;
    pristineRef.current = true;
    setWeight(metricDraft(row?.weight));
    setSleep(metricDraft(row?.sleep));
    setCrp(metricDraft(row?.crp));
    setCalprotectin(metricDraft(row?.calprotectin));
    setConditionScore(metricDraft(row?.condition));
    setConditionNote(row?.note ?? "");
  }, [action.pending, date, dateStatus, initialRow, refreshRecovery, rows]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (refreshRecovery || dateStatus !== "loaded") return;
    await action.run(async () => {
      const timestamp = localDateTimeToRfc3339(`${date}T12:00`);
      const row = snapshotRef.current;
      if (mode === "edit" && row) {
        const mutation = metricsEditMutation(row, timestamp,
          { weight, sleep, crp, calprotectin, condition: conditionScore }, conditionNote);
        if (mutation.metrics.length === 0 && mutation.archives.length === 0) {
          if (action.isMounted()) onSaved?.();
          return;
        }
        try {
          await controller.saveMetrics(mutation);
        } catch (cause) {
          if (cause instanceof HealthMutationRefreshError) {
            if (action.isMounted()) {
              setRefreshRecovery(true);
              setRecoveryMessage(cause.message);
              onRecoveryChange?.(true);
            }
            return;
          }
          throw cause;
        }
        if (action.isMounted()) onSaved?.();
        return;
      }
      const metrics: DailyMetricInput[] = [];
      if (weight !== "") {
        metrics.push({
          occurredAt: timestamp,
          details: { kind: "weight", value: positiveNumber(weight, "Weight"), unit: "kg" },
          ...(row?.events.weight
            ? { expectedUpdatedAt: row.events.weight.updatedAt }
            : {}),
        });
      }
      if (sleep !== "") {
        const hours = positiveNumber(sleep, "Sleep");
        if (hours > 24) throw new Error("Sleep must not exceed 24");
        metrics.push({
          occurredAt: timestamp,
          details: { kind: "sleep", value: hours },
          ...(row?.events.sleep
            ? { expectedUpdatedAt: row.events.sleep.updatedAt }
            : {}),
        });
      }
      if (crp !== "") {
        metrics.push({
          occurredAt: timestamp,
          details: {
            kind: "lab", key: "crp", name: "CRP",
            value: nonNegativeNumber(crp, "CRP"), unit: "mg/L",
          },
          ...(row?.events.crp
            ? { expectedUpdatedAt: row.events.crp.updatedAt }
            : {}),
        });
      }
      if (calprotectin !== "") {
        metrics.push({
          occurredAt: timestamp,
          details: {
            kind: "lab", key: "fecal_calprotectin", name: "Fecal calprotectin",
            value: nonNegativeNumber(calprotectin, "Calprotectin"), unit: "µg/g",
          },
          ...(row?.events.calprotectin
            ? { expectedUpdatedAt: row.events.calprotectin.updatedAt }
            : {}),
        });
      }
      if (conditionScore === "" && conditionNote.trim()) {
        throw new Error("Select Condition to save Note");
      }
      if (conditionScore !== "") {
        const score = integerInRange(
          conditionScore,
          "Overall condition score",
          1,
          10,
        );
        metrics.push({
          occurredAt: timestamp,
          details: {
            kind: "overall_condition",
            score,
            conditionNote: nullable(conditionNote),
          },
          ...(row?.events.condition
            ? { expectedUpdatedAt: row.events.condition.updatedAt }
            : {}),
        });
      }
      if (metrics.length === 0) throw new Error("Enter at least one daily metric");
      try {
        await controller.saveMetrics({ metrics, archives: [] });
      } catch (cause) {
        if (cause instanceof HealthMutationRefreshError) {
          if (action.isMounted()) {
            setRefreshRecovery(true);
            setRecoveryMessage(cause.message);
            onRecoveryChange?.(true);
          }
          return;
        }
        throw cause;
      }
      if (!action.isMounted()) return;
      setWeight("");
      setSleep("");
      setCrp("");
      setCalprotectin("");
      setConditionScore("");
      setConditionNote("");
      onSaved?.();
    });
  }

  async function retryRefresh() {
    await action.run(async () => {
      if (await controller.refreshMetrics() && action.isMounted()) {
        onRecoveryChange?.(false);
        onSaved?.();
      }
    });
  }

  return (
    <form
      noValidate
      onSubmit={(event) => void submit(event)}
      aria-label="Daily metrics"
    >
      {dateStatus === "loading" ? <p role="status">Loading metrics for this date…</p> : null}
      {dateStatus === "error" ? <><p role="alert">Could not load metrics for this date.</p>
        <button type="button" onClick={() => setDateAttempt((value) => value + 1)}>Retry date</button></> : null}
      <fieldset disabled={refreshRecovery || action.pending}>
      <label className="field-label">
        Date
        <input
          type="date"
          disabled={mode === "edit"}
          value={date}
          onChange={(event) => setDate(event.target.value)}
          required
        />
      </label>
      <fieldset disabled={dateStatus !== "loaded"} style={{ minWidth: 0, border: 0, padding: 0, margin: 0 }}>
      <label className="field-label">
          Weight
          <input
            type="number"
            min={Number.MIN_VALUE}
            step="any"
            value={weight}
            onChange={(event) => {
              pristineRef.current = false;
              setWeight(event.target.value);
            }}
          />
      </label>
      <label className="field-label">
          Sleep
          <input
            type="number"
            min={Number.MIN_VALUE}
            max="24"
            step="any"
            value={sleep}
            onChange={(event) => {
              pristineRef.current = false;
              setSleep(event.target.value);
            }}
          />
      </label>
      <label className="field-label">
          CRP
          <input
            type="number"
            min="0"
            step="any"
            value={crp}
            onChange={(event) => {
              pristineRef.current = false;
              setCrp(event.target.value);
            }}
          />
      </label>
      <label className="field-label">
          Calprotectin
          <input
            type="number"
            min="0"
            step="any"
            value={calprotectin}
            onChange={(event) => {
              pristineRef.current = false;
              setCalprotectin(event.target.value);
            }}
          />
      </label>
      <label className="field-label">
          Condition
          <select
            value={conditionScore}
            onChange={(event) => {
              pristineRef.current = false;
              setConditionScore(event.target.value);
            }}
          >
            <option value="">None</option>
            {Array.from({ length: 10 }, (_, index) => index + 1).map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
      </label>
      <label className="field-label">
          Note
          <textarea
            value={conditionNote}
            onChange={(event) => {
              pristineRef.current = false;
              setConditionNote(event.target.value);
            }}
          />
      </label>
      </fieldset>
      <FormResult action={action} />
      {dialogActions ? (
        <footer className="ledger-create-dialog-actions">
          <button
            type="button"
            className="items-toolbar-button"
            aria-label={dialogActions.closeLabel}
            disabled={action.pending || refreshRecovery}
            onClick={dialogActions.onClose}
          >
            Close
          </button>
          <button
            type="submit"
            className="items-toolbar-button ledger-create-dialog-save"
            disabled={action.pending || refreshRecovery || dateStatus !== "loaded"}
          >
            {action.pending ? "Saving…" : "Save"}
          </button>
        </footer>
      ) : (
        <button type="submit" disabled={action.pending || refreshRecovery || dateStatus !== "loaded"}>
          {mode === "create" ? "Save daily metrics" : "Save health metrics"}
        </button>
      )}
      </fieldset>
      {refreshRecovery ? <div className="items-message">
        <p role="alert">{recoveryMessage}</p>
        <button type="button" disabled={action.pending} onClick={() => void retryRefresh()}>
          Retry refresh
        </button>
      </div> : null}
    </form>
  );
}

type FormAction = ReturnType<typeof useFormAction>;

function FormResult({ action }: { action: FormAction }) {
  if (!action.error) return null;
  return <p role="alert" className="items-message">{action.error}</p>;
}

function useFormAction(onPendingChange?: (pending: boolean) => void) {
  const active = useRef(false);
  const mounted = useRef(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function run(operation: () => Promise<void>) {
    if (active.current) return;
    active.current = true;
    setPending(true);
    onPendingChange?.(true);
    setError(null);
    try {
      await operation();
    } catch (cause) {
      if (mounted.current) {
        setError(cause instanceof Error ? cause.message : "Health request failed");
      }
    } finally {
      active.current = false;
      if (mounted.current) {
        setPending(false);
        onPendingChange?.(false);
      }
    }
  }

  return { pending, error, run, isMounted: () => mounted.current };
}

function dietPatch(
  row: DietRow,
  base: { occurredAt: string; mealType: MealType; foodName: string; note: string; tags: string[] },
  input: DietInput,
  tags: readonly string[],
  image: File | null,
  removeImage: boolean,
): DietUpdate | null {
  const patch: DietUpdate = { expectedUpdatedAt: row.entry.updatedAt };
  if (input.occurredAt !== localDateTimeToRfc3339(base.occurredAt)) patch.occurredAt = input.occurredAt;
  if (input.mealType !== base.mealType) patch.mealType = input.mealType;
  if (input.foodName !== base.foodName.trim()) patch.foodName = input.foodName;
  if (!sameTrimmedSet(tags, base.tags)) patch.tags = [...tags];
  if (input.note !== nullable(base.note)) patch.note = input.note;
  if (!image && row.entry.mediaId !== null && removeImage) patch.removeImage = true;
  return Object.keys(patch).length > 1 || image ? patch : null;
}

function sameTrimmedSet(left: readonly string[], right: readonly string[]): boolean {
  const a = new Set(left.map((tag) => tag.trim()).filter(Boolean));
  const b = new Set(right.map((tag) => tag.trim()).filter(Boolean));
  return a.size === b.size && [...a].every((tag) => b.has(tag));
}

function bowelPatch(
  row: BowelRow,
  base: { occurredAt: string; bristol: string; bloodVisible: boolean; note: string },
  input: EventInput,
): EventUpdate | null {
  const patch: EventUpdate = { expectedUpdatedAt: row.event.updatedAt };
  if (input.occurredAt !== localDateTimeToRfc3339(base.occurredAt)) patch.occurredAt = input.occurredAt;
  if (input.details.kind === "bowel" && (
    input.details.bristolScale !== Number(base.bristol) ||
    input.details.bloodVisible !== base.bloodVisible)) {
    patch.details = input.details;
  }
  if (input.note !== nullable(base.note)) patch.note = input.note;
  return Object.keys(patch).length > 1 ? patch : null;
}

function medicationPatch(
  row: MedicationRow,
  base: { occurredAt: string; name: string; dose: string; unit: MedicationUnit; note: string },
  input: EventInput,
): EventUpdate | null {
  const patch: EventUpdate = { expectedUpdatedAt: row.event.updatedAt };
  if (input.occurredAt !== localDateTimeToRfc3339(base.occurredAt)) patch.occurredAt = input.occurredAt;
  if (input.details.kind === "medication" && (
    input.details.medicationName !== base.name.trim() ||
    input.details.dose !== Number(base.dose) ||
    input.details.unit !== base.unit)) {
    patch.details = input.details;
  }
  if (input.note !== nullable(base.note)) patch.note = input.note;
  return Object.keys(patch).length > 1 ? patch : null;
}

type MetricFieldKey = "weight" | "sleep" | "crp" | "calprotectin" | "condition";

function metricsEditMutation(
  row: HealthMetricsRow,
  occurredAt: string,
  drafts: Record<MetricFieldKey, string>,
  noteDraft: string,
): { metrics: DailyMetricInput[]; archives: Array<{ id: string; expectedUpdatedAt: string }> } {
  const parsers: Record<MetricFieldKey, (value: string) => number> = {
    weight: (value) => positiveNumber(value, "Weight"),
    sleep: (value) => {
      const hours = positiveNumber(value, "Sleep");
      if (hours > 24) throw new Error("Sleep must not exceed 24");
      return hours;
    },
    crp: (value) => nonNegativeNumber(value, "CRP"),
    calprotectin: (value) => nonNegativeNumber(value, "Calprotectin"),
    condition: (value) => integerInRange(value, "Overall condition score", 1, 10),
  };
  if (drafts.condition === "" && noteDraft.trim()) throw new Error("Select Condition to save Note");
  const note = drafts.condition === "" ? null : nullable(noteDraft);
  const metrics: DailyMetricInput[] = [];
  const archives: Array<{ id: string; expectedUpdatedAt: string }> = [];
  for (const field of ["weight", "sleep", "crp", "calprotectin", "condition"] as const) {
    const present = drafts[field] === "" ? null : parsers[field](drafts[field]);
    const original = row[field] ?? null;
    const changed = present !== original || (field === "condition" && note !== nullable(row.note));
    if (!changed) continue;
    const existing = row.events[field];
    if (present === null) {
      if (existing) archives.push({ id: existing.id, expectedUpdatedAt: existing.updatedAt });
      continue;
    }
    metrics.push({
      occurredAt,
      details: metricDetails(field, present, note),
      ...(existing ? { expectedUpdatedAt: existing.updatedAt } : {}),
    });
  }
  return { metrics, archives };
}

function metricDetails(
  field: MetricFieldKey,
  value: number,
  note: string | null,
): DailyMetricInput["details"] {
  if (field === "weight") return { kind: "weight", value, unit: "kg" };
  if (field === "sleep") return { kind: "sleep", value };
  if (field === "crp") return { kind: "lab", key: "crp", name: "CRP", value, unit: "mg/L" };
  if (field === "calprotectin") {
    return { kind: "lab", key: "fecal_calprotectin", name: "Fecal calprotectin", value, unit: "µg/g" };
  }
  return { kind: "overall_condition", score: value, conditionNote: note };
}

function nullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed || null;
}

function defaultLocalDateTime(): string {
  return healthLocalDateTime(new Date()).slice(0, 16);
}

function defaultLocalDate(): string {
  return defaultLocalDateTime().slice(0, 10);
}

function metricDraft(value: number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}

export function localDateTimeToRfc3339(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(\.\d{1,3})?)?$/.exec(value);
  if (!match) throw new Error("Enter a valid date and time.");
  const [, year, month, day, hour, minute, second = "00", fraction = ""] = match;
  const date = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}${fraction}Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 19) !== `${year}-${month}-${day}T${hour}:${minute}:${second}`) throw new Error("Enter a valid date and time.");
  return new Date(`${value}+09:00`).toISOString();
}

function positiveNumber(value: string, field: string): number {
  const result = finiteNumericValue(value, field);
  if (result <= 0) throw new Error(`${field} must be greater than zero`);
  return result;
}

function nonNegativeNumber(value: string, field: string): number {
  const result = finiteNumericValue(value, field);
  if (result < 0) throw new Error(`${field} must not be negative`);
  return result;
}

function finiteNumericValue(value: string, field: string): number {
  const result = Number(value);
  if (value.trim() === "" || !Number.isFinite(result)) {
    throw new Error(`${field} must be a number`);
  }
  return result;
}

function integerInRange(
  value: string,
  field: string,
  minimum: number,
  maximum: number,
): number {
  const result = finiteNumericValue(value, field);
  if (!Number.isInteger(result) || result < minimum || result > maximum) {
    throw new Error(`${field} must be between ${minimum} and ${maximum}`);
  }
  return result;
}
