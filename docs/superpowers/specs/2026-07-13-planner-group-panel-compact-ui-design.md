# Planner Group Panel Compact UI Design

**Date:** 2026-07-13
**Status:** Approved for implementation planning
**Scope:** Align the Planner Group panel with the existing Filter and Sort dropdown interaction and visual density.

## Goal

The Group control should read as a peer of Filter and Sort rather than a separate settings application.

- Reuse the existing planner dropdown shell and title treatment.
- Remove the dedicated header, back button, and close button.
- Reduce typography, icon size, row height, padding, and emphasis.
- Preserve all group behavior, persistence, accessibility, and period-scoped derivation.

## Panel Structure

The Group trigger opens the existing `PlannerControlDropdown` shell with the standard `Group` title.

```text
Group

Group by                         Area  ›
  [None / Area / Project / ...]

Sort                           Manual  ›
  [Manual / Alphabetical / ...]

Hide empty groups                    ●

Groups                          Hide all
⠿  No area                         eye
⠿  Work                            eye
⠿  Personal                        eye

Remove grouping
```

The panel does not render a second dialog role inside the dropdown shell.

## Inline Selectors

`Group by` and `Sort` use inline menus inside the open Group panel.

- Activating one row expands its option list directly below the row.
- Opening one selector closes the other selector.
- Selecting an option closes only the inline menu; the Group panel stays open.
- The active option has a check icon and selected semantics.
- Escape closes an open inline menu first. A second Escape closes the Group panel.
- Clicking outside closes the entire Group panel and restores focus to the Group toolbar trigger.

Group choices remain view-specific:

- Yearly and Monthly: None, Tag, Status.
- Weekly and Daily: None, Area, Project, Routine, Tag, Item type, Status.

Sort choices remain Manual, Alphabetical, and Reverse alphabetical.

## Visual Density

The Group panel uses the same visual scale as Filter and Sort.

- Dropdown title: 13px using the existing title style.
- Primary row text: 13px.
- Secondary values and group counts: 12px.
- Row height: approximately 32px.
- Row horizontal padding: 8px.
- Section spacing: 6-8px.
- Chevron, eye, drag, and trash icons: 14-16px.
- Normal rows use regular font weight.
- Section labels and active values provide hierarchy without large headings.
- Group rows have no card border or large radius.
- Hover and focus use the existing subtle planner menu treatments.
- Separators divide settings, groups, and removal without introducing card containers.

## Group Rows

Manual group rows retain all behavior in the compact layout.

- A small grip is the pointer drag source.
- The group label occupies the flexible column.
- Count is muted and right-aligned before the visibility action.
- Visibility uses an eye or eye-off icon with an accessible label.
- Keyboard move-up and move-down actions remain available but visually unobtrusive.
- Alphabetical modes disable manual drag and move actions.
- The group heading exposes only one bulk action: `Hide all` or `Show all` based on current state.

## Component Boundaries

- `MainPanel.tsx` owns the outer planner dropdown, outside-click handling, Escape closure, and trigger focus restoration.
- `PlannerGroupPanel.tsx` renders compact settings content and owns only which inline selector is open.
- Existing controller actions and group-setting model remain unchanged.
- Existing candidate universe, visibility, manual ordering, sorting, and persistence logic remain unchanged.

## Accessibility

- The toolbar trigger retains `aria-expanded` and its dropdown relationship.
- The outer dropdown owns `role="dialog"` and the `Group` accessible name.
- Inline options use listbox and option semantics with `aria-selected`.
- Selector rows expose expanded state and associated option-list IDs.
- Focus remains inside the panel interaction flow without requiring Back or Close controls.
- Pointer drag has keyboard move alternatives.
- Icon-only actions retain explicit accessible labels.

## Testing Strategy

- Presentation tests verify that Back and Close controls are absent.
- Presentation tests verify inline property and sort menus open one at a time.
- Selecting an option closes the inline menu without closing the Group panel.
- Escape closes the inline menu before the outer panel.
- Existing drag, keyboard ordering, visibility, persistence, period scope, and empty-group tests remain green.
- Architecture tests continue to reject undefined variables and raw colors in feature components.

Verification commands:

```bash
cd frontend
npm run test
npm run typecheck
npm run build
```

## Out of Scope

- Changes to group data, storage keys, or grouping algorithms.
- Changes to Filter or Sort behavior.
- New dependencies or menu libraries.
- Responsive redesign outside the Planner control dropdown.

## Success Criteria

- Filter, Sort, and Group visibly belong to the same control family.
- Group contains no dedicated header, Back button, or Close button.
- Text and icons match the compact scale used by Filter and Sort.
- Property and sort choices remain accessible without navigating to a separate screen.
- All existing group behavior and verification gates remain green.
