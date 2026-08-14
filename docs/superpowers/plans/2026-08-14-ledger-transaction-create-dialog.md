# Ledger Transaction Create Dialog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the inline Ledger transaction creation form with an accessible Add dialog for Expense, Income, and Transfer while preserving the existing application-service mutation boundaries.

**Architecture:** Keep `TransactionForm` as the single form implementation used by Ledger and Quick Add, but give its creation path the three approved modes and derive currency from the selected account. Add one Ledger-owned modal wrapper using the existing modal-isolation pattern, then connect an optional Add action to the shared Ledger table header. No backend or API contract changes are needed.

**Tech Stack:** React 18, TypeScript, existing Raven Ledger controller/API, Testing Library, Vitest.

---

### Task 1: Make transaction creation match the approved fields and payloads

**Files:**
- Modify: `frontend/src/features/ledger/ui/TransactionForm.tsx`
- Modify: `frontend/tests/presentation/ledger-form.spec.tsx`

- [ ] **Step 1: Write failing creation-form tests**

Add tests that render `TransactionForm` without an `entry` and assert:

```tsx
expect(screen.getByRole("tab", { name: "Expense" })).toHaveAttribute("aria-selected", "true");
expect(screen.getByRole("tab", { name: "Income" })).toBeInTheDocument();
expect(screen.getByRole("tab", { name: "Transfer" })).toBeInTheDocument();
expect(screen.queryByLabelText("Written at")).not.toBeInTheDocument();
expect(screen.queryByLabelText("Currency")).not.toBeInTheDocument();
```

Exercise Expense and Income separately, select `account-cash`, and verify `createEntry` receives the account's `currencyId`, the selected public entry type, and a generated RFC3339 `writtenAt`. Exercise Transfer and verify `transfer` receives the source account's currency and distinct source/destination accounts. Assert the visible label order by comparing the labels returned from the creation form.

- [ ] **Step 2: Run the focused test and confirm the old form fails**

Run:

```powershell
npm --prefix frontend test -- ledger-form.spec.tsx
```

Expected: FAIL because the current form exposes Entry/Transfer, Written at, Currency, and balance-adjustment types.

- [ ] **Step 3: Implement the minimum creation-mode model**

In `TransactionForm.tsx`, use:

```ts
type CreationMode = "expense" | "income" | "transfer";
```

For creation only, render an accessible tablist with Expense, Income, and Transfer. Render fields in the exact approved order. Remove adjustment choices, hide `writtenAt` and `currency`, generate `new Date().toISOString()` during submission, and resolve currency with:

```ts
function accountCurrencyId(controller: LedgerController, accountId: string): string {
  return controller.state.accounts.find(({ id, active }) => active && id === accountId)
    ?.currencyId ?? "";
}
```

Expense and Income call `controller.createEntry`; Transfer calls only `controller.transfer`. Keep the existing `entry` editing branch unchanged for SHI-72.

- [ ] **Step 4: Run the focused form tests**

Run:

```powershell
npm --prefix frontend test -- ledger-form.spec.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit the form behavior**

```powershell
git add frontend/src/features/ledger/ui/TransactionForm.tsx frontend/tests/presentation/ledger-form.spec.tsx
git commit -m "[UPDATE] Refine Ledger transaction creation fields"
```

### Task 2: Open creation from an isolated Transactions dialog

**Files:**
- Create: `frontend/src/features/ledger/ui/TransactionCreateDialog.tsx`
- Modify: `frontend/src/features/ledger/ui/LedgerTableViewHeader.tsx`
- Modify: `frontend/src/features/ledger/ui/LedgerPanel.tsx`
- Modify: `frontend/tests/presentation/ledger-panel.spec.tsx`

- [ ] **Step 1: Write failing dialog interaction tests**

In `ledger-panel.spec.tsx`, assert that Transactions initially has no creation form, its `Add transaction` button opens a modal named `Add transaction`, and successful submission closes it after the controller promise resolves. Add tests proving:

```tsx
expect(screen.getByRole("dialog", { name: "Add transaction" })).toBeInTheDocument();
expect(screen.getByRole("button", { name: "Close Add transaction" })).toBeDisabled();
await user.keyboard("{Escape}");
expect(screen.getByRole("dialog", { name: "Add transaction" })).toBeInTheDocument();
```

The close assertions run while submission is pending. Also verify a rejected mutation keeps the dialog and entered draft open, Escape closes only when idle, focus returns to the Add button, and Tab/Shift+Tab stay within the dialog.

- [ ] **Step 2: Run the focused panel tests and confirm failure**

Run:

```powershell
npm --prefix frontend test -- ledger-panel.spec.tsx
```

Expected: FAIL because creation is inline and the Transactions header has no Add action.

- [ ] **Step 3: Add the Ledger-owned dialog wrapper**

Create `TransactionCreateDialog.tsx` with props:

```ts
type TransactionCreateDialogProps = {
  controller: LedgerController;
  onClose: () => void;
  returnFocusRef: React.RefObject<HTMLButtonElement | null>;
};
```

Reuse `useModalIsolation`, `.confirmation-backdrop`, and `.confirmation-dialog`. Track `pending` from `TransactionForm.onPendingChange`; while pending, disable Close and ignore Escape. Trap Tab focus using the same focusable selector as `QuickAddDialog`. Call `onClose` only from an idle dismissal or `TransactionForm.onSaved`, and restore focus to `returnFocusRef` on unmount.

- [ ] **Step 4: Connect the Transactions Add action**

Extend `LedgerTableViewHeader` with optional props:

```ts
onAdd?: () => void;
addButtonRef?: React.RefObject<HTMLButtonElement | null>;
```

Render `Add transaction` after `TableViewControls` only when `onAdd` is provided. In `TransactionsPanel`, keep `dialogOpen` and an Add-button ref, remove the always-visible creation form, render `TransactionCreateDialog` when open, and retain the existing edit form temporarily for SHI-72.

- [ ] **Step 5: Run focused Ledger presentation tests**

Run:

```powershell
npm --prefix frontend test -- ledger-form.spec.tsx ledger-panel.spec.tsx quick-add.spec.tsx
```

Expected: PASS, including Quick Add reuse.

- [ ] **Step 6: Commit the dialog integration**

```powershell
git add frontend/src/features/ledger/ui/TransactionCreateDialog.tsx frontend/src/features/ledger/ui/LedgerTableViewHeader.tsx frontend/src/features/ledger/ui/LedgerPanel.tsx frontend/tests/presentation/ledger-panel.spec.tsx
git commit -m "[ADD] Open Ledger transaction creation dialog"
```

### Task 3: Verify the delivered SHI-66 boundary

**Files:**
- Modify only if behavior documentation is stale: `docs/superpowers/specs/2026-08-13-ledger-transactions-ux-design.md`

- [ ] **Step 1: Run all frontend tests**

```powershell
npm --prefix frontend test
```

Expected: all tests pass.

- [ ] **Step 2: Run typecheck and production build sequentially**

```powershell
npm --prefix frontend run typecheck
npm --prefix frontend run build
```

Expected: both commands exit 0.

- [ ] **Step 3: Inspect the final diff**

```powershell
git status --short
git diff --check
git diff --stat
```

Confirm there is no lockfile churn, no backend/API change, no balance-adjustment creation option, and no unrelated Accounts, Categories, Reports, or transaction-detail work.

- [ ] **Step 4: Update documentation only if implementation changed the approved behavior**

Run the repository docs updater. If the code matches the existing Transactions UX design exactly, leave stable docs unchanged.

