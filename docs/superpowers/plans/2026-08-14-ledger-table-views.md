# Ledger Table Views Implementation Plan

> **For Codex:** Use the executing-plans skill and implement each task test-first.

**Goal:** Give Transactions, Accounts, and Categories independent ToDo-style saved views backed by the existing preference API and shared table-view UI.

**Architecture:** Reuse the generic `table-view-tabs` state machine and the existing `TableViewTabs`, `TableViewControls`, active pills, and confirmation dialog. Add only the Ledger fields needed by the shared controls, keep Ledger normalization/persistence in the Ledger feature, and leave row filtering/sorting/grouping to SHI-69/70/71.

**Tech Stack:** React 18, TypeScript, Vitest, Testing Library, existing Raven preference API.

---

## Task 1: Define Ledger view settings and scope-local normalization

**Files:**
- Create: `frontend/src/features/ledger/model/ledger-table-views.ts`
- Test: `frontend/tests/domain/ledger-table-views.spec.ts`
- Modify: `frontend/src/features/workbench/model/planner-model.ts`

1. Write failing model tests for the three stable scopes, scope-specific defaults, valid rule preservation, invalid field removal, and malformed-scope-only recovery.
2. Run `npm --prefix frontend test -- ledger-table-views.spec.ts` and confirm failure.
3. Add the minimum Ledger scope/settings adapter using the existing table-view tab/settings primitives.
4. Extend the shared field/group unions only with the Ledger values used by the model; keep Planner normalization unchanged.
5. Re-run the focused model test.

## Task 2: Persist and control Ledger views

**Files:**
- Modify: `frontend/src/features/ledger/hooks/useLedgerController.ts`
- Test: `frontend/tests/presentation/ledger-panel.spec.tsx`

1. Write failing hook tests proving `/api/v1/preferences/ledger.views.v1` loads independently, malformed sibling scopes recover locally, and create/rename/save/delete commands persist only Ledger views.
2. Run the focused presentation test and confirm failure.
3. Add Ledger view state, serialized preference writes, stable tab IDs, dirty-selection confirmation, and controller commands by delegating to the shared table-view state machine.
4. Re-run the focused controller tests.

## Task 3: Render shared tabs, controls, pills, and confirmation

**Files:**
- Create: `frontend/src/features/ledger/ui/LedgerTableViewHeader.tsx`
- Modify: `frontend/src/features/ledger/ui/LedgerPanel.tsx`
- Modify: `frontend/src/features/ledger/ui/AccountsPanel.tsx`
- Modify: `frontend/src/features/ledger/ui/CategoriesPanel.tsx`
- Modify: `frontend/src/features/workbench/ui/TableViewControls.tsx`
- Test: `frontend/tests/presentation/ledger-panel.spec.tsx`

1. Write failing presentation tests for independent scope tabs, Ledger field menus/pills, create/rename/save/delete, Escape dismissal, and focus restoration.
2. Run the focused test and confirm failure.
3. Add Ledger field metadata to the shared control field map without duplicating the component.
4. Add one Ledger header adapter and render it in the three table panels; render the shared confirmation dialog once in `LedgerPanel`.
5. Re-run the focused presentation tests.

## Task 4: Verify and document the delivered boundary

**Files:**
- Modify only if required by docs checks: Ledger UX specs or operations references.

1. Run `npm --prefix frontend test`.
2. Run `npm --prefix frontend run typecheck`.
3. Run `npm --prefix frontend run build`.
4. Run relevant Rust preference tests if backend behavior was touched.
5. Inspect the diff for accidental lockfile churn and unrelated changes.
6. Run the project documentation update/check skills; document only behavior that is now true.
