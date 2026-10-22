import { cleanup } from "@testing-library/react";
import { RTK_RAF_FALLBACK_MS, settleBeforeTeardown } from "./chart-environment";

// Simulate jsdom teardown removing the window globals, then outlast any stranded timer.
export async function teardownErrors() {
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
