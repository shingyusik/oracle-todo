import React from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ChartDonut } from "@/lib/chart-ui";
import { RTK_RAF_FALLBACK_MS, settleBeforeTeardown } from "../chart-environment";

afterEach(() => { vi.useRealTimers(); cleanup(); });

const donut = <ChartDonut data={[{ label: "Only", value: 1, color: "green" }]} center={<span>1</span>} />;

// Simulate jsdom teardown removing the window globals, then outlast any stranded timer.
async function teardownErrors() {
  const errors: unknown[] = [];
  const capture = (error: unknown) => { errors.push(error); };
  process.on("uncaughtException", capture);
  const { cancelAnimationFrame } = globalThis;
  try {
    cleanup();
    await settleBeforeTeardown();
    delete (globalThis as Partial<typeof globalThis>).cancelAnimationFrame;
    await new Promise((resolve) => setTimeout(resolve, RTK_RAF_FALLBACK_MS + 50));
  } finally {
    globalThis.cancelAnimationFrame = cancelAnimationFrame;
    process.off("uncaughtException", capture);
  }
  return errors;
}

it("settles Recharts notifications from a chart rendered outside the document before teardown", async () => {
  render(donut, { container: document.createElement("div") });
  expect(await teardownErrors()).toEqual([]);
});

// Recharts batches store notifications with an animation frame plus a real fallback timer whose
// callback calls cancelAnimationFrame; settling first means jsdom teardown cannot strand it.
it("settles Recharts notifications queued after fake timers are restored before teardown", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  render(donut);
  await new Promise((resolve) => setTimeout(resolve, 50));
  vi.useRealTimers();
  expect(await teardownErrors()).toEqual([]);
});
