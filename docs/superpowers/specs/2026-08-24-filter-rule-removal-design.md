# Filter Rule Removal Design

## Goal

Allow users to remove one incorrect or obsolete table filter rule without deleting every rule. The behavior applies consistently to ToDo, Ledger, and Health tables through their shared table controls.

## Interaction

- Each populated filter row ends with an always-visible X button, matching the existing sort-rule removal control.
- The button removes only the rule identified by that row's stable rule ID.
- Removing the final rule returns the filter panel to its existing empty state with the Add filter rule action.
- Removal is immediate and does not show a confirmation dialog because table settings remain editable and the action affects presentation state only.
- Each button has an accessible name in the form `Remove <field label> filter rule`.
- The existing Delete filter action remains available for clearing every rule at once.

## Implementation Boundary

The change belongs in the shared `TableViewControls` filter row. Every ToDo, Ledger, and Health Journal table that uses the shared controls receives the action without a domain-specific opt-in. It updates the existing adapter settings with `filterRules` excluding the selected ID. No domain controller, API contract, persistence format, or table-specific component changes are required.

## Verification

A shared UI regression test will verify that removing one rule preserves its siblings and that removing the final rule shows the empty filter picker. Existing ToDo, Ledger, and Health consumers inherit the behavior from the shared component.
