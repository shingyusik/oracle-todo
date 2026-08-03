# ToDo-Only Dashboard Design

## Goal

Restore the Dashboard to its original ToDo-focused presentation while Ledger and Health
Journal input workflows stabilize. Ledger and Health remain fully available from their own
navigation areas; only their Dashboard presentation is removed.

## User Experience

The Dashboard shows only the existing ToDo analytics:

- Today's work
- Completion history
- Area status
- Project status

The Dashboard does not show Today's Plan, Cash Flow, Health Journal summary, or Recent
Activity cards. Loading and error states refer only to the ToDo workspace-item data needed
by these four analytics.

## Architecture

`DashboardPanel` returns to a single ToDo data path. It derives all Dashboard models from
`controller.workspaceItems.allItems` through `buildDashboardSnapshot` and
`dashboardWidgets`.

The panel no longer fetches `/api/v1/dashboard`, stores unified Dashboard state, or imports
the Ledger, Health, and recent-activity cards. The composed Dashboard API, its decoder,
domain models, and card components remain unchanged so they can be reused when the
non-ToDo projections are ready to return.

## Data and Error Flow

The Workbench controller continues loading ToDo items through the authenticated ToDo API.
While those items load, the existing Dashboard skeleton is shown. If the ToDo item load
fails, the existing Dashboard analytics error and `Retry Dashboard` action remain.

Ledger or Health storage availability cannot create a Dashboard loading or error state,
because the Dashboard no longer requests their combined projection.

## Testing

Presentation tests will prove that:

- the four ToDo analytics still render;
- Today's Plan, Cash Flow, Health Journal summary, and Recent Activity do not render;
- opening the Dashboard does not request `/api/v1/dashboard`;
- the ToDo loading, error, navigation, date-range, and status-card behavior remains intact.

Existing standalone model and component tests for the composed Dashboard API and dormant
cards remain in place unless they directly assume `DashboardPanel` renders those cards.

## Non-Goals

- No Ledger or Health input, route, API, database, or lifecycle change.
- No removal or redesign of `/api/v1/dashboard`.
- No feature flag or configuration switch.
- No deletion of reusable Ledger, Health, recent-activity, or unified Dashboard modules.
