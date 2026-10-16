# Ledger refresh errors behind a creation dialog

Date: 2026-10-16. Related issue: [SHI-146](https://linear.app/shingyusik/issue/SHI-146).
Applies to Ledger transaction creation in the Raven UI.

## Symptoms and reproduction

Save a transaction successfully, then fail the following table query. The creation dialog
retains the saved draft and offers refresh-only recovery, while a background Ledger banner
or table footer also reports the read failure. A failed retry can repeat the duplicate.

## Confirmed cause

`TransactionForm` owns the saved-but-not-refreshed recovery state. `LedgerPanel` independently
renders the controller error, and the table footer exposes its page error when no global
error remains. A successful reference-data read can clear that global error while the table
page still holds a failure.

Modal isolation hides background content from the accessibility tree. Default `getByRole`
queries therefore see only the dialog alert and cannot detect the duplicate background alert.
Adding `{ hidden: true }` reproduced the bug: two alerts instead of one.

## Fix and prevention

The form reports recovery state to `LedgerPanel` through the creation dialog. During recovery,
the panel suppresses its global banner and failed-table footer. The controller retains its
error and retry state. Successful refresh or form unmount releases suppression; retries never
repeat the mutation.

`frontend/tests/presentation/ledger-panel.spec.tsx` counts all alerts, including hidden ones,
for expense, income, and transfer creation. It also covers failed and successful retries,
concurrent refreshes, and clearing errors after a full Ledger remount.

## Verification

- Focused Ledger regressions: 6 passed after reproducing the duplicate-alert failure.
- `npm --prefix frontend test`: all 1,498 tests in 57 files passed in the isolated worktree.
- `npm --prefix frontend test -- tests/presentation/ledger-panel.spec.tsx tests/presentation/ledger-form.spec.tsx`: 163 passed in the final checkout.
- `npm --prefix frontend run typecheck`: passed.
- `npm --prefix frontend run build`: passed in the original checkout. A C:-drive worktree
  using a D:-drive `node_modules` junction failed Next.js module resolution; building with
  the original checkout's local dependencies passed.

Related code: `frontend/src/features/ledger/ui/{LedgerPanel,TransactionCreateDialog,TransactionForm}.tsx`.
Documentation uses source and test validation rather than TDD because it changes no runtime behavior.
