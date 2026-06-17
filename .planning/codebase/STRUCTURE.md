# Codebase Structure

**Analysis Date:** 2026-06-17

## Directory Layout

```
oracle-todo/                              # Workspace root (monorepo)
├── todo-engine/                          # Main Rust crate (binary + lib)
│   ├── Cargo.toml
│   ├── src/                              # Source tree
│   │   ├── lib.rs                        # Public API re-exports
│   │   ├── main.rs                       # Binary entrypoint
│   │   │
│   │   ├── domain/                       # Pure value types & logic (no I/O)
│   │   │   ├── mod.rs                    # Re-exports
│   │   │   ├── model.rs                  # ItemType, Actor, TodoItem, TodoEvent
│   │   │   ├── status.rs                 # ItemStatus enum, state helpers
│   │   │   └── recurrence.rs             # Recurrence rule parser, occurrences()
│   │   │
│   │   ├── application/                  # Policy layer
│   │   │   ├── mod.rs                    # Module structure
│   │   │   ├── error.rs                  # TodoError, TodoResult type
│   │   │   ├── ports.rs                  # TodoRepository, EventRepository, TodoStore traits, ListFilter
│   │   │   └── service/                  # TodoService (split by concern)
│   │   │       ├── mod.rs                # TodoService struct, constructors, shared helpers
│   │   │       ├── creation.rs           # ProposeArea, ProposeTask, ProposeProject, ProposeRoutine, ProposeEvent + methods
│   │   │       ├── transitions.rs        # approve(), activate(), pause(), resume(), complete(), archive(), drop(), cancel()
│   │   │       ├── update.rs             # UpdateItem, update_item()
│   │   │       ├── queries.rs            # get(), list_items(), archive_items()
│   │   │       └── materialization.rs    # materialize_routines(), generated-task helpers
│   │   │
│   │   ├── infrastructure/               # I/O & system integration
│   │   │   ├── mod.rs                    # Module structure
│   │   │   ├── paths.rs                  # todo_home(), db_path() — data-home resolution
│   │   │   ├── system.rs                 # init_tracing(), RotatingJsonlMakeWriter, local_today_string()
│   │   │   └── sqlite/                   # SQLite implementation
│   │   │       ├── mod.rs                # connect(), SqliteTodoRepository struct, re-exports
│   │   │       ├── schema.rs             # init_schema(), user_version(), column backfill
│   │   │       ├── mapping.rs            # row_to_item(), item_to_params(), row_to_event(), conversions
│   │   │       ├── repo.rs               # SqliteTodoRepository impls TodoStore, upsert SQL
│   │   │       └── migrate_legacy.rs     # migrate_legacy_storage(), LegacyMigrationReport — Python-era normalization
│   │   │
│   │   └── interfaces/                   # External surfaces (CLI & API)
│   │       ├── mod.rs                    # Module structure
│   │       ├── cli/                      # clap CLI
│   │       │   ├── mod.rs                # Cli parser, Command routing, run(), system handlers (init, health, migrate-legacy-db)
│   │       │   ├── create.rs             # area_create(), project_propose(), task_propose(), routine_propose(), event_propose()
│   │       │   ├── lifecycle.rs          # approve(), activate(), pause(), resume(), complete(), archive(), drop_item(), cancel(), update()
│   │       │   ├── views.rs              # list(), archive_list(), pending(), today(), routine_materialize() — renderers
│   │       │   ├── markdown.rs           # Markdown table renderer (render_items_table(), etc.)
│   │       │   └── output.rs             # print_json() helper
│   │       └── api/                      # axum HTTP API
│   │           ├── mod.rs                # router(), ApiState, ApiError, helpers (service(), with_service(), non_empty())
│   │           ├── handlers.rs           # 18 endpoint handlers (create_area, propose_task, list_items, approve_item, etc.)
│   │           └── dto.rs                # Request/response wire structs (CreateAreaRequest, ProposeTaskRequest, etc.)
│   │
│   └── tests/                            # Test binaries
│       ├── unit/                         # Unit tests (in-memory service)
│       │   ├── lib.rs
│       │   ├── architecture.rs           # Dependency rule enforcement (no outward domain imports)
│       │   ├── domain/                   # Domain type & logic tests
│       │   ├── service/                  # TodoService state machine tests
│       │   └── ...
│       ├── integration/                  # Integration tests (SQLite + service)
│       │   ├── lib.rs
│       │   ├── fixtures/                 # Test helper functions
│       │   └── ...
│       └── e2e/                          # End-to-end tests (CLI & API)
│           ├── lib.rs
│           ├── cli.rs                    # CLI command tests (spawns subprocess)
│           ├── api.rs                    # HTTP API tests (starts axum server)
│           └── ...
│
├── frontend/                             # Reserved future UI package
│
├── docs/                                 # Architecture & operations documentation
│   ├── architecture/
│   │   ├── overview.md                   # System overview & core principles
│   │   ├── layers.md                     # Clean/hexagonal layer breakdown, pub(super) convention
│   │   ├── data-model.md                 # Item types, ItemStatus lifecycle, events contract
│   │   └── decisions/                    # Architecture Decision Records (ADRs)
│   │       ├── adr-0001-sqlite-source-of-truth.md
│   │       ├── adr-0002-service-layer-policy.md
│   │       ├── adr-0003-approval-gating.md
│   │       └── ...
│   ├── operations/
│   │   ├── cli-reference.md              # Full CLI surface & subcommands
│   │   ├── api-reference.md              # Full API surface & endpoints
│   │   ├── verification-and-smoke.md     # Smoke tests & guardrails
│   │   └── data-home.md                  # Data directory safety & backup
│   └── conventions/
│       ├── code-style.md                 # File size, visibility, import rules
│       └── testing.md                    # Test structure, fixtures, patterns
│
├── .planning/codebase/                   # GSD codebase mapping (this document)
│   ├── ARCHITECTURE.md
│   └── STRUCTURE.md
│
├── .claude/plugins/                      # Project-owned Claude skills
│   ├── docs-tools/                       # Documentation maintenance
│   ├── code-audits/                      # Code quality checks
│   └── code-cleanup/                     # Dead code removal
│
├── .codex/skills/                        # Codex runtime copy (mirrors .claude/plugins/)
│   └── ...
│
├── .codex/hooks.json                     # Codex session initialization hooks
│
├── README.md                             # Project README (data model, quick start, setup)
├── Cargo.toml                            # Workspace root
├── Cargo.lock
└── .gitignore
```

## Directory Purposes

**`todo-engine/src/domain/`:**
- Purpose: Pure data types and value logic — no I/O, no framework dependencies
- Contains: Enums (`ItemType`, `Actor`, `ItemStatus`), structs (`TodoItem`, `TodoEvent`), pure functions (status helpers, recurrence parsing)
- Key files: `model.rs` (types), `status.rs` (state machine), `recurrence.rs` (date parsing)

**`todo-engine/src/application/`:**
- Purpose: Business logic, policy enforcement, service orchestration
- Contains: `TodoService` (split into submodules by concern), repository port traits, error type, filter types
- Key files: `service/mod.rs` (service struct + helpers), `service/transitions.rs` (state machine), `service/creation.rs` (proposal logic), `ports.rs` (repository abstraction)

**`todo-engine/src/infrastructure/`:**
- Purpose: I/O, storage, system integration — concrete implementations
- Contains: SQLite repository, schema management, path resolution, structured logging, legacy migration
- Key files: `sqlite/repo.rs` (repository impl), `sqlite/schema.rs` (schema DDL), `paths.rs` (data-home resolution), `system.rs` (tracing setup)

**`todo-engine/src/interfaces/cli/`:**
- Purpose: Command-line interface — user input adapter and output formatter
- Contains: clap command parsing, subcommand dispatch, Markdown rendering, lifecycle handlers
- Key files: `mod.rs` (clap Cli struct, run dispatch), `create.rs` (proposal handlers), `lifecycle.rs` (transition handlers), `views.rs` (list/archive/today renderers)

**`todo-engine/src/interfaces/api/`:**
- Purpose: HTTP API — REST interface and JSON marshaling
- Contains: axum router, 18 endpoint handlers, DTOs, error response mapping
- Key files: `mod.rs` (router, ApiState, helpers), `handlers.rs` (endpoint implementations), `dto.rs` (request/response types)

**`todo-engine/tests/`:**
- Purpose: Test binaries — three layers (unit, integration, e2e)
- Unit: In-memory service tests, domain logic, architecture enforcement
- Integration: SQLite repository + service together
- E2E: CLI subprocess tests, HTTP API tests

**`docs/architecture/`:**
- Purpose: Architecture documentation — design decisions, layer breakdown, data model
- Key files: `overview.md` (principles), `layers.md` (dependency rule, pub(super)), `decisions/` (ADRs)

**`docs/operations/`:**
- Purpose: Operational documentation — CLI/API reference, smoke tests, data safety
- Key files: `cli-reference.md` (all commands), `api-reference.md` (all endpoints), `verification-and-smoke.md` (guardrails)

## Key File Locations

**Entry Points:**
- CLI: `todo-engine/src/main.rs` — binary entrypoint, calls `interfaces::cli::run()`
- API: `todo-engine/src/interfaces/api/mod.rs:router()` — creates axum Router with 18 routes
- Library: `todo-engine/src/lib.rs` — re-exports public API (`application`, `domain`, `infrastructure`, `interfaces`)

**Configuration:**
- Cargo workspace: `Cargo.toml` (root)
- Data home: Resolved by `infrastructure/paths.rs:todo_home()` from `TODO_ENGINE_HOME` env var, `--home` CLI flag, or default `~/.hermes/oracle-todo/`
- Logging config: Environment variables `TODO_ENGINE_CONSOLE_LOG`, `TODO_ENGINE_FILE_LOG`, `TODO_ENGINE_LOG_MAX_BYTES`, `TODO_ENGINE_LOG_MAX_FILES`

**Core Logic:**
- Service policy: `todo-engine/src/application/service/` (creation, transitions, updates, queries, materialization)
- State machine: `todo-engine/src/domain/status.rs` (ItemStatus enum, terminal_status, hidden_by_default_status)
- Error handling: `todo-engine/src/application/error.rs` (TodoError with CLI/HTTP mapping)
- Repository: `todo-engine/src/infrastructure/sqlite/repo.rs` (SqliteTodoRepository implements TodoStore)

**Testing:**
- Unit tests: `todo-engine/tests/unit/` — in-memory service, domain logic, architecture enforcement
- Integration tests: `todo-engine/tests/integration/` — SQLite + service together
- E2E tests: `todo-engine/tests/e2e/` — CLI subprocess, HTTP API

## Naming Conventions

**Files:**
- Layer modules: `mod.rs` per directory (re-exports and common helpers)
- Concerns: Grouped by responsibility (e.g., `service/creation.rs` for proposal logic, `service/transitions.rs` for state changes)
- Tests: `*.rs` alongside source in `tests/{unit,integration,e2e}/` directories
- Pattern: Snake_case (`mod.rs`, `error.rs`, `create.rs`)

**Functions:**
- Service methods: Verb + noun (e.g., `propose_task`, `approve`, `complete_item`)
- Handler functions: Verb + resource (e.g., `create_area`, `list_items`, `approve_item`)
- Query functions: Verb (e.g., `get`, `list_items`, `archive_items`)
- Helpers: Descriptive (e.g., `parse_day`, `format_time`, `next_id`)

**Variables:**
- Item fields: Lowercase snake_case (`item_id`, `area_id`, `proposed_by`, `approved_at`)
- Result variables: Standard Rust (e.g., `item`, `result`, `items`)
- Error handling: `error`, `err` for error variables

**Types:**
- Structs: PascalCase (`TodoService`, `TodoItem`, `CreateArea`, `SqliteTodoRepository`)
- Enums: PascalCase (`ItemType`, `ItemStatus`, `Actor`, `TodoError`)
- Traits: PascalCase (`TodoStore`, `TodoRepository`, `EventRepository`)
- Type aliases: snake_case lowercase (`TodoResult`)

## Where to Add New Code

**New Feature:**
- Primary code: `todo-engine/src/application/service/` — add new method to `TodoService` (or new submodule if large)
- CLI handler: `todo-engine/src/interfaces/cli/` — add handler function in appropriate submodule (create.rs, lifecycle.rs, or views.rs)
- API handler: `todo-engine/src/interfaces/api/handlers.rs` — add endpoint function
- DTO: `todo-engine/src/interfaces/api/dto.rs` — add request/response struct if needed
- Tests: `todo-engine/tests/{unit,integration,e2e}/` — test the service method, CLI handler, and API endpoint

**New Item Type (e.g., adding "Goal" to existing Area/Project/Task/Routine/Event):**
- Domain: Add variant to `ItemType` enum in `todo-engine/src/domain/model.rs`
- Service: Add `ProposeGoal` struct and `propose_goal()` method in `todo-engine/src/application/service/creation.rs`
- Validation: Update state machine rules in `todo-engine/src/application/service/transitions.rs` if needed
- CLI: Add `GoalCommand` enum and `goal_propose()` handler in `todo-engine/src/interfaces/cli/create.rs`
- API: Add `/goals/propose` endpoint in `todo-engine/src/interfaces/api/handlers.rs`
- Schema: Update SQLite schema in `todo-engine/src/infrastructure/sqlite/schema.rs` if adding columns

**New Validation Rule:**
- Service: Add check to appropriate `TodoService` method in `todo-engine/src/application/service/` (before `store_item_and_event()`)
- Return `TodoError::Policy(...)` if rule violated

**New Query/Filter:**
- Service: Extend `ListFilter` in `todo-engine/src/application/ports.rs` with new field
- Repository: Update `apply_list_filter()` in `todo-engine/src/application/ports.rs` with new filter logic
- SQLite: Update `list_items()` SQL in `todo-engine/src/infrastructure/sqlite/repo.rs` to support new filter

**Utilities:**
- Shared helpers (CLI): `todo-engine/src/interfaces/cli/output.rs` or `markdown.rs`
- Shared helpers (API): `todo-engine/src/interfaces/api/mod.rs` (ApiResult, helpers)
- Shared helpers (Infrastructure): `todo-engine/src/infrastructure/system.rs` or `paths.rs`
- Date/time: `todo-engine/src/infrastructure/system.rs:local_today_string()`, `local_date_string_at()`

## Special Directories

**`todo-engine/src/application/service/`:**
- Purpose: Split large `TodoService` implementation by concern
- Generated: No
- Committed: Yes
- Pattern: Each file contains related methods; `mod.rs` keeps struct definition and shared helpers

**`todo-engine/src/infrastructure/sqlite/`:**
- Purpose: Encapsulate all SQLite-specific logic
- Generated: Schema evolution only (new columns added by `init_schema()`)
- Committed: Yes
- Pattern: Trait impls in `repo.rs`, SQL/schema in `schema.rs`, row mapping in `mapping.rs`

**`todo-engine/src/interfaces/`:**
- Purpose: Separate CLI and API adapters
- Generated: No
- Committed: Yes
- Pattern: Each interface (cli, api) is a directory module; handlers and helpers use `pub(super)` visibility

**`.planning/codebase/`:**
- Purpose: GSD codebase mapping documents
- Generated: By `/gsd-map-codebase` command
- Committed: Yes
- Pattern: ARCHITECTURE.md, STRUCTURE.md, CONVENTIONS.md, TESTING.md, STACK.md, INTEGRATIONS.md, CONCERNS.md (as generated)

**`docs/architecture/decisions/`:**
- Purpose: Architecture Decision Records (ADRs) — rationale for locked policies
- Generated: No (manual, as decisions are made)
- Committed: Yes
- Pattern: `adr-NNNN-slug-title.md` format

---

*Structure analysis: 2026-06-17*
