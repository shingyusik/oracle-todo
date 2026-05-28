# oracle-todo

A policy-enforced personal ToDo engine for Oracle/Hermes workflows.

## Principles

- **Software enforces policy**: agents and humans use the same service layer.
- **SQLite is the source of truth**: Telegram, Markdown, CLI, and dashboards are views.
- **Event log is mandatory**: every state change is auditable.
- **Second_Brain is read-only**: ToDo stores references but never writes to the vault.
- **User approval gates agent-created work**: Oracle proposals cannot become active tasks without approval.

## Refactor status

This worktree is for the Rust + SQLite refactor. The existing Python engine remains operational until explicit cutover approval.

- Operational Python engine: `/Users/singyusig/Desktop/02_Coding/oracle-todo`
- Preserved legacy copy: `/Users/singyusig/Desktop/02_Coding/oracle-todo-python-legacy`
- Refactor branch/worktree: `/Users/singyusig/Desktop/02_Coding/oracle-todo-rust-refactor` (`refactor/rust-sqlite`)
- Guardrails: `docs/rust-refactor.md`

## Target stack

- Rust
- SQLite via `rusqlite`
- Terminal CLI first
- API later, over the same policy/service path

## Quick start

```bash
uv sync
uv run oracle-todo init
uv run oracle-todo area create "재정" --review-cycle weekly
uv run oracle-todo project propose "MoneyManager 안정화" --area "재정" --definition-of-done "원본 DB 백업/브리핑이 매일 실패 없이 동작한다"
uv run oracle-todo task propose "MoneyManager 앱 열고 DB 생성 여부 확인" --area "재정"
uv run oracle-todo pending
uv run oracle-todo approve <item-id>
uv run oracle-todo today
uv run oracle-todo export
```

Default data directory: `~/.hermes/oracle-todo/`.
Override with:

```bash
export ORACLE_TODO_HOME=/path/to/data
```

## Dashboard-ready API

```bash
uv run uvicorn oracle_todo.api:app --reload
```

Endpoints:

- `GET /health`
- `GET /items`
- `POST /areas`
- `POST /tasks/propose`
- `POST /items/{id}/approve`
- `POST /items/{id}/complete`
- `GET /exports/today.md`
