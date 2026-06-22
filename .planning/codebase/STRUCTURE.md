# Codebase Structure

**Analysis Date:** 2026-06-22

## Directory Layout

```
oracle-todo/
├── Cargo.toml                  # Workspace root (members = ["todo-engine"])
├── README.md                   # Canonical data model, item types, lifecycle
├── CLAUDE.md                   # Agent operating guide
├── todo-engine/                # Rust crate (binary/lib todo-engine/todo_engine)
│   ├── Cargo.toml
│   ├── src/
│   │   ├── lib.rs              # Crate wiring (4 layer modules)
│   │   ├── main.rs            # Binary entrypoint (CLI)
│   │   ├── domain/            # Pure logic, no I/O
│   │   ├── application/       # TodoService policy + ports + error
│   │   ├── infrastructure/    # rusqlite repo, paths, system/logging
│   │   └── interfaces/        # clap CLI + axum API adapters
│   └── tests/                 # unit / integration / e2e test binaries
├── frontend/                   # Next.js workbench (separate package, not a Cargo member)
│   ├── package.json
│   ├── next.config.mjs        # /todo-engine/* proxy to API :3002
│   ├── vitest.config.ts
│   ├── src/                   # app / domain / features / design / styles
│   └── tests/                 # architecture / domain / presentation
└── docs/                       # architecture / conventions / operations / decisions
```

## Directory Purposes

**`todo-engine/src/domain/`:**
- Purpose: Pure business types and rules; no I/O.
- Contains: `model.rs`, `status.rs`, `recurrence.rs`, `mod.rs`.

**`todo-engine/src/application/`:**
- Purpose: Policy, state machine, repository ports, error type.
- Key files: `service/{mod,creation,transitions,update,materialization,queries}.rs`, `ports.rs`, `error.rs`.

**`todo-engine/src/infrastructure/`:**
- Purpose: Storage and system concerns.
- Key files: `sqlite/{mod,schema,mapping,repo}.rs`, `paths.rs`, `system.rs`.

**`todo-engine/src/interfaces/`:**
- Purpose: Thin CLI and HTTP adapters over `TodoService`.
- Key files: `cli/{mod,create,lifecycle,views,markdown,output}.rs`, `api/{mod,handlers,dto}.rs`.

**`todo-engine/tests/`:**
- Purpose: Three test binaries — `unit`, `integration`, `e2e` — plus shared `support/`.
- Key files: `unit/architecture.rs` (dependency-rule guard), `e2e/{cli,api}.rs`.

**`frontend/src/`:**
- Purpose: Next.js App Router UI mirroring clean layering.
- `app/` route shell; `domain/workbench/` pure navigation logic; `features/workbench/{ui,hooks,model}/`; `design/` (tokens/copy/layout); `styles/` global CSS.

**`docs/`:**
- Purpose: Architecture, conventions, operations, and ADRs.
- Key files: `architecture/overview.md`, `architecture/layers.md`, `architecture/decisions/`.

## Key File Locations

**Entry Points:**
- `todo-engine/src/main.rs`: CLI binary.
- `todo-engine/src/interfaces/cli/mod.rs`: subcommand dispatch (`run`).
- `todo-engine/src/interfaces/api/mod.rs`: HTTP `router` (port 3002).
- `frontend/src/app/page.tsx`: frontend route.

**Configuration:**
- `Cargo.toml` (workspace), `todo-engine/Cargo.toml` (crate deps).
- `frontend/package.json`, `frontend/next.config.mjs`, `frontend/vitest.config.ts`.
- Data home resolved at runtime in `todo-engine/src/infrastructure/paths.rs` (`TODO_ENGINE_HOME` / `--home` / `~/.todo-engine/`).

**Core Logic:**
- `todo-engine/src/application/service/mod.rs`: `TodoService`, shared helpers.
- `todo-engine/src/application/ports.rs`: repository traits, `ListFilter`.
- `todo-engine/src/infrastructure/sqlite/repo.rs`: persistence impl.

**Testing:**
- `todo-engine/tests/{unit,integration,e2e}/`, `todo-engine/tests/support/mod.rs`.
- `frontend/tests/{architecture,domain,presentation}/`.

## Naming Conventions

**Files:**
- Rust: snake_case modules; each oversized file becomes a directory module with focused submodules and a `mod.rs`.
- Frontend: PascalCase for React components (`MainPanel.tsx`); camelCase/kebab for logic (`useWorkbenchController.ts`, `workbench-model.ts`).

**Directories:**
- Rust layers named by clean-architecture role: `domain`, `application`, `infrastructure`, `interfaces`.
- Frontend uses feature slices: `features/workbench/{ui,hooks,model}`.

## Where to Add New Code

**New service behavior / policy:**
- Add to the matching submodule under `todo-engine/src/application/service/` (`creation`, `transitions`, `update`, `materialization`, `queries`); shared helpers go in `service/mod.rs` as `pub(super)`.

**New CLI command:**
- Define args in `interfaces/cli/mod.rs`, implement the handler in `cli/{create,lifecycle,views}.rs`.

**New HTTP endpoint:**
- Add a route in `interfaces/api/mod.rs:router`, the handler in `api/handlers.rs`, request/query structs in `api/dto.rs`.

**New storage column / schema change:**
- Extend additively in `infrastructure/sqlite/schema.rs`; update row mapping in `sqlite/mapping.rs`. Never drop or rewrite existing columns.

**New domain type / rule:**
- Add to `domain/model.rs`, `status.rs`, or `recurrence.rs`; keep it I/O-free (guarded by `tests/unit/architecture.rs`).

**New frontend feature:**
- Pure logic in `frontend/src/domain/`; React under `frontend/src/features/workbench/{ui,hooks,model}/`; colors/copy via `frontend/src/design/` (no raw hex in `features`).

**Tests:**
- Rust: `todo-engine/tests/unit` for pure logic, `integration` for repo/service, `e2e/{cli,api}.rs` for surface agreement.
- Frontend: `frontend/tests/{architecture,domain,presentation}/`.

## Special Directories

**`target/`:**
- Purpose: Cargo build artifacts. Generated: Yes. Committed: No.

**`frontend/public/`:**
- Purpose: Static assets served by Next.js. Generated: No. Committed: Yes.

**`.claude/plugins/` and `.codex/skills/`:**
- Purpose: Project-owned skills; `.claude/plugins/` is source of truth, `.codex/skills/` is the Codex runtime mirror. Committed: Yes.

**`~/.todo-engine/` (runtime, outside repo):**
- Purpose: Live data home — `todo.sqlite` and rotating `logs/`. `*.sqlite` is gitignored.

---

*Structure analysis: 2026-06-22*
