# oracle-todo Rust Reimplementation Design

## Status

Approved direction: feature-by-feature Rust reimplementation with Clean Architecture and TDD.

## Goal

Reimplement `oracle-todo` in Rust while preserving the behavior of the current Python engine.

The Rust engine is complete when it supports:

- The behavior covered by the current Python test suite.
- The public CLI and API surfaces described in `README.md`.
- SQLite as the canonical data store.
- The same policy enforcement rules for human, Oracle, and system actions.
- Structured logging and typed error handling across CLI and API adapters.
- Safe compatibility with existing SQLite data before any cutover.

The Python engine remains the operational implementation until the Rust engine reaches parity and cutover is explicitly approved.

## Non-Goals

- No dashboard UI.
- No Telegram parser.
- No hard delete.
- No new recurrence policy beyond the current Python behavior.
- No write access to Second_Brain.
- No direct mutation path outside the service layer.

## Success Criteria

- Rust tests cover every current Python behavior test at equivalent intent.
- `cargo test` passes with unit and integration coverage for domain, application, SQLite, CLI, and API paths.
- CLI commands call the same application service used by the API.
- Every mutation writes a SQLite event row and structured log entry.
- Existing SQLite data can be read and migrated through additive migrations in an isolated copied data home.
- Smoke tests never point at `~/.hermes/oracle-todo/todo.sqlite` unless cutover testing is explicitly approved.

## Architecture

The Rust crate is split into layers that follow the dependency rule: outer layers depend on inner layers, and inner layers do not depend on frameworks or adapters.

```text
CLI / HTTP API / Export commands
              |
        application
              |
           domain
              ^
              |
 infrastructure implements application ports
```

### Domain Layer

Owns framework-free business concepts:

- `TodoItem`
- `TodoEvent`
- `ItemType`
- `ItemStatus`
- `Actor`
- terminal status rules
- recurrence rule parsing value types
- policy error categories

Domain code does not depend on SQLite, HTTP, Clap, Axum, logging frameworks, or wall-clock time.

### Application Layer

Owns use cases and policy orchestration:

- `TodoService`
- create area
- propose project, routine, task, and event
- approve, activate, pause, resume, complete, archive, drop, cancel
- update item
- list and archive views
- materialize routines
- render export view models

Application ports:

- `TodoRepository`
- `EventRepository`
- `Clock`
- `IdGenerator`
- `Logger` or tracing-compatible event sink

The application layer is the only place where mutations are coordinated. CLI and API adapters cannot bypass it.

### Infrastructure Layer

Owns concrete external mechanisms:

- SQLite connection and transactions via `rusqlite`.
- schema migrations.
- repository implementations.
- JSON serialization for metadata columns.
- event persistence.
- tracing/logging initialization.
- data-home path resolution.

SQLite stores both current item state and audit events. JSON metadata remains JSON-compatible with the Python implementation.

### Interface Adapters

Adapters translate input/output only:

- CLI adapter via `clap`.
- HTTP API adapter over the same application service.
- Markdown export adapter.

Adapters map typed application errors to user-facing output:

- policy violation: validation-style CLI/API error.
- not found: not-found CLI/API error.
- storage failure: internal error.
- migration failure: startup error.

## Data Model

Rust preserves the Python item model:

- item types: `area`, `project`, `routine`, `task`, `event`, `review`, `archive_item`.
- statuses: `proposed`, `approved`, `active`, `waiting`, `paused`, `completed`, `cancelled`, `dropped`, `archived`, `someday`, `rejected`.
- relationships: `area_id`, `project_id`, `routine_id`, `parent_id`.
- scheduling fields: `due`, `scheduled`, `horizon`.
- routine fields: `recurrence_rule`, `materialization_policy`, `occurrence_key`, `last_materialized_at`.
- audit fields: proposed, approved, completed, archived, created, and updated timestamps.
- JSON fields: `second_brain_refs`, `metadata`.

Migration policy:

- Use explicit versioned migrations.
- Keep migrations additive during parity work.
- Validate schema compatibility with copied SQLite fixtures before cutover.
- Do not require live data mutation during normal tests.

## Policies

The Rust service enforces the current policies:

- Oracle-created tasks, projects, routines, and events start as `proposed`.
- User-created work starts as `approved` where the Python engine currently does so.
- Agent-created work cannot become `active` until approved.
- Projects require `definition_of_done` before activation.
- Routines require `recurrence_rule` before activation or resume.
- Areas are active at creation and cannot be completed, dropped, cancelled, activated, or resumed as work.
- Terminal items cannot be updated or transitioned again.
- Hard delete is absent.
- Every mutation records an event.
- Second_Brain references are stored as read-only references.
- Markdown exports are views, not source of truth.

## Routine Materialization

The Rust recurrence behavior matches the Python implementation:

- `single_open`: creates at most one open generated task per active routine.
- `per_occurrence`: creates bounded unique tasks for each occurrence.
- Generated tasks are `approved` because active routines already passed approval.
- Generated tasks carry `routine_id`, `occurrence_key`, `scheduled`, and `metadata.generated_by = "routine"`.
- Completion, cancellation, archiving, pausing, and resuming generated tasks update routine occurrence history.
- Pausing a routine moves open generated tasks to `waiting`.
- Resuming a routine restores waiting generated tasks to `approved`.
- Archiving or cancelling a routine cascades to open generated tasks.

Supported recurrence inputs:

- aliases: `daily`, `weekly`, `monthly`, `yearly`, `매일`, `매주`, `매월`, `매년`.
- interval rules: `every N days`, `every N weeks`, `every N months`, `every N years`.
- weekly anchors: `every week on Monday`, short weekday names, Korean weekday names.
- weekday sets and ranges: weekdays, weekends, `월-금`, `토-일`, `월-일`, `월수금`, comma-separated sets.
- monthly anchors: `on the 1st` through `on the 31st`, clamped to month end, and `on the last`.

## CLI Scope

The Rust CLI preserves the current command intent:

- `init`
- `health`
- `list`
- `pending`
- `approve`
- `activate`
- `pause`
- `resume`
- `complete`
- `archive`
- `drop`
- `cancel`
- `update`
- `archive-list`
- `today`
- `export`
- `area create`
- `project propose`
- `routine propose`
- `routine materialize`
- `task propose`
- `event propose`

Command output remains machine-readable where the Python CLI currently prints JSON for single-item mutations. Tabular/list and markdown views may be adjusted only when tests preserve the user-visible intent.

## API Scope

The Rust API preserves the current dashboard-ready endpoints:

- `GET /health`
- `GET /items`
- `POST /areas`
- `POST /tasks/propose`
- `POST /items/{id}/approve`
- `POST /items/{id}/complete`
- `GET /exports/today.md`

API handlers call the same application service as the CLI.

## Logging And Error Handling

Use typed errors at the application boundary:

- `PolicyError`
- `NotFound`
- `Validation`
- `Storage`
- `Migration`
- `Internal`

Use structured logging with operation names, actor, item id when present, status transitions, and error category. Logs do not include sensitive metadata values unless explicitly safe.

## Testing Strategy

TDD is mandatory:

1. Port one Python behavior into a failing Rust test.
2. Confirm the test fails for the expected reason.
3. Implement the minimal Rust code needed to pass.
4. Refactor while all tests remain green.
5. Repeat by feature slice.

Test layers:

- Domain unit tests for policies and recurrence parsing.
- Application tests using in-memory repositories where practical.
- SQLite integration tests with temporary database files.
- CLI integration tests using temporary `ORACLE_TODO_HOME`.
- API integration tests against an in-process server or router.
- Export tests for markdown view shape.
- Compatibility smoke tests against copied SQLite data.

## Implementation Order

Use vertical slices that each leave the Rust engine runnable:

1. Foundation: crate layout, domain enums/entities, typed errors, clock/id ports.
2. SQLite schema and migration baseline.
3. Item creation and approval policies.
4. State transitions and audit events.
5. Update, list, archive view, and exports.
6. Routine materialization and recurrence parser.
7. CLI parity.
8. API parity.
9. logging, compatibility smoke tests, and cutover readiness checks.

## Cutover Guardrails

- Default tests use temporary data homes.
- Live data remains under Python ownership until explicit cutover approval.
- Rust can validate copied data before cutover.
- Cutover requires a passing Rust parity suite, passing copied-data smoke tests, and user approval.
