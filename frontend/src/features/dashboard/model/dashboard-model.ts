import type { WorkspaceItemModel } from "@/features/workbench/model/workbench-model";
import type {
  DomainProjection,
  RavenDashboard,
} from "@/features/dashboard/api/dashboard-api";

export type ProjectAttention = "normal" | "attention" | "risk";

export type DashboardDateRange = { start: string; end: string };
export type DashboardDateRangeError = "invalid" | "too-long";

export type TodayOutcomes = {
  date: string;
  completed: number;
  incomplete: number;
  missed: number;
  total: number;
};

export type CompletionDay = { date: string; completed: number };

export type CompletionHistory = {
  range: DashboardDateRange;
  days: CompletionDay[];
};

export type DashboardStatusKey =
  | "completed"
  | "incomplete"
  | "paused"
  | "missed";

export type DashboardStatusValues = Record<DashboardStatusKey, number>;

export type DashboardHeatmapRow = {
  id: string;
  title: string;
  values: DashboardStatusValues;
  percentages: DashboardStatusValues;
  total: number;
};

export type DashboardProjectRow = DashboardHeatmapRow & {
  progress: number | null;
  attention: ProjectAttention;
};

export type DashboardSnapshot = {
  areas: DashboardHeatmapRow[];
  projects: DashboardProjectRow[];
  todayOutcomes: TodayOutcomes;
  completionHistory: CompletionHistory;
};

export type UnifiedTodoSummary = {
  active: number;
  completed: number;
  incomplete: number;
  missed: number;
  total: number;
  overdue: number;
};

export type UnifiedLedgerSummary = {
  periodStart: string;
  periodEnd: string;
  currencies: Array<{
    currencyCode: string;
    incomeMinor: string;
    expenseMinor: string;
    netChangeMinor: string;
    unitLabel: string;
  }>;
};

export type UnifiedHealthSummary = {
  metrics: Array<{
    timestamp: string;
    name: string;
    displayValue: string;
    unitLabel: string;
  }>;
  recentDietTags: string[];
};

export type UnifiedDashboardModel = {
  requestId: string;
  todo: DomainProjection<UnifiedTodoSummary>;
  ledger: DomainProjection<UnifiedLedgerSummary>;
  health: DomainProjection<UnifiedHealthSummary>;
  recentActivity: Array<{
    domain: "todo" | "ledger" | "health";
    domainLabel: "ToDo" | "Ledger" | "Health Journal";
    action: string;
    recordId: string;
    timestamp: string;
  }>;
};

const dashboardExecutionTypes = new Set(["task", "event"]);
const incompleteStatuses = new Set(["active", "waiting", "paused"]);

export function toUnifiedDashboardModel(
  response: RavenDashboard,
): UnifiedDashboardModel {
  return {
    requestId: response.requestId,
    todo: mapProjection(response.todo, (todo) => ({
      active: todo.active,
      completed: todo.todayCompleted,
      incomplete: todo.todayIncomplete,
      missed: todo.todayMissed,
      total: todo.todayTotal,
      overdue: todo.overdue,
    })),
    ledger: mapProjection(response.ledger, (ledger) => ({
      periodStart: ledger.periodStart,
      periodEnd: ledger.periodEnd,
      currencies: ledger.currencies.map((currency) => ({
        currencyCode: currency.currencyCode,
        incomeMinor: formatInteger(currency.incomeMinor),
        expenseMinor: formatInteger(currency.expenseMinor),
        netChangeMinor: formatInteger(currency.netChangeMinor),
        unitLabel: `${currency.currencyCode} minor units`,
      })),
    })),
    health: mapProjection(response.health, (health) => ({
      metrics: [
        dashboardHealthMetric(health.latestCondition, "score out of 10"),
        dashboardHealthMetric(health.latestSleep),
        dashboardHealthMetric(health.latestBowel, "Bristol scale"),
        dashboardHealthMetric(health.latestMedication),
      ].filter((metric) => metric !== null),
      recentDietTags: health.recentDietTags,
    })),
    recentActivity: response.recentActivity.map((activity) => ({
      ...activity,
      domainLabel: activity.domain === "todo"
        ? "ToDo"
        : activity.domain === "ledger"
          ? "Ledger"
          : "Health Journal",
    })),
  };
}

function dashboardHealthMetric(
  metric: {
    timestamp: string;
    name: string;
    value: number;
    unit: string | null;
  } | null,
  semanticUnit?: string,
): UnifiedHealthSummary["metrics"][number] | null {
  return metric === null ? null : {
    timestamp: metric.timestamp,
    name: metric.name,
    displayValue: String(metric.value),
    unitLabel: metric.unit || semanticUnit || "Unit not provided",
  };
}

function mapProjection<T, U>(
  projection: DomainProjection<T>,
  mapper: (value: T) => U,
): DomainProjection<U> {
  return projection.status === "ok"
    ? { status: "ok", data: mapper(projection.data) }
    : projection;
}

function formatInteger(value: number): string {
  const [sign, digits] = value < 0
    ? ["-", String(value).slice(1)]
    : ["", String(value)];
  return `${sign}${digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

export function buildDashboardSnapshot(
  items: WorkspaceItemModel[],
  today: string,
  completionRange: DashboardDateRange = completionRangeEndingOn(today, 14),
): DashboardSnapshot {
  const executionWork = items.filter((item) => dashboardExecutionTypes.has(item.type));
  const projects = buildProjectStats(items, executionWork, today);

  return {
    areas: buildAreaStats(items, executionWork),
    projects,
    todayOutcomes: buildTodayOutcomes(executionWork, today),
    completionHistory: buildCompletionHistory(executionWork, completionRange),
  };
}

export function completionRangeEndingOn(
  today: string,
  dayCount: 7 | 14 | 30,
): DashboardDateRange {
  return { start: addDays(today, 1 - dayCount), end: today };
}

export function isValidDashboardDateRange(range: DashboardDateRange): boolean {
  return dashboardDateRangeError(range) === null;
}

export function dashboardDateRangeError(
  range: DashboardDateRange,
): DashboardDateRangeError | null {
  if (
    dateFromDateOnly(range.start) === null
    || dateFromDateOnly(range.end) === null
    || range.start > range.end
  ) {
    return "invalid";
  }

  const elapsedDays = daysBetween(range.start, range.end);
  return elapsedDays !== null && elapsedDays >= 366 ? "too-long" : null;
}

export function dashboardToday(date: Date = new Date()): string {
  return formatDateOnly(date);
}

function buildAreaStats(
  items: WorkspaceItemModel[],
  work: WorkspaceItemModel[],
): DashboardHeatmapRow[] {
  return items
    .filter((item) => item.type === "area" && isActiveOrPaused(item))
    .map((area) => {
      const linked = work.filter((item) => item.area_id === area.id);
      const status = statusValues(linked);
      return {
        id: area.id,
        title: area.title,
        ...status,
      };
    })
    .sort(compareDashboardStatusRows);
}

function buildProjectStats(
  items: WorkspaceItemModel[],
  work: WorkspaceItemModel[],
  today: string,
): DashboardProjectRow[] {
  return items
    .filter((item) => item.type === "project" && isActiveOrPaused(item))
    .map((project) => {
      const linked = work.filter((item) => item.project_id === project.id);
      const status = statusValues(linked);
      return {
        id: project.id,
        title: project.title,
        ...status,
        progress:
          status.total === 0
            ? null
            : status.values.completed / status.total,
        attention: projectAttention(project, today),
      };
    })
    .sort(compareDashboardStatusRows);
}

function buildTodayOutcomes(
  work: WorkspaceItemModel[],
  today: string,
): TodayOutcomes {
  const todayWork = work.filter((item) =>
    localCalendarDate(item.scheduled) === today
    || localCalendarDate(item.due) === today,
  );
  const completed = countStatus(todayWork, "completed");
  const incomplete = todayWork.filter((item) => incompleteStatuses.has(item.status)).length;
  const missed = countStatus(todayWork, "missed");
  return { date: today, completed, incomplete, missed, total: completed + incomplete + missed };
}

function buildCompletionHistory(
  work: WorkspaceItemModel[],
  range: DashboardDateRange,
): CompletionHistory {
  const counts = new Map<string, number>();
  for (const item of work) {
    if (item.status !== "completed") continue;
    const date = localCalendarDate(item.completed_at);
    if (date !== null && date >= range.start && date <= range.end) {
      counts.set(date, (counts.get(date) ?? 0) + 1);
    }
  }
  return {
    range,
    days: dateRange(range).map((date) => ({
      date,
      completed: counts.get(date) ?? 0,
    })),
  };
}

function isActiveOrPaused(item: WorkspaceItemModel): boolean {
  return item.status === "active" || item.status === "paused";
}

function statusKey(status: string): DashboardStatusKey | null {
  switch (status) {
    case "completed": return "completed";
    case "active":
    case "waiting": return "incomplete";
    case "paused": return "paused";
    case "missed": return "missed";
    default: return null;
  }
}

function statusValues(items: WorkspaceItemModel[]): {
  values: DashboardStatusValues;
  percentages: DashboardStatusValues;
  total: number;
} {
  const values: DashboardStatusValues = {
    completed: 0,
    incomplete: 0,
    paused: 0,
    missed: 0,
  };
  for (const item of items) {
    const key = statusKey(item.status);
    if (key !== null) values[key] += 1;
  }
  const total = Object.values(values).reduce((sum, value) => sum + value, 0);
  return {
    values,
    percentages: {
      completed: percent(values.completed, total),
      incomplete: percent(values.incomplete, total),
      paused: percent(values.paused, total),
      missed: percent(values.missed, total),
    },
    total,
  };
}

function compareDashboardStatusRows(
  left: DashboardHeatmapRow,
  right: DashboardHeatmapRow,
): number {
  return (
    right.values.missed - left.values.missed
    || right.values.incomplete - left.values.incomplete
    || left.title.localeCompare(right.title)
  );
}

function countStatus(items: WorkspaceItemModel[], status: string): number {
  return items.filter((item) => item.status === status).length;
}

function percent(value: number, total: number): number {
  return total === 0 ? 0 : (value / total) * 100;
}

function projectAttention(project: WorkspaceItemModel, today: string): ProjectAttention {
  if (project.status !== "active") return "normal";

  const due = dateOnly(project.due);
  const inactiveDays = daysBetween(dateOnly(project.updated_at), today);
  if ((due !== null && due < today) || (inactiveDays !== null && inactiveDays >= 14)) {
    return "risk";
  }
  if (
    (due !== null && due >= today && due <= addDays(today, 7))
    || (inactiveDays !== null && inactiveDays >= 7)
  ) {
    return "attention";
  }
  return "normal";
}

function addDays(date: string, days: number): string {
  const value = dateFromDateOnly(date);
  if (value === null) return date;
  value.setDate(value.getDate() + days);
  return formatDateOnly(value);
}

function daysBetween(start: string | null, end: string): number | null {
  if (start === null) return null;
  const startDate = dateFromDateOnly(start);
  const endDate = dateFromDateOnly(end);
  if (startDate === null || endDate === null) return null;
  return Math.round((Date.UTC(endDate.getFullYear(), endDate.getMonth(), endDate.getDate())
    - Date.UTC(startDate.getFullYear(), startDate.getMonth(), startDate.getDate())) / 86_400_000);
}

function dateOnly(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return match && dateFromDateOnly(match[1]) !== null ? match[1] : null;
}

function localCalendarDate(value: string | null | undefined): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return dateFromDateOnly(value) === null ? null : value;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : formatDateOnly(parsed);
}

function dateRange(range: DashboardDateRange): string[] {
  if (!isValidDashboardDateRange(range)) return [];

  const current = dateFromDateOnly(range.start);
  if (current === null) return [];

  const dates: string[] = [];
  while (formatDateOnly(current) <= range.end) {
    dates.push(formatDateOnly(current));
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

function dateFromDateOnly(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  return formatDateOnly(date) === value ? date : null;
}

function formatDateOnly(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
