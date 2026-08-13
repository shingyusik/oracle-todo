# Raven Mobile Navigation Drawer Design

## Goal

Keep the mobile navigation header fully visible by preventing the Close button from being pushed beyond the drawer edge.

## Scope

- Mobile navigation drawer width
- Logo-row sizing at the existing `max-width: 760px` breakpoint
- Regression coverage for the drawer width and Close button

Dashboard, ToDo tables, Planner layouts, shared detail views, Ledger, and Health are outside this change. Their existing responsive behavior remains unchanged.

## Design

- Keep the desktop sidebar width at `212px`.
- Set the mobile drawer width to `min(320px, calc(100vw - 24px))`.
- Leave at least 24px of overlay visible for outside-tap dismissal.
- Keep the logo, wordmark, tagline, and Close button on the existing header row.
- Prevent the Close button from shrinking.
- Preserve the existing Menu trigger, overlay dismissal, Escape handling, focus trap, focus restoration, body scroll lock, and reduced-motion behavior.
- Use CSS only; do not add component state, markup, or dependencies.

## Verification

- Add a CSS boundary test for the mobile drawer width and non-shrinking Close button.
- Run the existing mobile drawer interaction and body-scroll-lock tests.
- Run the complete frontend Vitest suite and TypeScript typecheck.
- Manually verify the open drawer at 360px and 320px.
- Confirm the Close button is fully visible and Menu, Close, outside tap, and Escape still dismiss the drawer correctly.

## Non-Goals

- General mobile layout changes
- Navigation redesign
- Mobile-specific components
- Changes to navigation content or hierarchy
