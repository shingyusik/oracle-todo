import "@testing-library/jest-dom/vitest";

import { render, screen, within } from "@testing-library/react";
import React from "react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DashboardChartSpec } from "@/features/dashboard/model/dashboard-widgets";
import { DashboardChart } from "@/features/dashboard/ui/DashboardChart";
import { DashboardPanel } from "@/features/dashboard/ui/DashboardPanel";
import type { WorkbenchController } from "@/features/workbench/model/workbench-model";
import { WorkbenchPageClient } from "@/features/workbench/ui/WorkbenchPageClient";

type TestItem = {
  id: string;
  type: string;
  title: string;
  status: string;
  area_id?: string;
  project_id?: string;
  scheduled?: string;
  due?: string;
};

function jsonResponse(items: TestItem[] = []): Response {
  return {
    ok: true,
    json: async () => items,
  } as Response;
}

function formatDate(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00`);
  value.setDate(value.getDate() + days);
  return formatDate(value);
}

function weekStart(): string {
  const value = new Date();
  const day = value.getDay();
  value.setDate(value.getDate() + (day === 0 ? -6 : 1 - day));
  return formatDate(value);
}

function plannerDateLabel(value: string): string {
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function populatedItems(): TestItem[] {
  const monday = weekStart();
  return [
    { id: "area-health", type: "area", title: "Health", status: "active" },
    { id: "project-release", type: "project", title: "Release", status: "active" },
    {
      id: "task-area-active",
      type: "task",
      title: "Run",
      status: "active",
      area_id: "area-health",
    },
    {
      id: "task-area-completed",
      type: "task",
      title: "Stretch",
      status: "completed",
      area_id: "area-health",
    },
    ...Array.from({ length: 9 }, (_, index) => ({
      id: `task-project-completed-${index}`,
      type: "task",
      title: `Completed release work ${index}`,
      status: "completed",
      project_id: "project-release",
    })),
    {
      id: "event-project-active",
      type: "event",
      title: "Launch",
      status: "active",
      project_id: "project-release",
      scheduled: monday,
      due: addDays(monday, 1),
    },
    {
      id: "task-project-active",
      type: "task",
      title: "Release follow-up",
      status: "active",
      project_id: "project-release",
    },
  ];
}

function mockLoadedDashboard(items = populatedItems()) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) =>
      Promise.resolve(
        url === "/todo-engine/items" ? jsonResponse(items) : jsonResponse(),
      ),
    ),
  );
}

describe("DashboardPanel", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders card-shaped skeletons while Dashboard items are loading", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {})),
    );

    render(<WorkbenchPageClient />);

    const loading = screen.getByRole("status", {
      name: "Loading Dashboard analytics",
    });
    expect(
      within(loading).getAllByTestId("dashboard-skeleton-card"),
    ).toHaveLength(4);
  });

  it("shows an inline error and retries the Dashboard request", async () => {
    const user = userEvent.setup();
    let dashboardAttempts = 0;
    const fetchMock = vi.fn((url: string) => {
      if (url !== "/todo-engine/items") {
        return Promise.resolve(jsonResponse());
      }

      dashboardAttempts += 1;
      return dashboardAttempts === 1
        ? Promise.reject(new Error("unavailable"))
        : Promise.resolve(jsonResponse());
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not load Dashboard analytics.",
    );
    await user.click(screen.getByRole("button", { name: "Retry Dashboard" }));

    expect(
      await screen.findByText(
        "Create an Area, Project, or work item to populate analytics.",
      ),
    ).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.filter(([url]) => url === "/todo-engine/items"),
    ).toHaveLength(2);
  });

  it("renders a creation hint for a loaded empty Dashboard", async () => {
    mockLoadedDashboard([]);

    render(<WorkbenchPageClient />);

    expect(
      await screen.findByText(
        "Create an Area, Project, or work item to populate analytics.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Area work status" })).toBeNull();
  });

  it("renders graph-led Area, Project, and grouped Planner widgets", async () => {
    mockLoadedDashboard();

    render(<WorkbenchPageClient />);

    const area = await screen.findByRole("region", { name: "Area work status" });
    const project = screen.getByRole("region", { name: "Project progress" });
    const planner = screen.getByRole("region", {
      name: "Planner weekly schedule",
    });

    expect(
      within(area).getByRole("group", { name: "Area work status" }),
    ).toBeInTheDocument();
    expect(
      within(project).getByRole("group", { name: "Project progress" }),
    ).toBeInTheDocument();
    expect(
      within(planner).getByRole("group", { name: "Planner weekly schedule" }),
    ).toHaveClass("dashboard-chart-grouped-bar");
    expect(
      within(planner).getByRole("button", {
        name: `${weekStart()}: 1 scheduled`,
      }),
    ).toHaveTextContent("1");
    expect(
      within(planner).getByRole("button", {
        name: `${addDays(weekStart(), 1)}: 1 due`,
      }),
    ).toHaveTextContent("1");
  });

  it("uses the browser local today after the Planner anchor has moved to an old date", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 23, 12));
    const controller = {
      workspaceItems: {
        status: "loaded",
        items: [],
        allItems: [{
          id: "task-today",
          type: "task",
          title: "Local today",
          status: "active",
          scheduled: "2026-07-23",
        }],
        tagOptions: [],
        relatedItems: { areas: {}, goals: {}, projects: {}, routines: {} },
      },
      planner: { date: "2001-01-01" },
      reloadDashboard: vi.fn(),
      navigateDashboard: vi.fn(),
    } as unknown as WorkbenchController;

    render(<DashboardPanel controller={controller} />);

    expect(screen.getByRole("button", { name: "Today: 1" })).toBeInTheDocument();
  });

  it("shows Project risk in text and applies the warning tone", async () => {
    mockLoadedDashboard([
      {
        id: "project-risk",
        type: "project",
        title: "Risky release",
        status: "active",
        due: "2001-01-01",
      },
      {
        id: "task-complete",
        type: "task",
        title: "Finished",
        status: "completed",
        project_id: "project-risk",
      },
    ]);

    render(<WorkbenchPageClient />);

    expect(await screen.findByText("Risky release · Risk")).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: /Risky release: Risk; 100% complete \(1 completed\)/,
      }),
    ).toHaveClass("tone-warning");
  });

  it("renders unavailable Project progress as a dash", async () => {
    mockLoadedDashboard([
      {
        id: "project-empty",
        type: "project",
        title: "Unplanned",
        status: "active",
      },
    ]);

    render(<WorkbenchPageClient />);

    expect(await screen.findByText("Unplanned · Progress —")).toBeInTheDocument();
  });

  it("opens the selected Area detail from its graph segment", async () => {
    const user = userEvent.setup();
    mockLoadedDashboard();
    render(<WorkbenchPageClient />);

    await user.click(
      await screen.findByRole("button", { name: "Health: 1 active" }),
    );

    expect(
      await screen.findByRole("heading", { name: "Health" }),
    ).toBeInTheDocument();
  });

  it("opens the selected Project detail from its graph bar", async () => {
    const user = userEvent.setup();
    mockLoadedDashboard();
    render(<WorkbenchPageClient />);

    await user.click(
      await screen.findByRole("button", {
        name: "Release: 82% complete (9 completed)",
      }),
    );

    expect(
      await screen.findByRole("heading", { name: "Release" }),
    ).toBeInTheDocument();
  });

  it("opens the selected Planner date from its graph bar", async () => {
    const user = userEvent.setup();
    mockLoadedDashboard();
    render(<WorkbenchPageClient />);
    const selectedDate = weekStart();

    await user.click(
      await screen.findByRole("button", { name: `${selectedDate}: 1 scheduled` }),
    );

    expect(await screen.findByRole("button", { name: "Daily" })).toHaveAttribute(
      "data-active",
      "true",
    );
    expect(
      screen.getByRole("button", { name: "Choose Daily date" }),
    ).toHaveTextContent(plannerDateLabel(selectedDate));
    expect(
      screen.getByRole("heading", { name: plannerDateLabel(selectedDate) }),
    ).toBeInTheDocument();
  });

  it("renders presentation-ready point values without deriving Project semantics", () => {
    const chart: DashboardChartSpec = {
      kind: "stacked-bar",
      ariaLabel: "Provided presentation",
      series: [{
        id: "completed",
        label: "Completed",
        tone: "primary",
        points: [{
          id: "project-release-completed",
          label: "Release",
          value: 4,
          displayValue: "4",
          ariaLabel: "Release: 82% complete (4 completed)",
          sizePercent: 37,
          destination: { kind: "project-detail", itemId: "project-release" },
        }],
      }, {
        id: "remaining",
        label: "Remaining",
        tone: "secondary",
        points: [{
          id: "project-release-remaining",
          label: "Release",
          value: 1,
          displayValue: "1",
          ariaLabel: "Release: 1 remaining",
          sizePercent: 63,
          destination: { kind: "project-detail", itemId: "project-release" },
        }],
      }],
    };

    render(<DashboardChart chart={chart} onNavigate={vi.fn()} />);

    const completed = screen.getByRole("button", {
      name: "Release: 82% complete (4 completed)",
    });
    expect(completed).toHaveTextContent("4");
    expect(completed.style.getPropertyValue("--dashboard-point-scale")).toBe("37");
    expect(completed.style.getPropertyValue("--dashboard-point-stack")).toBe("37%");
  });

  it("keeps a zero value interactive without drawing a chart bar", () => {
    const chart: DashboardChartSpec = {
      kind: "grouped-bar",
      ariaLabel: "Zero value",
      series: [{
        id: "scheduled",
        label: "Scheduled",
        tone: "primary",
        points: [{
          id: "zero",
          label: "2026-07-23",
          value: 0,
          displayValue: "0",
          ariaLabel: "2026-07-23: 0 scheduled",
          sizePercent: 0,
          destination: { kind: "daily", date: "2026-07-23" },
        }],
      }],
    };

    render(<DashboardChart chart={chart} onNavigate={vi.fn()} />);

    const zero = screen.getByRole("button", { name: "2026-07-23: 0 scheduled" });
    expect(zero).toHaveTextContent("0");
    expect(zero).toHaveClass("dashboard-chart-zero");
    expect(zero).not.toHaveClass("dashboard-chart-point");
  });

  it("renders numerical text in every interactive chart point", async () => {
    mockLoadedDashboard();
    render(<WorkbenchPageClient />);

    const dashboard = await screen.findByRole("region", {
      name: "Dashboard analytics",
    });
    const charts = within(dashboard)
      .getAllByRole("group")
      .filter((group) => group.classList.contains("dashboard-chart"));
    const chartButtons = charts.flatMap((chart) =>
      within(chart).getAllByRole("button"),
    );

    expect(chartButtons.length).toBeGreaterThan(0);
    for (const button of chartButtons) {
      expect(
        button.querySelector(".dashboard-chart-value"),
      ).toHaveTextContent(/^\d+$/);
      expect(button).toHaveAccessibleName(
        /: (?:\d+ (?:active|paused|completed|remaining|scheduled|due)|\d+% complete \(\d+ completed\))$/,
      );
    }
  });
});
