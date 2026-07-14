# Planner Event Completion Checkbox Design

## Goal

Monthly, weekly, and daily planner views let users move events between `active` and `completed` through the same checkbox interaction used by tasks.

## Scope

- Show a checkbox for task and event items whose status is `active` or `completed`.
- Checking an active item calls `POST /items/{id}/complete`.
- Unchecking a completed item calls `POST /items/{id}/reopen`.
- Keep completed tasks and events visible in monthly, weekly, and daily planner views.
- Preserve the existing pending, duplicate-row synchronization, error, and retry behavior.
- Do not add checkboxes to goals, routines, areas, or projects.

## Service Policy

`TodoService::reopen` accepts completed tasks and completed events. A successful reopen:

- changes the status to `active`;
- clears `completed_at`;
- updates `updated_at`;
- writes a mandatory `reopen` audit event.

Other item types and non-completed source statuses remain policy errors. The existing complete transition already accepts events and requires no broader policy change.

## Frontend Design

The planner completion checkbox becomes a work-item component shared by tasks and events. It continues to use the controller's item-ID keyed transition state so duplicate rows for one item disable, recover, and update together.

Planner visibility treats a completed event like a completed task. Other terminal items remain hidden. A successful API response replaces the canonical workspace item, which updates checkbox state and all duplicate rows without an optimistic status change.

## Error Handling

- Disable every checkbox row for the transitioning item while its request is pending.
- Merge repeated transition requests for the same item.
- Keep the server-backed status when a request fails.
- Show the API policy detail beside every duplicate row and clear it on retry.
- Use a type-neutral fallback message because the component serves tasks and events.

## Testing

- Service integration tests prove completed events reopen to active, clear `completed_at`, and write a `reopen` audit event.
- Service policy tests prove unsupported types and invalid source statuses still fail.
- API end-to-end tests prove `POST /items/{event-id}/reopen` returns an active event.
- Planner model tests prove completed events remain visible in monthly, weekly, and daily views.
- Presentation tests prove event checkboxes render, complete, reopen, avoid opening details, synchronize duplicate rows, and preserve checked state on failure.
- Existing task checkbox tests remain green to guard shared behavior.

## Documentation

Update the lifecycle and API reference language so the documented reopen contract covers completed tasks and events.
