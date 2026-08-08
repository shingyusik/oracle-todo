# Raven

Raven is a local-first personal engine for planning, finance, and health records. One
structured CLI, one authenticated HTTP API, and one UI expose three policy-enforced Rust
engines:

```text
raven todo ...
raven ledger ...
raven health ...
raven ui
```

Each engine owns its service policy, SQLite database, and audit history. CLI and HTTP
adapters call those services; they do not write domain tables directly.

## Core model

- **ToDo** — areas, projects, goals, routines, tasks, events, recurrence, lifecycle
  transitions, and immutable audit events.
- **Ledger** — currencies, account categories, accounts, transaction categories, entries,
  atomic transfers, balances, reports, briefing, diagnostics, and deterministic export.
- **Health Journal** — diet and images, bowel and medication events, health metrics, daily
  metric upsert, a combined timeline, and bounded trends.
- **Dashboard** — a read-only ToDo analytics screen for today's work, completion history,
  Area status, and Project status.

Ledger and Health Journal do not repeat an Overview page. Their operational tabs remain
available in the main navigation:

- Ledger: Transactions, Accounts, Categories, Reports
- Health Journal: Timeline, Diet, Bowel, Medication, Health Metrics, Trends

## Stack

- Rust 2024, `clap`, `axum`, `rusqlite`
- Next.js 14 and React 18, exported as a static UI artifact
- Node.js 18+ npm launcher package `@shings/raven`

## Current status

The workspace builds one native executable, `raven`. The engine crates remain reusable
libraries:

```text
raven-cli
├── todo-engine
├── ledger-engine
├── health-engine
└── raven-api
```

`frontend/` is the single Raven UI. `backend/` supplies the preference adapter
used by the composed API.

## Setup

Run the release bundle without a Rust toolchain:

```bash
npx @shings/raven init
npx @shings/raven health-check
npx @shings/raven ui
```

Build from source:

```bash
cargo build -p raven-cli
cargo run -p raven-cli -- init
cargo run -p raven-cli -- health-check
```

The data home resolves from `--home`, then `RAVEN_HOME`, then `$HOME/.raven`:

```text
~/.raven/
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

Override it for one command or a shell:

```bash
raven --home /path/to/raven-data init
export RAVEN_HOME=/path/to/raven-data
```

`RAVEN_HOME` may also be stored in `.env`. Single-quote Windows paths containing
backslashes:

```dotenv
RAVEN_HOME='C:\Users\me\raven-data'
```

## Quick usage

ToDo commands are namespaced below `raven todo`:

```bash
raven todo area create "Finance"
raven todo project propose "Monthly close" \
  --area "Finance" \
  --definition-of-done "Statements reconciled"
raven todo task propose "Reconcile card statement" --area "Finance" --scheduled today
raven todo pending
```

Ledger mutations use typed flags or strict JSON. Create required master data first; names or
IDs resolve through the service layer:

```bash
raven ledger currency create --code KRW --name "Korean Won" --symbol ₩ --decimal-places 0
raven ledger account-category create --name Cash
raven ledger account create --name Wallet --category Cash --currency KRW --opening-balance 0
raven ledger category create --name Food --kind expense
raven ledger entry add \
  --date 2026-07-31 --content Lunch --category Food --account Wallet \
  --type expense --amount 12000 --currency KRW
raven ledger reports --from 2026-07-01 --to 2026-07-31
```

Health Journal records use RFC 3339 timestamps:

```bash
raven health diet add \
  --at 2026-07-31T12:00:00+09:00 --meal lunch --food "Rice bowl" --tags rice,vegetables
raven health bowel add \
  --at 2026-07-31T13:00:00+09:00 --bristol 4
raven health metric add \
  --at 2026-07-31T07:00:00+09:00 --category weight \
  --key body_weight --name Weight --value 70.2 --unit kg
raven health timeline
```

Run `raven <domain> <command> --help` for authoritative field flags and
[the CLI reference](docs/operations/cli-reference.md) for command groups.

## Domain model

### ToDo

ToDo stores an item graph in `todo.sqlite`:

- `area` — long-lived responsibility domain.
- `project` — finite outcome; creation requires `definition_of_done`.
- `goal` — year, month, or week goal anchored to the canonical period start.
- `routine` — recurring task template; creation requires an RRULE.
- `task` — concrete action, optionally linked to an area, project, or routine.
- `event` — external commitment with a required schedule.

Creation is direct-active. Normal mutations pass through `TodoService`, and each mutation
writes a `TodoEvent` with before/after snapshots. ToDo has status transitions rather than a
physical purge operation.

### Ledger

Ledger stores money as integer minor units. An entry has a date, written timestamp, content,
account, currency, entry type, positive amount, optional transaction category, source,
notes, and lifecycle timestamps. Entry types are `expense`, `income`, `transfer_out`,
`transfer_in`, `adjustment_out`, and `adjustment_in`.

Transfers are created only by the transfer service as one idempotent operation. The paired
rows share a transfer-group ID and commit atomically. Current balances are derived from
opening balances and non-archived entries.

### Health Journal

Diet records contain an occurrence timestamp, meal type, food name, normalized tags,
optional note, and optional image. Meal types are `breakfast`, `lunch`, `dinner`, `snack`,
and `late_night`. Accepted images are JPEG, PNG, or WebP and are limited to 10 MiB.

Health events cover weight, bowel, sleep, lab, symptom, and medication categories. Numeric
metrics use stable keys; daily upsert gives one active value per local day, category, and
metric key. Timeline and trend reads combine records without mutating them.

More detail is in [the data-model reference](docs/architecture/data-model.md).

## Lifecycle and deletion

- **ToDo:** lifecycle status is canonical. Terminal items remain auditable; there is no
  hard-delete command.
- **Ledger entries and Health records:** archive sets `deleted_at`; restore clears it.
  Normal lists omit archived rows. Ledger master data uses an `active` flag instead.
- **CLI purge:** Ledger and Health CLI commands print a preview first and require its exact
  confirmation ID on the second invocation.
- **API purge:** Ledger exposes preview routes before confirmed deletion. Health has no
  preview route; its `DELETE` body confirms the record ID directly. Audit events remain.
- **Health media:** image metadata and files follow the owning diet record lifecycle.
  Cleanup failures are surfaced; committed mutations are never reported as rolled back.

## API and UI

`raven api` serves the composed API on `127.0.0.1:3002` by default. It requires exactly one
bearer-token source:

```bash
export RAVEN_API_TOKEN='replace-with-at-least-16-visible-ASCII-characters'
raven api
curl -H "Authorization: Bearer $RAVEN_API_TOKEN" \
  http://127.0.0.1:3002/api/v1/dashboard
```

`RAVEN_API_TOKEN_FILE` is the file-based alternative. `RAVEN_API_BIND_HOST` and
`RAVEN_API_BIND_PORT` set the listener. Non-loopback cleartext binding is rejected unless
`RAVEN_API_ALLOW_UNSAFE_CLEARTEXT=true` is set exactly.

`raven todo api` is rejected. ToDo HTTP access is supported only through authenticated
`raven api` or `raven ui` at `/api/v1/todo`.

`raven ui` serves the static UI and API from one loopback origin. It generates a fresh
per-launch session, opens `/__raven/session`, sets an HTTP-only `SameSite=Strict` cookie,
and redirects to the UI. Use `--no-open`, `--port`, or `--ui-path` as needed. `RAVEN_UI_PATH`
is the environment alternative to `--ui-path`.

Cloudflare Access can expose the same loopback-bound server through an authenticated tunnel:

```bash
RAVEN_UI_PUBLIC_ORIGIN=https://raven.b-sir.xyz \
  raven ui --port 3001 --no-open
```

Local UI behavior is unchanged. Public requests use the configured HTTPS Host and Origin and
require the Access assertion verified and forwarded by `cloudflared`. Successful public HTML
responses issue a `Secure`, HTTP-only Raven session cookie; `/api/v1/*` routes still require
that cookie. API tokens, Access assertions, and Raven session cookies must not be logged.

Only exact `/healthz` is unauthenticated. API errors use a stable
`{code,message,fields,request_id}` object and do not expose storage details.

## Import

Import an existing ToDo data home once:

```bash
raven import todo --source-home ~/.todo-engine
```

The importer opens the source read-only, copies through SQLite backup into a temporary file,
checks schema support and `PRAGMA integrity_check`, normalizes WAL state, and publishes with
no-clobber semantics. It refuses to overwrite an existing Raven `todo.sqlite` and removes
only import-owned temporary files on failure.

## Logging and errors

Raven keeps user results on stdout, diagnostics on stderr, and structured JSONL logs under
`logs/`. Configure:

| Variable | Default |
| --- | --- |
| `RAVEN_CONSOLE_LOG` | `info` |
| `RAVEN_FILE_LOG` | `debug` |
| `RAVEN_LOG_MAX_BYTES` | `1048576` |
| `RAVEN_LOG_MAX_FILES` | `3` |

CLI validation/conflict/confirmation failures exit `2`, missing records exit `4`, and
storage/migration/internal failures exit `1`. Success exits `0`.

## Verification

```bash
cargo fmt --check
cargo test --workspace
cargo clippy --all-targets --all-features -- -D warnings
npm --prefix frontend test
npm --prefix frontend run typecheck
npm --prefix frontend run build
npm --prefix npm/raven test
cargo build --release -p raven-cli
```

Always use `--home "$(mktemp -d)"` for destructive smoke checks. Never target live Raven or
source ToDo data.

## Documentation

- [Architecture overview](docs/architecture/overview.md)
- [Layer boundaries](docs/architecture/layers.md)
- [Data model](docs/architecture/data-model.md)
- [Setup](docs/operations/setup.md)
- [Data-home safety](docs/operations/data-home.md)
- [CLI reference](docs/operations/cli-reference.md)
- [API reference](docs/operations/api-reference.md)
- [Verification and smoke](docs/operations/verification-and-smoke.md)
- [Logging and rotation](docs/operations/logging-and-rotation.md)
