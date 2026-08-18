# Ledger Categories UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the legacy Categories form with an active-only table, accessible creation dialog, editable detail view, and deactivate-only deletion while preserving hierarchy and historical transaction labels.

**Architecture:** Keep the existing transaction-category API and controller mutation contract. Add one service-level active-child guard for deactivation, derive table rows from the controller's active category state, and compose dedicated table, create-dialog, and detail components under `CategoriesPanel`. Reuse the existing Ledger view settings, Accounts interaction patterns, generic detail/modal styles, safe error handling, and server-side kind/cycle validation.

**Tech Stack:** Rust 2024, SQLite, Axum, React 18, TypeScript, Vitest, Testing Library, existing Planner table-view primitives.

---

## Global Constraints

- Deleted means deactivated. Do not add restore, archived browsing, or purge UI.
- Existing entries keep their denormalized `categoryName`; no transaction rewrite is allowed.
- Parent choices contain only active categories of the same kind and exclude the edited category and every descendant.
- The service remains authoritative for type-change, parent-kind, cycle, and active-child constraints.
- Reuse Accounts/Transactions interaction and accessibility patterns; do not introduce a generic master-data framework.
- Every production behavior starts with a failing test and an observed RED result.

### Task 1: Enforce active-child deactivation policy in the Ledger service

**Files:**
- Modify: `ledger-engine/src/application/ports.rs`
- Modify: `ledger-engine/src/infrastructure/sqlite/repository.rs`
- Modify: `ledger-engine/src/application/references.rs`
- Test: `ledger-engine/tests/integration/master_policy_review.rs`

- [ ] **Step 1: Write the failing service test**

Add an integration test that creates an expense parent and active child, attempts to set the parent to inactive, and asserts a conflict without an audit mutation. Then deactivate the child and assert that deactivating the parent succeeds.

```rust
#[test]
fn transaction_category_deactivation_requires_children_to_be_inactive() {
    let mut fixture = Fixture::new();
    let parent = fixture.create_transaction_category("Parent", None, TransactionCategoryKind::Expense);
    let child = fixture.create_transaction_category(
        "Child",
        Some(parent.id().to_string()),
        TransactionCategoryKind::Expense,
    );

    let error = fixture.service.update_category(
        parent.id(),
        UpdateTransactionCategory { active: Some(false), ..update_category() },
    ).unwrap_err();
    assert!(matches!(error, LedgerError::Conflict(message) if message.contains("active children")));

    fixture.service.update_category(
        child.id(),
        UpdateTransactionCategory { active: Some(false), ..update_category() },
    ).unwrap();
    fixture.service.update_category(
        parent.id(),
        UpdateTransactionCategory { active: Some(false), ..update_category() },
    ).unwrap();
}
```

- [ ] **Step 2: Verify RED**

Run: `cargo test -p ledger-engine --test integration master_policy_review::transaction_category_deactivation_requires_children_to_be_inactive`

Expected: FAIL because the current update path allows the parent to be deactivated.

- [ ] **Step 3: Add the smallest repository query and service guard**

Add one port method backed by an indexed existence query:

```rust
fn transaction_category_has_active_children(&self, id: &str) -> LedgerResult<bool>;
```

```sql
SELECT 1
FROM transaction_categories
WHERE parent_id = ?1 AND active = 1
LIMIT 1
```

Guard only the active-to-inactive transition before constructing the updated category:

```rust
let deactivating = before.is_active() && command.active == Some(false);
if deactivating && transaction.transaction_category_has_active_children(id)? {
    return Err(LedgerError::Conflict(format!(
        "transaction category {id} cannot be deactivated while active children exist"
    )));
}
```

- [ ] **Step 4: Verify GREEN and repository coverage**

Run: `cargo test -p ledger-engine --test integration master_policy_review`

Expected: PASS, including existing type immutability and ancestor-cycle tests.

- [ ] **Step 5: Commit the policy unit**

Commit only the four Rust files with `[FIX] Enforce Ledger category deactivation policy`.

### Task 2: Derive active category table rows, filters, sorts, groups, and parent choices

**Files:**
- Create: `frontend/src/features/ledger/model/category-table.ts`
- Create: `frontend/tests/domain/category-table.spec.ts`
- Modify: `frontend/src/features/ledger/model/ledger-table-views.ts`
- Test: `frontend/tests/domain/ledger-table-views.spec.ts`

- [ ] **Step 1: Write focused failing model tests**

Cover active-only projection, parent labels, AND/OR filters, deterministic multi-sort with ID tie-break, kind/parent groups, hidden/manual/reverse group settings, and parent candidates that exclude wrong-kind, inactive, self, and descendants.

```ts
expect(deriveCategoryGroups(categories, settings).flatMap(({ rows }) => rows.map(({ id }) => id)))
  .toEqual(["category-food", "category-salary"]);

expect(categoryParentOptions(categories, "expense", "category-food").map(({ id }) => id))
  .toEqual(["category-living"]);
```

Also assert that the Categories group label is `Type`, not the storage-oriented word `Kind`.

- [ ] **Step 2: Verify RED**

Run: `npm --prefix frontend test -- category-table.spec.ts ledger-table-views.spec.ts`

Expected: FAIL because `category-table.ts` and the final Type label do not exist.

- [ ] **Step 3: Implement the category projection pipeline**

Create these focused exports:

```ts
export type CategoryRow = {
  id: string;
  category: TransactionCategory;
  name: string;
  kind: TransactionCategoryKind;
  kindLabel: "Expense" | "Income";
  parentId: string | null;
  parentLabel: string;
};

export function deriveCategoryGroups(
  categories: readonly TransactionCategory[],
  settings: PlannerTableSettings,
): CategoryRowGroup[];

export function categoryParentOptions(
  categories: readonly TransactionCategory[],
  kind: TransactionCategoryKind,
  editingId?: string,
): TransactionCategory[];
```

Use `effectivePlannerFilterRules`, `matchesPlannerFilterValue`, `ledgerFilterFieldsForScope`, `ledgerSortFieldsForScope`, and `orderVisiblePlannerGroups`; do not duplicate Planner behavior. Compute descendants with a small visited-set walk over `parentId` relationships.

- [ ] **Step 4: Verify GREEN and type safety**

Run:

```powershell
npm --prefix frontend test -- category-table.spec.ts ledger-table-views.spec.ts
npm --prefix frontend run typecheck
```

Expected: both commands exit 0.

- [ ] **Step 5: Commit the model unit**

Commit the model, its tests, and the label correction with `[ADD] Derive Ledger category table groups`.

### Task 3: Add the accessible category creation dialog

**Files:**
- Create: `frontend/src/features/ledger/ui/CategoryCreateDialog.tsx`
- Create: `frontend/tests/presentation/categories-panel.spec.tsx`

- [ ] **Step 1: Write failing creation-dialog tests**

Verify modal isolation, initial focus, Escape/close focus restoration, field order, same-kind parent choices, kind-change parent reset, single-submit pending behavior, exact `createCategory` payload, safe errors, and draft preservation after failure.

```ts
await user.click(screen.getByRole("button", { name: "Add category" }));
expect(screen.getAllByLabelText(/Category name|Category type|Parent category/))
  .toHaveLength(3);
await user.type(screen.getByLabelText("Category name"), "Dining");
await user.selectOptions(screen.getByLabelText("Parent category"), "category-food");
await user.click(screen.getByRole("button", { name: "Add" }));
expect(controller.createCategory).toHaveBeenCalledWith({
  name: "Dining",
  kind: "expense",
  parent: "category-food",
});
```

- [ ] **Step 2: Verify RED**

Run: `npm --prefix frontend test -- categories-panel.spec.tsx`

Expected: FAIL because the Add action and dialog are absent.

- [ ] **Step 3: Implement the dialog using existing modal primitives**

Use `createPortal`, the Accounts dialog focus/inert lifecycle, `safeLedgerErrorMessage`, and `categoryParentOptions`. Keep the draft local:

```ts
type CategoryDraft = {
  name: string;
  kind: TransactionCategoryKind;
  parent: string;
};
```

On kind change, clear `parent` in the same state update. Submit exactly once while pending, close only after a successful controller mutation, and return focus to the Add button.

- [ ] **Step 4: Verify GREEN**

Run: `npm --prefix frontend test -- categories-panel.spec.tsx`

Expected: PASS for the creation-dialog cases.

- [ ] **Step 5: Commit the dialog unit**

Commit the dialog and its tests with `[ADD] Build Ledger category creation dialog`.

### Task 4: Replace the legacy list with the active-only category table

**Files:**
- Create: `frontend/src/features/ledger/ui/CategoriesTable.tsx`
- Modify: `frontend/src/features/ledger/ui/CategoriesPanel.tsx`
- Modify: `frontend/src/features/ledger/ui/LedgerTableViewHeader.tsx`
- Modify: `frontend/tests/presentation/categories-panel.spec.tsx`
- Modify: `frontend/tests/presentation/ledger-panel.spec.tsx`

- [ ] **Step 1: Write failing table, header, selection, and deletion tests**

Cover the exact columns `Category`, `Type`, `Parent category`; active-only rows; grouped empty states; keyboard/click detail activation; stable visible selection/select-all; right-aligned Filter/Sort/Group/Add/Delete actions; sequential selected deletion; partial-failure retention; confirmation target snapshots; and focus restoration.

```ts
expect(screen.getAllByRole("columnheader").map(({ textContent }) => textContent))
  .toEqual(["", "Category", "Type", "Parent category"]);
expect(screen.queryByText("Archived category")).toBeNull();
```

- [ ] **Step 2: Verify RED**

Run: `npm --prefix frontend test -- categories-panel.spec.tsx ledger-panel.spec.tsx`

Expected: FAIL against the legacy inline form and action column.

- [ ] **Step 3: Implement `CategoriesTable` using the Accounts table contract**

```ts
export type CategoriesTableProps = {
  groups: readonly CategoryRowGroup[];
  activeRowCount: number;
  selectedIds: readonly string[];
  onOpen(row: CategoryRow): void;
  onToggle(id: string): void;
  onToggleAll(): void;
};
```

Render semantic rows and checkboxes with category-specific accessible names. Empty copy is `No categories yet.` when there are no active records and `No categories match this view.` when filters hide all rows.

- [ ] **Step 4: Reduce `CategoriesPanel` to a coordinator**

Remove the inline form, restore, and purge paths. Derive the current and default active rows, reconcile stale selection/detail IDs, wire Add and Delete through `LedgerTableViewHeader`, and deactivate selected IDs sequentially with successful IDs removed from selection while failed/unattempted IDs remain selected.

- [ ] **Step 5: Verify GREEN and regressions**

Run:

```powershell
npm --prefix frontend test -- categories-panel.spec.tsx ledger-panel.spec.tsx ledger-form.spec.tsx workbench-wireframe.spec.tsx
npm --prefix frontend run typecheck
```

Expected: all tests and typecheck pass; Transactions and Accounts headers remain unchanged.

- [ ] **Step 6: Commit the table unit**

Commit the table/header/panel behavior with `[UPDATE] Replace Ledger categories list workflow`.

### Task 5: Add editable category detail with local draft history

**Files:**
- Create: `frontend/src/features/ledger/ui/CategoryDetail.tsx`
- Modify: `frontend/src/features/ledger/ui/CategoriesPanel.tsx`
- Modify: `frontend/tests/presentation/categories-panel.spec.tsx`
- Modify: `frontend/tests/presentation/ledger-form.spec.tsx`

- [ ] **Step 1: Write failing detail tests**

Cover Back, local Undo/Redo history, keyboard shortcuts, Save enablement, minimal update payloads, same-kind/non-cyclic parent choices, parent reset after kind change, server conflict draft preservation, delete confirmation, child delete blocking, and historical transaction/category-choice regressions.

```ts
await user.click(screen.getByRole("row", { name: /Open details for Food/ }));
await user.clear(screen.getByLabelText("Category name"));
await user.type(screen.getByLabelText("Category name"), "Meals");
await user.click(screen.getByRole("button", { name: "Save" }));
expect(controller.updateCategory).toHaveBeenCalledWith("category-food", { name: "Meals" });
```

- [ ] **Step 2: Verify RED**

Run: `npm --prefix frontend test -- categories-panel.spec.tsx ledger-form.spec.tsx`

Expected: FAIL because category detail does not exist.

- [ ] **Step 3: Implement category-local history and minimal patches**

Mirror the existing Account detail reducer without extracting a speculative shared abstraction:

```ts
type CategoryDraft = { name: string; kind: TransactionCategoryKind; parent: string };
type DraftHistory = { past: CategoryDraft[]; present: CategoryDraft; future: CategoryDraft[] };
```

Generate only changed fields:

```ts
function categoryUpdate(baseline: CategoryDraft, draft: CategoryDraft): Partial<TransactionCategoryInput> {
  return {
    ...(baseline.name !== draft.name ? { name: draft.name } : {}),
    ...(baseline.kind !== draft.kind ? { kind: draft.kind } : {}),
    ...(baseline.parent !== draft.parent ? { parent: draft.parent || null } : {}),
  };
}
```

Preserve the draft on rejected saves, reset history only after a successful save, and use `archiveCategory` for Delete. Disable Delete in the UI when an active child exists while retaining the service guard from Task 1.

- [ ] **Step 4: Verify GREEN and complete frontend behavior**

Run:

```powershell
npm --prefix frontend test -- category-table.spec.ts categories-panel.spec.tsx ledger-panel.spec.tsx ledger-form.spec.tsx ledger-table-views.spec.ts workbench-wireframe.spec.tsx
npm --prefix frontend run typecheck
npm --prefix frontend run build
```

Expected: all commands exit 0.

- [ ] **Step 5: Commit the detail unit**

Commit the detail integration and tests with `[ADD] Build Ledger category detail workflow`.

### Task 6: Verify SHI-71 and synchronize final-state documentation

**Files:**
- Inspect: `README.md`
- Inspect: `AGENTS.md`
- Inspect: `CLAUDE.md`
- Inspect: `docs/architecture/data-model.md`
- Inspect: `docs/operations/api-reference.md`
- Modify only if stale: the files above

- [ ] **Step 1: Run complete quality gates**

Run:

```powershell
cargo fmt --check
cargo test --workspace
cargo clippy --all-targets --all-features -- -D warnings
npm --prefix frontend test
npm --prefix frontend run typecheck
npm --prefix frontend run build
git diff --check
```

Expected: every command exits 0 with no failed tests or lint errors.

- [ ] **Step 2: Audit requirements against the final diff**

Confirm active-only display and choices, exact table fields, saved-view isolation, accessible modal/detail/table behavior, hierarchy restrictions, server conflicts, deactivate-only deletion, historical labels, and the absence of restore/purge UI.

- [ ] **Step 3: Run the docs-change-updater workflow**

Inspect the final code diff and stable docs. Update only current-state documentation made stale by the change; do not add roadmap or implementation-history text. If no stable docs are stale, record that no docs edit is required.

- [ ] **Step 4: Commit any docs-only correction**

If documentation changed, commit it separately with `[DOCS] Update Ledger category management docs`. Otherwise make no empty commit.

- [ ] **Step 5: Update Linear**

Add the plan path, commit range, verification evidence, and any remaining caveat to SHI-71, then move it to Done. Keep the issue assigned to the current user and attached to `Raven Ledger 실사용 UX`.

## Completion Checklist

- [ ] Categories shows only active Category, Type, and Parent category rows.
- [ ] Filters, sorts, groups, and saved views affect only `ledger.categories`.
- [ ] Add and detail parent choices are active, same-kind, and non-cyclic.
- [ ] Invalid type changes and other safe server errors preserve the detail draft.
- [ ] Active children block deletion in both UI and service policy.
- [ ] Single and selected Delete deactivate categories; no restore or purge UI remains.
- [ ] Historical transactions retain their category labels while new transactions omit inactive categories.
- [ ] Modal isolation, focus restoration, keyboard row activation, shortcuts, confirmations, and partial failures are verified.
- [ ] Rust and frontend quality gates pass.
- [ ] Linear SHI-71 contains final verification and commit evidence.
