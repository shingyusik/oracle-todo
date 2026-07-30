# Setup

## Prerequisites

- Node.js 18+ for `npx @shings/raven`
- Rust 2024 toolchain for source builds

SQLite is bundled through `rusqlite`.

## npm release bundle

```bash
npx @shings/raven init
npx @shings/raven health-check
npx @shings/raven ui
```

The wrapper installs the matching native `raven` archive and `raven-ui` archive from the
Raven GitHub Release into `RAVEN_CACHE_DIR` or `~/.local/share/raven`. User data remains
under `RAVEN_HOME`; the release cache is not a data backup.

Wrapper-only commands:

```bash
npx @shings/raven install
npx @shings/raven update
npx @shings/raven version
npx @shings/raven doctor
```

Other arguments are forwarded to the native binary. `ui` installs both artifacts and
delegates to native `raven ui`.

## Source build

```bash
cargo build -p raven-cli
cargo run -p raven-cli -- init
cargo run -p raven-cli -- health-check
```

`init` creates the Raven home, all three databases, and `media/health`. It is idempotent.
`health-check` is read-only and reports each schema version and media-directory readiness;
it fails if any component is missing, corrupt, or unsupported.

## Data home

Resolution order:

1. `--home <path>`
2. `RAVEN_HOME` from the process or `.env`
3. `$HOME/.raven`

```bash
RAVEN_HOME=/path/to/data raven init
raven --home /path/to/data health-check
```

An invalid `.env` aborts instead of falling back. Single-quote values containing
backslashes:

```dotenv
RAVEN_HOME='C:\Users\me\raven-data'
```

See [data-home.md](data-home.md).

## Standalone API

Provide exactly one token source:

```bash
export RAVEN_API_TOKEN='replace-with-at-least-16-visible-ASCII-characters'
raven api
```

or:

```bash
export RAVEN_API_TOKEN_FILE=/path/to/secure-token-file
raven api
```

The token file must satisfy platform permission checks. Default bind is
`127.0.0.1:3002`; configure `RAVEN_API_BIND_HOST` and `RAVEN_API_BIND_PORT` when needed.
Non-loopback cleartext requires the explicit
`RAVEN_API_ALLOW_UNSAFE_CLEARTEXT=true` override.

## Local UI

The release bundle supplies the UI path automatically:

```bash
raven ui
raven ui --no-open
raven ui --port 3202
```

For a source build:

```bash
npm --prefix frontend install
npm --prefix frontend run build
cargo run -p raven-cli -- ui --ui-path frontend/out --no-open
```

`RAVEN_UI_PATH` is the environment alternative to `--ui-path`.

## ToDo import

```bash
raven import todo --source-home ~/.todo-engine
```

Import is a one-time no-clobber copy. It validates a temporary destination before
publishing it and never replaces an existing Raven `todo.sqlite`.

## Verification

Run the full gate in [verification-and-smoke.md](verification-and-smoke.md). Use a temporary
Raven home for all mutation or purge smoke checks.
