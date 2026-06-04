# Rust refactor guardrails

## Current rule

The existing Python engine remains the operational ToDo engine until the Rust engine reaches functional parity and is explicitly cut over.

Operational path during refactor:

```bash
cd /Users/singyusig/Desktop/02_Coding/oracle-todo
unset ORACLE_TODO_HOME
uv run oracle-todo ...
```

Preserved legacy copy:

```text
/Users/singyusig/Desktop/02_Coding/oracle-todo-python-legacy
```

Refactor worktree:

```text
/Users/singyusig/Desktop/02_Coding/oracle-todo-rust-refactor
branch: refactor/rust-sqlite
```

Canonical live data remains:

```text
~/.hermes/oracle-todo/todo.sqlite
```

Do not point Rust smoke tests at the live data path unless intentionally testing read-only compatibility or performing an approved cutover step.

## Target shape

- Language: Rust.
- Storage: SQLite.
- Default interface: terminal CLI input.
- Later interface: API layer over the same policy/service path.
- Existing policy requirements remain:
  - SQLite is canonical.
  - Service layer enforces all mutations.
  - User approval gates Oracle-created work.
  - Every state change emits an audit event.
  - Second_Brain remains read-only reference input.

## Refactor sequence

1. Define Rust schema and migration strategy against temporary data homes.
2. Recreate existing domain model and policy transitions.
3. Recreate CLI flows with compatibility tests for current commands.
4. Recreate export generation.
5. Add API after CLI/service parity.
6. Run side-by-side verification against copied live data.
7. Cut over only after explicit approval.

## Rust parity verification

```bash
cargo fmt --check
cargo test
cargo clippy --all-targets --all-features -- -D warnings
uv run pytest -q
cargo llvm-cov --summary-only
```

Rust line coverage must remain at or above 80%.

## Copied-data smoke

Run copied-data smoke tests only against an explicitly copied data home:

```bash
tmp_home="$(mktemp -d)"
mkdir -p "$tmp_home"
cp ~/.hermes/oracle-todo/todo.sqlite "$tmp_home/todo.sqlite"
cargo run -- --home "$tmp_home" pending
cargo run -- --home "$tmp_home" today
cargo run -- --home "$tmp_home" export
```

The smoke gate passes when these commands exit without enum storage errors and without mutating the live data home.

## Round-trip smoke

Temporary data homes must pass both directions:

- Python-created SQLite data is readable by Rust CLI.
- Rust-created SQLite data is readable by Python CLI.

Covered by:

```bash
cargo test --test python_rust_roundtrip
```

## Cutover gate

Cutover requires:

- `cargo fmt --check`
- `cargo test`
- `cargo clippy --all-targets --all-features -- -D warnings`
- `uv run pytest -q`
- `cargo llvm-cov --summary-only`
- copied-data smoke for `pending`, `today`, and `export`
- Python/Rust round-trip smoke
- explicit cutover approval
