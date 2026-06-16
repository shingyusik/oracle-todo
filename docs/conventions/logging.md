# Logging

There are two logging concerns: console tracing for the operator and structured JSONL file
logs for later inspection. Rotation behavior and file layout are in
[../operations/logging-and-rotation.md](../operations/logging-and-rotation.md).

## CLI output layers

The CLI separates three streams:

- **stdout** — the user-facing command result (JSON for created/updated items, rendered
  Markdown for views).
- **stderr** — user-facing errors plus console tracing logs.
- **file log** — structured JSONL tracing logs under
  `ORACLE_TODO_HOME/logs/oracle-todo.log.jsonl`.

Do not write diagnostic or progress logs to stdout. Keep stdout parseable for scripts.

## Tracing API

Use `tracing::{debug, info, warn, error}!` for operational logs:

| Level | Use |
| --- | --- |
| `debug` | Resolved paths, selected filters, repository/service steps, export/materialization details. |
| `info` | Command start/completion, database open, and major user-visible milestones. |
| `warn` | Recoverable fallback behavior and logging/rotation failures. |
| `error` | Command failures and storage/policy errors before returning to the entrypoint. |

Attach an `event` field for machine-readable log filtering:

```rust
tracing::info!(event = "command_started", command = command_name, "command started");
tracing::debug!(event = "database_opened", path = %db_path.display());
tracing::error!(
    event = "command_failed",
    command = command_name,
    exit_code,
    error = %format!("{error:#}"),
    "command failed"
);
```

## Level configuration

`src/infrastructure/system.rs` installs two `tracing_subscriber` layers:

| Destination | Env var | Default |
| --- | --- | --- |
| stderr console logs | `ORACLE_TODO_CONSOLE_LOG` | `info` |
| `logs/oracle-todo.log.jsonl` | `ORACLE_TODO_FILE_LOG` | `debug` |

Accepted levels are `off`, `error`, `warn`/`warning`, `info`, `debug`, and `trace`.
Invalid values fall back to the destination default.

## File records

The file layer writes one JSON object per tracing event. Records use the
`tracing-subscriber` JSON shape, with fields such as:

| Field | Notes |
| --- | --- |
| `timestamp` | RFC 3339 UTC. |
| `level` | Event level, such as `DEBUG`, `INFO`, or `ERROR`. |
| `target` | Rust module path that emitted the event. |
| `fields.event` | Machine-readable event name, such as `command_started`. |
| `fields.message` | Human-readable message. |
| `fields.command` | Command label when applicable, e.g. `task propose`. |
| `fields.exit_code` | `0` on success, mapped CLI code on command failure. |
| `fields.duration_ms` | Elapsed milliseconds on command completion/failure. |
| `fields.error` | Error message on command failure. |

File logging is best-effort and must not abort the command. If the file writer cannot create,
rotate, open, or write the log file, it reports a non-recursive warning to stderr rather than
calling `tracing` from inside the writer.
