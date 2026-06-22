---
phase: 2
slug: service-policy-goal-create-link-validation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-22
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `02-RESEARCH.md` → "## Validation Architecture". This phase adds NO schema; every behavior is provable through `TodoService` (integration) plus pure helpers (unit). e2e is deferred to Phase 5 (it owns the CLI/API surface).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Rust built-in `#[test]` (integration + unit binaries); `assert_cmd`/`tower` reserved for e2e (not used this phase) |
| **Config file** | none — cargo test binaries via dispatchers (`tests/unit.rs`, `tests/integration.rs`) |
| **Quick run command** | `cargo test --test integration goal_policy` |
| **Full suite command** | `cargo test` (then `cargo fmt --check` + `cargo clippy --all-targets --all-features -- -D warnings`) |
| **Estimated runtime** | ~60 seconds (cold build dominated; warm test run is seconds) |

---

## Sampling Rate

- **After every task commit:** Run `cargo test --test integration goal_policy` + `cargo build`
- **After every plan wave:** Run `cargo test` (all three binaries)
- **Before `/gsd-verify-work`:** `cargo test && cargo fmt --check && cargo clippy --all-targets --all-features -- -D warnings` all green
- **Max feedback latency:** ~60 seconds

---

## Per-Task Verification Map

> Task IDs are assigned by the planner. Rows below are keyed by success criterion / requirement so the planner can attach each to a concrete task. Threat refs map to `02-RESEARCH.md` "## Security Domain".

| SC / Req | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|----------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| SC1 / GOAL-01 | TBD | GOAL-01 | T-input/repudiation | Agent goal → `Proposed`; user goal → `Approved`; `TodoEvent` audit row written via `store_item_and_event` | integration | `cargo test --test integration goal_policy` | ❌ W0 (`tests/integration/goal_policy.rs`) | ⬜ pending |
| SC2 / GOAL-03 | TBD | GOAL-03 | T-tampering (malformed anchor) | Reject unparseable / `"today"` sentinel / non-canonical anchor with `TodoError::Validation`; never auto-snap | integration + unit | `cargo test --test integration goal_policy` ; `cargo test --test unit horizon` | ❌ W0 / ✅ (horizon unit exists) | ⬜ pending |
| SC3a / GOAL-04 | TBD | GOAL-04 | T-DoS (cyclic parent_id) | Reject cycle (visited-set + depth cap) and horizon inversion (equal/finer parent) with `TodoError::Policy` | integration | `cargo test --test integration goal_policy` | ❌ W0 | ⬜ pending |
| SC3b / GOAL-05 | TBD | GOAL-05 | — | Reject duplicate `(horizon, normalized_scheduled, parent_id)` with `TodoError::Policy` | integration | `cargo test --test integration goal_policy` | ❌ W0 | ⬜ pending |
| SC4 / LINK-01, LINK-02 | TBD | LINK-01, LINK-02 | T-repudiation | Link task→goal via `parent_id` + set `scheduled` through `update_item` (audited path); reject non-Goal/terminal parent | integration | `cargo test --test integration goal_policy` | ❌ W0 | ⬜ pending |
| SC5 / VIEW-01 | TBD | VIEW-01 | T-tampering (SQLi via filter) | List goals/tasks filtered by horizon, period (`scheduled`), parent; persistent `list_items` uses bound params | integration + unit | `cargo test --test integration` ; `cargo test --test unit filter` | ❌ W0 / ✅ (`tests/unit/filter.rs` exists, extend) | ⬜ pending |
| CORE-01 | TBD | CORE-01 | T-repudiation (bypass) | No mutation bypasses the service; `tests/unit/architecture.rs` boundary guard stays green | integration (implicit) | `cargo test` | ✅ (existing) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/integration/goal_policy.rs` — NEW file covering SC1–SC4; register `mod goal_policy;` in `tests/integration.rs` (alphabetical, after `goal_roundtrip`)
- [ ] `tests/unit/filter.rs` — EXTEND existing file for new `apply_list_filter` horizon/parent predicates (no new dispatcher line needed)
- [ ] No framework install needed — `#[test]`, `assert_cmd`, `tower`, `tempfile` already in dev-deps (`tests/support/mod.rs` uses `tempfile`/`TestHome`)

*(If a pure `validate_goal_anchor` free fn is extracted, add `tests/unit/goal.rs` + a `mod goal;` line in `tests/unit.rs`.)*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `ItemStatus` meaning for goals is documented (goal `Active` for its period; `Completed`/`Dropped` user-driven; no cascade to children in v1) | SC5 (doc deliverable) | Documentation outcome, not a code behavior — verified by inspection of README/docs, not a test | Confirm README.md (and/or a decision doc) records the goal-status semantics + no-cascade rule via the `docs-tools` skill |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (`tests/integration/goal_policy.rs`)
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
