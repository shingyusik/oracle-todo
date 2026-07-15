# AGENTS.md

## Project Overview

`todo-engine` — a policy-enforced, local-first personal ToDo engine (Rust 2024) for agent workflows.

- **SQLite is the source of truth.** CLI and HTTP API are both views over `todo.sqlite`.
- **The Rust service layer enforces policy.** Every mutation goes through `TodoService`: validation plus a status state machine. CLI and API never bypass it.
- **Approval gates agent work.** Agent-created items start as `proposed` and require user approval before activation; user-created items can start `approved`.
- **Audit events are mandatory.** Every service-layer mutation writes a `TodoEvent` row to the SQLite `events` table.
- **Second_Brain refs are read-only.** `second_brain_refs` are reference input, never written back.

The full data model (item types, columns, status lifecycle, CLI/API surface) lives in `README.md` — read it before changing the schema or service behavior.

## Architecture

The Rust crate lives under `todo-engine/` (package/binary/lib `todo-engine`/`todo_engine`); `frontend/` is a reserved sibling package slot in the workspace. Clean/hexagonal layering under `todo-engine/src/`. Dependencies point inward — `interfaces` and `infrastructure` depend on `application` and `domain`, never the reverse; `domain` does no I/O.

| Layer | Files | Responsibility |
| --- | --- | --- |
| `todo-engine/src/domain/` | `model.rs`, `status.rs`, `recurrence.rs` | Item types, `ItemStatus`, recurrence rules. Pure logic, no I/O. |
| `todo-engine/src/application/` | `service/`, `ports.rs`, `error.rs` | `TodoService` policy + state machine, repository port trait, `TodoError`. |
| `todo-engine/src/infrastructure/` | `sqlite/`, `paths.rs`, `system.rs` | `rusqlite` repository + schema, data-home resolution, clock/system. |
| `todo-engine/src/interfaces/` | `cli/`, `api/` | `clap` CLI and `axum` HTTP router. Thin adapters over the service. |
| `todo-engine/src/` (root) | `lib.rs`, `main.rs` | Crate wiring, binary entrypoint. |

Each split layer (`service/`, `sqlite/`, `cli/`, `api/`) is a directory module; see `docs/architecture/layers.md` for the per-file breakdown and the `pub(super)` visibility convention.

## Docs Map

| Need | Read |
| --- | --- |
| Data model, item types, columns, status lifecycle | `README.md` |
| Full CLI/API surface | `docs/operations/cli-reference.md` + `docs/operations/api-reference.md` |
| Design rationale, architecture, locked policies | `docs/architecture/overview.md`, `docs/architecture/layers.md`, `docs/architecture/decisions/` |
| Engine guardrails, data-home safety, smoke + verification | `docs/operations/verification-and-smoke.md`, `docs/operations/data-home.md` |

## Commands

```bash
cargo build                                              # build (workspace root)
cargo run -p todo-engine -- init                         # create the SQLite DB at the data home
cargo run -p todo-engine -- health                       # DB reachability + schema baseline
cargo run -p todo-engine -- api                          # serve the HTTP API on 127.0.0.1:3002
cargo run -p todo-engine -- pending                      # proposed / approved / active work
cargo run -p todo-engine -- today                        # today's materialized task view
cargo test                                               # all tests (workspace root)
cargo fmt --check                                        # format gate
cargo clippy --all-targets --all-features -- -D warnings # lint gate (warnings are errors)
```

CLI subcommands: `init`, `health`, `api`, `list`, `area`, `project`, `task`, `routine`, `event`, `approve`, `activate`, `pause`, `resume`, `complete`, `archive`, `drop`, `cancel`, `update`, `archive-list`, `pending`, `today`.

## Data Home & Configuration

- Data home: `--home <path>`, `TODO_ENGINE_HOME`, or `TODO_ENGINE_HOME` in `.env`; default `~/.todo-engine/`. `.env` treats `\` as an escape, so single-quote a Windows path; an unparsable `.env` aborts instead of falling back.
- Layout: `todo.sqlite`, `logs/todo-engine.log.jsonl(.1-.3)`.
- Log levels: `TODO_ENGINE_CONSOLE_LOG` (default `info`), `TODO_ENGINE_FILE_LOG` (default `debug`).
- Log rotation: `TODO_ENGINE_LOG_MAX_BYTES` (default `1_048_576`), `TODO_ENGINE_LOG_MAX_FILES` (default `3`).
- Exit codes / HTTP status: policy/validation → CLI `2` / HTTP `400`; not-found → CLI `4` / HTTP `404`; conflict → CLI `2` / HTTP `409`; storage/internal → CLI `1` / HTTP `500`.

## Gotchas

- **Don't bypass `TodoService`.** Direct repository writes skip validation, the state machine, and the audit event — breaking the core invariant. All mutations route through the service layer.
- **The live data home is canonical.** Never aim destructive experiments at `~/.todo-engine/todo.sqlite` without explicit approval. Copy it to a temp home for smoke checks (`*.sqlite` is gitignored).
- **Schema init is additive.** `init_schema()` creates tables and backfills missing columns on older `items` tables. Don't drop or rewrite existing columns.
- **Approval gating is policy, not UI.** Agent-created items must stay `proposed` until user approval.
- **Layered tests guard shared behavior.** `todo-engine/tests/{unit,integration,e2e}` are three test binaries (see `docs/conventions/testing.md`); the e2e (`tests/e2e/{cli,api}.rs`) and integration suites assert CLI/API behavior agrees with the service layer — keep them green when changing shared behavior.

## Skills & Hooks

Project-owned skills are authored under `.claude/plugins/` and mirrored for Codex under `.codex/skills/`. Treat `.claude/plugins/` as the source of truth and `.codex/skills/` as the local Codex runtime copy. Do not install these project skills into global Codex skill storage.

Codex project hooks live in `.codex/hooks.json`. On `session_start` for `startup|clear|compact`, the hook (`.codex/hooks/run-hook.cmd session-start`) injects baseline guidelines (e.g. `karpathy-guidelines`, `using-superpowers`) into the session.

| Skill group | Codex location | Source | Reach for it when |
| --- | --- | --- | --- |
| `docs-tools` | `.codex/skills/{docs-change-updater,readme-structure-guard,writing-final-state-docs}` | `.claude/plugins/docs-tools/skills/` | Touching `README.md` or `docs/`, or code changes need doc sync. |
| `code-audits` | `.codex/skills/*-audit`, `.codex/skills/quality-audit` | `.claude/plugins/code-audits/skills/` | Auditing architecture boundaries, complexity, duplication, conventions, error/logging, constants, test quality, docs sync, or resource lifecycle. Use `quality-audit` for the full sweep. |
| `code-cleanup` | `.codex/skills/deadcode-cleaner` | `.claude/plugins/code-cleanup/skills/` | Cleaning up dead code, legacy code, or unnecessary comments. |
| `git-workflow` | `.codex/skills/structured-commit` | `.claude/plugins/git-workflow/skills/` | Committing changes or splitting them into structured commits. |
| `dev-workflow` | `.codex/skills/verify-todo-engine` | `.claude/plugins/dev-workflow/skills/` | Running the engine + frontend against a throwaway data home to observe a change working end-to-end. |

Workflow: docs follow code — after a change lands, sync docs with `docs-tools`, then commit with `git-workflow`.
