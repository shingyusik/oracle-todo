# Dashboard Project Status Paused Filtering Design

## Goal

Exclude paused projects and paused linked work from the Dashboard Project status widget.

## Behavior

- Project status rows include projects whose status is `active`.
- Projects whose status is `paused` do not appear.
- Paused Tasks and Events linked to an active project do not contribute to its status values, percentages, total, progress, or row ordering.
- Completed, active, waiting, and missed linked work retain their existing behavior.
- Area status, Today outcomes, and completion history remain unchanged.
- The empty-state copy refers to active Projects only.

## Implementation

Apply both filters inside the existing Project status model builder. Keep the shared status mapping and all other Dashboard projections unchanged. Update the Project status widget copy and cover the model and copy with focused regression tests.

## Verification

- Run the focused Dashboard model and widget tests.
- Run the frontend type checker.
