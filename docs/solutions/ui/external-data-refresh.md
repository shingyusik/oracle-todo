# External SQLite changes and UI drafts

Date: 2026-10-14. Applies to Raven's SQLite-backed CLI, API, MCP, and static UI.

## Symptoms and reproduction

Keep a Raven UI table open, then create or update a record through CLI, a separate MCP
process, or another browser using the same data home. The database changes, but the open
table retains its last query result until another read occurs.

## Confirmed causes

- Controllers refreshed after their own mutations and had no external invalidation channel.
- In-process notifications cannot observe commits made by another process.
- SQLite `PRAGMA data_version` comparisons require the same connection across reads.
  Opening a fresh monitoring connection every tick loses that baseline.
- Background refresh exposed editor-close effects when a record disappeared from active
  rows. Replacing list snapshots also advanced ToDo's optimistic-lock version while its
  open editor still held an older draft.
- A delayed initial Dashboard read could overwrite a completed SSE resync. A failed resync
  could leave the initial loading state active after the old request was invalidated.
- Starting a report refresh only after table reads completed could restore the report period
  captured before those reads, overwriting a newer user selection.

The change-stream, controller, and form regression tests reproduce these paths.

## Fix

One shared watcher runs while SSE subscribers exist. Persistent read-only connections
check the three stores' `data_version` once per second without initializing or migrating
stores. Per-domain epochs retain invalidations from multiple domains for slow subscribers.
Each authenticated SSE connection resyncs all domains after monitoring baselines are
established; subsequent events name only changed domains.

One browser SSE connection feeds mounted controllers and Dashboard highlights. Controllers
combine notifications received during a refresh into one trailing refresh. Open editors
retain drafts when their active row disappears. ToDo keeps the editor's version separate
from background list snapshots and advances it after its own successful mutation.
Dashboard reads use generation checks; an unavailable initial resync exposes the existing
error state instead of remaining in loading state.
Ledger starts report and table refreshes together so report generation checks preserve
period selections made while table reads are pending.

## Verification and prevention

- `cargo test -p raven-api --test changes`: 3 passed; authentication, missing-store reads,
  WAL commits, all three domains, multiple subscribers, reconnect, and rollback.
- `cargo test --workspace notifies_an_independent_ui_router -- --test-threads=1`: CLI and MCP
  integration tests passed against temporary homes and an independently constructed UI router.
- Frontend regressions cover subscription cleanup, domain filtering, malformed messages,
  trailing refreshes, unfinished forms, externally archived edit targets, ToDo optimistic
  locks, and delayed or failed initial Dashboard resyncs.
- `npm --prefix frontend test`: 1,494 tests passed. The final report-period fix was then
  verified with `npm --prefix frontend test -- tests/presentation/ledger-panel.spec.tsx`:
  147 passed, including the added concurrency regression.
- `npm --prefix frontend run typecheck`, `npm --prefix frontend run build`, and
  `npm --prefix npm/raven test`: passed; the wrapper suite has 51 tests.
- `cargo test --workspace --exclude health-engine --exclude ledger-engine -- --test-threads=1`:
  passed. `cargo fmt --check` and strict Clippy for `raven-api` and `raven-cli` with
  `--all-targets --all-features --no-deps -- -D warnings` also passed.
- `cargo build --release -p raven-cli`: passed in Ubuntu. Debug and release UI HTTP smoke
  checks passed with temporary homes, session authentication, and CLI writes to all three stores.
- Browser verification against the main UI artifact and Ubuntu release binary passed:
  independent CLI additions appeared without a page reload in ToDo Tasks, Ledger Categories,
  and Health Diet. Unsaved titles, category names, food names, and notes stayed intact.
  An external edit to the open ToDo item caused a save conflict while retaining the draft.
  After restarting the release server and reopening its session URL, a further CLI category
  addition refreshed both the table and parent choices while the creation draft stayed intact.

The full Rust gate exposed an unchanged Ledger test failure,
`transfers::concurrent_retries_with_one_operation_key_converge_on_one_transfer`, with
`Busy("database is locked")`; it also failed when run alone. Health's full sequential suite
passed after an initial parallel-run lock timeout. Full-workspace Clippy stopped at an
existing Unix `collapsible_if` warning in `health-engine/src/infrastructure/media.rs`.
Windows native verification could not link without MSVC. An external Cloudflare Access
deployment was not exercised; MCP adapter and authenticated local UI HTTP paths were tested.

Documentation edits were checked against the route, source, and regression tests. They use
source-contract validation rather than TDD because they do not change runtime behavior.

Keep monitoring connections separate from mutation connections: SQLite does not advance
`data_version` for a connection's own commits. Keep drafts and concurrency baselines separate
from refreshed table caches. Avoid remounting editors to force a refresh.

Related code: `raven-api/src/changes.rs`, `frontend/src/lib/data-changes.ts`, and the three
domain controller hooks. Endpoint contract: `docs/operations/api-reference.md`.

## Ledger detail revalidation

Date: 2026-10-16. Related issue: [SHI-147](https://linear.app/shingyusik/issue/SHI-147).

Open a transaction detail without editing, then archive it through another adapter using
the same home. After the external refresh, the detail can retain the archived transaction.
Saving an edited stale transaction can return `404` without leaving the detail.

Transaction form references do not load entry history. `state.entries` remembers rows from
earlier pages rather than proving their current existence, so its fallback can retain an
externally archived row. Absence from a filtered or paginated result alone also cannot prove
archival. The single-entry API returns an `EntryView`; decoding it as a bare entry fails
with `Raven API returned invalid ledger entry.id.`

After a successful table refresh omits the open row, the detail checks that entry by ID;
transfers check both entry IDs. A confirmed `404` closes a clean detail. Filtered active rows
and failed lookups retain the detail. Unsaved drafts survive external archival, including
edits begun while the lookup is pending. A save returning `404` closes the detail and hides
its stale row. Single-entry reads decode the `EntryView` envelope before returning its entry.

Regression coverage in `frontend/tests/presentation/ledger-panel.spec.tsx` uses the production
controller for external refreshes and save/list/remount behavior, with mocked API storage.
It covers expense, income, either transfer side, failed lookups, and draft preservation.
`frontend/tests/domain/ledger-api.spec.ts` checks the real wire-response shape.

Verification: 11 focused tests passed in both checkouts after reproducing the stale-detail
and decoder failures. `npm --prefix frontend test` passed all 1,550 tests in 60 files in the
isolated worktree. `npm --prefix frontend run typecheck` passed in both checkouts;
`npm --prefix frontend run build` and `git diff --check` passed in the original checkout.
Browser/SQLite end-to-end verification and Rust checks were not run for this frontend-only
change. Documentation was checked against source and test contracts rather than TDD because
it changes no runtime behavior.
