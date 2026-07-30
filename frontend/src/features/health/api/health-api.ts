import {
  type DietEntry,
  type DietInput,
  type DietUpdate,
  type EventInput,
  type EventUpdate,
  type HealthCategory,
  type HealthEvent,
  type HealthEventDetailsInput,
  type HealthTrends,
  type TimelineItem,
  mapDietEntry,
  mapHealthEvent,
  mapHealthTrends,
  mapTimelineItem,
} from "@/features/health/model/health-model";
import {
  apiPath,
  array,
  jsonRequest,
  record,
  requestJson,
  type JsonRecord,
} from "@/lib/raven-api";

const ROOT = "/api/v1/health";

export type PageQuery = { offset?: number; limit?: number };
export type EventQuery = PageQuery & { category?: HealthCategory; metricKey?: string };
export type TimelineQuery = PageQuery & {
  from?: string;
  to?: string;
  category?: HealthCategory;
  includeArchived?: boolean;
};
export type DailyMetricInput = EventInput;

export const healthApi = {
  async listDiet(query: PageQuery = {}): Promise<DietEntry[]> {
    return mapItems(
      await requestJson(apiPath(`${ROOT}/diet`, query)),
      mapDietEntry,
    );
  },
  async getDiet(id: string): Promise<DietEntry> {
    return mapDietEntry(await requestJson(`${ROOT}/diet/${segment(id)}`));
  },
  async createDiet(input: DietInput): Promise<DietEntry> {
    return mapDietEntry(await requestJson(
      `${ROOT}/diet`,
      jsonRequest("POST", dietBody(input)),
    ));
  },
  async createDietWithImage(input: {
    image: Blob;
    metadata: DietInput;
  }): Promise<DietEntry> {
    return mapDietEntry(await requestJson(`${ROOT}/diet/with-image`, {
      method: "POST",
      body: input.image,
      headers: {
        "content-type": input.image.type,
        "x-raven-diet-metadata": JSON.stringify(dietBody(input.metadata)),
      },
    }));
  },
  async updateDiet(id: string, input: DietUpdate): Promise<DietEntry> {
    return mapDietEntry(await requestJson(
      `${ROOT}/diet/${segment(id)}`,
      jsonRequest("PATCH", clean({
        occurred_at: input.occurredAt,
        meal_type: input.mealType,
        food_name: input.foodName,
        note: input.note,
        tags: input.tags,
        expected_updated_at: input.expectedUpdatedAt,
        actor: input.actor,
        reason: input.reason,
      })),
    ));
  },
  async archiveDiet(id: string): Promise<DietEntry> {
    return mapDietEntry(await transition("diet", id, "archive"));
  },
  async restoreDiet(id: string): Promise<DietEntry> {
    return mapDietEntry(await transition("diet", id, "restore"));
  },
  async purgeDiet(id: string, confirmation: string): Promise<void> {
    await purge("diet", id, confirmation);
  },
  async listEvents(query: EventQuery = {}): Promise<HealthEvent[]> {
    return mapItems(await requestJson(apiPath(`${ROOT}/events`, {
      offset: query.offset,
      limit: query.limit,
      category: query.category,
      metric_key: query.metricKey,
    })), mapHealthEvent);
  },
  async getEvent(id: string): Promise<HealthEvent> {
    return mapHealthEvent(await requestJson(`${ROOT}/events/${segment(id)}`));
  },
  async createEvent(input: EventInput): Promise<HealthEvent> {
    return mapHealthEvent(await requestJson(
      `${ROOT}/events`,
      jsonRequest("POST", eventBody(input)),
    ));
  },
  async updateEvent(id: string, input: EventUpdate): Promise<HealthEvent> {
    return mapHealthEvent(await requestJson(
      `${ROOT}/events/${segment(id)}`,
      jsonRequest("PATCH", clean({
        occurred_at: input.occurredAt,
        details: input.details === undefined ? undefined : detailsBody(input.details),
        note: input.note,
        expected_updated_at: input.expectedUpdatedAt,
        actor: input.actor,
        reason: input.reason,
      })),
    ));
  },
  async archiveEvent(id: string): Promise<HealthEvent> {
    return mapHealthEvent(await transition("events", id, "archive"));
  },
  async restoreEvent(id: string): Promise<HealthEvent> {
    return mapHealthEvent(await transition("events", id, "restore"));
  },
  async purgeEvent(id: string, confirmation: string): Promise<void> {
    await purge("events", id, confirmation);
  },
  async upsertDailyMetrics(input: DailyMetricInput[]): Promise<HealthEvent[]> {
    return mapItems(await requestJson(`${ROOT}/metrics/daily`, jsonRequest("POST", {
      metrics: input.map(eventBody),
    })), mapHealthEvent);
  },
  async timeline(query: TimelineQuery = {}): Promise<TimelineItem[]> {
    return mapItems(await requestJson(apiPath(`${ROOT}/timeline`, {
      offset: query.offset,
      limit: query.limit,
      from: query.from,
      to: query.to,
      category: query.category,
      include_archived: query.includeArchived,
    })), mapTimelineItem);
  },
  async trends(days?: number): Promise<HealthTrends> {
    return mapHealthTrends(await requestJson(apiPath(`${ROOT}/trends`, { days })));
  },
};

function dietBody(input: DietInput): JsonRecord {
  return clean({
    occurred_at: input.occurredAt,
    meal_type: input.mealType,
    food_name: input.foodName,
    note: input.note,
    tags: input.tags,
    actor: input.actor,
  });
}

function eventBody(input: EventInput): JsonRecord {
  return clean({
    occurred_at: input.occurredAt,
    details: detailsBody(input.details),
    note: input.note,
    actor: input.actor,
  });
}

function detailsBody(input: HealthEventDetailsInput): JsonRecord {
  switch (input.kind) {
    case "weight":
      return clean({
        kind: input.kind, value: input.value, key: input.key, name: input.name, unit: input.unit,
      });
    case "bowel":
      return clean({
        kind: input.kind,
        bristol_scale: input.bristolScale,
        blood_visible: input.bloodVisible,
      });
    case "sleep":
      return clean({ kind: input.kind, value: input.value, key: input.key, name: input.name });
    case "lab":
      return clean({
        kind: input.kind,
        key: input.key,
        name: input.name,
        value: input.value,
        unit: input.unit,
      });
    case "symptom":
      return clean({
        kind: input.kind,
        key: input.key,
        name: input.name,
        score: input.score,
        condition_note: input.conditionNote,
      });
    case "overall_condition":
      return clean({
        kind: input.kind,
        name: input.name,
        score: input.score,
        condition_note: input.conditionNote,
      });
    case "medication":
      return {
        kind: input.kind,
        medication_name: input.medicationName,
        dose: input.dose,
        unit: input.unit,
      };
  }
}

async function transition(
  kind: "diet" | "events",
  id: string,
  action: "archive" | "restore",
): Promise<unknown> {
  return requestJson(`${ROOT}/${kind}/${segment(id)}/${action}`, { method: "POST" });
}

async function purge(
  kind: "diet" | "events",
  id: string,
  confirmation: string,
): Promise<void> {
  await requestJson(
    `${ROOT}/${kind}/${segment(id)}/purge`,
    jsonRequest("DELETE", { confirmation }),
  );
}

function mapItems<T>(value: unknown, mapper: (value: unknown) => T): T[] {
  const wire = record(value, "items response");
  return array(wire.items, "items response.items").map(mapper);
}

function clean(value: Record<string, unknown>): JsonRecord {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function segment(value: string): string {
  return encodeURIComponent(value);
}
