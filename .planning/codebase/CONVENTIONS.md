# Coding Conventions

**Analysis Date:** 2026-06-17

## Language & Edition

**Rust 2024** — MSRV and edition locked to 2024. The crate is `todo_engine` (package `todo-engine`), delivered as both a library and binary under `todo-engine/` in the Cargo workspace.

## The Gate (Must Pass Before Every Commit)

```bash
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test
```

**Critical:** The `-D warnings` flag turns all warnings into hard errors. This means:
- Unused imports must be removed immediately
- Every `use` statement must reference code in the file
- Dead code or stray dependencies cause build failure
- When moving code between modules, trim imports to exactly what the moved code needs

## Naming Patterns

### Files

- Snake_case: `creation.rs`, `service_policy.rs`, `error_mapping.rs`
- Directory modules for split concerns: `application/service/`, `infrastructure/sqlite/`, `interfaces/cli/`, `interfaces/api/`
- Keep files focused — target roughly **under ~400 lines**. When a file outgrows that, split it into a directory module with focused submodules by responsibility, not by arbitrary size

### Enums & Variants

- Enum names: PascalCase (`ItemStatus`, `TodoError`, `Actor`, `ItemType`)
- Serialized forms use `#[serde(rename_all = "...")]`:
  - `ItemStatus` variants → lowercase: `"proposed"`, `"active"`, `"completed"` (via `rename_all = "lowercase"`)
  - `ItemType` variants → snake_case: `"archive_item"` (via `rename_all = "snake_case"`)
  - `Actor` variants → lowercase: `"user"`, `"agent"`, `"system"` (via `rename_all = "lowercase"`)
- `FromStr` impls are **case-sensitive** and **trim whitespace** — e.g., `"  proposed  "` parses as `ItemStatus::Proposed`
- Never rename public enum symbols; the serialized form and Rust name must stay synchronized

### Structs & Types

- Struct names: PascalCase (`TodoItem`, `TodoEvent`, `TodoService`, `CreateArea`, `ProposeTask`)
- Request structs have explicit builder naming: `CreateArea`, `ProposeTask`, `ProposeProject`, `ProposeRoutine`, `ProposeEvent`, `UpdateItem` (in `application/service/creation.rs` and `update.rs`)
- Type aliases in snake_case: `TodoResult<T>` for `Result<T, TodoError>`, `ApiResult<T>` for `Result<T, ApiError>`

### Functions & Methods

- Snake_case: `create_area`, `propose_task`, `next_id`, `store_item_and_event`, `apply_list_filter`
- Internal helpers are consistently named:
  - `next_id(prefix)` — generates deterministic or UUID-based IDs depending on store type
  - `next_now()` — returns deterministic clock time in tests, UTC now in production
  - `find_area(area_name)` — resolves area title to ID or error
  - `with_service(state, action)` — closure-based service instantiation (API pattern)
  - `storage_error(err)` — maps rusqlite errors to `TodoError::Storage`

### Variables

- Local variables: snake_case (`item`, `area_id`, `item_type`, `filter`)
- Config/constant variables: `SCREAMING_SNAKE_CASE` (e.g., environment vars)
- Boolean variables use clear predicate names: `is_terminal`, `is_hidden_by_default`, `terminal_status(status)` (returns bool)

## Code Style

### Formatting

- Use `cargo fmt` (default Rust style with `rustfmt.toml` not present, so standard 1.4em indent, 100-char hard line limit where applicable)
- Run `cargo fmt --check` as part of the gate
- Do not override formatting manually — let `rustfmt` handle it

### Linting

- Use `cargo clippy --all-targets --all-features -- -D warnings`
- Treat all warnings as errors (`-D warnings`)
- Do not suppress warnings; fix the underlying issue
- Common suppressions to avoid:
  - `#[allow(dead_code)]` — only in `tests/support/mod.rs` (shared helpers used by different test binaries)
  - `#[allow(unused)]` — indicates cleanup needed, not acceptable in production code

### Line Length & File Size

- **Target file size:** under ~400 lines
- When a file exceeds that:
  - Identify the responsibility boundaries
  - Split into a directory module with focused submodules
  - Worked example: `service.rs` → `application/service/{creation, transitions, update, materialization, queries}.rs`
  - Another worked example: `sqlite.rs` → `infrastructure/sqlite/{schema, mapping, repo, migrate_legacy}.rs`
- Line breaks: respect natural boundaries (e.g., function definitions, match arms), not artificial line counts

## Visibility: `pub(super)` vs `pub`

Rust privacy is module-scoped. Splitting an `impl` block or helper functions across sibling files in a directory module breaks their mutual visibility without explicit promotion.

**Convention:**

- **`pub`** — only for items genuinely part of the public `todo_engine::…` API surface
  - Domain types: `TodoItem`, `TodoEvent`, `ItemStatus`, `ItemType`, `Actor`
  - Service request structs: `CreateArea`, `ProposeTask`, `ProposeProject`, `ProposeRoutine`, `ProposeEvent`, `UpdateItem`
  - Entrypoints: `router()` (API), `run()` (CLI), `TodoService` constructors, re-exported domain types
  
- **`pub(super)`** — shared fields, methods, and free functions that need to cross a sibling-module boundary
  - `TodoService` fields: `store`, `events`, `id_counter`, `event_counter`, `clock_counter`
  - `TodoService` helpers: `next_id()`, `next_now()`, `store_item_and_event()`, `find_area()`, `ensure_relation()`, `set_terminal_status()`
  - Repository/mapping helpers: `storage_error()`, `row_to_item()`, `format_time()`, `actor_sqlite_value()`
  - API module helpers: `service()`, `with_service()`, `non_empty()`, `non_empty_string()`, `parse_actor_or_default()`, `parse_bool()`, `validation_rejection()`, `ApiState`, `ApiError`
  - CLI module helpers: `connect_path()`, `today_string()`, handlers like `create_area_handler()`, view renderers
  
- **`pub(crate)`** — rarely used; only when crossing major layer boundaries (e.g., `domain` → `application`)

**Rule:** Never widen to `pub` just to make a split compile. If the compiler complains that a sibling module can't see a helper, the fix is `pub(super)`, not `pub`.

**Anti-pattern:** A helper that only needs to cross sibling boundaries but is marked `pub` and exported in `mod.rs` is adding it to the public crate surface unnecessarily. Keep it `pub(super)`.

## Import Organization

**Order (top to bottom):**
1. Standard library: `use std::…`
2. External crates: `use anyhow::…`, `use axum::…`, etc.
3. Internal crate layers, depth-first:
   - `use crate::domain::…` (never depends on anything)
   - `use crate::application::…`
   - `use crate::infrastructure::…`
   - `use crate::interfaces::…` (only in `main.rs` and binary code)
4. Sibling/parent modules within the same layer: `use super::…`

**Path aliases:**
- No custom path aliases in `Cargo.toml`. Use fully-qualified `crate::…` paths.
- In handler files that import many domain types, qualify them from their layer (`crate::domain::{ItemStatus, Actor, TodoItem}`)

**Import pruning:**
- Remove unused imports immediately; `cargo clippy -D warnings` will catch them
- When moving code to a new file, diff the imports and delete anything the moved code doesn't actually use

## Error Handling

**Error Type:** `TodoError` (in `application/error.rs`)

| Variant | Display | Meaning | CLI Exit Code | HTTP Status |
|---------|---------|---------|---------------|-------------|
| `Policy(String)` | `{0}` | Policy violation (e.g., activating without definition-of-done) | 2 | 400 |
| `Validation(String)` | `{0}` | Input malformed or invalid | 2 | 400 |
| `NotFound(String)` | `Item not found: {0}` | Referenced item does not exist | 4 | 404 |
| `Storage(String)` | `storage error: {0}` | SQLite/storage operation failed | 1 | 500 |
| `Migration(String)` | `migration error: {0}` | Legacy migration failed | 1 | 500 |
| `Internal(String)` | `internal error: {0}` | Unexpected internal failure (e.g., serialization) | 1 | 500 |

**Type alias:** `TodoResult<T> = Result<T, TodoError>` — use throughout service and repository layers.

### No-Panic Policy

Production code must not `panic!` or `.unwrap()` on expected error paths. All expected failures become `TodoError` values.

**Exception sites (documented invariants):**
- Serializing a `TodoItem` to JSON (type serialization is guaranteed safe)
- Month arithmetic that is mathematically always in range
- Required timestamp expectations in `migrate_legacy.rs`: `.expect("created_at is required")`, `.expect("updated_at is required")`

These `.expect()` sites are preserved verbatim across refactors. Do not introduce new `.expect()` on paths that can realistically fail.

### Propagation Pattern

- **Service/Repository layers:** return `TodoResult<T>`, never panic on expected failures
- **CLI binary:** `run() -> anyhow::Result<()>` wraps commands. On error, downcast back to `TodoError` via `TodoError::cli_exit_code_from_error(&err)` to derive the process exit code. Non-`TodoError` anyhow errors yield `None` (fallback to generic failure).
- **API layer:** wrap any `Into<anyhow::Error>` in `ApiError`. `IntoResponse` downcasts to `TodoError` to select HTTP status and returns JSON `{"detail": "<message>"}`.

## Logging

**Three separate streams:**

| Stream | Target | Use |
|--------|--------|-----|
| stdout | User command result | JSON for created/updated items, rendered Markdown for views. Never diagnostic logs here — keep stdout parseable for scripts. |
| stderr | User errors + console tracing | Console-friendly logs at configured level. |
| file log | `TODO_ENGINE_HOME/logs/todo-engine.log.jsonl` | Structured JSONL tracing records for inspection. |

**Tracing API:** Use `tracing::{debug, info, warn, error}!`

| Level | Use |
|-------|-----|
| `debug` | Resolved paths, selected filters, repository/service steps, export/materialization details |
| `info` | Command start/completion, database open, major user-visible milestones |
| `warn` | Recoverable fallback behavior, logging/rotation failures |
| `error` | Command failures, storage/policy errors before returning to entrypoint |

**Log records attach an `event` field for machine-readable filtering:**

```rust
tracing::info!(event = "command_started", command = command_name, "command started");
tracing::debug!(event = "database_opened", path = %db_path.display());
tracing::error!(
    event = "command_failed",
    command = command_name,
    exit_code,
    error = %format!("{error:#}"),
    "command failed"
);
```

**Configuration via environment:**

| Destination | Env var | Default |
|-------------|---------|---------|
| stderr console logs | `TODO_ENGINE_CONSOLE_LOG` | `info` |
| `logs/todo-engine.log.jsonl` | `TODO_ENGINE_FILE_LOG` | `debug` |

Accepted levels: `off`, `error`, `warn`/`warning`, `info`, `debug`, `trace`. Invalid values fall back to the destination default.

**File log records** are JSON objects with fields:
- `timestamp` (RFC 3339 UTC)
- `level` (DEBUG, INFO, ERROR, etc.)
- `target` (Rust module path that emitted the event)
- `fields.event` (machine-readable event name, e.g., `command_started`)
- `fields.message` (human-readable message)
- `fields.command` (command label when applicable, e.g., `task propose`)
- `fields.exit_code` (0 on success, mapped CLI code on failure)
- `fields.duration_ms` (elapsed milliseconds on command completion/failure)
- `fields.error` (error message on command failure)

## Comments & Documentation

### When to Comment

- **Explain the why, not the what** — code should read naturally; comments clarify intent, constraints, or non-obvious behavior
- **Document invariants** — e.g., "IDs are deterministic in tests, UUIDs in production" (near `next_id()`)
- **Mark known limitations** — e.g., "This list is not sorted; caller must order it" (if the caller often expects that)
- **Justify unexpected patterns** — e.g., "We use `#[serde(rename = "type")]` because `type` is a keyword"

### JSDoc/Doc Comments

- Use `///` for public API items (structs, enums, pub functions)
- One-liner or structured example:
  ```rust
  /// Creates an area with the given title and optional review cycle.
  pub fn create_area(&mut self, request: CreateArea) -> TodoResult<TodoItem> { … }
  ```
- Link related items with backticks: `[TodoError]` or `` `TodoService` ``
- Do not document every parameter unless the name is not self-explanatory (Rust convention is that good names are self-documenting)

### Markdown in Source

- Minimal inline comments; prefer structured external docs in `docs/`
- Complex architectural decisions go in `docs/architecture/decisions/`
- Data model and CLI/API surfaces documented in `README.md`
- Testing patterns in `docs/conventions/testing.md`
- Error handling strategy in `docs/conventions/error-handling.md`

## Behavior Preservation Across Refactors

When refactoring, move code verbatim where possible:

- Keep raw SQL string literals **byte-for-byte**
- Preserve `.expect()` invariant site comments and logic
- Do not reorder deterministic ID/clock helper calls that tests assert exactly
- If a change cannot preserve behavior, **surface it rather than silently changing output** — update the test assertion and document the change

Behavior is locked by the three test layers (`unit`, `integration`, `e2e`). If a refactor changes observable output, the tests will fail — surface the change, do not work around it.

## Common Idioms

### Result Mapping in Handlers

```rust
// API handler pattern
pub(super) async fn create_area(
    State(state): State<ApiState>,
    body: std::result::Result<Json<AreaBody>, JsonRejection>,
) -> ApiResult<Json<TodoItem>> {
    let Json(body) = body.map_err(validation_rejection)?;  // map JSON parse errors
    let item = with_service(&state, |service| {
        service.create_area(CreateArea { … })
    })?;
    Ok(Json(item))
}
```

### Optional Field Handling

```rust
// Resolve optional title to ID
let area = area
    .as_deref()
    .map(Actor::from_str)
    .transpose()
    .map_err(TodoError::Validation)?
    .unwrap_or(Actor::Agent);
```

### Error Context in `anyhow`

```rust
// At binary boundary, use `with_context` for user-facing errors
let path = db_path.to_str().with_context(|| {
    format!("database path is not valid UTF-8: {}", db_path.display())
})?;
```

## Dependency Management

**Locked versions in `Cargo.toml`:** No workspace-level version inheritance; each dependency is pinned (e.g., `anyhow = "1.0"`, `axum = "0.7"`).

**Key dependencies:**
- `anyhow` — error handling at binary boundary
- `axum` — HTTP API framework
- `clap` — CLI argument parsing (with `derive` and `env` features)
- `rusqlite` — SQLite driver (with `bundled` feature)
- `serde` + `serde_json` — serialization
- `thiserror` — error type derive macro
- `time` — date/time with RFC 3339 serialization
- `tokio` — async runtime (with `macros`, `rt-multi-thread`, `net`)
- `tracing` + `tracing-subscriber` — structured logging
- `uuid` — UUID generation

**Dev dependencies:**
- `assert_cmd` — CLI testing
- `http`, `http-body-util` — HTTP test utilities
- `predicates` — assertion predicates
- `tempfile` — temp directory management
- `tower` — middleware/testing utilities

---

*Coding conventions: 2026-06-17*
