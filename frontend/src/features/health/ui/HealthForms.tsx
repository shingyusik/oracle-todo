"use client";

import React, { useEffect, useRef, useState } from "react";

import type { DailyMetricInput } from "@/features/health/api/health-api";
import {
  HealthMutationRefreshError,
  type HealthController,
} from "@/features/health/hooks/useHealthController";
import type {
  DietInput,
  EventInput,
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
};

export function DietForm({
  controller,
  onSaved,
  onPendingChange,
  tagOptions,
}: HealthFormProps & { tagOptions?: readonly string[] }) {
  const [occurredAt, setOccurredAt] = useState(defaultLocalDateTime);
  const [mealType, setMealType] = useState<MealType>("breakfast");
  const [foodName, setFoodName] = useState("");
  const [note, setNote] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [image, setImage] = useState<File | null>(null);
  const [refreshRecovery, setRefreshRecovery] = useState(false);
  const imageInput = useRef<HTMLInputElement | null>(null);
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
      try {
        await controller.createDiet(input, image ?? undefined);
      } catch (cause) {
        if (cause instanceof HealthMutationRefreshError) {
          setRefreshRecovery(true);
          return;
        }
        throw cause;
      }
      if (!action.isMounted()) return;
      setFoodName("");
      setNote("");
      setTags([]);
      setImage(null);
      if (imageInput.current) imageInput.current.value = "";
      onSaved?.();
    });
  }

  const dietTagOptions = tagOptions ?? Array.from(new Set(
    controller.state.dietEntries.flatMap((entry) => entry.tags),
  ));

  async function retryRefresh() {
    await action.run(async () => {
      if (await controller.refresh()) onSaved?.();
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
        <input
          ref={imageInput}
          type="file"
          accept="image/*"
          onChange={(event) => setImage(event.target.files?.[0] ?? null)}
        />
      </label>
      <label className="field-label">
        Note
        <textarea value={note} onChange={(event) => setNote(event.target.value)} />
      </label>
      <FormResult action={action} />
      <button type="submit" disabled={action.pending}>Save diet entry</button>
      </fieldset>
      {refreshRecovery ? <div className="items-message">
        <p role="alert">{new HealthMutationRefreshError().message}</p>
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
}: HealthFormProps) {
  const [occurredAt, setOccurredAt] = useState(defaultLocalDateTime);
  const [bristol, setBristol] = useState("4");
  const [bloodVisible, setBloodVisible] = useState(false);
  const [note, setNote] = useState("");
  const [refreshRecovery, setRefreshRecovery] = useState(false);
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
      try {
        await controller.createBowel(input);
      } catch (cause) {
        if (cause instanceof HealthMutationRefreshError) {
          setRefreshRecovery(true);
          return;
        }
        throw cause;
      }
      if (!action.isMounted()) return;
      setNote("");
      setBloodVisible(false);
      onSaved?.();
    });
  }

  async function retryRefresh() {
    await action.run(async () => {
      if (await controller.refreshBowel()) onSaved?.();
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
      <label className="field-label">
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
      <button type="submit" disabled={action.pending}>Save bowel entry</button>
      </fieldset>
      {refreshRecovery ? <div className="items-message">
        <p role="alert">{new HealthMutationRefreshError().message}</p>
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
}: HealthFormProps) {
  const [occurredAt, setOccurredAt] = useState(defaultLocalDateTime);
  const [name, setName] = useState("");
  const [dose, setDose] = useState("");
  const [unit, setUnit] = useState<MedicationUnit>("tablet");
  const [note, setNote] = useState("");
  const [refreshRecovery, setRefreshRecovery] = useState(false);
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
      try {
        await controller.createMedication(input);
      } catch (cause) {
        if (cause instanceof HealthMutationRefreshError) {
          if (action.isMounted()) setRefreshRecovery(true);
          return;
        }
        throw cause;
      }
      if (!action.isMounted()) return;
      setName("");
      setDose("");
      setNote("");
      onSaved?.();
    });
  }

  async function retryRefresh() {
    await action.run(async () => {
      if (await controller.refreshMedication() && action.isMounted()) onSaved?.();
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
      <button type="submit" disabled={action.pending}>Save medication</button>
      </fieldset>
      {refreshRecovery ? <div className="items-message">
        <p role="alert">{new HealthMutationRefreshError().message}</p>
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
}: HealthFormProps & {
  metricsEntries?: readonly HealthEvent[];
  initialRow?: HealthMetricsRow;
  mode?: "create" | "edit";
}) {
  const rows = React.useMemo(() => deriveHealthMetricsGroups(
    metricsEntries,
    defaultHealthTableSettings("health.metrics"),
  ).flatMap((group) => group.rows), [metricsEntries]);
  const [date, setDate] = useState(initialRow?.date ?? defaultLocalDate);
  const [weight, setWeight] = useState("");
  const [sleep, setSleep] = useState("");
  const [crp, setCrp] = useState("");
  const [calprotectin, setCalprotectin] = useState("");
  const [conditionScore, setConditionScore] = useState("");
  const [conditionNote, setConditionNote] = useState("");
  const [refreshRecovery, setRefreshRecovery] = useState(false);
  const action = useFormAction(onPendingChange);
  const selectedDateRef = useRef<string | null>(null);
  const snapshotRef = useRef<HealthMetricsRow | undefined>(undefined);
  const pristineRef = useRef(true);

  React.useEffect(() => {
    const row = rows.find((candidate) => candidate.date === date)
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
  }, [action.pending, date, initialRow, refreshRecovery, rows]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (refreshRecovery) return;
    await action.run(async () => {
      const timestamp = localDateTimeToRfc3339(`${date}T12:00`);
      const row = snapshotRef.current;
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
      <fieldset disabled={refreshRecovery || action.pending}>
      <label className="field-label">
        Date
        <input
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
          required
        />
      </label>
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
              if (!event.target.value) setConditionNote("");
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
            disabled={!conditionScore}
          />
      </label>
      <FormResult action={action} />
      <button type="submit" disabled={action.pending}>
        {mode === "create" ? "Save daily metrics" : "Save health metrics"}
      </button>
      </fieldset>
      {refreshRecovery ? <div className="items-message">
        <p role="alert">{new HealthMutationRefreshError().message}</p>
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

function nullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed || null;
}

function defaultLocalDateTime(): string {
  const date = new Date();
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function defaultLocalDate(): string {
  return defaultLocalDateTime().slice(0, 10);
}

function metricDraft(value: number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}

export function localDateTimeToRfc3339(value: string): string {
  const match = /^(\d{4,})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(value);
  if (!match) throw new Error("Time must be a valid local date and time");
  const [, year, month, day, hour, minute, second = "0", fraction = "0"] = match;
  const components = [year, month, day, hour, minute, second].map(Number);
  const [yearValue, monthValue, dayValue, hourValue, minuteValue, secondValue] = components;
  const millisecondValue = Number(fraction.padEnd(3, "0"));
  const date = new Date(0);
  date.setFullYear(yearValue, monthValue - 1, dayValue);
  date.setHours(hourValue, minuteValue, secondValue, millisecondValue);
  if (
    date.getFullYear() !== yearValue ||
    date.getMonth() !== monthValue - 1 ||
    date.getDate() !== dayValue ||
    date.getHours() !== hourValue ||
    date.getMinutes() !== minuteValue ||
    date.getSeconds() !== secondValue ||
    date.getMilliseconds() !== millisecondValue
  ) {
    throw new Error("Time must be a valid local date and time");
  }
  return date.toISOString();
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
