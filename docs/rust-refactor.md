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
uv run pytest
```

Run copied-data smoke tests only against an explicitly copied data home.
