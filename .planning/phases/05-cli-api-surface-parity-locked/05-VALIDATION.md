---
phase: 5
slug: cli-api-surface-parity-locked
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-26
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
- **After every plan wave:** `cargo test` (all three binaries — e2e/integration parity must stay green per CLAUDE.md)
- **Before `/gsd-verify-work`:** `cargo fmt --check` + `cargo clippy -- -D warnings` + full `cargo test` green (modulo the documented pre-existing dotenv failure noted in RESEARCH)
- **Max feedback latency:** ~20 s per-task quick run; ~60 s per-wave full suite

---

## Per-Task Verification Map

> Populated after plans are created (task IDs come from the PLAN.md files). The phase→test mapping below is the source contract from `05-RESEARCH.md` §Validation Architecture; the per-task rows are filled by the Nyquist validation pass / Wave 0 once `05-NN-PLAN.md` task IDs exist.

| Req ID | Behavior | Test Type | Automated Command | File |
|--------|----------|-----------|-------------------|------|
| SURF-01 | CLI `goal propose` returns proposed goal JSON | e2e (CLI) | `cargo test --test e2e cli` | extend `tests/e2e/cli.rs` |
| SURF-01 | CLI `agenda`/`date-range`/`period` emit JSON | e2e (CLI) | `cargo test --test e2e cli` | extend `tests/e2e/cli.rs` |
| SURF-01 | CLI `update --parent-id` links task to goal | e2e (CLI) | `cargo test --test e2e cli` | extend `tests/e2e/cli.rs` |
| SURF-02 | API `POST /goals/propose` mirrors CLI | e2e (API) | `cargo test --test e2e api` | extend `tests/e2e/api.rs` |
| SURF-02 | API `GET /views/{agenda,date-range,period}` | e2e (API) | `cargo test --test e2e api` | extend `tests/e2e/api.rs` |
| SURF-02 | API `PATCH /items/:id {parent_id}` links | e2e (API) | `cargo test --test e2e api` | extend `tests/e2e/api.rs` |
| SC3 | CLI+API yield same item state AND same rejections (paired) | e2e (both) | `cargo test --test e2e` | both files |
| SC4 | Agent-created goal (either surface) starts `proposed` | e2e (both) | `cargo test --test e2e` | both files |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

**Existing infrastructure covers all phase requirements.** `tests/e2e/{cli,api}.rs` already exist with the exact harness needed (`TestHome`, `Command::cargo_bin`, `router(..)` + `oneshot`, `json_request`/`empty_request`/`body_json` helpers). New tests are added as `#[test]`/`#[tokio::test]` fns in those files — no new fixture/config/framework install required. `wave_0_complete` will be set true once the planner confirms no new harness file is introduced.

- [ ] Test framework — already present (`cargo test`, no install)
- [ ] Shared fixtures — `TestHome` + e2e helpers already in `tests/e2e/`
- [ ] SC3 parity helper (optional) — planner may add a small CLI-vs-API comparison helper in `tests/e2e/`, or assert independently in both files (matches current idiom `task_propose_and_items_use_same_service_path`)

---

## Manual-Only Verifications

All phase behaviors have automated verification. New CLI commands and HTTP endpoints emit JSON (D-01) asserted by `cargo test --test e2e`; approval gating (SC4) is asserted by checking `status == "proposed"` for agent-created goals on both surfaces. No visual/interactive UI is added (frontend explicitly out of scope), so nothing requires human visual verification.

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
