# oracle-todo

A policy-enforced personal ToDo engine for Oracle/Hermes workflows.

## Principles

- **Software enforces policy**: agents and humans use the same service layer.
- **SQLite is the source of truth**: Telegram, Markdown, CLI, and dashboards are views.
- **Event log is mandatory**: every state change is auditable.
- **Second_Brain is read-only**: ToDo stores references but never writes to the vault.
- **User approval gates agent-created work**: Oracle proposals cannot become active tasks without approval.

## Current status

This repo is the active Rust engine workspace.

- Workspace: `/Users/singyusig/Desktop/02_Coding/oracle-todo-rust-refactor`
- Branch: `refactor/rust-sqlite`
- Data home default: `~/.hermes/oracle-todo/`
- Operating guardrails: `docs/rust-refactor.md`

## Stack

- Rust
- SQLite via `rusqlite`
- Terminal CLI first
- HTTP API over the same policy/service path

## Quick start

```bash
cargo run -- init
cargo run -- area create "재정" --review-cycle weekly
cargo run -- project propose "MoneyManager 안정화" --area "재정" --definition-of-done "원본 DB 백업/브리핑이 매일 실패 없이 동작한다"
cargo run -- task propose "MoneyManager 앱 열고 DB 생성 여부 확인" --area "재정"
cargo run -- pending
cargo run -- approve <item-id>
cargo run -- today
cargo run -- export
```

Override data home when needed:

```bash
export ORACLE_TODO_HOME=/path/to/data
```

## Verification

```bash
cargo fmt --check
cargo test
cargo clippy --all-targets --all-features -- -D warnings
```

## Copied-data smoke

Run smoke tests only against a copied data home:

```bash
tmp_home="$(mktemp -d)"
cp ~/.hermes/oracle-todo/todo.sqlite "$tmp_home/todo.sqlite"
cargo run -- --home "$tmp_home" migrate-legacy-db
cargo run -- --home "$tmp_home" pending
cargo run -- --home "$tmp_home" today
cargo run -- --home "$tmp_home" export
```

## API

The repo includes an Axum router in `src/interfaces/api.rs` and test coverage for the HTTP surface.

Endpoints include:

- `GET /health`
- `GET /items`
- `POST /areas`
- `POST /tasks/propose`
- `POST /items/{id}/approve`
- `POST /items/{id}/complete`
- `GET /exports/today.md`
