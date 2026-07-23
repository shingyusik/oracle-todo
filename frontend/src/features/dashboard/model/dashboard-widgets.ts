import type { DashboardDestination } from "@/features/dashboard/model/dashboard-navigation";
import type { DashboardSnapshot } from "@/features/dashboard/model/dashboard-model";

export type DashboardPoint = {
  id: string;
  label: string;
  value: number;
  displayValue: string;
  ariaLabel: string;
  sizePercent: number;
  tone?: DashboardTone;
  placeholder?: boolean;
  destination: DashboardDestination;
};

type DashboardTone = "primary" | "secondary" | "warning";

export type DashboardChartSpec = {
  kind: "stacked-bar" | "grouped-bar";
  ariaLabel: string;
  series: Array<{
    id: string;
    label: string;
    tone: DashboardTone;
    points: DashboardPoint[];
  }>;
};

export type DashboardLinkedStat = {
  kind: "linked";
  label: string;
  value: number;
  destination: DashboardDestination;
};

export type DashboardCompositeStat = {
  kind: "composite";
  label: string;
  value: number;
  items: DashboardLinkedStat[];
};

export type DashboardStatModel = DashboardLinkedStat | DashboardCompositeStat;

export type DashboardWidgetModel = {
  id: string;
  title: string;
  description: string;
  emptyMessage: string;
  destination?: DashboardDestination;
  chart?: DashboardChartSpec;
  stats?: DashboardStatModel[];
};

export type DashboardWidget = {
  id: "summary" | "area-status" | "project-progress" | "planner-week";
  build: (snapshot: DashboardSnapshot) => DashboardWidgetModel;
};

export const dashboardWidgets: DashboardWidget[] = [
  {
    id: "summary",
    build: (snapshot) => ({
      id: "summary",
      title: "Workspace summary",
      description: "Active Areas, Projects, and work requiring attention.",
      emptyMessage: "Create an Area, Project, or work item to populate analytics.",
      stats: [
        {
          kind: "linked",
          label: "Active Areas",
          value: snapshot.summary.activeAreas,
          destination: { kind: "areas" },
        },
        {
          kind: "linked",
          label: "Active Projects",
          value: snapshot.summary.activeProjects,
          destination: { kind: "projects" },
        },
        {
          kind: "composite",
          label: "Active Work",
          value:
            snapshot.summary.activeTasks
            + snapshot.summary.activeEvents
            + snapshot.summary.activeRoutines,
          items: [
            {
              kind: "linked",
              label: "Tasks",
              value: snapshot.summary.activeTasks,
              destination: { kind: "tasks" },
            },
            {
              kind: "linked",
              label: "Events",
              value: snapshot.summary.activeEvents,
              destination: { kind: "events" },
            },
            {
              kind: "linked",
              label: "Routines",
              value: snapshot.summary.activeRoutines,
              destination: { kind: "routines" },
            },
          ],
        },
        {
          kind: "linked",
          label: "Attention Projects",
          value: snapshot.summary.attentionProjects,
          destination: { kind: "projects" },
        },
      ],
    }),
  },
  {
    id: "area-status",
    build: (snapshot) => ({
      id: "area-status",
      title: "Area work status",
      description: "Direct work grouped by Area and status.",
      emptyMessage: "Create an Area with work to view status analytics.",
      destination: { kind: "areas" },
      chart: {
        kind: "stacked-bar",
        ariaLabel: "Area work status",
        series: [
          areaSeries("active", "Active", "primary", snapshot),
          areaSeries("paused", "Paused", "secondary", snapshot),
          areaSeries("completed", "Completed", "warning", snapshot),
        ],
      },
    }),
  },
  {
    id: "project-progress",
    build: (snapshot) => ({
      id: "project-progress",
      title: "Project progress",
      description: "Completed and remaining work for each Project.",
      emptyMessage: "Create a Project with work to view progress analytics.",
      destination: { kind: "projects" },
      chart: {
        kind: "stacked-bar",
        ariaLabel: "Project progress",
        series: [
          projectSeries("completed", "Completed", "primary", snapshot),
          projectSeries("remaining", "Remaining", "secondary", snapshot),
        ],
      },
    }),
  },
  {
    id: "planner-week",
    build: (snapshot) => ({
      id: "planner-week",
      title: "Planner weekly schedule",
      description: "Scheduled and due work across the current week.",
      emptyMessage: "Schedule or add due dates to work items to populate the Planner.",
      destination: { kind: "weekly", weekStart: weekStart(snapshot) },
      chart: {
        kind: "grouped-bar",
        ariaLabel: "Planner weekly schedule",
        series: [
          plannerSeries("scheduled", "Scheduled", "primary", snapshot),
          plannerSeries("due", "Due", "secondary", snapshot),
        ],
      },
      stats: [
        {
          kind: "linked",
          label: "Today",
          value: snapshot.planner.today,
          destination: { kind: "daily", date: snapshot.planner.todayDate },
        },
        {
          kind: "linked",
          label: "This Week",
          value: snapshot.planner.thisWeek,
          destination: { kind: "weekly", weekStart: weekStart(snapshot) },
        },
        {
          kind: "linked",
          label: "Overdue",
          value: snapshot.planner.overdue,
          destination: { kind: "daily-overdue", date: snapshot.planner.todayDate },
        },
      ],
    }),
  },
];

function areaSeries(
  key: "active" | "paused" | "completed",
  label: string,
  tone: DashboardChartSpec["series"][number]["tone"],
  snapshot: DashboardSnapshot,
): DashboardChartSpec["series"][number] {
  return {
    id: key,
    label,
    tone,
    points: snapshot.areas.map((area) => ({
      id: `${area.id}-${key}`,
      label: area.title,
      value: area[key],
      displayValue: String(area[key]),
      ariaLabel: `${area.title}: ${area[key]} ${label.toLowerCase()}`,
      sizePercent: percent(
        area[key],
        area.active + area.paused + area.completed,
      ),
      destination: { kind: "area-detail", itemId: area.id },
    })),
  };
}

function projectSeries(
  key: "completed" | "remaining",
  label: string,
  tone: DashboardChartSpec["series"][number]["tone"],
  snapshot: DashboardSnapshot,
): DashboardChartSpec["series"][number] {
  return {
    id: key,
    label,
    tone,
    points: snapshot.projects.map((project) => ({
      id: `${project.id}-${key}`,
      label: projectPointLabel(project),
      value: project[key],
      displayValue:
        project.progress === null && key === "completed"
          ? "—"
          : String(project[key]),
      ariaLabel: projectPointAriaLabel(project, key),
      sizePercent: projectPointSize(project.progress, key),
      ...(project.attention === "risk" ? { tone: "warning" as const } : {}),
      ...(project.progress === null && key === "completed"
        ? { placeholder: true }
        : {}),
      destination: { kind: "project-detail", itemId: project.id },
    })),
  };
}

function plannerSeries(
  key: "scheduled" | "due",
  label: string,
  tone: DashboardChartSpec["series"][number]["tone"],
  snapshot: DashboardSnapshot,
): DashboardChartSpec["series"][number] {
  const maximum = Math.max(
    1,
    ...snapshot.planner.days.flatMap((day) => [day.scheduled, day.due]),
  );

  return {
    id: key,
    label,
    tone,
    points: snapshot.planner.days.map((day) => ({
      id: `${day.date}-${key}`,
      label: day.date,
      value: day[key],
      displayValue: String(day[key]),
      ariaLabel: `${day.date}: ${day[key]} ${label.toLowerCase()}`,
      sizePercent: percent(day[key], maximum),
      destination: { kind: "daily", date: day.date },
    })),
  };
}

function projectPointAriaLabel(
  project: DashboardSnapshot["projects"][number],
  key: "completed" | "remaining",
): string {
  const state =
    project.attention === "normal"
      ? ""
      : `${attentionLabel(project.attention)}; `;

  if (project.progress === null) {
    return `${project.title}: ${state}progress unavailable (—); ${project[key]} ${key}`;
  }

  if (key === "remaining") {
    return `${project.title}: ${state}${project.remaining} remaining`;
  }

  return `${project.title}: ${state}${Math.round(project.progress * 100)}% complete (${project.completed} completed)`;
}

function projectPointLabel(
  project: DashboardSnapshot["projects"][number],
): string {
  const parts = [project.title];
  if (project.attention !== "normal") {
    parts.push(attentionLabel(project.attention));
  }
  if (project.progress === null) {
    parts.push("Progress —");
  }
  return parts.join(" · ");
}

function attentionLabel(attention: Exclude<DashboardSnapshot["projects"][number]["attention"], "normal">): string {
  return attention === "risk" ? "Risk" : "Attention";
}

function projectPointSize(
  progress: number | null,
  key: "completed" | "remaining",
): number {
  if (progress === null) {
    return 0;
  }

  const completedPercent = Math.round(progress * 100);
  return key === "completed" ? completedPercent : 100 - completedPercent;
}

function percent(value: number, total: number): number {
  return total === 0 ? 0 : Math.round((value / total) * 100);
}

function weekStart(snapshot: DashboardSnapshot): string {
  return snapshot.planner.days[0]?.date ?? "";
}
