# CLAUDE.md

## Project Overview

`oracle-todo` — a policy-enforced, local-first personal ToDo engine (Rust 2024) for Oracle/Hermes workflows.

- **SQLite is the source of truth.** CLI, HTTP API, and Markdown exports are all views over `todo.sqlite`.
- **The Rust service layer enforces policy.** Every mutation goes through `TodoService`: validation plus a status state machine. CLI and API never bypass it.
- **Approval gates agent work.** Oracle/agent-created items start as `proposed` and require user approval before activation; user-created items can start `approved`.
- **Audit events are mandatory.** Every service-layer mutation writes a `TodoEvent` row to the SQLite `events` table.
- **Second_Brain refs are read-only.** `second_brain_refs` are reference input, never written back.

The full data model (item types, columns, status lifecycle, CLI/API surface) lives in `README.md` — read it before changing the schema or service behavior.

## Architecture

Clean/hexagonal layering under `src/`. Dependencies point inward — `interfaces` and `infrastructure` depend on `application` and `domain`, never the reverse; `domain` does no I/O.

| Layer | Files | Responsibility |
| --- | --- | --- |
| `domain/` | `model.rs`, `recurrence.rs` | Item types, `ItemStatus`, recurrence rules. Pure logic, no I/O. |
| `application/` | `service.rs`, `ports.rs`, `error.rs` | `TodoService` policy + state machine, repository port trait, `TodoError`. |
| `infrastructure/` | `sqlite.rs`, `paths.rs`, `system.rs` | `rusqlite` repository + schema, data-home resolution, clock/system. |
| `interfaces/` | `cli.rs`, `api.rs` | `clap` CLI and `axum` HTTP router. Thin adapters over the service. |
| (root) | `exports.rs`, `lib.rs`, `main.rs` | Markdown exports, crate wiring, binary entrypoint. |

## Docs Map

| Need | Read |
| --- | --- |
| Data model, item types, columns, status lifecycle, full CLI/API surface | `README.md` |
| v1 design rationale, canonical architecture, object-type semantics | `docs/design-v1.md` |
| Engine guardrails, data-home safety rules, verification gate | `docs/rust-refactor.md` |

## Commands

```bash
cargo build                                              # build
cargo run -- init                                        # create the SQLite DB at the data home
cargo run -- health                                      # DB reachability + schema baseline
cargo run -- pending                                     # proposed / approved / active work
cargo run -- today                                       # today's materialized task view
cargo run -- export                                      # write Markdown views to exports/
cargo test                                               # all tests
cargo fmt --check                                        # format gate
cargo clippy --all-targets --all-features -- -D warnings # lint gate (warnings are errors)
```

CLI subcommands: `init`, `health`, `migrate-legacy-db`, `list`, `area`, `project`, `task`, `routine`, `event`, `approve`, `activate`, `pause`, `resume`, `complete`, `archive`, `drop`, `cancel`, `update`, `archive-list`, `pending`, `today`, `export`.

## Data Home & Configuration

- Data home: `ORACLE_TODO_HOME` env var or `--home <path>`; default `~/.hermes/oracle-todo/`.
- Layout: `todo.sqlite`, `exports/*.md`, `logs/oracle-todo.jsonl(.1-.3)`.
- Log rotation: `ORACLE_TODO_LOG_MAX_BYTES` (default `1_048_576`), `ORACLE_TODO_LOG_MAX_FILES` (default `3`).
- Exit codes / HTTP status: policy/validation → CLI `2` / HTTP `400`; not-found → CLI `4` / HTTP `404`; storage/internal → CLI `1` / HTTP `500`.

## Gotchas

- **Don't bypass `TodoService`.** Direct repository writes skip validation, the state machine, and the audit event — breaking the core invariant. All mutations route through the service layer.
- **The live data home is canonical.** Never aim destructive experiments at `~/.hermes/oracle-todo/todo.sqlite` without explicit approval. Copy it to a temp home for smoke checks (`*.sqlite` is gitignored).
- **Schema init is additive.** `init_schema()` creates tables and backfills missing columns on older `items` tables; `migrate-legacy-db` normalizes Python-era values. Don't drop or rewrite existing columns.
- **Approval gating is policy, not UI.** Agent/Oracle-created items must stay `proposed` until user approval.
- **Parity tests guard shared behavior.** `tests/*_parity.rs` assert CLI/API/export views agree with the service layer — keep them green when changing shared behavior.

## Skills & Plugins

Project skills live in `.claude/plugins/` as a local marketplace. Pick the plugin by task domain; individual skills self-describe when to fire.

| Plugin | Domain | Reach for it when |
| --- | --- | --- |
| `docs-tools` | Documentation (mutating) | Touching `README.md` or `docs/`, or code changes need doc sync. |
| `code-audits` | Quality inspection (read-only) | Auditing architecture boundaries, complexity, duplication, conventions, error/logging, constants, test quality, docs sync, or resource lifecycle — `quality-audit` runs them all. |
| `code-cleanup` | Code removal (mutating) | Cleaning up dead code, legacy code, or unnecessary comments. |
| `git-workflow` | Git commits | Committing changes or splitting them into structured commits. |

Workflow: docs follow code — after a change lands, sync docs with `docs-tools`, then commit with `git-workflow`.
