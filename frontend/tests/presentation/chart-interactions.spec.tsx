import React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChartDonut } from "@/lib/chart-ui";
import { DashboardLineChart } from "@/features/dashboard/ui/DashboardLineChart";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("interactive Recharts graphics", () => {
  it("navigates from the actual donut slice and safely renders an empty ring", () => {
    const onSelect = vi.fn();
    const data = [
      { label: "First", value: 2, color: "green" },
      { label: "Second", value: 1, color: "gray" },
    ];
    const view = render(<ChartDonut data={data} center={<span>3</span>} onSelect={onSelect} />);
    fireEvent.click(view.container.querySelectorAll(".recharts-sector")[1]);
    expect(onSelect).toHaveBeenCalledWith(1);
    view.rerender(<ChartDonut data={[]} center={<span>0</span>} onSelect={onSelect} />);
    const empty = view.container.querySelector(".recharts-sector")!;
    expect(empty).toHaveAttribute("fill", "var(--color-hairline-light)");
    expect(empty.getAttribute("d")).not.toMatch(/NaN|Infinity/);
    fireEvent.click(empty);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("shows exact values in a portal tooltip using keyboard chart navigation", async () => {
    const view = render(<DashboardLineChart chart={{ kind: "line", ariaLabel: "Weight", total: 2, points: [
      { id: "first", label: "2026-09-01", value: 70.25, ariaLabel: "2026-09-01: Weight 70.25 kg" },
      { id: "last", label: "2026-09-03", value: 70, ariaLabel: "2026-09-03: Weight 70 kg" },
    ] }} valueSuffix=" kg" />);
    const graphic = screen.getByRole("application");
    fireEvent.focus(graphic);
    fireEvent.keyDown(graphic, { key: "ArrowRight" });
    const tooltip = await screen.findByText("2026-09-03: Weight 70 kg", { selector: ".chart-tooltip" });
    expect(view.container).not.toContainElement(tooltip);
    expect(tooltip.closest(".recharts-tooltip-wrapper")).toHaveStyle({ position: "fixed" });
  });
});
