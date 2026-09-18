import { beforeEach, vi } from "vitest";

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
