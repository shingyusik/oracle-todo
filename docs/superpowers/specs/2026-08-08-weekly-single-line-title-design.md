# Weekly Single-Line Titles Design

## Goal

Keep every item title in the Weekly planner on one line. When a title is actually
truncated, hovering it exposes the complete title through the browser's native tooltip.

## Scope

- Apply the behavior only to item buttons rendered inside the Weekly planner.
- Preserve the complete title as the button's text and accessible name.
- Do not change Month, Daily, workspace table, or detail-view title behavior.
- Do not introduce a custom tooltip component or new dependency.

## Design

Weekly item buttons receive a dedicated class that applies `white-space: nowrap`,
`overflow: hidden`, and `text-overflow: ellipsis`. The surrounding flex items retain
`min-width: 0` so narrow cards allow the title button to shrink instead of expanding the
grid.

On pointer entry, the button compares `scrollWidth` with `clientWidth`. It sets its native
`title` attribute to the complete item title only when the rendered text overflows, and
removes the attribute otherwise. Measuring at interaction time keeps the result correct
after viewport or layout changes without adding resize observers or persistent component
state.

## Error and Accessibility Behavior

The overflow check has no network or persistence failure mode. The complete text remains
in the DOM, so clipping is visual only and the existing button accessible name remains
complete. Non-truncated titles do not display redundant tooltips.

## Verification

- Add a presentation test proving Weekly item buttons opt into the single-line class.
- Simulate truncated and non-truncated dimensions, then verify hover adds or omits the
  complete native title appropriately.
- Run the focused frontend test, the full frontend test suite, type checking, and the
  production frontend build.

