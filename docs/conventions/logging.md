# Logging

There are two logging concerns: human-facing tracing and the structured **operational log**.
This page covers how to emit them; rotation behavior and file layout are in
[../operations/logging-and-rotation.md](../operations/logging-and-rotation.md).

## CLI output layers

The CLI separates three streams:

- **stdout** — the user-facing command result (JSON for created/updated items, rendered
  Markdown for views).
- **stderr** — user-facing errors.
- **file log** — the structured JSONL operational command log under
  `ORACLE_TODO_HOME/logs/oracle-todo.jsonl`.

## The operational log (`OperationalLogger`)

`src/infrastructure/system.rs` defines `OperationalLogger`. Construct it once per CLI run
with `OperationalLogger::new(&home)` (it creates `logs/` under the data home), then emit
exactly three kinds of records around the dispatched command:

```rust
let logger = OperationalLogger::new(&home)?;
logger.command_start(command_name);
// ... run the command, measure duration_ms ...
logger.command_success(command_name, duration_ms);          // on Ok
logger.command_error(command_name, &message, exit_code, duration_ms); // on Err
```

This is exactly what `interfaces/cli/run` does: it labels the command, logs `command_start`,
runs it, then logs `command_success` or `command_error` with the elapsed milliseconds, passing
`TodoError::cli_exit_code_from_error(error)` as the mapped exit code.

## Record fields and levels

Each record is one JSON object per line (`LogRecord`):

| Field | Notes |
| --- | --- |
| `timestamp` | RFC 3339 UTC. |
| `level` | `INFO` for start/success, `ERROR` for error. |
| `event` | `command_start`, `command_success`, or `command_error`. |
| `command` | The command label, e.g. `task propose`. |
| `message` | `"command started"` / `"command completed"` / the error message (`{error:#}`). |
| `pid` | Process id. |
| `exit_code` | Omitted on start; `0` on success; the mapped `TodoError` exit code (or absent) on error. |
| `duration_ms` | Omitted on start; elapsed milliseconds on success/error. |

`exit_code` and `duration_ms` are `#[serde(skip_serializing_if = "Option::is_none")]`, so they
do not appear on records where they don't apply.

## Tracing

`init_tracing()` installs a `tracing_subscriber` fmt layer driven by the `RUST_LOG`
environment filter (`EnvFilter::from_default_env()`). It is best-effort (`try_init`). The
operational logger itself uses `tracing::warn!` only as a last resort when it cannot serialize
or write a record — it never panics on a logging failure.
