import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { workbenchCopy } from "@/design/copy";
import { workbenchLayout } from "@/design/layout";
import { designTokens } from "@/design/tokens";

async function readSource(relativePath: string): Promise<string> {
  return fs.readFile(path.join(process.cwd(), relativePath), "utf8");
}

async function collectSourceFiles(relativeDir: string): Promise<string[]> {
  const absoluteDir = path.join(process.cwd(), relativeDir);
  const entries = await fs.readdir(absoluteDir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const relativePath = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectSourceFiles(relativePath)));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      files.push(relativePath);
    }
  }

  return files;
}

describe("design system boundaries", () => {
  it("exposes non-empty tokens, copy, and layout constants", () => {
    expect(designTokens.colors.aloe).toBe("#c1fbd4");
    expect(designTokens.colors.aloeStrong).toBe("#3fae6a");
    expect(workbenchCopy.brandName).toBe("Todo Engine");
    expect(workbenchLayout.mainSidebarWidthPx).toBe(112);
  });

  it("keeps raw hex colors out of feature components", async () => {
    const files = await collectSourceFiles("src/features");
    const violations: string[] = [];

    for (const file of files) {
      const source = await fs.readFile(path.join(process.cwd(), file), "utf8");
      if (/#[0-9a-fA-F]{3,8}\b/.test(source)) {
        violations.push(file);
      }
    }

    expect(violations).toEqual([]);
  });

  it("keeps CSS layout variables aligned with typed layout constants", async () => {
    const source = await readSource("src/styles/globals.css");
    const totalSidebarWidth =
      workbenchLayout.mainSidebarWidthPx +
      workbenchLayout.separatorRailWidthPx +
      workbenchLayout.subSidebarWidthPx;

    expect(source).toContain(
      `--workbench-main-sidebar-width: ${workbenchLayout.mainSidebarWidthPx}px;`,
    );
    expect(source).toContain(
      `--workbench-separator-rail-width: ${workbenchLayout.separatorRailWidthPx}px;`,
    );
    expect(source).toContain(
      `--workbench-sub-sidebar-width: ${workbenchLayout.subSidebarWidthPx}px;`,
    );
    expect(workbenchLayout.subSidebarWidthPx).toBeGreaterThanOrEqual(148);
    expect(workbenchLayout.subSidebarWidthPx).toBeLessThanOrEqual(152);
    expect(source).toContain(
      `--workbench-total-sidebar-width: ${totalSidebarWidth}px;`,
    );
    expect(source).toContain(
      `@media (max-width: ${workbenchLayout.mobileBreakpointPx - 1}px)`,
    );
    expect(source).toContain(
      "grid-template-columns: var(--workbench-total-sidebar-width) minmax(0, 1fr);",
    );
    expect(source).toContain(
      "grid-template-columns: var(--workbench-main-sidebar-width) var(--workbench-sub-sidebar-width);",
    );
    expect(source).not.toContain(
      "grid-template-columns: var(--workbench-main-sidebar-width) var(--workbench-separator-rail-width) var(--workbench-sub-sidebar-width);",
    );
    expect(workbenchLayout.separatorRailWidthPx).toBe(0);
    expect(source).toContain(
      "grid-auto-columns: minmax(var(--workbench-main-sidebar-width), 1fr);",
    );
    expect(source).toContain(".sub-sidebar-tab {\n  color: var(--color-ink);\n  font-size: 14px;");
  });

  it("uses the Merovingian asset as the favicon", async () => {
    const source = await readSource("src/app/layout.tsx");

    expect(source).toContain('icon: "/merovingian-mark.png"');
  });

  it("proxies todo-engine API requests to the Rust server port", async () => {
    const source = await readSource("next.config.mjs");

    expect(source).toContain("/todo-engine/:path*");
    expect(source).toContain("http://127.0.0.1:3002/:path*");
  });

  it("keeps todo parent hierarchy bars visible beside the dark sidebar", async () => {
    const source = await readSource("src/styles/globals.css");

    expect(source).toContain("--color-aloe-strong: #3fae6a;");
    expect(source).toContain(
      "box-shadow: inset 3px 0 0 var(--color-aloe-strong);",
    );
    expect(source).not.toContain(
      "box-shadow: inset 3px 0 0 var(--color-shade-50);",
    );
    expect(source).not.toContain(
      ".sub-sidebar-tab-parent[data-active=\"true\"] {\n  background: var(--color-pistachio);\n  box-shadow: inset 3px 0 0 var(--color-ink);",
    );
  });

  it("keeps select text clear of the native dropdown arrow", async () => {
    const source = await readSource("src/styles/globals.css");

    expect(source).toContain(
      "select {\n  padding-right: 28px;",
    );
  });

  it("defines CSS variables that are used without fallbacks", async () => {
    const source = await readSource("src/styles/globals.css");
    const definitions = new Set(
      Array.from(source.matchAll(/--[A-Za-z0-9_-]+\s*:/g), ([match]) =>
        match.slice(0, match.indexOf(":")).trim(),
      ),
    );
    const missingDefinitions = Array.from(
      new Set(
        Array.from(source.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)([^)]*)\)/g))
          .filter(([, name, suffix]) => !suffix.includes(",") && !definitions.has(name))
          .map(([, name]) => name),
      ),
    ).sort();

    expect(missingDefinitions).toEqual([]);
  });

  it("shows disabled detail save actions as unavailable", async () => {
    const source = await readSource("src/styles/globals.css");

    expect(source).toContain(
      ".detail-actions button:disabled {\n  cursor: not-allowed;",
    );
  });

  it("keeps empty tag inputs clickable", async () => {
    const source = await readSource("src/styles/globals.css");

    expect(source).not.toContain(
      ".tag-input:not(:focus-within) input[data-empty=\"true\"]",
    );
    expect(source).not.toContain(
      ".field-label .tag-input:not(:focus-within) input[data-empty=\"true\"]",
    );
  });

  it("keeps table tag dropdowns clear of the horizontal scroll clip", async () => {
    const source = await readSource("src/styles/globals.css");

    expect(source).toContain(
      ".items-section:has(.tag-dropdown) {\n  padding-bottom: 280px;",
    );
  });

  it("keeps daily planner columns top-aligned when one side has more items", async () => {
    const source = await readSource("src/styles/globals.css");

    expect(source).toContain(
      ".daily-planner-scheduled-grid {\n  display: grid;\n  grid-template-columns: repeat(2, minmax(0, 1fr));\n  align-items: start;",
    );
  });

  it("keeps planner period cards motion-safe and dependency-free", async () => {
    const css = await readSource("src/styles/globals.css");

    expect(css).toContain(".period-carousel-card");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain(".period-carousel-card {\n    transition: none;");
    expect(css).toContain(".period-carousel-card[data-position=\"selected\"] {\n    transform: none;");
    expect(css).toContain(".period-carousel-card[data-position=\"previous\"],\n  .period-carousel-card[data-position=\"next\"] {\n    transform: none;");
    expect(css).not.toContain("animation-library");
  });

  it("keeps goal period calendar dependency-free", async () => {
    const source = await readSource("src/features/workbench/ui/MainPanel.tsx");

    expect(source).toContain("GoalPeriodCalendar");
    expect(source).toContain("CalendarDateGrid");
    expect(source).not.toContain("react-datepicker");
    expect(source).not.toContain("@fullcalendar");
  });
});
