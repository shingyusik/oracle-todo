# Account Settings Row Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Account settings editing clear, keep all row actions visible as icons, and permanently delete only unreferenced Account types through the existing purge API.

**Architecture:** Extend `LedgerController` with the two Account-category purge operations already exposed by `ledgerApi`. Keep dialog state, preview/confirmation flow, and focus restoration inside `AccountSettingsDialog`; use scoped CSS to override the global fixed-width table rules without changing other tables.

**Tech Stack:** React 18, TypeScript, Next.js 14, Lucide React, Testing Library, Vitest, existing Raven Ledger API and modal primitives

---

## File Structure

- Modify `frontend/src/features/ledger/hooks/useLedgerController.ts`: expose preview and purge methods for Account categories and route purge through the existing refresh boundary.
- Modify `frontend/src/features/ledger/ui/AccountSettingsDialog.tsx`: move Cancel edit, render icon-only actions, and manage Account-type purge preview/confirmation state.
- Modify `frontend/src/styles/globals.css`: add only Account-settings-scoped editor, table-column, and icon-button rules.
- Modify `frontend/tests/presentation/ledger-panel.spec.tsx`: cover controller delegation, icon contracts, layout classes, preview failure, confirmation, pending guards, focus, and editor reset.
- Modify `frontend/tests/presentation/accounts-panel.spec.tsx`: add the two required controller fixture methods.
- Modify `frontend/tests/presentation/categories-panel.spec.tsx`: add the two required controller fixture methods.
- Modify `frontend/tests/presentation/ledger-form.spec.tsx`: add the two required controller fixture methods.
- Modify `frontend/tests/presentation/workbench-wireframe.spec.tsx`: add the two required controller fixture methods.

### Task 1: Add the Account-category purge controller boundary

**Files:**
- Modify: `frontend/src/features/ledger/hooks/useLedgerController.ts:112-145,505-550`
- Modify: `frontend/tests/presentation/ledger-panel.spec.tsx:80-146,1020-1080`
- Modify: `frontend/tests/presentation/accounts-panel.spec.tsx:70-110`
- Modify: `frontend/tests/presentation/categories-panel.spec.tsx:60-100`
- Modify: `frontend/tests/presentation/ledger-form.spec.tsx:90-130`
- Modify: `frontend/tests/presentation/workbench-wireframe.spec.tsx:220-260`

- [ ] **Step 1: Write the failing controller test**

In `ledger-panel.spec.tsx`, add the two methods to the local `controller()` fixture:

```ts
previewAccountCategoryPurge: vi.fn().mockResolvedValue({
  confirmationId: "account-category-cash",
  recordType: "account_category",
}),
purgeAccountCategory: vi.fn(),
```

Extend `forwards account-category mutations and refreshes active categories` with the existing generic API spies and assertions:

```ts
vi.spyOn(ledgerApi, "previewMasterPurge").mockResolvedValue({
  confirmationId: "account-type-card",
  recordType: "account_category",
});
vi.spyOn(ledgerApi, "purgeMaster").mockResolvedValue(undefined);

let preview!: MasterPurgePreview;
await act(async () => {
  preview = await result.current.previewAccountCategoryPurge("account-type-card");
});
expect(preview).toEqual({
  confirmationId: "account-type-card",
  recordType: "account_category",
});
expect(ledgerApi.previewMasterPurge).toHaveBeenCalledWith(
  "account-categories",
  "account-type-card",
);

await act(async () => {
  await result.current.purgeAccountCategory("account-type-card", "account-type-card");
});
expect(ledgerApi.purgeMaster).toHaveBeenCalledWith(
  "account-categories",
  "account-type-card",
  "account-type-card",
);
```

Import `MasterPurgePreview` from `ledger-model` in the existing type import. Update the final `listAccountCategories` call count from `4` to `5`, proving purge uses `mutate()` and refreshes while preview does not.

- [ ] **Step 2: Run the controller test to verify RED**

Run:

```powershell
npm --prefix frontend test -- --run tests/presentation/ledger-panel.spec.tsx -t "forwards account-category mutations"
```

Expected: FAIL because `previewAccountCategoryPurge` and `purgeAccountCategory` do not exist on `LedgerController`.

- [ ] **Step 3: Add the minimal controller methods**

Add these required members to `LedgerController` after `deactivateAccountCategory`:

```ts
previewAccountCategoryPurge(id: string): Promise<MasterPurgePreview>;
purgeAccountCategory(id: string, confirmation: string): Promise<void>;
```

Add these methods to the returned controller object:

```ts
previewAccountCategoryPurge: (id) =>
  ledgerApi.previewMasterPurge("account-categories", id),
purgeAccountCategory: (id, confirmation) =>
  mutate(() => ledgerApi.purgeMaster("account-categories", id, confirmation)),
```

Add matching `vi.fn()` members to every other `LedgerController` fixture listed in this task so TypeScript remains exhaustive:

```ts
previewAccountCategoryPurge: vi.fn(),
purgeAccountCategory: vi.fn(),
```

- [ ] **Step 4: Run the controller test and typecheck to verify GREEN**

Run:

```powershell
npm --prefix frontend test -- --run tests/presentation/ledger-panel.spec.tsx -t "forwards account-category mutations"
npm --prefix frontend run typecheck
```

Expected: the focused test passes and TypeScript exits with code 0.

- [ ] **Step 5: Commit the controller boundary**

Stage only the six files listed in Task 1. Keep the pre-existing `frontend/package-lock.json` unstaged.

```text
[ADD] Expose Account type purge operations

- 기존 Account category purge API를 Ledger controller에 연결한다.
- purge 이후 공용 refresh 경계를 거치도록 보장한다.
```

### Task 2: Lock the approved Account settings UI behavior in tests

**Files:**
- Modify: `frontend/tests/presentation/ledger-panel.spec.tsx:530-970`

- [ ] **Step 1: Add failing editor-layout and icon tests**

Extend the existing Account settings tab test to require scoped tables and contextual icon buttons:

```ts
const accountTypeTable = within(dialog).getByRole("table");
expect(accountTypeTable).toHaveClass(
  "ledger-account-settings-table",
  "ledger-account-settings-account-types-table",
);

const expectIconAction = (name: string, iconClass: string) => {
  const action = within(accountTypeTable).getByRole("button", { name });
  expect(action).toHaveAttribute("title", name);
  expect(action).toContainElement(action.querySelector(`.${iconClass}`));
  expect(action).not.toHaveTextContent(name);
};
expectIconAction("Edit Cash", "lucide-pencil");
expectIconAction("Deactivate Cash", "lucide-circle-off");
expectIconAction("Delete Cash", "lucide-trash-2");
expect(within(accountTypeTable).getByRole("cell", { name: /Edit Cash/ }))
  .toHaveClass("ledger-account-settings-actions-cell");
```

After entering edit mode, require Cancel to share a heading wrapper instead of following the Liability label:

```ts
await user.click(screen.getByRole("button", { name: "Edit Cash" }));
const editorHeading = screen.getByRole("heading", { name: "Edit account type" }).parentElement!;
expect(editorHeading).toHaveClass("ledger-account-settings-editor-header");
expect(within(editorHeading).getByRole("button", { name: "Cancel edit" }))
  .toBeInTheDocument();
expect(screen.getByLabelText("Liability").parentElement?.nextElementSibling)
  .not.toBe(screen.getByRole("button", { name: "Cancel edit" }));
```

Switch to Currencies, edit KRW, and assert the same editor-heading placement plus `Pencil` and `CircleOff` icon actions, while `Delete KRW` remains absent.

- [ ] **Step 2: Add failing permanent-delete behavior tests**

Add a test for preview failure:

```ts
it("keeps referenced Account types and shows only a safe purge-preview failure", async () => {
  const user = userEvent.setup();
  const ledger = controller();
  ledger.previewAccountCategoryPurge = vi.fn().mockRejectedValue(
    new Error("sqlite /private/raven.sqlite: referenced"),
  );
  render(<AccountSettingsDialog
    controller={ledger}
    onClose={vi.fn()}
    returnFocusRef={React.createRef<HTMLButtonElement>()}
  />);

  await user.click(screen.getByRole("button", { name: "Delete Cash" }));

  expect(ledger.previewAccountCategoryPurge)
    .toHaveBeenCalledWith("account-category-cash");
  expect(screen.queryByRole("dialog", { name: "Permanently delete Cash?" }))
    .toBeNull();
  expect(await screen.findByRole("alert"))
    .toHaveTextContent("Could not delete account type.");
  expect(screen.getByRole("alert")).not.toHaveTextContent("sqlite");
});
```

Add one success/pending/focus test using `deferred()`:

```ts
it("previews and permanently deletes an unused Account type once", async () => {
  const user = userEvent.setup();
  const preview = deferred<MasterPurgePreview>();
  const purge = deferred<void>();
  const ledger = controller();
  ledger.previewAccountCategoryPurge = vi.fn()
    .mockReturnValueOnce(preview.promise)
    .mockResolvedValue({
      confirmationId: "account-category-cash",
      recordType: "account_category",
    });
  ledger.purgeAccountCategory = vi.fn(() => purge.promise);
  const onClose = vi.fn();
  render(<AccountSettingsDialog
    controller={ledger}
    onClose={onClose}
    returnFocusRef={React.createRef<HTMLButtonElement>()}
  />);

  await user.click(screen.getByRole("button", { name: "Edit Cash" }));
  const deleteCash = screen.getByRole("button", { name: "Delete Cash" });
  await user.click(deleteCash);
  await user.click(deleteCash);
  expect(ledger.previewAccountCategoryPurge).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("dialog", { name: "Account settings" }))
    .toHaveAttribute("aria-busy", "true");
  expect(screen.getByRole("button", { name: "Close" })).toBeDisabled();
  await user.keyboard("{Escape}");
  expect(onClose).not.toHaveBeenCalled();

  await act(async () => preview.resolve({
    confirmationId: "account-category-cash",
    recordType: "account_category",
  }));
  const confirmation = await screen.findByRole("dialog", {
    name: "Permanently delete Cash?",
  });
  expect(within(confirmation).getByRole("button", { name: "Cancel" })).toHaveFocus();
  await user.click(within(confirmation).getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(deleteCash).toHaveFocus());

  await user.click(deleteCash);
  const reopened = await screen.findByRole("dialog", {
    name: "Permanently delete Cash?",
  });
  const confirm = within(reopened).getByRole("button", { name: "Delete" });
  await user.click(confirm);
  await user.click(confirm);
  expect(ledger.purgeAccountCategory).toHaveBeenCalledTimes(1);
  expect(ledger.purgeAccountCategory).toHaveBeenCalledWith(
    "account-category-cash",
    "account-category-cash",
  );
  await act(async () => purge.resolve(undefined));
  expect(screen.getByRole("form", { name: "New account type" }))
    .toBeInTheDocument();
});
```

- [ ] **Step 3: Run the Account settings tests to verify RED**

Run:

```powershell
npm --prefix frontend test -- --run tests/presentation/ledger-panel.spec.tsx -t "Account settings|Account type|account type|currenc"
```

Expected: failures for missing icon markup/classes, old Cancel placement, and missing delete preview/confirmation behavior. Existing save/deactivation tests remain otherwise green.

- [ ] **Step 4: Commit the red UI contract**

```text
[UPDATE] Define Account settings row action behavior

- 편집 취소 위치와 아이콘 행 액션 계약을 고정한다.
- Account type 영구 삭제의 실패, 확인, 중복 방지 흐름을 검증한다.
```

### Task 3: Implement compact icon actions and permanent Account-type deletion

**Files:**
- Modify: `frontend/src/features/ledger/ui/AccountSettingsDialog.tsx:1-600`
- Modify: `frontend/src/styles/globals.css:2042-2118,3028-3035`

- [ ] **Step 1: Add purge state and operations to the dialog**

Import the approved icons:

```ts
import { CircleOff, Pencil, Trash2 } from "lucide-react";
```

Add the purge target type and state:

```ts
type AccountCategoryPurgeTarget = {
  item: AccountCategory;
  confirmationId: string;
};

const [accountPurgeTarget, setAccountPurgeTarget] =
  React.useState<AccountCategoryPurgeTarget | null>(null);
const deleteButtonRef = React.useRef<HTMLButtonElement>(null);
```

Isolate the parent only when neither nested confirmation is open:

```ts
useModalIsolation(
  dialogRef,
  deactivationTarget === null && accountPurgeTarget === null,
  "body",
);
```

Add the preview and purge functions:

```ts
async function prepareAccountCategoryPurge(
  item: AccountCategory,
  trigger: HTMLButtonElement,
) {
  if (pending) return;
  deleteButtonRef.current = trigger;
  setError(null);
  setPending(true);
  try {
    const preview = await controller.previewAccountCategoryPurge(item.id);
    setAccountPurgeTarget({ item, confirmationId: preview.confirmationId });
  } catch (cause) {
    setError(safeLedgerErrorMessage(cause, "Could not delete account type."));
  } finally {
    setPending(false);
  }
}

async function purgeAccountCategory() {
  const target = accountPurgeTarget;
  if (!target || pending) return;
  setError(null);
  setPending(true);
  try {
    await controller.purgeAccountCategory(target.item.id, target.confirmationId);
    if (accountEditing?.id === target.item.id) resetAccountEditor();
    setAccountPurgeTarget(null);
  } catch (cause) {
    setError(safeLedgerErrorMessage(cause, "Could not delete account type."));
  } finally {
    setPending(false);
  }
}
```

Clear `accountPurgeTarget` in `selectTab`. Pass an `onDelete` callback to `AccountTypes` that calls `prepareAccountCategoryPurge(item, trigger)`.

Render a second existing confirmation dialog:

```tsx
{accountPurgeTarget ? (
  <DestructiveConfirmationDialog
    title={`Permanently delete ${accountPurgeTarget.item.name}?`}
    description="This Account type will be permanently deleted and cannot be recovered."
    confirmLabel="Delete"
    error={error}
    disabled={pending}
    fallbackFocusRef={deleteButtonRef}
    onCancel={() => {
      if (!pending) {
        setAccountPurgeTarget(null);
        setError(null);
      }
    }}
    onConfirm={purgeAccountCategory}
  />
) : null}
```

- [ ] **Step 2: Move Cancel and render contextual icon actions**

In both forms, replace the bare heading with this wrapper and remove the old Cancel button below the fields:

```tsx
<div className="ledger-account-settings-editor-header">
  <h3>{editing ? "Edit account type" : "New account type"}</h3>
  {editing ? (
    <button
      className="items-toolbar-button"
      type="button"
      disabled={pending}
      onClick={onCancel}
    >
      Cancel edit
    </button>
  ) : null}
</div>
```

Use this corresponding wrapper in `Currencies`:

```tsx
<div className="ledger-account-settings-editor-header">
  <h3>{editing ? "Edit currency" : "New currency"}</h3>
  {editing ? (
    <button
      className="items-toolbar-button"
      type="button"
      disabled={pending}
      onClick={onCancel}
    >
      Cancel edit
    </button>
  ) : null}
</div>
```

Add `ledger-account-settings-table ledger-account-settings-account-types-table` to the Account type table and `ledger-account-settings-table ledger-account-settings-currencies-table` to the Currency table. Replace Account type row buttons with:

```tsx
<td className="ledger-account-settings-actions-cell">
  <div className="ledger-account-settings-row-actions">
    <button
      type="button"
      className="ledger-account-settings-icon-button"
      aria-label={`Edit ${item.name}`}
      title={`Edit ${item.name}`}
      disabled={pending}
      onClick={() => onEdit(item)}
    >
      <Pencil size={16} aria-hidden="true" />
    </button>
    <button
      type="button"
      className="ledger-account-settings-icon-button"
      aria-label={`Deactivate ${item.name}`}
      title={`Deactivate ${item.name}`}
      disabled={pending}
      onClick={() => onDeactivate(item)}
    >
      <CircleOff size={16} aria-hidden="true" />
    </button>
    <button
      type="button"
      className="ledger-account-settings-icon-button ledger-account-settings-delete-button"
      aria-label={`Delete ${item.name}`}
      title={`Delete ${item.name}`}
      disabled={pending}
      onClick={(event) => onDelete(item, event.currentTarget)}
    >
      <Trash2 size={16} aria-hidden="true" />
    </button>
  </div>
</td>
```

Add the `onDelete(item: AccountCategory, trigger: HTMLButtonElement): void` prop to `AccountTypes`. Render the same first two icon buttons for Currency rows using code/name context, without Trash2.

```tsx
<td className="ledger-account-settings-actions-cell">
  <div className="ledger-account-settings-row-actions">
    <button
      type="button"
      className="ledger-account-settings-icon-button"
      aria-label={`Edit ${item.code}`}
      title={`Edit ${item.code}`}
      disabled={pending}
      onClick={() => onEdit(item)}
    >
      <Pencil size={16} aria-hidden="true" />
    </button>
    <button
      type="button"
      className="ledger-account-settings-icon-button"
      aria-label={`Deactivate ${item.code}`}
      title={`Deactivate ${item.code}`}
      disabled={pending}
      onClick={() => onDeactivate(item)}
    >
      <CircleOff size={16} aria-hidden="true" />
    </button>
  </div>
</td>
```

- [ ] **Step 3: Add scoped sizing and icon CSS**

Add these rules after the existing Account settings editor rules:

```css
.ledger-account-settings-editor-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.ledger-account-settings-editor-header h3 {
  margin: 0;
}

.ledger-account-settings-table {
  width: 100%;
  min-width: 0;
  table-layout: fixed;
}

.items-table.ledger-account-settings-account-types-table :is(th, td):nth-child(1) {
  width: 29%;
  max-width: none;
}

.ledger-account-settings-account-types-table :is(th, td):nth-child(2) { width: 27%; }
.ledger-account-settings-account-types-table :is(th, td):nth-child(3) { width: 16%; }
.ledger-account-settings-account-types-table :is(th, td):nth-child(4) { width: 28%; }
.items-table.ledger-account-settings-currencies-table :is(th, td):nth-child(1) {
  width: 16%;
  max-width: none;
}
.ledger-account-settings-currencies-table :is(th, td):nth-child(2) { width: 26%; }
.ledger-account-settings-currencies-table :is(th, td):nth-child(3) { width: 14%; }
.ledger-account-settings-currencies-table :is(th, td):nth-child(4) { width: 20%; }
.ledger-account-settings-currencies-table :is(th, td):nth-child(5) { width: 24%; }

.ledger-account-settings-actions-cell {
  overflow: visible;
  text-overflow: clip;
}

.ledger-account-settings-row-actions {
  display: flex;
  justify-content: flex-end;
  gap: 4px;
}

.ledger-account-settings-icon-button {
  display: inline-grid;
  width: 32px;
  min-height: 32px;
  place-items: center;
  padding: 0;
}

.ledger-account-settings-delete-button {
  border-color: var(--color-danger-text);
  color: var(--color-danger-text);
}
```

Remove the obsolete `td button + button` margin rule. In the existing mobile media query, add:

```css
.ledger-account-settings-table {
  min-width: 520px;
}
```

- [ ] **Step 4: Run focused UI tests to verify GREEN**

Run:

```powershell
npm --prefix frontend test -- --run tests/presentation/ledger-panel.spec.tsx
npm --prefix frontend run typecheck
```

Expected: all 96+ Ledger panel tests pass and TypeScript exits with code 0.

- [ ] **Step 5: Commit the UI implementation**

```text
[UPDATE] Improve Account settings row actions

- 편집 취소를 제목 영역으로 옮기고 행 액션을 아이콘으로 정리한다.
- 참조 검증과 확인을 거친 Account type 영구 삭제를 제공한다.
```

### Task 4: Verify the complete frontend result

**Files:**
- Verify only; no intended source changes

- [ ] **Step 1: Run the complete frontend test suite**

Run:

```powershell
npm --prefix frontend test
```

Expected: every Vitest file and test passes with zero failures.

- [ ] **Step 2: Run typecheck and production build**

Run:

```powershell
npm --prefix frontend run typecheck
npm --prefix frontend run build
```

Expected: both commands exit with code 0; Next.js completes its optimized production build.

- [ ] **Step 3: Inspect repository integrity**

Run:

```powershell
git diff --check
git status --short
git log --oneline -6
```

Expected: no whitespace errors; only the user's pre-existing `frontend/package-lock.json` remains unstaged; commits are split into controller, red UI contract, and UI implementation units.
