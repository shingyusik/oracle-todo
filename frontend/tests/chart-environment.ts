import { afterAll, beforeEach, vi } from "vitest";

// RTK 2.12 기준: autoBatchEnhancer({ type: "raf" }), used by Recharts 3.10's store, arms this
// fallback timer next to each animation frame, and its callback calls cancelAnimationFrame.
export const RTK_RAF_FALLBACK_MS = 100;

// The frame can be fake or never run, so wait out that timer with the real clock before jsdom
// teardown removes the window globals.
const realSetTimeout = globalThis.setTimeout;
export function settleChartNotifications() {
  return new Promise<void>((resolve) => realSetTimeout(resolve, RTK_RAF_FALLBACK_MS));
}

// Only files that rendered a chart need the wait. Observe insertions rather than checking in
// afterEach, which would run after RTL's cleanup has already emptied the DOM.
const chartSelector = ".recharts-wrapper, .recharts-surface";
let chartRendered = false;
const chartObserver = new MutationObserver(noteCharts);
chartObserver.observe(document, { childList: true, subtree: true });
function noteCharts(records: MutationRecord[]) {
  chartRendered ||= records.some((record) => Array.from(record.addedNodes).some((node) =>
    node instanceof Element && (node.matches(chartSelector) || node.querySelector(chartSelector) !== null)));
}
export function hasRenderedChart() {
  noteCharts(chartObserver.takeRecords());
  return chartRendered;
}
afterAll(async () => {
  if (hasRenderedChart()) await settleChartNotifications();
});

// JSDOM has no layout or ResizeObserver; keep actual Recharts SVG rendering in tests.
const originalBounds = HTMLElement.prototype.getBoundingClientRect;
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  if (!window.matchMedia) {
    Object.defineProperty(window, "matchMedia", { configurable: true, writable: true,
      value: (query: string) => ({ matches: query === "(prefers-reduced-motion: reduce)", addEventListener() {}, removeEventListener() {} }),
    });
  }
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains("recharts-responsive-container")) {
      return { x: 0, y: 0, top: 0, left: 0, right: 600, bottom: 260, width: 600, height: 260, toJSON() {} };
    }
    return originalBounds.call(this);
  });
});
