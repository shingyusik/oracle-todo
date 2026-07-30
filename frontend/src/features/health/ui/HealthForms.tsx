"use client";

import React, { useRef, useState } from "react";

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

export function DietForm({ controller }: { controller: HealthController }) {
  const [occurredAt, setOccurredAt] = useState(defaultLocalDateTime);
  const [mealType, setMealType] = useState<MealType>("breakfast");
  const [foodName, setFoodName] = useState("");
  const [note, setNote] = useState("");
  const [tags, setTags] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const action = useFormAction();

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
      setFoodName("");
      setNote("");
      setTags("");
      setImage(null);
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

export function BowelForm({ controller }: { controller: HealthController }) {
  const [occurredAt, setOccurredAt] = useState(defaultLocalDateTime);
  const [bristol, setBristol] = useState("4");
  const [bloodVisible, setBloodVisible] = useState(false);
  const [note, setNote] = useState("");
  const action = useFormAction();

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
      setNote("");
      setBloodVisible(false);
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

export function MedicationForm({ controller }: { controller: HealthController }) {
  const [occurredAt, setOccurredAt] = useState(defaultLocalDateTime);
  const [name, setName] = useState("");
  const [dose, setDose] = useState("");
  const [unit, setUnit] = useState<MedicationUnit>("tablet");
  const [note, setNote] = useState("");
  const action = useFormAction();

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await action.run(async () => {
      const input: EventInput = {
        occurredAt: toRfc3339(occurredAt),
        details: {
          kind: "medication",
          medicationName: name.trim(),
          dose: Number(dose),
          unit,
        },
        note: nullable(note),
      };
      await controller.createMedication(input);
      setName("");
      setDose("");
      setNote("");
    });
  }

  return (
    <form onSubmit={(event) => void submit(event)} aria-label="Medication entry">
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
          min="0"
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

export function MetricsForm({ controller }: { controller: HealthController }) {
  const [occurredAt, setOccurredAt] = useState(defaultLocalDateTime);
  const [weight, setWeight] = useState("");
  const [sleep, setSleep] = useState("");
  const [symptomName, setSymptomName] = useState("");
  const [symptomScore, setSymptomScore] = useState("");
  const [labKey, setLabKey] = useState("");
  const [labName, setLabName] = useState("");
  const [labValue, setLabValue] = useState("");
  const [labUnit, setLabUnit] = useState("");
  const action = useFormAction();

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await action.run(async () => {
      const timestamp = toRfc3339(occurredAt);
      const metrics: EventInput[] = [];
      if (weight !== "") {
        metrics.push({
          occurredAt: timestamp,
          details: { kind: "weight", value: Number(weight), unit: "kg" },
        });
      }
      if (sleep !== "") {
        metrics.push({
          occurredAt: timestamp,
          details: { kind: "sleep", value: Number(sleep) },
        });
      }
      if (symptomName.trim() || symptomScore) {
        metrics.push({
          occurredAt: timestamp,
          details: {
            kind: "symptom",
            key: metricKey(symptomName),
            name: symptomName.trim(),
            score: Number(symptomScore),
          },
        });
      }
      if (labKey.trim() || labName.trim() || labValue) {
        metrics.push({
          occurredAt: timestamp,
          details: {
            kind: "lab",
            key: labKey.trim(),
            name: labName.trim(),
            value: Number(labValue),
            unit: nullable(labUnit),
          },
        });
      }
      if (metrics.length === 0) throw new Error("Enter at least one daily metric");
      await controller.upsertMetrics(metrics);
      setWeight("");
      setSleep("");
      setSymptomName("");
      setSymptomScore("");
      setLabKey("");
      setLabName("");
      setLabValue("");
      setLabUnit("");
    });
  }

  return (
    <form onSubmit={(event) => void submit(event)} aria-label="Daily metrics">
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
            min="0"
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
            min="0"
            max="24"
            step="any"
            value={sleep}
            onChange={(event) => setSleep(event.target.value)}
          />
        </label>
      </fieldset>
      <fieldset>
        <legend>Symptom</legend>
        <label className="field-label">
          Symptom name
          <input
            value={symptomName}
            onChange={(event) => setSymptomName(event.target.value)}
          />
        </label>
        <label className="field-label">
          Symptom score
          <input
            type="number"
            min="1"
            max="10"
            step="1"
            value={symptomScore}
            onChange={(event) => setSymptomScore(event.target.value)}
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

function useFormAction() {
  const active = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(operation: () => Promise<void>) {
    if (active.current) return;
    active.current = true;
    setPending(true);
    setError(null);
    try {
      await operation();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Health request failed");
    } finally {
      active.current = false;
      setPending(false);
    }
  }

  return { pending, error, run };
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

function metricKey(value: string): string {
  const key = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return key && /^[a-z]/.test(key) ? key : "symptom";
}

function defaultLocalDateTime(): string {
  const date = new Date();
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function toRfc3339(value: string): string {
  return new Date(value).toISOString();
}
