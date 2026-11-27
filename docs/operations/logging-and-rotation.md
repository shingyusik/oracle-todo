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
- `error_kind` on `command_failed`: a stable class such as `ledger_migration` or
  `ledger_storage`, never the error message, path, or record data

A Ledger read that upgrades an older schema emits `ledger_schema_upgraded`
(`from_version`, `to_version`).

Ledger writes emit `ledger_busy_retry` (per retry: `operation`, `attempt`, `max_attempts`,
`backoff_ms`) and `ledger_busy_exhausted` (`operation`, `attempts`) warnings.

The retention purge (scheduler, API, and CLI runs alike) logs under `raven_api` with run IDs,
domains, kinds, counts, and durations only, never record IDs, titles, paths, or SQL:

| Event | Fields |
| --- | --- |
| `retention_run_started` | `run_id`, `trigger` (`scheduled`, `api`, `cli`), `retention_days` |
| `retention_skipped` | `reason`: `locked`, `clock_regressed`, `insufficient_disk`, or, from the scheduler, `env_disabled`/`settings_unavailable` |
| `retention_backup_created` | `domain` (`todo`, `ledger`, `health`, `health_media`), `bytes`, `elapsed_ms` |
| `retention_domain_purged` | `domain`, `counts` (`kind=n ...`) |
| `retention_domain_failed` (`warn`) | `domain`, `error_kind` (for example `storage`, `busy`, `backup_io`) |
| `retention_media_cleanup_pending` (`warn`) | `count` |
| `retention_backup_pruned` | `removed`; `warn` with `error_kind` when rotation fails |
| `retention_run_completed` | `run_id`, `outcome`, `totals` (`purged=… skipped=… media_cleanup_pending=…`), `elapsed_ms` |

Google Calendar sync (scheduler, API, and CLI runs alike) logs under `raven_api` with run IDs,
triggers, outcomes, counts, HTTP statuses, and error kinds only. It never logs tokens,
authorization codes, `state` values, client secrets, Google URLs or response bodies, calendar
or event IDs, event titles, descriptions, or email addresses:

| Event | Fields |
| --- | --- |
| `google_calendar_sync_started` | `run_id`, `trigger` (`scheduled`, `api`, `cli`) |
| `google_calendar_sync_completed` | `run_id`, `outcome` (`ok`, `partial`, `failed`, `guard_tripped`, `reauth_required`, `nothing_to_do`), `counts` (JSON text), `error_kind` (empty when none), `elapsed_ms` |
| `google_calendar_sync_skipped` | `reason`: `locked`, `disabled`, `env_disabled`, `not_connected`, `reauth_required`, `calendar_not_selected`, `todo_unavailable`, `clock_regressed`, `storage_unavailable` |
| `google_calendar_full_resync` | `reason` (for example the sync token expired with `410 Gone`) |
| `google_calendar_api_retry` | `operation` (for example `insert_event`), `status` (`rate_limited`), `attempt`, `backoff_ms` |
| `google_calendar_guard_tripped` | `counts` (planned deletions and archives, threshold) |
| `google_calendar_auth_failed` | `error_kind` (for example `invalid_grant`) |
| `google_calendar_connected` | `scopes` |
| `google_calendar_disconnected` | `revoked` (whether Google accepted the revoke) |

Levels: `guard_tripped` and `auth_failed` are `WARN`; everything else is `INFO`, except the
scheduler's routine skips `disabled`, `not_connected`, and `calendar_not_selected`, which are
`DEBUG` so an idle integration does not log every poll. A scheduler waiting for the first
sync confirmation logs nothing.

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
