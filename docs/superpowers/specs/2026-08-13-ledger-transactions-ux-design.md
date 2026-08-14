# Ledger Transactions UX Design

## Goal

Make Ledger transaction entry and review follow the established ToDo Tasks interaction
model: a configurable table for browsing, a modal for creation, and a dedicated detail view
for editing.

## Scope

- Transactions table and saved views
- Transaction creation dialog
- Transaction detail view
- Transaction archive behavior
- Expense, income, and transfer presentation

Accounts, Categories, and Reports are separate design work.

## Transactions Table

Ledger opens to the Transactions table. The default view includes every active transaction,
uses descending transaction date order, and applies no grouping.

The table header follows the ToDo Tasks layout:

- Saved-view tabs and their menu appear on the left.
- Filter, sort, group, add, and delete actions appear together on the right.
- Active filter, sort, and group settings can be saved as named views.
- Row selection and select-all use checkboxes.
- The delete action is disabled when no row is selected.

The default columns are:

1. Date
2. Content
3. Account
4. Category
5. Amount

Income amounts use a leading plus sign and the existing positive color. Expense amounts use
a leading minus sign and the existing negative color. Transfers use a neutral color and no
directional sign.

A transfer pair renders as one logical row rather than separate transfer-out and transfer-in
rows. Its Account cell uses `source account → destination account`; its Category cell is
empty.

Clicking or keyboard-activating a row opens its transaction detail view.

## Table Controls

### Filters

- Date range
- Transaction type: expense, income, or transfer
- Account
- Category
- Amount range
- Content text

Archived transactions are not a filter option and never appear in the Transactions UI.

### Sort fields

- Date
- Content
- Account
- Category
- Amount
- Updated time

### Group fields

- Month
- Week
- Day
- Account
- Category
- Transaction type

Filter, sort, group, saved-view, focus, keyboard, and menu behavior match the existing ToDo
table controls wherever the interaction is shared.

## Transaction Creation Dialog

The Add action opens a modal dialog with three tabs:

- Expense
- Income
- Transfer

Expense and Income use this field order:

1. Date
2. Content
3. Account
4. Category
5. Amount
6. Note

Transfer uses this field order:

1. Date
2. Content
3. Source account
4. Destination account
5. Amount
6. Note

Date defaults to the user's local current date. Currency is derived from the selected
account and is not shown as an input. The written timestamp is generated automatically at
submission. Transfer account choices must resolve to a valid single-currency transfer under
existing Ledger service policy.

Balance adjustments are not available in this dialog.

Successful submission closes the dialog, refreshes the table, and displays the new logical
transaction. A failed submission keeps the dialog and entered values open and displays a
safe inline error. While submission is pending, duplicate submission and dialog dismissal
are disabled.

## Transaction Detail View

The detail view follows the ToDo detail layout and header interaction:

- Back
- Undo
- Redo
- Save
- Delete

Undo and Redo affect only the unsaved in-memory draft. Save persists the draft through the
Ledger application service. Delete uses the same trash icon and confirmation pattern as
ToDo, but executes the existing recoverable Ledger archive operation.

Expense and Income details expose only user-facing fields:

- Content
- Date
- Type
- Account
- Category
- Amount
- Currency
- Note

Transfer details expose source and destination accounts in place of a single account and do
not expose a category.

Audit history, internal IDs, source metadata, and written timestamps are not shown. Permanent
purge and restore are not available in the UI.

## Archive Behavior

The table archive action archives every selected logical transaction after confirmation. A
selected transfer archives its paired entries as one operation.

Archived transactions disappear from all Ledger UI views immediately. The UI provides no
archived-items view, restore action, or permanent-purge action. Existing backend lifecycle
and audit records remain intact for diagnostics and controlled recovery.

## Reuse Boundaries

Reuse the existing ToDo table-view controls, saved-view interaction, row selection pattern,
detail header, draft-history behavior, modal isolation, focus restoration, and confirmation
patterns. Ledger supplies its own fields, grouping rules, row model, mutation calls, and
money formatting.

Existing Ledger API and application-service methods remain the mutation boundary. UI code
must not bypass Ledger application policy or reconstruct transfer mutations from individual
entry writes.

## Verification

Presentation and model tests cover:

- default all-active, date-descending, ungrouped view;
- filter, sort, group, and saved-view behavior for Ledger fields;
- right-aligned header action order matching the ToDo Tasks pattern;
- compact columns and signed amount presentation;
- one logical row per transfer pair;
- add-dialog tabs, field order, date default, and derived currency;
- successful creation refreshing the table and failed creation preserving the draft;
- row and keyboard navigation into detail;
- detail Undo, Redo, Save, and Delete/archive behavior;
- bulk archive, including atomic treatment of transfer pairs;
- archived transactions remaining absent from every Ledger UI view;
- accessible modal focus containment, action labels, confirmations, and focus restoration.

Run the frontend unit tests, TypeScript typecheck, and production build. Run Ledger and Raven
API tests when transfer projection or archive behavior changes.

## Non-Goals

- Account, Category, or Report screen redesign
- Budgeting or recurring transactions
- Balance-adjustment entry in the standard creation dialog
- Audit-history UI
- Archived-transaction browser
- Restore or permanent-purge UI
- Changes to Ledger audit retention or service-layer mutation policy
