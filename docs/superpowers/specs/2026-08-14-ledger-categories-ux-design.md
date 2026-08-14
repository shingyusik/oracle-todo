# Ledger Categories UX Design

## Goal

Manage expense and income categories in one compact table while preserving category hierarchy
and the meaning of historical transactions.

## Categories Table

The Categories tab uses the shared ToDo table structure with saved views on the left and
filter, sort, group, add, and delete actions on the right.

The default columns are Category, Type, and Parent category. Expense and income categories
share the table and can be separated through view controls.

Supported view controls are:

- Filters: category name, type, and parent category
- Sorts: category name, type, and parent category
- Groups: type and parent category

Deleted categories never appear in the table or new-transaction choices.

## Category Creation

The Add action opens a modal with this field order:

1. Category name
2. Type: expense or income
3. Optional parent category

Only active categories with the same type can be selected as the parent.

## Category Detail

The detail header follows ToDo: Back, Undo, Redo, Save, and Delete. Category name, type, and
parent category are editable.

A type change is accepted only when existing transactions and child categories remain
consistent. A category with children cannot be deleted until its children are moved or
deleted.

Deleting a category deactivates it and removes it from current management and creation
surfaces. Transactions that already reference it retain the category name in historical
views.

## Verification

- combined expense and income rows render with compact columns;
- filters, sorts, groups, and saved views use only category fields;
- parent choices are active, same-type, and non-cyclic;
- invalid type changes are rejected without losing the detail draft;
- deletion is blocked while children exist;
- used categories can be deactivated without changing historical transaction labels;
- inactive categories remain absent from Categories and creation choices.

## Non-Goals

- Separate expense and income screens
- Automatic child deletion or reparenting
- Automatic reassignment of historical transactions
- Archived-category browser, restore UI, or permanent-purge UI
