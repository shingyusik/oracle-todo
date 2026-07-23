export type DashboardDestination =
  | { kind: "areas" }
  | { kind: "area-detail"; itemId: string }
  | { kind: "projects" }
  | { kind: "project-detail"; itemId: string }
  | { kind: "daily"; date: string }
  | { kind: "weekly"; weekStart: string }
  | { kind: "daily-overdue"; date: string };
