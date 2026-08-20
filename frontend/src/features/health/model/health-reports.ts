import {
  array,
  finiteNumber,
  nonEmptyString,
  nullableString,
  record,
  safeInteger,
  string,
  timestamp,
} from "@/lib/raven-api";
import {
  clonePlannerTableSettings,
  localCalendarDate,
  type PlannerFilterField,
  type PlannerFilterRule,
  type PlannerTableSettings,
} from "@/features/workbench/model/planner-model";

export type HealthReportSelection =
  | { preset: 7 | 14 | 30 | 90 }
  | { preset: "custom"; from: string; to: string };

type HealthReportDrilldownRange = {
  range: { start: string; end: string };
};
type HealthMetricDrilldownField = "weight" | "sleep" | "crp" | "calprotectin" | "condition";
export type HealthReportDrilldown = HealthReportDrilldownRange & (
  | { tab: "diet"; field?: never; value?: never }
  | { tab: "diet"; field: "tags"; value: string }
  | { tab: "bowel"; field?: never; value?: never }
  | { tab: "bowel"; field: "bristol_scale"; value?: never }
  | { tab: "medication"; field?: never; value?: never }
  | { tab: "medication"; field: "medication_name"; value: string }
  | { tab: "health-metrics"; field?: never; value?: never }
  | { tab: "health-metrics"; field: HealthMetricDrilldownField; value?: never }
);

export type HealthReportRangeResult =
  | { ok: true; range: { start: string; end: string } }
  | { ok: false; error: "invalid_date" | "invalid_order" | "range_too_long" };

export type HealthReportMetric =
  | "body_weight" | "sleep_duration" | "crp"
  | "fecal_calprotectin" | "overall_condition";
export type HealthReportRange = { from: string; to: string };
export type HealthReportReading = { localDate: string; occurredAt: string; value: number };
export type HealthReportMetricSummary = {
  metric: HealthReportMetric;
  name: string;
  unit: string | null;
  current: HealthReportReading | null;
  previous: HealthReportReading | null;
};
export type HealthReportMetricSeries = {
  metric: HealthReportMetric;
  points: HealthReportReading[];
};
export type HealthReport = {
  range: HealthReportRange;
  previousRange: HealthReportRange;
  metrics: HealthReportMetricSummary[];
  dietCount: { current: number | null; previous: number | null };
  bowel: {
    currentCount: number | null;
    previousCount: number | null;
    currentAverage: number | null;
    previousAverage: number | null;
  };
  medicationCount: { current: number | null; previous: number | null };
  bowelPoints: { localDate: string; occurredAt: string; bristolScale: number }[];
  metricSeries: HealthReportMetricSeries[];
  medicationFrequencies: { name: string; count: number }[];
  dietTagFrequencies: { name: string; count: number }[];
  dietTagBowelResponses: {
    tag: string;
    positiveMeals: number;
    eligibleMeals: number;
    rate: number;
  }[];
  reactionDisclaimer: string;
};

const metrics = [
  "body_weight", "sleep_duration", "crp", "fecal_calprotectin", "overall_condition",
] as const satisfies readonly HealthReportMetric[];
const metricUnits = ["kg", "hours", "mg/L", "µg/g", null] as const;

export function resolveHealthReportRange(
  selection: HealthReportSelection,
  now: Date = new Date(),
): HealthReportRangeResult {
  if (selection.preset !== "custom") {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    start.setDate(start.getDate() - selection.preset + 1);
    return {
      ok: true,
      range: { start: localCalendarDate(start), end: localCalendarDate(now) },
    };
  }
  if (!validIsoDate(selection.from) || !validIsoDate(selection.to)) {
    return { ok: false, error: "invalid_date" };
  }
  if (selection.from > selection.to) return { ok: false, error: "invalid_order" };
  if (calendarDay(selection.to) - calendarDay(selection.from) + 1 > 366) {
    return { ok: false, error: "range_too_long" };
  }
  return { ok: true, range: { start: selection.from, end: selection.to } };
}

export function applyHealthReportDrilldown(
  settings: PlannerTableSettings,
  target: HealthReportDrilldown,
): PlannerTableSettings {
  const result = clonePlannerTableSettings(settings);
  result.filterMode = "and";
  result.filterRules = [{
    id: "health-report-date",
    field: "date",
    type: "date",
    operator: "is_between",
    value: { ...target.range },
  }];
  const rule = drilldownRule(target);
  if (rule) result.filterRules.push(rule);
  return result;
}

export function mapHealthReport(value: unknown): HealthReport {
  const wire = record(value, "health report");
  const mappedMetrics = fixedArray(wire.metrics, "health report.metrics").map((value, index) => {
    const row = record(value, "health report metric");
    const metric = fixedMetric(row.metric, index, "health report metric.metric");
    const unit = nullableString(row.unit, "health report metric.unit");
    if (unit !== metricUnits[index]) throw new TypeError("invalid health report metric.unit");
    return {
      metric,
      name: nonEmptyString(row.name, "health report metric.name"),
      unit,
      current: nullable(row.current, mapReading),
      previous: nullable(row.previous, mapReading),
    };
  });
  return {
    range: mapRange(wire.range),
    previousRange: mapRange(wire.previous_range),
    metrics: mappedMetrics,
    dietCount: mapCountComparison(wire.diet_count),
    bowel: mapBowel(wire.bowel),
    medicationCount: mapCountComparison(wire.medication_count),
    bowelPoints: chronological(array(wire.bowel_points, "health report.bowel_points").map((value) => {
      const row = record(value, "health report bowel point");
      return {
        localDate: wireDate(row.local_date, "health report bowel point.local_date"),
        occurredAt: timestamp(row.occurred_at, "health report bowel point.occurred_at"),
        bristolScale: integer(row.bristol_scale, "health report bowel point.bristol_scale", 1, 7),
      };
    })),
    metricSeries: fixedArray(wire.metric_series, "health report.metric_series")
      .map((value, index) => {
        const row = record(value, "health report metric series");
        return {
          metric: fixedMetric(row.metric, index, "health report metric series.metric"),
          points: chronological(array(row.points, "health report metric series.points").map(mapReading)),
        };
      }),
    medicationFrequencies: array(
      wire.medication_frequencies, "health report.medication_frequencies",
    ).map(mapNamedCount),
    dietTagFrequencies: array(
      wire.diet_tag_frequencies, "health report.diet_tag_frequencies",
    ).map(mapNamedCount),
    dietTagBowelResponses: array(
      wire.diet_tag_bowel_responses, "health report.diet_tag_bowel_responses",
    ).map((value) => {
      const row = record(value, "health report tag bowel response");
      const rate = finiteNumber(row.rate, "health report tag bowel response.rate");
      if (rate < 0 || rate > 1) throw new TypeError("invalid health report tag bowel response.rate");
      const positiveMeals = u32(
        row.positive_meals, "health report tag bowel response.positive_meals",
      );
      const eligibleMeals = u32(
        row.eligible_meals, "health report tag bowel response.eligible_meals",
      );
      if (positiveMeals > eligibleMeals
        || (eligibleMeals === 0 && rate !== 0)
        || (eligibleMeals > 0 && Math.abs(rate - positiveMeals / eligibleMeals) > 1e-12)) {
        throw new TypeError("invalid health report tag bowel response aggregate");
      }
      return {
        tag: nonEmptyString(row.tag, "health report tag bowel response.tag"),
        positiveMeals,
        eligibleMeals,
        rate,
      };
    }),
    reactionDisclaimer: nonEmptyString(
      wire.reaction_disclaimer, "health report.reaction_disclaimer",
    ),
  };
}

function drilldownRule(target: HealthReportDrilldown): PlannerFilterRule | null {
  const value = target as { tab: string; field?: string; value?: unknown };
  if (!["diet", "bowel", "medication", "health-metrics"].includes(value.tab)) {
    throw new TypeError("invalid health report drilldown");
  }
  if (value.field === undefined) {
    if (value.value !== undefined) throw new TypeError("invalid health report drilldown");
    return null;
  }
  if (value.tab === "diet" && value.field === "tags"
    && typeof value.value === "string" && value.value.length > 0) {
    return targetRule("tags", "multiSelect", "contains", [value.value]);
  }
  if (value.tab === "bowel" && value.field === "bristol_scale" && value.value === undefined) {
    return targetRule("bristol_scale", "select", "is", ["1", "2", "6", "7"]);
  }
  if (value.tab === "medication" && value.field === "medication_name"
    && typeof value.value === "string" && value.value.length > 0) {
    return targetRule("medication_name", "text", "is", value.value);
  }
  if (value.tab === "health-metrics" && metricDrilldownFields.has(value.field)
    && value.value === undefined) {
    return targetRule(value.field as HealthMetricDrilldownField, "number", "is_not_empty", null);
  }
  throw new TypeError("invalid health report drilldown");
}

const metricDrilldownFields = new Set<string>([
  "weight", "sleep", "crp", "calprotectin", "condition",
]);

function targetRule(
  field: PlannerFilterField,
  type: PlannerFilterRule["type"],
  operator: PlannerFilterRule["operator"],
  value: PlannerFilterRule["value"],
): PlannerFilterRule {
  return { id: `health-report-${field}`, field, type, operator, value };
}

function mapRange(value: unknown): HealthReportRange {
  const row = record(value, "health report range");
  return {
    from: wireDate(row.from, "health report range.from"),
    to: wireDate(row.to, "health report range.to"),
  };
}

function mapReading(value: unknown): HealthReportReading {
  const row = record(value, "health report reading");
  return {
    localDate: wireDate(row.local_date, "health report reading.local_date"),
    occurredAt: timestamp(row.occurred_at, "health report reading.occurred_at"),
    value: finiteNumber(row.value, "health report reading.value"),
  };
}

function mapCountComparison(value: unknown) {
  const row = record(value, "health report count comparison");
  return {
    current: nullable(row.current, positiveU32),
    previous: nullable(row.previous, positiveU32),
  };
}

function mapBowel(value: unknown) {
  const row = record(value, "health report bowel");
  const result = {
    currentCount: nullable(row.current_count, positiveU32),
    previousCount: nullable(row.previous_count, positiveU32),
    currentAverage: nullable(row.current_average, (item) => finiteNumber(item, "health report bowel.current_average")),
    previousAverage: nullable(row.previous_average, (item) => finiteNumber(item, "health report bowel.previous_average")),
  };
  validBowelAggregate(result.currentCount, result.currentAverage);
  validBowelAggregate(result.previousCount, result.previousAverage);
  return result;
}

function mapNamedCount(value: unknown) {
  const row = record(value, "health report named count");
  return {
    name: nonEmptyString(row.name, "health report named count.name"),
    count: positiveU32(row.count, "health report named count.count"),
  };
}

function fixedArray(value: unknown, field: string): unknown[] {
  const result = array(value, field);
  if (result.length !== metrics.length) throw new TypeError(`invalid ${field}`);
  return result;
}

function fixedMetric(value: unknown, index: number, field: string): HealthReportMetric {
  const result = string(value, field);
  if (result !== metrics[index]) throw new TypeError(`invalid ${field}`);
  return result as HealthReportMetric;
}

function nullable<T>(value: unknown, mapper: (value: unknown, field?: string) => T): T | null {
  return value === null ? null : mapper(value);
}

function u32(value: unknown, field = "health report count"): number {
  return integer(value, field, 0, 4_294_967_295);
}

function positiveU32(value: unknown, field = "health report count"): number {
  return integer(value, field, 1, 4_294_967_295);
}

function integer(value: unknown, field: string, min: number, max: number): number {
  const result = safeInteger(value, field);
  if (result < min || result > max) throw new TypeError(`invalid ${field}`);
  return result;
}

function chronological<T extends { occurredAt: string }>(points: T[]): T[] {
  if (points.some((point, index) => index > 0
    && Date.parse(point.occurredAt) < Date.parse(points[index - 1]!.occurredAt))) {
    throw new TypeError("invalid health report point order");
  }
  return points;
}

function wireDate(value: unknown, field: string): string {
  const parts = array(value, field);
  if (parts.length !== 2) throw new TypeError(`invalid ${field}`);
  const year = integer(parts[0], field, 0, 9_999);
  const ordinal = integer(parts[1], field, 1, leapYear(year) ? 366 : 365);
  let month = 1;
  let day = ordinal;
  while (day > daysInMonth(year, month)) day -= daysInMonth(year, month++);
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function validIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

function validBowelAggregate(count: number | null, average: number | null): void {
  if ((count === null) !== (average === null)
    || (average !== null && (average < 1 || average > 7))) {
    throw new TypeError("invalid health report bowel aggregate");
  }
}

function calendarDay(value: string): number {
  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  const priorYear = year - 1;
  let ordinal = day;
  for (let current = 1; current < month; current += 1) ordinal += daysInMonth(year, current);
  return priorYear * 365 + Math.floor(priorYear / 4) - Math.floor(priorYear / 100)
    + Math.floor(priorYear / 400) + ordinal;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return leapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function leapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}
