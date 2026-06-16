# Logging and Rotation

`oracle-todo` writes a structured operational log for every CLI run. This page covers the
files and rotation behavior; how the log is *emitted* (records, fields, levels) is in
[../conventions/logging.md](../conventions/logging.md).

## Files

The operational log lives under the data home's `logs/` directory:

```text
<data-home>/logs/
├── oracle-todo.jsonl      # current log (one JSON object per line)
├── oracle-todo.jsonl.1    # previous rotation
├── oracle-todo.jsonl.2
└── oracle-todo.jsonl.3    # oldest kept backup (default max-files = 3)
```

Each line is a `command_start`, `command_success`, or `command_error` record for one
command. (This is distinct from `RUST_LOG` tracing output, which goes to the terminal.)

## Configuration

| Env var | Default | Meaning |
| --- | --- | --- |
| `ORACLE_TODO_LOG_MAX_BYTES` | `1048576` (1 MiB) | Max size of the current log before rotation. Values must parse as a positive `u64`; otherwise the default is used. |
| `ORACLE_TODO_LOG_MAX_FILES` | `3` | Number of rotated backups to keep. |

## Rotation behavior

Verified against `infrastructure/system.rs`:

- Before each write, the logger checks the current file size. If the file is empty, or if
  `current_bytes + incoming_line <= max_bytes`, it appends with no rotation.
- When the next write would exceed `max_bytes`, the logger rotates: it deletes the oldest
  backup (`oracle-todo.jsonl.<max_files>`), shifts each `.<n>` up to `.<n+1>`, then renames
  the current `oracle-todo.jsonl` to `oracle-todo.jsonl.1`. The next write starts a fresh
  current file.
- If `ORACLE_TODO_LOG_MAX_FILES=0`, rotation keeps no backups: when the size limit is hit the
  current file is removed and a new one is started.
- Logging is best-effort and never aborts the command — a serialization or write failure is
  reported via `tracing::warn!` and the command continues.

## Example

```bash
# keep tiny logs with a single backup, then run a command
ORACLE_TODO_LOG_MAX_BYTES=2048 ORACLE_TODO_LOG_MAX_FILES=1 \
  cargo run -- --home "$tmp_home" pending
cat "$tmp_home/logs/oracle-todo.jsonl"
```
