"use client";

import React, { useEffect, useRef, useState } from "react";

import type { DailyMetricInput } from "@/features/health/api/health-api";
import type { HealthController } from "@/features/health/hooks/useHealthController";
import type {
  DietInput,
  EventInput,
  MealType,
  MedicationUnit,
} from "@/features/health/model/health-model";

const mealTypes: Array<{ value: MealType; label: string }> = [
  { value: "breakfast", label: "Breakfast" },
  { value: "lunch", label: "Lunch" },
  { value: "dinner", label: "Dinner" },
  { value: "snack", label: "Snack" },
  { value: "late_night", label: "Late night" },
];
const medicationUnits: MedicationUnit[] = [
  "tablet",
  "capsule",
  "packet",
  "mg",
  "g",
  "ml",
  "drop",
  "dose",
];

type HealthFormProps = {
  controller: HealthController;
  onSaved?: () => void;
  onPendingChange?: (pending: boolean) => void;
};

export function DietForm({
  controller,
  onSaved,
  onPendingChange,
}: HealthFormProps) {
  const [occurredAt, setOccurredAt] = useState(defaultLocalDateTime);
  const [mealType, setMealType] = useState<MealType>("breakfast");
  const [foodName, setFoodName] = useState("");
  const [note, setNote] = useState("");
  const [tags, setTags] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const imageInput = useRef<HTMLInputElement | null>(null);
  const action = useFormAction(onPendingChange);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await action.run(async () => {
      if (image && !image.type.startsWith("image/")) {
        throw new Error("Meal image must be an image file");
      }
      const input: DietInput = {
        occurredAt: toRfc3339(occurredAt),
        mealType,
        foodName: foodName.trim(),
        note: nullable(note),
        tags: uniqueCommaList(tags),
      };
      await controller.createDiet(input, image ?? undefined);
      if (!action.isMounted()) return;
      setFoodName("");
      setNote("");
      setTags("");
      setImage(null);
      if (imageInput.current) imageInput.current.value = "";
      onSaved?.();
    });
  }

  return (
    <form onSubmit={(event) => void submit(event)} aria-label="Diet entry">
      <label className="field-label">
        Occurred at
        <input
          type="datetime-local"
          value={occurredAt}
          onChange={(event) => setOccurredAt(event.target.value)}
          required
        />
      </label>
      <label className="field-label">
        Meal type
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
        Food name
        <input
          value={foodName}
          maxLength={120}
          onChange={(event) => setFoodName(event.target.value)}
          required
        />
      </label>
      <label className="field-label">
        Tags
        <input
          value={tags}
          placeholder="comma, separated"
          onChange={(event) => setTags(event.target.value)}
        />
      </label>
      <label className="field-label">
        Diet note
        <textarea value={note} onChange={(event) => setNote(event.target.value)} />
      </label>
      <label className="field-label">
        Meal image
        <input
          ref={imageInput}
          type="file"
          accept="image/*"
          onChange={(event) => setImage(event.target.files?.[0] ?? null)}
        />
      </label>
      <FormResult action={action} />
      <button type="submit" disabled={action.pending}>Save diet entry</button>
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
  const action = useFormAction(onPendingChange);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await action.run(async () => {
      const input: EventInput = {
        occurredAt: toRfc3339(occurredAt),
        details: {
          kind: "bowel",
          bristolScale: Number(bristol),
          bloodVisible,
        },
        note: nullable(note),
      };
      await controller.createBowel(input);
      if (!action.isMounted()) return;
      setNote("");
      setBloodVisible(false);
      onSaved?.();
    });
  }

  return (
    <form onSubmit={(event) => void submit(event)} aria-label="Bowel entry">
      <label className="field-label">
        Occurred at
        <input
          type="datetime-local"
          value={occurredAt}
          onChange={(event) => setOccurredAt(event.target.value)}
          required
        />
      </label>
      <label className="field-label">
        Bristol scale
        <select value={bristol} onChange={(event) => setBristol(event.target.value)}>
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
        Blood visible
      </label>
      <label className="field-label">
        Bowel note
        <textarea value={note} onChange={(event) => setNote(event.target.value)} />
      </label>
      <FormResult action={action} />
      <button type="submit" disabled={action.pending}>Save bowel entry</button>
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
  const action = useFormAction(onPendingChange);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await action.run(async () => {
      const medicationName = name.trim();
      if (!medicationName) throw new Error("Medication name is required");
      const doseValue = positiveNumber(dose, "Dose");
      const input: EventInput = {
        occurredAt: toRfc3339(occurredAt),
        details: {
          kind: "medication",
          medicationName,
          dose: doseValue,
          unit,
        },
        note: nullable(note),
      };
      await controller.createMedication(input);
      if (!action.isMounted()) return;
      setName("");
      setDose("");
      setNote("");
      onSaved?.();
    });
  }

  return (
    <form
      noValidate
      onSubmit={(event) => void submit(event)}
      aria-label="Medication entry"
    >
      <label className="field-label">
        Occurred at
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
        Medication unit
        <select
          value={unit}
          onChange={(event) => setUnit(event.target.value as MedicationUnit)}
        >
          {medicationUnits.map((value) => (
            <option key={value} value={value}>{value}</option>
          ))}
        </select>
      </label>
      <label className="field-label">
        Medication note
        <textarea value={note} onChange={(event) => setNote(event.target.value)} />
      </label>
      <FormResult action={action} />
      <button type="submit" disabled={action.pending}>Save medication</button>
    </form>
  );
}

export function MetricsForm({
  controller,
  onSaved,
  onPendingChange,
}: HealthFormProps) {
  const [occurredAt, setOccurredAt] = useState(defaultLocalDateTime);
  const [weight, setWeight] = useState("");
  const [sleep, setSleep] = useState("");
  const [conditionScore, setConditionScore] = useState("");
  const [conditionNote, setConditionNote] = useState("");
  const [labKey, setLabKey] = useState("");
  const [labName, setLabName] = useState("");
  const [labValue, setLabValue] = useState("");
  const [labUnit, setLabUnit] = useState("");
  const action = useFormAction(onPendingChange);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await action.run(async () => {
      const timestamp = toRfc3339(occurredAt);
      const metrics: DailyMetricInput[] = [];
      if (weight !== "") {
        metrics.push({
          occurredAt: timestamp,
          details: { kind: "weight", value: positiveNumber(weight, "Weight"), unit: "kg" },
        });
      }
      if (sleep !== "") {
        const hours = positiveNumber(sleep, "Sleep hours");
        if (hours > 24) throw new Error("Sleep hours must not exceed 24");
        metrics.push({
          occurredAt: timestamp,
          details: { kind: "sleep", value: hours },
        });
      }
      if (conditionNote.trim() && conditionScore === "") {
        throw new Error("Overall condition requires a score");
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
        });
      }
      const hasAnyLabValue =
        Boolean(labKey.trim() || labName.trim() || labValue || labUnit.trim());
      if (hasAnyLabValue) {
        const key = labKey.trim();
        const name = labName.trim();
        if (!key || !name || labValue === "") {
          throw new Error("Lab requires metric key, name, and value");
        }
        if (!/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(key)) {
          throw new Error("Lab metric key must use lower snake case");
        }
        const value = finiteNumericValue(labValue, "Lab value");
        metrics.push({
          occurredAt: timestamp,
          details: {
            kind: "lab",
            key,
            name,
            value,
            unit: nullable(labUnit),
          },
        });
      }
      if (metrics.length === 0) throw new Error("Enter at least one daily metric");
      await controller.upsertMetrics(metrics);
      if (!action.isMounted()) return;
      setWeight("");
      setSleep("");
      setConditionScore("");
      setConditionNote("");
      setLabKey("");
      setLabName("");
      setLabValue("");
      setLabUnit("");
      onSaved?.();
    });
  }

  return (
    <form
      noValidate
      onSubmit={(event) => void submit(event)}
      aria-label="Daily metrics"
    >
      <label className="field-label">
        Occurred at
        <input
          type="datetime-local"
          value={occurredAt}
          onChange={(event) => setOccurredAt(event.target.value)}
          required
        />
      </label>
      <fieldset>
        <legend>Weight</legend>
        <label className="field-label">
          Weight
          <input
            type="number"
            min={Number.MIN_VALUE}
            step="any"
            value={weight}
            onChange={(event) => setWeight(event.target.value)}
          />
        </label>
        <p>Unit: kg</p>
      </fieldset>
      <fieldset>
        <legend>Sleep</legend>
        <label className="field-label">
          Sleep hours
          <input
            type="number"
            min={Number.MIN_VALUE}
            max="24"
            step="any"
            value={sleep}
            onChange={(event) => setSleep(event.target.value)}
          />
        </label>
      </fieldset>
      <fieldset>
        <legend>Overall condition</legend>
        <label className="field-label">
          Overall condition score
          <input
            type="number"
            min="1"
            max="10"
            step="1"
            value={conditionScore}
            onChange={(event) => setConditionScore(event.target.value)}
          />
        </label>
        <label className="field-label">
          Condition note
          <textarea
            value={conditionNote}
            onChange={(event) => setConditionNote(event.target.value)}
          />
        </label>
      </fieldset>
      <fieldset>
        <legend>Lab</legend>
        <label className="field-label">
          Lab metric key
          <input
            pattern="[a-z][a-z0-9]*(?:_[a-z0-9]+)*"
            value={labKey}
            onChange={(event) => setLabKey(event.target.value)}
          />
        </label>
        <label className="field-label">
          Lab name
          <input value={labName} onChange={(event) => setLabName(event.target.value)} />
        </label>
        <label className="field-label">
          Lab value
          <input
            type="number"
            step="any"
            value={labValue}
            onChange={(event) => setLabValue(event.target.value)}
          />
        </label>
        <label className="field-label">
          Lab unit
          <input value={labUnit} onChange={(event) => setLabUnit(event.target.value)} />
        </label>
      </fieldset>
      <FormResult action={action} />
      <button type="submit" disabled={action.pending}>Save daily metrics</button>
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

  useEffect(() => () => {
    mounted.current = false;
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

function uniqueCommaList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item, index, items) => items.indexOf(item) === index);
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

function toRfc3339(value: string): string {
  return new Date(value).toISOString();
}

function positiveNumber(value: string, field: string): number {
  const result = finiteNumericValue(value, field);
  if (result <= 0) throw new Error(`${field} must be greater than zero`);
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
