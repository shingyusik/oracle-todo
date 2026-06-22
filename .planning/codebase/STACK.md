# Technology Stack

**Analysis Date:** 2026-06-22

## Languages

**Primary:**
- Rust (edition 2024) - Core `todo-engine` crate: domain, application, infrastructure, and interfaces layers under `todo-engine/src/`.

**Secondary:**
- TypeScript (^5.5.0) - Next.js workbench frontend under `frontend/src/`.
- SQL - SQLite schema/queries embedded in `todo-engine/src/infrastructure/sqlite/schema.rs` and `repo.rs`.

## Runtime

**Environment:**
- Rust toolchain with edition 2024 + resolver 3 (`Cargo.toml`). No pinned `rust-toolchain.toml`; a recent stable/nightly supporting edition 2024 is required.
- Tokio async runtime (`tokio` 1, features `macros`, `rt-multi-thread`, `net`) for the HTTP API server (`todo-engine/src/interfaces/cli/mod.rs:443`).
- Node.js for the frontend (`@types/node` ^20.14.0; Next.js 14 targets Node 18+).

**Package Manager:**
- Cargo (workspace at root `Cargo.toml`, members `["todo-engine"]`).
  - Lockfile: present (`Cargo.lock`).
- npm for frontend (`frontend/package.json`).
  - Lockfile: present (`frontend/package-lock.json`).

## Frameworks

**Core (Rust):**
- `axum` 0.7 - HTTP router/server for the API interface (`todo-engine/src/interfaces/api/mod.rs`).
- `clap` 4.5 (features `derive`, `env`) - CLI argument parsing (`todo-engine/src/interfaces/cli/mod.rs`).
- `rusqlite` 0.32 (feature `bundled`) - SQLite access; bundled means SQLite compiles in, no system dependency.
- `tower` 0.5 (dev) - Service utilities used in API tests.

**Core (Frontend):**
- `next` ^14.2.0 - App Router framework (`frontend/src/app/`).
- `react` / `react-dom` ^18.3.0 - UI rendering.
- `lucide-react` ^0.563.0 - Icon set.

**Testing:**
- Rust: `assert_cmd` 2 + `predicates` 3 (CLI e2e), `tempfile` 3.15 (temp data homes), `http` 1 / `http-body-util` 0.1 / `tower` 0.5 (API integration). Three test binaries under `todo-engine/tests/{unit,integration,e2e}`.
- Frontend: `vitest` ^3.2.4 with `jsdom` ^29.0.1, `@testing-library/{react,jest-dom,user-event}` (`frontend/vitest.config.ts`).

**Build/Dev:**
- Cargo - Rust build/test (`cargo build`, `cargo test`, `cargo fmt`, `cargo clippy`).
- Next CLI - `next dev`, `next build` (`frontend/package.json`).
- `tsc` - Type checking via `npm run typecheck`.

## Key Dependencies

**Critical (Rust):**
- `serde` 1 + `serde_json` 1 - Serialization for DTOs, JSON columns (`second_brain_refs`, `metadata`), and API payloads.
- `time` 0.3 (features `formatting`, `parsing`, `macros`, `serde`, `serde-well-known`, `local-offset`) - Timestamps and recurrence date handling.
- `uuid` 1 (feature `v4`) - Item ID generation and in-memory shared-cache DB naming (`todo-engine/src/interfaces/api/mod.rs:73`).
- `anyhow` 1.0 - Application-level error context.
- `thiserror` 2 - Typed `TodoError` in `todo-engine/src/application/error.rs`.

**Infrastructure:**
- `tracing` 0.1 + `tracing-subscriber` 0.3 (features `env-filter`, `fmt`, `json`) - Structured logging to console and rotating JSONL files.

## Configuration

**Environment (Rust):**
- `TODO_ENGINE_HOME` - Data home directory; default `$HOME/.todo-engine` (`todo-engine/src/infrastructure/paths.rs`).
- `TODO_ENGINE_CONSOLE_LOG` (default `info`), `TODO_ENGINE_FILE_LOG` (default `debug`) - Log levels.
- `TODO_ENGINE_LOG_MAX_BYTES` (default `1_048_576`), `TODO_ENGINE_LOG_MAX_FILES` (default `3`) - Log rotation.
- `--home <path>`, `--host`, `--port` (default `3002`) - CLI flags (`todo-engine/src/interfaces/cli/mod.rs:161`).
- `.env` file: gitignored; not present/committed. No `.env` loader detected in Rust code (env read directly via `std::env`).

**Build:**
- `Cargo.toml` (root workspace + `todo-engine/Cargo.toml` package).
- `.cargo/config.toml` - Machine-local low-memory build settings (`jobs = 1`, `[profile.dev] debug = 0`). Gitignored; not committed.

**Frontend:**
- `frontend/next.config.mjs` - Rewrites `/todo-engine/:path*` to `http://127.0.0.1:3002/:path*`.
- `frontend/tsconfig.json` - TypeScript compiler config.
- `frontend/vitest.config.ts` - Test runner config.

## Platform Requirements

**Development:**
- Rust toolchain (edition 2024 capable); host with enough memory for rustc/LLVM (`.cargo/config.toml` serializes jobs and disables debuginfo to avoid OOM).
- Node.js 18+ and npm for frontend work.
- No system SQLite required (`rusqlite` bundled).

**Production:**
- Single self-contained Rust binary (`todo-engine`) serving CLI and HTTP API; SQLite file is the source of truth. Local-first; no external service deployment target detected. Frontend is an optional Next.js workbench proxying to the local API.

---

*Stack analysis: 2026-06-22*
