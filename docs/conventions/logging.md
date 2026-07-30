# Logging

Raven CLI tracing is operational metadata, not a second record store.

## Streams

- stdout: stable command result
- stderr: console tracing and user-facing error
- `RAVEN_HOME/logs/raven.log.jsonl`: structured command events

Never write diagnostics to stdout.

## Event convention

Use `tracing` with a stable `event` field. The top-level command boundary emits:

```rust
tracing::info!(
    event = "command_started",
    command,
    engine,
    "command started"
);
```

Completion/failure records add `duration_ms` and the mapped `exit_code`.

| Level | Use |
| --- | --- |
| `debug` | Bounded operational detail that contains no record payload or secret |
| `info` | Command start/completion and safe listener readiness |
| `warn` | Recoverable browser/log/media-cleanup behavior |
| `error` | Final command or API internal classification |

## Redaction

Never log:

- `RAVEN_API_TOKEN`, token-file contents, bearer headers, or UI session cookies
- Health image bytes
- raw request bodies or full domain records by default
- database paths or SQL in composed API responses
- internal storage messages returned to HTTP clients

API internal errors log the generated `request_id` and a fixed classification. The response
uses the same ID and generic text.

## File writer

The JSONL writer buffers one tracing event and appends it atomically under a process-local
mutex. Rotation and write errors are best-effort and issue a direct, non-recursive stderr
warning instead of logging from inside the writer.

Configuration and rotation behavior are in
[../operations/logging-and-rotation.md](../operations/logging-and-rotation.md).
