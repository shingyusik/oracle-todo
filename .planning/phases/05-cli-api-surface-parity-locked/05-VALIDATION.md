---
phase: 5
slug: cli-api-surface-parity-locked
status: planned
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-26
updated: 2026-06-26
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `cargo test` (Rust 2024) — built-in `#[test]`/`#[tokio::test]`; CLI e2e via `assert_cmd`+`predicates`; API e2e via `tower::ServiceExt::oneshot` |
| **Config file** | none — workspace `Cargo.toml` + `todo-engine/tests/{unit,integration,e2e}` (three test binaries) |
| **Quick run command** | `cargo test --test e2e` (the surface tests this phase adds) |
| **Full suite command** | `cargo test` (workspace root) |
| **Lint gate** | `cargo clippy --all-targets --all-features -- -D warnings` + `cargo fmt --check` |
| **Estimated runtime** | quick (`e2e` binary): ~10–20 s after warm build; full `cargo test`: ~30–60 s |

---

## Sampling Rate

- **After every task commit:** `cargo test --test e2e` + `cargo clippy --all-targets --all-features -- -D warnings`
  - (Wave-1 production tasks 05-01 / 05-02 build the surface; their per-task gate is `cargo build -p todo-engine` + `cargo clippy -- -D warnings` because the e2e assertions live in Wave-2 plan 05-03.)
- **After every plan wave:** `cargo test` (all three binaries — e2e/integration parity must stay green per CLAUDE.md)
- **Before `/gsd-verify-work`:** `cargo fmt --check` + `cargo clippy -- -D warnings` + full `cargo test` green (modulo the documented pre-existing dotenv failure noted in RESEARCH)
- **Max feedback latency:** ~20 s per-task quick run; ~60 s per-wave full suite

---

## Per-Task Verification Map

> Task IDs resolved from the created PLAN.md files. The phase→test mapping is the source contract from `05-RESEARCH.md` §Validation Architecture.

| Plan-Task | Req ID(s) | Behavior | Test Type | Automated Command | Status |
|-----------|-----------|----------|-----------|-------------------|--------|
| 05-01 T1 | SURF-01, SC4 | CLI `goal propose` produces proposed-goal JSON | build/clippy (CLI surface) → proven by 05-03 T1 | `cargo build -p todo-engine` + `cargo test --test e2e cli` | ⬜ |
| 05-01 T2 | SURF-01 | CLI `agenda`/`date-range`/`period` emit JSON; bad horizon ⇒ exit 2 | build/clippy → proven by 05-03 T1 | `cargo build -p todo-engine` + `cargo test --test e2e cli` | ⬜ |
| 05-01 T3 | SURF-01, LINK-01/02 | CLI `update --parent-id` links task to goal | build/clippy → proven by 05-03 T1 | `cargo build -p todo-engine` + `cargo test --test e2e cli` | ⬜ |
| 05-02 T1 | SURF-02, SC4 | API `POST /goals/propose` mirrors CLI | build/clippy → proven by 05-03 T2 | `cargo build -p todo-engine` + `cargo test --test e2e api` | ⬜ |
| 05-02 T2 | SURF-02, CORE-03 | API `GET /views/{agenda,date-range,period}` | build/clippy → proven by 05-03 T2 | `cargo build -p todo-engine` + `cargo test --test e2e api` | ⬜ |
| 05-02 T3 | SURF-02, LINK-01/02 | API `PATCH /items/:id {parent_id}` links (non-null) | build/clippy → proven by 05-03 T2 | `cargo build -p todo-engine` + `cargo test --test e2e api` | ⬜ |
| 05-03 T1 | SURF-01, SC3, SC4 | CLI e2e: JSON output, proposed gating, link, exit-2 rejection | e2e (CLI) | `cargo test --test e2e cli` | ⬜ |
| 05-03 T2 | SURF-02, SC3, SC4 | API e2e: 200 + proposed, views JSON, parent_id non-null, 400 rejection | e2e (API) | `cargo test --test e2e api` | ⬜ |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

**Sampling-continuity check:** No 3 consecutive tasks lack an automated `<automated>` gate — every task has `cargo build`/`cargo test`/`cargo clippy`. Wave-1 surface tasks (05-01/05-02) are build-gated and their behavior is asserted one wave later by 05-03 (the dedicated test plan), satisfying the Nyquist contract that every SURF requirement maps to an automated e2e command.

---

## Wave 0 Requirements

**Existing infrastructure covers all phase requirements — no new harness file introduced.** `tests/e2e/{cli,api}.rs` already exist with the exact harness needed (`TestHome`, `Command::cargo_bin`, `router(..)` + `oneshot`, `json_request`/`empty_request`/`body_json` helpers). New tests are added as `#[test]`/`#[tokio::test]` fns in those files — no new fixture/config/framework install required. `wave_0_complete: true` (planner confirmed no new harness file is needed).

- [x] Test framework — already present (`cargo test`, no install)
- [x] Shared fixtures — `TestHome` + e2e helpers already in `tests/e2e/`
- [x] SC3 parity helper — assert independently in both files (matches current idiom `task_propose_and_items_use_same_service_path`); no shared cross-surface helper needed

---

## Manual-Only Verifications

All phase behaviors have automated verification. New CLI commands and HTTP endpoints emit JSON (D-01) asserted by `cargo test --test e2e`; approval gating (SC4) is asserted by checking `status == "proposed"` for agent-created goals on both surfaces. No visual/interactive UI is added (frontend explicitly out of scope), so nothing requires human visual verification.

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (none — existing harness suffices)
- [x] No watch-mode flags
- [x] Feedback latency < 60s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved (planning complete 2026-06-26)
