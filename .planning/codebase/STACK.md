# Technology Stack

**Analysis Date:** 2026-06-17

## Languages

**Primary:**
- Rust 2024 (Edition 2024) - Core service layer, CLI, HTTP API, database abstraction

**Secondary:**
- None detected

## Runtime

**Environment:**
- Rust toolchain (1.70+, Edition 2024)

**Package Manager:**
- Cargo (workspace-based)
- Lockfile: `Cargo.lock` present (1496 lines)

## Frameworks

**Core:**
- `axum` 0.7 - HTTP API framework (routing, extractors, middleware)
- `clap` 4.5 - CLI framework (command parsing, argument validation with derive macros)
- `rusqlite` 0.32 - SQLite database driver (bundled SQLite compiled in)

**Error Handling:**
- `thiserror` 2 - Error type derivation and Display formatting

**Serialization:**
- `serde` 1 - Serialization traits and macros
- `serde_json` 1 - JSON serialization/deserialization

**Time & Dates:**
- `time` 0.3 - Date/time parsing, formatting, RFC3339 support with local-offset

**Async Runtime:**
- `tokio` 1 - Async execution (multi-threaded runtime, network I/O)

**Logging & Tracing:**
- `tracing` 0.1 - Structured logging facade
- `tracing-subscriber` 0.3 - Log formatting, filtering, JSON output, log rotation support

**Utilities:**
- `uuid` 1 - UUID v4 generation for unique IDs
- `anyhow` 1 - Flexible error handling with context

## Key Dependencies

**Critical:**
- `rusqlite` 0.32 - SQLite driver with bundled build; source of truth for all data persistence
- `axum` 0.7 - HTTP API surface; routes all external API requests
- `clap` 4.5 - CLI parser; routes all command-line inputs
- `tokio` 1 - Async runtime for HTTP server and I/O operations

**Infrastructure:**
- `tracing` + `tracing-subscriber` - Structured JSON logging to files with rotation
- `time` 0.3 - RFC3339 timestamps, local timezone support, ISO 8601 parsing
- `serde` + `serde_json` - Domain model serialization (events, items, DTOs)
- `uuid` 1 - Unique identifiers for items and events

**Testing:**
- `assert_cmd` 2 - CLI output assertion (dev-dependency)
- `predicates` 3 - Predicate-based assertions (dev-dependency)
- `tempfile` 3.15 - Temporary directories for test databases (dev-dependency)
- `tower` 0.5 - Test middleware and routing utilities (dev-dependency)
- `http` 1 - HTTP constants and types for API testing (dev-dependency)
- `http-body-util` 0.1 - HTTP body utilities for response testing (dev-dependency)

## Configuration

**Environment:**
- `TODO_ENGINE_HOME` - Data home path (default: `~/.todo-engine/`)
- `TODO_ENGINE_CONSOLE_LOG` - Console log level (default: `info`)
- `TODO_ENGINE_FILE_LOG` - File log level (default: `debug`)
- `TODO_ENGINE_LOG_MAX_BYTES` - Log rotation threshold in bytes (default: `1048576` / 1 MB)
- `TODO_ENGINE_LOG_MAX_FILES` - Number of rotated log files to retain (default: `3`)
- `HOME` - System home directory; used to compute default data home if `TODO_ENGINE_HOME` is unset

**Build:**
- `.cargo/config.toml` - Machine-local build settings (single job, no debuginfo for low-memory builds)
- Workspace resolver: version 3

## Platform Requirements

**Development:**
- Rust 1.70+ (Edition 2024)
- Cargo package manager
- SQLite build tools (bundled via `rusqlite`)
- ~1 GB RAM minimum (configurable via `.cargo/config.toml`)

**Production:**
- Linux, macOS, or Windows with Rust runtime
- SQLite library (bundled)
- ~20-50 MB disk for database and logs per year
- ~100 MB heap for service process

## Workspace Structure

**Members:**
- `todo-engine/` - Main Rust crate (binary + library)
- `frontend/` - Reserved for future UI package (placeholder)

**Entry Points:**
- `todo-engine/src/main.rs` - CLI binary entrypoint
- `todo-engine/src/lib.rs` - Library exports (service, domain, infrastructure interfaces)
- `todo-engine/src/interfaces/api/mod.rs` - HTTP API router (axum)
- `todo-engine/src/interfaces/cli/mod.rs` - CLI command dispatch (clap)

## Build Commands

```bash
cargo build                                    # Build the workspace (debug mode)
cargo build --release                         # Build with optimizations
cargo run -p todo-engine -- <command>         # Run the CLI
cargo test                                    # Run all tests
cargo fmt --check                            # Format gate
cargo clippy --all-targets --all-features -- -D warnings # Lint gate
```

## Data Persistence

**Database:**
- SQLite single-file database (`todo.sqlite`)
- Location: `<TODO_ENGINE_HOME>/todo.sqlite`
- Schema version tracked via `PRAGMA user_version`
- Foreign keys enabled, indices on high-query columns

**Logging:**
- JSONL format (structured logs as newline-delimited JSON)
- Location: `<TODO_ENGINE_HOME>/logs/todo-engine.log.jsonl`
- Rotation: 4 files max (main + 3 backups) at `1_048_576` bytes each
- Backups named: `.log.jsonl.1`, `.log.jsonl.2`, `.log.jsonl.3`

---

*Stack analysis: 2026-06-17*
