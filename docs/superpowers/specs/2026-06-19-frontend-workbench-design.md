# Frontend Workbench Shell Design

**Date:** 2026-06-19
**Status:** Approved for implementation planning
**Scope:** Build the first todo-engine web frontend shell under `frontend/`. The shell provides a two-sidebar tab layout and tab-specific main panels. It does not wire to the Rust HTTP API yet.

## Goal

Create a production-shaped frontend foundation for `todo-engine`: a Next.js React app with clean frontend architecture, design tokens, separated layout and state logic, and a workbench shell matching the provided sidebar sketch. Each sidebar tab changes the right-side main panel to a corresponding view.

## Product Shape

The first screen is the usable workbench, not a landing page. The app opens directly into a dashboard-style shell:

```text
frontend viewport
  left navigation area
    logo row spanning main + rail + sub sidebars
    main sidebar tabs
    separator rail / disclosure affordance
    sub sidebar tabs for the current section
  main panel
    current tab screen
```

Top-level navigation:

| Main Tab | Child Tabs | Default Leaf |
| --- | --- | --- |
| `Dashboard` | none | `Dashboard` |
| `ToDo` | none | `ToDo` |
| `Workspace` | `Areas`, `Projects`, `Routines`, `Tasks`, `Planner` | `Areas` |
| `Planner` child group | `Yearly`, `Monthly`, `Weekly`, `Daily` | `Yearly` |

`Planner` is displayed as a nested child group inside the sub sidebar, matching the sketch. Selecting `Planner` itself resolves to `Yearly`.

## Visual Direction

Use the root `DESIGN.md` as the UI contract. The app uses the Shopify-inspired transactional track:

- Cream app canvas.
- Black primary sidebar chrome.
- White and cream sub sidebar surfaces.
- Aloe mint active states.
- Thin display headings.
- Pill command buttons.
- Compact operational density.

The reference screenshot defines the information architecture and column relationship. The final UI should be polished rather than wireframe-like: no magenta outlines, no visible placeholder labels such as "Main", and no instructional copy explaining how to use the interface.

## Architecture

Use the Panorion frontend boundary style, scaled down for this project:

```text
frontend/src/app
  route entries and global shell only
frontend/src/design
  tokens, copy, and layout constants
frontend/src/domain/workbench
  pure navigation policy and tab resolution
frontend/src/features/workbench/model
  feature-facing view models
frontend/src/features/workbench/hooks
  React state/controller hooks
frontend/src/features/workbench/ui
  presentational components and wireframes
frontend/tests
  architecture, domain, and presentation tests
```

Rules:

- `src/app` stays thin and imports the feature client component.
- `src/design` owns semantic color, type, spacing, copy, and layout constants.
- `src/domain` has no React, DOM, CSS, or I/O.
- `features/workbench/model` maps domain data into UI-ready models.
- `features/workbench/hooks` owns React state and event handlers.
- `features/workbench/ui/*Wireframe.tsx` receives props and renders layout only.
- Presentational wireframes do not call hooks and do not import application, infrastructure, stores, or raw design JSON.

## Tech Stack

- Next.js App Router.
- React with TypeScript strict mode.
- Vitest with React Testing Library and jsdom.
- CSS modules or global CSS variables for styling.
- `lucide-react` for mechanical icons.
- No backend client, TanStack Query, Zustand, auth, or API gateway in this first shell.

## File Responsibilities

Create:

| File | Responsibility |
| --- | --- |
| `frontend/package.json` | Frontend scripts and dependencies |
| `frontend/tsconfig.json` | Strict TypeScript config and `@/*` alias |
| `frontend/next.config.mjs` | Next config |
| `frontend/vitest.config.ts` | Vitest jsdom config |
| `frontend/src/app/layout.tsx` | Root HTML and global metadata |
| `frontend/src/app/page.tsx` | Thin page entry |
| `frontend/src/styles/globals.css` | CSS reset, font, token variables |
| `frontend/src/design/tokens.ts` | Typed semantic design tokens |
| `frontend/src/design/copy.ts` | Stable UI labels and panel copy |
| `frontend/src/design/layout.ts` | Sidebar widths and layout constants |
| `frontend/src/domain/workbench/navigation.ts` | Pure tab tree and tab resolution |
| `frontend/src/features/workbench/model/workbench-model.ts` | UI view model types and builders |
| `frontend/src/features/workbench/hooks/useWorkbenchController.ts` | Active tab state and handlers |
| `frontend/src/features/workbench/ui/WorkbenchPageClient.tsx` | Client assembly |
| `frontend/src/features/workbench/ui/WorkbenchWireframe.tsx` | Shell layout |
| `frontend/src/features/workbench/ui/MainSidebar.tsx` | Main sidebar tabs |
| `frontend/src/features/workbench/ui/SubSidebar.tsx` | Child and nested tabs |
| `frontend/src/features/workbench/ui/MainPanel.tsx` | Tab-specific main panel |
| `frontend/tests/**` | Boundary, domain, hook, and rendering tests |

Update:

| File | Responsibility |
| --- | --- |
| `frontend/README.md` | Replace placeholder with current frontend commands and architecture summary |

## Navigation Behavior

- Initial selection is `Dashboard`.
- Clicking `Dashboard` selects `Dashboard` and clears child selection.
- Clicking `ToDo` selects `ToDo` and clears child selection.
- Clicking `Workspace` selects `Areas`.
- Clicking `Areas`, `Projects`, `Routines`, or `Tasks` keeps main context `Workspace` and selects that leaf.
- Clicking `Planner` selects `Yearly`.
- Clicking `Yearly`, `Monthly`, `Weekly`, or `Daily` keeps main context `Workspace`, keeps planner expanded, and selects that leaf.
- The main panel title, summary, and placeholder content all come from `src/design/copy.ts`.

## Main Panel Screens

Each tab gets a distinct, useful starter view:

| Tab | Main Panel |
| --- | --- |
| `Dashboard` | Status overview, pending approval count placeholder, today preview |
| `ToDo` | Active work queue placeholder with status chips |
| `Areas` | Area list placeholder |
| `Projects` | Project pipeline placeholder |
| `Routines` | Routine schedule placeholder |
| `Tasks` | Task list placeholder |
| `Yearly` | Year planning lanes placeholder |
| `Monthly` | Month planning board placeholder |
| `Weekly` | Week focus list placeholder |
| `Daily` | Today command list placeholder |

These are static starter screens. Live data and mutation flows are out of scope.

## Testing Strategy

Use TDD for implementation:

1. Architecture tests prove design and UI boundaries.
2. Domain tests prove tab tree and tab resolution.
3. Hook tests prove selection transitions.
4. Rendering tests prove sidebar tab clicks update the main panel.
5. Build and type checks prove the app compiles.
6. Browser smoke verifies the shell is visible at local dev URL.

Verification commands:

```bash
cd frontend
npm install
npm run test
npm run typecheck
npm run build
npm run dev
```

## Out of Scope

- Rust API integration.
- Authentication.
- SQLite access from the browser.
- Creating, updating, approving, or completing todo items.
- Real calendar/date materialization.
- Persisting active tab state.
- A marketing landing page.
- Global package management changes outside `frontend/`.

## Success Criteria

- `frontend/` contains a working Next.js app.
- `npm run test`, `npm run typecheck`, and `npm run build` pass from `frontend/`.
- The first route renders the workbench shell directly.
- Both sidebars render with the tab hierarchy from the sketch.
- Clicking each tab changes the main panel content.
- Tokens, copy, layout constants, domain logic, controller logic, and UI layout live in separate files.
- No feature component hardcodes raw hex color literals.
- `frontend/README.md` documents the current frontend stack and commands.
- Root `DESIGN.md` exists and is the visual contract for future UI work.

## Risks and Notes

- The `frontend/` directory is currently empty except for a placeholder README, so this is a scaffold plus feature shell.
- Next.js creates a separate Node dependency graph under `frontend/`; it does not affect the Rust workspace.
- The shell is static by design. API integration should be a separate spec because it introduces data ports, error handling, and service contracts.
- The Shopify-inspired palette must be adapted to an operational app. The UI should feel precise and scannable, not like a commerce marketing page.
