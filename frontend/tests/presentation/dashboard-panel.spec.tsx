import "@testing-library/jest-dom/vitest";

import { render, screen, within } from "@testing-library/react";
import React from "react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DashboardChartSpec } from "@/features/dashboard/model/dashboard-widgets";
import { DashboardChart } from "@/features/dashboard/ui/DashboardChart";
import { DashboardPanel } from "@/features/dashboard/ui/DashboardPanel";
import { HealthSummaryCard } from "@/features/dashboard/ui/HealthSummaryCard";
import { RecentActivityCard } from "@/features/dashboard/ui/RecentActivityCard";
import {
  loadLedgerReport,
  type LedgerReportData,
} from "@/features/ledger/api/ledger-report-loader";
import type { WorkbenchController } from "@/features/workbench/model/workbench-model";
import { WorkbenchPageClient } from "@/features/workbench/ui/WorkbenchPageClient";

vi.mock("@/features/ledger/api/ledger-report-loader", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/features/ledger/api/ledger-report-loader")>(),
  loadLedgerReport: vi.fn(),
}));

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
const dashboardLedgerProps = {
  ledgerMutationEpoch: 0,
  onLedgerNavigate: vi.fn(),
};

function jsonResponse(value: unknown = []): Response {
  return {
    ok: true,
    json: async () => value,
  } as Response;
}

function installLoadedDashboard(items: TestItem[]) {
  const fetchMock = vi.fn((url: string) => {
    if (url === "/api/v1/preferences/planner.v1") {
      return Promise.resolve(jsonResponse(null));
    }
    if (url === "/api/v1/todo/items") {
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
  const fetchMock = installLoadedDashboard(items);
  render(<WorkbenchPageClient />);
  await screen.findByRole("heading", { name: "Dashboard" });
  return fetchMock;
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

function emptyLedgerReportData(): LedgerReportData {
  const currentRange = { start: "2026-07-01", end: "2026-07-31" };
  const previousRange = { start: "2026-06-01", end: "2026-06-30" };
  const current = { range: currentRange, currencies: [] };
  return {
    comparison: {
      current,
      previous: { range: previousRange, currencies: [] },
      currencies: [],
    },
    categoryBreakdown: [],
    trend: { range: currentRange, granularity: "daily", currencies: [] },
    balances: [],
    summary: current,
  };
}

describe("DashboardPanel", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 6, 29, 12));
    vi.mocked(loadLedgerReport).mockReset().mockReturnValue(new Promise(() => undefined));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("points Health Journal detailed analysis to Reports", () => {
    render(
      <HealthSummaryCard
        projection={{ status: "ok", data: { metrics: [], recentDietTags: [] } }}
      />,
    );

    expect(screen.getByRole("region", { name: "Health Journal summary" }))
      .toHaveTextContent("Detailed analysis is available in Reports.");
  });

  it("renders ToDo analytics followed by Ledger highlights without requesting unified summaries", async () => {
    vi.mocked(loadLedgerReport).mockResolvedValueOnce(emptyLedgerReportData());
    const fetchMock = await renderLoadedDashboard(populatedItems());

    for (const name of [
      "Today's work",
      "Completion history",
      "Status",
    ]) {
      expect(screen.getByRole("region", { name })).toBeVisible();
    }
    for (const name of ["Today's Plan", "Health Journal summary", "Recent activity"]) {
      expect(screen.queryByRole("region", { name })).toBeNull();
    }
    const ledger = await screen.findByRole("region", { name: "Ledger highlights" });
    expect(await within(ledger).findByText("No Ledger currencies available."))
      .toBeVisible();
    expect(document.querySelector(".dashboard-panel")?.lastElementChild).toBe(ledger);
    expect(
      fetchMock.mock.calls.some(([url]) => url === "/api/v1/dashboard"),
    ).toBe(false);
  });

  it("keeps loaded ToDo analytics when Ledger highlights fail", async () => {
    vi.mocked(loadLedgerReport).mockRejectedValueOnce(
      new Error("C:\\private\\ledger.sqlite failed"),
    );
    await renderLoadedDashboard(populatedItems());

    for (const name of ["Today's work", "Completion history", "Status"]) {
      expect(screen.getByRole("region", { name })).toBeVisible();
    }
    const ledger = await screen.findByRole("region", { name: "Ledger highlights" });
    expect(await within(ledger).findByRole("alert"))
      .toHaveTextContent("Could not load Ledger highlights.");
    expect(within(ledger).getByRole("button", { name: "Retry Ledger highlights" }))
      .toBeVisible();
    expect(screen.queryByRole("button", { name: "Retry Dashboard" })).toBeNull();
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

  it("renders three card-shaped skeletons while Dashboard items load", () => {
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
    ).toHaveLength(3);
    expect(loading.querySelector(".dashboard-skeleton-status"))
      .toBeInTheDocument();
  });

  it("renders all widget-specific empty states and the default zero line", async () => {
    await renderLoadedDashboard([]);

    for (const name of [
      "Today's work",
      "Completion history",
      "Status",
    ]) {
      expect(screen.getByRole("region", { name })).toBeInTheDocument();
    }
    expect(
      screen.getByText("No Tasks or Events are scheduled or due today."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("No Tasks or Events are scheduled or due in this range."),
    ).toBeInTheDocument();
    const projectEmpty = screen.getByText(
      "Create an active Project to view status distribution.",
    );
    expect(projectEmpty).toBeVisible();
    await setupUser().click(screen.getByRole("tab", { name: "Area" }));
    expect(
      screen.getByText(
        "Create an active or paused Area to view status distribution.",
      ),
    ).toBeVisible();
    expect(projectEmpty).not.toBeVisible();
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
      screen.getByRole("img", { name: "2026-07-29: 25% completed (1/4)" }),
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

  it("renders a continuous zero line together with its no-work explanation", async () => {
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
      screen.getByText("No Tasks or Events are scheduled or due in this range."),
    ).toBeInTheDocument();
  });

  it("renders scheduled or due work at zero percent without the no-work message", async () => {
    await renderLoadedDashboard([
      {
        id: "task-open",
        type: "task",
        title: "Open",
        status: "active",
        scheduled: today,
      },
    ]);

    expect(
      screen.getByRole("img", { name: "2026-07-29: 0% completed (0/1)" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("No Tasks or Events are scheduled or due in this range."),
    ).toBeNull();
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
      screen.getAllByRole("img", { name: /completed \(/ }),
    ).toHaveLength(7);
    expect(
      screen.getByRole("img", { name: "2026-07-23: 0% completed (0/0)" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "30 days" }));

    expect(
      screen.getByRole("button", { name: "30 days" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getAllByRole("img", { name: /completed \(/ }),
    ).toHaveLength(30);
    expect(
      screen.getByRole("img", { name: "2026-06-30: 0% completed (0/0)" }),
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
      name: /completed \(/,
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
      screen.getAllByRole("img", { name: /completed \(/ }),
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
      screen.getAllByRole("img", { name: /completed \(/ }),
    ).toHaveLength(3);
    expect(
      screen.getByRole("img", { name: "2026-07-27: 0% completed (0/0)" }),
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
      screen.getAllByRole("img", { name: /completed \(/ }),
    ).toHaveLength(366);
  });

  it("rejects a 367-day range without replacing the last valid line", async () => {
    const user = setupUser();
    await renderLoadedDashboard([]);
    await user.click(screen.getByRole("button", { name: "30 days" }));
    const lastValidPointCount = screen.getAllByRole("img", {
      name: /completed \(/,
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
      screen.getAllByRole("img", { name: /completed \(/ }),
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

  it("renders Area status totals and opens Area detail from its tile", async () => {
    const user = setupUser();
    await renderLoadedDashboard(populatedItems());
    await user.click(screen.getByRole("tab", { name: "Area" }));

    const tile = screen.getByRole("button", {
      name: "Health: Total 4, 1 completed, 2 incomplete, 0 paused, 1 miss",
    });
    expect(tile).toHaveTextContent("Completed 25% / Total 4");
    await user.click(tile);

    expect(
      await screen.findByRole("region", { name: "Health details" }),
    ).toBeInTheDocument();
  });

  it("renders Project Risk and progress and opens detail from its tile", async () => {
    const user = setupUser();
    await renderLoadedDashboard(populatedItems());

    const release = screen.getByRole("button", {
      name: "Release: Progress 25%, Risk, 1 completed, 2 incomplete, 0 paused, 1 miss",
    });
    expect(release).toHaveTextContent("25%");
    expect(release).toHaveTextContent("Risk / Miss 1 / Total 4");
    const unplanned = screen.getByRole("button", {
      name: "Unplanned: Progress —, Normal, 0 completed, 0 incomplete, 0 paused, 0 miss",
    });
    expect(unplanned).toHaveTextContent("—");
    expect(unplanned.querySelector(".dashboard-status-donut"))
      .toHaveClass("is-empty");
    await user.click(release);

    expect(
      await screen.findByRole("region", { name: "Release details" }),
    ).toBeInTheDocument();
  });

  it("tabs between Project and Area status with linked accessible panels", async () => {
    const user = setupUser();
    await renderLoadedDashboard(populatedItems());

    const status = screen.getByRole("region", { name: "Status" });
    const tablist = within(status).getByRole("tablist", {
      name: "Status scope",
    });
    const project = within(tablist).getByRole("tab", { name: "Project" });
    const area = within(tablist).getByRole("tab", { name: "Area" });
    expect(project).toHaveAttribute("aria-selected", "true");
    expect(project).toHaveAttribute("tabindex", "0");
    expect(project).toHaveAttribute(
      "aria-controls",
      "dashboard-status-panel-project",
    );
    expect(area).toHaveAttribute("aria-selected", "false");
    expect(area).toHaveAttribute("tabindex", "-1");
    expect(area).toHaveAttribute(
      "aria-controls",
      "dashboard-status-panel-area",
    );
    const projectPanel = document.getElementById(
      project.getAttribute("aria-controls")!,
    );
    const areaPanel = document.getElementById(
      area.getAttribute("aria-controls")!,
    );
    expect(projectPanel).toBeVisible();
    expect(areaPanel).not.toBeVisible();
    expect(tablist).toHaveClass("dashboard-status-tabs");
    expect(projectPanel).toHaveAttribute(
      "aria-labelledby",
      "dashboard-status-tab-project",
    );
    expect(areaPanel).toHaveAttribute(
      "aria-labelledby",
      "dashboard-status-tab-area",
    );
    expect(within(status).getByText("Release")).toBeVisible();

    await user.click(area);
    expect(area).toHaveAttribute("aria-selected", "true");
    expect(projectPanel).not.toBeVisible();
    expect(areaPanel).toBeVisible();
    expect(within(status).getByText("Health")).toBeVisible();
  });

  it("selects and focuses status tabs with wrapping arrow and boundary keys", async () => {
    const user = setupUser();
    render(
      <DashboardPanel
        {...dashboardLedgerProps}
        controller={dashboardPanelController(populatedItems())}
      />,
    );
    const project = screen.getByRole("tab", { name: "Project" });
    const area = screen.getByRole("tab", { name: "Area" });

    project.focus();
    await user.keyboard("{ArrowRight}");
    expect(area).toHaveFocus();
    expect(area).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowRight}");
    expect(project).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(area).toHaveFocus();
    await user.keyboard("{Home}");
    expect(project).toHaveFocus();
    expect(project).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{End}");
    expect(area).toHaveFocus();
    expect(area).toHaveAttribute("aria-selected", "true");
  });

  it("limits status previews to four and preserves expansion per scope", async () => {
    const user = setupUser();
    const items = statusCardItems();
    render(
      <DashboardPanel
        {...dashboardLedgerProps}
        controller={dashboardPanelController(items)}
      />,
    );
    const status = screen.getByRole("region", { name: "Status" });

    expect(within(status).getByRole("tabpanel")
      .querySelectorAll(".dashboard-status-tile")).toHaveLength(4);
    await user.click(within(status).getByRole("button", { expanded: false }));
    expect(within(status).getByRole("tabpanel")
      .querySelectorAll(".dashboard-status-tile")).toHaveLength(6);

    await user.click(within(status).getByRole("tab", { name: "Area" }));
    expect(within(status).getByRole("tabpanel")
      .querySelectorAll(".dashboard-status-tile")).toHaveLength(4);
    await user.click(within(status).getByRole("button", { expanded: false }));
    expect(within(status).getByRole("tabpanel")
      .querySelectorAll(".dashboard-status-tile")).toHaveLength(6);

    await user.click(within(status).getByRole("tab", { name: "Project" }));
    expect(within(status).getByRole("tabpanel")
      .querySelectorAll(".dashboard-status-tile")).toHaveLength(6);
    expect(within(status).getByRole("button", { expanded: true }))
      .toBeInTheDocument();
  });

  it("collapses an expanded status scope when its rows shrink to four", async () => {
    const user = setupUser();
    const items = statusCardItems();
    const { rerender } = render(
      <DashboardPanel
        {...dashboardLedgerProps}
        controller={dashboardPanelController(items)}
      />,
    );
    const status = screen.getByRole("region", { name: "Status" });

    await user.click(within(status).getByRole("button", { expanded: false }));
    expect(within(status).getByRole("tabpanel")
      .querySelectorAll(".dashboard-status-tile")).toHaveLength(6);

    rerender(
      <DashboardPanel
        {...dashboardLedgerProps}
        controller={dashboardPanelController(
          items.filter(
            (item) => !item.id.endsWith("-5") && !item.id.endsWith("-6"),
          ),
        )}
      />,
    );
    expect(within(status).queryByRole("button", { expanded: true })).toBeNull();

    rerender(
      <DashboardPanel
        {...dashboardLedgerProps}
        controller={dashboardPanelController(items)}
      />,
    );
    expect(within(status).getByRole("tabpanel")
      .querySelectorAll(".dashboard-status-tile")).toHaveLength(4);
    expect(within(status).getByRole("button", { expanded: false }))
      .toBeInTheDocument();
  });

  it("retries a failed all-items request", async () => {
    const user = setupUser();
    let dashboardAttempts = 0;
    const fetchMock = vi.fn((url: string) => {
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
      total: 2,
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
          total: 7,
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

  it("spaces fourteen-day completion labels evenly through both endpoints", () => {
    const points = Array.from({ length: 14 }, (_, index) => {
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
          total: 0,
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
      "2026-07-03",
      "2026-07-05",
      "2026-07-08",
      "2026-07-10",
      "2026-07-12",
      "2026-07-14",
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
          total: 0,
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
      "2026-07-20",
      "2026-07-25",
      "2026-07-30",
    ]);
  });

  it("renders a fixed zero-to-one-hundred percentage axis", () => {
    const completedItems = Array.from({ length: 3 }, (_, index) => ({
      id: `completed-${index}`,
      type: "task",
      title: `Completed ${index}`,
      status: "completed",
      scheduled: today,
      completed_at: `${today}T09:00:00`,
    }));
    const openItems = Array.from({ length: 3 }, (_, index) => ({
      id: `open-${index}`,
      type: "task",
      title: `Open ${index}`,
      status: "active",
      scheduled: index < 2 ? "2026-07-28" : today,
    }));
    render(
      <DashboardPanel
        {...dashboardLedgerProps}
        controller={dashboardPanelController([...completedItems, ...openItems])}
      />,
    );

    const chart = screen.getByRole("group", { name: "Completion history" });
    expect(
      Array.from(
        chart.querySelectorAll(".dashboard-line-y-tick"),
        (tick) => tick.textContent,
      ),
    ).toEqual(["100%", "75%", "50%", "25%", "0%"]);
    expect(
      screen.getByRole("img", { name: "2026-07-29: 75% completed (3/4)" }),
    ).toHaveStyle({ top: "31%" });
    expect(screen.getByText("2026-07-29: 75% completed (3/4)"))
      .toBeInTheDocument();
  });

  it("renders an accessible Project status donut and navigates from its tile", async () => {
    const user = setupUser();
    const onNavigate = vi.fn();
    const chart: DashboardChartSpec = {
      kind: "status",
      scope: "project",
      ariaLabel: "Project status",
      rows: [
        {
          id: "project-release",
          label: "Release",
          total: 4,
          progressPercent: 50,
          attention: "risk",
          destination: {
            kind: "project-detail",
            itemId: "project-release",
          },
          segments: [
            { id: "completed", label: "Completed", value: 2, percentage: 50, tone: "success", ariaLabel: "Release: 2 completed" },
            { id: "incomplete", label: "Incomplete", value: 1, percentage: 25, tone: "primary", ariaLabel: "Release: 1 incomplete" },
            { id: "paused", label: "Paused", value: 0, percentage: 0, tone: "secondary", ariaLabel: "Release: 0 paused" },
            { id: "missed", label: "Miss", value: 1, percentage: 25, tone: "warning", ariaLabel: "Release: 1 miss" },
          ],
        },
      ],
    };

    render(<DashboardChart chart={chart} onNavigate={onNavigate} />);

    const tile = screen.getByRole("button", {
      name: "Release: Progress 50%, Risk, 2 completed, 1 incomplete, 0 paused, 1 miss",
    });
    expect(tile).toHaveClass("attention-risk");
    expect(tile.querySelector(".dashboard-status-donut-center"))
      .toHaveTextContent("50%");
    expect(tile).toHaveTextContent("Risk / Miss 1 / Total 4");
    expect(tile.style.getPropertyValue("--dashboard-status-completed-stop"))
      .toBe("50%");
    expect(tile.style.getPropertyValue("--dashboard-status-incomplete-stop"))
      .toBe("75%");
    expect(tile.style.getPropertyValue("--dashboard-status-paused-stop"))
      .toBe("75%");
    await user.click(tile);
    expect(onNavigate).toHaveBeenCalledWith({
      kind: "project-detail",
      itemId: "project-release",
    });
  });

  it("limits controlled status previews and requests expansion", async () => {
    const user = setupUser();
    const onExpandedChange = vi.fn();
    const chart: DashboardChartSpec = {
      kind: "status",
      scope: "area",
      ariaLabel: "Area status",
      rows: statusRows(6),
    };

    render(
      <DashboardChart
        chart={chart}
        onNavigate={vi.fn()}
        statusVisibility={{
          limit: 4,
          expanded: false,
          onExpandedChange,
        }}
      />,
    );

    expect(screen.getAllByRole("button", { name: /^Area \d:/ })).toHaveLength(4);
    const toggle = screen.getByRole("button", { expanded: false });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);
    expect(onExpandedChange).toHaveBeenCalledWith(true);
  });

  it("omits the controlled status toggle when every row is visible", () => {
    const chart: DashboardChartSpec = {
      kind: "status",
      scope: "area",
      ariaLabel: "Area status",
      rows: statusRows(4),
    };

    render(
      <DashboardChart
        chart={chart}
        onNavigate={vi.fn()}
        statusVisibility={{
          limit: 4,
          expanded: false,
          onExpandedChange: vi.fn(),
        }}
      />,
    );

    expect(
      screen.queryByRole("button", { expanded: false }),
    ).toBeNull();
  });

  it("requests one collapse when an expanded controlled status chart shrinks to its preview limit", () => {
    const onExpandedChange = vi.fn();
    const chart: DashboardChartSpec = {
      kind: "status",
      scope: "area",
      ariaLabel: "Area status",
      rows: statusRows(6),
    };
    const { rerender } = render(
      <DashboardChart
        chart={chart}
        onNavigate={vi.fn()}
        statusVisibility={{
          limit: 4,
          expanded: true,
          onExpandedChange,
        }}
      />,
    );

    rerender(
      <DashboardChart
        chart={{ ...chart, rows: statusRows(4) }}
        onNavigate={vi.fn()}
        statusVisibility={{
          limit: 4,
          expanded: true,
          onExpandedChange,
        }}
      />,
    );

    expect(onExpandedChange).toHaveBeenCalledTimes(1);
    expect(onExpandedChange).toHaveBeenCalledWith(false);

    rerender(
      <DashboardChart
        chart={{ ...chart, rows: statusRows(4) }}
        onNavigate={vi.fn()}
        statusVisibility={{
          limit: 4,
          expanded: false,
          onExpandedChange,
        }}
      />,
    );

    expect(onExpandedChange).toHaveBeenCalledTimes(1);
  });
});

function statusRows(count: number): Extract<
  DashboardChartSpec,
  { kind: "status" }
>["rows"] {
  return Array.from({ length: count }, (_, index) => ({
    id: `area-${index + 1}`,
    label: `Area ${index + 1}`,
    total: index,
    destination: { kind: "area-detail", itemId: `area-${index + 1}` },
    segments: [{
      id: "completed",
      label: "Completed",
      value: index,
      percentage: 0,
      tone: "success",
      ariaLabel: `Area ${index + 1}: ${index} completed`,
    }, {
      id: "incomplete", label: "Incomplete", value: 0, percentage: 0, tone: "primary", ariaLabel: `Area ${index + 1}: 0 incomplete`,
    }, {
      id: "paused", label: "Paused", value: 0, percentage: 0, tone: "secondary", ariaLabel: `Area ${index + 1}: 0 paused`,
    }, {
      id: "missed", label: "Miss", value: 0, percentage: 0, tone: "warning", ariaLabel: `Area ${index + 1}: 0 miss`,
    }],
  }));
}
