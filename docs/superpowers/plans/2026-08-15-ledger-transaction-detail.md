# Ledger Transaction Detail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the inline Ledger transaction editor with a dedicated, undoable detail view that safely updates or archives ordinary entries and atomic transfer pairs.

**Architecture:** Keep `LedgerService` as the only mutation boundary by adding one atomic transfer-update operation beside transfer creation. Expose that operation through one authenticated API route, then add a Ledger-owned detail presentation that reuses the existing ToDo header and destructive-confirmation interaction without introducing a shared abstraction.

**Tech Stack:** Rust 2024, Axum, SQLite, TypeScript, React 18, Vitest, Testing Library

## Global Constraints

- Follow `docs/superpowers/specs/2026-08-13-ledger-transactions-ux-design.md`.
- Do not expose audit history, internal IDs, source metadata, written timestamps, purge, or restore in the UI.
- Every mutation goes through `LedgerService` and writes audit history.
- Transfer edits and archives operate on the validated pair atomically.
- Failed saves preserve the draft and local undo/redo history.
- Add no dependencies and do not refactor unrelated Ledger screens.

---

### Task 1: Atomic transfer update service

**Files:**
- Modify: `ledger-engine/src/application/transfers.rs`
- Test: `ledger-engine/tests/integration/transfers.rs`

**Interfaces:**
- Consumes: existing `LedgerMutationRepository`, `validate_transfer_pair`, account/currency resolution, and audit insertion.
- Produces: `UpdateTransferCommand` and `LedgerService::update_transfer(&str, UpdateTransferCommand) -> LedgerResult<TransferView>`.

- [ ] **Step 1: Write failing integration tests**

Add tests proving one call changes both transfer entries, preserves their IDs/group/written timestamps/source, emits one `record_type = "transfer"` update audit event, and rolls back both rows on invalid accounts or currency.

```rust
let updated = service.update_transfer(
    &created.transfer_group_id,
    UpdateTransferCommand {
        date: "2026-08-15".into(),
        content: "Move savings".into(),
        from_account: "checking".into(),
        to_account: "savings".into(),
        amount: Money::from_minor(25_000),
        currency: "krw".into(),
        notes: Some("monthly".into()),
        actor: "test".into(),
        reason: None,
    },
)?;
assert_eq!(updated.out_entry.entry.content(), "Move savings");
assert_eq!(updated.in_entry.entry.content(), "Move savings");
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `cargo test -p ledger-engine --test integration transfers::update_transfer -- --nocapture`

Expected: compilation fails because `UpdateTransferCommand` and `update_transfer` do not exist.

- [ ] **Step 3: Implement the minimal atomic service operation**

Resolve and validate the existing pair inside one repository transaction, resolve the two active accounts and currency, construct both updated `LedgerEntry` values while retaining immutable metadata, update both rows, insert one paired before/after audit event, commit, and return the existing `TransferView` shape.

```rust
pub struct UpdateTransferCommand {
    pub date: String,
    pub content: String,
    pub from_account: String,
    pub to_account: String,
    pub amount: Money,
    pub currency: String,
    pub notes: Option<String>,
    pub actor: String,
    pub reason: Option<String>,
}

pub fn update_transfer(
    &mut self,
    transfer_group_id: &str,
    command: UpdateTransferCommand,
) -> LedgerResult<TransferView>;
```

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run: `cargo test -p ledger-engine --test integration transfers::update_transfer -- --nocapture`

Expected: all focused transfer-update cases pass.

### Task 2: Transfer update API contract

**Files:**
- Modify: `raven-api/src/dto/ledger.rs`
- Modify: `raven-api/src/routes/ledger.rs`
- Modify: `docs/operations/api-reference.md`
- Test: `raven-api/tests/routes_ledger.rs`

**Interfaces:**
- Consumes: `UpdateTransferCommand` from Task 1 and the shared safe error mapper.
- Produces: `PATCH /api/v1/ledger/transfers/:id` accepting user-editable transfer fields only.

- [ ] **Step 1: Write failing API tests**

Cover successful pair updates, unknown-field rejection, malformed amounts, missing transfer groups, invalid pair/account errors, and generic safe responses without IDs, paths, SQL, or raw storage details.

```json
{
  "date": "2026-08-15",
  "content": "Move savings",
  "from_account": "Checking",
  "to_account": "Savings",
  "amount": "25000",
  "currency": "KRW",
  "notes": "monthly",
  "actor": "raven-api"
}
```

- [ ] **Step 2: Run the focused API tests and verify RED**

Run: `cargo test -p raven-api --test routes_ledger update_transfer -- --nocapture`

Expected: `PATCH /transfers/:id` returns method-not-allowed or the DTO/handler is missing.

- [ ] **Step 3: Add the strict DTO and route**

Add `UpdateTransferBody`, register `.route("/transfers/:id", get(get_transfer).patch(update_transfer))`, parse money using the selected currency precision, and call only `service.update_transfer`.

```rust
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UpdateTransferBody {
    pub date: String,
    pub content: String,
    pub from_account: String,
    pub to_account: String,
    pub amount: String,
    pub currency: String,
    pub notes: Option<String>,
    #[serde(default = "default_actor")]
    pub actor: String,
    pub reason: Option<String>,
}
```

- [ ] **Step 4: Document and verify the route**

Update the Ledger route table to list `GET/PATCH /transfers/:id`.

Run: `cargo test -p raven-api --test routes_ledger update_transfer -- --nocapture`

Expected: all focused route tests pass.

### Task 3: Frontend transfer mutation and logical detail model

**Files:**
- Modify: `frontend/src/features/ledger/model/ledger-model.ts`
- Modify: `frontend/src/features/ledger/model/transaction-table.ts`
- Modify: `frontend/src/features/ledger/api/ledger-api.ts`
- Modify: `frontend/src/features/ledger/hooks/useLedgerController.ts`
- Test: `frontend/tests/domain/ledger-model.spec.ts`
- Test: `frontend/tests/domain/transaction-table.spec.ts`

**Interfaces:**
- Consumes: the Task 2 PATCH contract and existing transfer projection validation.
- Produces: `TransferUpdate`, `ledgerApi.updateTransfer`, `controller.updateTransfer`, and a logical row retaining both transfer sides for detail initialization.

- [ ] **Step 1: Write failing model/API tests**

Assert a valid logical transfer row retains its out/in views and that `updateTransfer(groupId, input)` sends PATCH without creation-only `operation_key`, `written_at`, or `source`.

```ts
await ledgerApi.updateTransfer("group-1", {
  date: "2026-08-15",
  content: "Move savings",
  fromAccount: "checking",
  toAccount: "savings",
  amount: "25000",
  currency: "krw",
  notes: "monthly",
});
```

- [ ] **Step 2: Run focused frontend tests and verify RED**

Run: `npm --prefix frontend test -- ledger-model.spec.ts transaction-table.spec.ts`

Expected: missing transfer-update API and logical pair fields fail compilation/assertions.

- [ ] **Step 3: Add the minimal types, mapping, and controller method**

Keep creation `TransferInput` unchanged; add a separate update type so hidden immutable fields cannot be sent accidentally. Extend `TransactionRow` only with the paired input needed by the detail view.

```ts
export type TransferUpdate = Omit<TransferInput, "writtenAt" | "source"> & {
  reason?: string | null;
};

updateTransfer(id: string, input: TransferUpdate): Promise<void>;
```

- [ ] **Step 4: Run focused frontend tests and verify GREEN**

Run: `npm --prefix frontend test -- ledger-model.spec.ts transaction-table.spec.ts`

Expected: focused model tests pass.

### Task 4: Dedicated transaction detail with draft history

**Files:**
- Create: `frontend/src/features/ledger/ui/TransactionDetail.tsx`
- Modify: `frontend/src/features/ledger/ui/LedgerPanel.tsx`
- Modify: `frontend/src/styles/globals.css`
- Test: `frontend/tests/presentation/ledger-panel.spec.tsx`

**Interfaces:**
- Consumes: `TransactionRow`, `controller.updateEntry`, `controller.updateTransfer`, `controller.archive`, and `DestructiveConfirmationDialog`.
- Produces: a list-replacing detail view with Back, Undo, Redo, Save, and Archive actions.

- [ ] **Step 1: Write failing presentation tests for structure and fields**

Assert row activation replaces the table with a `.detail-view`, header actions are ordered Back/Undo/Redo/Save/Archive, expense/income fields expose only Content/Date/Type/Account/Category/Amount/Currency/Note, and transfers expose source/destination without Category or hidden metadata.

```tsx
await user.click(screen.getByRole("button", { name: /Open details for Lunch/ }));
expect(screen.queryByRole("table", { name: "Transactions" })).toBeNull();
expect(screen.getByRole("region", { name: "Lunch details" })).toBeInTheDocument();
expect(screen.queryByLabelText("Written at")).toBeNull();
```

- [ ] **Step 2: Run the structure test and verify RED**

Run: `npm --prefix frontend test -- ledger-panel.spec.tsx -t "transaction detail"`

Expected: the current inline form leaves the table visible and lacks the detail header.

- [ ] **Step 3: Implement the dedicated detail shell and exact fields**

Move edit-only behavior out of `TransactionForm`; keep that component focused on creation. Initialize a complete draft from the logical row, restrict ordinary Type choices to Expense and Income, preserve immutable written/source data in service updates, and use native inputs/selects/textarea.

- [ ] **Step 4: Write failing Undo/Redo/Save tests**

Cover button boundaries, Ctrl/Cmd+S, Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl+Y, redo clearing after a new edit, no request before Save, successful baseline replacement, failed save preserving draft/history, and shortcut suppression during composition or dialogs.

- [ ] **Step 5: Run history tests and verify RED**

Run: `npm --prefix frontend test -- ledger-panel.spec.tsx -t "Undo|Redo|failed transaction save"`

Expected: draft-history assertions fail because no local history exists.

- [ ] **Step 6: Implement minimal snapshot history and save dispatch**

Store `past`, `present`, and `future` complete drafts locally. Coalesce consecutive text edits while the same control remains focused; close the group on blur, save, undo, or redo. Dispatch ordinary and transfer saves through their distinct controller methods.

- [ ] **Step 7: Run presentation tests and verify GREEN**

Run: `npm --prefix frontend test -- ledger-panel.spec.tsx ledger-form.spec.tsx`

Expected: detail behavior passes and creation dialog behavior remains unchanged.

### Task 5: Detail navigation, archive, and regression verification

**Files:**
- Modify: `frontend/src/features/ledger/ui/TransactionDetail.tsx`
- Modify: `frontend/src/features/ledger/ui/LedgerPanel.tsx`
- Test: `frontend/tests/presentation/ledger-panel.spec.tsx`

**Interfaces:**
- Consumes: the Task 4 detail state and existing archive controller operation.
- Produces: guarded Back and recoverable Archive flows that return to the unchanged Transactions view.

- [ ] **Step 1: Write failing Back and Archive tests**

Cover clean Back, dirty Back confirmation with Cancel/Discard, archive confirmation copy, dirty archive warning, single submission, pending action locks, safe retryable errors, atomic transfer archive, immediate row disappearance, and restoration of focus to the originating row when it remains.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm --prefix frontend test -- ledger-panel.spec.tsx -t "Back|Archive transaction"`

Expected: confirmation and navigation assertions fail.

- [ ] **Step 3: Implement guarded navigation and archive**

Reuse `DestructiveConfirmationDialog`; keep the detail mounted on failure, close only after the service and refresh succeed, and retain current saved-view/filter/sort/group state because `LedgerPanel` remains mounted.

- [ ] **Step 4: Run focused and full verification**

Run:

```bash
cargo fmt --check
cargo test -p ledger-engine
cargo test -p raven-api --test routes_ledger
cargo clippy --all-targets --all-features -- -D warnings
npm --prefix frontend test
npm --prefix frontend run typecheck
npm --prefix frontend run build
```

Expected: all commands pass without warnings or regressions.

- [ ] **Step 5: Update Linear after verified completion**

Add a concise SHI-72 completion comment with the verified commands, then move SHI-72 to Done. Do not include tokens, paths, SQL, or raw storage errors.
