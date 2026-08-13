# Raven Core Mobile Layout Design

## Goal

Make the Dashboard and core ToDo flows usable at a 360px viewport without page-level horizontal overflow, clipped controls, or overlapping content.

## Scope

- Dashboard analytics
- ToDo workspace tables
- Daily, Weekly, and Monthly Planner views
- Shared ToDo detail view
- Existing mobile navigation drawer

Ledger and Health workspace screens are outside this slice. SHI-29 remains open until their mobile behavior is assessed separately.

## Layout Policy

- Reuse the existing mobile breakpoint at `max-width: 760px`.
- Keep the existing React component tree and data flow.
- Use CSS media rules instead of mobile-specific components or JavaScript viewport state.
- Prevent the shell and page body from exceeding the viewport width.
- Allow native horizontal scrolling only inside wide tables, calendars, and heatmaps.
- Preserve every existing table column; do not freeze or hide columns.
- Wrap headers, filters, sort controls, date controls, and action groups when space is limited.
- Constrain dialogs and popovers to the viewport.

### Mobile Navigation Drawer

- Keep the existing Menu, Close, overlay dismissal, focus trap, and scroll lock behavior.
- Set the mobile drawer width to `min(320px, calc(100vw - 24px))`.
- Leave at least 24px of overlay visible so the drawer can still be dismissed from outside.
- Keep the logo, wordmark, tagline, and Close button visible on one row.
- Prevent the Close button from shrinking or being pushed outside the drawer.
- Keep the desktop sidebar width unchanged.

## Screen Behavior

### Dashboard

- Stack status cards and analytics widgets in one column.
- Fit Completion history charts to their container.
- Keep the heatmap readable by scrolling it within its widget.
- Wrap completion-range presets and custom date inputs.

### ToDo Tables

- Keep the semantic table and all columns.
- Scroll the table container horizontally without moving the page.
- Wrap the table heading, view controls, filters, sorting, and add action above the table.

### Planner

- Scroll wide Daily, Weekly, and Monthly grids within their own sections.
- Retain a readable minimum width for cards, labels, checkboxes, and miss actions.
- Wrap period navigation, date selection, filter, sort, and creation controls.
- Keep creation dialogs and control popovers within a 360px viewport.

### Shared Detail View

- Stack properties and Markdown notes in one column.
- Wrap Back, Undo, Redo, Save, and Archive actions without changing their behavior.
- Preserve dirty-draft confirmation, page-local Undo/Redo, save, and archive flows.

## Accessibility

- Preserve semantic tables, headings, labels, and existing focus behavior.
- Make horizontal scroll regions keyboard reachable when they are not already focusable.
- Use native touch scrolling and browser focus behavior.
- Keep interactive controls visible and operable without relying on hover.
- Preserve reduced-motion behavior and modal focus isolation.

## Error Handling

No API or mutation behavior changes. Existing loading, validation, save, archive, and retry states remain authoritative. Error messages and confirmation dialogs must stay within the viewport and remain readable at 360px.

## Verification

- Extend CSS boundary tests for the 760px media query, page overflow containment, and component-local scrolling.
- Run the complete frontend Vitest suite and TypeScript typecheck.
- Manually verify Dashboard, Tasks, Daily Planner, Weekly Planner, Monthly Planner, and the shared detail view at 360px.
- Verify the mobile drawer at 360px and 320px, including full Close button visibility, outside-tap dismissal, Escape, focus restoration, and body scroll lock.
- Confirm that only intended table, calendar, and heatmap regions scroll horizontally.
- Confirm that navigation, filtering, sorting, creation, completion, detail editing, Undo/Redo, save, and archive remain usable.

## Non-Goals

- Mobile-specific React components
- Card replacements for table rows
- Sticky or frozen table columns
- Hidden mobile-only columns
- New frontend dependencies
- Mobile redesign of Ledger or Health workspace screens
