# Rust Cutover Compatibility Remediation Design

## Status

Draft for fixing the blockers found during copied-live-DB evaluation.

## Problem

The Rust refactor is not cutover-ready because it does not safely interoperate with the operational SQLite data model and does not expose the full CLI surface used by the Python implementation.

Observed blockers:

- Rust cannot read copied live SQLite rows that store enum names such as `AREA`, `ACTIVE`, and `ORACLE`.
- Rust writes lowercase enum values such as `task`, `proposed`, and `oracle`, which Python SQLModel enum queries do not match.
- Rust CLI exposes only a subset of the Python CLI.
- Rust API currently covers only the existing Python FastAPI routes; this is acceptable for Python API parity, but not sufficient if the cutover target is a full operational HTTP API.

The Python implementation remains the operational engine until these blockers are fixed and the cutover gate passes.

## Goals

- Make Rust read existing SQLite enum values stored as uppercase SQLAlchemy enum names.
- Make Rust write SQLite enum columns in the Python-compatible uppercase format.
- Preserve lowercase JSON, markdown, and user-facing enum strings where Python emits enum values.
- Add first-class compatibility tests that use uppercase legacy SQLite fixtures.
- Add Python-to-Rust and Rust-to-Python round-trip smoke tests.
- Complete Rust CLI parity for the existing Python CLI command surface.
- Define API cutover scope clearly and add operational API routes only behind explicit tests.
- Keep Clean Architecture boundaries: domain and application stay framework-free; SQLite encoding stays in infrastructure; CLI/API call `TodoService`.

## Non-Goals

- No mutation of the live `~/.hermes/oracle-todo/todo.sqlite` during tests.
- No destructive migration from uppercase enum names to lowercase enum values.
- No hard delete command.
- No new recurrence behavior beyond the existing Python policy.
- No dashboard UI.
- No direct repository calls from CLI or API handlers.

## Compatibility Decision

SQLite enum columns use Python-compatible uppercase enum names.

Required SQLite values:

| Concept | SQLite Values |
| --- | --- |
| Item type | `AREA`, `PROJECT`, `ROUTINE`, `TASK`, `EVENT`, `REVIEW`, `ARCHIVE_ITEM` |
| Item status | `PROPOSED`, `APPROVED`, `ACTIVE`, `WAITING`, `PAUSED`, `COMPLETED`, `CANCELLED`, `DROPPED`, `ARCHIVED`, `SOMEDAY`, `REJECTED` |
| Actor columns | `USER`, `ORACLE`, `SYSTEM` |

Required Rust behavior:

- SQLite reads accept both uppercase legacy names and lowercase enum values.
- SQLite writes use uppercase names for `items.type`, `items.status`, `items.proposed_by`, `items.approved_by`, and `events.actor`.
- `events.object_type` remains lowercase because Python writes `item.type.value` there.
- `before` and `after` JSON snapshots remain lowercase because Python `model_dump(mode="json")` emits enum values.
- CLI, API JSON, and markdown output keep lowercase strings unless a specific legacy interface requires otherwise.

Implementation boundary:

- Domain enums expose display/value methods for JSON and exports.
- Infrastructure owns SQLite encoding methods.
- Application service does not know whether SQLite stores uppercase or lowercase values.

## CLI Parity Scope

Rust must support these Python CLI commands:

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

Output policy:

- Single-item mutations print compact JSON.
- `list` and `archive-list` print a scan-friendly table or stable text view.
- `pending`, `today`, and `export` preserve the current Rust markdown-style output if tests verify the same user-visible intent.

## API Scope

Minimum cutover API scope is parity with the current Python FastAPI implementation:

- `GET /health`
- `GET /items`
- `POST /areas`
- `POST /tasks/propose`
- `POST /items/{id}/approve`
- `POST /items/{id}/complete`
- `GET /exports/today.md`

Operational API extension scope adds service-level routes for non-dashboard automation:

- `POST /projects/propose`
- `POST /routines/propose`
- `POST /events/propose`
- `POST /items/{id}/activate`
- `POST /items/{id}/pause`
- `POST /items/{id}/resume`
- `POST /items/{id}/archive`
- `POST /items/{id}/drop`
- `POST /items/{id}/cancel`
- `PATCH /items/{id}`
- `GET /items/archive`

The minimum cutover gate requires Python API parity. The operational extension gate requires the added routes above to call `TodoService` and pass route tests.

## Testing Requirements

Required Rust test groups:

- Domain enum parser accepts uppercase and lowercase input.
- SQLite repository reads uppercase legacy rows.
- SQLite repository writes uppercase enum columns and lowercase event `object_type`.
- Rust CLI reads a Python-created copied data home.
- Python CLI reads a Rust-created data home.
- CLI parity covers every command in the scope list.
- API parity covers current Python routes.
- Operational API extension tests cover each added route if the extension scope is implemented.

Required command gate:

```bash
cargo fmt --check
cargo test
cargo clippy --all-targets --all-features -- -D warnings
uv run pytest -q
cargo llvm-cov --summary-only
```

Coverage gate:

- Rust line coverage remains at or above 80%.
- Tests may use mock fixture data and temporary data homes.
- Tests must not use fake assertions that only prove the test harness runs.

## Cutover Gate

Cutover is allowed only when all conditions pass:

- Copied live DB smoke test can run `pending`, `today`, and `export` without enum storage errors.
- Rust-created DB is visible to Python CLI `pending` and `list`.
- Python-created DB is visible to Rust CLI `pending` and `list`.
- CLI parity commands exist and call `TodoService`.
- Minimum API parity routes pass.
- Any operational API extension routes included in the release pass route tests.
- Full verification command gate passes.
- The branch is committed and pushed.
