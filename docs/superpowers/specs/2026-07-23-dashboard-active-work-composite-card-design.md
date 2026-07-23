# Dashboard Active Work Composite Card Design

## Goal

Keep the Dashboard summary visually compact while preserving direct navigation
to the active Task, Event, and Routine lists.

## Approved design

- Keep four top-level summary cards:
  - Active Areas
  - Active Projects
  - Active Work
  - Attention Projects
- Present `Active Work` as one composite card.
- Show the total active work count as the card's primary value.
- Show Task, Event, and Routine counts as three compact actions inside the card.
- Each compact action navigates directly to its corresponding Workspace list.
- The total and card title are informational and do not navigate to an
  ambiguous default view.

## Architecture

The Dashboard snapshot continues to expose independently calculated
`activeTasks`, `activeEvents`, and `activeRoutines` values. The widget registry
combines them into a presentation-only composite stat, so changing the
calculation or presentation later remains localized. The generic Dashboard stat
renderer supports both ordinary linked stats and composite stats instead of
hard-coding `Active Work` in the component.

## Interaction and accessibility

- Each Task, Event, and Routine action is a native button with a complete
  accessible name containing its label and count.
- The composite card itself is not a button, avoiding nested interactive
  controls and an ambiguous destination.
- Keyboard focus and hover treatments apply to each compact action.

## Responsive behavior

The summary remains a four-card grid on desktop and a two-column grid on mobile.
The three compact actions stay inside the Active Work card and may wrap only
when the available width requires it.

## Verification

- Widget-model tests verify the four top-level stats and composite total.
- Presentation tests verify the composite structure and the three direct
  navigation actions.
- The complete frontend test, typecheck, and production build gates must pass.
