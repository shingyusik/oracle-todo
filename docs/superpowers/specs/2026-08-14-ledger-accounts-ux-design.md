# Ledger Accounts UX Design

## Goal

Make current account balances easy to review while keeping account and reference-data
management consistent with the ToDo table and detail interactions.

## Accounts Table

The Accounts tab uses the shared ToDo table structure:

- saved-view tabs on the left;
- filter, sort, group, settings, add, and delete actions on the right;
- row and select-all checkboxes;
- row activation opens account details.

The default columns are Account, Account type, and Current balance.

Supported view controls are:

- Filters: account name, account type, currency, and current-balance range
- Sorts: account name, account type, and current balance
- Groups: account type and currency

Deleted accounts never appear in Ledger UI views.

## Account Creation

The Add action opens a modal with this field order:

1. Account name
2. Account type
3. Currency
4. Opening balance

Successful submission closes the modal and refreshes the table. Failed submission preserves
the draft and displays a safe inline error.

## Account Detail

The detail header follows ToDo: Back, Undo, Redo, Save, and Delete.

Account name, account type, currency, and opening balance are editable. Current balance is a
read-only calculated value. Delete requires confirmation, deactivates the account through
the Ledger service, and removes it from every UI view.

## Account Settings

The Settings action opens one modal with Account types and Currencies tabs. Each tab supports
list, add, edit, and delete actions.

Account type fields are:

- Name
- Parent account type
- Liability flag

Currency fields are:

- Code
- Name
- Symbol
- Decimal places

Deleting account types or currencies uses the existing deactivate operation. Inactive
reference data is absent from tables and creation choices.

## Verification

- compact columns and current balances render correctly;
- Ledger filters, sorts, groups, and saved views remain independently scoped;
- creation and detail editing preserve drafts on error;
- current balance is never directly editable;
- settings tabs manage every supported account-type and currency field;
- inactive accounts and reference data remain absent from Ledger UI views;
- modal isolation, keyboard access, confirmations, and focus restoration match ToDo.

## Non-Goals

- Total-asset dashboard or account-allocation charts
- Exchange-rate conversion
- Archived-account browser or restore UI
- Permanent-purge UI
