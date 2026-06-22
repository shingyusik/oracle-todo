# External Integrations

**Analysis Date:** 2026-06-22

## APIs & External Services

**None (local-first design):**
- No third-party SDKs, cloud APIs, or external service clients detected. The system is intentionally local-first: SQLite is the source of truth and the CLI + HTTP API are both views over it.

**Internal HTTP API (self-hosted):**
- Rust `axum` server exposed by the `api` CLI subcommand (`todo-engine/src/interfaces/cli/mod.rs:440`).
  - Bind: `--host` / `--port` (default port `3002`), via `tokio::net::TcpListener` (`mod.rs:444`).
  - Routes defined in `todo-engine/src/interfaces/api/mod.rs:31-49`: `/health`, `/areas`, `/projects/propose`, `/routines/propose`, `/events/propose`, `/tasks/propose`, `/items`, `/items/archive`, `/items/:id` (+ `/approve`, `/activate`, `/pause`, `/resume`, `/complete`, `/archive`, `/drop`, `/cancel`).
  - Frontend consumes it via Next.js rewrite: `/todo-engine/*` → `http://127.0.0.1:3002/*` (`frontend/next.config.mjs`).

## Data Storage

**Databases:**
- SQLite - The sole datastore and source of truth.
  - File: `todo.sqlite` at the data home (`todo-engine/src/infrastructure/paths.rs`, `db_path`).
  - Client: `rusqlite` 0.32 (bundled), repository in `todo-engine/src/infrastructure/sqlite/repo.rs`; schema in `schema.rs` (additive `init_schema`).
  - In-memory mode (`:memory:`) supported for tests via shared-cache URI with a kept-alive connection (`todo-engine/src/interfaces/api/mod.rs:65-85`).
  - Tables: `items`, `events` (audit log). JSON-encoded columns `second_brain_refs` and `metadata`.

**File Storage:**
- Local filesystem only. Data home layout: `todo.sqlite` plus `logs/todo-engine.log.jsonl(.1-.3)`.

**Caching:**
- None.

## Authentication & Identity

**Auth Provider:**
- None. The HTTP API has no authentication/authorization middleware; it binds locally (default `127.0.0.1`-class usage) for a single user.
- Actor model (not auth): requests carry an `Actor` (`Agent` or `User`) parsed in `parse_actor_or_default` (`todo-engine/src/interfaces/api/mod.rs:103`), defaulting to `Agent`. This drives approval-gating policy, not identity verification.

## Monitoring & Observability

**Error Tracking:**
- None (no Sentry/external tracker). Errors surface as typed `TodoError` mapped to HTTP status / CLI exit codes (`todo-engine/src/application/error.rs`, `api/mod.rs:136-147`).

**Logs:**
- `tracing` + `tracing-subscriber` with JSON file output and console output. Rotating JSONL files in `<data-home>/logs/`. Levels and rotation controlled by `TODO_ENGINE_*` env vars.

## CI/CD & Deployment

**Hosting:**
- Not applicable. Distributed/run as a local binary; no deployment platform config detected.

**CI Pipeline:**
- None detected (no `.github/workflows/`, no CI config files in the repo).

## Environment Configuration

**Required env vars:**
- None strictly required (sensible defaults). Optional: `TODO_ENGINE_HOME`, `TODO_ENGINE_CONSOLE_LOG`, `TODO_ENGINE_FILE_LOG`, `TODO_ENGINE_LOG_MAX_BYTES`, `TODO_ENGINE_LOG_MAX_FILES`. Falls back to `$HOME/.todo-engine`.

**Secrets location:**
- None. No API keys or credentials are used. `.env` is gitignored but no loader exists and no secrets are referenced in code.

## Webhooks & Callbacks

**Incoming:**
- None.

**Outgoing:**
- None.

## Reference Inputs

**Second Brain refs:**
- `second_brain_refs` is a read-only JSON column on items (`todo-engine/src/domain/model.rs:61`, `schema.rs:49`). Treated as reference input only; never written back to any external system.

---

*Integration audit: 2026-06-22*
