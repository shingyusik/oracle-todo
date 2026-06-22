<!-- refreshed: 2026-06-22 -->
# Architecture

**Analysis Date:** 2026-06-22

## System Overview

```text
┌─────────────────────────────────────────────────────────────┐
│                  Input Surfaces (Adapters)                   │
├──────────────────┬──────────────────┬───────────────────────┤
│    clap CLI      │   axum HTTP API  │   Next.js Frontend    │
│ `interfaces/cli/`│ `interfaces/api/`│   `frontend/src/`     │
└────────┬─────────┴────────┬─────────┴──────────┬────────────┘
         │                  │                     │
         │                  │       fetch /todo-engine/* proxied
         │                  │       to API (next.config.mjs)
         ▼                  ▼                     │
┌─────────────────────────────────────────────────────────────┐
│                  Application Layer (Policy)                   │
│        TodoService  `application/service/`                    │
│   validation + status state machine + mandatory audit event  │
│   repository ports  `application/ports.rs`                   │
└─────────────────────────────┬───────────────────────────────┘
                              │ TodoStore / TodoRepository / EventRepository
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              Infrastructure (rusqlite adapter)               │
│  SqliteTodoRepository  `infrastructure/sqlite/`             │
│  data-home + clock + tracing  `paths.rs` / `system.rs`      │
└─────────────────────────────┬───────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────┐
│   SQLite source of truth — `todo.sqlite` (items + events)   │
└─────────────────────────────────────────────────────────────┘

           Domain (pure, no I/O) `domain/` is used by all layers above.
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| Domain model | Item types, `Actor`, `TodoItem`, `TodoEvent` | `todo-engine/src/domain/model.rs` |
| Status machine | `ItemStatus`, `terminal_status`, `hidden_by_default_status` | `todo-engine/src/domain/status.rs` |
| Recurrence | `occurrences` parser, `RecurrenceError` | `todo-engine/src/domain/recurrence.rs` |
| TodoService | Policy + state machine, mandatory audit events | `todo-engine/src/application/service/` |
| Repository ports | `TodoRepository`/`EventRepository`/`TodoStore`, `ListFilter` | `todo-engine/src/application/ports.rs` |
| Error type | `TodoError` + exit/HTTP status mapping | `todo-engine/src/application/error.rs` |
| SQLite repo | `SqliteTodoRepository`, schema DDL, row mapping | `todo-engine/src/infrastructure/sqlite/` |
| Data home / clock / logs | Path resolution, tracing, log rotation | `todo-engine/src/infrastructure/{paths,system}.rs` |
| CLI adapter | `clap` parsing, dispatch, Markdown/JSON output | `todo-engine/src/interfaces/cli/` |
| API adapter | `axum` router, handlers, DTOs, error boundary | `todo-engine/src/interfaces/api/` |
| Frontend workbench | Next.js UI reading the API via proxy | `frontend/src/` |

## Pattern Overview

**Overall:** Clean / hexagonal (ports-and-adapters) architecture in the Rust crate, with a separate feature-sliced Next.js frontend.

**Key Characteristics:**
- Dependencies point **inward**: `interfaces` and `infrastructure` depend on `application` and `domain`; never the reverse. `domain` does no I/O.
- A single `TodoService` is the only mutation path — CLI and API are thin adapters that both construct a service over the same `todo.sqlite`.
- Every mutation writes a `TodoEvent` audit row in the same call (`store_item_and_event`); there is no skip path.
- Ports (`TodoRepository`/`EventRepository`/`TodoStore`) decouple the service from storage; the service also has an `InMemory` store variant for tests.
- The frontend mirrors the layering style: pure `domain/` navigation logic, `features/` React, and a `design/` token/copy/layout system.

## Layers

**Domain (`todo-engine/src/domain/`):**
- Purpose: Pure business types and rules.
- Contains: `model.rs`, `status.rs`, `recurrence.rs`.
- Depends on: nothing crate-internal, no I/O crates.
- Used by: every other layer.

**Application (`todo-engine/src/application/`):**
- Purpose: Policy, status state machine, repository ports, error type.
- Location: `service/{mod,creation,transitions,update,materialization,queries}.rs`, `ports.rs`, `error.rs`.
- Depends on: `domain`.
- Used by: `interfaces`, indirectly via ports `infrastructure`.

**Infrastructure (`todo-engine/src/infrastructure/`):**
- Purpose: `rusqlite` repository, schema, data-home resolution, clock, tracing.
- Location: `sqlite/{mod,schema,mapping,repo}.rs`, `paths.rs`, `system.rs`.
- Depends on: `domain`, `application` (implements its port traits).
- Used by: `interfaces` (constructs the repo and injects it into the service).

**Interfaces (`todo-engine/src/interfaces/`):**
- Purpose: Thin CLI and HTTP adapters.
- Location: `cli/{mod,create,lifecycle,views,markdown,output}.rs`, `api/{mod,handlers,dto}.rs`.
- Depends on: `application`, `infrastructure`, `domain`.
- Used by: `main.rs` (CLI), the `api` subcommand (HTTP server).

**Frontend (`frontend/src/`):**
- Purpose: Next.js (App Router) workbench UI; separate package, not a Cargo member.
- Layering: `domain/workbench/` (pure navigation logic), `features/workbench/{ui,hooks,model}/`, `design/` (tokens/copy/layout), `app/` (route shell).
- Talks to the API via the `/todo-engine/*` rewrite proxy (`frontend/next.config.mjs`) to `http://127.0.0.1:3002`.

## Data Flow

### Primary Mutation Path

1. Adapter receives input — CLI subcommand (`interfaces/cli/mod.rs:run`) or HTTP handler (`interfaces/api/handlers.rs`).
2. Adapter builds a `TodoService` over a SQLite connection (`interfaces/api/mod.rs:service`, `interfaces/cli/mod.rs`).
3. Service runs validation + state-machine checks in the relevant `service/` submodule (e.g. `transitions.rs`, `creation.rs`).
4. `store_item_and_event` (`application/service/mod.rs:110`) persists item + audit event atomically via `TodoStore::save_item_and_event`.
5. `SqliteTodoRepository` writes both rows (`infrastructure/sqlite/repo.rs`); response rendered as Markdown/JSON (CLI) or JSON (API).

### Read / Query Path

1. Adapter calls `list_items`/`get`/`archive_items` (`application/service/queries.rs`).
2. Repository loads rows; `apply_list_filter` (`application/ports.rs:29`) applies status/type/relation/query filters and the hidden-by-default rule.
3. Results returned to the adapter for rendering.

### Frontend Read Path

1. `useWorkbenchController` (`frontend/src/features/workbench/hooks/useWorkbenchController.ts`) issues `fetch("/todo-engine/items?type=...")`.
2. Next.js rewrite proxies to the running API; results stored in component state.

**State Management:**
- Backend: stateless adapters; SQLite is the only canonical state. In tests, `TodoService::in_memory` uses a `HashMap` and deterministic IDs/clock.
- Frontend: local React state via `useState`/`useMemo` in the workbench controller; no global store.

## Key Abstractions

**TodoService:**
- Purpose: The single policy gateway for all mutations and queries.
- Examples: `application/service/mod.rs`, split submodules under `service/`.
- Pattern: Facade over storage with an `InMemory`/`Persistent` `ServiceStore` enum.

**Repository ports:**
- Purpose: Decouple the service from storage.
- Examples: `TodoRepository`, `EventRepository`, `TodoStore` in `application/ports.rs`.
- Pattern: Trait objects (`Box<dyn TodoStore>`) injected via `TodoService::persistent`.

**TodoItem / TodoEvent:**
- Purpose: The unified item graph and the audit record.
- Examples: `domain/model.rs`.
- Pattern: Serde-serializable structs; events carry `before`/`after` JSON snapshots.

## Entry Points

**CLI binary (`todo-engine/src/main.rs`):**
- Triggers: shell invocation.
- Responsibilities: calls `interfaces::cli::run()`, maps `TodoError` to an exit code.

**CLI dispatch (`todo-engine/src/interfaces/cli/mod.rs`):**
- Triggers: each subcommand (`init`, `health`, `api`, `list`, item-type and lifecycle commands).
- Responsibilities: parse args, build service, route to handler.

**HTTP router (`todo-engine/src/interfaces/api/mod.rs:router`):**
- Triggers: `todo-engine api` subcommand; serves on port 3002.
- Responsibilities: maps 18 routes to handlers, owns the `ApiError` -> status boundary.

**Frontend route (`frontend/src/app/page.tsx` + `layout.tsx`):**
- Triggers: browser load.
- Responsibilities: render the workbench client shell.

## Architectural Constraints

- **Threading:** CLI is single-shot; the API constructs a fresh connection/service per request (`api/mod.rs:service`). In-memory `:memory:` API mode keeps a shared-cache connection alive via an `Arc<Mutex<Connection>>` keeper.
- **Global state:** None at module scope; SQLite holds all canonical state. Deterministic counters live inside `TodoService` for the in-memory test mode only.
- **Dependency rule (enforced):** `tests/unit/architecture.rs` scans `domain/` for forbidden references to `application`/`infrastructure`/`interfaces`/`rusqlite`/`axum` and fails the build on violation.
- **Frontend design boundary (enforced):** `frontend/tests/architecture/design-boundaries.spec.ts` forbids raw hex colors in `src/features`, keeping color in `design/tokens.ts`.
- **Schema additivity:** `init_schema()` only creates tables and backfills missing columns; it never drops or rewrites existing columns.

## Anti-Patterns

### Bypassing TodoService with direct repository writes

**What happens:** Calling `SqliteTodoRepository::save_item` directly from an adapter.
**Why it's wrong:** Skips validation, the status state machine, and the mandatory audit event — breaking the core invariant.
**Do this instead:** Route every mutation through `TodoService` (`application/service/`), which calls `store_item_and_event`.

### Widening visibility to `pub` to make a split module compile

**What happens:** Marking a cross-sibling helper `pub` so a split file can see it.
**Why it's wrong:** Leaks internals into the public `todo_engine::…` surface.
**Do this instead:** Use `pub(super)` (see `application/service/mod.rs` fields/helpers); reserve `pub` for genuine public API.

### Adding outward dependencies to the domain

**What happens:** Importing `rusqlite`, `axum`, or another layer inside `domain/`.
**Why it's wrong:** Violates the inward-dependency rule and turns the build red via `tests/unit/architecture.rs`.
**Do this instead:** Keep `domain/` pure; place I/O in `infrastructure/`.

## Error Handling

**Strategy:** Single `TodoError` enum (`application/error.rs`) with categorized variants mapped to CLI exit codes and HTTP status.

**Patterns:**
- Policy/validation -> CLI exit `2` / HTTP `400`; not-found -> CLI `4` / HTTP `404`; storage/internal -> CLI `1` / HTTP `500`.
- API wraps errors in `ApiError(anyhow::Error)` and downcasts to `TodoError` in `IntoResponse` (`api/mod.rs:136`).
- CLI maps via `TodoError::cli_exit_code_from_error` in `main.rs`.

## Cross-Cutting Concerns

**Logging:** `tracing` with console + rotating JSONL file sink, configured in `infrastructure/system.rs` (env-driven levels and rotation).
**Validation:** Centralized in `TodoService` (relation checks via `ensure_relation`, area resolution via `find_area`).
**Authentication:** None at the engine layer (local-first); the approval gate is the policy boundary, not auth.

---

*Architecture analysis: 2026-06-22*
