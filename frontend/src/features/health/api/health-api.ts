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
  type HealthTableLookups,
  type HealthTableScope,
  type TimelineItem,
  mapDietEntry,
  mapHealthEvent,
  mapHealthTrends,
  mapHealthTableLookups,
  mapHealthTablePage,
  mapTimelineItem,
} from "@/features/health/model/health-model";
import type { PlannerTableSettings } from "@/features/workbench/model/planner-model";
import { localCalendarDate } from "@/features/workbench/model/planner-model";
import { tableFilterValue } from "@/features/workbench/model/table-query";
import {
  mapHealthReport,
  type HealthReport,
} from "@/features/health/model/health-reports";
import {
  apiPath,
  array,
  jsonRequest,
  record,
  requestJson,
  type JsonObject,
  type JsonValue,
} from "@/lib/raven-api";

const ROOT = "/api/v1/health";

export type PageQuery = { offset?: number; limit?: number };
export type EventQuery = PageQuery & {
  category?: HealthCategory;
  metricKey?: string;
  dailyOnly?: boolean;
};
export type TimelineQuery = PageQuery & {
  from?: string;
  to?: string;
  category?: HealthCategory;
  includeArchived?: boolean;
};
export type DailyMetricDetailsInput = Extract<
  HealthEventDetailsInput,
  { kind: "weight" | "sleep" | "lab" | "overall_condition" }
>;
export type DailyMetricInput = Omit<EventInput, "details"> & {
  details: DailyMetricDetailsInput;
  expectedUpdatedAt?: string;
};
export type DailyMetricArchiveInput = { id: string; expectedUpdatedAt?: string };
export type DailyMetricsMutation = {
  metrics: DailyMetricInput[];
  archives: DailyMetricArchiveInput[];
};
export type HealthTablePage = ReturnType<typeof mapHealthTablePage>;

export const healthApi = {
  async queryTable(
    scope: HealthTableScope,
    settings: PlannerTableSettings,
    offset = 0,
    referenceDate: Pick<Date, "getFullYear" | "getMonth" | "getDate"> = new Date(),
  ): Promise<HealthTablePage> {
    return mapHealthTablePage(await requestJson(
      `${ROOT}/table/query`,
      jsonRequest("POST", {
        scope,
        offset,
        limit: 50,
        filter_mode: settings.filterMode,
        filters: settings.filterRules.map((rule) => ({
          field: rule.field,
          operator: rule.operator,
          value: tableFilterValue(rule.value, rule.operator),
        })),
        sorts: settings.sortRules.map((rule) => ({
          field: rule.field,
          direction: rule.direction,
        })),
        group_by: settings.groupSettings.groupBy,
        group_settings: {
          sort: settings.groupSettings.sort,
          hide_empty: settings.groupSettings.hideEmpty,
          manual_order: settings.groupSettings.manualOrder,
          hidden_group_keys: settings.groupSettings.hiddenGroupKeys,
        },
        context: { reference_date: localCalendarDate(referenceDate) },
      }),
    ), scope);
  },
  async tableLookups(scope: HealthTableScope): Promise<HealthTableLookups> {
    return mapHealthTableLookups(await requestJson(apiPath(`${ROOT}/table/lookups`, { scope })));
  },
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
        "x-raven-diet-metadata": asciiJson(dietBody(input.metadata)),
      },
    }));
  },
  async updateDiet(id: string, input: DietUpdate): Promise<DietEntry> {
    return mapDietEntry(await requestJson(
      `${ROOT}/diet/${segment(id)}`,
      jsonRequest("PATCH", dietUpdateBody(input)),
    ));
  },
  async updateDietWithImage(id: string, input: {
    image: Blob;
    metadata: DietUpdate;
  }): Promise<DietEntry> {
    return mapDietEntry(await requestJson(`${ROOT}/diet/${segment(id)}/with-image`, {
      method: "PATCH",
      body: input.image,
      headers: {
        "content-type": input.image.type,
        "x-raven-diet-metadata": asciiJson(dietUpdateBody(input.metadata)),
      },
    }));
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
      daily_only: query.dailyOnly,
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
      metrics: input.map(dailyMetricBody),
    })), mapHealthEvent);
  },
  async saveDailyMetrics(input: DailyMetricsMutation): Promise<HealthEvent[]> {
    return mapItems(await requestJson(`${ROOT}/metrics/daily`, jsonRequest("POST", {
      metrics: input.metrics.map(dailyMetricBody),
      archives: input.archives.map((archive) => clean({
        id: archive.id,
        expected_updated_at: archive.expectedUpdatedAt,
      })),
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
  async reports(query: { from: string; to: string }): Promise<HealthReport> {
    return mapHealthReport(await requestJson(apiPath(`${ROOT}/reports`, query)));
  },
};

function dietBody(input: DietInput): JsonObject {
  return clean({
    occurred_at: input.occurredAt,
    meal_type: input.mealType,
    food_name: input.foodName,
    note: input.note,
    tags: input.tags,
    actor: input.actor,
  });
}

function dailyMetricBody(input: DailyMetricInput): JsonObject {
  return clean({
    ...eventBody(input),
    expected_updated_at: input.expectedUpdatedAt,
  });
}

function dietUpdateBody(input: DietUpdate): JsonObject {
  return clean({
    occurred_at: input.occurredAt,
    meal_type: input.mealType,
    food_name: input.foodName,
    note: input.note,
    tags: input.tags,
    expected_updated_at: input.expectedUpdatedAt,
    actor: input.actor,
    reason: input.reason,
    remove_image: input.removeImage,
  });
}

function eventBody(input: EventInput): JsonObject {
  return clean({
    occurred_at: input.occurredAt,
    details: detailsBody(input.details),
    note: input.note,
    actor: input.actor,
  });
}

function detailsBody(input: HealthEventDetailsInput): JsonObject {
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

function clean(value: Record<string, JsonValue | undefined>): JsonObject {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as JsonObject;
}

function segment(value: string): string {
  return encodeURIComponent(value);
}

function asciiJson(value: JsonObject): string {
  return JSON.stringify(value).replace(
    /[^\x20-\x7e]/g,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}
