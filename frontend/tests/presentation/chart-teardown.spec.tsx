import React from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ChartDonut } from "@/lib/chart-ui";
import { teardownErrors } from "../chart-teardown";

afterEach(() => { vi.useRealTimers(); cleanup(); });

// Recharts batches store notifications with an animation frame plus a real fallback timer whose
// callback calls cancelAnimationFrame; settling first means jsdom teardown cannot strand it.
it("settles Recharts notifications queued after fake timers are restored before teardown", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  render(<ChartDonut data={[{ label: "Only", value: 1, color: "green" }]} center={<span>1</span>} />);
  await new Promise((resolve) => setTimeout(resolve, 50));
  vi.useRealTimers();
  expect(await teardownErrors()).toEqual([]);
});
