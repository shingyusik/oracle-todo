import type {
  DashboardHeatmapRow,
  DashboardSnapshot,
  DashboardStatusKey,
  ProjectAttention,
  UnifiedTodoSummary,
} from "@/features/dashboard/model/dashboard-model";
import type { DashboardDestination } from "@/features/dashboard/model/dashboard-navigation";

export type DonutChartSpec = {
  kind: "donut";
  ariaLabel: string;
  total: number;
  segments: Array<{
    id: "completed" | "incomplete" | "missed";
    label: string;
    value: number;
    percentage: number;
    tone: "success" | "primary" | "warning";
    ariaLabel: string;
    destination: DashboardDestination;
  }>;
};

export type LineChartSpec = {
  kind: "line";
  ariaLabel: string;
  total: number;
  points: Array<{
    id: string;
    label: string;
    value: number;
    ariaLabel: string;
  }>;
};

export type HeatmapChartSpec = {
  kind: "heatmap";
  ariaLabel: string;
  columns: Array<{
    id: DashboardStatusKey;
    label: string;
    tone: "success" | "primary" | "secondary" | "warning";
  }>;
  rows: Array<{
    id: string;
    label: string;
    progressLabel?: string;
    attention?: ProjectAttention;
    destination: DashboardDestination;
    cells: Array<{
      id: string;
      columnId: DashboardStatusKey;
      value: number;
      intensityPercent: number;
      ariaLabel: string;
    }>;
  }>;
};

export type DashboardChartSpec =
  | DonutChartSpec
  | LineChartSpec
  | HeatmapChartSpec;

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
  id:
    | "today-outcomes"
    | "completion-history"
    | "area-status"
    | "project-status";
  build: (snapshot: DashboardSnapshot) => DashboardWidgetModel;
};

export function unifiedTodoStats(
  summary: UnifiedTodoSummary,
): Array<{ label: string; value: number }> {
  return [
    { label: "Active", value: summary.active },
    { label: "Completed today", value: summary.completed },
    { label: "Incomplete today", value: summary.incomplete },
    { label: "Missed today", value: summary.missed },
    { label: "Overdue", value: summary.overdue },
  ];
}

const heatmapColumns = [
  { id: "completed", label: "Completed", tone: "success" },
  { id: "incomplete", label: "Incomplete", tone: "primary" },
  { id: "paused", label: "Paused", tone: "secondary" },
  { id: "missed", label: "Miss", tone: "warning" },
] as const;

export const dashboardWidgets: DashboardWidget[] = [
  {
    id: "today-outcomes",
    build: (snapshot) => {
      const outcomes = snapshot.todayOutcomes;
      const segments: DonutChartSpec["segments"] = [
        donutSegment(
          "completed",
          "Completed",
          "success",
          outcomes.completed,
          outcomes.total,
          outcomes.date,
        ),
        donutSegment(
          "incomplete",
          "Incomplete",
          "primary",
          outcomes.incomplete,
          outcomes.total,
          outcomes.date,
        ),
        donutSegment(
          "missed",
          "Miss",
          "warning",
          outcomes.missed,
          outcomes.total,
          outcomes.date,
        ),
      ];
      return {
        id: "today-outcomes",
        title: "Today's work",
        description:
          "Completed, incomplete, and missed Tasks and Events scheduled or due today.",
        emptyMessage: "No Tasks or Events are scheduled or due today.",
        chart: {
          kind: "donut",
          ariaLabel: "Today's work",
          total: outcomes.total,
          segments,
        },
      };
    },
  },
  {
    id: "completion-history",
    build: (snapshot) => {
      const points = snapshot.completionHistory.days.map((day) => ({
        id: day.date,
        label: day.date,
        value: day.percentage,
        ariaLabel:
          `${day.date}: ${Math.round(day.percentage)}% completed (${day.completed}/${day.total})`,
      }));
      const total = snapshot.completionHistory.days.reduce(
        (sum, day) => sum + day.total,
        0,
      );
      return {
        id: "completion-history",
        title: "Completion history",
        description:
          "Completion rate for Tasks and Events scheduled or due by browser-local calendar date.",
        emptyMessage: "No Tasks or Events are scheduled or due in this range.",
        chart: {
          kind: "line",
          ariaLabel: "Completion history",
          total,
          points,
        },
      };
    },
  },
  {
    id: "area-status",
    build: (snapshot) => {
      const rows = heatmapRows(
        snapshot.areas,
        (area) => ({ kind: "area-detail", itemId: area.id }),
      );
      return {
        id: "area-status",
        title: "Area status",
        description: "Task and Event status distribution by Area.",
        emptyMessage:
          "Create an active or paused Area to view status distribution.",
        destination: { kind: "areas" },
        chart: {
          kind: "heatmap",
          ariaLabel: "Area status",
          columns: [...heatmapColumns],
          rows,
        },
      };
    },
  },
  {
    id: "project-status",
    build: (snapshot) => {
      const rows: HeatmapChartSpec["rows"] = heatmapRows(
        snapshot.projects,
        (project) => ({ kind: "project-detail", itemId: project.id }),
      ).map((row, index) => {
        const project = snapshot.projects[index];
        const progressLabel =
          project.progress === null
            ? "Progress —"
            : `Progress ${Math.round(project.progress * 100)}%`;
        const attentionLabel =
          project.attention === "risk"
            ? "Risk"
            : project.attention === "attention"
              ? "Attention"
              : null;
        return {
          ...row,
          progressLabel: attentionLabel
            ? `${progressLabel} · ${attentionLabel}`
            : progressLabel,
          attention: project.attention,
        };
      });
      return {
        id: "project-status",
        title: "Project status",
        description: "Task and Event status distribution and progress by Project.",
        emptyMessage: "Create an active Project to view status distribution.",
        destination: { kind: "projects" },
        chart: {
          kind: "heatmap",
          ariaLabel: "Project status",
          columns: [...heatmapColumns],
          rows,
        },
      };
    },
  },
];

function donutSegment(
  id: DonutChartSpec["segments"][number]["id"],
  label: string,
  tone: DonutChartSpec["segments"][number]["tone"],
  value: number,
  total: number,
  date: string,
): DonutChartSpec["segments"][number] {
  const percentage = percent(value, total);
  const displayPercentage = Math.round(percentage);
  return {
    id,
    label,
    value,
    percentage,
    tone,
    ariaLabel: `${label}: ${value} (${displayPercentage}%)`,
    destination: { kind: "daily", date },
  };
}

function heatmapRows(
  sourceRows: DashboardHeatmapRow[],
  destination: (row: DashboardHeatmapRow) => DashboardDestination,
): HeatmapChartSpec["rows"] {
  return sourceRows.map((row) => ({
    id: row.id,
    label: row.title,
    destination: destination(row),
    cells: heatmapColumns.map((column) => ({
      id: `${row.id}-${column.id}`,
      columnId: column.id,
      value: row.values[column.id],
      intensityPercent: row.percentages[column.id],
      ariaLabel:
        `${row.title}: ${row.values[column.id]} ${column.label.toLowerCase()}`,
    })),
  }));
}

function percent(value: number, total: number): number {
  return total === 0 ? 0 : (value / total) * 100;
}
