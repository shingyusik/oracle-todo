# Completion History Axes

## Goal

Make the completion-history chart readable without relying on point tooltips.

## Design

- Add visible X- and Y-axis labels to `DashboardLineChart`.
- Show every X-axis date when the range contains seven or fewer points.
- For longer ranges, derive evenly spaced labels from the point count while
  always including the first and last dates. Presets and custom ranges use the
  same calculation; there are no preset-specific intervals.
- Derive integer Y-axis ticks from zero through the observed maximum. Keep the
  existing minimum chart scale of one when all values are zero.
- Reuse the existing point labels and values. Do not change dashboard models,
  API data, range controls, or tooltip behavior.

## Verification

- Add focused presentation tests covering all seven date labels and sampled
  labels for a longer range.
- Assert that Y-axis labels include zero and the data maximum.
- Run the affected frontend test suite, type checking, and linting.
