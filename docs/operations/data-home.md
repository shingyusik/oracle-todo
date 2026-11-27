# Data Home

The Raven home contains all canonical domain stores, Health media, and operational logs.

## Resolution

`RavenPaths` resolves:

1. global `--home <path>`
2. `RAVEN_HOME` from the process or `.env`
3. `$HOME/.raven`
4. `%USERPROFILE%/.raven` on Windows when `HOME` is absent or empty

```bash
raven --home /path/to/raven-data init
RAVEN_HOME=/path/to/raven-data raven health-check
```

`.env` uses shell-style escaping. Single-quote Windows paths containing backslashes:

```dotenv
RAVEN_HOME='C:\Users\me\raven-data'
```

A malformed `.env` aborts with exit `1`; it never silently redirects a command to the
default home.

## Layout

```text
<raven-home>/
├── todo.sqlite
├── ledger.sqlite
├── health.sqlite
├── media/
│   └── health/
├── maintenance/
│   ├── retention.json
│   ├── retention-state.json
│   └── retention.lock
├── integrations/
│   └── google-calendar/
│       ├── settings.json
│       ├── state.json
│       ├── token.json
│       ├── oauth-client.json
│       ├── sync.sqlite
│       └── sync.lock
├── backups/
│   └── retention/
│       └── <YYYYMMDDTHHMMSSZ>/
└── logs/
    ├── raven.log.jsonl
    ├── raven.log.jsonl.1
    ├── raven.log.jsonl.2
    └── raven.log.jsonl.3
```

- `todo.sqlite` — ToDo item graph, ToDo events, and namespaced UI preferences.
- `ledger.sqlite` — Ledger master data, entries, transfer operations, and audit events.
- `health.sqlite` — diet, media metadata, health events, tags, and audit events.
- `media/health` — generated Health image files; never SQLite blobs.
- `maintenance` — retention purge settings, last-run state, and run lock; see below.
- `backups/retention` — pre-purge backups written by the retention purge; see below.
- `integrations/google-calendar` — Google Calendar sync settings, OAuth client and token,
  and sync links; see [below](#google-calendar-integration).
- `logs` — best-effort Raven CLI JSONL logs and rotated backups.
- `retry.sqlite` — optional CLI request receipts, created by keyed creation commands.
  Preserve it when resuming requests after a backup restore; removing receipts removes
  protection against replaying a previously committed request.

The databases are intentionally independent. Back up `health.sqlite` and `media/health`
together to preserve diet-image references.

## Maintenance and retention backups

The retention purge (see [Data Model](../architecture/data-model.md#retention-purge)) keeps
its files under the home, which is the directory containing `todo.sqlite`:

- `maintenance/retention.json` — `{"version":1,"enabled":true,"retention_days":30,"backup_keep":3}`.
  A missing file means these defaults; reading never creates it. An unreadable, unknown-version,
  or out-of-range file is a storage error rather than a silent fallback.
- `maintenance/retention-state.json` — the last run summary (run ID, trigger, times, outcome,
  per-domain counts, backup folder name, `media_cleanup_pending`). Counts only, no record data.
- `maintenance/retention.lock` — advisory exclusive lock held for a whole run; a second run
  is skipped as `locked`.
- `backups/retention/<YYYYMMDDTHHMMSSZ>/` — one folder per run that deleted something. It holds
  `<domain>.sqlite` for each affected store (`VACUUM INTO`, verified with `quick_check` and an
  equal `user_version`), `media/` with copies of the Health photos to be deleted, and
  `manifest.json` (versions, counts, and sizes only). The folder is assembled as
  `.tmp-<run_id>` and published by an atomic rename.

Directories are created `0700` and files `0600` on Unix; settings and state are replaced
atomically. Before a backup the run requires free space of at least 1.2 × (affected database
and WAL sizes + photo bytes) + 64 MiB, otherwise it records `insufficient_disk` and deletes
nothing. Runs with nothing due create no backup. After each purge only the newest `backup_keep`
folders whose names match `YYYYMMDDTHHMMSSZ` are kept; other entries are never touched.

Purged records can be recovered only from these folders, so a deletion becomes
unrecoverable after `backup_keep` (default `3`) further backup-producing runs. There is no
restore command: stop Raven processes, then copy the needed database and photos back.

## Google Calendar integration

[Google Calendar sync](../architecture/data-model.md#google-calendar-sync) keeps its files in
`integrations/google-calendar/`. The directory is `0700` and every file `0600` on Unix.
Reading status never creates the directory or any file; each file is written atomically when
first needed.

| File | Contents |
| --- | --- |
| `settings.json` | `{"version":1,"enabled":false,"calendar_id":null,"calendar_summary":null,"time_zone":"Asia/Seoul","poll_interval_secs":120,"default_duration_minutes":60,"sync_note":true,"push_since":null}`. Missing means these defaults. Unknown fields, files over 4 KiB, or out-of-range values (`poll_interval_secs` `60..=3600`, `default_duration_minutes` `1..=1440`) are a storage error |
| `state.json` | `connection` (`disconnected`, `connected`, `reauth_required`), `connected_at`, `first_sync_completed_at`, and the last sync summary (counts and error kind only) |
| `token.json` | `{"version":1,"refresh_token":…,"scopes":[…],"obtained_at":…}`. Raven refuses to read it when it is group- or other-readable. The access token is kept in memory only |
| `oauth-client.json` | `{"installed":{"client_id","client_secret"}}`, copied from the downloaded Google "Desktop app" client JSON by `raven google-calendar client set --file` (other fields are dropped). `RAVEN_GOOGLE_OAUTH_CLIENT_FILE`, when set and non-empty, is read instead |
| `sync.sqlite` | `calendars` (sync token per calendar), `links` (Raven item ↔ Google event, state, etag, base hashes, duration), `pending_inbound` (retry queue). Own `user_version` (1) and migrations; read paths migrate it or tolerate its absence |
| `sync.lock` | Advisory exclusive lock held for a sync pass, shared by `raven ui`, `raven api`, and the CLI |

`token.json` and `oauth-client.json` are secrets. Do not copy them into evidence, logs, or
shared backups. Revoke the grant from the Google account (or run
`raven google-calendar disconnect`) if `token.json` leaks.

`raven google-calendar disconnect` deletes `token.json` and keeps everything else;
`--forget-links` also deletes `sync.sqlite`. Deleting the whole directory resets the
integration to "not configured" without touching ToDo data. Google Calendar sync never
writes outside this directory except through the ToDo service.

## Safety

The live home is canonical. Never aim destructive tests, import trials, schema experiments,
or purge probes at it.

```bash
smoke_home="$(mktemp -d)"
cargo run -p raven-cli -- --home "$smoke_home" init
cargo run -p raven-cli -- --home "$smoke_home" health-check
```

For a copied-data ToDo check, copy the source database into a separate source directory and
import into a different empty Raven home. The importer refuses an existing destination,
opens the source read-only, uses SQLite backup, validates schema and integrity, and publishes
the temporary file without clobbering.

## Backup boundary

Stop Raven processes before a raw file copy, or use SQLite-aware backup tooling. A complete
snapshot contains:

- all three `*.sqlite` files
- `media/health`
- `retry.sqlite` when keyed CLI requests must retain their replay history

Logs, `maintenance/`, `integrations/`, and the npm release cache are operational artifacts,
not canonical records. Retention backups never include `integrations/`, so OAuth tokens and
client secrets are not copied into `backups/retention/`. Restoring `todo.sqlite` from an older
backup while `sync.sqlite` is kept can make sync treat restored or missing events as
changes; disconnect with `--forget-links` first if in doubt. `backups/retention/` holds the only copies of purged records; keep it if you may
need them.
