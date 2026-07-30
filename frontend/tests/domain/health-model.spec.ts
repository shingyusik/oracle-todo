import { afterEach, describe, expect, it, vi } from "vitest";

import { healthApi } from "@/features/health/api/health-api";
import {
  mapHealthEvent,
  mapHealthTrends,
  mapTimelineItem,
} from "@/features/health/model/health-model";

afterEach(() => vi.unstubAllGlobals());

const base = {
  id: "00000000-0000-4000-8000-000000000001",
  occurred_at: "2026-07-31T01:00:00Z",
  created_at: "2026-07-31T01:00:00Z",
  updated_at: "2026-07-31T01:00:00Z",
  deleted_at: null,
  note: null,
};

describe("Health wire boundary", () => {
  it.each([
    ["weight", "body_weight",
      { metric_key: "body_weight", name: "Body weight", value: 71.5, unit: "kg" },
      { kind: "weight", metricKey: "body_weight", name: "Body weight", value: 71.5, unit: "kg" }],
    ["bowel", "bowel",
      { bristol_scale: 4, blood_visible: false },
      { kind: "bowel", bristolScale: 4, bloodVisible: false }],
    ["sleep", "sleep_duration",
      { metric_key: "sleep_duration", name: "Sleep", hours: 7.5 },
      { kind: "sleep", metricKey: "sleep_duration", name: "Sleep", hours: 7.5 }],
    ["lab", "glucose",
      { metric_key: "glucose", name: "Glucose", value: 90 },
      { kind: "lab", metricKey: "glucose", name: "Glucose", value: 90, unit: null }],
    ["symptom", "headache",
      { metric_key: "headache", name: "Headache", score: 3, condition_note: null },
      { kind: "symptom", metricKey: "headache", name: "Headache", score: 3,
        conditionNote: null }],
    ["medication", "medication",
      { medication_name: "Vitamin", dose: 1, unit: "tablet" },
      { kind: "medication", medicationName: "Vitamin", dose: 1, unit: "tablet" }],
  ])("maps %s events with category-specific attributes", (
    category,
    metricKey,
    attributes,
    mappedAttributes,
  ) => {
    const valueNum = category === "sleep" ? 7.5 : category === "weight" ? 71.5 : 1;
    expect(mapHealthEvent({
      ...base,
      category,
      metric_key: metricKey,
      name: category,
      value_num: valueNum,
      unit: null,
      attributes,
    })).toMatchObject({ category, metricKey, attributes: mappedAttributes });
  });

  it("maps tagged timeline records and trends", () => {
    expect(mapTimelineItem({
      kind: "diet",
      record: {
        ...base,
        meal_type: "lunch",
        food_name: "Salad",
        tags: ["vegetable"],
        media_id: null,
      },
    })).toMatchObject({ kind: "diet", record: { mealType: "lunch" } });
    expect(mapHealthTrends({
      days: 30,
      top_diet_tags: [{ name: "vegetable", count: 2 }],
      bowel_average_by_day: [{ local_date: "2026-07-31", average: 4, count: 1 }],
      symptom_frequencies: [],
      medication_frequencies: [],
      numeric_series: [{
        category: "weight", metric_key: "body_weight", name: "Weight", unit: "kg",
        points: [{ occurred_at: "2026-07-31T01:00:00Z", value: 71.5 }],
      }],
      possible_tag_reactions: [{ tag: "spicy", diet_entries: 2, events_within_24h: 1 }],
      reaction_disclaimer: "Descriptive only.",
    }).numericSeries[0]?.points[0]).toEqual({
      occurredAt: "2026-07-31T01:00:00Z",
      value: 71.5,
    });
  });

  it("uploads image bytes without forcing JSON content type", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ...base,
      meal_type: "lunch",
      food_name: "Salad",
      tags: [],
      media_id: "00000000-0000-4000-8000-000000000002",
    }), { status: 201, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const bytes = new Blob(["png"], { type: "image/png" });

    await healthApi.createDietWithImage({
      image: bytes,
      metadata: {
        occurredAt: "2026-07-31T01:00:00Z",
        mealType: "lunch",
        foodName: "Salad",
      },
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get("content-type")).toBe("image/png");
    expect(headers.get("x-raven-diet-metadata")).toContain('"food_name":"Salad"');
  });
});
