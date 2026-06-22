# Coding Conventions

**Analysis Date:** 2026-06-22

> Source of truth: `docs/conventions/{code-style,error-handling,logging}.md`. This document
> distills those plus observed source patterns. Language is Rust 2024; crate `todo_engine`
> (package `todo-engine`), built as both lib and binary under `todo-engine/`.

## Naming Patterns

**Files:**
- snake_case module files: `service.rs`, `recurrence.rs`, `error_mapping.rs`.
- Oversized files split into directory modules by responsibility, e.g.
  `application/service/{creation,transitions,update,materialization,queries}.rs`,
  `infrastructure/sqlite/{schema,mapping,repo}.rs`.

**Functions:**
- snake_case (`cli_exit_code`, `propose_task`, `http_status_code`).
- Conversion/factory helpers spell out intent: `cli_exit_code_from_error`, `in_memory`.

**Variables:**
- snake_case, descriptive (`db_path`, `command_name`, `exit_code`).

**Types:**
- UpperCamelCase structs/enums (`TodoService`, `SqliteTodoRepository`, `TodoError`,
  `ItemStatus`, `ProposeTask`).
- Use the real established symbol names — `SqliteTodoRepository`, not `SqliteRepository`.
  Do not rename public symbols.
- Type alias for the common Result: `TodoResult<T> = Result<T, TodoError>`
  (`todo-engine/src/application/error.rs`).

**Enum string forms:**
- Canonical lowercase for `ItemStatus`/`Actor`; `ItemType` is snake_case (`archive_item`).
- `FromStr` impls are case-sensitive and trim whitespace.

## Code Style

**Formatting:**
- `rustfmt` (default profile). Gate: `cargo fmt --check`.

**Linting:**
- `cargo clippy --all-targets --all-features -- -D warnings`. Warnings are hard errors:
  a stray unused import or dead helper fails the build. When moving code between modules,
  trim imports to exactly what the moved code needs.

**File size:**
- Keep source files focused, roughly under ~400 lines. Split by responsibility into a
  directory module rather than letting one file accumulate unrelated concerns.

## Visibility

- Prefer `pub(super)` over `pub` for items that only cross a sibling-module boundary
  (shared fields, helper methods, free functions). Use `pub(crate)` if they must cross further.
- Reserve `pub` for genuine public crate surface: request structs (`ProposeTask`),
  entrypoints (`router`, `run`), re-exported domain types.
- Never widen something to `pub` just to make a module split compile — the fix is `pub(super)`.

## Import Organization

Observed order (top of file, grouped, rustfmt-sorted within group):
1. `std` imports (`use std::path::{Path, PathBuf};`)
2. External crates (`use thiserror::Error;`, `use axum::body::Body;`, `use serde_json::{Value, json};`)
3. Crate-internal / sibling (`use todo_engine::application::service::{...};`,
   `use crate::support::TestHome;`)

**Path aliases:** None — full module paths used.

## Error Handling

- Domain/service errors modeled by `TodoError` enum (`todo-engine/src/application/error.rs`),
  derived with `thiserror` (`#[derive(Debug, Error, PartialEq)]`).
- Six variants: `Policy`, `Validation`, `NotFound`, `Storage`, `Migration`, `Internal`,
  each carrying a `String` with a `#[error(...)]` `Display` form.
- Variant drives both `cli_exit_code()` and `http_status_code()`:
  `Policy`/`Validation` → 2 / 400; `NotFound` → 4 / 404; `Storage`/`Migration`/`Internal` → 1 / 500.
- Service and repository layers return `TodoResult<T>` and never panic on expected failures.
- Binary boundary: CLI uses `anyhow` (`run() -> anyhow::Result<()>`), downcasts via
  `TodoError::cli_exit_code_from_error(&err)` for the process exit code.
- API wraps any `Into<anyhow::Error>` in `ApiError`; `into_response` downcasts to `TodoError`
  to pick the status and returns JSON `{"detail": "<message>"}`.

**No-panic policy:**
- No `panic!`/`unwrap` on expected error paths — failures become `TodoError` values.
- Remaining `.expect()` sites are documented invariants that genuinely cannot fail
  (e.g. serializing a `TodoItem` to JSON, in-range month arithmetic). Preserve verbatim;
  do not add new `.expect()` on realistically-failing paths.

## Logging

**Framework:** `tracing` + `tracing-subscriber` (configured in
`todo-engine/src/infrastructure/system.rs`).

**Patterns:**
- Use `tracing::{debug, info, warn, error}!`. Never write diagnostic logs to stdout — keep
  stdout parseable for scripts. CLI streams: stdout (result), stderr (errors + console traces),
  file (JSONL).
- Attach an `event` field for machine-readable filtering:
  ```rust
  tracing::info!(event = "command_started", command = command_name, "command started");
  tracing::error!(event = "command_failed", command = command_name, exit_code,
      error = %format!("{error:#}"), "command failed");
  ```
- Levels: `debug` (resolved paths, filters, repo/service steps), `info` (command
  start/completion, DB open), `warn` (recoverable fallback, log/rotation failures),
  `error` (command/storage/policy failures before returning to entrypoint).
- File logging is best-effort and must not abort the command.

## Comments

**When to comment:**
- Doc comments (`///`) on non-obvious tests/invariants (e.g. architecture guard:
  `/// The domain layer must stay pure...`).
- Keep comments explaining intent/invariants; avoid restating code.

## Function Design

- Small, single-responsibility functions; helpers promoted to `pub(super)` as needed.
- Return `TodoResult<T>` through service/repository layers; `anyhow::Result` only at the
  binary boundary.
- Request inputs modeled as dedicated structs (`CreateArea`, `ProposeTask`, `ProposeProject`)
  that implement `Default`, enabling `..Default::default()` at call sites.

## Module Design

- Clean/hexagonal layering: `domain` (pure), `application`, `infrastructure`, `interfaces`.
  Dependencies point inward; `domain` does no I/O (enforced by an architecture test).
- Exports: re-export domain types through layer boundaries; keep `pub` surface minimal.

## Behavior Preservation (refactors)

- Move code verbatim where possible: keep raw SQL string literals byte-for-byte, preserve
  documented `.expect()` invariant sites, do not reorder deterministic ID/clock helper calls
  that tests assert exactly. Behavior is locked by the test layers (see TESTING.md).

---

*Convention analysis: 2026-06-22*
