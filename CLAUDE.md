# AGENTS.md

## Project Overview

`Raven` is a local-first personal engine written in Rust 2024.

- One `raven` executable exposes `todo`, `ledger`, `health`, `api`, and `ui`.
- `todo.sqlite`, `ledger.sqlite`, and `health.sqlite` are independent sources of truth.
- Every domain mutation goes through its application service and writes audit history.
- CLI and HTTP are adapters; neither may bypass service policy.
- The UI Dashboard currently shows ToDo analytics only. Ledger and Health Journal do not
  have duplicate Overview pages.

Read `README.md` and the relevant operations reference before changing schemas, commands,
API behavior, or lifecycle policy.

## Architecture

Dependencies point inward: interfaces/infrastructure → application → domain. Domain crates
do no I/O and never depend on another engine.

| Package | Responsibility |
| --- | --- |
| `raven-cli` | Native `raven` binary, paths, logging, dispatch, import, API/UI startup |
| `raven-api` | Auth, `/api/v1` composition, safe errors, Dashboard, UI session/static serving |
| `todo-engine` | ToDo item graph, recurrence, lifecycle, SQLite, reusable adapters |
| `ledger-engine` | Money/master data, entries, transfers, reports, audit, SQLite |
| `health-engine` | Diet/media, health events, timeline/trends, audit, SQLite |
| `frontend` | Static ToDo Dashboard and ToDo/Ledger/Health workspaces |
| `backend` | Namespaced presentation preferences stored in `todo.sqlite` |

## Docs Map

| Need | Read |
| --- | --- |
| Models and invariants | `docs/architecture/data-model.md` |
| Layer boundaries | `docs/architecture/overview.md`, `docs/architecture/layers.md` |
| CLI/API | `docs/operations/cli-reference.md`, `docs/operations/api-reference.md` |
| Home, setup, logging | `docs/operations/{setup,data-home,logging-and-rotation}.md` |
| Verification | `docs/operations/verification-and-smoke.md` |

## Commands

```bash
cargo run -p raven-cli -- init
cargo run -p raven-cli -- health-check
cargo run -p raven-cli -- todo pending
cargo run -p raven-cli -- ledger --help
cargo run -p raven-cli -- health --help
cargo run -p raven-cli -- ui --ui-path frontend/out --no-open
cargo fmt --check
cargo test --workspace
cargo clippy --all-targets --all-features -- -D warnings
npm --prefix frontend test
npm --prefix frontend run typecheck
npm --prefix frontend run build
npm --prefix npm/raven test
```

## Data Home & Configuration

- Home: `--home`, `RAVEN_HOME`, then `~/.raven`.
- Layout: three SQLite files, `media/health/`, `logs/raven.log.jsonl(.1-.3)`.
- Logs: `RAVEN_CONSOLE_LOG`, `RAVEN_FILE_LOG`, `RAVEN_LOG_MAX_BYTES`, `RAVEN_LOG_MAX_FILES`.
- API auth: exactly one of `RAVEN_API_TOKEN` or `RAVEN_API_TOKEN_FILE`.
- API bind: `RAVEN_API_BIND_HOST`, `RAVEN_API_BIND_PORT`; non-loopback cleartext also
  requires exact `RAVEN_API_ALLOW_UNSAFE_CLEARTEXT=true`.
- UI artifact: `--ui-path` or `RAVEN_UI_PATH`.
- Public UI origin: optional canonical HTTPS `RAVEN_UI_PUBLIC_ORIGIN`; UI remains loopback-only.

## Gotchas

- Never run destructive smoke, import, migration, or purge probes against a live home.
- ToDo uses status lifecycle and no hard delete. Ledger entries and Health records use
  archive/restore; Ledger master data uses activation. Ledger/Health purge is confirmed.
- `raven todo api` is unsupported; all HTTP access uses authenticated Raven API/UI routes.
- Health database and `media/health` must be backed up together.
- Dashboard reads must not create or migrate missing stores; domain failures stay isolated.
- Do not expose API token/session values, image bytes, paths, SQL, or raw storage errors.
- ToDo import is read-only source → temporary validated copy → no-clobber destination.

## Skills & Hooks

Project skills live under `.claude/plugins/` and are mirrored under `.codex/skills/`.
Treat `.claude/plugins/` as source of truth. Use docs skills after code changes, verification
skills before completion, and structured-commit rules when committing. Codex hooks are in
`.codex/hooks.json`.
