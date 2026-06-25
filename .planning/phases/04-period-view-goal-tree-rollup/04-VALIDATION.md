---
phase: 4
slug: period-view-goal-tree-rollup
status: ready
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-25
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `cargo test` (Rust 2024) — built-in `#[test]`, three test binaries (`unit`/`integration`/`e2e`) |
| **Config file** | none — workspace `Cargo.toml` + `todo-engine/tests/{unit,integration,e2e}` (integration binary registered via `tests/integration.rs`) |
| **Quick run command** | `cargo test --test integration period_view` |
| **Full suite command** | `cargo test` |
| **Lint gate** | `cargo clippy --all-targets --all-features -- -D warnings` + `cargo fmt --check` |
| **Estimated runtime** | quick (`period_view` module): ~5–15 s after a warm build; full `cargo test` (all three binaries): ~30–60 s |

---

## Sampling Rate

- **After every task commit:** `cargo test --test integration period_view` + `cargo clippy --all-targets --all-features -- -D warnings`
- **After every plan wave:** `cargo test` (all three binaries — e2e/integration parity must stay green per CLAUDE.md)
- **Before `/gsd-verify-work`:** `cargo fmt --check` + `cargo clippy -- -D warnings` + full `cargo test` green
- **Max feedback latency:** ~15 s for the per-task quick run; ~60 s for the per-wave full suite

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 04-01-01 | 01 | 1 | VIEW-03, VIEW-04 | T-04-01 / T-04-02 / T-04-03 | Visited-set + `MAX_GOAL_DEPTH` cap make the descent finite; anomalies counted, view returns `Ok` (never hangs/Errs); `period`/`horizon` validated, no SQL on this path | build/lint | `cd todo-engine && cargo build && cargo clippy --all-targets --all-features -- -D warnings` | ✅ (queries.rs, goal.rs exist; new types added in-file) | ⬜ pending |
| 04-01-02 | 01 | 1 | VIEW-03, VIEW-04 | T-04-01 | In-memory tree build, unscheduled surfacing, normalization, deterministic ordering, side-effect-free (no audit event) | integration | `cd todo-engine && cargo test --test integration period_view` | ❌ W0 (new file `tests/integration/period_view.rs`) | ⬜ pending |
| 04-02-01 | 02 | 2 | VIEW-03, VIEW-04 | T-04-04 / T-04-05 / T-04-06 / T-04-SC | Recursive-CTE fully parameterized (`params![horizon, period_key]`, no `format!` of inputs — V5.3); `UNION` dedup is the SQL-level cycle guard; D-07 predicate sourced from `OPEN_STATUSES` | build/lint | `cd todo-engine && cargo build && cargo clippy --all-targets --all-features -- -D warnings` | ✅ (ports.rs, repo.rs exist; new method added in-file) | ⬜ pending |
| 04-02-02 | 02 | 2 | VIEW-03, VIEW-04 | T-04-04 | Persistent arm feeds the SAME shared `assemble()`; Plan 01 stub removed; in-memory tests stay green | integration | `cd todo-engine && cargo build && cargo test --test integration period_view && cargo clippy --all-targets --all-features -- -D warnings` | ✅ (queries.rs; tests from 04-01) | ⬜ pending |
| 04-03-01 | 03 | 3 | VIEW-03, VIEW-04 | T-04-07 | Cross-store parity via structure-capturing stable keys (never raw ids); D-07 asymmetry holds on the SQL path; persistent `period_view` writes no event | integration | `cd todo-engine && cargo test --test integration period_view` | ✅ (appends to `tests/integration/period_view.rs` from 04-01) | ⬜ pending |
| 04-03-02 | 03 | 3 | VIEW-03, VIEW-04 | T-04-07 / T-04-08 | Store-level-injected cycle/orphan/over-depth terminate with `anomaly_count` bumped, `period_view` returns `Ok`; fixtures confined to `tempfile` homes (never the live data home) | integration | `cd todo-engine && cargo test --test integration period_view` | ✅ (appends to `tests/integration/period_view.rs`) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

**Threat refs** trace to the `<threat_model>` STRIDE register in each plan (04-01: T-04-01…03; 04-02: T-04-04…06, T-04-SC; 04-03: T-04-07, T-04-08).

---

## Wave 0 Requirements

**Existing infrastructure covers all phase requirements.** This project already has `cargo` plus the three test binaries (`todo-engine/tests/{unit,integration,e2e}`, integration registered via `tests/integration.rs`); no framework install or harness scaffolding is needed. `wave_0_complete: true` on that basis.

The only new test artifact is the file `todo-engine/tests/integration/period_view.rs`, created and registered as the FIRST task of plan 04-01 (Task 2) — it carries the seed helpers (`goal`/`open_task`/`seed_goal_tree`), the `tree_keys()` nested-tree flattener, and the in-memory behavior tests. Plan 04-03 appends the persistent, parity, and SC3 store-level anomaly tests to the same file. Until 04-01 Task 2 lands, the integration command has no `period_view` module to run (marked ❌ W0 above); every subsequent task's automated command resolves to a real test target.

- [x] `todo-engine/tests/integration/period_view.rs` — created in 04-01 Task 2 (covers VIEW-03/VIEW-04 in-memory; persistent + parity + SC3 appended in 04-03)
- [x] Test framework — already present (`cargo test`, no install)
- [x] Shared fixtures — `persistent_service()` copied from `date_view.rs` (not shared outside e2e by convention); seed helpers authored in 04-01

---

## Manual-Only Verifications

All phase behaviors have automated verification. This is a read-only service-layer query phase: tree shape, unscheduled surfacing, normalization, cross-store parity, SC3 cycle/orphan/depth termination, and side-effect-freedom are all asserted by `cargo test --test integration period_view`. No CLI/API surface is added in this phase (deferred to Phase 5), so there is nothing requiring human visual/interactive verification.

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies — every task maps to a concrete `cargo build`/`cargo clippy`/`cargo test` command
- [x] Sampling continuity: no 3 consecutive tasks without automated verify — all 6 tasks have an automated command
- [x] Wave 0 covers all MISSING references — the only missing file (`period_view.rs`) is created by 04-01 Task 2 before any test references it
- [x] No watch-mode flags — all commands are single-shot `cargo test`/`cargo build`/`cargo clippy`
- [x] Feedback latency < 60s — quick run ~15 s, full suite ~60 s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-06-25
