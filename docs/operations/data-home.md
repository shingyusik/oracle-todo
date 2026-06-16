# Data Home

The **data home** is the directory that holds the canonical SQLite database and the
operational logs. Everything `oracle-todo` persists lives under it.

## Resolution

The data home is resolved by `infrastructure::paths::todo_home`, in this order:

1. `--home <path>` flag.
2. `ORACLE_TODO_HOME` environment variable.
3. `$HOME/.hermes/oracle-todo` (the default; errors if `HOME` is unset).

```bash
export ORACLE_TODO_HOME=/path/to/data
cargo run -- --home /path/to/data init   # flag wins over the env var
```

## Layout

```text
<data-home>/
├── todo.sqlite                 # canonical store (items + events tables)
└── logs/                       # operational JSONL log + rotated backups
    ├── oracle-todo.jsonl
    ├── oracle-todo.jsonl.1
    ├── oracle-todo.jsonl.2
    └── oracle-todo.jsonl.3
```

- `todo.sqlite` — the source of truth (`paths::db_path`). See
  [../architecture/decisions/adr-0001-sqlite-source-of-truth.md](../architecture/decisions/adr-0001-sqlite-source-of-truth.md).
- `logs/` — the operational log and its rotated backups. See
  [logging-and-rotation.md](logging-and-rotation.md).

## Safety rule: never target the live home

The live data home (`~/.hermes/oracle-todo/`) is canonical. **Never aim destructive
experiments at `~/.hermes/oracle-todo/todo.sqlite` without explicit approval.** For any smoke
test or migration trial, copy the database into a fresh temporary home and operate there:

```bash
tmp_home="$(mktemp -d)"
cp ~/.hermes/oracle-todo/todo.sqlite "$tmp_home/todo.sqlite"
cargo run -- --home "$tmp_home" pending
```

`*.sqlite` is gitignored, so a temp copy never gets committed. The full safe procedure is in
[verification-and-smoke.md](verification-and-smoke.md).
