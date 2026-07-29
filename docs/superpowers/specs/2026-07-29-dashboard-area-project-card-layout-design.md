# Dashboard Area and Project Card Layout Design

**Date:** 2026-07-29
**Status:** Approved for implementation planning

## Goal

Make the Area and Project status summaries easier to compare without allowing
large workspaces to make the Dashboard excessively tall.

Area status and Project status remain separate analytical widgets. On wide
screens they share one row as equal-width cards; on narrower screens they
return to a vertical sequence so their tables remain readable.

## Layout

The Dashboard keeps its existing information order:

1. Today's work and Completion history;
2. Area status; and
3. Project status.

The Area and Project widgets use a nested two-column grid when enough
horizontal space is available. Each widget remains its own card with an
independent heading, description, table, and expansion control.

The nested grid collapses to one column before either table becomes too narrow
to read comfortably. On narrow screens, the existing horizontal table scroll
remains available as a fallback. The DOM and keyboard reading order stay Area
first and Project second at every width.

## Row Priority

Each Area and Project collection is ordered by operational urgency:

1. higher Miss count;
2. higher incomplete count; and
3. localized name order as a deterministic tie-breaker.

The ordering uses the existing Task/Event-only status aggregates. It does not
change counting rules, Project attention rules, or navigation behavior.

## Bounded Card Height

Each card initially displays at most five rows.

- When the collection contains five or fewer rows, no expansion control is
  rendered.
- When more than five rows exist, the card footer renders
  `전체 보기 (총 N개)`.
- Activating the control displays every row and changes the control label to
  `접기`.
- Activating `접기` restores the five-row preview.
- Area and Project expansion states are independent.
- If refreshed data reduces an expanded collection to five or fewer rows, its
  expansion state returns to collapsed.

The design deliberately avoids a vertically scrolling region inside either
card. Page scrolling and the explicit expansion control provide a clearer
interaction than nested vertical scrolling.

## Accessibility

The expansion controls are native buttons and expose their current expanded
state with `aria-expanded`. Their accessible names identify the corresponding
Area or Project card.

Existing table headers, cell values, row navigation, keyboard focus, and
horizontal overflow behavior remain intact. The five-row limit only changes
which ordered rows are currently rendered.

## Frontend Responsibilities

| Module | Responsibility |
| --- | --- |
| `dashboard-model.ts` | Apply the deterministic Miss, incomplete, and name priority ordering |
| `DashboardPanel.tsx` | Compose the Area and Project widgets in a shared responsive row and own their independent expansion state |
| `DashboardHeatmap.tsx` | Render the bounded row slice and accessible expansion control without changing heatmap semantics |
| `globals.css` | Define the equal-width desktop cards, responsive collapse, and card footer styling |

No backend API, database schema, persisted preference, or TodoService behavior
changes are required.

## Verification

Model tests cover Area and Project priority ordering, including name
tie-breaking.

Presentation tests cover:

- Area and Project rendering as separate cards in the shared layout;
- the five-row initial limit;
- the absence of a control for five or fewer rows;
- `전체 보기 (총 N개)` and `접기` behavior;
- independent Area and Project expansion;
- reset after refreshed data falls to five or fewer rows;
- accessible expanded state; and
- preservation of row and cell navigation.

Frontend unit tests, typecheck, and the production build must pass.

## Out of Scope

- Persisting expansion state;
- pagination or vertical card scrolling;
- changing Dashboard status counts;
- changing Task/Event-only scope;
- changing Project progress or attention rules; and
- adding backend sorting or analytics endpoints.
