import {
  array,
  boolean,
  finiteNumber,
  isoDate,
  nonEmptyString,
  nullableString,
  nullableTimestamp,
  record,
  safeInteger,
  string,
  timestamp,
  uuid,
} from "@/lib/raven-api";

export type MealType = "breakfast" | "lunch" | "dinner" | "snack" | "late_night";
export type HealthCategory = "weight" | "bowel" | "sleep" | "lab" | "symptom" | "medication";
export type MedicationUnit =
  | "tablet" | "capsule" | "packet" | "mg" | "g" | "ml" | "drop" | "dose";

export type HealthEventDetailsInput =
  | { kind: "weight"; value: number; key?: string; name?: string; unit: string }
  | { kind: "bowel"; bristolScale: number; bloodVisible?: boolean }
  | { kind: "sleep"; value: number; key?: string; name?: string }
  | { kind: "lab"; key: string; name: string; value: number; unit?: string | null }
  | {
    kind: "symptom"; key: string; name: string; score: number; conditionNote?: string | null;
  }
  | { kind: "overall_condition"; name?: string; score: number; conditionNote?: string | null }
  | { kind: "medication"; medicationName: string; dose: number; unit: MedicationUnit };

export type HealthAttributes =
  | {
    kind: "weight"; metricKey: string; name: string; value: number; unit: string;
  }
  | { kind: "bowel"; bristolScale: number; bloodVisible: boolean }
  | { kind: "sleep"; metricKey: string; name: string; hours: number }
  | { kind: "lab"; metricKey: string; name: string; value: number; unit: string | null }
  | {
    kind: "symptom"; metricKey: string; name: string; score: number;
    conditionNote: string | null;
  }
  | { kind: "medication"; medicationName: string; dose: number; unit: MedicationUnit };

export type DietEntry = {
  id: string;
  occurredAt: string;
  mealType: MealType;
  foodName: string;
  note: string | null;
  tags: string[];
  mediaId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type HealthEvent = {
  id: string;
  occurredAt: string;
  category: HealthCategory;
  metricKey: string;
  name: string;
  value: number | null;
  unit: string | null;
  note: string | null;
  attributes: HealthAttributes;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type TimelineItem =
  | { kind: "diet"; record: DietEntry }
  | { kind: "health_event"; record: HealthEvent };

export type DietInput = {
  occurredAt: string;
  mealType: MealType;
  foodName: string;
  note?: string | null;
  tags?: string[];
  actor?: string;
};
export type DietUpdate = Partial<DietInput> & {
  expectedUpdatedAt?: string;
  reason?: string | null;
};
export type EventInput = {
  occurredAt: string;
  details: HealthEventDetailsInput;
  note?: string | null;
  actor?: string;
};
export type EventUpdate = {
  occurredAt?: string;
  details?: HealthEventDetailsInput;
  note?: string | null;
  expectedUpdatedAt?: string;
  actor?: string;
  reason?: string | null;
};

export type NamedCount = { name: string; count: number };
export type DailyAverage = { localDate: string; average: number; count: number };
export type NumericSeries = {
  category: HealthCategory;
  metricKey: string;
  name: string;
  unit: string | null;
  points: { occurredAt: string; value: number }[];
};
export type PossibleTagReaction = {
  tag: string;
  dietEntries: number;
  eventsWithin24h: number;
};
export type HealthTrends = {
  days: number;
  topDietTags: NamedCount[];
  bowelAverageByDay: DailyAverage[];
  symptomFrequencies: NamedCount[];
  medicationFrequencies: NamedCount[];
  numericSeries: NumericSeries[];
  possibleTagReactions: PossibleTagReaction[];
  reactionDisclaimer: string;
};

export function mapDietEntry(value: unknown): DietEntry {
  const wire = record(value, "diet entry");
  return {
    id: uuid(wire.id, "diet entry.id"),
    occurredAt: timestamp(wire.occurred_at, "diet entry.occurred_at"),
    mealType: mealType(wire.meal_type),
    foodName: nonEmptyString(wire.food_name, "diet entry.food_name"),
    note: nullableString(wire.note, "diet entry.note"),
    tags: array(wire.tags, "diet entry.tags")
      .map((tag) => nonEmptyString(tag, "diet entry.tags[]")),
    mediaId: wire.media_id === null ? null : uuid(wire.media_id, "diet entry.media_id"),
    createdAt: timestamp(wire.created_at, "diet entry.created_at"),
    updatedAt: timestamp(wire.updated_at, "diet entry.updated_at"),
    deletedAt: nullableTimestamp(wire.deleted_at, "diet entry.deleted_at"),
  };
}

export function mapHealthEvent(value: unknown): HealthEvent {
  const wire = record(value, "health event");
  const category = healthCategory(wire.category);
  return {
    id: uuid(wire.id, "health event.id"),
    occurredAt: timestamp(wire.occurred_at, "health event.occurred_at"),
    category,
    metricKey: nonEmptyString(wire.metric_key, "health event.metric_key"),
    name: nonEmptyString(wire.name, "health event.name"),
    value: wire.value_num === null ? null : finiteNumber(wire.value_num, "health event.value_num"),
    unit: nullableString(wire.unit, "health event.unit"),
    note: nullableString(wire.note, "health event.note"),
    attributes: mapAttributes(category, wire.attributes),
    createdAt: timestamp(wire.created_at, "health event.created_at"),
    updatedAt: timestamp(wire.updated_at, "health event.updated_at"),
    deletedAt: nullableTimestamp(wire.deleted_at, "health event.deleted_at"),
  };
}

export function mapTimelineItem(value: unknown): TimelineItem {
  const wire = record(value, "timeline item");
  const kind = string(wire.kind, "timeline item.kind");
  if (kind === "diet") return { kind, record: mapDietEntry(wire.record) };
  if (kind === "health_event") return { kind, record: mapHealthEvent(wire.record) };
  throw new TypeError("invalid timeline item.kind");
}

export function mapHealthTrends(value: unknown): HealthTrends {
  const wire = record(value, "health trends");
  return {
    days: nonNegativeInteger(wire.days, "health trends.days"),
    topDietTags: array(wire.top_diet_tags, "health trends.top_diet_tags").map(mapNamedCount),
    bowelAverageByDay: array(
      wire.bowel_average_by_day,
      "health trends.bowel_average_by_day",
    ).map((item) => {
      const row = record(item, "daily average");
      return {
        localDate: isoDate(row.local_date, "daily average.local_date"),
        average: finiteNumber(row.average, "daily average.average"),
        count: nonNegativeInteger(row.count, "daily average.count"),
      };
    }),
    symptomFrequencies: array(
      wire.symptom_frequencies,
      "health trends.symptom_frequencies",
    ).map(mapNamedCount),
    medicationFrequencies: array(
      wire.medication_frequencies,
      "health trends.medication_frequencies",
    ).map(mapNamedCount),
    numericSeries: array(wire.numeric_series, "health trends.numeric_series").map((item) => {
      const series = record(item, "numeric series");
      return {
        category: healthCategory(series.category),
        metricKey: nonEmptyString(series.metric_key, "numeric series.metric_key"),
        name: nonEmptyString(series.name, "numeric series.name"),
        unit: nullableString(series.unit, "numeric series.unit"),
        points: array(series.points, "numeric series.points").map((point) => {
          const row = record(point, "numeric point");
          return {
            occurredAt: timestamp(row.occurred_at, "numeric point.occurred_at"),
            value: finiteNumber(row.value, "numeric point.value"),
          };
        }),
      };
    }),
    possibleTagReactions: array(
      wire.possible_tag_reactions,
      "health trends.possible_tag_reactions",
    ).map((item) => {
      const row = record(item, "possible tag reaction");
      return {
        tag: nonEmptyString(row.tag, "possible tag reaction.tag"),
        dietEntries: nonNegativeInteger(
          row.diet_entries,
          "possible tag reaction.diet_entries",
        ),
        eventsWithin24h: nonNegativeInteger(
          row.events_within_24h,
          "possible tag reaction.events_within_24h",
        ),
      };
    }),
    reactionDisclaimer: string(
      wire.reaction_disclaimer,
      "health trends.reaction_disclaimer",
    ),
  };
}

function mapAttributes(category: HealthCategory, value: unknown): HealthAttributes {
  const wire = record(value, "health event.attributes");
  switch (category) {
    case "weight":
      return {
        kind: category,
        metricKey: nonEmptyString(wire.metric_key, "weight.metric_key"),
        name: nonEmptyString(wire.name, "weight.name"),
        value: finiteNumber(wire.value, "weight.value"),
        unit: nonEmptyString(wire.unit, "weight.unit"),
      };
    case "bowel":
      return {
        kind: category,
        bristolScale: rangeInteger(wire.bristol_scale, "bowel.bristol_scale", 1, 7),
        bloodVisible: boolean(wire.blood_visible, "bowel.blood_visible"),
      };
    case "sleep":
      return {
        kind: category,
        metricKey: nonEmptyString(wire.metric_key, "sleep.metric_key"),
        name: nonEmptyString(wire.name, "sleep.name"),
        hours: finiteNumber(wire.hours, "sleep.hours"),
      };
    case "lab":
      return {
        kind: category,
        metricKey: nonEmptyString(wire.metric_key, "lab.metric_key"),
        name: nonEmptyString(wire.name, "lab.name"),
        value: finiteNumber(wire.value, "lab.value"),
        unit: wire.unit === undefined ? null : nullableString(wire.unit, "lab.unit"),
      };
    case "symptom":
      return {
        kind: category,
        metricKey: nonEmptyString(wire.metric_key, "symptom.metric_key"),
        name: nonEmptyString(wire.name, "symptom.name"),
        score: rangeInteger(wire.score, "symptom.score", 1, 10),
        conditionNote: nullableString(wire.condition_note, "symptom.condition_note"),
      };
    case "medication":
      return {
        kind: category,
        medicationName: nonEmptyString(wire.medication_name, "medication.medication_name"),
        dose: finiteNumber(wire.dose, "medication.dose"),
        unit: medicationUnit(wire.unit),
      };
  }
}

function mapNamedCount(value: unknown): NamedCount {
  const wire = record(value, "named count");
  return {
    name: nonEmptyString(wire.name, "named count.name"),
    count: nonNegativeInteger(wire.count, "named count.count"),
  };
}

function healthCategory(value: unknown): HealthCategory {
  const result = string(value, "health category");
  if (!["weight", "bowel", "sleep", "lab", "symptom", "medication"].includes(result)) {
    throw new TypeError("invalid health category");
  }
  return result as HealthCategory;
}

function mealType(value: unknown): MealType {
  const result = string(value, "meal type");
  if (!["breakfast", "lunch", "dinner", "snack", "late_night"].includes(result)) {
    throw new TypeError("invalid meal type");
  }
  return result as MealType;
}

function medicationUnit(value: unknown): MedicationUnit {
  const result = string(value, "medication unit");
  if (!["tablet", "capsule", "packet", "mg", "g", "ml", "drop", "dose"].includes(result)) {
    throw new TypeError("invalid medication unit");
  }
  return result as MedicationUnit;
}

function nonNegativeInteger(value: unknown, field: string): number {
  return rangeInteger(value, field, 0, Number.MAX_SAFE_INTEGER);
}

function rangeInteger(value: unknown, field: string, min: number, max: number): number {
  const result = safeInteger(value, field);
  if (result < min || result > max) throw new TypeError(`invalid ${field}`);
  return result;
}
