# Raven Dark UI Implementation Plan

> Execute sequentially in this session using executing-plans. Preserve existing working changes.

**Goal:** Apply the approved rounded dark UI across Raven with Spotify green actions.
**Architecture:** Reuse global CSS and existing components. Separate text, accent foreground, raised surfaces and chart semantics; keep modal portals and existing data flows.
**Tech Stack:** Next.js, React, CSS variables, existing Vitest tests and Aside browser.

- [x] Update `frontend/src/design/tokens.ts` and `frontend/src/styles/globals.css`: dark surfaces, green actions, contrasting foregrounds, radii, type, spacing, navigation and interactive states.
- [x] Update `frontend/src/features/health/ui/HealthReportCharts.tsx`: use dark diverging heatmap endpoints and readable cell text; preserve numeric differences and selection.
- [x] Extend `frontend/tests/architecture/design-boundaries.spec.ts` with token synchronization and text contrast checks; update obsolete theme expectations.
- [x] Run `npm --prefix frontend test`, `npm --prefix frontend run typecheck`, and `npm --prefix frontend run build`. Fix regressions, keeping behavior assertions intact.
- [x] Seed an isolated temporary Raven home; run the built UI and inspect Dashboard, ToDo, Ledger, Health, settings and dialogs at desktop/mobile widths. Check focus, scrolling and tag dropdown clipping.
- [x] Update `docs/architecture/layers.md` with the shipped theme contract and record verification in this plan. Leave changes reviewable on `ui/raven-dark-theme`.

The existing token keys remain compatible with callers. New roles include
`onAccent`, `surfaceRaised`, `surfaceHover`, `borderControl`, `heatmapLess`,
`heatmapMore` and `logoBackdrop`. Contrast checks cover normal text on each
surface, primary button labels and both heatmap endpoints.

## Verification

- Full frontend suite: 49 files, 1,437 tests passed.
- After final chart-label, layout and toolbar refinements: 7 affected suites, 289 tests passed.
- Typecheck and final static build passed. Existing Autoprefixer `align-items: end` warning remains.
- Browser: Dashboard, ToDo planner, Ledger tables/account settings, Health forms and Reports inspected using throwaway seeded data.
- Viewports: 1440×1000 desktop, 390×844 mobile, 390×520 short mobile. Settings table scrolls horizontally within its dialog.
- Health tag portal remains fixed inside the dialog focus boundary, flips above a low trigger, receives pointer hits and supports Escape/Tab.
- Visual inspection prompted compact month/day chart labels (full dates retained in title/datetime), responsive status tiles and shorter Dashboard descriptions.
- Screenshots and verification logs are retained in the system temporary directory under `raven-dark-ui-review-20260917`.
