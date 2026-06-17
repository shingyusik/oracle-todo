<!-- refreshed: 2026-06-17 -->
# Architecture

**Analysis Date:** 2026-06-17

## System Overview

```text
┌────────────────────────────────────────────────────────────────────┐
│                         User / Agent / CLI                          │
│                          `interfaces/`                              │
├──────────────────────────┬──────────────────────────────────────────┤
│     CLI (clap)           │      API (axum)                          │
│  `interfaces/cli/`       │   `interfaces/api/`                      │
│  - Commands & routing    │   - HTTP handlers & routes               │
│  - Markdown output       │   - JSON DTO marshaling                  │
└──────────────────────────┴──────────────────────────────────────────┘
         │                              │
         └──────────────┬───────────────┘
                        ▼
        ┌──────────────────────────────────────┐
        │      TodoService (Policy Layer)      │
        │      `application/service/`          │
        ├──────────────────────────────────────┤
        │ - State machine transitions          │
        │ - Validation & approval gates        │
        │ - Audit event generation             │
        │ - Creation, updates, queries         │
        └──────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────────────────────────┐
│              Repository Layer (Abstraction)                          │
│              `application/ports.rs`                                  │
│  - TodoRepository trait                                              │
│  - EventRepository trait                                             │
│  - TodoStore combined trait                                          │
│  - ListFilter (declarative query specification)                      │
└──────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────────────────────────┐
│            SQLite Repository Implementation                          │
│            `infrastructure/sqlite/`                                  │
│  - SqliteTodoRepository (implements TodoStore)                       │
│  - Schema (init_schema, schema evolution)                            │
│  - Mapping (row ↔ domain model conversion)                           │
│  - Legacy migration (Python-era normalization)                       │
└──────────────────────────────────────────────────────────────────────┘
         │
         ▼
    ┌─────────────────┐
    │  todo.sqlite    │
    │ (Source of Truth)│
    └─────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| Domain Model | ItemType, Actor, ItemStatus, TodoItem, TodoEvent definitions — pure logic, no I/O | `todo-engine/src/domain/model.rs`, `status.rs`, `recurrence.rs` |
| Status Machine | Item lifecycle state machine (`proposed` → `approved` → `active` → terminal states) | `todo-engine/src/domain/status.rs` |
| TodoService | Enforces policy, validates state transitions, coordinates item/event persistence, generates audit events | `todo-engine/src/application/service/mod.rs` |
| Service Creation | Handles item proposal logic for areas, tasks, projects, routines, events | `todo-engine/src/application/service/creation.rs` |
| Service Transitions | Handles state transitions (approve, activate, pause, resume, complete, archive, drop, cancel) | `todo-engine/src/application/service/transitions.rs` |
| Service Updates | Handles item field updates | `todo-engine/src/application/service/update.rs` |
| Service Queries | Handles retrieval and listing operations | `todo-engine/src/application/service/queries.rs` |
| Service Materialization | Handles routine → task materialization and cascading rules | `todo-engine/src/application/service/materialization.rs` |
| Repository Ports | Abstract trait definitions for item/event storage | `todo-engine/src/application/ports.rs` |
| Error Handling | TodoError enum with CLI exit codes and HTTP status codes | `todo-engine/src/application/error.rs` |
| SQLite Repository | Implements TodoStore, manages persistence, SQL generation, schema migrations | `todo-engine/src/infrastructure/sqlite/repo.rs` |
| SQLite Schema | Initializes/evolves database schema, adds missing columns | `todo-engine/src/infrastructure/sqlite/schema.rs` |
| SQLite Mapping | Converts rusqlite Row ↔ domain model (TodoItem, TodoEvent) | `todo-engine/src/infrastructure/sqlite/mapping.rs` |
| Paths Resolution | Resolves data home directory (env var, explicit, or default `~/.todo-engine/`) | `todo-engine/src/infrastructure/paths.rs` |
| System & Tracing | Structured JSON logging with rotation, local date/time helpers | `todo-engine/src/infrastructure/system.rs` |
| CLI Router | clap command parsing, dispatch, subcommand routing | `todo-engine/src/interfaces/cli/mod.rs` |
| CLI Creators | Parse and execute area, task, project, routine, event proposal commands | `todo-engine/src/interfaces/cli/create.rs` |
| CLI Lifecycle | Parse and execute state transition commands (approve, activate, complete, etc.) | `todo-engine/src/interfaces/cli/lifecycle.rs` |
| CLI Views | Render list, archive, pending, today views in Markdown | `todo-engine/src/interfaces/cli/views.rs` |
| CLI Markdown | Markdown table and formatting renderer | `todo-engine/src/interfaces/cli/markdown.rs` |
| CLI Output | Shared JSON serialization helpers | `todo-engine/src/interfaces/cli/output.rs` |
| API Router | axum HTTP router with routes, error handling, response mapping | `todo-engine/src/interfaces/api/mod.rs` |
| API Handlers | HTTP endpoint implementations (18 endpoints) | `todo-engine/src/interfaces/api/handlers.rs` |
| API DTOs | Request/response data transfer objects | `todo-engine/src/interfaces/api/dto.rs` |
| Crate Wiring | Re-exports of public API surface, module organization | `todo-engine/src/lib.rs` |
| Binary Entrypoint | CLI main, error handling, exit code mapping | `todo-engine/src/main.rs` |

## Pattern Overview

**Overall:** Hexagonal/Clean Architecture with inward-pointing dependency rule.

**Key Characteristics:**
- **Layered isolation**: Domain (pure), Application (policy/service), Infrastructure (storage/system), Interfaces (CLI/API)
- **Single source of truth**: SQLite `todo.sqlite` is canonical; CLI and API are both views over it
- **Policy enforcement**: All mutations route through `TodoService`; no direct repository writes
- **Audit trail**: Every service mutation writes an immutable `TodoEvent` row with `before`/`after` JSON snapshots
- **Approval gating**: Agent-created items start `proposed` and require user approval before activation; user-created items can start `approved`
- **Deterministic testing**: In-memory service mode uses deterministic ID/clock counters; persistent mode uses UUIDs and real time
- **Repository abstraction**: `TodoStore` trait allows swapping implementations (SQLite, in-memory, etc.)

## Layers

**Domain (`todo-engine/src/domain/`):**
- Purpose: Pure value types and domain logic — no I/O, no framework dependencies
- Location: `todo-engine/src/domain/`
- Contains: `ItemType`, `Actor`, `ItemStatus` enum + state helpers, `TodoItem` struct, `TodoEvent` struct, recurrence parsing
- Depends on: `time`, `serde`, `serde_json` (data types only — no I/O)
- Used by: Application layer (service), Infrastructure (SQLite mapping), Interfaces (CLI/API serialization)

**Application (`todo-engine/src/application/`):**
- Purpose: Business logic, policy enforcement, state machine, service coordination
- Location: `todo-engine/src/application/`
- Contains: `TodoService` (split by concern: creation, transitions, updates, queries, materialization), repository port traits (`TodoRepository`, `EventRepository`, `TodoStore`), error type `TodoError`, filter types
- Depends on: Domain (value types), application-layer crates (`thiserror`, `uuid`)
- Used by: Interfaces (CLI/API call the service)
- **Key insight**: Service layer is the policy enforcement boundary. No bypassing to direct repository writes.

**Infrastructure (`todo-engine/src/infrastructure/`):**
- Purpose: I/O, storage, system integration
- Location: `todo-engine/src/infrastructure/`
- Contains: SQLite repository impl, schema migration, row↔domain mapping, path resolution, structured logging with rotation, clock/date helpers, legacy Python-era migration
- Depends on: Application (port traits), Domain (value types), I/O crates (`rusqlite`, `tracing`, `tracing-subscriber`)
- Used by: CLI/API (to instantiate repository and pass to service)

**Interfaces (`todo-engine/src/interfaces/`):**
- Purpose: External surfaces — user input/output adapters
- Location: `todo-engine/src/interfaces/`
- Contains: CLI (clap command parsing, Markdown rendering, dispatch), API (axum router, HTTP handlers, JSON DTOs)
- Depends on: Application (TodoService, TodoError, domain types), Infrastructure (paths, tracing setup), I/O crates (`clap`, `axum`, `serde_json`)
- Used by: Binary (`main.rs` calls CLI `run()`) and HTTP server (`router()` called by host)

## Data Flow

### Primary Request Path (CLI Command Example: `todo-engine approve <id>`)

1. **CLI Parse** (`interfaces/cli/mod.rs:run()`) — clap parses command line args, resolves data home via `paths::todo_home()`
2. **Tracing Init** (`infrastructure/system.rs:init_tracing()`) — sets up structured logging (stderr + rotating JSON file)
3. **Service Instantiation** (`interfaces/cli/lifecycle.rs:approve()`) — connects to SQLite, wraps in `SqliteTodoRepository`, passes to `TodoService::persistent()`
4. **Policy & Transition** (`application/service/transitions.rs:TodoService::approve()`) — validates item status, checks approval rules, snapshots `before` state
5. **Mutation** (`application/service/mod.rs:store_item_and_event()`) — calls repository `save_item_and_event()` atomically
6. **SQLite Write** (`infrastructure/sqlite/repo.rs`) — upserts `items` table row, inserts `events` table row in transaction
7. **Event Capture** (`application/service/mod.rs::events`) — appends `TodoEvent` to service's in-memory event vector
8. **Output** (`interfaces/cli/lifecycle.rs` → Markdown table or JSON) — renders the updated item
9. **Exit** (`main.rs`) — maps `TodoError` to CLI exit code (2 = policy/validation, 4 = not-found, 1 = storage/internal, 0 = success)

### Routine Materialization (Background Task Generation)

1. CLI invokes `routine materialize` command or API calls `/routines/materialize`
2. Service calls `TodoService::materialize_routines()` (`application/service/materialization.rs`)
3. For each active routine within lookahead window:
   - Parse `recurrence_rule` to compute occurrence dates (via `domain::occurrences()`)
   - Check `last_materialized_at` + `materialization_policy` to decide how many tasks to generate
   - Create `TodoTask` items with `generated_by: "routine"` metadata
   - Store each via `store_item_and_event(Actor::System, "generate", ...)`
4. Return materialized count and list of created task IDs

### Approval Gate (Agent-Created Items)

1. An agent proposes a task via API `/tasks/propose` with `actor: "agent"`
2. `TodoService::propose_task()` creates item with `proposed_by: Actor::Agent`, `status: Proposed`
3. Item is stored and event is recorded (`action: "propose"`)
4. CLI/API `pending` view shows `proposed` work separately from `active`
5. User calls CLI `approve <id>` or API `PATCH /items/<id>/approve`
6. `TodoService::approve()` checks `status in [Proposed, Approved]`, updates `approved_by: User`, `approved_at: now`, `status: Approved`
7. User then calls CLI `activate <id>` or API `POST /items/<id>/activate` to move to `Active`
8. Activate validates that agent-created items have `approved_at` set; user-created items skip this check

**State Management:**
- **In-memory service**: `TodoService::in_memory()` — for tests, uses HashMap<id, TodoItem>, deterministic ID/clock counters
- **Persistent service**: `TodoService::persistent(store)` — wraps `SqliteTodoRepository`, uses UUIDs and real-time clock
- **Event accumulation**: `service.events()` returns `&[TodoEvent]` of all mutations in current session
- **Transaction safety**: SQLite repo's `save_item_and_event()` ensures item and audit event are written atomically

## Key Abstractions

**TodoService:**
- Purpose: Orchestrates all mutations and queries; enforces policy and state machine
- Examples: `apply_approval()`, `activate()`, `complete()`, `pause()`, `propose_task()`, `materialize_routines()`
- Pattern: Service layer; acts as mediator between interfaces (CLI/API) and repository

**TodoStore Trait:**
- Purpose: Repository abstraction; decouples service from storage impl
- Examples: `save_item_and_event()`, `get_item()`, `list_items()`
- Pattern: Hexagonal architecture port; enables in-memory testing and future alternative storage

**ListFilter:**
- Purpose: Declarative query specification (replaces imperative SQL building)
- Examples: `ListFilter { item_type: Some(ItemType::Task), status: Some(ItemStatus::Active), include_archived: false, ... }`
- Pattern: Query object; logic applied uniformly in `apply_list_filter()` for both in-memory and persistent repos

**TodoError:**
- Purpose: Unified error type with automatic CLI exit code / HTTP status code mapping
- Examples: `TodoError::Policy(...)` → CLI exit 2 / HTTP 400, `TodoError::NotFound(...)` → CLI exit 4 / HTTP 404
- Pattern: Result type; `pub type TodoResult<T> = Result<T, TodoError>`

**ItemStatus State Machine:**
- Purpose: Defines valid status lifecycle and terminal states
- Statuses: `Proposed` → `Approved` → `Active` → `{Completed, Paused, Cancelled, Dropped, Archived, Someday, Rejected}`
- Terminal states (immutable): `{Completed, Cancelled, Dropped, Archived, Someday, Rejected}`
- Hidden by default: `{Archived, Dropped, Cancelled}` (shown only if `include_archived` filter set)

## Entry Points

**CLI Entry Point:**
- Location: `todo-engine/src/main.rs`
- Triggers: Binary execution `./todo-engine <subcommand> [args]`
- Responsibilities: Parses args, resolves data home, initializes tracing, dispatches to CLI `run()`, maps error to exit code

**CLI Run:**
- Location: `todo-engine/src/interfaces/cli/mod.rs:run()`
- Triggers: Called from `main.rs`
- Responsibilities: Clap command parsing, data home resolution, tracing setup, dispatch to subcommand handlers (init/health/create/transition/update/view), timing/logging

**API Router:**
- Location: `todo-engine/src/interfaces/api/mod.rs:router()`
- Triggers: Called by HTTP server host (e.g., `axum::run()` in `main.rs` when run with `--api` flag, or integration tests)
- Responsibilities: Sets up axum Router with 18 routes, creates ApiState (db_path, connection keeper), returns router

**Service Entry Point (Internal):**
- Location: `todo-engine/src/application/service/mod.rs:TodoService::persistent(store)`
- Triggers: Called by CLI/API after instantiating `SqliteTodoRepository`
- Responsibilities: Wraps repository, initializes event vector, sets up ID/clock counters

## Architectural Constraints

- **Threading:** Single-threaded event-loop (CLI); Multi-threaded HTTP server (axum). SQLite connection is NOT thread-safe; each handler creates a new connection.
- **Global state:** No module-level singletons; service is instantiated per-request (CLI) or per-HTTP-handler
- **Circular imports:** None — dependency rule enforced by unit test (`tests/unit/architecture.rs`)
- **Deterministic testing:** In-memory service uses incrementing counters for IDs and a base datetime + offset for clock; persistent mode uses UUIDs and real-time
- **Database transaction scope:** `save_item_and_event()` is atomic (item + event written together); no multi-step transactions
- **Approval workflow:** Agent-created items must have `approved_at` before `activate()` accepts them; user-created items may activate immediately
- **Recurrence materialization:** Happens on-demand via CLI/API command; not automatic. Routine must have `recurrence_rule` and `active` status to materialize.

## Anti-Patterns

### Bypassing TodoService to Direct Repository

**What happens:** Code directly calls `store.save_item()` instead of routing through `TodoService`

**Why it's wrong:** Skips validation, state machine, and audit event generation — breaking the core invariant that every mutation is audited

**Do this instead:** All mutations must go through `TodoService` methods (propose, activate, complete, etc.). If a new operation is needed, add it to `TodoService`, not the repository.

### Storing SQLite Connection as Global State

**What happens:** Keeping a single `Connection` across multiple CLI commands or HTTP requests

**Why it's wrong:** SQLite connections are not thread-safe; sharing across threads causes data corruption. Each request must create its own connection.

**Do this instead:** Instantiate `SqliteTodoRepository::new(connect(path)?)` fresh per CLI command or per HTTP handler. The keeper pattern (API's `Arc<Mutex<Connection>>` for in-memory databases) is an exception for shared test DBs only.

### Mutating Domain Types Outside TodoService

**What happens:** Modifying `TodoItem` fields directly after retrieving from service

**Why it's wrong:** Changes are not persisted, audit events are not generated, state machine is not enforced

**Do this instead:** Call `service.update_item(...)` or appropriate transition method. All mutations go through service.

## Error Handling

**Strategy:** Layered error propagation with mapping at boundaries.

**Patterns:**
- **Domain layer:** Does not use `Result`; pure functions only
- **Application layer:** `TodoResult<T> = Result<T, TodoError>` with 6 variants (Policy, NotFound, Validation, Storage, Migration, Internal)
- **Infrastructure layer:** `rusqlite::Error` mapped to `TodoError::Storage(...)`
- **Interfaces:** CLI error mapped to exit code via `TodoError::cli_exit_code()`; API error mapped to HTTP status via `TodoError::http_status_code()` and `ApiError` wrapper
- **Exit codes:** CLI — 0 success, 2 policy/validation, 4 not-found, 1 storage/internal/migration; HTTP — 200 OK, 400 policy/validation, 404 not-found, 500 storage/internal/migration

## Cross-Cutting Concerns

**Logging:** Structured JSON tracing via `tracing` + `tracing-subscriber`. Console output to stderr (level: `TODO_ENGINE_CONSOLE_LOG`, default `info`); rotating JSONL file to `logs/todo-engine.log.jsonl` (level: `TODO_ENGINE_FILE_LOG`, default `debug`). Rotation at `TODO_ENGINE_LOG_MAX_BYTES` (default 1MB) with up to `TODO_ENGINE_LOG_MAX_FILES` (default 3) backups.

**Validation:** Eager validation in `TodoService` methods before state mutation (e.g., `activate()` validates that project has `definition_of_done`, routine has `recurrence_rule`, agent-created items have approval)

**Authentication:** Not implemented in core engine. HTTP API is assumed to be behind an auth boundary (reverse proxy or host middleware).

**State Machine Enforcement:** `TodoService` methods check current status and enforce valid transitions. Terminal states are immutable (no transitions from them).

**Audit Trail:** `TodoEvent` table stores `{actor, action, before, after}` snapshots; enables full history reconstruction and "what changed when" queries.

---

*Architecture analysis: 2026-06-17*
