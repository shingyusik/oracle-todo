# Verification and Smoke

## The verification gate

All three must pass before committing any source change:

```bash
cargo fmt --check
cargo test
cargo clippy --all-targets --all-features -- -D warnings
```

`-D warnings` makes warnings (including unused imports) hard errors. `cargo test` runs all
three test binaries; you can run them individually:

```bash
cargo test --test unit
cargo test --test integration
cargo test --test e2e
```

See [../conventions/testing.md](../conventions/testing.md) for what each layer covers.

## Coverage

Target **≥80% line coverage**. If the tooling is installed, measure with (try in order):

```bash
cargo llvm-cov --summary-only
# or
cargo tarpaulin --out Stdout
```

Do **not** install coverage tooling without approval. If neither tool is available, record
that coverage was not measured rather than installing one.

## Copied-data smoke (never the live home)

Run smoke checks only against a **copy** of the data home — never against the live
`~/.hermes/oracle-todo/todo.sqlite` (see [data-home.md](data-home.md)). With a real legacy
database available:

```bash
tmp_home="$(mktemp -d)"
cp ~/.hermes/oracle-todo/todo.sqlite "$tmp_home/todo.sqlite"
cargo run -p todo-engine -- --home "$tmp_home" migrate-legacy-db
cargo run -p todo-engine -- --home "$tmp_home" pending
cargo run -p todo-engine -- --home "$tmp_home" today
```

Without a legacy database, start from a fresh init in a temp home:

```bash
tmp_home="$(mktemp -d)"
cargo run -p todo-engine -- --home "$tmp_home" init
cargo run -p todo-engine -- --home "$tmp_home" pending
cargo run -p todo-engine -- --home "$tmp_home" today
```

The smoke passes when every command succeeds against the temp home and the live home remains
untouched. `*.sqlite` is gitignored, so a temp copy is never committed.

## Structure checks

After a refactor, confirm: no `todo-engine/src/**/*.rs` is much over ~400 lines and
`docs/{architecture,conventions,operations}` are populated.
