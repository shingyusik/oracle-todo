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

function cssBlockAt(source: string, start: number): string {
  const openingBrace = source.indexOf("{", start);
  if (openingBrace < 0) throw new Error("CSS block opening brace not found");
  let depth = 0;
  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error("CSS block closing brace not found");
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
  it("keeps Health dialog fieldsets borderless and textareas fixed", async () => {
    const css = await readSource("src/styles/globals.css");

    expect(css).toContain(
      ".confirmation-dialog form > fieldset {\n  min-width: 0;\n  margin: 0;\n  border: 0;\n  padding: 0;\n}",
    );
    expect(css).toContain(
      ".confirmation-dialog .field-label textarea {\n  resize: none;\n}",
    );
    expect(css).toContain(
      ".ledger-account-settings-checkbox,\n.field-checkbox {\n  display: inline-flex;",
    );
    expect(css).toContain(
      ".ledger-account-settings-checkbox input,\n.field-checkbox input {\n  width: 16px;\n  height: 16px;\n  margin: 0;\n}",
    );
  });

  it("exposes non-empty tokens, copy, and layout constants", () => {
    expect(designTokens.colors.aloe).toBe("#c1fbd4");
    expect(designTokens.colors.aloeStrong).toBe("#3fae6a");
    expect(workbenchCopy.brandName).toBe("Raven");
    expect(workbenchCopy.panels).not.toHaveProperty("timeline");
    expect(workbenchCopy.panels).not.toHaveProperty("trends");
    expect(workbenchCopy.panels.reports.title).toBe("Reports");
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

  it("keeps Ledger report charts native and on shared chart colors", async () => {
    const component = await readSource(
      "src/features/ledger/ui/LedgerReportCharts.tsx",
    );
    const css = await readSource("src/styles/globals.css");
    const externalImports = Array.from(
      component.matchAll(/from "([^"]+)"/g),
      ([, dependency]) => dependency,
    ).filter((dependency) => dependency !== "react" && !dependency.startsWith("@/"));

    expect(externalImports).toEqual([]);
    expect(component).toContain('type="date"');
    expect(component).toContain("conic-gradient(");
    expect(component).not.toContain("<svg");
    expect(component).toMatch(/<span[^>]*ledger-report-bar-income/s);
    expect(component).toMatch(/<span[^>]*ledger-report-bar-expense/s);
    expect(css).toMatch(/\.ledger-report-bar-income\s*\{[^}]*background:\s*var\(--color-chart-primary\);/s);
    expect(css).toMatch(/\.ledger-report-bar-expense\s*\{[^}]*background:\s*var\(--color-chart-secondary\);/s);
    expect(css).toMatch(/\.ledger-report-average-marker\s*\{[^}]*border-top:\s*2px dashed var\(--color-chart-warning\);/s);
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

  it("keeps the mobile navigation header inside the drawer", async () => {
    const source = await readSource("src/styles/globals.css");
    const mobileBreakpoint = workbenchLayout.mobileBreakpointPx - 1;
    const mobileDrawerQuery =
      `@media (max-width: ${mobileBreakpoint}px) {\n  .workbench-shell {`;
    const mobileDrawerStart = source.indexOf(mobileDrawerQuery);

    expect(mobileDrawerStart).toBeGreaterThan(-1);

    const mobileDrawerStyles = cssBlockAt(source, mobileDrawerStart).replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    );
    const mobileDrawerBody = mobileDrawerStyles.slice(
      mobileDrawerStyles.indexOf("{") + 1,
      mobileDrawerStyles.lastIndexOf("}"),
    );

    expect(mobileDrawerBody).not.toMatch(/^\s*@/m);

    expect(mobileDrawerStyles).toMatch(
      /\n  \.workbench-nav\s*\{[^}]*width:\s*min\(320px, calc\(100vw - 24px\)\);/,
    );
    expect(mobileDrawerStyles).toMatch(
      /\n  \.workbench-nav-close\s*\{[^}]*flex:\s*0 0 auto;/,
    );
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

  it("keeps weekly item rows inside day cards", async () => {
    const source = await readSource("src/styles/globals.css");

    expect(source).toMatch(
      /\.weekly-day-grid \.planner-card-list,\n\.weekly-day-grid \.planner-card-list li\s*\{[^}]*min-width:\s*0;/s,
    );
    expect(source).toContain(
      ".weekly-day-grid .planner-card > .planner-card-list + .planner-card-list {\n  margin-top: 7px;\n}",
    );
    expect(source).toContain(
      ".weekly-day-grid .planner-card > .planner-card-list > h3 {\n  margin-bottom: 0;\n}",
    );
  });

  it("keeps Dashboard cards and skeletons aligned across approved breakpoints", async () => {
    const source = await readSource("src/styles/globals.css");
    const wideStart = source.indexOf("@media (min-width: 1440px) {");
    const mediumStart = source.indexOf(
      "@media (min-width: 768px) and (max-width: 1439px) {",
    );
    const mobileStart = source.indexOf("@media (max-width: 767px) {");

    expect(wideStart).toBeGreaterThan(-1);
    expect(mediumStart).toBeGreaterThan(-1);
    expect(mobileStart).toBeGreaterThan(-1);

    const wide = cssBlockAt(source, wideStart);
    const medium = cssBlockAt(source, mediumStart);
    const mobile = cssBlockAt(source, mobileStart);

    expect(wide).toMatch(/\.dashboard-panel,\n  \.dashboard-loading\s*\{[^}]*grid-template-columns:\s*minmax\(0, 22fr\) minmax\(0, 43fr\) minmax\(0, 35fr\);/);
    expect(wide).toMatch(/\.dashboard-widget-today-outcomes,\n  \.dashboard-skeleton-today-outcomes\s*\{[^}]*grid-column:\s*1;/);
    expect(wide).toMatch(/\.dashboard-widget-completion-history,\n  \.dashboard-skeleton-completion-history\s*\{[^}]*grid-column:\s*2;/);
    expect(wide).toMatch(/\.dashboard-widget-status,\n  \.dashboard-skeleton-status\s*\{[^}]*grid-column:\s*3;/);
    expect(medium).toMatch(/\.dashboard-panel,\n  \.dashboard-loading\s*\{[^}]*grid-template-columns:\s*repeat\(12, minmax\(0, 1fr\)\);/);
    expect(medium).toMatch(/\.dashboard-widget-today-outcomes,\n  \.dashboard-skeleton-today-outcomes\s*\{[^}]*grid-column:\s*span 4;/);
    expect(medium).toMatch(/\.dashboard-widget-completion-history,\n  \.dashboard-skeleton-completion-history\s*\{[^}]*grid-column:\s*span 8;/);
    expect(medium).toMatch(/\.dashboard-widget-status,\n  \.dashboard-skeleton-status\s*\{[^}]*grid-column:\s*1 \/ -1;/);
    expect(mobile).toMatch(/\.dashboard-panel,\n  \.dashboard-loading\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/);
    expect(mobile).toMatch(/\.dashboard-widget-today-outcomes,\n  \.dashboard-widget-completion-history,\n  \.dashboard-widget-status,\n  \.dashboard-skeleton-today-outcomes,\n  \.dashboard-skeleton-completion-history,\n  \.dashboard-skeleton-status\s*\{[^}]*grid-column:\s*1;/);
    expect(source).toMatch(/\.dashboard-panel-header\s*\{[^}]*grid-column:\s*1 \/ -1;/s);
  });

  it("styles Dashboard status mini-donuts with accessible interactive states", async () => {
    const source = await readSource("src/styles/globals.css");
    const mobileStart = source.indexOf("@media (max-width: 767px) {");
    const reducedMotionStart = source.lastIndexOf(
      "@media (prefers-reduced-motion: reduce) {",
    );

    expect(mobileStart).toBeGreaterThan(-1);
    expect(reducedMotionStart).toBeGreaterThan(-1);

    const mobile = cssBlockAt(source, mobileStart);
    const reducedMotion = cssBlockAt(source, reducedMotionStart);

    expect(source).toMatch(
      /\.dashboard-status-tabs\s*\{[^}]*display:\s*flex;[^}]*gap:\s*4px;/s,
    );
    expect(source).toMatch(
      /\.dashboard-status-tabs > button,\n\.dashboard-status-toggle\s*\{[^}]*border:\s*1px solid var\(--color-hairline-light\);[^}]*padding:\s*6px 10px;/s,
    );
    expect(source).toMatch(
      /\.dashboard-status-tabs > button\[aria-selected="true"\]\s*\{[^}]*background:\s*var\(--color-ink\);[^}]*color:\s*var\(--color-on-dark\);/s,
    );
    expect(source).toMatch(
      /\.dashboard-status-donut-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/s,
    );
    expect(mobile).toMatch(
      /\.dashboard-status-donut-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/,
    );
    expect(source).toContain("var(--dashboard-status-completed-stop)");
    expect(source).toContain("var(--dashboard-status-incomplete-stop)");
    expect(source).toContain("var(--dashboard-status-paused-stop)");
    expect(source).toMatch(
      /\.dashboard-status-tile\s*\{[^}]*display:\s*grid;[^}]*min-width:\s*0;[^}]*minmax\(0, 1fr\) 60px;[^}]*border:\s*1px solid var\(--color-hairline-light\);[^}]*padding:\s*9px 10px;/s,
    );
    expect(source).toMatch(
      /\.dashboard-status-donut\s*\{[^}]*background:\s*conic-gradient\([\s\S]*?color-mix\(in srgb, var\(--color-accent-strong\) 70%, var\(--color-ink\)\)[\s\S]*?var\(--color-ink\)[\s\S]*?var\(--color-shade-50\)[\s\S]*?var\(--color-chart-warning\)[\s\S]*?100%\s*\);/,
    );
    expect(source).toMatch(
      /\.dashboard-status-donut\s*\{[^}]*display:\s*grid;[^}]*width:\s*60px;[^}]*aspect-ratio:\s*1;[^}]*place-items:\s*center;/s,
    );
    expect(source).toMatch(
      /\.dashboard-status-donut\.is-empty\s*\{[^}]*background:\s*var\(--color-hairline-light\);/s,
    );
    expect(source).toMatch(
      /\.dashboard-status-donut::after\s*\{[^}]*position:\s*absolute;[^}]*width:\s*66%;[^}]*aspect-ratio:\s*1;[^}]*background:\s*var\(--color-canvas-light\);/s,
    );
    expect(source).toMatch(
      /\.dashboard-status-donut-center\s*\{[^}]*position:\s*relative;[^}]*z-index:\s*1;[^}]*max-width:\s*38px;/s,
    );
    expect(source).toMatch(
      /\.dashboard-status-meta\s*\{[^}]*grid-area:\s*meta;[^}]*min-width:\s*0;[^}]*font-size:\s*11px;[^}]*line-height:\s*1\.3;/s,
    );
    expect(source).toMatch(/\.dashboard-status-tile\.attention-risk\s*\{[^}]*border-color:\s*var\(--color-danger-text\);/s);
    expect(source).toMatch(/\.dashboard-status-tile\.attention-attention\s*\{[^}]*border-color:\s*var\(--color-chart-secondary\);/s);
    expect(source).toContain(".dashboard-status-label");
    expect(source).toContain(".dashboard-status-meta");
    expect(source).toContain(".dashboard-status-tabs > button:focus-visible,");
    expect(source).toContain(".dashboard-status-tile:focus-visible,");
    expect(source).toContain(".dashboard-status-toggle:focus-visible,");
    expect(reducedMotion).toMatch(/\.dashboard-status-tabs > button,\n  \.dashboard-status-tile,\n  \.dashboard-status-toggle\s*\{[^}]*transition:\s*none;/);
    expect(source).not.toMatch(/\.dashboard-status-(?:grid|skeleton-grid)\b/);
    expect(source).not.toContain(`.${["dashboard", "heatmap"].join("-")}-`);
    expect(source).not.toMatch(
      /\.dashboard-(?:widget|skeleton)-(?:area|project)-status\b/,
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
