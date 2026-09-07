import "@testing-library/jest-dom/vitest";

import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { healthApi } from "@/features/health/api/health-api";
import type { HealthReport } from "@/features/health/model/health-reports";
import { DashboardHealthHighlights } from "@/features/dashboard/ui/DashboardHealthHighlights";

function report(from: string, to: string): HealthReport {
  return {
    range: { from, to }, previousRange: { from, to },
    metrics: [{ metric: "sleep_duration", name: "Sleep", unit: "hours", current: null, previous: null }],
    dietCount: { current: 4, previous: 0 },
    bowel: { currentCount: 2, previousCount: 0, currentAverage: 4, previousAverage: null },
    medicationCount: { current: 0, previous: 0 },
    bowelPoints: [2, 6].map((bristolScale, index) => ({
      localDate: to, occurredAt: `${to}T0${index}:00:00Z`, bristolScale,
    })),
    metricSeries: ["body_weight", "sleep_duration"].map((metric) => ({
      metric: metric as "body_weight" | "sleep_duration",
      points: [{ localDate: to, occurredAt: `${to}T00:00:00Z`, value: metric === "body_weight" ? 65 : 7 }],
    })),
    medicationFrequencies: [], dietTagFrequencies: [{ name: from === "2026-09-01" ? "rice" : "old-tag", count: 4 }],
    dietTagBowelResponses: [], dietTagBristolComparisons: [{
      tag: "rice",
      withTag: { eligibleMeals: 5, observedMeals: 5, pendingMeals: 0, bristolMeals: [0, 0, 0, 2, 0, 3, 0] },
      withoutTag: { eligibleMeals: 5, observedMeals: 5, pendingMeals: 0, bristolMeals: [0, 0, 0, 4, 0, 1, 0] },
    }], reactionDisclaimer: "",
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 8, 7, 12));
  vi.spyOn(healthApi, "reports").mockImplementation(async ({ from, to }) => report(from, to));
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

it("shows empty states without manufacturing zero readings", async () => {
  vi.mocked(healthApi.reports).mockImplementation(async ({ from, to }) => ({
    ...report(from, to), bowelPoints: [], metricSeries: [], dietTagFrequencies: [], dietTagBristolComparisons: [],
    dietCount: { current: 0, previous: 0 },
  }));
  const { container } = render(<DashboardHealthHighlights onNavigate={vi.fn()} />);
  expect(await screen.findByText("No bowel Bristol readings are available for this period.")).toBeVisible();
  expect(screen.getByText("No weight readings are available for this period.")).toBeVisible();
  expect(screen.getByText("No diet-tag Bristol comparison data are available for this period.")).toBeVisible();
  expect(container.querySelector(".dashboard-line-point")).toBeNull();
});

it("shows weight, bowel, and the heatmap in one shared-period group, then refreshes after mutations", async () => {
  const onNavigate = vi.fn();
  const view = render(<DashboardHealthHighlights mutationEpoch={0} onNavigate={onNavigate} />);
  const bowel = await screen.findByRole("region", { name: "Daily average Bristol score" });
  expect(within(bowel).getByRole("img", { name: /Average Bristol 4 from 2 records/ })).toHaveStyle({ left: "100%" });
  expect(screen.getByRole("region", { name: "Weight trend" })).toHaveTextContent("65 kg");
  expect(screen.queryByRole("region", { name: "Sleep duration trend" })).not.toBeInTheDocument();
  expect(screen.queryByText("Other health metrics")).not.toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Diet tags · Last 7 days" })).not.toBeInTheDocument();
  expect(screen.getByLabelText(/rice, Bristol 6: \+40 pp/)).toHaveTextContent("+40");
  expect(Array.from(view.container.querySelector(".dashboard-health-trends")!.children,
    (child) => child.getAttribute("aria-label"))).toEqual([
    "Weight trend", "Daily average Bristol score", "Diet-tag Bristol comparison",
  ]);
  expect(healthApi.reports).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("old-tag")).not.toBeInTheDocument();
  const axes = view.container.querySelectorAll(".dashboard-line-x-axis");
  expect(axes).toHaveLength(2);
  expect(new Set(Array.from(axes, (axis) => axis.textContent)).size).toBe(1);
  expect(axes[0]).toHaveTextContent("2026-08-25");
  await userEvent.click(screen.getByRole("button", { name: "Health trends: 30 days" }));
  await screen.findByRole("region", { name: "Diet-tag Bristol comparison" });
  expect(healthApi.reports).toHaveBeenCalledWith({ from: "2026-08-09", to: "2026-09-07" });
  expect(healthApi.reports).toHaveBeenCalledTimes(2);
  await userEvent.click(screen.getByRole("button", { name: "Health Journal highlights" }));
  expect(onNavigate).toHaveBeenCalledOnce();
  vi.mocked(healthApi.reports).mockClear();
  view.rerender(<DashboardHealthHighlights mutationEpoch={1} onNavigate={onNavigate} />);
  await screen.findByRole("region", { name: "Weight trend" });
  expect(healthApi.reports).toHaveBeenCalledTimes(1);
});

it("recovers from a safe error and ignores stale responses after a period change", async () => {
  vi.mocked(healthApi.reports).mockRejectedValueOnce(new Error("private storage error"));
  render(<DashboardHealthHighlights onNavigate={vi.fn()} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not load Health Journal highlights.");
  expect(screen.queryByText(/private storage/)).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Retry Health highlights" }));
  await screen.findByRole("region", { name: "Weight trend" });
  let resolve!: (value: HealthReport) => void;
  vi.mocked(healthApi.reports).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
  await userEvent.click(screen.getByRole("button", { name: "Health trends: 30 days" }));
  await userEvent.click(screen.getByRole("button", { name: "Health trends: 7 days" }));
  await screen.findByRole("region", { name: "Weight trend" });
  await act(async () => resolve(report("2026-08-09", "2026-09-07")));
  expect(screen.getByRole("button", { name: "Health trends: 7 days" })).toHaveAttribute("aria-pressed", "true");
  expect(document.querySelector(".dashboard-line-x-axis")).toHaveTextContent("2026-09-01");
});
