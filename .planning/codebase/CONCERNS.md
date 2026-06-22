# Codebase Concerns

**Analysis Date:** 2026-06-22

## Tech Debt

**In-memory list filtering instead of SQL WHERE clauses:**
- Issue: `list_items` selects every row in the `items` table (`SELECT ... ORDER BY created_at, id` with no predicate) and `apply_list_filter` filters in Rust. All `ListFilter` criteria (status, type, area_id, project_id, routine_id, free-text `query`, archived) are applied after the full table is materialized into a `Vec<TodoItem>`.
- Files: `todo-engine/src/infrastructure/sqlite/repo.rs:29` (`list_items`), `todo-engine/src/application/ports.rs:29` (`apply_list_filter`)
- Impact: O(table size) memory and CPU per list/query call regardless of how selective the filter is. Indexes (`idx_items_status`, `idx_items_type`, `idx_items_area_id`, etc.) defined in `schema.rs:74` are never used because no query references them.
- Fix approach: Push `ListFilter` into the SQL `WHERE` clause (parameterized) so existing indexes are exercised; keep `apply_list_filter` only for the free-text `query` portion if SQL `LIKE` is undesirable, or move that to `LIKE` as well.

**Materialization fans out repeated full-table scans:**
- Issue: `materialize_routines` calls `list_items` once per routine via `open_generated_task_exists_for_routine`, `generated_task_exists_for_occurrence`, and `generated_tasks_for_routine` — each of which is a full-table load + in-memory filter (see tech debt item above). For N routines this is multiple full scans per routine.
- Files: `todo-engine/src/application/service/materialization.rs:35`, `:53`, `:118`, `:130`, `:141`
- Impact: Materialization cost grows quadratically with table size as routine count and item count increase.
- Fix approach: Once SQL-side filtering lands, these existence checks become indexed point lookups (the `idx_items_routine_occurrence` unique index already exists for the occurrence case).

**Schema initialization runs on every API request:**
- Issue: `service()` opens a fresh connection and calls `init_schema(&conn)` for every HTTP request before constructing `TodoService`. `init_schema` runs the full `CREATE TABLE IF NOT EXISTS` / `ensure_item_columns` / `CREATE INDEX` batch each time.
- Files: `todo-engine/src/interfaces/api/mod.rs:52` (`service`), `:60-61`
- Impact: Per-request DDL overhead (`PRAGMA table_info`, conditional `ALTER`, index creation) and an extra connection open/close on the hot path.
- Fix approach: Run schema init once at router construction (`router`), then have `service()` only open a connection (or reuse a pooled one).

## Known Bugs

**No confirmed bugs found.** No `TODO`/`FIXME`/`HACK`/`unimplemented!`/`todo!`/`panic!` markers exist in `todo-engine/src` (the only `TODO` text matches are the project name). The `.expect(...)` calls present are all on documented invariants (validated dates, infallible serialization, pre-checked `Option`s):
- `todo-engine/src/domain/recurrence.rs:294,307,311`
- `todo-engine/src/application/service/mod.rs:126`
- `todo-engine/src/application/service/transitions.rs:290,294`

## Security Considerations

**Local-first, no network auth surface (by design):**
- Risk: The HTTP API (`axum` router in `todo-engine/src/interfaces/api/mod.rs`) has no authentication/authorization layer. Anyone who can reach the bound port can mutate the DB, including approving agent-proposed items (the core approval gate).
- Files: `todo-engine/src/interfaces/api/mod.rs:28` (`router`), `handlers.rs`
- Current mitigation: Local-first design; the engine is intended to bind locally and the OS user owns the data home. SQL is fully parameterized (`params![...]` / `?N` placeholders) in `repo.rs` and `sqlite/mod.rs`, so injection is not a vector.
- Recommendations: If the API is ever exposed beyond loopback, add an auth token / bind-address guard. Document the loopback-only assumption explicitly near `router`.

**Actor self-attribution on the API approval gate:**
- Risk: `parse_actor_or_default` lets the caller declare its own `Actor` (defaulting to `Agent`). The approval gate's integrity depends on callers not falsely claiming `Actor::User`. There is no server-side trust boundary distinguishing a real user from an agent.
- Files: `todo-engine/src/interfaces/api/mod.rs:103` (`parse_actor_or_default`)
- Current mitigation: CLI vs API separation; policy enforced in `TodoService`. The threat is only meaningful if an untrusted agent can call the API directly.
- Recommendations: Tie actor identity to a transport-level signal (separate endpoint/token for user vs agent) rather than a request-supplied field if approval integrity must hold against a hostile agent.

## Performance Bottlenecks

**SQLite concurrency: no `busy_timeout` and no WAL mode:**
- Problem: `connect()` opens a plain `Connection::open(path)` with no `PRAGMA busy_timeout` and no `PRAGMA journal_mode = WAL`. The API opens a new connection per request and serializes writes through transactions, but concurrent requests against the same file-backed DB can hit immediate `SQLITE_BUSY` errors (surfaced as `TodoError::Storage` → HTTP 500).
- Files: `todo-engine/src/infrastructure/sqlite/mod.rs:13` (`connect`)
- Cause: Default SQLite locking with no retry window; multiple connections (one per in-flight request) compete for the write lock.
- Improvement path: Set `PRAGMA busy_timeout` and consider `journal_mode = WAL` in `connect()` to allow concurrent readers and a retry window for writers.

**Per-request connection churn in the API:**
- Problem: Every request opens and tears down a SQLite connection (`service()` → `connect()` → `init_schema()`), rather than reusing a connection or pool.
- Files: `todo-engine/src/interfaces/api/mod.rs:52-63`
- Cause: `ApiState` carries only `db_path` (plus a `keeper` used solely to keep an in-memory `:memory:` DB alive for tests, which `service()` ignores via `let _keeper = ...`).
- Improvement path: Introduce a connection pool (e.g. shared `Arc<Mutex<Connection>>` for the file-backed path, mirroring the `keeper` pattern already used for `:memory:`), and move schema init out of the request path.

## Fragile Areas

**API `keeper` field is wired but unused on the file path:**
- Files: `todo-engine/src/interfaces/api/mod.rs:25` (`ApiState.keeper`), `:53` (`let _keeper = &state.keeper;`)
- Why fragile: `keeper` exists only to keep a shared-cache `:memory:` DB alive for tests; `service()` explicitly discards it and re-opens from `db_path`. A future change that assumes `keeper` is the live connection (or that file and memory paths behave the same) will silently diverge between test and production behavior.
- Safe modification: When refactoring connection handling, unify the file and `:memory:` paths so the same connection-acquisition logic is exercised by tests and production.
- Test coverage: e2e API tests (`todo-engine/tests/e2e/api.rs`, 624 lines) run against the `:memory:` keeper path, which is NOT the production code path through `connect()` per request. Concurrency and per-request schema-init behavior on the file path is not exercised.

**Additive-only schema migration with no version branching:**
- Files: `todo-engine/src/infrastructure/sqlite/schema.rs:124` (`ensure_item_columns`), `:93` (`ITEM_COLUMN_ADDITIONS`)
- Why fragile: Migration is intentionally additive (add missing columns, never drop/rewrite — see CLAUDE.md). `user_version` is set to `1` unconditionally (`schema.rs:86`) and never read to branch behavior. Any future change requiring a column rename, type change, or data backfill has no migration mechanism and would have to be bolted on.
- Safe modification: Keep additions in `ITEM_COLUMN_ADDITIONS`. For anything non-additive, introduce a real versioned migration step keyed off `user_version` (already exposed via `user_version()`).
- Test coverage: `todo-engine/tests/integration/repository.rs` (403 lines) covers schema/repo behavior; confirm it includes an "old table missing columns" backfill case before relying on `ensure_item_columns`.

## Scaling Limits

**Single-file SQLite, full-table reads:**
- Current capacity: Comfortable for a personal/local workload (the intended use). Each list/query/materialization pass loads the entire `items` table into memory.
- Limit: Performance degrades linearly (materialization quadratically) as the `items` table grows into tens of thousands of rows, because no query is index-backed (see Tech Debt).
- Scaling path: SQL-side filtering + connection reuse (both covered above). The data model and indexes are already in place to support this.

## Dependencies at Risk

**No dependencies flagged.** Stack is mainstream and actively maintained (`rusqlite`, `axum`, `clap`, `serde`, `time`, `uuid`, `thiserror`, `anyhow`). No vendored or abandoned crates observed in `todo-engine/src`. Run `cargo audit` periodically as the only standing recommendation.

## Missing Critical Features

**No retry/backoff for transient SQLite contention:**
- Problem: Storage errors (including `SQLITE_BUSY`) map straight to `TodoError::Storage` → CLI exit `1` / HTTP `500` with no retry.
- Files: `todo-engine/src/application/error.rs:13`, `todo-engine/src/infrastructure/sqlite/mapping.rs` (`storage_error`)
- Blocks: Reliable concurrent API usage. Pairs with the missing `busy_timeout` concern above.

## Test Coverage Gaps

**Production API connection path (file-backed) is not exercised:**
- What's not tested: e2e API tests use the `:memory:` shared-cache `keeper`, but `service()` re-opens from `db_path` and re-runs `init_schema` per request for file-backed DBs. Per-request schema-init cost and concurrent-write contention on a real file are untested.
- Files: `todo-engine/tests/e2e/api.rs`, `todo-engine/src/interfaces/api/mod.rs:52-85`
- Risk: Concurrency/`SQLITE_BUSY` regressions and file-path-specific bugs ship unnoticed.
- Priority: Medium

**Concurrency / parallel-request behavior:**
- What's not tested: No test issues concurrent mutating requests against the same DB to assert lock/serialization behavior.
- Files: `todo-engine/tests/e2e/api.rs`
- Risk: Lock contention surfaces only in production.
- Priority: Medium

**Otherwise strong coverage:** Three test binaries (`unit`, `integration`, `e2e`, ~3000 lines total) including an architecture-boundary test (`tests/unit/architecture.rs`), error mapping (`tests/unit/error_mapping.rs`), recurrence/materialization (`tests/integration/materialization.rs`, 447 lines), and CLI/API parity e2e suites. Coverage breadth is good; the gaps above are specifically around the file-backed concurrent runtime path.

---

*Concerns audit: 2026-06-22*
