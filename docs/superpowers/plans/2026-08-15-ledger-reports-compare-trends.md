# Ledger Reports Compare and Trends Implementation Plan

**Goal:** Add the comparison ranges and currency-separated trend data required by the approved Ledger Reports UX.

**Architecture:** Keep report policy in `ledger-engine`'s application service. Reuse the existing SQLite aggregate query shape, adding one date-grouped read; build aligned comparisons and zero-filled daily/weekly/monthly buckets in application code. Keep the current explicit comparison API compatible while adding preset/custom selection and one trend route.

**Tech Stack:** Rust 2024, `time`, rusqlite, Axum, serde.

---

### Task 1: Comparison period policy and aligned currency results

**Files:**
- Modify: `ledger-engine/src/application/reports.rs`
- Test: `ledger-engine/tests/integration/reports.rs`

1. Add failing tests for current-month, previous-month, current-year, and equal-inclusive custom comparison ranges, including leap and boundary behavior.
2. Add a failing test showing currencies present in only one side remain separate and receive zero values on the other side.
3. Implement the smallest report-period/range policy and aligned per-currency comparison output while preserving the existing `current` and `previous` summaries.
4. Run the targeted Ledger report tests.

### Task 2: Daily, weekly, and monthly trend series

**Files:**
- Modify: `ledger-engine/src/application/ports.rs`
- Modify: `ledger-engine/src/infrastructure/sqlite/repository.rs`
- Modify: `ledger-engine/src/application/reports.rs`
- Test: `ledger-engine/tests/integration/reports.rs`

1. Add failing tests for currency separation, inclusive range bounds, automatic granularity, zero-filled gaps, and an empty result.
2. Add one repository read grouped by entry date and currency, excluding archived entries.
3. Bucket those daily rows in the application service as daily, Monday-based weekly, or calendar-monthly series clipped to the requested range.
4. Run the targeted Ledger report tests.

### Task 3: HTTP contract and safe validation

**Files:**
- Modify: `raven-api/src/routes/ledger.rs`
- Test: `raven-api/tests/routes_ledger.rs`

1. Add failing route tests for preset/custom comparison queries, trend queries, stable empty output, unknown parameters, and malformed ranges.
2. Extend `/reports/compare` without removing the existing explicit four-date query.
3. Add `GET /reports/trend` with `from`, `to`, and optional `granularity=auto|daily|weekly|monthly`.
4. Use the configured local offset for preset comparison dates and preserve the generic safe error envelope.
5. Run the targeted Raven API route and error-contract tests.

### Task 4: Documentation and verification

**Files:**
- Modify: `docs/operations/api-reference.md`

1. Document the comparison selectors, trend query, inclusive ranges, currency separation, and empty-series behavior.
2. Run formatting, workspace tests, Clippy, frontend tests, frontend typecheck, and frontend build.
3. Review the final diff, commit atomically, update Linear SHI-68, and merge the worktree branch locally after verification.
