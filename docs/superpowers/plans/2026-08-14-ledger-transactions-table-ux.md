# Ledger Transactions Table UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render active Ledger entries as a configurable, accessible Transactions table with one logical row per transfer and recoverable bulk archive.

**Architecture:** Keep the existing Ledger API and application-service mutation boundary. A small Ledger model module projects loaded entry views into logical rows, applies the saved table settings, and returns grouped rows; the table component owns only ephemeral selection and confirmation state. Shared ToDo filter-value semantics are reused, while Ledger supplies its own fields and grouping keys.

**Tech Stack:** React 18, TypeScript, Vitest, Testing Library, existing Raven Ledger controller and shared table-view controls.

---

## File map

- Create `frontend/src/features/ledger/model/transaction-table.ts`: active-entry projection, transfer pairing, Ledger field values, filtering, sorting, and grouping.
- Create `frontend/tests/domain/transaction-table.spec.ts`: deterministic model coverage for active rows, transfer pairs, filters, sorts, and calendar groups.
- Modify `frontend/src/features/workbench/model/planner-model.ts`: export the existing value-level filter matcher so Ledger can reuse ToDo operator behavior without copying it.
- Modify `frontend/src/features/workbench/model/planner-group-settings.ts`: allow the already-shared group settings type to preserve Ledger calendar group values.
- Modify `frontend/src/features/ledger/model/ledger-table-views.ts`: expose the approved Transactions sort and group choices.
- Modify `frontend/src/features/ledger/ui/LedgerTableViewHeader.tsx`: derive group candidate counts from active logical transactions and place Delete beside the shared controls and Add action.
- Replace `frontend/src/features/ledger/ui/TransactionsTable.tsx`: compact logical rows, signed amounts, selection, row activation, and archive confirmation; remove restore/purge actions.
- Modify `frontend/src/features/ledger/ui/LedgerPanel.tsx`: connect settings, delete action state, and row activation to the table.
- Modify `frontend/src/styles/globals.css`: add only the amount polarity and logical group-row styles not already supplied by `items-table`.
- Modify `frontend/tests/presentation/ledger-panel.spec.tsx`: end-to-end presentation behavior and service calls.

### Task 1: Logical transaction row projection

**Files:**
- Create: `frontend/src/features/ledger/model/transaction-table.ts`
- Create: `frontend/tests/domain/transaction-table.spec.ts`

- [ ] **Step 1: Write failing projection tests**

Add fixtures for an expense, income, archived expense, a valid `transfer_out`/`transfer_in` pair sharing `transferGroupId`, and an unmatched transfer side. Assert:

```ts
expect(projectTransactionRows(entries).map((row) => row.id).sort()).toEqual([
  "expense-1",
  "income-1",
  "transfer-group-1",
]);
expect(projectTransactionRows(entries).find((row) => row.kind === "transfer")).toMatchObject({
  kind: "transfer",
  accountLabel: "Cash → Bank",
  categoryLabel: "",
  archiveEntryId: "transfer-out-1",
});
expect(projectTransactionRows(entries).some((row) => row.id === "archived-1")).toBe(false);
expect(projectTransactionRows(entries).some((row) => row.id === "unmatched-transfer")).toBe(false);
```

The fixture order must be deliberately unsorted so the default date-descending assertion proves sorting rather than input order.

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `npm --prefix frontend test -- transaction-table.spec.ts`

Expected: FAIL because `transaction-table.ts` and `projectTransactionRows` do not exist.

- [ ] **Step 3: Implement the minimal logical row model**

Define and export:

```ts
export type TransactionRow = {
  id: string;
  archiveEntryId: string;
  detailEntry: LedgerEntryView;
  kind: "expense" | "income" | "transfer";
  date: string;
  content: string;
  accountIds: string[];
  accountLabel: string;
  categoryId: string | null;
  categoryLabel: string;
  amountMinor: number;
  currencyId: string;
  currencyCode: string;
  updatedAt: string;
};

export function projectTransactionRows(entries: LedgerEntryView[]): TransactionRow[];
```

Implementation rules:

- discard every entry with non-null `deletedAt` before pairing;
- map `expense`/`adjustment_out` to expense and `income`/`adjustment_in` to income, preserving existing records while keeping adjustment creation out of the UI;
- group transfer sides by non-null `transferGroupId` and emit one row only when the group has exactly one active `transfer_out`, exactly one active `transfer_in`, matching amount and currency, and distinct accounts;
- use the out entry as `detailEntry` and `archiveEntryId`;
- use `transferGroupId` as the stable row ID;
- omit malformed/incomplete transfer groups instead of exposing a non-atomic transaction row.

- [ ] **Step 4: Run the focused test and confirm GREEN**

Run: `npm --prefix frontend test -- transaction-table.spec.ts`

Expected: all projection tests PASS.

- [ ] **Step 5: Commit the projection**

```bash
git add frontend/src/features/ledger/model/transaction-table.ts frontend/tests/domain/transaction-table.spec.ts
git commit -m "[ADD] Project Ledger transaction rows"
```

### Task 2: Apply saved filters, sorts, and groups

**Files:**
- Modify: `frontend/src/features/workbench/model/planner-model.ts`
- Modify: `frontend/src/features/workbench/model/planner-group-settings.ts`
- Modify: `frontend/src/features/ledger/model/ledger-table-views.ts`
- Modify: `frontend/src/features/ledger/model/transaction-table.ts`
- Modify: `frontend/tests/domain/planner-model.spec.ts`
- Modify: `frontend/tests/domain/ledger-table-views.spec.ts`
- Modify: `frontend/tests/domain/transaction-table.spec.ts`

- [ ] **Step 1: Write failing view-derivation tests**

Cover all approved controls with compact table-driven cases:

```ts
expect(deriveTransactionGroups(rows, defaultLedgerTableSettings("ledger.transactions")))
  .toEqual([{ key: "all", label: null, rows: [newest, older] }]);

expect(filterRows(rows, [dateRule, typeRule, accountRule, categoryRule, amountRule, contentRule], "and"))
  .toEqual([matchingExpense]);

expect(groupRows(rows, "month").map(({ key }) => key)).toEqual(["2026-08", "2026-07"]);
expect(groupRows(rows, "week")[0]?.label).toMatch(/^Week /);
expect(groupRows(rows, "day")[0]?.key).toBe("2026-08-14");
```

Also assert Transactions sort fields are exactly Date, Content, Account, Category, Amount, Updated and group choices are exactly None, Month, Week, Day, Account, Category, Type. Existing ToDo settings normalization tests must remain unchanged.

- [ ] **Step 2: Run the focused model tests and confirm RED**

Run: `npm --prefix frontend test -- transaction-table.spec.ts ledger-table-views.spec.ts planner-model.spec.ts`

Expected: FAIL for missing calendar groups, missing updated sort choice, and missing derivation functions.

- [ ] **Step 3: Export the existing shared filter primitive**

Rename the private `matchesPlannerFilterRule` value branch to an exported value-level helper without changing ToDo behavior:

```ts
export function matchesPlannerFilterValue(
  value: string | string[] | number | null | undefined,
  rule: PlannerFilterRule,
  today: string,
): boolean;
```

Keep `matchesPlannerFilterRules` calling this helper after `plannerFilterValue(...)`. Do not duplicate the date, number, text, relation, or empty-value operator implementations.

- [ ] **Step 4: Extend only the shared field/group vocabulary required by Ledger**

Add `month`, `week`, and `day` to `PlannerGroupBy` and the normalization set. Keep `updated` as a sort-only field. Change `ledgerSortFieldsForScope("ledger.transactions")` to return:

```ts
["date", "content", "account", "category", "amount", "updated"]
```

and change the Transactions group options to:

```ts
[
  { value: "none", label: "None" },
  { value: "month", label: "Month" },
  { value: "week", label: "Week" },
  { value: "day", label: "Day" },
  { value: "account", label: "Account" },
  { value: "category", label: "Category" },
  { value: "entry_type", label: "Type" },
]
```

- [ ] **Step 5: Implement Ledger derivation**

Export:

```ts
export type TransactionRowGroup = {
  key: string;
  label: string | null;
  rows: TransactionRow[];
};

export function deriveTransactionGroups(
  entries: LedgerEntryView[],
  settings: PlannerTableSettings,
  today?: string,
): TransactionRowGroup[];
```

Use `effectivePlannerFilterRules`, `matchesPlannerFilterValue`, and a Ledger `transactionFieldValue(row, field)` mapper. Apply stable multi-rule sorting with row ID as the final tie-breaker. Calendar keys use ISO dates; week grouping uses ISO Monday-start week keys calculated with built-in `Date` UTC methods. Account grouping uses the source account for transfers so every logical transaction remains one row. Category-less rows use `uncategorized`; type uses the public `kind`.

- [ ] **Step 6: Run the model tests and confirm GREEN**

Run: `npm --prefix frontend test -- transaction-table.spec.ts ledger-table-views.spec.ts planner-model.spec.ts`

Expected: all focused model tests PASS.

- [ ] **Step 7: Commit settings and derivation**

```bash
git add frontend/src/features/workbench/model/planner-model.ts frontend/src/features/workbench/model/planner-group-settings.ts frontend/src/features/ledger/model/ledger-table-views.ts frontend/src/features/ledger/model/transaction-table.ts frontend/tests/domain/planner-model.spec.ts frontend/tests/domain/ledger-table-views.spec.ts frontend/tests/domain/transaction-table.spec.ts
git commit -m "[UPDATE] Apply Ledger transaction views"
```

### Task 3: Render and archive logical rows

**Files:**
- Modify: `frontend/src/features/ledger/ui/LedgerTableViewHeader.tsx`
- Replace: `frontend/src/features/ledger/ui/TransactionsTable.tsx`
- Modify: `frontend/src/features/ledger/ui/LedgerPanel.tsx`
- Modify: `frontend/src/styles/globals.css`
- Modify: `frontend/tests/presentation/ledger-panel.spec.tsx`

- [ ] **Step 1: Write failing presentation tests**

Render mixed ordinary, transfer, and archived entries and assert:

```ts
expect(screen.getAllByRole("row")).toHaveLength(expectedLogicalRowsPlusHeaderAndGroups);
expect(screen.getByText("Cash → Bank")).toBeInTheDocument();
expect(screen.queryByText("Archived lunch")).not.toBeInTheDocument();
expect(screen.queryByRole("columnheader", { name: "Type" })).not.toBeInTheDocument();
expect(screen.getByText("+\u20a910,000")).toHaveClass("ledger-amount-positive");
expect(screen.getByText("-\u20a912,000")).toHaveClass("ledger-amount-negative");
```

Then cover:

- selection checkbox and select-all over currently visible logical rows;
- Delete disabled with no selection and enabled after selection;
- confirmation followed by one `controller.archive(row.archiveEntryId)` call per logical row, including only the out-entry representative for a transfer;
- selected rows disappearing after the mocked loaded state refresh;
- row click, Enter, and Space each invoking the existing detail-entry callback once;
- checkbox interaction not opening detail;
- filters/sorts/groups changing rendered rows according to `controller.tableSettings`;
- controls, Add, then Delete appearing in the right-side header action row;
- no Restore or Purge controls anywhere in Transactions.

- [ ] **Step 2: Run the presentation test and confirm RED**

Run: `npm --prefix frontend test -- ledger-panel.spec.tsx`

Expected: FAIL because the current table renders raw entries and per-row lifecycle buttons.

- [ ] **Step 3: Move the Delete trigger into the shared Ledger table header row**

Extend `LedgerTableViewHeader` with:

```ts
onDelete?: () => void;
deleteDisabled?: boolean;
```

Render the existing `Trash2` icon button after Add with `aria-label="Archive selected transactions"`. Do not create a second toolbar or a Ledger-specific control menu.

- [ ] **Step 4: Replace raw-entry rendering with logical grouped rows**

`TransactionsTable` receives `settings`, `selectedIds`, and callbacks from `TransactionsPanel`. Render the exact columns:

```tsx
<th className="selection-column">...</th>
<th>Date</th>
<th>Content</th>
<th>Account</th>
<th>Category</th>
<th>Amount</th>
```

Use one focusable `<tr role="button" tabIndex={0}>` per logical row. Stop propagation from checkboxes. Format income as `+${formatMoney(...)}`, expense as `-${formatMoney(...)}`, and transfer with no sign; apply `ledger-amount-positive`, `ledger-amount-negative`, or `ledger-amount-neutral` on the amount cell.

Render a single full-width group heading row before each group when grouping is active. For an empty result distinguish `No transactions yet.` from `No transactions match this view.`

- [ ] **Step 5: Implement selection and confirmation in `TransactionsPanel`**

Keep ephemeral `selectedIds: string[]` beside the existing dialog state. Reconcile it against derived visible rows after entry/settings changes. Select-all affects visible logical rows only. Confirmation uses `DestructiveConfirmationDialog` with:

```tsx
title="Archive selected transactions?"
description={`${selectedIds.length} transactions will be archived and removed from Ledger views.`}
```

On confirm, archive selected rows sequentially through `controller.archive(row.archiveEntryId)` so refreshes cannot race. Clear only successfully archived IDs; keep failures selected and display the existing safe lifecycle error.

- [ ] **Step 6: Add the minimum CSS**

Reuse `items-table`, `selection-column`, and existing focus styles. Add only:

```css
.ledger-amount-positive { color: var(--color-aloe-strong); }
.ledger-amount-negative { color: var(--color-danger-text); }
.ledger-amount-neutral { color: inherit; }
```

Do not add a new table layout system.

- [ ] **Step 7: Run presentation and regression tests**

Run: `npm --prefix frontend test -- ledger-panel.spec.tsx ledger-form.spec.tsx workbench-wireframe.spec.tsx`

Expected: all focused presentation tests PASS; SHI-66 creation dialog and shared ToDo table controls remain green.

- [ ] **Step 8: Commit the table UI**

```bash
git add frontend/src/features/ledger/ui/LedgerTableViewHeader.tsx frontend/src/features/ledger/ui/TransactionsTable.tsx frontend/src/features/ledger/ui/LedgerPanel.tsx frontend/src/styles/globals.css frontend/tests/presentation/ledger-panel.spec.tsx
git commit -m "[UPDATE] Build Ledger transactions table"
```

### Task 4: Verify the service boundary and final change

**Files:**
- Modify only if verification exposes an SHI-69 defect.

- [ ] **Step 1: Prove transfer archive remains service-atomic**

Run: `cargo test -p ledger-engine transfer_lifecycle_updates_and_purges_the_validated_pair_together`

Expected: matching Ledger lifecycle tests PASS and confirm one `archive_entry` request archives both validated transfer entries.

- [ ] **Step 2: Run the complete frontend suite**

Run: `npm --prefix frontend test`

Expected: every test file and test PASS.

- [ ] **Step 3: Run static and production checks**

Run: `npm --prefix frontend run typecheck`

Expected: exit 0 with no TypeScript errors.

Run: `npm --prefix frontend run build`

Expected: Next.js production build completes successfully.

- [ ] **Step 4: Inspect the final diff**

Run: `git diff --check`

Expected: no whitespace errors.

Run: `git status --short`

Expected: only SHI-69 implementation/test files are present before the final commit, or empty after it.

- [ ] **Step 5: Check stable documentation**

Compare the final behavior with `docs/superpowers/specs/2026-08-13-ledger-transactions-ux-design.md`, `README.md`, and `docs/operations/api-reference.md`. Do not edit stable docs when the implementation merely realizes the already-approved UI spec and does not change API behavior.

- [ ] **Step 6: Commit any verification-driven correction**

If Step 1-5 required a code correction, stage only that correction and its regression test, then commit:

```bash
git commit -m "[FIX] Complete Ledger transaction table verification"
```

If no correction was needed, do not create an empty commit.
