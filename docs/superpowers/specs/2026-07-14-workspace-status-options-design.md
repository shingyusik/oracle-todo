# Workspace Status Options Design

**Date:** 2026-07-14
**Status:** Approved for implementation planning
**Scope:** Make Workspace status selectors stable by item type while preserving the engine's full status lifecycle.

## Goal

Workspace status selectors expose a small, predictable set of user-facing states. The option list depends only on the item type, never on the item's stored status or on other loaded data.

| Item type | Visible status options |
| --- | --- |
| Task | `active`, `completed` |
| Area | `active`, `archived` |
| Project | `active`, `paused`, `completed` |
| Routine | `active`, `paused`, `completed` |
| Event | `active`, `paused`, `completed` |
| Goal | `active`, `paused`, `completed` |

Inline table selectors and detail selectors use the same ordered options.

## Display Mapping

The engine remains the source of truth for the full `ItemStatus` lifecycle. Workspace presentation maps stored states into the smaller visible vocabulary without writing the mapped value back to SQLite.

- Task: `completed` displays as `completed`; every other stored state displays as `active`.
- Area: `archived` displays as `archived`; every other stored state displays as `active`.
- Project, Routine, Event, and Goal: `paused` and `completed` display unchanged; every other stored state displays as `active`.
- In particular, `proposed`, `approved`, and `waiting` display as `active` where applicable.

The mapping is presentation-only. Loading an item never mutates its stored status, approval markers, timestamps, or audit history.

## Interaction and Data Flow

`MainPanel` owns one type-based status profile used by both Workspace table rows and detail views.

1. The API returns the stored item status unchanged.
2. The selector derives its displayed value from the presentation mapping.
3. The selector renders the complete fixed option list for the item type.
4. Selecting a different visible state resolves through the existing transition action mapping.
5. The controller calls the existing service-backed transition endpoint.
6. The refreshed item retains the status returned by the engine.

No direct status PATCH, repository write, or client-side mutation bypasses `TodoService`.

## Policy and Error Handling

- Rust service policy remains unchanged and continues to validate every transition.
- Agent-created items retain their stored `proposed` state and approval requirements.
- User-created items retain their stored `approved` state until a real transition occurs.
- A rejected transition follows the existing controller error path; the selector does not fabricate a successful state.
- Area continues to expose `archived` instead of unsupported `paused` or `completed` actions.

## Component Boundaries

- `MainPanel.tsx` defines the fixed type-to-options mapping and stored-to-visible status mapping.
- `StatusSelect` and `DetailStatusField` consume the same helpers.
- `useWorkbenchController` keeps its existing transition request behavior.
- Rust domain, application service, API, CLI, and SQLite schema remain unchanged.

## Testing Strategy

Presentation tests use items with different stored statuses to prove that options remain stable:

- Task always exposes `active`, `completed`.
- Area always exposes `active`, `archived`.
- Project, Routine, Event, and Goal always expose `active`, `paused`, `completed`.
- `proposed` and `approved` items display as `active` without changing the API fixture.
- Inline and detail selectors expose the same options and displayed value.
- Selecting a different visible state still calls the expected existing transition endpoint.

Verification commands:

```bash
cd frontend
npm run test
npm run typecheck
npm run build
```

## Out of Scope

- Changes to the Rust `ItemStatus` enum or transition state machine.
- Database migrations or stored-status normalization.
- New transition endpoints or multi-step approval/activation requests.
- Status option changes outside the Workspace table and detail selectors.

## Success Criteria

- The same item type always shows the same ordered status options across data homes and stored states.
- Table and detail status selectors agree.
- Only the three documented type profiles are visible.
- Stored `proposed`, `approved`, and `waiting` states remain intact until the user performs a supported transition.
- Existing service policy, approval gates, audit events, and verification gates remain intact.
