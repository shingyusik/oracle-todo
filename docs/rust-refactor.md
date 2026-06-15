# Rust engine guardrails

## Current rule

Work only in the Rust workspace:

```text
/Users/singyusig/Desktop/02_Coding/oracle-todo-rust-refactor
branch: refactor/rust-sqlite
```

Canonical data home:

```text
~/.hermes/oracle-todo/todo.sqlite
```

Do not point destructive experiments at the live data path without explicit approval.
Use a copied data home for smoke checks.

## Engine shape

- Language: Rust
- Storage: SQLite
- Default interface: terminal CLI
- Secondary interface: HTTP API over the same service layer
- Policy requirements:
  - SQLite is canonical.
  - Service layer enforces all mutations.
  - User approval gates Oracle-created work.
  - Every state change emits an audit event.
  - Second_Brain remains read-only reference input.

## Verification gate

```bash
cargo fmt --check
cargo test
cargo clippy --all-targets --all-features -- -D warnings
```

Rust line coverage should remain at or above 80%.

## Copied-data smoke

```bash
tmp_home="$(mktemp -d)"
cp ~/.hermes/oracle-todo/todo.sqlite "$tmp_home/todo.sqlite"
cargo run -- --home "$tmp_home" migrate-legacy-db
cargo run -- --home "$tmp_home" pending
cargo run -- --home "$tmp_home" today
cargo run -- --home "$tmp_home" export
```

Smoke passes when these commands succeed against the copied home and the live home remains untouched.
