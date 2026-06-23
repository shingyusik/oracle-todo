# Data Home

The **data home** is the directory that holds the canonical SQLite database and the
operational logs. Everything `todo-engine` persists lives under it.

## Resolution

The data home is resolved by `infrastructure::paths::todo_home`, in this order:

1. `--home <path>` flag.
2. Existing `TODO_ENGINE_HOME` process environment variable.
3. `TODO_ENGINE_HOME` loaded from the nearest `.env` file in the current directory or a parent.
4. `$HOME/.todo-engine` (the default; errors if `HOME` is unset).

```bash
export TODO_ENGINE_HOME=/path/to/data
cargo run -p todo-engine -- --home /path/to/data init   # flag wins over the env var

echo 'TODO_ENGINE_HOME=/path/to/data' > .env
cargo run -p todo-engine -- init
```

## Layout

```text
<data-home>/
├── todo.sqlite                 # canonical store (items + events tables)
└── logs/                       # structured JSONL tracing log + rotated backups
    ├── todo-engine.log.jsonl
    ├── todo-engine.log.jsonl.1
    ├── todo-engine.log.jsonl.2
    └── todo-engine.log.jsonl.3
```

- `todo.sqlite` — the source of truth (`paths::db_path`). See
  [../architecture/decisions/adr-0001-sqlite-source-of-truth.md](../architecture/decisions/adr-0001-sqlite-source-of-truth.md).
- `logs/` — structured tracing logs and rotated backups. See
  [logging-and-rotation.md](logging-and-rotation.md).

## Safety rule: never target the live home

The live data home (`~/.todo-engine/`) is canonical. **Never aim destructive
experiments at `~/.todo-engine/todo.sqlite` without explicit approval.** For any smoke
test or migration trial, copy the database into a fresh temporary home and operate there:

```bash
tmp_home="$(mktemp -d)"
cp ~/.todo-engine/todo.sqlite "$tmp_home/todo.sqlite"
cargo run -p todo-engine -- --home "$tmp_home" pending
```

`*.sqlite` is gitignored, so a temp copy never gets committed. The full safe procedure is in
[verification-and-smoke.md](verification-and-smoke.md).
