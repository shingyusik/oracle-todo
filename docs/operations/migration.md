# Migration

Schema upgrades happen through **additive schema initialization**, which runs on every
connection.

## Additive schema initialization (`init_schema`)

`init_schema` runs whenever the engine opens the database (via `init`, the CLI service
factory, and the API service factory). It is **additive and idempotent** — verified against
`infrastructure/sqlite/schema.rs`:

- `CREATE TABLE IF NOT EXISTS items (...)` and `CREATE TABLE IF NOT EXISTS events (...)` —
  never drops or rewrites existing tables.
- `ensure_item_columns` reads `PRAGMA table_info(items)` and `ALTER TABLE items ADD COLUMN`
  for any column from the canonical set that an older database is missing (e.g. `note`,
  `materialization_policy`, `occurrence_key`, `last_materialized_at`, and the rest of the
  current column set). Existing columns are left untouched.
- Indexes are created with `IF NOT EXISTS`, including a unique index on
  `(routine_id, occurrence_key)` (where both are non-null) that guards routine occurrence
  de-duplication.
- `PRAGMA user_version = 1` marks the schema baseline (reported by `health`).
- The whole thing runs in a transaction; on error it rolls back.

**Consequence:** an older `items` table is upgraded in place on the next open — you do not
need a separate "create then migrate" step for schema. Do not drop or rewrite existing
columns; only add.

## Rebrand migration (oracle → todo-engine)

Earlier versions stored data under `~/.hermes/oracle-todo/` and used the actor value
`oracle`. The current version uses `~/.todo-engine/` and the actor value `agent`.
Existing data is not migrated automatically.

> **Order matters:** run the SQL rewrite (step 2) *before* opening the database with this
> version of the engine. The engine no longer accepts the `oracle` actor value and errors
> (`unknown actor: oracle`) on any row still holding it. The `mv` and `UPDATE` below operate
> on files/SQLite directly, so do them first.

To migrate once:

1. Move the data home:

   ```bash
   mv ~/.hermes/oracle-todo ~/.todo-engine
   ```

2. Rewrite the actor values in the database:

   ```sql
   UPDATE items  SET proposed_by = 'agent' WHERE proposed_by = 'oracle';
   UPDATE items  SET approved_by = 'agent' WHERE approved_by = 'oracle';
   UPDATE events SET actor       = 'agent' WHERE actor       = 'oracle';
   ```

3. Update any scripts that referenced the old `~/.hermes/oracle-todo` path or the
   `oracle` actor value.
