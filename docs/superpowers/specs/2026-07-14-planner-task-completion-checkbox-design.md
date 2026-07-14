# Planner Task Completion Checkbox Design

**Date:** 2026-07-14  
**Status:** Approved for implementation planning  
**Scope:** Add bidirectional `active` / `completed` task checkboxes to monthly, weekly, and daily planner views.

## Goal

Planner task rows expose completion as a direct checkbox interaction:

- An active task renders unchecked.
- A completed task renders checked and remains visible in its planner position.
- Checking completes the task.
- Unchecking reopens the task as active.
- Proposed, approved, and waiting tasks do not render a completion checkbox.
- Goals, routines, and events do not render a completion checkbox.

## Service Policy

Completion continues through `TodoService::complete`.

A dedicated `TodoService::reopen` transition restores completed tasks:

- The item must be a task.
- The current status must be `completed`.
- The resulting status is `active`.
- `completed_at` is cleared.
- `updated_at` is refreshed.
- A `TodoEvent` with action `reopen` is written in the same mutation path.
- Any other item type or source status returns a policy error.

The existing `activate` transition keeps its current meaning and continues to reject terminal items.

## HTTP API

The planner uses the existing completion endpoint and one additive endpoint:

| Interaction | Endpoint |
| --- | --- |
| Check an active task | `POST /items/{id}/complete` |
| Uncheck a completed task | `POST /items/{id}/reopen` |

Both responses return the updated item. Policy, not-found, and internal errors retain the existing HTTP status mapping.

## Frontend Rendering

A shared planner task checkbox is used by:

- Monthly calendar day items.
- Weekly day cards.
- Daily planner sections.

The checkbox appears only when `item.type === "task"` and status is `active` or `completed`. Its accessible name includes the task title and intended action. Checkbox interaction does not open the item detail view.

Completed tasks remain in their existing scheduled or unscheduled bucket and use subdued completed styling. The planner model continues to hide other terminal items. Yearly goal-only rendering is unchanged.

Monthly planner loading includes tasks, events, and routines so its calendar item model receives the item types it already supports.

## Interaction and Errors

- The checkbox is disabled while its transition request is pending.
- Repeated clicks cannot enqueue duplicate transitions.
- The UI updates from the service response rather than applying an optimistic status change.
- A failed request leaves the current checkbox state and item placement unchanged.
- A compact inline error is associated with the affected task.
- Opening task details remains available through the task title control.

## Testing

Implementation follows test-driven development.

### Rust

- Service tests prove a completed task reopens as active, clears `completed_at`, and records a `reopen` audit event.
- Service tests reject reopening a non-task or a task outside `completed`.
- API tests prove `POST /items/{id}/reopen` returns the updated task and preserves standard error mapping.

### Frontend

- Planner model tests prove completed tasks remain visible while other terminal items stay hidden.
- Controller tests prove complete and reopen actions call the matching endpoints and replace the item from the response.
- Presentation tests cover checked and unchecked task states in monthly, weekly, and daily views.
- Presentation tests prove proposed, approved, and waiting tasks and non-task items have no completion checkbox.
- Interaction tests prove checkbox clicks do not open details, pending requests disable the checkbox, and failures retain the prior state.
- Planner loading tests prove monthly fetches task, event, and routine items.

Verification commands:

```bash
cargo test
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings
cd frontend
npm test
npm run typecheck
npm run build
```

## Documentation Impact

Implementation updates the status lifecycle and API reference to document task reopening. Planner documentation records completed-task visibility and checkbox behavior.

## Out of Scope

- Reopening completed goals, projects, routines, events, or areas.
- Checkboxes for proposed, approved, waiting, paused, or terminal states other than completed.
- Bulk completion from planner views.
- Optimistic completion updates.
- Changes to existing approval gating.

## Success Criteria

- Active and completed tasks can be toggled directly in monthly, weekly, and daily planner views.
- Completed tasks remain visible and can be restored to active.
- Every completion and reopening passes through `TodoService` and writes an audit event.
- Planner interactions preserve detail navigation and provide request failure feedback.
- Existing activation and approval policies remain unchanged.
