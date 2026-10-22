import React from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ChartDonut } from "@/lib/chart-ui";
import { settleChartNotifications } from "../chart-environment";

afterEach(() => { vi.useRealTimers(); cleanup(); vi.restoreAllMocks(); });

// Recharts batches store notifications with an animation frame plus a 100ms Node
// fallback timer that calls cancelAnimationFrame; it must not outlive jsdom teardown.
it("settles Recharts fallback timers queued after fake timers are restored", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  render(<ChartDonut data={[{ label: "Only", value: 1, color: "green" }]} center={<span>1</span>} />);
  await new Promise((resolve) => setTimeout(resolve, 50));
  vi.useRealTimers();

  const pending = new Set<unknown>();
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((handler: () => void, delay?: number, ...rest: unknown[]) => {
    const id = realSetTimeout(() => { pending.delete(id); handler(); }, delay, ...rest);
    if (delay === 100) pending.add(id);
    return id;
  }) as typeof setTimeout);
  vi.spyOn(globalThis, "clearTimeout").mockImplementation(((id: Parameters<typeof clearTimeout>[0]) => {
    pending.delete(id);
    realClearTimeout(id);
  }) as typeof clearTimeout);

  // The store captured the fake animation frame, so only the real fallback timer can settle it.
  cleanup();
  expect(pending.size).toBeGreaterThan(0);

  await settleChartNotifications();
  expect(pending.size).toBe(0);
});
