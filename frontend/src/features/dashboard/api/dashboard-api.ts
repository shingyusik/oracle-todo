import {
  array,
  finiteNumber,
  id,
  isoDate,
  nonEmptyString,
  record,
  safeInteger,
  string,
  timestamp,
  uuid,
} from "@/lib/raven-api";
import { requestJson } from "@/lib/raven-api";

export type DomainProjection<T> =
  | { status: "ok"; data: T }
  | { status: "error"; code: string; message: string; requestId: string };
export type TodoDashboard = {
  active: number;
  todayCompleted: number;
  todayIncomplete: number;
  todayMissed: number;
  todayTotal: number;
  overdue: number;
};
export type LedgerDashboard = {
  periodStart: string;
  periodEnd: string;
  currencies: {
    currencyCode: string;
    incomeMinor: number;
    expenseMinor: number;
    netChangeMinor: number;
  }[];
};
export type HealthMetricDashboard = {
  timestamp: string;
  name: string;
  value: number;
  unit: string | null;
};
export type HealthDashboard = {
  latestCondition: HealthMetricDashboard | null;
  latestSleep: HealthMetricDashboard | null;
  latestBowel: HealthMetricDashboard | null;
  latestMedication: HealthMetricDashboard | null;
  recentDietTags: string[];
};
export type RavenDashboard = {
  requestId: string;
  todo: DomainProjection<TodoDashboard>;
  ledger: DomainProjection<LedgerDashboard>;
  health: DomainProjection<HealthDashboard>;
  recentActivity: {
    domain: "todo" | "ledger" | "health";
    action: string;
    recordId: string;
    timestamp: string;
  }[];
};

export async function fetchDashboard(): Promise<RavenDashboard> {
  return requestJson("/api/v1/dashboard", undefined, mapDashboard);
}

export function mapDashboard(value: unknown): RavenDashboard {
  const wire = record(value, "dashboard");
  const activity = array(wire.recent_activity, "dashboard.recent_activity");
  if (activity.length > 20) throw new TypeError("invalid dashboard.recent_activity");
  return {
    requestId: uuid(wire.request_id, "dashboard.request_id"),
    todo: projection(wire.todo, mapTodo),
    ledger: projection(wire.ledger, mapLedger),
    health: projection(wire.health, mapHealth),
    recentActivity: activity.map((item) => {
      const row = record(item, "dashboard activity");
      const domain = string(row.domain, "dashboard activity.domain");
      if (domain !== "todo" && domain !== "ledger" && domain !== "health") {
        throw new TypeError("invalid dashboard activity.domain");
      }
      return {
        domain,
        action: nonEmptyString(row.action, "dashboard activity.action"),
        recordId: id(row.record_id, "dashboard activity.record_id"),
        timestamp: timestamp(row.timestamp, "dashboard activity.timestamp"),
      };
    }),
  };
}

function projection<T>(value: unknown, mapper: (value: unknown) => T): DomainProjection<T> {
  const wire = record(value, "dashboard projection");
  const status = string(wire.status, "dashboard projection.status");
  if (status === "ok") return { status, data: mapper(wire.data) };
  if (status === "error") {
    return {
      status,
      code: nonEmptyString(wire.code, "dashboard projection.code"),
      message: string(wire.message, "dashboard projection.message"),
      requestId: uuid(wire.request_id, "dashboard projection.request_id"),
    };
  }
  throw new TypeError("invalid dashboard projection.status");
}

function mapTodo(value: unknown): TodoDashboard {
  const wire = record(value, "todo dashboard");
  return {
    active: count(wire.active, "todo dashboard.active"),
    todayCompleted: count(wire.today_completed, "todo dashboard.today_completed"),
    todayIncomplete: count(wire.today_incomplete, "todo dashboard.today_incomplete"),
    todayMissed: count(wire.today_missed, "todo dashboard.today_missed"),
    todayTotal: count(wire.today_total, "todo dashboard.today_total"),
    overdue: count(wire.overdue, "todo dashboard.overdue"),
  };
}

function mapLedger(value: unknown): LedgerDashboard {
  const wire = record(value, "ledger dashboard");
  return {
    periodStart: isoDate(wire.period_start, "ledger dashboard.period_start"),
    periodEnd: isoDate(wire.period_end, "ledger dashboard.period_end"),
    currencies: array(wire.currencies, "ledger dashboard.currencies").map((item) => {
      const row = record(item, "ledger dashboard currency");
      return {
        currencyCode: nonEmptyString(
          row.currency_code,
          "ledger dashboard currency.currency_code",
        ),
        incomeMinor: safeInteger(
          row.income_minor,
          "ledger dashboard currency.income_minor",
        ),
        expenseMinor: safeInteger(
          row.expense_minor,
          "ledger dashboard currency.expense_minor",
        ),
        netChangeMinor: safeInteger(
          row.net_change_minor,
          "ledger dashboard currency.net_change_minor",
        ),
      };
    }),
  };
}

function mapHealth(value: unknown): HealthDashboard {
  const wire = record(value, "health dashboard");
  return {
    latestCondition: nullableMetric(wire.latest_condition),
    latestSleep: nullableMetric(wire.latest_sleep),
    latestBowel: nullableMetric(wire.latest_bowel),
    latestMedication: nullableMetric(wire.latest_medication),
    recentDietTags: array(wire.recent_diet_tags, "health dashboard.recent_diet_tags")
      .map((tag) => nonEmptyString(tag, "health dashboard.recent_diet_tags[]")),
  };
}

function nullableMetric(value: unknown): HealthMetricDashboard | null {
  if (value === null) return null;
  const wire = record(value, "health dashboard metric");
  return {
    timestamp: timestamp(wire.timestamp, "health dashboard metric.timestamp"),
    name: nonEmptyString(wire.name, "health dashboard metric.name"),
    value: finiteNumber(wire.value, "health dashboard metric.value"),
    unit: wire.unit === null ? null : string(wire.unit, "health dashboard metric.unit"),
  };
}

function count(value: unknown, field: string): number {
  const result = safeInteger(value, field);
  if (result < 0) throw new TypeError(`invalid ${field}`);
  return result;
}
