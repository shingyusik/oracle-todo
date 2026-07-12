# Setup

## Prerequisites

Use Node.js 18 or newer for the npm wrapper. Use a Rust 2024 toolchain (`cargo`) when
building from source. SQLite is bundled via `rusqlite` — no external SQLite install is required.

## Run with npx

Use the npm wrapper when you want to run the local engine without installing Rust:

```bash
npx @shings/oracle-todo init
npx @shings/oracle-todo today
npx @shings/oracle-todo pending
```

Run the local UI:

```bash
npx @shings/oracle-todo ui
npx @shings/oracle-todo ui --no-open
```

The `ui` command downloads the matching GitHub Release UI artifact, starts `todo-engine api`
on `127.0.0.1:3002`, serves the UI on `127.0.0.1:3001`, proxies `/todo-engine/*` requests to
the API, and opens the browser by default.

The wrapper downloads a compatible `todo-engine` binary from GitHub Releases and stores it
under `~/.local/share/oracle-todo/`. User data stays in the normal data home:
`~/.todo-engine/` unless `--home` or `TODO_ENGINE_HOME` points elsewhere.

Update the cached binary:

```bash
npx @shings/oracle-todo update
```

## Publish the npm wrapper

The npm wrapper is published from `.github/workflows/npm-publish.yml` with npm Trusted
Publishing. The workflow uses GitHub Actions OIDC, so it does not require an `NPM_TOKEN`
secret.

Configure the trusted publisher on the `@shings/oracle-todo` package in npm:

| Field | Value |
| --- | --- |
| Publisher | GitHub Actions |
| Organization or user | `shingyusik` |
| Repository | `oracle-todo` |
| Workflow filename | `npm-publish.yml` |
| Environment name | leave blank |
| Allowed actions | `npm publish` |

Publish a new wrapper version by bumping `npm/oracle-todo/package.json`, committing it,
and pushing a matching npm tag:

```bash
git tag npm-v<version>
git push origin npm-v<version>
```

## Build and initialize

```bash
cargo build                 # build the library + binary (workspace root)
cargo run -p todo-engine -- init           # create todo.sqlite at the data home
```

`init` creates the data home directory (if needed) and runs `init_schema`, which creates the
`items` and `events` tables. It prints `initialized <path-to-todo.sqlite>`.

## Data home

By default the data home is `~/.todo-engine/`. It is resolved (in order) from:

1. the `--home <path>` flag,
2. an existing `TODO_ENGINE_HOME` process environment variable,
3. `TODO_ENGINE_HOME` loaded from the nearest `.env` file in the current directory or a parent,
4. `$HOME/.todo-engine` (errors if `HOME` is unset).

```bash
export TODO_ENGINE_HOME=/path/to/data
cargo run -p todo-engine -- init
# or:
echo 'TODO_ENGINE_HOME=/path/to/data' > .env
cargo run -p todo-engine -- init
# or, per-invocation:
cargo run -p todo-engine -- --home /path/to/data init
```

The full layout (`todo.sqlite`, `logs/`) and resolution rules are documented in
[data-home.md](data-home.md).

## Verify the install

```bash
cargo run -p todo-engine -- health         # prints "ok db=<path> user_version=<n>"
cargo run -p todo-engine -- pending        # proposed / approved / active work
cargo run -p todo-engine -- today          # today's task view
```

## Next steps

- [cli-reference.md](cli-reference.md) — every subcommand and its flags.
- [api-reference.md](api-reference.md) — the HTTP surface over the same service.
- [verification-and-smoke.md](verification-and-smoke.md) — the build/test gate and the safe
  copied-data smoke procedure.
- `README.md` — quick-usage examples and the canonical data-model reference.
