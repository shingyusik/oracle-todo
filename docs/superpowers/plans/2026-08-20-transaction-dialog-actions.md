# Ledger Creation Dialog Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Add transaction, Add account, and Add category consistent compact footer actions while making the selected transaction type obvious.

**Architecture:** Keep each existing dialog and form responsible for its own pending and submission state. Reuse two CSS classes for the action footer and primary Save button; only `TransactionForm` receives an optional close callback because its form is separate from its dialog shell.

**Tech Stack:** React 18, TypeScript, CSS, Vitest, Testing Library

---

### Task 1: Define the three creation-dialog contracts

**Files:**
- Modify: `frontend/tests/presentation/ledger-form.spec.tsx`
- Modify: `frontend/tests/presentation/ledger-panel.spec.tsx`
- Modify: `frontend/tests/presentation/accounts-panel.spec.tsx`
- Modify: `frontend/tests/presentation/categories-panel.spec.tsx`

- [ ] **Step 1: Require a unified transaction Save label and selected segment**

Replace creation-form queries for `Save transaction` and `Save transfer` with `Save`. In the creation-field test add:

```tsx
expect(tabs).toHaveClass("transaction-type-tabs");
expect(within(tabs).getByRole("tab", { name: "Expense" }))
  .toHaveClass("transaction-type-tab");
expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
```

- [ ] **Step 2: Require grouped actions in the transaction dialog**

After opening the dialog, add:

```tsx
const dialog = screen.getByRole("dialog", { name: "Add transaction" });
expect(within(dialog.querySelector("header")!).queryByRole("button")).toBeNull();
const close = within(dialog).getByRole("button", { name: "Close Add transaction" });
expect(close.parentElement).toHaveClass("ledger-create-dialog-actions");
expect(within(close.parentElement!).getByRole("button", { name: "Save" }))
  .toBeInTheDocument();
```

Update pending tests to click `Save` and retain the assertion that `Close Add transaction` is disabled until saving and refresh complete.

- [ ] **Step 3: Require grouped actions in Account and Category dialogs**

In each dialog's field-order test, assert its header has no button and its Close button shares a footer with Save:

```tsx
const close = within(dialog).getByRole("button", { name: "Close Add account" });
expect(close.parentElement).toHaveClass("ledger-create-dialog-actions");
expect(within(close.parentElement!).getByRole("button", { name: "Save" }))
  .toBeInTheDocument();
```

Use `Close Add category` for the Category equivalent. Replace creation queries for `Create account` and `Add` with `Save`, retaining pending-state assertions for disabled Close and duplicate-submission prevention.

- [ ] **Step 4: Run focused tests and verify failure**

Run:

```powershell
npm --prefix frontend test -- --run tests/presentation/ledger-form.spec.tsx tests/presentation/ledger-panel.spec.tsx tests/presentation/accounts-panel.spec.tsx tests/presentation/categories-panel.spec.tsx
```

Expected: FAIL because the headers still contain Close, submit labels differ, and the new scoped classes do not exist.

- [ ] **Step 5: Commit the tests**

```powershell
git add frontend/tests/presentation/ledger-form.spec.tsx frontend/tests/presentation/ledger-panel.spec.tsx frontend/tests/presentation/accounts-panel.spec.tsx frontend/tests/presentation/categories-panel.spec.tsx
git commit -m "[UPDATE] Define Ledger creation dialog actions"
```

### Task 2: Implement Transaction dialog actions and type segments

**Files:**
- Modify: `frontend/src/features/ledger/ui/TransactionCreateDialog.tsx`
- Modify: `frontend/src/features/ledger/ui/TransactionForm.tsx`
- Modify: `frontend/src/styles/globals.css`

- [ ] **Step 1: Move the transaction Close action into its form**

Remove the header Close button and pass the existing callback:

```tsx
<header className="dashboard-widget-header">
  <h2>Add transaction</h2>
</header>
<TransactionForm
  controller={controller}
  onClose={onClose}
  onSaved={onClose}
  onPendingChange={setPending}
/>
```

- [ ] **Step 2: Extend TransactionForm without changing other callers**

Add and destructure the optional callback:

```tsx
type TransactionFormProps = {
  controller: LedgerController;
  entry?: LedgerEntryView | null;
  onClose?: () => void;
  onSaved?: () => void;
  onPendingChange?: (pending: boolean) => void;
};
```

Set the tablist class to `transaction-type-tabs` and each tab class to `items-toolbar-button transaction-type-tab`.

- [ ] **Step 3: Render the transaction action footer**

Replace the standalone submit button with:

```tsx
<div className="ledger-create-dialog-actions">
  {onClose && (
    <button
      type="button"
      className="items-toolbar-button"
      aria-label="Close Add transaction"
      disabled={pending || refreshRecovery}
      onClick={onClose}
    >
      Close
    </button>
  )}
  <button
    type="submit"
    className="items-toolbar-button ledger-create-dialog-save"
    disabled={pending || refreshRecovery}
  >
    {refreshRecovery ? "Saved" : pending ? "Saving…" : entry ? "Save transaction" : "Save"}
  </button>
</div>
```

Leave Retry refresh immediately after the footer.

- [ ] **Step 4: Add the shared and transaction-only styles**

Add near `.confirmation-dialog`:

```css
.transaction-type-tabs {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 4px;
  padding: 4px;
  border-radius: var(--radius-md);
  background: var(--color-canvas-cream);
}

.transaction-type-tab {
  border-color: transparent;
  background: transparent;
}

.transaction-type-tab[aria-selected="true"] {
  border-color: var(--color-accent-strong);
  background: var(--color-accent-soft);
  color: var(--color-accent-strong);
  font-weight: 700;
}

.ledger-create-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--color-hairline-light);
}

.ledger-create-dialog-actions > button {
  width: 88px;
}

.ledger-create-dialog-save {
  border-color: var(--color-accent-strong);
  background: var(--color-accent-strong);
  color: var(--color-on-dark);
}
```

- [ ] **Step 5: Run Transaction tests**

Run:

```powershell
npm --prefix frontend test -- --run tests/presentation/ledger-form.spec.tsx tests/presentation/ledger-panel.spec.tsx
```

Expected: both files PASS.

- [ ] **Step 6: Commit the Transaction implementation**

```powershell
git add frontend/src/features/ledger/ui/TransactionCreateDialog.tsx frontend/src/features/ledger/ui/TransactionForm.tsx frontend/src/styles/globals.css
git commit -m "[UPDATE] Improve transaction creation dialog"
```

### Task 3: Apply the shared footer to Account and Category

**Files:**
- Modify: `frontend/src/features/ledger/ui/AccountCreateDialog.tsx`
- Modify: `frontend/src/features/ledger/ui/CategoryCreateDialog.tsx`

- [ ] **Step 1: Move Account actions to the form footer**

Leave only the `Add account` heading in the header. Replace the standalone submit button with:

```tsx
<div className="ledger-create-dialog-actions">
  <button
    type="button"
    className="items-toolbar-button"
    aria-label="Close Add account"
    disabled={pending}
    onClick={onClose}
  >
    Close
  </button>
  <button
    type="submit"
    className="items-toolbar-button ledger-create-dialog-save"
    disabled={pending}
  >
    {pending ? "Saving…" : "Save"}
  </button>
</div>
```

- [ ] **Step 2: Move Category actions to the form footer**

Leave only the `Add category` heading in the header and use the same markup with `aria-label="Close Add category"`.

- [ ] **Step 3: Run Account and Category tests**

Run:

```powershell
npm --prefix frontend test -- --run tests/presentation/accounts-panel.spec.tsx tests/presentation/categories-panel.spec.tsx
```

Expected: both files PASS.

- [ ] **Step 4: Commit Account and Category implementation**

```powershell
git add frontend/src/features/ledger/ui/AccountCreateDialog.tsx frontend/src/features/ledger/ui/CategoryCreateDialog.tsx
git commit -m "[UPDATE] Align Ledger creation dialog actions"
```

### Task 4: Verify the frontend

**Files:**
- Verify only

- [ ] **Step 1: Run all frontend tests**

Run: `npm --prefix frontend test`

Expected: PASS.

- [ ] **Step 2: Run TypeScript checks**

Run: `npm --prefix frontend run typecheck`

Expected: exit code 0.

- [ ] **Step 3: Build the static frontend**

Run: `npm --prefix frontend run build`

Expected: exit code 0 and `frontend/out` regenerated successfully.

- [ ] **Step 4: Inspect repository state**

Run: `git status --short`

Expected: no unexpected tracked changes.
