import "@testing-library/jest-dom/vitest";

import { render, screen, within } from "@testing-library/react";
import React from "react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DashboardChartSpec } from "@/features/dashboard/model/dashboard-widgets";
import { DashboardChart } from "@/features/dashboard/ui/DashboardChart";
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

function installLoadedDashboard(items: TestItem[]) {
  const fetchMock = vi.fn((url: string) => {
    if (url === "/todo-engine/settings/planner") {
      return Promise.resolve(jsonResponse(null));
    }
    if (url === "/todo-engine/items") {
      return Promise.resolve(jsonResponse(items));
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

function setupUser() {
  return userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
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

  it("renders a creation hint for a loaded empty Dashboard", async () => {
    installLoadedDashboard([]);

    render(<WorkbenchPageClient />);

    expect(
      await screen.findByText(
        "Create an Area, Project, or work item to populate analytics.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Today's work" }),
    ).toBeNull();
  });

  it("renders Task/Event donut counts and excludes Routine definitions", async () => {
    await renderLoadedDashboard(populatedItems());

    const widget = screen.getByRole("region", { name: "Today's work" });
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

  it("renders Project Risk and unavailable progress and opens detail from a cell", async () => {
    const user = setupUser();
    await renderLoadedDashboard(populatedItems());

    expect(
      screen.getByRole("button", { name: "Release · Risk" }),
    ).toBeInTheDocument();
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

  it("retries a failed all-items request", async () => {
    const user = setupUser();
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

    render(<DashboardChart chart={chart} onNavigate={onNavigate} />);

    expect(
      screen.getByRole("img", { name: "2026-07-28: 2 completed" }),
    ).toHaveAttribute("tabindex", "0");
    expect(screen.getByText("2026-07-28: 2 completed")).toBeInTheDocument();
    expect(onNavigate).not.toHaveBeenCalled();
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
});
