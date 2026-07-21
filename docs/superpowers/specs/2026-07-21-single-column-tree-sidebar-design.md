# Single-Column Tree Sidebar Design

**Date:** 2026-07-21
**Status:** Approved

## Goal

Present all workbench navigation in one sidebar with a clear hierarchy.

## Layout

- Keep the existing sidebar width and logo header.
- Show `Dashboard` as the first top-level navigation item.
- Render a divider below `Dashboard`.
- Show `ToDo` below the divider.
- Nest `Workspace` and `Planner` below `ToDo`.
- Nest each group's existing leaf tabs below its expandable parent.

## Behavior

- `Dashboard` continues to select the dashboard panel.
- `ToDo` continues to select the ToDo panel and hides both nested groups.
- `Workspace` and `Planner` retain their independent expansion state.
- Selecting a leaf tab preserves the existing panel selection and expansion behavior.

## Components

Replace the separate main and sub sidebars with one tree-navigation component.
Reuse `workbenchNavigation`, `WorkbenchSelection`, and the current selection and
group-expansion helpers. The main panel and its data flow are unchanged.

## Accessibility

- Use buttons for selectable and expandable navigation items.
- Retain accessible names for every item.
- Expose expanded state through `aria-expanded` on `Workspace` and `Planner`.
- Keep visible text labels; icon-only tab tooltips are not needed in the unified sidebar.

## Verification

- Presentation tests verify the single-column hierarchy, divider, labels, and
  expansion state.
- Domain navigation tests continue to cover selection and independent expansion.
- Run frontend tests, type checking, and the production build.
