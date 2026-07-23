import type { WorkspaceItemModel } from "@/features/workbench/model/workbench-model";

export type ProjectAttention = "normal" | "attention" | "risk";

export type PlannerDay = {
  date: string;
  scheduled: number;
  due: number;
};

export type PlannerSummary = {
  todayDate: string;
  today: number;
  thisWeek: number;
  overdue: number;
  days: PlannerDay[];
};

export type DashboardSnapshot = {
  summary: {
    activeAreas: number;
    activeProjects: number;
    activeWork: number;
    attentionProjects: number;
  };
  areas: Array<{
    id: string;
    title: string;
    active: number;
    paused: number;
    completed: number;
  }>;
  projects: Array<{
    id: string;
    title: string;
    completed: number;
    remaining: number;
    progress: number | null;
    attention: ProjectAttention;
  }>;
  planner: PlannerSummary;
};

const dashboardWorkTypes = new Set(["task", "event", "routine"]);
const plannerWorkTypes = new Set(["task", "event"]);
const trackedWorkStatuses = new Set(["active", "paused", "completed"]);

export function buildDashboardSnapshot(
  items: WorkspaceItemModel[],
  today: string,
): DashboardSnapshot {
  const work = items.filter(isDashboardWorkItem);
  const week = weekDates(today);
  const projects = buildProjectStats(items, work, today);

  return {
    summary: buildSummary(items, work, projects),
    areas: buildAreaStats(items, work),
    projects,
    planner: buildPlannerStats(work, today, week),
  };
}

function buildSummary(
  items: WorkspaceItemModel[],
  work: WorkspaceItemModel[],
  projects: DashboardSnapshot["projects"],
): DashboardSnapshot["summary"] {
  return {
    activeAreas: items.filter((item) => item.type === "area" && item.status === "active").length,
    activeProjects: items.filter((item) => item.type === "project" && item.status === "active").length,
    activeWork: work.filter((item) => item.status === "active").length,
    attentionProjects: projects.filter((project) => project.attention !== "normal").length,
  };
}

function buildAreaStats(
  items: WorkspaceItemModel[],
  work: WorkspaceItemModel[],
): DashboardSnapshot["areas"] {
  return items
    .filter((item) => item.type === "area")
    .map((area) => {
      const linked = work.filter(
        (item) => item.area_id === area.id && trackedWorkStatuses.has(item.status),
      );
      return {
        id: area.id,
        title: area.title,
        active: countStatus(linked, "active"),
        paused: countStatus(linked, "paused"),
        completed: countStatus(linked, "completed"),
      };
    });
}

function buildProjectStats(
  items: WorkspaceItemModel[],
  work: WorkspaceItemModel[],
  today: string,
): DashboardSnapshot["projects"] {
  return items
    .filter((item) => item.type === "project")
    .map((project) => {
      const linked = work.filter(
        (item) => item.project_id === project.id && trackedWorkStatuses.has(item.status),
      );
      const completed = countStatus(linked, "completed");
      const remaining = linked.length - completed;
      return {
        id: project.id,
        title: project.title,
        completed,
        remaining,
        progress: linked.length === 0 ? null : completed / linked.length,
        attention: projectAttention(project, today),
      };
    });
}

function buildPlannerStats(
  work: WorkspaceItemModel[],
  today: string,
  week: string[],
): PlannerSummary {
  const plannerWork = work.filter(
    (item) => plannerWorkTypes.has(item.type) && (item.status === "active" || item.status === "paused"),
  );
  const weekDatesSet = new Set(week);
  const byDate = (date: string | null | undefined) => dateOnly(date);

  return {
    todayDate: today,
    today: countUnique(plannerWork, (item) => byDate(item.scheduled) === today || byDate(item.due) === today),
    thisWeek: countUnique(plannerWork, (item) => {
      const scheduled = byDate(item.scheduled);
      const due = byDate(item.due);
      return (scheduled !== null && weekDatesSet.has(scheduled))
        || (due !== null && weekDatesSet.has(due));
    }),
    overdue: countUnique(plannerWork, (item) => {
      const scheduled = byDate(item.scheduled);
      const due = byDate(item.due);
      return (scheduled !== null && scheduled < today) || (due !== null && due < today);
    }),
    days: week.map((date) => ({
      date,
      scheduled: plannerWork.filter((item) => byDate(item.scheduled) === date).length,
      due: plannerWork.filter((item) => byDate(item.due) === date).length,
    })),
  };
}

function isDashboardWorkItem(item: WorkspaceItemModel): boolean {
  return dashboardWorkTypes.has(item.type);
}

function countStatus(items: WorkspaceItemModel[], status: string): number {
  return items.filter((item) => item.status === status).length;
}

function countUnique(
  items: WorkspaceItemModel[],
  predicate: (item: WorkspaceItemModel) => boolean,
): number {
  return new Set(items.filter(predicate).map((item) => item.id)).size;
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

function weekDates(today: string): string[] {
  const current = dateFromDateOnly(today);
  if (current === null) return [];

  const mondayOffset = (current.getDay() + 6) % 7;
  current.setDate(current.getDate() - mondayOffset);
  return Array.from({ length: 7 }, () => {
    const date = formatDateOnly(current);
    current.setDate(current.getDate() + 1);
    return date;
  });
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
