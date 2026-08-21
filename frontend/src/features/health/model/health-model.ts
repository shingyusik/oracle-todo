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

export type HealthTableScope =
  | "health.diet" | "health.bowel" | "health.medication" | "health.metrics";
export type HealthTableOccurrence =
  | HealthTableOccurrenceBase<"health.diet", DietTableRecord>
  | HealthTableOccurrenceBase<"health.bowel", BowelTableRecord>
  | HealthTableOccurrenceBase<"health.medication", MedicationTableRecord>
  | HealthTableOccurrenceBase<"health.metrics", HealthMetricsTableRecord>;
export type HealthTableOccurrenceBase<S extends HealthTableScope, R> = {
  key: string;
  groupKey: string | null;
  groupLabel: string | null;
  scope: S;
  record: R;
};
export type DietTableRecord = {
  kind: "diet"; id: string; entry: DietEntry; date: string; mealLabel: string;
  food: string; tags: string[]; hasPhoto: boolean; note: string;
};
export type BowelTableRecord = {
  kind: "bowel"; id: string; event: HealthEvent; date: string; bristolScale: number;
  bloodVisible: boolean; bloodLabel: string; note: string;
};
export type MedicationTableRecord = {
  kind: "medication"; id: string; event: HealthEvent; date: string;
  medicationName: string; dose: number; unit: string; unitLabel: string; note: string;
};
export type HealthMetricsTableRecord = {
  kind: "metrics"; id: string; date: string; events: HealthEvent[];
  weight: number | null; sleep: number | null; crp: number | null;
  calprotectin: number | null; condition: number | null; note: string;
  createdAt: string; updatedAt: string;
};
export type HealthLookupOption = { id: string; label: string };
export type HealthTableLookups = Partial<Record<
  "meal_type" | "has_photo" | "tags" | "bristol_scale" | "blood_visible"
  | "medication_unit" | "metric",
  HealthLookupOption[]
>>;

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
  removeImage?: boolean;
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
  const foodName = nonEmptyString(wire.food_name, "diet entry.food_name");
  if ([...foodName].length > 120) throw new TypeError("invalid diet entry.food_name");
  const tags = array(wire.tags, "diet entry.tags")
    .map((tag) => nonEmptyString(tag, "diet entry.tags[]"));
  if (tags.length > 20 || tags.some((tag) => [...tag].length > 40)) {
    throw new TypeError("invalid diet entry.tags");
  }
  return {
    id: uuid(wire.id, "diet entry.id"),
    occurredAt: timestamp(wire.occurred_at, "diet entry.occurred_at"),
    mealType: mealType(wire.meal_type),
    foodName,
    note: nullableString(wire.note, "diet entry.note"),
    tags,
    mediaId: wire.media_id === null ? null : uuid(wire.media_id, "diet entry.media_id"),
    createdAt: timestamp(wire.created_at, "diet entry.created_at"),
    updatedAt: timestamp(wire.updated_at, "diet entry.updated_at"),
    deletedAt: nullableTimestamp(wire.deleted_at, "diet entry.deleted_at"),
  };
}

export function mapHealthEvent(value: unknown): HealthEvent {
  const wire = record(value, "health event");
  const category = healthCategory(wire.category);
  const attributes = mapAttributes(category, wire.attributes);
  const projection = eventProjection(attributes);
  const metricKey = metricKeyValue(wire.metric_key, "health event.metric_key");
  const name = nonEmptyString(wire.name, "health event.name");
  const eventValue = finiteNumber(wire.value_num, "health event.value_num");
  const unit = nullableString(wire.unit, "health event.unit");
  if (metricKey !== projection.metricKey
    || name !== projection.name
    || eventValue !== projection.value
    || unit !== projection.unit) {
    throw new TypeError("health event projection does not match attributes");
  }
  return {
    id: uuid(wire.id, "health event.id"),
    occurredAt: timestamp(wire.occurred_at, "health event.occurred_at"),
    category,
    metricKey,
    name,
    value: eventValue,
    unit,
    note: nullableString(wire.note, "health event.note"),
    attributes,
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

export function mapHealthTablePage(
  value: unknown,
  scope: HealthTableScope,
): { items: HealthTableOccurrence[]; nextOffset: number | null } {
  const wire = record(value, "health table page");
  const nextOffset = wire.next_offset === null
    ? null
    : rangeInteger(wire.next_offset, "health table page.next_offset", 0, 4_294_967_295);
  return {
    items: array(wire.items, "health table page.items").map((item) => {
      const occurrence = record(item, "health table occurrence");
      return {
        key: nonEmptyString(occurrence.key, "health table occurrence.key"),
        groupKey: nullableString(occurrence.group_key, "health table occurrence.group_key"),
        groupLabel: nullableString(occurrence.group_label, "health table occurrence.group_label"),
        scope,
        record: mapHealthTableRecord(occurrence.record, scope),
      } as HealthTableOccurrence;
    }),
    nextOffset,
  };
}

export function mapHealthTableLookups(value: unknown): HealthTableLookups {
  const wire = record(value, "health table lookups");
  const result: HealthTableLookups = {};
  for (const field of [
    "meal_type", "has_photo", "tags", "bristol_scale", "blood_visible",
    "medication_unit", "metric",
  ] as const) {
    if (wire[field] === undefined) continue;
    result[field] = array(wire[field], `health table lookups.${field}`).map((item) => {
      const option = record(item, `health table lookups.${field} option`);
      return {
        id: nonEmptyString(option.id, `health table lookups.${field}.id`),
        label: nonEmptyString(option.label, `health table lookups.${field}.label`),
      };
    });
  }
  return result;
}

function mapHealthTableRecord(
  value: unknown,
  scope: HealthTableScope,
): DietTableRecord | BowelTableRecord | MedicationTableRecord | HealthMetricsTableRecord {
  const wire = record(value, "health table record");
  const kind = string(wire.kind, "health table record.kind");
  if (kind !== scope.slice("health.".length)) throw new TypeError("invalid health table record.kind");
  if (scope === "health.diet") return {
    kind: "diet",
    id: uuid(wire.id, "health diet table record.id"),
    entry: mapDietEntry(wire.entry),
    date: isoDate(wire.date, "health diet table record.date"),
    mealLabel: nonEmptyString(wire.meal_label, "health diet table record.meal_label"),
    food: nonEmptyString(wire.food, "health diet table record.food"),
    tags: array(wire.tags, "health diet table record.tags")
      .map((tag) => nonEmptyString(tag, "health diet table record.tags item")),
    hasPhoto: boolean(wire.has_photo, "health diet table record.has_photo"),
    note: string(wire.note, "health diet table record.note"),
  };
  if (scope === "health.bowel") return {
    kind: "bowel",
    id: uuid(wire.id, "health bowel table record.id"),
    event: mapHealthEvent(wire.event),
    date: isoDate(wire.date, "health bowel table record.date"),
    bristolScale: rangeInteger(wire.bristol_scale, "health bowel table record.bristol_scale", 1, 7),
    bloodVisible: boolean(wire.blood_visible, "health bowel table record.blood_visible"),
    bloodLabel: nonEmptyString(wire.blood_label, "health bowel table record.blood_label"),
    note: string(wire.note, "health bowel table record.note"),
  };
  if (scope === "health.medication") return {
    kind: "medication",
    id: uuid(wire.id, "health medication table record.id"),
    event: mapHealthEvent(wire.event),
    date: isoDate(wire.date, "health medication table record.date"),
    medicationName: nonEmptyString(wire.medication_name, "health medication table record.medication_name"),
    dose: finiteNumber(wire.dose, "health medication table record.dose"),
    unit: nonEmptyString(wire.unit, "health medication table record.unit"),
    unitLabel: nonEmptyString(wire.unit_label, "health medication table record.unit_label"),
    note: string(wire.note, "health medication table record.note"),
  };
  return {
    kind: "metrics",
    id: nonEmptyString(wire.id, "health metrics table record.id"),
    date: isoDate(wire.date, "health metrics table record.date"),
    events: array(wire.events, "health metrics table record.events").map(mapHealthEvent),
    weight: nullableNumber(wire.weight, "health metrics table record.weight"),
    sleep: nullableNumber(wire.sleep, "health metrics table record.sleep"),
    crp: nullableNumber(wire.crp, "health metrics table record.crp"),
    calprotectin: nullableNumber(wire.calprotectin, "health metrics table record.calprotectin"),
    condition: nullableNumber(wire.condition, "health metrics table record.condition"),
    note: string(wire.note, "health metrics table record.note"),
    createdAt: timestamp(wire.created_at, "health metrics table record.created_at"),
    updatedAt: timestamp(wire.updated_at, "health metrics table record.updated_at"),
  };
}

function nullableNumber(value: unknown, field: string): number | null {
  return value === null ? null : finiteNumber(value, field);
}

export function mapHealthTrends(value: unknown): HealthTrends {
  const wire = record(value, "health trends");
  return {
    days: rangeInteger(wire.days, "health trends.days", 1, 3_650),
    topDietTags: array(wire.top_diet_tags, "health trends.top_diet_tags").map(mapNamedCount),
    bowelAverageByDay: array(
      wire.bowel_average_by_day,
      "health trends.bowel_average_by_day",
    ).map((item) => {
      const row = record(item, "daily average");
      return {
        localDate: isoDate(row.local_date, "daily average.local_date"),
        average: finiteNumber(row.average, "daily average.average"),
        count: u32(row.count, "daily average.count"),
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
        metricKey: metricKeyValue(series.metric_key, "numeric series.metric_key"),
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
        dietEntries: u32(
          row.diet_entries,
          "possible tag reaction.diet_entries",
        ),
        eventsWithin24h: u32(
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
    case "weight": {
      const measured = finiteNumber(wire.value, "weight.value");
      if (measured <= 0) throw new TypeError("invalid weight.value");
      return {
        kind: category,
        metricKey: metricKeyValue(wire.metric_key, "weight.metric_key"),
        name: nonEmptyString(wire.name, "weight.name"),
        value: measured,
        unit: nonEmptyString(wire.unit, "weight.unit"),
      };
    }
    case "bowel":
      return {
        kind: category,
        bristolScale: rangeInteger(wire.bristol_scale, "bowel.bristol_scale", 1, 7),
        bloodVisible: boolean(wire.blood_visible, "bowel.blood_visible"),
      };
    case "sleep": {
      const hours = finiteNumber(wire.hours, "sleep.hours");
      if (hours <= 0 || hours > 24) throw new TypeError("invalid sleep.hours");
      return {
        kind: category,
        metricKey: metricKeyValue(wire.metric_key, "sleep.metric_key"),
        name: nonEmptyString(wire.name, "sleep.name"),
        hours,
      };
    }
    case "lab":
      return {
        kind: category,
        metricKey: metricKeyValue(wire.metric_key, "lab.metric_key"),
        name: nonEmptyString(wire.name, "lab.name"),
        value: finiteNumber(wire.value, "lab.value"),
        unit: wire.unit === undefined ? null : nullableString(wire.unit, "lab.unit"),
      };
    case "symptom":
      return {
        kind: category,
        metricKey: metricKeyValue(wire.metric_key, "symptom.metric_key"),
        name: nonEmptyString(wire.name, "symptom.name"),
        score: rangeInteger(wire.score, "symptom.score", 1, 10),
        conditionNote: nullableString(wire.condition_note, "symptom.condition_note"),
      };
    case "medication": {
      const dose = finiteNumber(wire.dose, "medication.dose");
      if (dose <= 0) throw new TypeError("invalid medication.dose");
      return {
        kind: category,
        medicationName: nonEmptyString(wire.medication_name, "medication.medication_name"),
        dose,
        unit: medicationUnit(wire.unit),
      };
    }
  }
}

function mapNamedCount(value: unknown): NamedCount {
  const wire = record(value, "named count");
  return {
    name: nonEmptyString(wire.name, "named count.name"),
    count: u32(wire.count, "named count.count"),
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

function eventProjection(attributes: HealthAttributes): {
  metricKey: string;
  name: string;
  value: number;
  unit: string | null;
} {
  switch (attributes.kind) {
    case "weight":
      return {
        metricKey: attributes.metricKey,
        name: attributes.name,
        value: attributes.value,
        unit: attributes.unit,
      };
    case "bowel":
      return {
        metricKey: "bowel",
        name: "Bowel",
        value: attributes.bristolScale,
        unit: null,
      };
    case "sleep":
      return {
        metricKey: attributes.metricKey,
        name: attributes.name,
        value: attributes.hours,
        unit: "hours",
      };
    case "lab":
      return {
        metricKey: attributes.metricKey,
        name: attributes.name,
        value: attributes.value,
        unit: attributes.unit,
      };
    case "symptom":
      return {
        metricKey: attributes.metricKey,
        name: attributes.name,
        value: attributes.score,
        unit: "score",
      };
    case "medication":
      return {
        metricKey: "medication",
        name: attributes.medicationName,
        value: attributes.dose,
        unit: attributes.unit,
      };
  }
}

function metricKeyValue(value: unknown, field: string): string {
  const result = string(value, field);
  if (!/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(result) || result.length > 64) {
    throw new TypeError(`invalid ${field}`);
  }
  return result;
}

function u32(value: unknown, field: string): number {
  return rangeInteger(value, field, 0, 4_294_967_295);
}

function rangeInteger(value: unknown, field: string, min: number, max: number): number {
  const result = safeInteger(value, field);
  if (result < min || result > max) throw new TypeError(`invalid ${field}`);
  return result;
}
