# Root Category Parent Label Design

## Goal

Load root transaction categories in the Categories table when the API returns no parent.

## Behavior

- A category with `parent_id: null` is a root category.
- The frontend maps its empty `parent_label` to the existing display label `No parent`.
- A non-root category still requires a non-empty `parent_label`; malformed linked-parent data remains an error.
- API and storage contracts remain unchanged.

## Implementation

Update the shared category table-record mapper so every Categories-table consumer receives the normalized label. Add one mapper regression test covering the root-category wire shape.

## Verification

- Run the focused frontend domain test.
- Run the frontend type checker.
