# Setup

## Prerequisites

A Rust 2024 toolchain (`cargo`). SQLite is bundled via `rusqlite` — no external SQLite install
is required.

## Build and initialize

```bash
cargo build                 # build the library + binary
cargo run -- init           # create todo.sqlite at the data home
```

`init` creates the data home directory (if needed) and runs `init_schema`, which creates the
`items` and `events` tables. It prints `initialized <path-to-todo.sqlite>`.

## Data home

By default the data home is `~/.hermes/oracle-todo/`. It is resolved (in order) from:

1. the `--home <path>` flag,
2. the `ORACLE_TODO_HOME` environment variable,
3. `$HOME/.hermes/oracle-todo` (errors if `HOME` is unset).

```bash
export ORACLE_TODO_HOME=/path/to/data
cargo run -- init
# or, per-invocation:
cargo run -- --home /path/to/data init
```

The full layout (`todo.sqlite`, `exports/`, `logs/`) and resolution rules are documented in
[data-home.md](data-home.md).

## Verify the install

```bash
cargo run -- health         # prints "ok db=<path> user_version=<n>"
cargo run -- pending        # proposed / approved / active work
cargo run -- today          # today's task view
```

## Next steps

- [cli-reference.md](cli-reference.md) — every subcommand and its flags.
- [api-reference.md](api-reference.md) — the HTTP surface over the same service.
- [verification-and-smoke.md](verification-and-smoke.md) — the build/test gate and the safe
  copied-data smoke procedure.
- `README.md` — quick-usage examples and the canonical data-model reference.
