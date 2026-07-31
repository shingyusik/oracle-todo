import "@testing-library/jest-dom/vitest";

import { render, screen, within } from "@testing-library/react";
import React from "react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DashboardChartSpec } from "@/features/dashboard/model/dashboard-widgets";
import type { RavenDashboard } from "@/features/dashboard/api/dashboard-api";
import { DashboardChart } from "@/features/dashboard/ui/DashboardChart";
import { DashboardPanel } from "@/features/dashboard/ui/DashboardPanel";
import { RecentActivityCard } from "@/features/dashboard/ui/RecentActivityCard";
import type { WorkbenchController } from "@/features/workbench/model/workbench-model";
import { WorkbenchPageClient } from "@/features/workbench/ui/WorkbenchPageClient";

type TestItem = {
  id: string;
  type: string;
  title: string;
  status: string;
  area_id?: string;
  project_id?: string;
  routine_id?: string;
  scheduled?: string;
  due?: string;
  completed_at?: string;
  updated_at?: string;
};

const today = "2026-07-29";

function jsonResponse(value: unknown = []): Response {
  return {
    ok: true,
    json: async () => value,
  } as Response;
}

function ravenDashboardResponse() {
  return {
    request_id: "00000000-0000-4000-8000-000000000001",
    todo: {
      status: "ok",
      data: {
        active: 0,
        today_completed: 0,
        today_incomplete: 0,
        today_missed: 0,
        today_total: 0,
        overdue: 0,
      },
    },
    ledger: {
      status: "ok",
      data: {
        period_start: "2026-07-01",
        period_end: "2026-07-31",
        currencies: [],
      },
    },
    health: {
      status: "ok",
      data: {
        latest_condition: null,
        latest_sleep: null,
        latest_bowel: null,
        latest_medication: null,
        recent_diet_tags: [],
      },
    },
    recent_activity: [],
  };
}

function ravenResponse(): Response {
  return new Response(JSON.stringify(ravenDashboardResponse()), {
    headers: { "content-type": "application/json" },
  });
}

function installLoadedDashboard(items: TestItem[]) {
  const fetchMock = vi.fn((url: string) => {
    if (url === "/api/v1/preferences/planner.v1") {
      return Promise.resolve(jsonResponse(null));
    }
    if (url === "/api/v1/todo/items") {
      return Promise.resolve(jsonResponse(items));
    }
    if (url === "/api/v1/dashboard") {
      return Promise.resolve(ravenResponse());
    }

    const itemType = new URL(url, "http://localhost").searchParams.get("type");
    return Promise.resolve(
      jsonResponse(
        itemType === null
          ? []
          : items.filter((item) => item.type === itemType),
      ),
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function renderLoadedDashboard(items: TestItem[]) {
  installLoadedDashboard(items);
  render(<WorkbenchPageClient />);
  await screen.findByRole("heading", { name: "Dashboard" });
}

function populatedItems(): TestItem[] {
  return [
    {
      id: "area-health",
      type: "area",
      title: "Health",
      status: "active",
    },
    {
      id: "project-release",
      type: "project",
      title: "Release",
      status: "active",
      due: "2026-07-28",
      updated_at: "2026-07-29T08:00:00",
    },
    {
      id: "project-unplanned",
      type: "project",
      title: "Unplanned",
      status: "active",
      updated_at: "2026-07-29T08:00:00",
    },
    {
      id: "task-done",
      type: "task",
      title: "Done",
      status: "completed",
      scheduled: today,
      completed_at: "2026-07-29T09:00:00",
      area_id: "area-health",
      project_id: "project-release",
    },
    {
      id: "event-open",
      type: "event",
      title: "Meet",
      status: "active",
      due: today,
      area_id: "area-health",
      project_id: "project-release",
    },
    {
      id: "task-missed",
      type: "task",
      title: "Miss",
      status: "missed",
      scheduled: today,
      area_id: "area-health",
      project_id: "project-release",
    },
    {
      id: "routine-template",
      type: "routine",
      title: "Template",
      status: "active",
      scheduled: today,
      area_id: "area-health",
      project_id: "project-release",
    },
    {
      id: "routine-completed",
      type: "routine",
      title: "Completed template",
      status: "completed",
      scheduled: today,
      completed_at: "2026-07-29T10:00:00",
      area_id: "area-health",
      project_id: "project-release",
    },
    {
      id: "generated-task",
      type: "task",
      title: "Generated",
      status: "waiting",
      scheduled: today,
      routine_id: "routine-template",
      area_id: "area-health",
      project_id: "project-release",
    },
  ];
}

function statusCardItems(): TestItem[] {
  return Array.from({ length: 6 }, (_, index) => {
    const number = index + 1;
    const areaId = `area-${number}`;
    const projectId = `project-${number}`;

    return [
      {
        id: areaId,
        type: "area",
        title: `Area ${number}`,
        status: "active",
      },
      {
        id: projectId,
        type: "project",
        title: `Project ${number}`,
        status: "active",
      },
      {
        id: `task-${number}`,
        type: "task",
        title: `Work ${number}`,
        status: "active",
        area_id: areaId,
        project_id: projectId,
      },
    ];
  }).flat();
}

function setupUser() {
  return userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
}

function dashboardPanelController(items: TestItem[]): WorkbenchController {
  return {
    workspaceItems: {
      status: "loaded",
      items,
      allItems: items,
      tagOptions: [],
      relatedItems: { areas: {}, goals: {}, projects: {}, routines: {} },
    },
    navigateDashboard: vi.fn(),
    reloadDashboard: vi.fn(),
  } as unknown as WorkbenchController;
}

describe("DashboardPanel", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 6, 29, 12));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps successful domain cards visible when Health projection fails", () => {
    const dashboard: RavenDashboard = {
      requestId: "00000000-0000-4000-8000-000000000001",
      todo: {
        status: "ok",
        data: {
          active: 2,
          todayCompleted: 1,
          todayIncomplete: 1,
          todayMissed: 0,
          todayTotal: 2,
          overdue: 0,
        },
      },
      ledger: {
        status: "ok",
        data: {
          periodStart: "2026-07-01",
          periodEnd: "2026-07-31",
          currencies: [{
            currencyCode: "USD",
            incomeMinor: 10000,
            expenseMinor: 4000,
            netChangeMinor: 6000,
          }],
        },
      },
      health: {
        status: "error",
        code: "domain_unavailable",
        message: "This data is currently unavailable.",
        requestId: "00000000-0000-4000-8000-000000000001",
      },
      recentActivity: [],
    };

    render(
      <DashboardPanel
        controller={dashboardPanelController([])}
        initialDashboard={dashboard}
      />,
    );

    expect(screen.getByRole("region", { name: "Today's Plan" })).toBeVisible();
    expect(screen.getByRole("region", { name: "Cash Flow" })).toBeVisible();
    expect(screen.getByText("Health data unavailable")).toBeVisible();
  });

  it("keeps same-time activity actions as distinct React rows", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <RecentActivityCard activity={[
        {
          domain: "ledger",
          domainLabel: "Ledger",
          action: "create",
          recordId: "entry-1",
          timestamp: "2026-07-31T02:00:00Z",
        },
        {
          domain: "ledger",
          domainLabel: "Ledger",
          action: "archive",
          recordId: "entry-1",
          timestamp: "2026-07-31T02:00:00Z",
        },
      ]} />,
    );

    expect(screen.getByText("create", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("archive", { exact: false })).toBeInTheDocument();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("renders four card-shaped skeletons while Dashboard items load", () => {
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

  it("renders all widget-specific empty states and the default zero line", async () => {
    await renderLoadedDashboard([]);

    for (const name of [
      "Today's work",
      "Completion history",
      "Area status",
      "Project status",
    ]) {
      expect(screen.getByRole("region", { name })).toBeInTheDocument();
    }
    expect(
      screen.getByText("No Tasks or Events are scheduled or due today."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("No Tasks or Events were completed in this range."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Create an active or paused Area to view status distribution.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Create an active or paused Project to view status distribution.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("group", { name: "Completion history" })
        .querySelectorAll(".dashboard-line-point"),
    ).toHaveLength(14);
    expect(
      screen.getByRole("form", {
        name: "Completion range 2026-07-16 to 2026-07-29",
      }),
    ).toBeInTheDocument();
  });

  it("renders Task/Event donut counts and excludes Routine definitions", async () => {
    await renderLoadedDashboard(populatedItems());

    const widget = screen.getByRole("region", { name: "Today's work" });
    expect(
      within(widget).getByRole("group", {
        name: "Today's work, total 4",
      }),
    ).toBeInTheDocument();
    expect(
      within(widget).getByText("4", { selector: ".dashboard-donut-total" }),
    ).toBeInTheDocument();
    expect(
      within(widget).getByRole("button", { name: "Completed: 1 (25%)" }),
    ).toHaveTextContent("1");
    expect(
      within(widget).getByRole("button", { name: "Incomplete: 2 (50%)" }),
    ).toHaveTextContent("2");
    expect(
      within(widget).getByRole("button", { name: "Miss: 1 (25%)" }),
    ).toHaveTextContent("1");
    expect(
      screen.getByRole("img", { name: "2026-07-29: 1 completed" }),
    ).toBeInTheDocument();
  });

  it("navigates a donut segment to today's Daily Planner", async () => {
    const user = setupUser();
    await renderLoadedDashboard(populatedItems());

    await user.click(
      screen.getByRole("button", { name: "Completed: 1 (25%)" }),
    );

    expect(
      await screen.findByRole("heading", { name: "July 29, 2026" }),
    ).toBeInTheDocument();
  });

  it("renders a continuous zero line together with its explanation", async () => {
    await renderLoadedDashboard([
      {
        id: "area-health",
        type: "area",
        title: "Health",
        status: "active",
      },
    ]);

    const chart = screen.getByRole("group", { name: "Completion history" });
    expect(within(chart).getAllByRole("img")).toHaveLength(14);
    expect(
      screen.getByText("No Tasks or Events were completed in this range."),
    ).toBeInTheDocument();
  });

  it("applies 7-day and 30-day completion presets", async () => {
    const user = setupUser();
    await renderLoadedDashboard([
      {
        id: "area-health",
        type: "area",
        title: "Health",
        status: "active",
      },
    ]);

    expect(
      screen.getByRole("button", { name: "14 days" }),
    ).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "7 days" }));

    expect(
      screen.getByRole("button", { name: "7 days" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getAllByRole("img", { name: /completed$/ }),
    ).toHaveLength(7);
    expect(
      screen.getByRole("img", { name: "2026-07-23: 0 completed" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "30 days" }));

    expect(
      screen.getByRole("button", { name: "30 days" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getAllByRole("img", { name: /completed$/ }),
    ).toHaveLength(30);
    expect(
      screen.getByRole("img", { name: "2026-06-30: 0 completed" }),
    ).toBeInTheDocument();
  });

  it("rejects a reversed custom range without replacing the last valid line", async () => {
    const user = setupUser();
    await renderLoadedDashboard([
      {
        id: "area-health",
        type: "area",
        title: "Health",
        status: "active",
      },
    ]);
    await user.click(screen.getByRole("button", { name: "30 days" }));
    const lastValidPointCount = screen.getAllByRole("img", {
      name: /completed$/,
    }).length;

    await user.click(screen.getByRole("button", { name: "Custom range" }));
    await user.clear(screen.getByLabelText("Completion start date"));
    await user.type(
      screen.getByLabelText("Completion start date"),
      "2026-07-29",
    );
    await user.clear(screen.getByLabelText("Completion end date"));
    await user.type(
      screen.getByLabelText("Completion end date"),
      "2026-07-28",
    );
    await user.click(
      screen.getByRole("button", { name: "Apply completion range" }),
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Start date must be on or before end date.",
    );
    expect(
      screen.getAllByRole("img", { name: /completed$/ }),
    ).toHaveLength(lastValidPointCount);
    expect(
      screen.getByRole("button", { name: "30 days" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("applies a valid custom completion range", async () => {
    const user = setupUser();
    await renderLoadedDashboard([
      {
        id: "area-health",
        type: "area",
        title: "Health",
        status: "active",
      },
    ]);

    await user.click(screen.getByRole("button", { name: "Custom range" }));
    await user.clear(screen.getByLabelText("Completion start date"));
    await user.type(
      screen.getByLabelText("Completion start date"),
      "2026-07-27",
    );
    await user.clear(screen.getByLabelText("Completion end date"));
    await user.type(
      screen.getByLabelText("Completion end date"),
      "2026-07-29",
    );
    await user.click(
      screen.getByRole("button", { name: "Apply completion range" }),
    );

    expect(
      screen.getByRole("button", { name: "Custom range" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(
      screen.getAllByRole("img", { name: /completed$/ }),
    ).toHaveLength(3);
    expect(
      screen.getByRole("img", { name: "2026-07-27: 0 completed" }),
    ).toBeInTheDocument();
  });

  it("applies an exact 366-day inclusive completion range", async () => {
    const user = setupUser();
    await renderLoadedDashboard([]);

    await user.click(screen.getByRole("button", { name: "Custom range" }));
    await user.clear(screen.getByLabelText("Completion start date"));
    await user.type(
      screen.getByLabelText("Completion start date"),
      "2025-07-29",
    );
    await user.click(
      screen.getByRole("button", { name: "Apply completion range" }),
    );

    expect(screen.queryByRole("alert")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Custom range" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getAllByRole("img", { name: /completed$/ }),
    ).toHaveLength(366);
  });

  it("rejects a 367-day range without replacing the last valid line", async () => {
    const user = setupUser();
    await renderLoadedDashboard([]);
    await user.click(screen.getByRole("button", { name: "30 days" }));
    const lastValidPointCount = screen.getAllByRole("img", {
      name: /completed$/,
    }).length;

    await user.click(screen.getByRole("button", { name: "Custom range" }));
    await user.clear(screen.getByLabelText("Completion start date"));
    await user.type(
      screen.getByLabelText("Completion start date"),
      "2025-07-28",
    );
    await user.click(
      screen.getByRole("button", { name: "Apply completion range" }),
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Completion range must be 366 days or fewer.",
    );
    expect(
      screen.getAllByRole("img", { name: /completed$/ }),
    ).toHaveLength(lastValidPointCount);
    expect(
      screen.getByRole("button", { name: "30 days" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("form", {
        name: "Completion range 2026-06-30 to 2026-07-29",
      }),
    ).toBeInTheDocument();
  });

  it("renders Area heatmap names and opens Area detail from a cell", async () => {
    const user = setupUser();
    await renderLoadedDashboard(populatedItems());

    expect(
      screen.getByRole("button", { name: "Health: 1 completed" }),
    ).toHaveTextContent("1");
    expect(
      screen.getByRole("button", { name: "Health: 2 incomplete" }),
    ).toHaveTextContent("2");
    await user.click(
      screen.getByRole("button", { name: "Health: 1 miss" }),
    );

    expect(
      await screen.findByRole("region", { name: "Health details" }),
    ).toBeInTheDocument();
  });

  it("renders Project Risk in its name and progress and opens detail from a cell", async () => {
    const user = setupUser();
    await renderLoadedDashboard(populatedItems());

    expect(
      screen.getByRole("button", { name: "Release · Risk" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Progress 25% · Risk")).toBeInTheDocument();
    expect(screen.getByText("Progress —")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Release: 1 miss" }),
    ).toHaveTextContent("1");
    await user.click(
      screen.getByRole("button", { name: "Release: 1 miss" }),
    );

    expect(
      await screen.findByRole("region", { name: "Release details" }),
    ).toBeInTheDocument();
  });

  it("groups Area and Project status previews and expands each card independently", async () => {
    const user = setupUser();
    await renderLoadedDashboard(statusCardItems());

    const statusGrid = document.querySelector(".dashboard-status-grid");
    const area = screen.getByRole("region", { name: "Area status" });
    const project = screen.getByRole("region", { name: "Project status" });

    expect(statusGrid).toContainElement(area);
    expect(statusGrid).toContainElement(project);
    expect(area).not.toBe(project);
    expect(within(area).getAllByRole("row")).toHaveLength(6);
    expect(within(project).getAllByRole("row")).toHaveLength(6);

    await user.click(within(area).getByRole("button", {
      name: "Area status 전체 보기",
    }));

    expect(within(area).getAllByRole("row")).toHaveLength(7);
    expect(within(project).getAllByRole("row")).toHaveLength(6);
    expect(within(area).getByRole("button", {
      name: "Area status 접기",
    })).toHaveAttribute("aria-expanded", "true");
    expect(within(project).getByRole("button", {
      name: "Project status 전체 보기",
    })).toHaveAttribute("aria-expanded", "false");
  });

  it("resets only an expanded Area preview after its rows shrink to zero and grow again", async () => {
    const user = setupUser();
    const items = statusCardItems();
    const { rerender } = render(
      <DashboardPanel controller={dashboardPanelController(items)} />,
    );
    const area = screen.getByRole("region", { name: "Area status" });
    const project = screen.getByRole("region", { name: "Project status" });

    await user.click(within(area).getByRole("button", {
      name: "Area status 전체 보기",
    }));
    await user.click(within(project).getByRole("button", {
      name: "Project status 전체 보기",
    }));

    rerender(
      <DashboardPanel
        controller={dashboardPanelController(
          items.filter((item) => item.type !== "area"),
        )}
      />,
    );

    expect(
      within(screen.getByRole("region", { name: "Area status" })).queryByRole(
        "table",
      ),
    ).toBeNull();
    expect(within(screen.getByRole("region", { name: "Project status" }))
      .getByRole("button", { name: "Project status 접기" }))
      .toHaveAttribute("aria-expanded", "true");

    rerender(
      <DashboardPanel controller={dashboardPanelController(items)} />,
    );

    expect(
      within(screen.getByRole("region", { name: "Area status" }))
        .getAllByRole("row"),
    ).toHaveLength(6);
    expect(within(screen.getByRole("region", { name: "Area status" }))
      .getByRole("button", { name: "Area status 전체 보기" }))
      .toHaveAttribute("aria-expanded", "false");
    expect(within(screen.getByRole("region", { name: "Project status" }))
      .getByRole("button", { name: "Project status 접기" }))
      .toHaveAttribute("aria-expanded", "true");
  });

  it("retries a failed all-items request", async () => {
    const user = setupUser();
    let dashboardAttempts = 0;
    const fetchMock = vi.fn((url: string) => {
      if (url === "/api/v1/dashboard") {
        return Promise.resolve(ravenResponse());
      }
      if (url !== "/api/v1/todo/items") {
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
      await screen.findByRole("region", { name: "Today's work" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("No Tasks or Events are scheduled or due today."),
    ).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.filter(([url]) => url === "/api/v1/todo/items"),
    ).toHaveLength(2);
  });

  it("maps reordered donut segments to ID-based CSS boundaries and navigation", async () => {
    const user = setupUser();
    const onNavigate = vi.fn();
    const chart: DashboardChartSpec = {
      kind: "donut",
      ariaLabel: "Today's work",
      total: 4,
      segments: [
        {
          id: "incomplete",
          label: "Incomplete",
          value: 1,
          percentage: 25,
          tone: "primary",
          ariaLabel: "Incomplete: 1 (25%)",
          destination: { kind: "daily", date: "2026-07-28" },
        },
        {
          id: "missed",
          label: "Miss",
          value: 1,
          percentage: 25,
          tone: "warning",
          ariaLabel: "Miss: 1 (25%)",
          destination: { kind: "daily", date: "2026-07-28" },
        },
        {
          id: "completed",
          label: "Completed",
          value: 2,
          percentage: 50,
          tone: "success",
          ariaLabel: "Completed: 2 (50%)",
          destination: { kind: "daily", date: "2026-07-28" },
        },
      ],
    };

    const { container } = render(
      <DashboardChart chart={chart} onNavigate={onNavigate} />,
    );

    const ring = container.querySelector<HTMLElement>(".dashboard-donut-ring");
    expect(ring?.style.getPropertyValue("--dashboard-donut-completed-end"))
      .toBe("50%");
    expect(ring?.style.getPropertyValue("--dashboard-donut-incomplete-end"))
      .toBe("75%");
    expect(ring?.style.getPropertyValue("--dashboard-donut-missed-end"))
      .toBe("100%");

    const completed = screen.getByRole("button", { name: "Completed: 2 (50%)" });
    expect(completed).toHaveTextContent("2");
    await user.click(completed);
    expect(onNavigate).toHaveBeenCalledWith({
      kind: "daily",
      date: "2026-07-28",
    });
  });

  it("uses raw equal-third donut geometry and closes the final boundary", () => {
    const chart: DashboardChartSpec = {
      kind: "donut",
      ariaLabel: "Today's work",
      total: 3,
      segments: [
        {
          id: "completed",
          label: "Completed",
          value: 1,
          percentage: 100 / 3,
          tone: "success",
          ariaLabel: "Completed: 1 (33%)",
          destination: { kind: "daily", date: "2026-07-28" },
        },
        {
          id: "incomplete",
          label: "Incomplete",
          value: 1,
          percentage: 100 / 3,
          tone: "primary",
          ariaLabel: "Incomplete: 1 (33%)",
          destination: { kind: "daily", date: "2026-07-28" },
        },
        {
          id: "missed",
          label: "Miss",
          value: 1,
          percentage: 100 / 3,
          tone: "warning",
          ariaLabel: "Miss: 1 (33%)",
          destination: { kind: "daily", date: "2026-07-28" },
        },
      ],
    };

    const { container } = render(
      <DashboardChart chart={chart} onNavigate={vi.fn()} />,
    );

    const ring = container.querySelector<HTMLElement>(".dashboard-donut-ring");
    expect(ring?.style.getPropertyValue("--dashboard-donut-completed-end"))
      .toBe(`${100 / 3}%`);
    expect(ring?.style.getPropertyValue("--dashboard-donut-incomplete-end"))
      .toBe(`${200 / 3}%`);
    expect(ring?.style.getPropertyValue("--dashboard-donut-missed-end"))
      .toBe("100%");
    for (const name of [
      "Completed: 1 (33%)",
      "Incomplete: 1 (33%)",
      "Miss: 1 (33%)",
    ]) {
      expect(screen.getByRole("button", { name })).toHaveTextContent("33%");
    }
  });

  it("renders informational line points as focusable images without navigation", () => {
    const onNavigate = vi.fn();
    const chart: DashboardChartSpec = {
      kind: "line",
      ariaLabel: "Completion history",
      points: [{
        id: "2026-07-28",
        label: "2026-07-28",
        value: 2,
        ariaLabel: "2026-07-28: 2 completed",
      }],
    };

    const { container } = render(
      <DashboardChart chart={chart} onNavigate={onNavigate} />,
    );

    expect(
      screen.getByRole("img", { name: "2026-07-28: 2 completed" }),
    ).toHaveAttribute("tabindex", "0");
    expect(container.querySelector(".dashboard-line-svg"))
      .toHaveAttribute("preserveAspectRatio", "none");
    expect(screen.getByText("2026-07-28: 2 completed")).toBeInTheDocument();
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("shows every date for a seven-point completion range", () => {
    const points = Array.from({ length: 7 }, (_, index) => {
      const date = `2026-07-${String(index + 1).padStart(2, "0")}`;
      return {
        id: date,
        label: date,
        value: index,
        ariaLabel: `${date}: ${index} completed`,
      };
    });

    const { container } = render(
      <DashboardChart
        chart={{
          kind: "line",
          ariaLabel: "Completion history",
          points,
        }}
        onNavigate={vi.fn()}
      />,
    );

    expect(
      Array.from(
        container.querySelectorAll(".dashboard-line-x-tick"),
        (tick) => tick.textContent,
      ),
    ).toEqual([
      "2026-07-01",
      "2026-07-02",
      "2026-07-03",
      "2026-07-04",
      "2026-07-05",
      "2026-07-06",
      "2026-07-07",
    ]);
  });

  it("derives evenly spaced endpoint-inclusive dates for longer ranges", () => {
    const points = Array.from({ length: 30 }, (_, index) => {
      const date = `2026-07-${String(index + 1).padStart(2, "0")}`;
      return {
        id: date,
        label: date,
        value: 0,
        ariaLabel: `${date}: 0 completed`,
      };
    });

    const { container } = render(
      <DashboardChart
        chart={{
          kind: "line",
          ariaLabel: "Completion history",
          points,
        }}
        onNavigate={vi.fn()}
      />,
    );

    expect(
      Array.from(
        container.querySelectorAll(".dashboard-line-x-tick"),
        (tick) => tick.textContent,
      ),
    ).toEqual([
      "2026-07-01",
      "2026-07-06",
      "2026-07-11",
      "2026-07-16",
      "2026-07-21",
      "2026-07-26",
      "2026-07-30",
    ]);
  });

  it("derives integer completion-count ticks from zero to the maximum", () => {
    const { container } = render(
      <DashboardChart
        chart={{
          kind: "line",
          ariaLabel: "Completion history",
          points: [
            {
              id: "2026-07-01",
              label: "2026-07-01",
              value: 0,
              ariaLabel: "2026-07-01: 0 completed",
            },
            {
              id: "2026-07-02",
              label: "2026-07-02",
              value: 7,
              ariaLabel: "2026-07-02: 7 completed",
            },
          ],
        }}
        onNavigate={vi.fn()}
      />,
    );

    expect(
      Array.from(
        container.querySelectorAll(".dashboard-line-y-tick"),
        (tick) => Number(tick.textContent),
      ),
    ).toEqual([7, 6, 4, 2, 0]);
  });

  it("renders semantic heatmap row and cell buttons with typed destinations", async () => {
    const user = setupUser();
    const onNavigate = vi.fn();
    const chart: DashboardChartSpec = {
      kind: "heatmap",
      ariaLabel: "Project status",
      columns: [
        { id: "completed", label: "Completed", tone: "success" },
      ],
      rows: [
        {
          id: "area-health",
          label: "Health",
          destination: { kind: "area-detail", itemId: "area-health" },
          cells: [{
            id: "area-health-completed",
            columnId: "completed",
            value: 1,
            intensityPercent: 50,
            ariaLabel: "Health: 1 completed",
          }],
        },
        {
          id: "project-release",
          label: "Release",
          progressLabel: "Progress 50%",
          attention: "risk",
          destination: {
            kind: "project-detail",
            itemId: "project-release",
          },
          cells: [{
            id: "project-release-completed",
            columnId: "completed",
            value: 2,
            intensityPercent: 50,
            ariaLabel: "Release: 2 completed",
          }],
        },
      ],
    };

    render(<DashboardChart chart={chart} onNavigate={onNavigate} />);

    const table = screen.getByRole("table");
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getAllByRole("columnheader")).toHaveLength(3);
    expect(
      within(rows[1]).getByRole("rowheader"),
    ).toContainElement(screen.getByRole("button", { name: "Health" }));
    expect(within(rows[1]).getAllByRole("cell")).toHaveLength(2);
    expect(
      within(rows[2]).getByRole("rowheader"),
    ).toContainElement(screen.getByRole("button", { name: "Release · Risk" }));
    expect(within(rows[2]).getAllByRole("cell")).toHaveLength(2);

    const areaCell = screen.getByRole("button", { name: "Health: 1 completed" });
    expect(areaCell).toHaveTextContent("1");
    expect(areaCell.style.getPropertyValue("--dashboard-heatmap-intensity"))
      .toBe("0.5");
    await user.click(areaCell);
    await user.click(screen.getByRole("button", { name: "Release · Risk" }));
    expect(onNavigate.mock.calls).toEqual([
      [{ kind: "area-detail", itemId: "area-health" }],
      [{ kind: "project-detail", itemId: "project-release" }],
    ]);
    expect(screen.getByText("Progress 50%")).toBeInTheDocument();
  });

  it("limits controlled heatmap previews and requests expansion", async () => {
    const user = setupUser();
    const onExpandedChange = vi.fn();
    const chart: DashboardChartSpec = {
      kind: "heatmap",
      ariaLabel: "Area status",
      columns: [{ id: "completed", label: "Completed", tone: "success" }],
      rows: heatmapRows(6),
    };

    render(
      <DashboardChart
        chart={chart}
        onNavigate={vi.fn()}
        heatmapVisibility={{
          limit: 5,
          expanded: false,
          onExpandedChange,
        }}
      />,
    );

    expect(within(screen.getByRole("table")).getAllByRole("row"))
      .toHaveLength(6);
    const toggle = screen.getByRole("button", {
      name: "Area status 전체 보기",
    });
    expect(toggle).toHaveTextContent("전체 보기 (총 6개)");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);
    expect(onExpandedChange).toHaveBeenCalledWith(true);
  });

  it("omits the controlled heatmap toggle when every row is visible", () => {
    const chart: DashboardChartSpec = {
      kind: "heatmap",
      ariaLabel: "Area status",
      columns: [{ id: "completed", label: "Completed", tone: "success" }],
      rows: heatmapRows(5),
    };

    render(
      <DashboardChart
        chart={chart}
        onNavigate={vi.fn()}
        heatmapVisibility={{
          limit: 5,
          expanded: false,
          onExpandedChange: vi.fn(),
        }}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "Area status 전체 보기" }),
    ).toBeNull();
  });

  it("requests one collapse when an expanded controlled heatmap shrinks to its preview limit", () => {
    const onExpandedChange = vi.fn();
    const chart: DashboardChartSpec = {
      kind: "heatmap",
      ariaLabel: "Area status",
      columns: [{ id: "completed", label: "Completed", tone: "success" }],
      rows: heatmapRows(6),
    };
    const { rerender } = render(
      <DashboardChart
        chart={chart}
        onNavigate={vi.fn()}
        heatmapVisibility={{
          limit: 5,
          expanded: true,
          onExpandedChange,
        }}
      />,
    );

    rerender(
      <DashboardChart
        chart={{ ...chart, rows: heatmapRows(5) }}
        onNavigate={vi.fn()}
        heatmapVisibility={{
          limit: 5,
          expanded: true,
          onExpandedChange,
        }}
      />,
    );

    expect(onExpandedChange).toHaveBeenCalledTimes(1);
    expect(onExpandedChange).toHaveBeenCalledWith(false);

    rerender(
      <DashboardChart
        chart={{ ...chart, rows: heatmapRows(5) }}
        onNavigate={vi.fn()}
        heatmapVisibility={{
          limit: 5,
          expanded: false,
          onExpandedChange,
        }}
      />,
    );

    expect(onExpandedChange).toHaveBeenCalledTimes(1);
  });
});

function heatmapRows(count: number): Extract<
  DashboardChartSpec,
  { kind: "heatmap" }
>["rows"] {
  return Array.from({ length: count }, (_, index) => ({
    id: `area-${index + 1}`,
    label: `Area ${index + 1}`,
    destination: { kind: "area-detail", itemId: `area-${index + 1}` },
    cells: [{
      id: `area-${index + 1}-completed`,
      columnId: "completed",
      value: index,
      intensityPercent: 0,
      ariaLabel: `Area ${index + 1}: ${index} completed`,
    }],
  }));
}
