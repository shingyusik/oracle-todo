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
    const projection = {
      weight: { name: "Body weight", value: 71.5, unit: "kg" },
      bowel: { name: "Bowel", value: 4, unit: null },
      sleep: { name: "Sleep", value: 7.5, unit: "hours" },
      lab: { name: "Glucose", value: 90, unit: null },
      symptom: { name: "Headache", value: 3, unit: "score" },
      medication: { name: "Vitamin", value: 1, unit: "tablet" },
    }[category as "weight"];
    expect(mapHealthEvent({
      ...base,
      category,
      metric_key: metricKey,
      name: projection.name,
      value_num: projection.value,
      unit: projection.unit,
      attributes,
    })).toMatchObject({ category, metricKey, attributes: mappedAttributes });
  });

  it.each([
    ["weight", "body_weight", "Body weight", 0, "kg",
      { metric_key: "body_weight", name: "Body weight", value: 0, unit: "kg" }],
    ["bowel", "bowel", "Bowel", 3, null,
      { bristol_scale: 4, blood_visible: false }],
    ["sleep", "sleep_duration", "Sleep", 25, "hours",
      { metric_key: "sleep_duration", name: "Sleep", hours: 25 }],
    ["lab", "Bad_Key", "Lab", 1, null,
      { metric_key: "Bad_Key", name: "Lab", value: 1 }],
    ["symptom", "headache", "Different", 3, "score",
      { metric_key: "headache", name: "Headache", score: 3, condition_note: null }],
    ["medication", "medication", "Vitamin", -1, "tablet",
      { medication_name: "Vitamin", dose: -1, unit: "tablet" }],
  ])("rejects impossible or contradictory %s projections", (
    category,
    metricKey,
    name,
    value,
    unit,
    attributes,
  ) => {
    expect(() => mapHealthEvent({
      ...base,
      category,
      metric_key: metricKey,
      name,
      value_num: value,
      unit,
      attributes,
    })).toThrow();
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

  it("rejects impossible Diet and trend bounds", () => {
    const diet = {
      ...base,
      meal_type: "lunch",
      food_name: "x".repeat(121),
      tags: [],
      media_id: null,
    };
    expect(() => mapTimelineItem({ kind: "diet", record: diet })).toThrow();
    const trends = {
      days: 0,
      top_diet_tags: [],
      bowel_average_by_day: [],
      symptom_frequencies: [],
      medication_frequencies: [],
      numeric_series: [],
      possible_tag_reactions: [],
      reaction_disclaimer: "Descriptive only.",
    };
    expect(() => mapHealthTrends(trends)).toThrow();
  });

  it("uploads image bytes with ASCII-safe Unicode metadata", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ...base,
      meal_type: "lunch",
      food_name: "비빔밥😀",
      tags: ["매운맛"],
      media_id: "00000000-0000-4000-8000-000000000002",
    }), { status: 201, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const bytes = new Blob(["png"], { type: "image/png" });

    await healthApi.createDietWithImage({
      image: bytes,
      metadata: {
        occurredAt: "2026-07-31T01:00:00Z",
        mealType: "lunch",
        foodName: "비빔밥😀",
        tags: ["매운맛"],
      },
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get("content-type")).toBe("image/png");
    const metadata = headers.get("x-raven-diet-metadata") ?? "";
    expect([...metadata].every((character) => character.charCodeAt(0) <= 0x7f)).toBe(true);
    expect(JSON.parse(metadata)).toMatchObject({
      food_name: "비빔밥😀",
      tags: ["매운맛"],
    });
  });

  it("serializes Diet updates identically for JSON and image replacement", async () => {
    const response = {
      ...base,
      meal_type: "dinner",
      food_name: "Soup",
      tags: ["warm"],
      media_id: "00000000-0000-4000-8000-000000000002",
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(response), {
        status: 200,
        headers: { "content-type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify(response), {
        status: 200,
        headers: { "content-type": "application/json" },
      }));
    vi.stubGlobal("fetch", fetchMock);
    const metadata = {
      foodName: "Soup",
      expectedUpdatedAt: base.updated_at,
      reason: null,
      removeImage: true,
    };

    await healthApi.updateDiet(base.id, metadata);
    const updated = await healthApi.updateDietWithImage(base.id, {
      image: new Blob(["png"], { type: "image/png" }),
      metadata,
    });

    const [, jsonInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const [imageUrl, imageInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    const expectedBody = {
      food_name: "Soup",
      expected_updated_at: base.updated_at,
      reason: null,
      remove_image: true,
    };
    expect(JSON.parse(String(jsonInit.body))).toEqual(expectedBody);
    expect(imageUrl).toBe(`/api/v1/health/diet/${base.id}/with-image`);
    expect(new Headers(imageInit.headers).get("content-type")).toBe("image/png");
    expect(JSON.parse(
      new Headers(imageInit.headers).get("x-raven-diet-metadata") ?? "",
    )).toEqual(expectedBody);
    expect(updated).toMatchObject({ foodName: "Soup", mediaId: response.media_id });
  });

  it("serializes overall condition as a supported daily metric identity", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      items: [],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await healthApi.upsertDailyMetrics([{
      occurredAt: "2026-07-31T01:00:00Z",
      details: {
        kind: "overall_condition",
        score: 3,
        conditionNote: "Mild headache",
      },
    }]);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      metrics: [{
        occurred_at: "2026-07-31T01:00:00Z",
        details: {
          kind: "overall_condition",
          score: 3,
          condition_note: "Mild headache",
        },
      }],
    });
  });
});
