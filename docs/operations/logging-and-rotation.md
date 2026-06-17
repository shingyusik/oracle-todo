# Logging and Rotation

`todo-engine` writes console logs to stderr and structured JSONL tracing logs to the data
home. This page covers the files, configuration, and rotation behavior; how to emit logs in
code is in [../conventions/logging.md](../conventions/logging.md).

## Files

The file log lives under the data home's `logs/` directory:

```text
<data-home>/logs/
├── todo-engine.log.jsonl      # current log (one JSON object per line)
├── todo-engine.log.jsonl.1    # previous rotation
├── todo-engine.log.jsonl.2
└── todo-engine.log.jsonl.3    # oldest kept backup (default max-files = 3)
```

Each line is a `tracing` JSON event. Common CLI events include `command_started`,
`command_completed`, `command_failed`, `home_resolved`, `database_opened`, and `log_rotated`.

## Configuration

| Env var | Default | Meaning |
| --- | --- | --- |
| `TODO_ENGINE_CONSOLE_LOG` | `info` | Minimum level for stderr console logs. Accepted values: `off`, `error`, `warn`/`warning`, `info`, `debug`, `trace`. |
| `TODO_ENGINE_FILE_LOG` | `debug` | Minimum level for `todo-engine.log.jsonl`. Uses the same accepted values as the console log. |
| `TODO_ENGINE_LOG_MAX_BYTES` | `1048576` (1 MiB) | Max size of the current log before rotation. Values must parse as a positive `u64`; otherwise the default is used. |
| `TODO_ENGINE_LOG_MAX_FILES` | `3` | Number of rotated backups to keep. |

Invalid log level values fall back to the destination default.

## Rotation behavior

Verified against `infrastructure/system.rs`:

- Before each file event write, the writer checks the current file size. If the file is empty,
  or if `current_bytes + incoming_event <= max_bytes`, it appends with no rotation.
- When the next event would exceed `max_bytes`, the writer rotates: it deletes the oldest
  backup (`todo-engine.log.jsonl.<max_files>`), shifts each `.<n>` up to `.<n+1>`, then
  renames the current `todo-engine.log.jsonl` to `todo-engine.log.jsonl.1`. The next write
  starts a fresh current file.
- If `TODO_ENGINE_LOG_MAX_FILES=0`, rotation keeps no backups: when the size limit is hit the
  current file is removed and a new one is started.
- Rotation can write an `INFO` `fields.event="log_rotated"` record to the fresh log file. That
  record respects `TODO_ENGINE_FILE_LOG`, so it appears only when the file level includes
  `INFO` events.
- File logging is best-effort and never aborts the command. If the writer cannot create,
  rotate, open, or write the log file, it reports a non-recursive warning to stderr and the
  command continues.

## Example

```bash
# keep tiny logs with a single backup, then run a command
TODO_ENGINE_LOG_MAX_BYTES=2048 TODO_ENGINE_LOG_MAX_FILES=1 \
  cargo run -p todo-engine -- --home "$tmp_home" pending
cat "$tmp_home/logs/todo-engine.log.jsonl"
```
