# Tracing Logging Design

## Goal

Replace the custom `OperationalLogger` with a single `tracing`-based logging system.
CLI output remains machine-friendly on stdout, while human-visible logs go to stderr and
structured debug logs go to a rotating JSONL file.

## Output Policy

- stdout stays reserved for command results such as JSON items, rendered views, and export paths.
- stderr receives console logs at `INFO` and above by default.
- `logs/oracle-todo.log.jsonl` receives structured JSONL logs at `DEBUG` and above by default.
- Rotation keeps the existing size/count environment controls:
  - `ORACLE_TODO_LOG_MAX_BYTES`
  - `ORACLE_TODO_LOG_MAX_FILES`

## File Layout

```text
<data-home>/logs/
├── oracle-todo.log.jsonl
├── oracle-todo.log.jsonl.1
├── oracle-todo.log.jsonl.2
└── oracle-todo.log.jsonl.3
```

## Configuration

- `ORACLE_TODO_CONSOLE_LOG` controls the stderr level, defaulting to `info`.
- `ORACLE_TODO_FILE_LOG` controls the file level, defaulting to `debug`.
- Invalid level values fall back to defaults and emit a warning when logging is available.

## Event Model

Use normal `tracing` events throughout the CLI and supporting layers:

- `info`: command start/completion, database open, major user-visible milestones.
- `debug`: resolved paths, selected filters, repository/service steps, export/materialization details.
- `warn`: recoverable fallback behavior and logging/rotation failures.
- `error`: command failures and storage/policy errors before returning to the entrypoint.

The previous `command_start`, `command_success`, and `command_error` records become tracing
events with structured fields such as `command`, `duration_ms`, and `exit_code`.

## Rotation Events

File rotation is still implemented locally because `tracing-subscriber` does not provide this
project's size-based backup policy by itself. Rotation should be performed by the file writer
without recursively calling `tracing` while it is writing an event. If rotation needs to be
recorded, the writer should emit a normal JSONL record directly after the rotation completes,
using the same file format and including fields such as `event="log_rotated"` and `backup_count`.

## Testing

Add failing tests before implementation for these behaviors:

- A successful CLI command writes INFO console logs to stderr without contaminating stdout.
- The file log contains both INFO and DEBUG JSONL records.
- DEBUG records are absent from stderr by default.
- A failing CLI command records an ERROR event with the mapped `exit_code`.
- Small log size limits rotate `oracle-todo.log.jsonl` and keep the configured backup count.

## Documentation

Update the logging convention and operations docs after the code change so they describe
`tracing`, the new filename, level configuration, and the separation of stdout, stderr, and file
logs.
