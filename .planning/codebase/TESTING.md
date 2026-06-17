# Testing Patterns

**Analysis Date:** 2026-06-17

## Test Framework

**Runner:** `cargo test` (built-in Rust test framework)

**Config:** 
- No `Cargo.toml` test config file needed; uses built-in conventions
- Test binaries live in `todo-engine/tests/` directory (three separate binaries, see below)

**Run Commands:**
```bash
cargo test                       # Run all three test binaries (unit, integration, e2e)
cargo test --test unit           # Unit tests only
cargo test --test integration    # Integration tests only
cargo test --test e2e            # E2E tests only
cargo test --lib                 # Library tests (if any in-source tests exist)

# With output
cargo test -- --nocapture        # Show println! output
cargo test --test unit -- --nocapture

# Coverage (if tooling installed)
cargo llvm-cov --summary-only
cargo tarpaulin --out Stdout
```

**Assertion Library:** Standard Rust `assert!`, `assert_eq!`, `assert_ne!` macros (no external framework)

## Test Architecture: Three Layers

Tests are organized into **three separate cargo test binaries**, each a behavior lock for a specific layer of the system. They run independently and serve distinct purposes.

### Layer Map

| Layer | Binary | Directory | Dispatcher | What belongs here |
|-------|--------|-----------|------------|-------------------|
| **unit** | `tests/unit.rs` | `tests/unit/` | `mod mod_name;` | Pure, no-I/O logic via public API: recurrence, status, model, list filter, error mapping, clock helper, architecture boundary guard |
| **integration** | `tests/integration.rs` | `tests/integration/` | `#[path = "support/mod.rs"] mod support; mod mod_name;` | Library wired in-process: `TodoService` policy, audit-event invariant, SQLite repository, routine materialization |
| **e2e** | `tests/e2e.rs` | `tests/e2e/` | `#[path = "support/mod.rs"] mod support; mod mod_name;` | Delivered interfaces end-to-end: real `todo-engine` binary via `assert_cmd` (`cli.rs`), full `axum` HTTP stack via `tower`'s `oneshot` (`api.rs`) |

### Why Three Binaries?

Each test binary is a **behavior lock**:

- **Unit** proves the public API and pure domain logic are unchanged
- **Integration** proves the service layer policy invariants and repository contract are unchanged
- **E2E** proves the CLI and HTTP API users see the same behavior as the service layer

Refactors must keep all three green. If any test fails, the refactor has changed observable behavior.

## The Dispatcher Pattern (Critical)

Cargo compiles **only top-level `tests/*.rs` files** as test binaries. Files under subdirectories like `tests/unit/` are **not** compiled on their own — they must be declared as modules of a top-level dispatcher file.

### Dispatcher Structure

**`tests/unit.rs`** (minimal):
```rust
#[path = "unit/architecture.rs"]
mod architecture;
#[path = "unit/clock.rs"]
mod clock;
#[path = "unit/error_mapping.rs"]
mod error_mapping;
#[path = "unit/filter.rs"]
mod filter;
#[path = "unit/model.rs"]
mod model;
#[path = "unit/recurrence.rs"]
mod recurrence;
#[path = "unit/status.rs"]
mod status;
```

**`tests/integration.rs`** (includes shared support):
```rust
#[path = "support/mod.rs"]
mod support;

#[path = "integration/events.rs"]
mod events;
#[path = "integration/materialization.rs"]
mod materialization;
#[path = "integration/repository.rs"]
mod repository;
#[path = "integration/service_policy.rs"]
mod service_policy;
```

**`tests/e2e.rs`** (includes shared support):
```rust
#[path = "support/mod.rs"]
mod support;

#[path = "e2e/api.rs"]
mod api;
#[path = "e2e/cli.rs"]
mod cli;
```

### The `#[path]` Attribute

The `#[path = "support/mod.rs"]` in integration/e2e dispatchers is **required** because `tests/support/` is itself a subdirectory, not a sibling of the dispatcher's own modules. Without it, the support module is silently unreachable.

### Adding a New Test File

1. Create the file in the appropriate layer subdirectory: `tests/unit/my_feature.rs`, `tests/integration/my_feature.rs`, or `tests/e2e/my_feature.rs`
2. Add a `mod my_feature;` line to the corresponding dispatcher (`tests/unit.rs`, `tests/integration.rs`, or `tests/e2e.rs`)
3. Write your test functions inside the new file

**Without the dispatcher line, your test file will never run.** Cargo silently ignores subdirectory `.rs` files that aren't explicitly modded.

## Shared Support Module

**Location:** `tests/support/mod.rs`

**Purpose:** Provides helpers shared across test binaries — notably:
- `TestHome` — a temp data-home fixture
- `memory_service()` — factory for in-memory `TodoService` instances

**Usage:** Integration and e2e test binaries include it via `#[path = "support/mod.rs"] mod support;`. Unit tests do not need it (unit tests are pure, no I/O).

**Dead code handling:** Because different test binaries use different subsets of support helpers, all support items carry `#[allow(dead_code)]` — this prevents unused helpers in one binary from failing the `-D warnings` gate.

### `TestHome` Example

```rust
use crate::support::TestHome;
use rusqlite::Connection;

#[test]
fn my_integration_test() {
    let home = TestHome::new();
    
    // home.path() -> &Path
    // home.db_path() -> PathBuf (returns `home.path().join("todo.sqlite")`)
    
    let conn = Connection::open(home.db_path()).unwrap();
    // … test setup …
}
```

## Test File Organization

### Unit Tests: Pure Logic

**Examples:** `tests/unit/error_mapping.rs`, `tests/unit/status.rs`, `tests/unit/filter.rs`

```rust
use todo_engine::application::error::TodoError;

#[test]
fn cli_exit_codes_map_by_variant() {
    assert_eq!(TodoError::Policy("x".into()).cli_exit_code(), 2);
    assert_eq!(TodoError::Validation("x".into()).cli_exit_code(), 2);
    assert_eq!(TodoError::NotFound("x".into()).cli_exit_code(), 4);
    assert_eq!(TodoError::Storage("x".into()).cli_exit_code(), 1);
}

#[test]
fn http_status_codes_map_by_variant() {
    assert_eq!(TodoError::Policy("x".into()).http_status_code(), 400);
    assert_eq!(TodoError::NotFound("x".into()).http_status_code(), 404);
    assert_eq!(TodoError::Storage("x".into()).http_status_code(), 500);
}
```

**No test setup/teardown or fixtures needed** — pure logic tests should be stateless.

### Integration Tests: Service & Repository

**Examples:** `tests/integration/service_policy.rs`, `tests/integration/events.rs`

```rust
use todo_engine::application::service::{CreateArea, ProposeProject, ProposeTask, TodoService};
use todo_engine::domain::{Actor, ItemStatus, ItemType};

#[test]
fn area_titles_resolve_in_service() {
    // Arrange: create a service and an area
    let mut service = TodoService::in_memory();
    let area = service
        .create_area(CreateArea {
            title: "재정".to_string(),
            review_cycle: None,
            standard: None,
            note: None,
        })
        .unwrap();

    // Act: propose a task with an area title
    let task = service
        .propose_task(
            "DB 확인",
            ProposeTask {
                actor: Actor::User,
                area: Some("재정".to_string()),
                ..Default::default()
            },
        )
        .unwrap();

    // Assert: area title resolves to the area ID
    assert_eq!(task.area_id.as_deref(), Some(area.id.as_str()));
}

#[test]
fn agent_task_requires_approval_before_activation() {
    let mut service = TodoService::in_memory();
    let item = service.propose_task("앱 열고 DB 확인", Default::default()).unwrap();
    assert_eq!(item.status, ItemStatus::Proposed);

    let error = service.activate(&item.id, None).unwrap_err();
    assert_eq!(
        error,
        TodoError::Policy("Agent-created items must be approved before activation".to_string())
    );

    let approved = service.approve(&item.id, None).unwrap();
    let active = service.activate(&approved.id, None).unwrap();
    assert_eq!(active.status, ItemStatus::Active);
}

#[test]
fn every_mutation_records_event() {
    let mut service = TodoService::in_memory();
    service.create_area(CreateArea { … }).unwrap();
    service.propose_project(ProposeProject { … }).unwrap();
    let item = service.propose_task("테스트", Default::default()).unwrap();
    service.approve(&item.id, None).unwrap();

    let actions: Vec<String> = service
        .events()
        .iter()
        .map(|event| event.action.clone())
        .collect();

    assert_eq!(
        actions,
        vec![
            "create_area".to_string(),
            "propose_project".to_string(),
            "propose_task".to_string(),
            "approve".to_string(),
        ]
    );
}
```

**Patterns:**
- Use `TodoService::in_memory()` for service tests (deterministic, no I/O)
- Test policy rules (approval gates, terminal status checks)
- Verify the audit-event invariant (every mutation records a `TodoEvent`)
- Assert error types match expected variants (`TodoError::Policy`, `TodoError::NotFound`, etc.)

### E2E Tests: CLI & API

#### CLI Tests: `tests/e2e/cli.rs`

Uses `assert_cmd::Command` to spawn the actual `todo-engine` binary:

```rust
use assert_cmd::Command;
use predicates::str::contains;
use crate::support::TestHome;

#[test]
fn init_creates_sqlite_database() {
    let home = TestHome::new();

    Command::cargo_bin("todo-engine")
        .unwrap()
        .args(["--home", home.path().to_str().unwrap(), "init"])
        .assert()
        .success()
        .stdout(contains("initialized"));

    assert!(home.db_path().exists());
}

#[test]
fn init_uses_todo_engine_home_environment() {
    let home = TestHome::new();

    Command::cargo_bin("todo-engine")
        .unwrap()
        .env("TODO_ENGINE_HOME", home.path())
        .arg("init")
        .assert()
        .success()
        .stdout(contains("initialized"));

    assert!(home.db_path().exists());
}

#[test]
fn migrate_legacy_db_normalizes_existing_sqlite_rows() {
    let home = TestHome::new();

    // Init
    Command::cargo_bin("todo-engine")
        .unwrap()
        .args(["--home", home.path().to_str().unwrap(), "init"])
        .assert()
        .success();

    // Propose a task
    let output = Command::cargo_bin("todo-engine")
        .unwrap()
        .args([
            "--home",
            home.path().to_str().unwrap(),
            "task",
            "propose",
            "Legacy row",
        ])
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();

    let task: serde_json::Value = serde_json::from_slice(&output).unwrap();
    let task_id = task["id"].as_str().unwrap();

    // Corrupt the row with legacy formatting
    let conn = Connection::open(home.db_path()).unwrap();
    conn.execute(
        "UPDATE items SET type = ' TASK ', status = ' PROPOSED ', proposed_by = ' AGENT ', … WHERE id = ?1",
        [task_id],
    ).unwrap();

    // Run migration
    Command::cargo_bin("todo-engine")
        .unwrap()
        .args(["--home", home.path().to_str().unwrap(), "migrate-legacy-db"])
        .assert()
        .success()
        .stdout(contains("item_rows=1"));
}
```

**Patterns:**
- Spawn the binary with `Command::cargo_bin("todo-engine")`
- Use `--home <path>` and `TODO_ENGINE_HOME` env var to isolate test data homes
- Assert stdout contains expected strings via `contains()` predicate
- Parse JSON from stdout: `serde_json::from_slice(&output)` (never parse stderr)
- E2E tests prove the CLI behavior matches the service behavior

#### API Tests: `tests/e2e/api.rs`

Uses `tower`'s `oneshot` to test the `axum` router in-process:

```rust
use axum::body::Body;
use http_body_util::BodyExt;
use serde_json::{Value, json};
use todo_engine::interfaces::api::router;
use tower::ServiceExt;

async fn body_json(response: http::Response<Body>) -> Value {
    let body = response.into_body().collect().await.unwrap().to_bytes();
    serde_json::from_slice(&body).unwrap()
}

async fn json_request(
    app: axum::Router,
    method: &str,
    uri: impl Into<String>,
    body: Value,
) -> http::Response<Body> {
    app.oneshot(
        http::Request::builder()
            .method(method)
            .uri(uri.into())
            .header("content-type", "application/json")
            .body(Body::from(body.to_string()))
            .unwrap(),
    )
    .await
    .unwrap()
}

#[tokio::test]
async fn health_returns_ok() {
    let app = router(":memory:").unwrap();
    let response = app
        .oneshot(
            http::Request::builder()
                .uri("/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), 200);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(&body[..], br#"{"ok":true}"#);
}

#[tokio::test]
async fn task_propose_and_items_use_same_service_path() {
    let tmp = tempfile::tempdir().unwrap();
    let db_path = tmp.path().join("todo.sqlite");
    let app = router(&db_path).unwrap();
    
    let response = json_request(
        app,
        "POST",
        "/tasks/propose",
        json!({"title":"DB 확인"}),
    )
    .await;

    assert_eq!(response.status(), 200);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let item: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(item["title"], "DB 확인");
    assert_eq!(item["status"], "proposed");
    assert_eq!(item["proposed_by"], "agent");

    // Fresh app, same data home → item should persist
    let fresh_app = router(&db_path).unwrap();
    let response = fresh_app
        .oneshot(
            http::Request::builder()
                .uri("/items")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), 200);
    let items = body_json(response).await;
    // … assert items contains the task …
}
```

**Patterns:**
- Use `#[tokio::test]` for async tests
- Build the router with `router(&db_path)` or `router(":memory:")` for in-memory DB
- Use `tower::ServiceExt::oneshot()` to invoke the router with a request
- Helper functions: `body_json()` (parse response body), `json_request()` (send JSON request), `empty_request()` (GET with no body)
- Assert HTTP status codes (200, 400, 404, 500) and response body JSON
- E2E tests prove the API behavior matches the service behavior

## Test Coverage

**Target:** ≥80% line coverage

**Measurement tools** (if installed):
```bash
cargo llvm-cov --summary-only
cargo tarpaulin --out Stdout
```

**Coverage tracking:**
- If neither tool is available, record that coverage was not measured in operational logs
- Do not install coverage tooling without approval

**What to test:**

| Layer | Coverage focus |
|-------|-----------------|
| Unit | Domain logic (status machine, recurrence parser, list filter, error mapping). No I/O, pure functions. |
| Integration | Service policy (approval gates, terminal status checks, audit events), repository contract (save/get/list items), materialization. |
| E2E | CLI command surfaces, HTTP endpoints. Prove user-facing behavior matches service layer. |

**What's hard to cover (acceptable gaps):**

- Error paths in infrastructure (e.g., SQLite disk-full errors) — use integration tests to cover the happy path and expected recoverable errors
- System.exit() calls in `main.rs` — covered by e2e tests
- Async runtime details — focus on business logic, not tokio internals

## Architecture Boundary Guard

**File:** `tests/unit/architecture.rs`

This is a test, not a doc. It scans every `.rs` file under `todo-engine/src/domain/` and **fails the build** if any reference outward dependencies:

```rust
#[test]
fn domain_does_not_depend_on_layers() {
    let domain_files = /* scan todo-engine/src/domain/*.rs */;
    for file in domain_files {
        let contents = std::fs::read_to_string(file).unwrap();
        assert!(!contents.contains("crate::application"));
        assert!(!contents.contains("crate::infrastructure"));
        assert!(!contents.contains("crate::interfaces"));
        assert!(!contents.contains("rusqlite"));
        assert!(!contents.contains("axum"));
    }
}
```

This mechanically enforces the **inward-dependency rule:** domain does I/O and never depends on outer layers.

**When you add an outward reference to `domain/`**, this test turns the unit layer red. Fix by removing the dependency or moving the code to the appropriate layer.

## Mocking & Fixtures

### In-Memory Service

Most tests use `TodoService::in_memory()`:

```rust
let mut service = TodoService::in_memory();
let area = service.create_area(CreateArea { … }).unwrap();
let task = service.propose_task("My task", ProposeTask { … }).unwrap();
```

**Behavior:**
- Deterministic ID generation: `area_000001`, `area_000002`, etc.
- Deterministic clock: starts at `2026-05-31 12:00 UTC`, increments by 1 second per call
- No file I/O or database
- In-memory storage is lost after the test

### Persistent Service (Integration/E2E)

For integration/e2e tests that need to verify persistence:

```rust
let home = TestHome::new();
let conn = Connection::open(home.db_path()).unwrap();
init_schema(&conn).unwrap();
let repo = SqliteTodoRepository::new(conn);
let mut service = TodoService::persistent(repo);
```

**Behavior:**
- UUID ID generation (first 12 chars of a v4 UUID)
- Real system time (`OffsetDateTime::now_utc()`)
- Writes to SQLite at `home.db_path()`
- Persists across instances of the service

### Test Isolation

- Each test creates a fresh temp home via `TestHome::new()` — no shared state
- In-memory services are independent (no global state)
- E2E tests can reuse the same data home to verify persistence across commands/requests (see `task_propose_and_items_use_same_service_path` example above)

## What to Mock, What NOT to Mock

### Mock (via in-memory service):

- `TodoService` for unit/integration tests
- Domain logic (status machine, recurrence, filters)
- Service policy (approval gates, terminal status)
- Repository (via in-memory store)

### DO NOT Mock:

- The actual CLI entrypoint (use `assert_cmd`)
- The actual `axum` router (use `tower::oneshot`)
- `TodoError` — it's part of the public API, test it as-is
- Database I/O (let it happen; use temp homes for isolation)
- System time in persistent tests (use real system time)

**Rationale:** Mocking these layers defeats the purpose of e2e tests. If you mock the CLI, you're not testing what the user runs.

## Common Test Patterns

### Testing an Error Variant

```rust
#[test]
fn agent_task_requires_approval_before_activation() {
    let mut service = TodoService::in_memory();
    let item = service.propose_task("task", Default::default()).unwrap();

    let error = service.activate(&item.id, None).unwrap_err();
    assert_eq!(
        error,
        TodoError::Policy("Agent-created items must be approved before activation".to_string())
    );
}
```

### Testing an Audit Event

```rust
#[test]
fn mutation_creates_event() {
    let mut service = TodoService::in_memory();
    service.create_area(CreateArea { title: "foo".into(), … }).unwrap();

    let events = service.events();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].action, "create_area");
    assert_eq!(events[0].object_type, "area");
}
```

### Testing CLI Exit Code

```rust
#[test]
fn policy_error_exits_with_code_2() {
    let home = TestHome::new();
    Command::cargo_bin("todo-engine")
        .unwrap()
        .args(["--home", home.path().to_str().unwrap(), "task", "propose", "task"])
        .assert()
        .success();  // proposing succeeds

    let output = Command::cargo_bin("todo-engine")
        .unwrap()
        .args(["--home", home.path().to_str().unwrap(), "activate", "<id>"])
        .assert()
        .failure()
        .code(2);    // Policy error → exit code 2
}
```

### Testing API Status Codes

```rust
#[tokio::test]
async fn bad_request_returns_400() {
    let app = router(":memory:").unwrap();
    let response = json_request(
        app,
        "POST",
        "/tasks/propose",
        json!({"title": ""}),  // empty title
    ).await;

    assert_eq!(response.status(), 400);
    let body = body_json(response).await;
    assert!(body["detail"].as_str().unwrap().contains("empty"));
}

#[tokio::test]
async fn not_found_returns_404() {
    let app = router(":memory:").unwrap();
    let response = app.oneshot(
        http::Request::builder()
            .method("PATCH")
            .uri("/items/nonexistent")
            .header("content-type", "application/json")
            .body(Body::from(json!({"status": "active"}).to_string()))
            .unwrap(),
    ).await.unwrap();

    assert_eq!(response.status(), 404);
}
```

---

*Testing patterns: 2026-06-17*
