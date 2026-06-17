# Codebase Concerns

**Analysis Date:** 2026-06-17

## Tech Debt

**Unchecked serialization panics in event creation:**
- Issue: `serde_json::to_value(&item).expect("TodoItem serialization cannot fail")` at line 126 of `todo-engine/src/application/service/mod.rs` will panic if serialization fails. This is treated as a never-fail assertion, but it's not guaranteed.
- Files: `todo-engine/src/application/service/mod.rs` (line 126)
- Impact: Process crash if a TodoItem becomes unserializable (e.g., metadata contains values that cannot be serialized to JSON). This blocks event audit logging for that mutation.
- Fix approach: Replace `.expect()` with proper error handling using `map_err()`, converting serialization failures to `TodoError::Internal`. Propagate the error up the call stack.

**Concurrent API requests share single SQLite connection per route:**
- Issue: Each API handler creates a fresh `TodoService` and opens a new `rusqlite::Connection` in `with_service()` at `todo-engine/src/interfaces/api/mod.rs` line 87-92. SQLite allows concurrent reads but only one writer at a time; if two handlers mutate simultaneously, one will block or conflict.
- Files: `todo-engine/src/interfaces/api/mod.rs` (lines 52-93)
- Impact: Race conditions during concurrent mutations (e.g., two parallel approve + activate calls on the same item may partially succeed or leave the item in an inconsistent state). No transaction-level isolation across requests.
- Fix approach: Implement a connection pool (e.g., `rusqlite::Connection` managed by `Arc<Mutex<>>` at router creation time), or switch to a higher-level async database layer that handles queuing. Ensure single-writer-at-a-time discipline with explicit transaction management across request boundaries.

**Serialization assumes TodoItem structure never changes:**
- Issue: The `expect("TodoItem serialization cannot fail")` comment assumes the struct will always be JSON-serializable. If future code adds non-serializable fields (e.g., `Rc<T>`, `Arc<Mutex<T>>`), serialization will fail silently or panic.
- Files: `todo-engine/src/application/service/mod.rs` (line 126), `todo-engine/src/application/service/transitions.rs` (multiple uses of `serde_json::to_value()`), `todo-engine/src/application/service/materialization.rs` (line 100), `todo-engine/src/application/service/update.rs` (line 34)
- Impact: Audit trail becomes incomplete for items that fail to serialize; mutation may succeed in the database but fail to log the event.
- Fix approach: Add unit tests that verify all TodoItem variants serialize without error. Use `#[serde(skip)]` or proper serialization traits for non-standard fields. Replace `.expect()` with error propagation.

## Known Bugs

**API memory router does not isolate requests:**
- Symptoms: Multiple HTTP requests to a memory-backed router (`:memory:` SQLite) share the same in-memory state across disconnected router instances.
- Files: `todo-engine/src/interfaces/api/mod.rs` (lines 69-84), `todo-engine/tests/e2e/api.rs` (lines 107-136 test memory state persistence)
- Trigger: Create two separate `router(":memory:")` instances and make mutations in both. The second router will inherit state from the first if they share the same URI.
- Workaround: Each memory router should use a unique URI (currently done via `uuid::Uuid::new_v4()` at line 74), but test isolation is fragile; tests run in parallel and may reuse the same URI by collision (low probability but possible).
- Root cause: SQLite's shared in-memory cache at URI level; colliding UUIDs would cause data leaks between test instances.

**Routine materialization not idempotent under concurrent calls:**
- Symptoms: If `materialize_routines()` is called twice in parallel (e.g., two API requests call it simultaneously), the uniqueness check at `todo-engine/src/application/service/materialization.rs` lines 35-41 may race: both threads check if an open task exists, both see "no," and both create a task.
- Files: `todo-engine/src/application/service/materialization.rs` (lines 9-71), specifically lines 35-41 and 54-57
- Trigger: Concurrent calls to `/today` endpoint (which materializes routines) or to a custom `materialize_routines` endpoint.
- Workaround: Serialize all materialization calls through a single-threaded runner, or add database-level unique constraints on (routine_id, occurrence_key) pairs (partially in place at line 79-81 of `schema.rs`, but not enforced before insertion in memory).
- Root cause: TOCTOU (time-of-check-time-of-use) race in the in-memory check; SQLite's unique index only prevents insert, not the race in application logic.

## Security Considerations

**No input validation on title or description fields:**
- Risk: User-provided strings (`title`, `description`, `note`) are directly inserted into JSON audit events and SQLite without length limits or content validation. XSS risk in API responses if consumed by web frontend without escaping.
- Files: `todo-engine/src/application/service/creation.rs` (all creation methods), `todo-engine/src/interfaces/api/handlers.rs` (all propose/create handlers)
- Current mitigation: Audit events are stored as plain JSON; responses are served as JSON (not HTML), so XSS is limited to JSON consumers. No SQL injection risk (parameterized queries used throughout).
- Recommendations: Add field length limits (e.g., title ≤ 256 chars, description ≤ 4096 chars) in `TodoService` creation methods. Reject or truncate oversized input with `Validation` errors. Add unit tests for boundary cases.

**second_brain_refs marked read-only in spec but not enforced in code:**
- Risk: The CLAUDE.md spec states `second_brain_refs` are "read-only" and "never written back," but there is no runtime enforcement. If API code or CLI accidentally writes to `second_brain_refs`, the invariant is silently broken.
- Files: `todo-engine/src/domain/model.rs` (line 61), `todo-engine/src/infrastructure/sqlite/mapping.rs` (line 77), `todo-engine/src/infrastructure/sqlite/repo.rs` (lines 134, 164), `todo-engine/src/infrastructure/sqlite/schema.rs` (lines 49, 120)
- Current mitigation: No write code paths exist in current codebase; audit events capture `after` state which includes `second_brain_refs`, but no mutation code modifies it.
- Recommendations: Add a compile-time or runtime guard (e.g., a service method that validates `second_brain_refs` is unchanged between creation and mutation). Document the invariant in code comments. Add integration test that attempts write and confirms rejection.

**API error responses expose internal error types:**
- Risk: `TodoError` variants (Policy, Storage, Migration, Internal) are serialized directly to HTTP JSON responses (line 145 of `todo-engine/src/interfaces/api/mod.rs`). Internal errors may leak implementation details (e.g., database path, connection string fragments).
- Files: `todo-engine/src/interfaces/api/mod.rs` (lines 125-147)
- Current mitigation: `Storage` and `Internal` errors map to HTTP 500; the error message is the `.to_string()` of the Rust error, which is generic (e.g., "storage error: ..."). No sensitive data is explicitly logged.
- Recommendations: Create a separate `ApiErrorResponse` type that sanitizes `Internal` errors before serialization (e.g., "Internal server error" instead of the raw message). Log full errors server-side with structured tracing, expose only error codes to clients.

## Performance Bottlenecks

**Full table scans on every list/query operation:**
- Problem: `list_items()` in `todo-engine/src/infrastructure/sqlite/repo.rs` (lines 29-40) does `SELECT * FROM items` without filtering at the SQL level. Filtering (`ListFilter`) is applied in-memory after fetching all rows. With thousands of items, this loads the entire table into RAM.
- Files: `todo-engine/src/infrastructure/sqlite/repo.rs` (lines 29-40), `todo-engine/src/application/ports.rs` (list filter applied in-memory)
- Cause: Parameterized WHERE clauses are complex to build dynamically in Rust; the current code prioritizes simplicity over efficiency.
- Improvement path: Move filter logic into SQL queries (e.g., `WHERE status = ? AND item_type = ? ...`). Build WHERE clauses dynamically using string concatenation (with safety checks) or a query builder library. Measure impact on queries with 10k+ items.

**Routine materialization iterates all active routines on every call:**
- Problem: `materialize_routines()` at `todo-engine/src/application/service/materialization.rs` (line 18) lists all active routines every time, then checks existence of generated tasks for each. With hundreds of routines, this is O(n) database queries.
- Files: `todo-engine/src/application/service/materialization.rs` (lines 9-71)
- Cause: No caching; each call to `/today` or `materialize_routines` re-queries the full routine set.
- Improvement path: Cache the result of `list_items(Routine, Active)` at the API layer, or add a database column `last_materialized_window` to skip routines that don't need re-materialization. Batch existence checks into a single SQL query instead of per-routine lookups.

**Each API request opens a new database connection:**
- Problem: `with_service()` at line 87 of `todo-engine/src/interfaces/api/mod.rs` calls `service()`, which calls `connect()`, which opens a new `rusqlite::Connection`. This is expensive (I/O + schema validation).
- Files: `todo-engine/src/interfaces/api/mod.rs` (lines 52-62)
- Cause: Simple design; no connection pooling.
- Improvement path: Implement a connection pool (e.g., using `r2d2-sqlite` or `rusqlite`'s built-in connection caching). Create the pool at router initialization and reuse connections across requests.

## Fragile Areas

**Status transition state machine not centralized:**
- Files: `todo-engine/src/application/service/transitions.rs` (all methods), `todo-engine/src/domain/status.rs` (status enum), `todo-engine/tests/integration/service_policy.rs` (policy tests)
- Why fragile: Validation logic for state transitions is scattered across methods like `approve()`, `activate()`, `complete()`, etc. Each method checks pre-conditions (e.g., "must be proposed to approve"). If a new status is added, all transition methods must be audited and updated. Tests cover the happy path but edge cases (e.g., approving an approved item) may not be exhaustively tested.
- Safe modification: Add a centralized state transition matrix at the top of `transitions.rs` (e.g., a HashMap of allowed transitions). Add unit tests for all pairwise transitions. Validate new status additions against the matrix before merge.
- Test coverage: Integration tests in `tests/integration/service_policy.rs` cover key policies, but no tests for invalid transitions (e.g., trying to complete an archived item). Add negative test cases.

**Approval gating logic duplicated in CLI and API:**
- Files: `todo-engine/src/interfaces/cli/create.rs`, `todo-engine/src/interfaces/api/handlers.rs`, `todo-engine/src/application/service/creation.rs` (e.g., line 85 creates area as active immediately)
- Why fragile: Both CLI and API handlers parse the `actor` parameter and decide whether to mark an item as `proposed` or `approved`. If the policy changes (e.g., "all agent items must now be proposed"), both places must be updated.
- Safe modification: Centralize the "should be approved?" logic into `TodoService` methods. Have `propose_task()`, `propose_project()`, etc. take an `actor` parameter and decide internally. Remove `actor` parsing from CLI/API handlers.
- Test coverage: Service-layer tests in `service_policy.rs` verify the policy, but API/CLI handlers have no tests that verify they correctly pass the actor. Add API/CLI handler tests.

**Materialization policy is a string, not an enum:**
- Files: `todo-engine/src/application/service/materialization.rs` (line 33, match on string), `todo-engine/src/domain/model.rs` (materialization_policy field)
- Why fragile: `materialization_policy` is stored as a string and matched on at runtime. Typos or new policies require code changes in two places (schema + service logic). No compile-time safety.
- Safe modification: Create an enum `MaterializationPolicy { SingleOpen, PerOccurrence }` in `domain/`, derive serialization, and use it in the model. Update repo mapping to convert string ↔ enum. Add database migration to normalize existing strings.
- Test coverage: No tests for unsupported materialization policies; the error case at line 62-65 is never exercised.

**Clone-heavy TodoService state management:**
- Files: `todo-engine/src/application/service/mod.rs` (lines 28-31 ServiceStore enum), tests clone items repeatedly
- Why fragile: TodoService holds mutable state (store, events, counters). Tests and code that modify items often clone them before/after mutations. With large items or many events, this is wasteful and could become a performance issue.
- Safe modification: Use references and owned buffers more carefully. Consider separating mutable service state (store, events) from immutable query logic. Profile clone costs in a test with 1k+ items.
- Test coverage: No benchmarks; impact is unknown for large datasets.

## Scaling Limits

**SQLite single-writer bottleneck:**
- Current capacity: ~100 concurrent readers, 1 writer at a time. With 10 concurrent users making changes, writes will queue.
- Limit: Beyond ~500 active items and 10+ concurrent API users, SQLite locking will cause noticeable latency (100s of ms).
- Scaling path: Migrate to PostgreSQL or MySQL if concurrent write throughput is needed. For local-first use cases, keep SQLite but implement write-ahead-log (WAL) mode (not currently enabled) to improve concurrency.

**In-memory ID/event counters increment forever:**
- Current capacity: `u64` counters for ID and event generation (lines 23-25 of `mod.rs`). In production, persistent mode uses UUID v4, so no overflow. In-memory mode increments forever.
- Limit: In-memory tests run for 2^64 operations without counter reset (essentially no limit in practice, but a code smell).
- Scaling path: Not critical for in-memory testing. If in-memory mode is used in production, add counter resets or use UUIDs instead.

**No audit log retention policy:**
- Current capacity: All events are inserted into the `events` table indefinitely. With 10 tasks/day, this is ~3650 events/year.
- Limit: After 10 years, the events table has 36k rows; queries remain fast but backup/restore times grow. No documented retention policy.
- Scaling path: Add optional archival (e.g., "move events older than 2 years to archive table" or "truncate old events"). Implement as optional CLI command. Document retention expectations in `docs/operations/data-home.md`.

## Dependencies at Risk

**No dependencies on deprecated or unmaintained libraries:**
- Risk: None detected. Dependencies are stable (rusqlite, axum, serde, time, clap).
- Migration plan: N/A.

**Time crate version lock:**
- Risk: The `time` crate is pinned to a specific version in `Cargo.toml`. If a security fix is released in a newer version, the project won't automatically pick it up.
- Impact: Potential vulnerability in date/time parsing if a CVE is discovered.
- Migration plan: Regularly audit `time` crate for security updates; bump version in CI.

## Missing Critical Features

**No concurrent write support for multi-user scenarios:**
- Problem: The spec says "local-first personal ToDo engine," implying single-user. But if the API is exposed to multiple users or clients, writes will conflict. No locking, versioning, or conflict resolution.
- Blocks: Sharing a todo.sqlite between two processes (e.g., mobile app + web app) without manual sync or conflict resolution.

**No soft-delete recovery mechanism:**
- Problem: Items can be archived, cancelled, or dropped, but there is no "undelete" or "recovery" feature. If a user accidentally archives an important item, there is no UI to restore it.
- Blocks: User safety in production; requires manual SQLite editing to recover.

**No API rate limiting or authentication:**
- Problem: The HTTP API has no auth layer and no rate limiting. Any client can hit any endpoint.
- Blocks: Deployment in multi-tenant or shared environments.

## Test Coverage Gaps

**API handler error cases not tested:**
- What's not tested: API handlers do not have tests for invalid JSON, missing required fields, or out-of-range values. Tests only exercise happy paths.
- Files: `todo-engine/tests/e2e/api.rs`, `todo-engine/src/interfaces/api/handlers.rs`
- Risk: API could crash or return 500 for recoverable errors (e.g., negative priority) when it should return 400 with a message.
- Priority: High.

**Status transition edge cases:**
- What's not tested: Tests cover normal transitions (proposed → approved → active → completed), but not invalid ones (e.g., active → proposed, or completed → completed). Policy validation may be incomplete.
- Files: `todo-engine/tests/integration/service_policy.rs`
- Risk: A policy bug (e.g., allowing a disallowed transition) could corrupt the work graph.
- Priority: High.

**Concurrent materialization race conditions:**
- What's not tested: No tests for concurrent calls to `materialize_routines()` or parallel requests to `/today`. The uniqueness check for generated tasks is not tested under contention.
- Files: `todo-engine/tests/integration/materialization.rs`
- Risk: Duplicate task generation in production with concurrent users.
- Priority: High.

**Serialization round-trip integrity:**
- What's not tested: JSON serialization of items and events is not tested for round-trip fidelity (serialize → deserialize → serialize should yield identical JSON). Floating-point or special value edge cases may be missed.
- Files: `todo-engine/src/infrastructure/sqlite/mapping.rs`, tests
- Risk: Audit trail divergence if serialization is lossy.
- Priority: Medium.

**Database corruption recovery:**
- What's not tested: No tests for handling a corrupted or incomplete database (e.g., missing column, invalid constraint). The schema upgrade logic may fail silently.
- Files: `todo-engine/src/infrastructure/sqlite/schema.rs`, `ensure_item_columns()`
- Risk: Unrecoverable database errors in production with no user-friendly error messages.
- Priority: Medium.

---

*Concerns audit: 2026-06-17*
