import React from "react";
import { cleanup, render } from "@testing-library/react";
import { Bar, BarChart } from "recharts";
import { afterEach, expect, it, vi } from "vitest";
import { ChartDonut } from "@/lib/chart-ui";
import { hasRenderedChart, RTK_RAF_FALLBACK_MS, settleChartNotifications } from "../chart-environment";

afterEach(() => { vi.useRealTimers(); cleanup(); });

// Runs first: nothing in this file has rendered a chart yet, so afterAll would not wait.
it("does not request the settle wait before a chart renders", () => {
  render(<div className="chart-card">No chart</div>);
  expect(hasRenderedChart()).toBe(false);
});

it("requests the settle wait once a chart without ResponsiveContainer renders", () => {
  render(<BarChart width={200} height={100} data={[{ value: 1 }]}><Bar dataKey="value" /></BarChart>);
  expect(hasRenderedChart()).toBe(true);
});

// Recharts batches store notifications with an animation frame plus a real fallback timer whose
// callback calls cancelAnimationFrame; settling first means jsdom teardown cannot strand it.
it("settles Recharts notifications queued after fake timers are restored before teardown", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  render(<ChartDonut data={[{ label: "Only", value: 1, color: "green" }]} center={<span>1</span>} />);
  await new Promise((resolve) => setTimeout(resolve, 50));
  vi.useRealTimers();

  const errors: unknown[] = [];
  const capture = (error: unknown) => { errors.push(error); };
  process.on("uncaughtException", capture);
  const { cancelAnimationFrame } = globalThis;
  try {
    cleanup();
    await settleChartNotifications();
    // Simulate jsdom teardown removing the window globals, then outlast any stranded timer.
    delete (globalThis as Partial<typeof globalThis>).cancelAnimationFrame;
    await new Promise((resolve) => setTimeout(resolve, RTK_RAF_FALLBACK_MS + 50));
  } finally {
    globalThis.cancelAnimationFrame = cancelAnimationFrame;
    process.off("uncaughtException", capture);
  }
  expect(errors).toEqual([]);
});
