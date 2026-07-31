import { promises as fs } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { workbenchCopy } from "@/design/copy";
import { workbenchLayout } from "@/design/layout";
import { designTokens } from "@/design/tokens";

async function readSource(relativePath: string): Promise<string> {
  const source = await fs.readFile(path.join(process.cwd(), relativePath), "utf8");
  // Assertions below are written with LF, but git hands out CRLF working copies
  // on Windows.
  return source.replace(/\r\n/g, "\n");
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
    expect(workbenchCopy.brandName).toBe("Raven");
    expect(workbenchLayout.mainSidebarWidthPx).toBe(64);
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

  it("keeps the one-column tree sidebar at the typed total width", async () => {
    const source = await readSource("src/styles/globals.css");
    const totalSidebarWidth =
      workbenchLayout.mainSidebarWidthPx +
      workbenchLayout.separatorRailWidthPx +
      workbenchLayout.subSidebarWidthPx;

    expect(source).toContain(
      `--workbench-total-sidebar-width: ${totalSidebarWidth}px;`,
    );
    expect(source).toContain(
      `@media (max-width: ${workbenchLayout.mobileBreakpointPx - 1}px)`,
    );
    expect(source).toContain(
      "grid-template-columns: var(--workbench-total-sidebar-width) minmax(0, 1fr);",
    );
    expect(source).not.toContain(
      ".workbench-nav-grid",
    );
    expect(source).toContain(".tree-sidebar {\n  display: flex;\n  flex-direction: column;");
    expect(source).not.toContain(".tree-sidebar {\n    display: grid;");
  });

  it("uses the Merovingian asset as the favicon", async () => {
    const source = await readSource("src/app/layout.tsx");

    expect(source).toContain('icon: "/merovingian-mark.png"');
  });

  it("proxies the unified API to an injectable Raven development server", () => {
    const output = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        'import config from "./next.config.mjs"; console.log(JSON.stringify(await config.rewrites()));',
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          NODE_ENV: "development",
          RAVEN_API_URL: "http://127.0.0.1:3999",
        },
      },
    );

    expect(JSON.parse(output.trim())).toEqual([
      {
        source: "/api/:path*",
        destination: "http://127.0.0.1:3999/api/:path*",
      },
    ]);
  });

  it("exports the workbench as static files for release artifacts", async () => {
    const source = await readSource("next.config.mjs");

    expect(source).toContain('output: "export"');
    expect(source).toContain("rewrites()");
    expect(source).not.toContain("/todo-engine/");
  });

  it("enables the API rewrite only for the development server", () => {
    function configKeys(nodeEnv: "development" | "production"): string[] {
      const output = execFileSync(
        process.execPath,
        [
          "--input-type=module",
          "--eval",
          'import config from "./next.config.mjs"; console.log(JSON.stringify(Object.keys(config)));',
        ],
        {
          cwd: process.cwd(),
          encoding: "utf8",
          env: { ...process.env, NODE_ENV: nodeEnv },
        },
      );
      return JSON.parse(output.trim()) as string[];
    }

    expect(configKeys("development")).toContain("rewrites");
    expect(configKeys("production")).not.toContain("rewrites");
  });

  it("keeps tree hierarchy guides visible in the sidebar", async () => {
    const source = await readSource("src/styles/globals.css");

    expect(source).toContain(".tree-sidebar-children {\n  margin-left: 22px;\n  border-left: 1px solid var(--color-hairline-light);");
    expect(source).toContain(".tree-sidebar-leaves {\n  margin-left: 14px;\n  border-left: 1px solid var(--color-hairline-light);");
  });

  it("keeps a collapsed-state indicator on tree parent buttons", async () => {
    const source = await readSource("src/styles/globals.css");

    expect(source).toContain(
      ".tree-sidebar-parent[aria-expanded=\"false\"] > svg {\n  transform: rotate(-90deg);",
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

  it("opts nested detail sub-fields out of the label/control two-column grid", async () => {
    const source = await readSource("src/styles/globals.css");

    // `.detail-properties-list .field-label` makes every field label a
    // `140px | control` row. A field nested inside one of those rows already has
    // its own label column, so it must reset back to a single stacked column --
    // otherwise 140px eats the width, the control track collapses to 0, and the
    // input renders at its intrinsic ~21px on top of the label text.
    for (const field of [".recurrence-field", ".materialize-field"]) {
      expect(source).toContain(
        `.detail-properties-list ${field} {\n  display: grid;\n  grid-template-columns: 1fr;`,
      );
    }
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

  it("keeps the Markdown note outside the property grid with scoped typography", async () => {
    const css = await readSource("src/styles/globals.css");

    expect(css).toContain(".detail-note {\n  display: grid;");
    expect(css).toContain(
      ".markdown-note-surface hr {\n  margin: 1.5em 0;\n  border: 0;\n  border-top: 1px solid var(--color-hairline-light);",
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

  it("keeps the Dashboard donut fluid inside the four-column desktop card", async () => {
    const source = await readSource("src/styles/globals.css");

    expect(source).toContain(
      ".dashboard-widget-today-outcomes {\n  grid-column: span 4;\n}",
    );
    expect(source).toContain(
      ".dashboard-widget-completion-history {\n  grid-column: span 8;\n}",
    );
    expect(source).toMatch(
      /\.dashboard-chart-donut\s*\{[^}]*width:\s*100%;/s,
    );
    expect(source).toMatch(
      /\.dashboard-donut-ring\s*\{[^}]*width:\s*min\(180px,\s*100%\);/s,
    );
    expect(source).toContain(
      `@media (max-width: ${workbenchLayout.mobileBreakpointPx - 1}px)`,
    );
  });

  it("keeps Dashboard status cards on one row until the mobile breakpoint", async () => {
    const source = await readSource("src/styles/globals.css");

    expect(source).toContain(
      ".dashboard-status-grid,\n.dashboard-status-skeleton-grid {\n  grid-column: 1 / -1;\n  display: grid;\n  grid-template-columns: repeat(2, minmax(0, 1fr));",
    );
    expect(source).toMatch(
      /@media \(max-width: 767px\)[\s\S]*?\.dashboard-status-grid,\n  \.dashboard-status-skeleton-grid \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/,
    );
  });

  it("keeps planner period cards motion-safe and dependency-free", async () => {
    const css = await readSource("src/styles/globals.css");

    expect(css).toContain(
      ".period-carousel-arrow {\n  position: relative;\n  z-index: 1;",
    );
    expect(css).toContain(".period-carousel-card");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain(".period-carousel-card {\n    transition: none;");
    expect(css).toContain(".period-carousel-card[data-position=\"selected\"] {\n    transform: none;");
    expect(css).toContain(".period-carousel-card[data-position=\"previous\"],\n  .period-carousel-card[data-position=\"next\"] {\n    transform: none;");
    expect(css).not.toContain("animation-library");
  });

  it("places the mobile drawer reduced-motion override after its transition", async () => {
    const css = await readSource("src/styles/globals.css");
    const transition = css.indexOf("transition: transform 160ms ease;");
    const override = css.indexOf(
      `@media (prefers-reduced-motion: reduce) and (max-width: ${
        workbenchLayout.mobileBreakpointPx - 1
      }px)`,
    );

    expect(transition).toBeGreaterThan(-1);
    expect(override).toBeGreaterThan(transition);
    expect(css.slice(override)).toMatch(
      /\.workbench-nav\s*\{\s*transition:\s*none;/,
    );
  });

  it("keeps planner group controls compact and headerless", async () => {
    const panel = await readSource(
      "src/features/workbench/ui/PlannerGroupPanel.tsx",
    );
    const styles = await readSource("src/styles/globals.css");

    expect(panel).not.toContain("planner-group-header");
    expect(panel).not.toContain("<Check size={18}");
    expect(panel.match(/<Check size=\{15\}/g)).toHaveLength(2);
    expect(styles).toContain(".planner-group-setting-rows > button");
    expect(styles).toMatch(
      /\.planner-group-setting-rows > button[^}]*font-size:\s*13px/,
    );
    expect(styles).toMatch(
      /\.planner-group-count[^}]*font-size:\s*12px/,
    );
    expect(styles).toMatch(
      /\.planner-group-row[^}]*min-height:\s*32px/,
    );
    expect(styles).toMatch(
      /\.planner-control-dropdown-compact[^}]*width:\s*min\(320px, calc\(100vw - 24px\)\)/,
    );
    expect(styles).toMatch(
      /\.planner-control-dropdown-compact[^}]*min-width:\s*0/,
    );
    expect(styles).toMatch(
      /\.planner-control-dropdown-compact \.planner-group-settings-panel[^}]*width:\s*100%/,
    );
    expect(styles).toContain(
      "min-width: min(540px, calc(100vw - 24px));",
    );
    expect(styles).not.toContain(".planner-group-popover");
    expect(styles).not.toContain(".planner-group-inline-options");
  });

  it("keeps goal period calendar dependency-free", async () => {
    const source = await readSource("src/features/workbench/ui/MainPanel.tsx");

    expect(source).toContain("GoalPeriodCalendar");
    expect(source).toContain("CalendarDateGrid");
    expect(source).not.toContain("react-datepicker");
    expect(source).not.toContain("@fullcalendar");
  });
});
