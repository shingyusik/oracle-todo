# Frontend Workbench Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first `todo-engine` web frontend under `frontend/`: a Next.js workbench shell with main sidebar, sub sidebar, tab-specific main panels, clean frontend boundaries, and Shopify-inspired design tokens.

**Architecture:** The route layer stays thin. Pure navigation policy lives in `src/domain/workbench`, typed design values live in `src/design`, React state lives in `features/workbench/hooks`, and visual layout lives in `features/workbench/ui`. This is a static shell; API integration is deliberately excluded.

**Tech Stack:** Next.js App Router, React, TypeScript strict mode, Vitest, React Testing Library, jsdom, CSS custom properties, lucide-react.

## Global Constraints

- Work only inside `frontend/` for implementation, except root `DESIGN.md` is already created by the docs pass.
- Do not wire to the Rust API in this plan.
- Do not add TanStack Query, Zustand, auth, or backend gateways.
- Do not hardcode raw hex color literals inside feature UI components.
- Put tokens, copy, layout constants, domain logic, controller logic, and presentational layout in separate files.
- First screen must be the workbench app, not a landing page.
- Use `lucide-react` icons for mechanical controls where icons are needed.
- Keep cards at 8px radius or less except prominent summary cards may use 12px.
- No gradient orbs, bokeh blobs, or decorative SVG backgrounds.
- Use TDD: write a failing test, verify it fails, then implement.

---

## File Structure

```text
frontend/
  package.json
  package-lock.json
  tsconfig.json
  next.config.mjs
  vitest.config.ts
  next-env.d.ts
  README.md
  src/
    app/layout.tsx
    app/page.tsx
    design/tokens.ts
    design/copy.ts
    design/layout.ts
    domain/workbench/navigation.ts
    features/workbench/model/workbench-model.ts
    features/workbench/hooks/useWorkbenchController.ts
    features/workbench/ui/WorkbenchPageClient.tsx
    features/workbench/ui/WorkbenchWireframe.tsx
    features/workbench/ui/MainSidebar.tsx
    features/workbench/ui/SubSidebar.tsx
    features/workbench/ui/MainPanel.tsx
    styles/globals.css
  tests/
    architecture/design-boundaries.spec.ts
    domain/workbench-navigation.spec.ts
    presentation/use-workbench-controller.spec.tsx
    presentation/workbench-wireframe.spec.tsx
```

---

### Task 1: Scaffold the Next.js frontend package

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/tsconfig.json`
- Create: `frontend/next.config.mjs`
- Create: `frontend/vitest.config.ts`
- Create: `frontend/next-env.d.ts`
- Create: `frontend/src/app/layout.tsx`
- Create: `frontend/src/app/page.tsx`
- Create: `frontend/src/styles/globals.css`
- Modify: `frontend/README.md`

**Interfaces:**
- Produces: a runnable frontend package with `npm run test`, `npm run typecheck`, `npm run build`, and `npm run dev`.
- Consumes: no app code from later tasks.

- [ ] **Step 1: Write the failing package smoke test**

Create `frontend/tests/architecture/package-scripts.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import packageJson from "../../package.json";

describe("frontend package scripts", () => {
  it("defines the required local verification commands", () => {
    expect(packageJson.scripts).toMatchObject({
      dev: "next dev",
      build: "next build",
      test: "vitest run --no-file-parallelism",
      typecheck: "tsc --noEmit",
    });
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
cd frontend
npm test -- tests/architecture/package-scripts.spec.ts
```

Expected: command fails because `package.json` and the test runner are not configured yet.

- [ ] **Step 3: Create `frontend/package.json`**

Create `frontend/package.json`:

```json
{
  "name": "todo-engine-frontend",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "test": "vitest run --no-file-parallelism",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "lucide-react": "^0.563.0",
    "next": "^14.2.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.3.2",
    "@testing-library/user-event": "^14.6.1",
    "@types/node": "^20.14.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "jsdom": "^29.0.1",
    "typescript": "^5.5.0",
    "vitest": "^3.2.4"
  }
}
```

- [ ] **Step 4: Install dependencies**

Run:

```bash
cd frontend
npm install
```

Expected: `package-lock.json` is created and dependencies install successfully.

- [ ] **Step 5: Add TypeScript, Next, and Vitest config**

Create `frontend/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "es2022"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    },
    "plugins": [{ "name": "next" }]
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

Create `frontend/next.config.mjs`:

```js
/** @type {import("next").NextConfig} */
const nextConfig = {};

export default nextConfig;
```

Create `frontend/vitest.config.ts`:

```ts
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: [],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
```

Create `frontend/next-env.d.ts`:

```ts
/// <reference types="next" />
/// <reference types="next/image-types/global" />

// This file is maintained by Next.js.
```

- [ ] **Step 6: Add minimal app entry files**

Create `frontend/src/styles/globals.css`:

```css
* {
  box-sizing: border-box;
}

html,
body {
  min-height: 100%;
  margin: 0;
}

body {
  font-family: Inter, Helvetica, Arial, sans-serif;
  font-feature-settings: "ss03";
}

button,
input,
textarea,
select {
  font: inherit;
}
```

Create `frontend/src/app/layout.tsx`:

```tsx
import type { Metadata } from "next";
import type { ReactNode } from "react";

import "@/styles/globals.css";

export const metadata: Metadata = {
  title: "Todo Engine",
  description: "Local-first todo workbench",
};

type RootLayoutProps = {
  children: ReactNode;
};

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

Create `frontend/src/app/page.tsx`:

```tsx
export default function HomePage() {
  return <main>Todo Engine</main>;
}
```

- [ ] **Step 7: Update README**

Replace `frontend/README.md`:

````markdown
# frontend

Next.js workbench frontend for `todo-engine`.

## Commands

```bash
npm install
npm run dev
npm run test
npm run typecheck
npm run build
```

## Architecture

- `src/app`: thin route entries.
- `src/design`: tokens, copy, and layout constants.
- `src/domain`: pure policy and navigation rules.
- `src/features`: workbench model, controller hooks, and UI.
- `tests`: architecture, domain, and presentation tests.
````

- [ ] **Step 8: Verify the package smoke test passes**

Run:

```bash
cd frontend
npm run test -- tests/architecture/package-scripts.spec.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add frontend
git commit -m "[FE] Scaffold Next frontend package"
```

---

### Task 2: Add design tokens and boundary tests

**Files:**
- Create: `frontend/src/design/tokens.ts`
- Create: `frontend/src/design/copy.ts`
- Create: `frontend/src/design/layout.ts`
- Create: `frontend/src/features/.gitkeep`
- Modify: `frontend/src/styles/globals.css`
- Create: `frontend/tests/architecture/design-boundaries.spec.ts`

**Interfaces:**
- Produces: `designTokens`, `workbenchCopy`, and `workbenchLayout`.
- Consumes: package config from Task 1.

- [ ] **Step 1: Write the failing design boundary test**

Create `frontend/tests/architecture/design-boundaries.spec.ts`:

```ts
import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { workbenchCopy } from "@/design/copy";
import { workbenchLayout } from "@/design/layout";
import { designTokens } from "@/design/tokens";

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
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
cd frontend
npm run test -- tests/architecture/design-boundaries.spec.ts
```

Expected: FAIL because `@/design/*` modules do not exist.

- [ ] **Step 3: Add typed design tokens**

Create `frontend/src/design/tokens.ts`:

```ts
export const designTokens = {
  colors: {
    canvasNight: "#000000",
    canvasNightElevated: "#0a0a0a",
    canvasLight: "#ffffff",
    canvasCream: "#fbfbf5",
    ink: "#000000",
    onDark: "#ffffff",
    aloe: "#c1fbd4",
    pistachio: "#d4f9e0",
    hairlineLight: "#e4e4e7",
    hairlineDark: "#1e2c31",
    shade30: "#d4d4d8",
    shade40: "#a1a1aa",
    shade50: "#71717a",
    shade60: "#52525b",
    shade70: "#3f3f46",
  },
  typography: {
    displayFamily: "Inter Display, Inter, Helvetica, Arial, sans-serif",
    bodyFamily: "Inter, Helvetica, Arial, sans-serif",
    monoFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  },
  radius: {
    xs: "4px",
    md: "8px",
    lg: "12px",
    pill: "9999px",
  },
  spacing: {
    xxs: "2px",
    xs: "4px",
    sm: "8px",
    md: "12px",
    lg: "16px",
    xl: "24px",
    xxl: "32px",
    huge: "64px",
  },
} as const;
```

Create `frontend/src/design/layout.ts`:

```ts
export const workbenchLayout = {
  mainSidebarWidthPx: 112,
  separatorRailWidthPx: 32,
  subSidebarWidthPx: 132,
  mobileBreakpointPx: 768,
} as const;
```

Create `frontend/src/design/copy.ts`:

```ts
export const workbenchCopy = {
  brandName: "Todo Engine",
  logoLabel: "Logo",
  disclosureLabel: "Show nested navigation",
  panels: {
    dashboard: {
      title: "Dashboard",
      eyebrow: "Local command center",
      summary: "Review proposed, approved, and active work from one place.",
    },
    todo: {
      title: "ToDo",
      eyebrow: "Work queue",
      summary: "Scan active work and approval-gated items before taking action.",
    },
    areas: {
      title: "Areas",
      eyebrow: "Long-running responsibility",
      summary: "Keep responsibilities visible without turning them into projects.",
    },
    projects: {
      title: "Projects",
      eyebrow: "Outcome pipeline",
      summary: "Track bounded outcomes from proposal through completion.",
    },
    routines: {
      title: "Routines",
      eyebrow: "Recurring cadence",
      summary: "Review recurring work patterns and materialized next actions.",
    },
    tasks: {
      title: "Tasks",
      eyebrow: "Concrete next actions",
      summary: "Focus on the next executable items in the local database.",
    },
    yearly: {
      title: "Yearly",
      eyebrow: "Planning horizon",
      summary: "Frame annual themes and the outcomes they constrain.",
    },
    monthly: {
      title: "Monthly",
      eyebrow: "Planning horizon",
      summary: "Shape the month around projects, routines, and fixed events.",
    },
    weekly: {
      title: "Weekly",
      eyebrow: "Planning horizon",
      summary: "Choose a small weekly focus set before the day gets noisy.",
    },
    daily: {
      title: "Daily",
      eyebrow: "Today",
      summary: "Materialize today's work into a compact command list.",
    },
  },
} as const;
```

- [ ] **Step 4: Map tokens into CSS variables**

Create `frontend/src/features/.gitkeep` so the architecture scan has a stable feature directory before feature components are added.

Replace `frontend/src/styles/globals.css`:

```css
:root {
  --color-canvas-night: #000000;
  --color-canvas-night-elevated: #0a0a0a;
  --color-canvas-light: #ffffff;
  --color-canvas-cream: #fbfbf5;
  --color-ink: #000000;
  --color-on-dark: #ffffff;
  --color-aloe: #c1fbd4;
  --color-pistachio: #d4f9e0;
  --color-hairline-light: #e4e4e7;
  --color-hairline-dark: #1e2c31;
  --color-shade-30: #d4d4d8;
  --color-shade-40: #a1a1aa;
  --color-shade-50: #71717a;
  --color-shade-60: #52525b;
  --color-shade-70: #3f3f46;
  --font-display: Inter Display, Inter, Helvetica, Arial, sans-serif;
  --font-body: Inter, Helvetica, Arial, sans-serif;
  --radius-xs: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-pill: 9999px;
}

* {
  box-sizing: border-box;
}

html,
body {
  min-height: 100%;
  margin: 0;
}

body {
  background: var(--color-canvas-cream);
  color: var(--color-ink);
  font-family: var(--font-body);
  font-feature-settings: "ss03";
}

button,
input,
textarea,
select {
  font: inherit;
}

button {
  cursor: pointer;
}
```

- [ ] **Step 5: Run design tests**

Run:

```bash
cd frontend
npm run test -- tests/architecture/design-boundaries.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/design frontend/src/styles/globals.css frontend/tests/architecture/design-boundaries.spec.ts
git commit -m "[FE] Add workbench design tokens"
```

---

### Task 3: Add pure navigation domain model

**Files:**
- Create: `frontend/src/domain/workbench/navigation.ts`
- Create: `frontend/tests/domain/workbench-navigation.spec.ts`

**Interfaces:**
- Produces:
  - `type WorkbenchTabId`
  - `type MainTabId`
  - `type LeafTabId`
  - `workbenchNavigation`
  - `resolveInitialSelection(): WorkbenchSelection`
  - `resolveSelection(tabId: WorkbenchTabId): WorkbenchSelection`
- Consumes: design copy only by shared ids, not direct imports.

- [ ] **Step 1: Write failing domain tests**

Create `frontend/tests/domain/workbench-navigation.spec.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  resolveInitialSelection,
  resolveSelection,
  workbenchNavigation,
} from "@/domain/workbench/navigation";

describe("workbench navigation", () => {
  it("starts on dashboard", () => {
    expect(resolveInitialSelection()).toEqual({
      mainTabId: "dashboard",
      leafTabId: "dashboard",
      plannerExpanded: false,
    });
  });

  it("resolves workspace to areas by default", () => {
    expect(resolveSelection("workspace")).toEqual({
      mainTabId: "workspace",
      leafTabId: "areas",
      plannerExpanded: false,
    });
  });

  it("resolves planner to yearly and keeps planner expanded", () => {
    expect(resolveSelection("planner")).toEqual({
      mainTabId: "workspace",
      leafTabId: "yearly",
      plannerExpanded: true,
    });
  });

  it("keeps daily under the workspace planner group", () => {
    expect(resolveSelection("daily")).toEqual({
      mainTabId: "workspace",
      leafTabId: "daily",
      plannerExpanded: true,
    });
  });

  it("defines the expected top-level tabs", () => {
    expect(workbenchNavigation.mainTabs.map((tab) => tab.id)).toEqual([
      "dashboard",
      "todo",
      "workspace",
    ]);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
cd frontend
npm run test -- tests/domain/workbench-navigation.spec.ts
```

Expected: FAIL because `navigation.ts` does not exist.

- [ ] **Step 3: Implement the pure domain model**

Create `frontend/src/domain/workbench/navigation.ts`:

```ts
export type MainTabId = "dashboard" | "todo" | "workspace";
export type WorkspaceChildTabId = "areas" | "projects" | "routines" | "tasks" | "planner";
export type PlannerTabId = "yearly" | "monthly" | "weekly" | "daily";
export type LeafTabId = Exclude<MainTabId, "workspace"> | Exclude<WorkspaceChildTabId, "planner"> | PlannerTabId;
export type WorkbenchTabId = MainTabId | WorkspaceChildTabId | PlannerTabId;

export type WorkbenchSelection = {
  mainTabId: MainTabId;
  leafTabId: LeafTabId;
  plannerExpanded: boolean;
};

export type NavigationTab<TId extends WorkbenchTabId = WorkbenchTabId> = {
  id: TId;
  label: string;
};

export const workbenchNavigation = {
  mainTabs: [
    { id: "dashboard", label: "Dashboard" },
    { id: "todo", label: "ToDo" },
    { id: "workspace", label: "Workspace" },
  ] satisfies NavigationTab<MainTabId>[],
  workspaceTabs: [
    { id: "areas", label: "Areas" },
    { id: "projects", label: "Projects" },
    { id: "routines", label: "Routines" },
    { id: "tasks", label: "Tasks" },
    { id: "planner", label: "Planner" },
  ] satisfies NavigationTab<WorkspaceChildTabId>[],
  plannerTabs: [
    { id: "yearly", label: "Yearly" },
    { id: "monthly", label: "Monthly" },
    { id: "weekly", label: "Weekly" },
    { id: "daily", label: "Daily" },
  ] satisfies NavigationTab<PlannerTabId>[],
} as const;

export function resolveInitialSelection(): WorkbenchSelection {
  return {
    mainTabId: "dashboard",
    leafTabId: "dashboard",
    plannerExpanded: false,
  };
}

export function resolveSelection(tabId: WorkbenchTabId): WorkbenchSelection {
  if (tabId === "dashboard" || tabId === "todo") {
    return {
      mainTabId: tabId,
      leafTabId: tabId,
      plannerExpanded: false,
    };
  }

  if (tabId === "workspace") {
    return {
      mainTabId: "workspace",
      leafTabId: "areas",
      plannerExpanded: false,
    };
  }

  if (tabId === "planner") {
    return {
      mainTabId: "workspace",
      leafTabId: "yearly",
      plannerExpanded: true,
    };
  }

  const plannerExpanded = workbenchNavigation.plannerTabs.some((tab) => tab.id === tabId);

  return {
    mainTabId: "workspace",
    leafTabId: tabId,
    plannerExpanded,
  };
}
```

- [ ] **Step 4: Run domain tests**

Run:

```bash
cd frontend
npm run test -- tests/domain/workbench-navigation.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/domain frontend/tests/domain
git commit -m "[FE] Add workbench navigation policy"
```

---

### Task 4: Add workbench view model and controller hook

**Files:**
- Create: `frontend/src/features/workbench/model/workbench-model.ts`
- Create: `frontend/src/features/workbench/hooks/useWorkbenchController.ts`
- Create: `frontend/tests/presentation/use-workbench-controller.spec.tsx`

**Interfaces:**
- Consumes:
  - `WorkbenchTabId`, `WorkbenchSelection`, `resolveInitialSelection`, `resolveSelection`.
  - `workbenchCopy.panels`.
- Produces:
  - `type WorkbenchPanelModel`
  - `type WorkbenchController`
  - `createPanelModel(leafTabId: LeafTabId): WorkbenchPanelModel`
  - `useWorkbenchController(): WorkbenchController`

- [ ] **Step 1: Write failing hook tests**

Create `frontend/tests/presentation/use-workbench-controller.spec.tsx`:

```tsx
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useWorkbenchController } from "@/features/workbench/hooks/useWorkbenchController";

describe("useWorkbenchController", () => {
  it("starts on the dashboard panel", () => {
    const { result } = renderHook(() => useWorkbenchController());

    expect(result.current.selection.leafTabId).toBe("dashboard");
    expect(result.current.panel.title).toBe("Dashboard");
  });

  it("selects areas when workspace is clicked", () => {
    const { result } = renderHook(() => useWorkbenchController());

    act(() => result.current.selectTab("workspace"));

    expect(result.current.selection).toEqual({
      mainTabId: "workspace",
      leafTabId: "areas",
      plannerExpanded: false,
    });
    expect(result.current.panel.title).toBe("Areas");
  });

  it("selects daily under the planner group", () => {
    const { result } = renderHook(() => useWorkbenchController());

    act(() => result.current.selectTab("daily"));

    expect(result.current.selection).toEqual({
      mainTabId: "workspace",
      leafTabId: "daily",
      plannerExpanded: true,
    });
    expect(result.current.panel.title).toBe("Daily");
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
cd frontend
npm run test -- tests/presentation/use-workbench-controller.spec.tsx
```

Expected: FAIL because the hook and model do not exist.

- [ ] **Step 3: Add the model builder**

Create `frontend/src/features/workbench/model/workbench-model.ts`:

```ts
import { workbenchCopy } from "@/design/copy";
import type { LeafTabId, WorkbenchSelection, WorkbenchTabId } from "@/domain/workbench/navigation";

export type WorkbenchPanelModel = {
  id: LeafTabId;
  title: string;
  eyebrow: string;
  summary: string;
};

export type WorkbenchController = {
  selection: WorkbenchSelection;
  panel: WorkbenchPanelModel;
  selectTab: (tabId: WorkbenchTabId) => void;
};

export function createPanelModel(leafTabId: LeafTabId): WorkbenchPanelModel {
  const panel = workbenchCopy.panels[leafTabId];

  return {
    id: leafTabId,
    title: panel.title,
    eyebrow: panel.eyebrow,
    summary: panel.summary,
  };
}
```

- [ ] **Step 4: Add the controller hook**

Create `frontend/src/features/workbench/hooks/useWorkbenchController.ts`:

```ts
"use client";

import { useMemo, useState } from "react";

import {
  type WorkbenchSelection,
  type WorkbenchTabId,
  resolveInitialSelection,
  resolveSelection,
} from "@/domain/workbench/navigation";
import {
  type WorkbenchController,
  createPanelModel,
} from "@/features/workbench/model/workbench-model";

export function useWorkbenchController(): WorkbenchController {
  const [selection, setSelection] = useState<WorkbenchSelection>(() => resolveInitialSelection());
  const panel = useMemo(() => createPanelModel(selection.leafTabId), [selection.leafTabId]);

  return {
    selection,
    panel,
    selectTab: (tabId: WorkbenchTabId) => setSelection(resolveSelection(tabId)),
  };
}
```

- [ ] **Step 5: Run hook tests**

Run:

```bash
cd frontend
npm run test -- tests/presentation/use-workbench-controller.spec.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/workbench/model frontend/src/features/workbench/hooks frontend/tests/presentation/use-workbench-controller.spec.tsx
git commit -m "[FE] Add workbench controller"
```

---

### Task 5: Render the sidebar shell and tab panels

**Files:**
- Create: `frontend/src/features/workbench/ui/WorkbenchPageClient.tsx`
- Create: `frontend/src/features/workbench/ui/WorkbenchWireframe.tsx`
- Create: `frontend/src/features/workbench/ui/MainSidebar.tsx`
- Create: `frontend/src/features/workbench/ui/SubSidebar.tsx`
- Create: `frontend/src/features/workbench/ui/MainPanel.tsx`
- Modify: `frontend/src/app/page.tsx`
- Modify: `frontend/src/styles/globals.css`
- Create: `frontend/tests/presentation/workbench-wireframe.spec.tsx`

**Interfaces:**
- Consumes:
  - `useWorkbenchController()`.
  - `WorkbenchController`.
  - `workbenchNavigation`.
  - `workbenchCopy`.
- Produces: visible app shell and interactive tab switching.

- [ ] **Step 1: Write failing rendering tests**

Create `frontend/tests/presentation/workbench-wireframe.spec.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { WorkbenchPageClient } from "@/features/workbench/ui/WorkbenchPageClient";

describe("WorkbenchPageClient", () => {
  it("renders the main and sub sidebar navigation", () => {
    render(<WorkbenchPageClient />);

    expect(screen.getByRole("button", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ToDo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Workspace" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Areas" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Planner" })).toBeInTheDocument();
  });

  it("changes the main panel when a tab is clicked", async () => {
    const user = userEvent.setup();
    render(<WorkbenchPageClient />);

    await user.click(screen.getByRole("button", { name: "Projects" }));

    expect(screen.getByRole("heading", { name: "Projects" })).toBeInTheDocument();
    expect(screen.getByText("Outcome pipeline")).toBeInTheDocument();
  });

  it("selects yearly when planner is clicked and daily when daily is clicked", async () => {
    const user = userEvent.setup();
    render(<WorkbenchPageClient />);

    await user.click(screen.getByRole("button", { name: "Planner" }));
    expect(screen.getByRole("heading", { name: "Yearly" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Daily" }));
    expect(screen.getByRole("heading", { name: "Daily" })).toBeInTheDocument();
  });
});
```

Add this import to the top of `frontend/tests/presentation/workbench-wireframe.spec.tsx` after creating it:

```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
cd frontend
npm run test -- tests/presentation/workbench-wireframe.spec.tsx
```

Expected: FAIL because UI components do not exist.

- [ ] **Step 3: Create the client assembly**

Create `frontend/src/features/workbench/ui/WorkbenchPageClient.tsx`:

```tsx
"use client";

import { useWorkbenchController } from "@/features/workbench/hooks/useWorkbenchController";
import { WorkbenchWireframe } from "@/features/workbench/ui/WorkbenchWireframe";

export function WorkbenchPageClient() {
  const controller = useWorkbenchController();

  return <WorkbenchWireframe controller={controller} />;
}
```

- [ ] **Step 4: Create the main shell wireframe**

Create `frontend/src/features/workbench/ui/WorkbenchWireframe.tsx`:

```tsx
import { ChevronDown } from "lucide-react";

import { workbenchCopy } from "@/design/copy";
import { workbenchNavigation } from "@/domain/workbench/navigation";
import type { WorkbenchController } from "@/features/workbench/model/workbench-model";
import { MainPanel } from "@/features/workbench/ui/MainPanel";
import { MainSidebar } from "@/features/workbench/ui/MainSidebar";
import { SubSidebar } from "@/features/workbench/ui/SubSidebar";

type WorkbenchWireframeProps = {
  controller: WorkbenchController;
};

export function WorkbenchWireframe({ controller }: WorkbenchWireframeProps) {
  return (
    <div className="workbench-shell">
      <aside className="workbench-nav" aria-label="Workbench navigation">
        <div className="workbench-logo">{workbenchCopy.logoLabel}</div>
        <div className="workbench-nav-grid">
          <MainSidebar
            tabs={workbenchNavigation.mainTabs}
            activeTabId={controller.selection.mainTabId}
            onSelectTab={controller.selectTab}
          />
          <div className="workbench-rail" aria-hidden="true">
            <ChevronDown className="workbench-rail-icon" />
          </div>
          <SubSidebar
            workspaceTabs={workbenchNavigation.workspaceTabs}
            plannerTabs={workbenchNavigation.plannerTabs}
            activeLeafTabId={controller.selection.leafTabId}
            plannerExpanded={controller.selection.plannerExpanded}
            onSelectTab={controller.selectTab}
          />
        </div>
      </aside>
      <MainPanel panel={controller.panel} />
    </div>
  );
}
```

- [ ] **Step 5: Create sidebar and panel components**

Create `frontend/src/features/workbench/ui/MainSidebar.tsx`:

```tsx
import type { MainTabId, NavigationTab, WorkbenchTabId } from "@/domain/workbench/navigation";

type MainSidebarProps = {
  tabs: readonly NavigationTab<MainTabId>[];
  activeTabId: MainTabId;
  onSelectTab: (tabId: WorkbenchTabId) => void;
};

export function MainSidebar({ tabs, activeTabId, onSelectTab }: MainSidebarProps) {
  return (
    <nav className="main-sidebar" aria-label="Primary sections">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className="main-sidebar-tab"
          data-active={tab.id === activeTabId}
          onClick={() => onSelectTab(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
```

Create `frontend/src/features/workbench/ui/SubSidebar.tsx`:

```tsx
import type {
  LeafTabId,
  NavigationTab,
  PlannerTabId,
  WorkbenchTabId,
  WorkspaceChildTabId,
} from "@/domain/workbench/navigation";

type SubSidebarProps = {
  workspaceTabs: readonly NavigationTab<WorkspaceChildTabId>[];
  plannerTabs: readonly NavigationTab<PlannerTabId>[];
  activeLeafTabId: LeafTabId;
  plannerExpanded: boolean;
  onSelectTab: (tabId: WorkbenchTabId) => void;
};

export function SubSidebar({
  workspaceTabs,
  plannerTabs,
  activeLeafTabId,
  plannerExpanded,
  onSelectTab,
}: SubSidebarProps) {
  return (
    <nav className="sub-sidebar" aria-label="Workspace sections">
      {workspaceTabs.map((tab) => {
        const isPlanner = tab.id === "planner";
        const isActive =
          (tab.id === activeLeafTabId) ||
          (isPlanner && plannerExpanded);

        return (
          <div key={tab.id} className="sub-sidebar-group">
            <button
              type="button"
              className="sub-sidebar-tab"
              data-active={isActive}
              onClick={() => onSelectTab(tab.id)}
            >
              {tab.label}
            </button>
            {isPlanner ? (
              <div className="planner-tab-list" data-expanded={plannerExpanded}>
                {plannerTabs.map((plannerTab) => (
                  <button
                    key={plannerTab.id}
                    type="button"
                    className="sub-sidebar-tab sub-sidebar-tab-nested"
                    data-active={plannerTab.id === activeLeafTabId}
                    onClick={() => onSelectTab(plannerTab.id)}
                  >
                    {plannerTab.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}
```

Create `frontend/src/features/workbench/ui/MainPanel.tsx`:

```tsx
import type { WorkbenchPanelModel } from "@/features/workbench/model/workbench-model";

type MainPanelProps = {
  panel: WorkbenchPanelModel;
};

export function MainPanel({ panel }: MainPanelProps) {
  return (
    <main className="main-panel">
      <section className="panel-hero" aria-labelledby="panel-title">
        <p className="panel-eyebrow">{panel.eyebrow}</p>
        <h1 id="panel-title">{panel.title}</h1>
        <p className="panel-summary">{panel.summary}</p>
      </section>
      <section className="panel-grid" aria-label={`${panel.title} overview`}>
        <article className="summary-card">
          <span className="summary-card-label">Focus</span>
          <strong>{panel.title}</strong>
          <p>{panel.summary}</p>
        </article>
        <article className="summary-card summary-card-accent">
          <span className="summary-card-label">Status</span>
          <strong>Ready</strong>
          <p>This static shell is prepared for service-backed data.</p>
        </article>
      </section>
    </main>
  );
}
```

- [ ] **Step 6: Wire the route entry**

Replace `frontend/src/app/page.tsx`:

```tsx
import { WorkbenchPageClient } from "@/features/workbench/ui/WorkbenchPageClient";

export default function HomePage() {
  return <WorkbenchPageClient />;
}
```

- [ ] **Step 7: Add layout styles**

Append to `frontend/src/styles/globals.css`:

```css
.workbench-shell {
  display: grid;
  grid-template-columns: 276px minmax(0, 1fr);
  min-height: 100dvh;
  background: var(--color-canvas-cream);
}

.workbench-nav {
  display: grid;
  grid-template-rows: 72px minmax(0, 1fr);
  border-right: 1px solid var(--color-hairline-light);
  background: var(--color-canvas-light);
}

.workbench-logo {
  display: grid;
  place-items: center;
  border-bottom: 1px solid var(--color-hairline-light);
  font-weight: 550;
}

.workbench-nav-grid {
  display: grid;
  grid-template-columns: 112px 32px 132px;
  min-height: 0;
}

.main-sidebar {
  display: flex;
  flex-direction: column;
  background: var(--color-canvas-night);
}

.main-sidebar-tab,
.sub-sidebar-tab {
  min-height: 44px;
  border: 0;
  border-bottom: 1px solid var(--color-hairline-light);
  background: transparent;
  color: inherit;
}

.main-sidebar-tab {
  color: var(--color-on-dark);
}

.main-sidebar-tab[data-active="true"] {
  background: var(--color-aloe);
  color: var(--color-ink);
}

.workbench-rail {
  display: grid;
  place-items: start center;
  padding-top: 14px;
  background: var(--color-canvas-light);
  border-left: 1px solid var(--color-hairline-light);
  border-right: 1px solid var(--color-hairline-light);
}

.workbench-rail-icon {
  width: 16px;
  height: 16px;
}

.sub-sidebar {
  display: flex;
  flex-direction: column;
  background: var(--color-canvas-cream);
}

.sub-sidebar-group {
  display: contents;
}

.sub-sidebar-tab {
  color: var(--color-ink);
}

.sub-sidebar-tab[data-active="true"] {
  background: var(--color-aloe);
  box-shadow: inset 0 0 0 1px var(--color-ink);
}

.sub-sidebar-tab-nested {
  padding-left: 20px;
  background: var(--color-canvas-light);
}

.planner-tab-list {
  display: contents;
}

.main-panel {
  min-width: 0;
  padding: 32px;
}

.panel-hero {
  max-width: 760px;
}

.panel-eyebrow {
  margin: 0 0 12px;
  font-size: 12px;
  font-weight: 500;
  text-transform: uppercase;
}

.panel-hero h1 {
  margin: 0;
  font-family: var(--font-display);
  font-size: 48px;
  font-weight: 330;
  line-height: 1.12;
}

.panel-summary {
  max-width: 620px;
  margin: 16px 0 0;
  color: var(--color-shade-60);
  font-size: 18px;
  line-height: 1.56;
}

.panel-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  margin-top: 32px;
}

.summary-card {
  min-height: 160px;
  border: 1px solid var(--color-hairline-light);
  border-radius: 8px;
  background: var(--color-canvas-light);
  padding: 24px;
}

.summary-card-accent {
  background: var(--color-pistachio);
}

.summary-card-label {
  display: inline-flex;
  margin-bottom: 16px;
  border-radius: var(--radius-pill);
  background: var(--color-shade-30);
  padding: 4px 12px;
  font-size: 12px;
}

.summary-card strong {
  display: block;
  font-size: 20px;
}

.summary-card p {
  color: var(--color-shade-60);
}

@media (max-width: 767px) {
  .workbench-shell {
    grid-template-columns: 1fr;
  }

  .workbench-nav {
    grid-template-rows: auto auto;
    border-right: 0;
  }

  .workbench-nav-grid {
    grid-template-columns: 1fr;
  }

  .main-sidebar,
  .sub-sidebar {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: minmax(112px, 1fr);
    overflow-x: auto;
  }

  .workbench-rail {
    display: none;
  }

  .panel-grid {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 8: Run rendering tests**

Run:

```bash
cd frontend
npm run test -- tests/presentation/workbench-wireframe.spec.tsx
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/app frontend/src/features/workbench/ui frontend/src/styles/globals.css frontend/tests/presentation/workbench-wireframe.spec.tsx
git commit -m "[FE] Render workbench sidebar shell"
```

---

### Task 6: Final verification and browser smoke

**Files:**
- Modify only if a previous verification step reveals a defect.

**Interfaces:**
- Consumes: all frontend code from Tasks 1-5.
- Produces: verified frontend shell and dev server URL for the user.

- [ ] **Step 1: Run all frontend tests**

Run:

```bash
cd frontend
npm run test
```

Expected: PASS for package, architecture, domain, hook, and rendering tests.

- [ ] **Step 2: Run typecheck**

Run:

```bash
cd frontend
npm run typecheck
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 3: Run production build**

Run:

```bash
cd frontend
npm run build
```

Expected: Next.js build succeeds.

- [ ] **Step 4: Start dev server**

Run:

```bash
cd frontend
npm run dev
```

Expected: dev server starts. If port 3000 is busy, use the next available port:

```bash
npm run dev -- -p 3001
```

- [ ] **Step 5: Browser smoke**

Open the local URL in the in-app browser. Verify:

- The first screen is the workbench shell.
- The main sidebar, separator rail, sub sidebar, and main panel are visible.
- Clicking `Dashboard`, `ToDo`, `Workspace`, `Projects`, `Planner`, and `Daily` changes the main panel.
- No text overlaps at desktop width.
- At a mobile viewport, sidebars collapse into horizontal navigation strips and main content remains readable.

- [ ] **Step 6: Commit final fixes if needed**

If verification required fixes:

```bash
git add frontend
git commit -m "[FE] Verify workbench frontend shell"
```

If no fixes were needed, do not create an empty commit.

---

## Self-Review

- Spec coverage: tasks cover scaffold, design tokens, navigation policy, controller hook, presentational shell, route assembly, README, and final verification.
- Placeholder scan: this plan contains no unfinished markers and no unspecified test steps.
- Type consistency: `WorkbenchTabId`, `MainTabId`, `LeafTabId`, `WorkbenchSelection`, `WorkbenchController`, and `WorkbenchPanelModel` are introduced before use.
- Scope check: API integration, real data, auth, persistence, and mutation flows remain out of scope.
