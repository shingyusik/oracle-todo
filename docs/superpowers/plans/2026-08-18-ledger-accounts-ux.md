# Ledger Accounts UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Follow superpowers:test-driven-development for every behavior change and structured-commit for every commit.

**Goal:** Replace the legacy Accounts management form with a balance-first table, accessible account creation dialog, editable account detail, and deactivate-only single or selected deletion.

**Architecture:** Keep the existing controller mutation contract and Ledger lifecycle policy unchanged. Extend the existing account-balance read DTO by one `decimal_places` field so accounts that reference an inactive currency still render and edit exact monetary values; no new endpoint or repository query is introduced. Join the controller's active account and balance responses in one small Accounts table model, then compose dedicated table, create-dialog, and detail components under `AccountsPanel`. Reuse the existing Ledger table-view settings, Transactions interaction patterns, modal isolation, destructive confirmation, money formatting, and SHI-67 Account settings dialog.

**Tech Stack:** React 18, TypeScript, Vitest, Testing Library, existing Raven Ledger HTTP adapter, native HTML form controls, CSS.

**Spec:** `docs/superpowers/specs/2026-08-14-ledger-accounts-ux-design.md`

**Linear:** `SHI-70`

## Global Constraints

- Do not add routes, schemas, mutations, pagination, or audit behavior. The only server-contract change is adding the currency precision already selected by the account-balance query to its read response.
- Accounts and balances are active-only server reads. Keep a defensive `account.active` check in the projection, but do not add client tombstones or an inactive-account store.
- Delete means the existing `controller.archiveAccount(id)` call, which sends `active:false`. Remove Accounts restore, archive wording, purge preview, and permanent purge UI.
- Current balance is calculated and read-only. It must never enter create or update payloads.
- Account name, account type, currency, and opening balance are editable. Use the selected currency's decimal places for opening-balance display and let the existing server parser enforce the final monetary boundary.
- Reuse `LedgerTableViewHeader`, table-view tabs/settings, `formatMoney`, `formatMinorUnits`, `useModalIsolation`, `DestructiveConfirmationDialog`, and the Transactions table/detail interaction patterns. Add no dependency and do not generalize Transactions and Accounts into a speculative shared component.
- Preserve `AccountSettingsDialog` and its Accounts-header trigger.
- Known `RavenApiError` and `RavenTransportError` messages are safe to show. Unknown thrown values use a fixed fallback; failed create/save/delete operations retain the relevant draft or selection.
- Creation and confirmation dialogs must isolate background interaction, trap Tab, support Escape while idle, prevent duplicate pending submissions, and restore focus.
- New Accounts presentation tests belong in a focused file. Do not enlarge or reorganize the existing `ledger-panel.spec.tsx` beyond assertions directly affected by the new header/legacy UI removal.

---

### Task 1: Preserve currency precision in the account-balance read contract

**Files:**
- Modify: `ledger-engine/src/application/ports.rs`
- Modify: `ledger-engine/src/infrastructure/sqlite/repository.rs`
- Modify: `ledger-engine/src/application/queries.rs`
- Modify: `ledger-engine/tests/integration/reports.rs`
- Modify: `raven-api/tests/routes_ledger.rs`
- Modify: `frontend/src/features/ledger/model/ledger-model.ts`
- Modify: `frontend/tests/domain/ledger-model.spec.ts`
- Modify typed balance fixture: `frontend/tests/presentation/ledger-panel.spec.tsx`

- [ ] **Step 1: Write failing engine, API, and frontend boundary tests**

Create a 2-decimal currency, an account that references it, deactivate the currency, and assert:

- `account_balances_page` still returns `decimal_places: 2` with the exact minor-unit balance;
- `GET /api/v1/ledger/account-balances` serializes `decimal_places: 2` without exposing inactive currency master data through the currencies list;
- `mapAccountBalance` requires an integer `decimal_places` from 0 through 18 and maps it to `decimalPlaces`.

Update the existing typed `AccountBalance` fixture in `ledger-panel.spec.tsx` with its matching precision; do not alter presentation behavior in this task.

- [ ] **Step 2: Verify RED**

```bash
cargo test -p ledger-engine --test integration reports::account_balance
cargo test -p raven-api --test routes_ledger account_balance
npm --prefix frontend test -- tests/domain/ledger-model.spec.ts
```

Use the actual focused Rust test names after adding them. Expected: FAIL because the precision field is absent.

- [ ] **Step 3: Add the field at the existing query boundary**

Select `c.decimal_places` beside `c.code`, carry it through `AccountBalanceRecord` and `AccountBalanceView`, and update row indices/grouping. Add `decimalPlaces` to the frontend `AccountBalance` mapper. Do not add a second query, inactive-currency endpoint, client lookup, or fallback precision.

- [ ] **Step 4: Verify GREEN and formatting**

```bash
cargo test -p ledger-engine --test integration
cargo test -p raven-api --test routes_ledger
npm --prefix frontend test -- tests/domain/ledger-model.spec.ts
cargo fmt --check
npm --prefix frontend run typecheck
```

- [ ] **Step 5: Commit one logical unit**

```text
[FIX] Preserve Ledger account balance precision
```

---

### Task 2: Derive active account table rows from existing state

**Files:**
- Create: `frontend/src/features/ledger/model/account-table.ts`
- Create: `frontend/tests/domain/account-table.spec.ts`

**Produces:**

```ts
export type AccountRow = {
  id: string;
  account: Account;
  name: string;
  accountTypeId: string;
  accountTypeLabel: string;
  currencyId: string;
  currencyCode: string;
  decimalPlaces: number;
  currentBalanceMinor: number;
};

export type AccountRowGroup = {
  key: string;
  label: string | null;
  rows: AccountRow[];
};

export function deriveAccountGroups(
  accounts: readonly Account[],
  balances: readonly AccountBalance[],
  accountTypes: readonly AccountCategory[],
  settings: PlannerTableSettings,
): AccountRowGroup[];
```

- [ ] **Step 1: Write focused failing domain tests**

Cover only the required logic:

- join Account and AccountBalance by account ID;
- exclude inactive accounts defensively;
- keep account rows when an inactive/missing reference label is unavailable, using `Unknown account type` and the balance response's `currencyCode` plus `decimalPlaces`;
- filter by name, account type ID/label, currency ID/code, and displayed current-balance value;
- sort by name, type, currency, and displayed current balance, with ID as a deterministic tie-breaker;
- group by type or currency, including saved-view manual order/hidden/hide-empty behavior through the existing group-order helper;
- distinguish 0-decimal and 2-decimal values when filtering and sorting.

- [ ] **Step 2: Verify RED**

```bash
npm --prefix frontend test -- tests/domain/account-table.spec.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the smallest Accounts projection pipeline**

Mirror the proven `transaction-table.ts` pipeline without extracting shared abstractions:

```text
project active rows
→ effectivePlannerFilterRules
→ matchesPlannerFilterValue
→ stable multi-rule sort
→ group rows
→ orderVisiblePlannerGroups
```

Convert minor units to displayed numeric values with `minor / 10 ** decimalPlaces` only for numeric filtering and sorting. Keep minor units unchanged in the row for rendering.

- [ ] **Step 4: Verify GREEN and type safety**

```bash
npm --prefix frontend test -- tests/domain/account-table.spec.ts
npm --prefix frontend run typecheck
```

- [ ] **Step 5: Commit one logical unit**

```text
[ADD] Derive Ledger account table groups
```

---

### Task 3: Add the accessible account creation dialog

**Files:**
- Create: `frontend/src/features/ledger/ui/AccountCreateDialog.tsx`
- Modify: `frontend/src/features/ledger/ui/ledger-ui.ts`
- Modify: `frontend/src/features/ledger/ui/AccountSettingsDialog.tsx`
- Create/Modify: `frontend/tests/presentation/accounts-panel.spec.tsx`

**Produces:**

```ts
export function AccountCreateDialog(props: {
  controller: LedgerController;
  onClose(): void;
  returnFocusRef: React.RefObject<HTMLButtonElement | null>;
}): React.ReactNode;
```

- [ ] **Step 1: Write failing dialog tests**

Assert:

- `Add account` opens a dialog and focuses Account name;
- fields appear in Name → Account type → Currency → Opening balance order;
- only active account types and currencies are selectable;
- submission calls `createAccount` with the exact existing `AccountInput` shape;
- success closes and restores Add-button focus;
- `RavenApiError`/`RavenTransportError` shows its message, unknown errors use `Could not create account.`, and every draft field remains unchanged;
- pending submission disables fields/actions, blocks duplicate submit and Escape;
- Tab stays inside the dialog and idle Escape closes/restores focus.

Use a minimal typed controller fixture local to `accounts-panel.spec.tsx`; do not move SHI-67 tests.

- [ ] **Step 2: Verify RED**

```bash
npm --prefix frontend test -- tests/presentation/accounts-panel.spec.tsx
```

- [ ] **Step 3: Centralize the already-repeated safe Ledger error check**

Move the one-line safe error conversion from `AccountSettingsDialog` into `ledger-ui.ts` and reuse it from both dialogs:

```ts
safeLedgerErrorMessage(error: unknown, fallback: string): string
```

It may reveal only `RavenApiError` and `RavenTransportError` messages. Do not expose arbitrary `Error.message` values.

- [ ] **Step 4: Implement the dialog by following the existing modal lifecycle**

Follow `TransactionCreateDialog.tsx` and use native form controls. Keep the draft local. Opening balance defaults to `0`; do not introduce client-side money parsing or a new amount type because the existing API accepts a decimal string and the server validates precision.

- [ ] **Step 5: Verify GREEN**

```bash
npm --prefix frontend test -- tests/presentation/accounts-panel.spec.tsx tests/presentation/ledger-panel.spec.tsx
npm --prefix frontend run typecheck
```

- [ ] **Step 6: Commit one logical unit**

```text
[ADD] Build Ledger account creation dialog
```

---

### Task 4: Replace the legacy Accounts list with the balance-first table

**Files:**
- Create: `frontend/src/features/ledger/ui/AccountsTable.tsx`
- Modify: `frontend/src/features/ledger/ui/AccountsPanel.tsx`
- Modify: `frontend/src/features/ledger/ui/LedgerTableViewHeader.tsx`
- Modify: `frontend/tests/presentation/accounts-panel.spec.tsx`
- Modify only affected assertions: `frontend/tests/presentation/ledger-panel.spec.tsx`
- Modify only if existing classes cannot express the approved layout: `frontend/src/styles/globals.css`

- [ ] **Step 1: Write failing list/header/selection tests**

Assert:

- default columns are checkbox, Account, Account type, Current balance only;
- balances use the joined currency precision/code and remain compact;
- saved-view filters, sorts, and groups change visible rows through `controller.tableSettings("ledger.accounts")`;
- empty active state says `No accounts yet.` and a filtered-empty state says `No accounts match this view.`;
- row click, Enter, and Space request detail; checkbox interaction does not open detail;
- select-all is scoped to visible rows and sets its native indeterminate state;
- header order is tabs on the left and controls, Account settings, Add account, Delete selected on the right;
- selected delete requires one confirmation and calls only `archiveAccount`;
- a partial multi-delete failure removes successful IDs from selection, retains failed/unattempted visible IDs, and shows a safe error;
- an arbitrary `Error.message` from selected deletion is never rendered;
- after controller refresh removes accounts, stale selected IDs are pruned.

- [ ] **Step 2: Verify RED**

```bash
npm --prefix frontend test -- tests/presentation/accounts-panel.spec.tsx
```

- [ ] **Step 3: Make the header labels minimally reusable**

Add explicit optional labels/ARIA labels rather than a second header implementation. Accounts and Transactions share the same tabs/actions layout; Categories retain their current layout. Keep existing Transaction defaults so unrelated callers do not change.

- [ ] **Step 4: Implement `AccountsTable` using the Transactions table interaction pattern**

Render `AccountRowGroup[]`, the visible-row checkbox state, three data columns, grouped `<tbody>` elements, accessible row labels, and the two empty states. Use `formatMoney(currentBalanceMinor, { code: currencyCode, decimalPlaces })` so inactive currencies remain exact.

- [ ] **Step 5: Reduce `AccountsPanel` to a coordinator**

Remove the inline create/edit form, status/actions/opening-balance columns, restore, purge preview, permanent purge dialog, and `window.confirm`. Keep settings integration. Add only these states:

```text
selected account detail
selected visible IDs
create dialog open
settings dialog open
selected-delete confirmation/pending/error
```

Derive groups from current state/settings on render. Sequentially deactivate selected visible IDs so no new bulk API is invented; stop on first failure, preserve the remaining selection, and report through `safeLedgerErrorMessage`. Do not use `useLifecycleAction`, which currently exposes arbitrary `Error.message`. Confirmation must use `DestructiveConfirmationDialog`.

- [ ] **Step 6: Verify GREEN and regression scope**

```bash
npm --prefix frontend test -- tests/domain/account-table.spec.ts tests/presentation/accounts-panel.spec.tsx tests/presentation/ledger-panel.spec.tsx tests/architecture/design-boundaries.spec.ts
npm --prefix frontend run typecheck
```

- [ ] **Step 7: Commit one logical unit**

```text
[UPDATE] Replace Ledger accounts list workflow
```

---

### Task 5: Add editable account detail with local draft history

**Files:**
- Create: `frontend/src/features/ledger/ui/AccountDetail.tsx`
- Modify: `frontend/src/features/ledger/ui/AccountsPanel.tsx`
- Modify: `frontend/tests/presentation/accounts-panel.spec.tsx`

**Produces:**

```ts
export function AccountDetail(props: {
  controller: LedgerController;
  row: AccountRow;
  onBack(): void;
  onDeleted(): void;
}): React.ReactNode;
```

- [ ] **Step 1: Write failing detail tests**

Assert:

- row activation opens the account detail and Back returns to the preserved table view;
- editable fields are Account name, Account type, Currency, and Opening balance;
- Current balance renders as text and no Current balance input exists;
- Undo/Redo and Ctrl/Cmd+Z, Shift+Z/Ctrl+Y operate on the local draft only;
- Save and Ctrl/Cmd+S call `updateAccount` with exactly the four editable fields and never current balance;
- successful Save updates the draft baseline without leaving detail;
- failed Save retains draft/history and shows a safe inline error, including the existing 409 currency-change response, while arbitrary `Error.message` is never rendered;
- dirty Back requires discard confirmation; clean Back does not;
- Delete requires confirmation, calls only `archiveAccount`, and returns to the table after success;
- failed Delete retains detail and shows a safe error without exposing arbitrary `Error.message`;
- confirmation cancel restores focus to the initiating Back/Delete button;
- pending Save/Delete disables mutations and shortcuts.

- [ ] **Step 2: Verify RED**

```bash
npm --prefix frontend test -- tests/presentation/accounts-panel.spec.tsx
```

- [ ] **Step 3: Implement account-local draft history**

Copy only the small reducer pattern proven in `TransactionDetail.tsx`; do not extract a generic undo framework. Initialize Opening balance with `formatMinorUnits(account.openingBalanceMinor, row.decimalPlaces)` and route Save/Delete failures through `safeLedgerErrorMessage`. Preserve a missing/inactive current type or currency as a disabled current option while choices otherwise remain active-only.

- [ ] **Step 4: Integrate detail selection in `AccountsPanel`**

When detail deletion succeeds, clear the selected detail and let the controller's existing mutation refresh remove the row. If refreshed state no longer contains the selected account, return safely to the table.

- [ ] **Step 5: Verify GREEN and build**

```bash
npm --prefix frontend test -- tests/presentation/accounts-panel.spec.tsx tests/presentation/ledger-panel.spec.tsx
npm --prefix frontend run typecheck
npm --prefix frontend run build
```

- [ ] **Step 6: Commit one logical unit**

```text
[ADD] Build Ledger account detail workflow
```

---

### Task 6: Verify the complete SHI-70 slice and close documentation gaps

**Files:**
- Modify only if an observed behavior changed: `README.md`
- Modify only if an observed behavior changed: `docs/operations/api-reference.md`
- Modify only if an observed behavior changed: `docs/operations/verification-and-smoke.md`
- Create execution evidence: `.superpowers/sdd/2026-08-18-ledger-accounts-ux/task-6-report.md`

- [ ] **Step 1: Run focused Accounts verification**

```bash
npm --prefix frontend test -- tests/domain/account-table.spec.ts tests/presentation/accounts-panel.spec.tsx tests/presentation/ledger-panel.spec.tsx tests/architecture/design-boundaries.spec.ts
```

- [ ] **Step 2: Run all repository quality gates**

```bash
npm --prefix frontend test
npm --prefix frontend run typecheck
npm --prefix frontend run build
cargo fmt --check
cargo test --workspace
cargo clippy --all-targets --all-features -- -D warnings
npm --prefix npm/raven test
git diff --check
```

Every command must exit 0. Record exact counts and any unrelated baseline failure; do not silently broaden SHI-70 to fix unrelated work.

- [ ] **Step 3: Audit final-state docs against the actual diff**

Use the project docs skill. Since no API/schema/CLI/lifecycle policy changes are planned, leave the listed docs untouched unless the implemented UI makes a current statement false. Do not add a speculative feature tour.

- [ ] **Step 4: Perform independent final review**

Review the complete branch diff against the design and Linear acceptance criteria. Block completion on data-loss risk, unsafe error disclosure, permanent purge/restore UI, editable current balance, missing modal/keyboard basics, or unverified selection partial failure.

- [ ] **Step 5: Commit any required docs-only correction**

```text
[DOCS] Align Ledger account UX documentation
```

Skip this commit when no factual documentation change is required.

## Completion Checklist

- [ ] Default Accounts view shows only Account, Account type, and calculated Current balance.
- [ ] Filters, sorts, groups, and saved views affect only `ledger.accounts`.
- [ ] Add and detail failures preserve their drafts and expose only safe errors.
- [ ] Current balance is never editable or sent in a mutation.
- [ ] Single and selected Delete deactivate accounts; no restore or purge UI remains.
- [ ] Account settings remains accessible from the Accounts header.
- [ ] Modal isolation, focus restoration, keyboard row activation, Undo/Redo/Save shortcuts, and confirmations are verified.
- [ ] Frontend and Rust quality gates pass.
- [ ] Linear SHI-70 is updated with the plan, branch/worktree, verification evidence, and final commit range.
