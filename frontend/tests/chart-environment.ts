import { afterAll, beforeEach, vi } from "vitest";

// Recharts batches store notifications with RTK's animation-frame strategy, which also arms a
// 100ms timer whose callback calls cancelAnimationFrame. The frame can be fake or never run, so
// wait out that timer with the real clock before jsdom teardown removes the window globals.
const realSetTimeout = globalThis.setTimeout;
export function settleChartNotifications() {
  return new Promise<void>((resolve) => realSetTimeout(resolve, 100));
}
afterAll(settleChartNotifications);

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
