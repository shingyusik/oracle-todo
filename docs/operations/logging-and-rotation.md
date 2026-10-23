# Logging and Rotation

Raven separates user output from operational diagnostics:

- stdout — command JSON or tables
- stderr — console tracing and user-facing errors
- `<raven-home>/logs/raven.log.jsonl` — structured Raven CLI events

`--error-format json` suppresses console tracing to keep stderr machine-readable.
In this mode command tracing is disabled; domain audit history still records mutations.
Request-key receipt storage is independent of operational logs.

## Configuration

| Variable | Default | Accepted values |
| --- | --- | --- |
| `RAVEN_CONSOLE_LOG` | `info` | `off`, `error`, `warn`/`warning`, `info`, `debug`, `trace` |
| `RAVEN_FILE_LOG` | `debug` | same |
| `RAVEN_LOG_MAX_BYTES` | `1048576` | positive `u64`; invalid/zero uses default |
| `RAVEN_LOG_MAX_FILES` | `3` | nonnegative integer; invalid uses default |

Invalid levels use their destination defaults.

## Files

```text
logs/
├── raven.log.jsonl
├── raven.log.jsonl.1
├── raven.log.jsonl.2
└── raven.log.jsonl.3
```

Before each complete JSONL event, Raven checks whether current size plus incoming event
exceeds the configured maximum. It shifts backups and starts a new current file. With
`RAVEN_LOG_MAX_FILES=0`, the full current file is removed and no backup is retained.

File logging is best-effort. Directory creation, rotation, open, lock, or write failure does
not abort the domain command; Raven emits a non-recursive warning to stderr when the console
level includes warnings.

## Targets

Only `raven_cli`, `raven_api` and `ledger_engine` events are enabled; all follow the console
and file levels above. Dependency crates (including `rmcp`) stay silent. `raven_api` emits
sanitized internal errors (request ID only) and MCP access lines: `warn` denials with the caller
Client ID and, for tool calls, the tool name and OAuth `client_id`, plus a `debug`
"MCP request authorized" line per request. Token text is never logged.

## Event fields

Top-level commands emit `command_started`, `command_completed`, or `command_failed` with:

- command label
- owning engine
- elapsed milliseconds
- mapped exit code

Ledger writes emit `ledger_busy_retry` (per retry: `operation`, `attempt`, `max_attempts`,
`backoff_ms`) and `ledger_busy_exhausted` (`operation`, `attempts`) warnings.

The composed API creates its own request IDs for sanitized errors. Secrets, raw bearer
tokens, UI session values, database paths in API errors, and Health image bytes must never
be logged.

## Rotation probe

Use a temporary home:

```bash
probe_home="$(mktemp -d)"
RAVEN_LOG_MAX_BYTES=2048 RAVEN_LOG_MAX_FILES=1 \
  raven --home "$probe_home" init
```

Inspect only `$probe_home/logs`; never use a live home for forced-rotation tests.
