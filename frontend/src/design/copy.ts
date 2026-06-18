export const workbenchCopy = {
  brandName: "Todo Engine",
  logoLabel: "Logo",
  navigation: {
    shellLabel: "Workbench navigation",
    mainSidebarLabel: "Primary sections",
    subSidebarLabel: "Workspace sections",
  },
  disclosureLabel: "Show nested navigation",
  panelOverviewLabel: (title: string) => `${title} overview`,
  summaryCards: {
    focus: {
      label: "Focus",
    },
    status: {
      label: "Status",
      title: "Ready",
      summary: "This static shell is prepared for service-backed data.",
    },
  },
  panels: {
    dashboard: {
      title: "Dashboard",
      eyebrow: "Local command center",
      summary: "Review proposed, approved, and active work from one place.",
    },
    todo: {
      title: "ToDo",
      eyebrow: "Work queue",
      summary: "Scan active work and approval-gated items before taking action.",
    },
    areas: {
      title: "Areas",
      eyebrow: "Long-running responsibility",
      summary: "Keep responsibilities visible without turning them into projects.",
    },
    projects: {
      title: "Projects",
      eyebrow: "Outcome pipeline",
      summary: "Track bounded outcomes from proposal through completion.",
    },
    routines: {
      title: "Routines",
      eyebrow: "Recurring cadence",
      summary: "Review recurring work patterns and materialized next actions.",
    },
    tasks: {
      title: "Tasks",
      eyebrow: "Concrete next actions",
      summary: "Focus on the next executable items in the local database.",
    },
    yearly: {
      title: "Yearly",
      eyebrow: "Planning horizon",
      summary: "Frame annual themes and the outcomes they constrain.",
    },
    monthly: {
      title: "Monthly",
      eyebrow: "Planning horizon",
      summary: "Shape the month around projects, routines, and fixed events.",
    },
    weekly: {
      title: "Weekly",
      eyebrow: "Planning horizon",
      summary: "Choose a small weekly focus set before the day gets noisy.",
    },
    daily: {
      title: "Daily",
      eyebrow: "Today",
      summary: "Materialize today's work into a compact command list.",
    },
  },
} as const;
