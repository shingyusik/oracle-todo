# Data Home

The Raven home contains all canonical domain stores, Health media, and operational logs.

## Resolution

`RavenPaths` resolves:

1. global `--home <path>`
2. `RAVEN_HOME` from the process or `.env`
3. `$HOME/.raven`

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
- `logs` — best-effort Raven CLI JSONL logs and rotated backups.

The databases are intentionally independent. Back up `health.sqlite` and `media/health`
together to preserve diet-image references.

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

Logs and the npm release cache are operational artifacts, not canonical records.
