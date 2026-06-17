# Monorepo Restructure + `todo-engine` Rename — Design

**Date:** 2026-06-17
**Status:** Approved for planning
**Scope:** Restructure + rename only — move the existing Rust crate into a monorepo layout, rename it from `oracle-todo` to `todo-engine`, and reserve a `frontend/` slot. No frontend application is built in this effort; its stack is decided later.

## Goal

Convert the single-crate `oracle-todo` repository into a **single-git-repo monorepo** (Cargo workspace) so that the Rust engine and a future web frontend live side by side as sibling packages, and rename the Rust package from `oracle-todo` to `todo-engine`. Git history is preserved; runtime data location is deliberately left unchanged.

This is one git repo with multiple packages — **not** a split into separate repositories. The repository / monorepo root keeps the name `oracle-todo` (the product); only the Rust *package* becomes `todo-engine`.

## Chosen Layout (Approach A — flat)

```
oracle-todo/                ← git repo root (name unchanged), Cargo workspace root
  Cargo.toml                [workspace], members = ["todo-engine"]
  Cargo.lock                workspace lock (moves to root)
  todo-engine/              the existing Rust engine, moved + renamed
    Cargo.toml              [package] name = "todo-engine"
    src/
    tests/
  frontend/                 placeholder for the future web UI
    README.md               "stack TBD" note only
  docs/                     shared docs, stay at root
  README.md  CLAUDE.md  AGENTS.md   shared, stay at root
```

Rejected alternatives:
- **B (`apps/` + `crates/` grouping):** cleaner if many packages appear later, but deeper paths and more churn than warranted now.
- **C (split the Rust crate into multiple internal crates):** YAGNI for a structure-only change.

## What Moves

| From | To | Method |
| --- | --- | --- |
| `src/` | `todo-engine/src/` | `git mv` (preserve history) |
| `tests/` | `todo-engine/tests/` | `git mv` |
| `Cargo.toml` | `todo-engine/Cargo.toml` | `git mv`, then edit `name` |
| `Cargo.lock` | stays at root | becomes the workspace lock |

New file: root `Cargo.toml` declaring the workspace.

Stays at root (shared, not moved): `docs/`, `README.md`, `CLAUDE.md`, `AGENTS.md`, `.gitignore`, `.claude/`, `.codex/`.

## Root Workspace Manifest

New root `Cargo.toml`:

```toml
[workspace]
members = ["todo-engine"]
resolver = "3"
```

Member `todo-engine/Cargo.toml` keeps every dependency, just changes the package name:

```toml
[package]
name = "todo-engine"
# version, edition, description, deps unchanged
```

Because the crate uses default bin/lib targets (no explicit `[[bin]]`/`[lib]`), renaming the package automatically renames **both** the library crate (`oracle_todo` → `todo_engine`) and the binary (`oracle-todo` → `todo-engine`). No `[[bin]]` stanza is needed.

## Identifier Rename — `oracle-todo` → `todo-engine`

The string `oracle-todo` appears in two distinct roles. Rename the **brand/package** role; keep the **data-home path** role so the live SQLite DB at `~/.hermes/oracle-todo/` is not orphaned.

### RENAME (code)

| Location | Current | New |
| --- | --- | --- |
| `Cargo.toml` | `name = "oracle-todo"` | `name = "todo-engine"` |
| `src/main.rs:1,4` | `oracle_todo::…` | `todo_engine::…` |
| `src/infrastructure/paths.rs:9` | env `ORACLE_TODO_HOME` | `TODO_ENGINE_HOME` |
| `src/infrastructure/system.rs:15,16` | env `ORACLE_TODO_CONSOLE_LOG`, `ORACLE_TODO_FILE_LOG` | `TODO_ENGINE_CONSOLE_LOG`, `TODO_ENGINE_FILE_LOG` |
| `src/infrastructure/system.rs:229,237` | env `ORACLE_TODO_LOG_MAX_BYTES`, `ORACLE_TODO_LOG_MAX_FILES` | `TODO_ENGINE_LOG_MAX_BYTES`, `TODO_ENGINE_LOG_MAX_FILES` |
| `src/infrastructure/system.rs:171,222` | tracing target `oracle_todo::infrastructure::system` | `todo_engine::infrastructure::system` |
| `src/interfaces/cli/mod.rs:24` | `#[command(name = "oracle-todo")]` | `#[command(name = "todo-engine")]` |
| `src/interfaces/cli/mod.rs:28` | `env = "ORACLE_TODO_HOME"` | `env = "TODO_ENGINE_HOME"` |
| `src/infrastructure/system.rs:18,187,260,270` | log filename `oracle-todo.log.jsonl` | `todo-engine.log.jsonl` |
| `src/interfaces/api/mod.rs:73` | in-memory db `oracle_todo_api_` | `todo_engine_api_` |

### KEEP (data-home path — do NOT change)

| Location | Value | Reason |
| --- | --- | --- |
| `src/infrastructure/paths.rs:13` | `.hermes/oracle-todo` | live DB location; renaming orphans existing data |
| `src/interfaces/cli/mod.rs:27` (doc comment path part) | `~/.hermes/oracle-todo` | same; update only the env-var name in this comment |

## Frontend Placeholder

- Create `frontend/README.md` with a single line stating the stack is undecided and will be chosen in a later effort.
- Do **not** create a root `package.json` or any JS tooling yet (YAGNI until the frontend stack is chosen).

## Docs Sync

16 current-state Markdown files reference `oracle-todo` / `ORACLE_TODO` / `src/` paths. After move + rename:

- Path refs `src/…` → `todo-engine/src/…`.
- Env-var refs `ORACLE_TODO_*` → `TODO_ENGINE_*`.
- Binary / command refs `oracle-todo …` → `todo-engine …`; `cargo run -p oracle-todo` → `cargo run -p todo-engine`.
- Crate/module refs `oracle_todo::…` → `todo_engine::…`.
- Log-filename refs `oracle-todo.log.jsonl` → `todo-engine.log.jsonl` (`logging-and-rotation.md`, `logging.md`).
- **Keep** the data-home path `~/.hermes/oracle-todo/` everywhere it appears (`data-home.md`, `setup.md`).
- This is a careful split, not a blind find-replace: the same file often contains both a renamed env var and a kept data-home path.
- Run the `docs-tools` skill to keep documentation in sync.

Historical artifacts under `docs/superpowers/plans/` and the prior `docs/superpowers/specs/2026-06-16-*` files describe past states and are left as-is. Only current-state docs are updated.

## Out of Scope

- Building or scaffolding the frontend application; choosing its framework; wiring it to the HTTP API.
- Splitting the Rust crate into multiple crates.
- Changing the runtime data home (`~/.hermes/oracle-todo/`), schema, or the service layer.
- Renaming the git repository / monorepo root directory.

## Success Criteria (Verification)

Run from the repo root after the restructure + rename:

1. `cargo build` — passes.
2. `cargo test` — existing `unit`, `integration`, `e2e` suites stay green (tests asserting env-var names, command name, and the in-memory DB name are updated to match).
3. `cargo fmt --check` — passes.
4. `cargo clippy --all-targets --all-features -- -D warnings` — passes.
5. `cargo run -p todo-engine -- health` — DB reachable at the unchanged `~/.hermes/oracle-todo/`, schema baseline OK.
6. `git log --follow todo-engine/src/main.rs` — history follows through the move.
7. `git grep -nE 'ORACLE_TODO|oracle_todo'` (underscore/upper forms) returns **zero** hits — all env vars, crate paths, module/tracing targets, and the in-memory DB name are renamed.
8. `git grep -n 'oracle-todo'` (hyphen form) returns **only** the data-home path survivors (`paths.rs` `.hermes/oracle-todo` + its CLI doc comment); nothing else.
9. No stale `src/…` path references in current-state docs.

## Risks / Notes

- **Two roles of `oracle-todo`:** the rename must distinguish env/brand (rename) from data-home path (keep). The grep checks in success criteria guard this.
- **Test fixtures:** e2e/integration tests assert env-var names, the clap command name, and log output targets — they move under `todo-engine/tests/` and need value updates in lockstep.
- **Env-var break:** consumers exporting `ORACLE_TODO_*` must switch to `TODO_ENGINE_*`. No backward-compat alias is provided (call out in docs / migration notes).
- **Orphaned rotated logs:** existing installs keep old `oracle-todo.log.jsonl(.1-3)` in `logs/`; new runs write `todo-engine.log.jsonl`. Cosmetic — logs are disposable, no migration needed.
- **`.cargo/` config:** local-only and gitignored; not part of this change.
- **CI / editor config:** any committed path- or name-pinned config would need updating — none committed today; verify before merge.
