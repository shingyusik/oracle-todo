# Tabler and Recharts implementation plan

**Goal:** Unify UI icons and interactive charts while preserving the dark green visual theme and existing navigation.

**Approved design:** Replace all Lucide icons with Tabler outline icons. Replace hand-rendered line, bar, donut and heatmap charts with Recharts. Provide responsive sizing, value tooltips, hover emphasis and short data transition animations. Preserve missing-data semantics, date domains, currency precision, keyboard navigation and reduced-motion preferences.

**Architecture:** Existing report models and loaders remain the source of chart data. Reuse shared line charts; share a small donut renderer and chart motion/tooltip styles across domains. Heatmap uses Recharts scatter coordinates with rectangular cells and accessible selection.

**Tech stack:** React 18, Next static export, @tabler/icons-react, Recharts, existing Vitest tests.

- [x] Replace Lucide imports across workbench, ledger and health; keep accessible labels and fixed icon button sizes.
- [x] Replace DashboardLineChart and dashboard/status donuts, preserving date ranges, reference bands and destinations.
- [x] Replace Ledger composition, cash flow and income/expense graphics; preserve money formatting and drilldowns.
- [x] Replace Health frequency bars and Bristol heatmap; retain sample thresholds, selection details and bounded scrolling.
- [x] Update relevant chart tests for rendered SVG behavior and add interaction/edge-case coverage.
- [x] Run frontend tests, typecheck and static build. Verify responsive layouts and tooltips in a browser using a throwaway home.
- [x] Update existing UI documentation to describe the resulting chart and icon conventions.

Validation: 50 frontend suites / 1,442 tests passed. Typecheck and static export passed.
Headless Chromium confirmed desktop charts, viewport-bounded tooltips, heatmap selection,
390px mobile layout, 16px toolbar icons, and Health Reports without runtime errors.
