# External Integrations

**Analysis Date:** 2026-06-17

## APIs & External Services

**None detected** - `todo-engine` is a local-first, self-contained service with no outbound API calls.

The codebase enforces this principle: no HTTP client dependencies, no external service credentials, no webhook dispatch. The only external interface is inbound:
- CLI commands from the user
- HTTP API requests from clients (Telegram bots, dashboards, agents)

## Data Storage

**Databases:**
- SQLite (single-file, embedded)
  - Connection: `rusqlite` 0.32 crate with bundled SQLite
  - Path: `<TODO_ENGINE_HOME>/todo.sqlite` (resolved via `TODO_ENGINE_HOME` env var or `~/.todo-engine/`)
  - Schema: `items` table (areas, projects, tasks, routines, events), `events` audit table
  - Locking: SQLite default (file-level locks, single writer)
  - Foreign keys: Enabled via `PRAGMA foreign_keys = ON` on connection init
  - Source: `todo-engine/src/infrastructure/sqlite/` (repo, schema, migration logic)

**File Storage:**
- Local filesystem only
  - SQLite database: `<data-home>/todo.sqlite`
  - Logs: `<data-home>/logs/todo-engine.log.jsonl` (JSONL format, rotated backups)
  - No cloud storage, no S3, no file sharing integrations

**Caching:**
- In-memory only (Rust service layer holds item/event state in request scope)
- No Redis, no memcached, no persistent cache layer

## Authentication & Identity

**Auth Provider:**
- Custom/None - `todo-engine` does not authenticate users
  - CLI: No authentication (assumes single-user machine ownership)
  - HTTP API: No authentication layer (implementer responsibility; see `Actor` enum in domain)
  - Identity model: `Actor` type in domain (`todo_engine::domain::Actor`) tracks who created/approved items
  - Actor variants: `user`, `agent`, `system` (open enum for extensibility)

**User Representation:**
- `proposed_by` field (TEXT) on items — stores actor identifier (JSON string, typically username or ID)
- `approved_by` field (TEXT) on items — stores approver identifier
- No password hashing, no session management, no RBAC at the engine layer

## Monitoring & Observability

**Error Tracking:**
- None detected - No external error tracking service (Sentry, Rollbar, etc.)
- Error handling: Custom `TodoError` enum with policy/validation/storage/internal variants
- Error exit codes: CLI (2 = policy violation, 4 = not found, 1 = storage), HTTP (400, 404, 500)
- Location: `todo-engine/src/application/error.rs`

**Logs:**
- **Console output:** stderr (structured text, INFO level by default)
- **File logs:** JSONL format to `<data-home>/logs/todo-engine.log.jsonl`
- **Levels:**
  - Console: `TODO_ENGINE_CONSOLE_LOG` env var (default `info`)
  - File: `TODO_ENGINE_FILE_LOG` env var (default `debug`)
- **Rotation:** File grows to `TODO_ENGINE_LOG_MAX_BYTES` (default 1 MB), rotates to `.1`, `.2`, `.3` (max files: `TODO_ENGINE_LOG_MAX_FILES`, default 3)
- **Framework:** `tracing` + `tracing-subscriber` (structured event logs with span context)
- **Location:** `todo-engine/src/infrastructure/system.rs` (rotation logic)

## CI/CD & Deployment

**Hosting:**
- Not detected - No deployment platform specified
- Deployment model: User-managed (self-hosted)
- Supported platforms: Linux, macOS, Windows (any platform with Rust toolchain)

**CI Pipeline:**
- Not detected - No GitHub Actions, GitLab CI, or build server config in codebase
- Local build gates (see `CLAUDE.md` for manual checks):
  - `cargo fmt --check` - Format validation
  - `cargo clippy --all-targets --all-features -- -D warnings` - Linting (warnings as errors)
  - `cargo test` - Unit, integration, e2e tests

**Build Requirements:**
- Rust 1.70+ (Edition 2024)
- Cargo
- SQLite bundled (no external SQLite dependency)

## Environment Configuration

**Required env vars:**
- `HOME` - System home directory (used if `TODO_ENGINE_HOME` not set)

**Optional env vars:**
- `TODO_ENGINE_HOME` - Override data home path
- `TODO_ENGINE_CONSOLE_LOG` - Console log level (info, debug, warn, error)
- `TODO_ENGINE_FILE_LOG` - File log level (info, debug, warn, error)
- `TODO_ENGINE_LOG_MAX_BYTES` - Log rotation size in bytes
- `TODO_ENGINE_LOG_MAX_FILES` - Number of rotated backups to keep

**Secrets location:**
- No secrets management layer detected
- Sensitive data: None stored by engine (no API keys, no credentials)
- Machine-local data home: User must control access via OS file permissions
- `.env` files: Listed in `.gitignore` but not used by the engine (developer choice)

## Webhooks & Callbacks

**Incoming Webhooks:**
- HTTP API endpoints (user-driven, not event-triggered callbacks)
- Endpoints: See `todo-engine/src/interfaces/api/mod.rs`
  - `POST /health` - Health check
  - `POST /areas` - Create area
  - `POST /projects/propose`, `/routines/propose`, `/events/propose`, `/tasks/propose` - Propose items
  - `GET /items`, `GET /items/archive` - List items
  - `PATCH /items/:id` - Update item
  - `POST /items/:id/{approve,activate,pause,resume,complete,archive,drop,cancel}` - State transitions
- No long-polling, no streaming, no WebSocket support
- No authentication middleware (delegated to HTTP server or reverse proxy)

**Outgoing Webhooks:**
- None - Engine does not dispatch events to external systems
- Output channels: CLI stdout/stderr, HTTP API responses, SQLite database changes

## Command Dispatch & Interfaces

**CLI Entry Point:**
- `todo-engine/src/interfaces/cli/mod.rs` - Command parser and dispatch
- Subcommands: `init`, `health`, `list`, `area`, `project`, `task`, `routine`, `event`, `approve`, `activate`, `pause`, `resume`, `complete`, `archive`, `drop`, `cancel`, `update`, `archive-list`, `pending`, `today`
- Output: Markdown (human), JSON (structured), text (error messages)
- Exit codes: 0 (success), 1 (internal error), 2 (validation error), 4 (not found)

**HTTP API:**
- `todo-engine/src/interfaces/api/mod.rs` - Axum router
- Port: Not specified in code (defaults to 127.0.0.1:3000 if run via HTTP wrapper, not built-in)
- Request/Response: JSON body, standard HTTP status codes
- Error responses: `{ "error": "message" }` with appropriate status (400, 404, 500)

## Service Layer & Policy

**Core Service:**
- `TodoService` in `todo-engine/src/application/service/mod.rs`
- All mutations route through service (no direct database writes)
- Policy enforcement: status state machine, approval gating, validation
- Audit events: Every mutation writes a `TodoEvent` to SQLite before returning

**Repository Ports:**
- Traits in `todo-engine/src/application/ports.rs`
- Implementations: `SqliteTodoRepository` in `todo-engine/src/infrastructure/sqlite/repo.rs`
- Interface: `TodoRepository` (save/get/list), `EventRepository` (save events), `TodoStore` (combined)

---

*Integration audit: 2026-06-17*
