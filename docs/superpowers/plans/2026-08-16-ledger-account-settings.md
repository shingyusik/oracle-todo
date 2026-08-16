# Ledger Account Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an accessible Accounts settings modal that manages account types and currencies through Raven's existing create, update, and deactivate policies.

**Architecture:** Keep Ledger Engine and Raven API unchanged because their reference-data contracts already support every required field and active lifecycle transition. Extend the frontend Ledger controller with typed mutations, implement one portal-backed settings dialog with two tabs, and expose it from the Accounts header while reusing the existing modal-isolation and destructive-confirmation primitives.

**Tech Stack:** React 18, TypeScript, Vitest, Testing Library, existing Raven Ledger HTTP adapter, native HTML form controls, CSS.

**Spec:** `docs/superpowers/specs/2026-08-14-ledger-accounts-ux-design.md`

## Global Constraints

- SHI-67 covers only the Account types and Currencies settings modal; Accounts table, creation, detail, filtering, and row lifecycle belong to SHI-70.
- Account type fields are Name, Parent account type, and Liability flag.
- Currency fields are Code, Name, Symbol, and Decimal places.
- Delete means `PATCH` with `active:false`; do not add purge, restore, inactive-browser, exchange-rate, or backend behavior.
- Lists and selectable parents use the controller's active-only reference data; an account type cannot select itself as parent.
- Reuse the existing Ledger API adapter, `useModalIsolation`, `DestructiveConfirmationDialog`, and native inputs. Add no dependency or speculative shared abstraction.
- API or transport errors may be shown; unknown error details must use a fixed safe fallback and the failed draft must remain editable.
- Pending mutations prevent duplicate submission and prevent closing the owning dialog until the mutation settles.
- Modal focus enters the first enabled control, Tab remains contained, Escape closes only when no mutation or confirmation is pending, and close restores focus to the Accounts settings trigger.
- All code and tests stay within the frontend unless verification proves an existing HTTP contract is insufficient.

---

### Task 1: Expose typed reference-data mutations from the Ledger controller

**Files:**
- Modify: `frontend/src/features/ledger/hooks/useLedgerController.ts`
- Test: `frontend/tests/presentation/ledger-panel.spec.tsx`
- Modify typed controller fixtures: `frontend/tests/presentation/ledger-form.spec.tsx`
- Modify typed controller fixtures: `frontend/tests/presentation/workbench-wireframe.spec.tsx`

**Interfaces:**
- Consumes: `CurrencyInput`, `AccountCategoryInput`, `ledgerApi.createCurrency`, `ledgerApi.updateCurrency`, `ledgerApi.createAccountCategory`, and `ledgerApi.updateAccountCategory` from `ledger-api.ts`.
- Produces:

```ts
createCurrency(input: CurrencyInput): Promise<void>;
updateCurrency(id: string, input: Partial<CurrencyInput>): Promise<void>;
deactivateCurrency(id: string): Promise<void>;
createAccountCategory(input: AccountCategoryInput): Promise<void>;
updateAccountCategory(id: string, input: Partial<AccountCategoryInput>): Promise<void>;
deactivateAccountCategory(id: string): Promise<void>;
```

- [ ] **Step 1: Write failing controller mutation tests**

Add focused `useLedgerController` tests that call each produced method and assert the exact adapter payload. The deactivation cases must assert:

```ts
expect(ledgerApi.updateCurrency).toHaveBeenCalledWith("currency-usd", { active: false });
expect(ledgerApi.updateAccountCategory).toHaveBeenCalledWith("account-type-cash", {
  active: false,
});
```

Also assert a successful mutation refreshes active reference pages so the controller state reflects the server result.

- [ ] **Step 2: Run the focused tests to verify RED**

Run:

```bash
npm --prefix frontend test -- tests/presentation/ledger-panel.spec.tsx
```

Expected: FAIL because the six controller methods do not exist.

- [ ] **Step 3: Add the minimal controller contract and implementations**

Import the two input types and add the six required methods to `LedgerController`. Implement them through the existing `mutate` helper:

```ts
createCurrency: (input) => mutate(() => ledgerApi.createCurrency(input)),
updateCurrency: (id, input) => mutate(() => ledgerApi.updateCurrency(id, input)),
deactivateCurrency: (id) => mutate(() => ledgerApi.updateCurrency(id, { active: false })),
createAccountCategory: (input) => mutate(() => ledgerApi.createAccountCategory(input)),
updateAccountCategory: (id, input) =>
  mutate(() => ledgerApi.updateAccountCategory(id, input)),
deactivateAccountCategory: (id) =>
  mutate(() => ledgerApi.updateAccountCategory(id, { active: false })),
```

Do not add purge or restore commands for these settings.

- [ ] **Step 4: Run controller tests and typecheck**

Run:

```bash
npm --prefix frontend test -- tests/presentation/ledger-panel.spec.tsx
npm --prefix frontend run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/ledger/hooks/useLedgerController.ts frontend/tests/presentation/ledger-panel.spec.tsx frontend/tests/presentation/ledger-form.spec.tsx frontend/tests/presentation/workbench-wireframe.spec.tsx
git commit -m "[ADD] Expose Ledger account settings mutations"
```

---

### Task 2: Build the Account types and Currencies settings dialog

**Files:**
- Create: `frontend/src/features/ledger/ui/AccountSettingsDialog.tsx`
- Modify: `frontend/tests/presentation/ledger-panel.spec.tsx`

**Interfaces:**
- Consumes: the six Task 1 controller methods, active `state.accountCategories`, active `state.currencies`, `useModalIsolation`, and `DestructiveConfirmationDialog`.
- Produces:

```ts
export function AccountSettingsDialog(props: {
  controller: LedgerController;
  onClose(): void;
  returnFocusRef: React.RefObject<HTMLButtonElement | null>;
}): React.ReactNode;
```

- [ ] **Step 1: Write failing presentation tests for the two-tab workflow**

Cover these behaviors through the production dialog:

```text
Account types tab
- lists active account types
- creates { name, parent, liability }
- edits every supported field
- excludes the edited type from its parent options
- asks for confirmation, then calls deactivateAccountCategory(id)
- retains the draft and safe inline error after a rejected mutation

Currencies tab
- lists active currencies
- creates { code, name, symbol, decimalPlaces }
- edits every supported field
- constrains decimalPlaces to an integer from 0 through 18
- asks for confirmation, then calls deactivateCurrency(id)
```

Also assert complete tabs semantics: `tablist`, tab `id`, `aria-controls`, selected roving `tabIndex`, matching `tabpanel`, and ArrowLeft/ArrowRight focus movement.

- [ ] **Step 2: Run the focused tests to verify RED**

Run:

```bash
npm --prefix frontend test -- tests/presentation/ledger-panel.spec.tsx
```

Expected: FAIL because `AccountSettingsDialog` does not exist.

- [ ] **Step 3: Implement the portal and modal lifecycle**

Follow `TransactionCreateDialog.tsx`: create a temporary `data-raven-modal-host`, portal into `document.body`, call `useModalIsolation(dialogRef, true, "body")`, focus the first enabled control, trap Tab, close on Escape only while idle, and restore `returnFocusRef` on unmount.

Use this fixed tab identity:

```ts
type AccountSettingsTab = "account-types" | "currencies";

const tabs = [
  { id: "account-types", label: "Account types" },
  { id: "currencies", label: "Currencies" },
] as const;
```

Render one dialog titled `Account settings`; switching tabs resets the active editor and inline error but does not close the dialog.

- [ ] **Step 4: Implement Account types list, editor, and deactivate confirmation**

Use controlled state with these exact draft shapes:

```ts
type AccountCategoryDraft = {
  name: string;
  parent: string;
  liability: boolean;
};

const emptyAccountCategoryDraft: AccountCategoryDraft = {
  name: "",
  parent: "",
  liability: false,
};
```

Submit `parent || null`. Disable form controls and Close while pending. On success, clear the editor; on failure, retain every field. Import `RavenApiError` and `RavenTransportError`; expose their safe messages and use `Could not save account type.` for every other value. The Delete action must open `DestructiveConfirmationDialog` and call only `deactivateAccountCategory(id)`.

- [ ] **Step 5: Implement Currencies list, editor, and deactivate confirmation**

Use controlled string input for decimal places so invalid drafts remain visible:

```ts
type CurrencyDraft = {
  code: string;
  name: string;
  symbol: string;
  decimalPlaces: string;
};
```

Render `<input type="number" min={0} max={18} step={1}>`. Before calling the controller, accept only `Number.isInteger(value) && value >= 0 && value <= 18`; otherwise show `Decimal places must be an integer from 0 to 18.` without issuing a request. A rejected request retains the draft, exposes only `RavenApiError` or `RavenTransportError` messages, and otherwise shows `Could not save currency.` The Delete action must call only `deactivateCurrency(id)` after confirmation.

- [ ] **Step 6: Run the dialog tests and typecheck**

Run:

```bash
npm --prefix frontend test -- tests/presentation/ledger-panel.spec.tsx
npm --prefix frontend run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/features/ledger/ui/AccountSettingsDialog.tsx frontend/tests/presentation/ledger-panel.spec.tsx
git commit -m "[ADD] Build Ledger account settings dialog"
```

---

### Task 3: Integrate the settings action with the Accounts header

**Files:**
- Modify: `frontend/src/features/ledger/ui/LedgerTableViewHeader.tsx`
- Modify: `frontend/src/features/ledger/ui/AccountsPanel.tsx`
- Modify: `frontend/src/styles/globals.css`
- Modify: `frontend/tests/presentation/ledger-panel.spec.tsx`
- Modify if required by the production import graph: `frontend/tests/architecture/design-boundaries.spec.ts`

**Interfaces:**
- Consumes: `AccountSettingsDialog` from Task 2.
- Produces: an Accounts-only `Account settings` header trigger with modal focus restoration.

- [ ] **Step 1: Write failing integration and accessibility tests**

Render `LedgerPanel` on the Accounts tab and assert:

```text
- Account settings appears in the Accounts header and nowhere on Transactions, Categories, or Reports
- activating it opens the Account settings dialog
- Escape closes the idle dialog and restores focus to Account settings
- pending save disables Close and prevents Escape from dismissing the dialog
- closing the dialog leaves existing Accounts form/table state intact
```

- [ ] **Step 2: Run the focused test to verify RED**

Run:

```bash
npm --prefix frontend test -- tests/presentation/ledger-panel.spec.tsx
```

Expected: FAIL because no Accounts settings trigger is connected.

- [ ] **Step 3: Add a narrowly typed header action**

Extend `LedgerTableViewHeader` with optional props:

```ts
onSettings?: () => void;
settingsButtonRef?: React.RefObject<HTMLButtonElement | null>;
settingsLabel?: string;
```

When `onSettings` exists, render a native button with `aria-haspopup="dialog"`, label text from `settingsLabel`, and no behavior for other scopes. Do not introduce a general toolbar action registry.

- [ ] **Step 4: Connect AccountsPanel to the dialog**

Add only the settings state and trigger integration:

```ts
const [settingsOpen, setSettingsOpen] = useState(false);
const settingsButtonRef = useRef<HTMLButtonElement | null>(null);
```

Pass `onSettings={() => setSettingsOpen(true)}`, `settingsButtonRef`, and `settingsLabel="Account settings"` to the header. Render `AccountSettingsDialog` only while open. Do not redesign the existing Accounts table, account editor, archive, restore, or purge controls in SHI-67; SHI-70 owns that replacement.

- [ ] **Step 5: Add only dialog-specific styling**

Use existing `confirmation-backdrop`, `confirmation-dialog`, `dashboard-widget-header`, `field-label`, `items-table`, and `dialog-actions` classes. Add one `.ledger-account-settings-*` block only for the two-column list/editor layout, selected tab state, compact row actions, and small-screen stacking. Do not add a component library or chart/layout abstraction.

- [ ] **Step 6: Run integration, architecture, and type checks**

Run:

```bash
npm --prefix frontend test -- tests/presentation/ledger-panel.spec.tsx tests/architecture/design-boundaries.spec.ts
npm --prefix frontend run typecheck
git diff --check
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/features/ledger/ui/LedgerTableViewHeader.tsx frontend/src/features/ledger/ui/AccountsPanel.tsx frontend/src/styles/globals.css frontend/tests/presentation/ledger-panel.spec.tsx frontend/tests/architecture/design-boundaries.spec.ts
git commit -m "[UPDATE] Connect Ledger account settings"
```

---

### Task 4: Verify final behavior and documentation

**Files:**
- Modify only if verification exposes a factual gap: `README.md`
- Modify only if API guidance is inaccurate: `docs/operations/api-reference.md`
- Modify only if smoke guidance needs the settings flow: `docs/operations/verification-and-smoke.md`

**Interfaces:**
- Consumes: completed Tasks 1-3.
- Produces: a verified SHI-67 implementation and factual final-state documentation.

- [ ] **Step 1: Run the complete frontend gate**

Run:

```bash
npm --prefix frontend test
npm --prefix frontend run typecheck
npm --prefix frontend run build
```

Expected: 0 failures.

- [ ] **Step 2: Run workspace regression checks**

Run:

```bash
cargo fmt --check
cargo test --workspace
cargo clippy --all-targets --all-features -- -D warnings
```

Expected: 0 failures and 0 warnings.

- [ ] **Step 3: Audit documentation without speculative edits**

Confirm existing docs still state that Ledger master data uses activation and that the UI has a separate Accounts workspace. This feature adds no route, environment variable, schema, or lifecycle policy. Edit only a concrete factual mismatch and run the repository documentation checks if a file changes.

- [ ] **Step 4: Commit only material documentation corrections**

If and only if Step 3 changes documentation:

```bash
git add README.md docs/operations/api-reference.md docs/operations/verification-and-smoke.md
git commit -m "[DOCS] Document Ledger account settings"
```

- [ ] **Step 5: Request whole-branch review**

Review the complete branch for exact field coverage, deactivate-only lifecycle, hierarchy choices, draft/error preservation, pending-state safety, modal isolation, keyboard semantics, focus restoration, regression risk, and scope isolation from SHI-70. Resolve all Critical and Important findings through the subagent review loop before offering merge options.
