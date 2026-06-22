# Testing Patterns

**Analysis Date:** 2026-06-22

> Source of truth: `docs/conventions/testing.md`. This document distills it plus observed
> test code under `todo-engine/tests/`.

## Test Framework

**Runner:**
- Built-in Rust test harness (`#[test]`, `#[tokio::test]` for async).
- No separate runner config; layered via top-level dispatcher binaries.

**Assertion Library:**
- Standard `assert!`/`assert_eq!`/`unwrap`/`unwrap_err`.
- CLI: `assert_cmd` (`Command::cargo_bin`) + `predicates` (`predicates::str::contains`).
- API: `tower`'s `ServiceExt::oneshot` + `http`/`http-body-util`.

**Dev-dependencies (`todo-engine/Cargo.toml`):**
`assert_cmd = "2"`, `http = "1"`, `http-body-util = "0.1"`, `predicates = "3"`,
`tempfile = "3.15"`, `tower = { "0.5", features = ["util"] }`.

**Run Commands:**
```bash
cargo test                       # all three layer binaries
cargo test --test unit           # only the unit layer
cargo test --test integration    # only the integration layer
cargo test --test e2e            # only the e2e layer
```

## Test File Organization

**Location:** Separate from source, in `todo-engine/tests/`, organized into three layers,
each a distinct cargo test binary plus a shared support module.

| Layer | Dispatcher | Directory | What belongs here |
| --- | --- | --- | --- |
| unit | `tests/unit.rs` | `tests/unit/` | Pure, no-I/O logic via the crate's public API: recurrence, status, model, list filter, error mapping, the local-date clock helper, architecture boundary guard. |
| integration | `tests/integration.rs` | `tests/integration/` | Library wired in-process: `TodoService` policy, audit-event invariant, SQLite repository, routine materialization. |
| e2e | `tests/e2e.rs` | `tests/e2e/` | Delivered interfaces end-to-end: real `todo-engine` binary via `assert_cmd` (`cli.rs`), full `axum` HTTP stack via `tower` `oneshot` (`api.rs`). |

**Naming:** snake_case files named by concern (`service_policy.rs`, `materialization.rs`,
`error_mapping.rs`). Test fns are descriptive sentences:
`agent_task_requires_approval_before_activation`, `init_creates_sqlite_database`.

## Test Structure

**The dispatcher pattern (cargo subfolder gotcha):**
Cargo compiles only top-level `tests/*.rs` as binaries. Subfolder files must be declared as
`mod`s of a top-level dispatcher, or they silently never run. When adding a file under a layer
directory, add a `mod` line to that layer's dispatcher.

```rust
// tests/unit.rs
mod architecture;
mod clock;
mod error_mapping;
mod filter;
mod model;
mod recurrence;
mod status;
```

Integration/e2e dispatchers also pull in shared support with an explicit `#[path]`:
```rust
// tests/integration.rs (and tests/e2e.rs)
#[path = "support/mod.rs"]
mod support;

mod events;
mod materialization;
mod repository;
mod service_policy;
```

**Test body pattern (arrange/act/assert):**
```rust
#[test]
fn agent_task_requires_approval_before_activation() {
    let mut service = TodoService::in_memory();
    let item = service.propose_task("앱 열고 DB 확인", Default::default()).unwrap();
    assert_eq!(item.status, ItemStatus::Proposed);

    let error = service.activate(&item.id, None).unwrap_err();
    assert_eq!(error, TodoError::Policy("Agent-created items must be approved before activation".to_string()));

    let approved = service.approve(&item.id, None).unwrap();
    let active = service.activate(&approved.id, None).unwrap();
    assert_eq!(active.status, ItemStatus::Active);
}
```
Note: request structs use `Default::default()` / `..Default::default()`; tests assert exact
error variants and statuses.

## Mocking

**Framework:** None — no mocking library. Real implementations are used against isolated state.

**Patterns:**
- Integration tests use an in-memory service: `TodoService::in_memory()` (no temp file needed).
- e2e CLI tests run the real compiled binary against a temp data home.
- e2e API tests drive the real `axum` router in-process:
  ```rust
  app.oneshot(http::Request::builder().method(method).uri(uri.into())
      .header("content-type", "application/json").body(body).unwrap()).await.unwrap()
  ```

**What to use real instead of mocking:** the SQLite repository (bundled rusqlite),
the service layer, the HTTP stack — behavior locks depend on real wiring.

## Fixtures and Factories

**Shared support (`tests/support/mod.rs`):**
```rust
pub struct TestHome { dir: tempfile::TempDir }
impl TestHome {
    pub fn new() -> Self { Self { dir: tempfile::tempdir().expect("create test home") } }
    pub fn path(&self) -> &Path { self.dir.path() }
    pub fn db_path(&self) -> PathBuf { self.path().join("todo.sqlite") }
}
```
- `TestHome` provides an isolated temp data home; `memory_service()` wraps
  `TodoService::in_memory()`.
- Because each binary uses a different subset of helpers, support items carry
  `#[allow(dead_code)]` to satisfy the `-D warnings` gate.

## Coverage

**Requirements:** Target ≥80% line coverage.

**View Coverage:**
```bash
cargo llvm-cov --summary-only      # preferred, if installed
cargo tarpaulin --out Stdout       # alternative
```
Do not install coverage tooling without approval; if neither is available, record that
coverage was not measured (see `docs/operations/verification-and-smoke.md`).

## Test Types

**Unit:** Pure logic through the public API; no I/O.
**Integration:** In-process library wiring (service policy, audit events, SQLite repo,
materialization).
**E2E:** Real binary (CLI) and full HTTP stack (API).

**Architecture boundary guard (`tests/unit/architecture.rs`):** A real test that reads every
`.rs` under `todo-engine/src/domain/` and fails if any references `crate::application`,
`crate::infrastructure`, `crate::interfaces`, `rusqlite`, or `axum` — enforcing the
inward-dependency rule mechanically.

## Common Patterns

**Async testing:** `#[tokio::test]` with `app.oneshot(...).await`; helper fns return
`http::Response<Body>` and decode JSON via `BodyExt::collect`.

**Error testing:**
```rust
let error = service.activate(&item.id, None).unwrap_err();
assert_eq!(error, TodoError::Policy("...".to_string()));
```

**CLI assertions:**
```rust
Command::cargo_bin("todo-engine").unwrap()
    .args(["--home", home.path().to_str().unwrap(), "init"])
    .assert().success().stdout(contains("initialized"));
```

---

*Testing analysis: 2026-06-22*
