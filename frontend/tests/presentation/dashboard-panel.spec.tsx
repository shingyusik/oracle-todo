import "@testing-library/jest-dom/vitest";

import { render, screen, within } from "@testing-library/react";
import React from "react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

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
  scheduled?: string;
  due?: string;
};

function jsonResponse(items: TestItem[] = []): Response {
  return {
    ok: true,
    json: async () => items,
  } as Response;
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
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(jsonResponse())),
    );

    render(<WorkbenchPageClient />);

    expect(
      await screen.findByText(
        "Create an Area, Project, or work item to populate analytics.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Area work status" })).toBeNull();
  });

  it("maps reordered donut segments to ID-based CSS boundaries and navigation", async () => {
    const user = userEvent.setup();
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

  it("renders heatmap row and cell buttons with the same typed detail destination", async () => {
    const user = userEvent.setup();
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
