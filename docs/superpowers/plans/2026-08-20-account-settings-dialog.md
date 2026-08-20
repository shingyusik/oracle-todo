# Account Settings Dialog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Account settings clear segmented tabs and a unified compact Close/Save footer without changing its data or lifecycle behavior.

**Architecture:** Keep `AccountSettingsDialog` and its two local form components intact. Use native HTML `form` IDs to let one footer Save button submit the active form, and reuse the existing Ledger dialog action classes instead of adding a component or state layer.

**Tech Stack:** React 18, TypeScript, CSS, Vitest, Testing Library

---

### Task 1: Define the Account settings presentation contract

**Files:**
- Modify: `frontend/tests/presentation/ledger-panel.spec.tsx`

- [ ] **Step 1: Require the segmented tabs, form headings, and footer**

In the Account settings structure test, assert:

```tsx
const dialog = screen.getByRole("dialog", { name: "Account settings" });
expect(within(dialog.querySelector("header")!).queryByRole("button")).toBeNull();

const tabs = within(dialog).getByRole("tablist", { name: "Account settings sections" });
expect(tabs).toHaveClass("ledger-account-settings-tabs");
for (const tab of within(tabs).getAllByRole("tab")) {
  expect(tab).toHaveClass("ledger-account-settings-tab");
}

expect(within(dialog).getByRole("heading", { name: "New account type" }))
  .toBeInTheDocument();
const close = within(dialog).getByRole("button", { name: "Close" });
const actions = close.parentElement!;
expect(actions).toHaveClass("ledger-create-dialog-actions");
const save = within(actions).getByRole("button", { name: "Save" });
expect(save).toHaveClass("ledger-create-dialog-save");
expect(save).toHaveAttribute("form", "account-settings-account-type-form");
```

After selecting Currencies, require `New currency` and `form="account-settings-currency-form"`.

- [ ] **Step 2: Update create and edit interactions to use Save**

Replace Account settings-only button queries for `Add account type`, `Update account type`, `Add currency`, and `Update currency` with `Save`. Keep payload, draft reset, safe error, validation, editor reset, and deactivation assertions unchanged.

For edit mode, additionally assert the active heading becomes `Edit account type` or `Edit currency`, and that `Cancel edit` returns it to the corresponding New heading.

- [ ] **Step 3: Require pending and focus behavior**

Capture the footer Save before submission, click it, then assert:

```tsx
expect(save).toBeDisabled();
expect(save).toHaveAccessibleName("Saving…");
expect(within(dialog).getByRole("button", { name: "Close" })).toBeDisabled();
```

Update the focus-trap test for natural DOM order:

```tsx
const accountTypes = within(dialog).getByRole("tab", { name: "Account types" });
const save = within(dialog).getByRole("button", { name: "Save" });
expect(accountTypes).toHaveFocus();
await user.keyboard("{Shift>}{Tab}{/Shift}");
expect(save).toHaveFocus();
await user.keyboard("{Tab}");
expect(accountTypes).toHaveFocus();
```

- [ ] **Step 4: Run the focused tests and verify failure**

Run:

```powershell
npm --prefix frontend test -- --run tests/presentation/ledger-panel.spec.tsx
```

Expected: FAIL only at the new Account settings structure, labels, form association, pending label, and focus-order contracts.

- [ ] **Step 5: Commit the tests**

```powershell
git add frontend/tests/presentation/ledger-panel.spec.tsx
git commit -m "[UPDATE] Define Account settings dialog behavior"
```

### Task 2: Implement the unified Account settings actions

**Files:**
- Modify: `frontend/src/features/ledger/ui/AccountSettingsDialog.tsx`
- Modify: `frontend/src/styles/globals.css`

- [ ] **Step 1: Identify the active form**

Add stable IDs and resolve the active one in `AccountSettingsDialogContent`:

```tsx
const accountTypeFormId = "account-settings-account-type-form";
const currencyFormId = "account-settings-currency-form";

const activeFormId = activeTab === "account-types" ? accountTypeFormId : currencyFormId;
```

- [ ] **Step 2: Move Close and Save to the footer**

Remove the header Close button, retain `closeButtonRef`, and render after the tabpanel:

```tsx
<div className="ledger-create-dialog-actions">
  <button
    ref={closeButtonRef}
    type="button"
    className="items-toolbar-button"
    aria-label="Close"
    disabled={pending}
    onClick={onClose}
  >
    Close
  </button>
  <button
    type="submit"
    form={activeFormId}
    className="items-toolbar-button ledger-create-dialog-save"
    disabled={pending}
  >
    {pending ? "Saving…" : "Save"}
  </button>
</div>
```

The close ref remains the fallback for nested deactivation confirmation.

- [ ] **Step 3: Connect and label the local forms**

Set `id={accountTypeFormId}` and `id={currencyFormId}` on the forms. Pass those IDs into `AccountTypes` and `Currencies` as `formId: string`. Add these headings at the beginning of each form:

```tsx
<h3>{editing ? "Edit account type" : "New account type"}</h3>
```

```tsx
<h3>{editing ? "Edit currency" : "New currency"}</h3>
```

Remove each form's internal submit button. Keep `Cancel edit` inside its form.

- [ ] **Step 4: Preserve natural focus order**

Change the dialog focusable selector so button tabs with `tabindex="-1"` are excluded:

```tsx
'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]):not([tabindex="-1"]), [tabindex]:not([tabindex="-1"])'
```

The active tab becomes the initial and first focusable element; footer Save is the final element. Keep the existing endpoint wrap and Escape/pending guard.

- [ ] **Step 5: Style only Account settings tabs and headings**

Replace the current Account settings tab rules with:

```css
.ledger-account-settings-tabs {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px;
  margin-block: 16px;
  padding: 4px;
  border-radius: var(--radius-md);
  background: var(--color-canvas-cream);
}

.ledger-account-settings-tab {
  border: 1px solid transparent;
  background: transparent;
}

.ledger-account-settings-tab[aria-selected="true"] {
  border-color: var(--color-accent-strong);
  background: var(--color-accent-soft);
  color: var(--color-ink);
  font-weight: 700;
}

.ledger-account-settings-dialog [role="tabpanel"] form h3 {
  margin-top: 0;
}
```

Apply the two classes to the tablist and tab buttons. Keep the existing two-column and mobile layout rules.

- [ ] **Step 6: Run the focused tests**

Run:

```powershell
npm --prefix frontend test -- --run tests/presentation/ledger-panel.spec.tsx
```

Expected: all tests in the file PASS.

- [ ] **Step 7: Commit the implementation**

```powershell
git add frontend/src/features/ledger/ui/AccountSettingsDialog.tsx frontend/src/styles/globals.css
git commit -m "[UPDATE] Improve Account settings dialog"
```

### Task 3: Verify the frontend

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

Expected: exit code 0 and static routes generated.

- [ ] **Step 4: Inspect the branch**

Run:

```powershell
git diff --check
git status --short
```

Expected: both commands report no unexpected changes.
