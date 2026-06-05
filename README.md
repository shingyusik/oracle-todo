# oracle-todo

Policy-enforced personal ToDo engine for Oracle/Hermes workflows.

## Core model

`oracle-todo` keeps areas, projects, tasks, routines, and events in one SQLite-backed item graph.

- **SQLite source of truth**: CLI, API, and Markdown exports are views over `todo.sqlite`.
- **Rust service layer enforces policy**: CLI/API use the same validation and state transitions.
- **Audit events are mandatory**: every service-layer mutation writes an event row to SQLite `events`.
- **User approval gates agent-created work**: Oracle-created items start as `proposed` until user approval.
- **File logs are operational logs**: CLI command start/success/error are written under `logs/` with rotation.

## Stack

- Rust 2024
- SQLite via `rusqlite`
- CLI via `clap`
- API via `axum`
- Error types via `thiserror`
- Tests via `cargo test`

## Setup

```bash
cargo build
cargo run -- init
```

Default data directory:

```text
~/.hermes/oracle-todo/
├── todo.sqlite
├── exports/
│   ├── today.md
│   ├── events.md
│   ├── projects.md
│   ├── areas.md
│   ├── routines.md
│   ├── proposed.md
│   └── archive.md
└── logs/
    ├── oracle-todo.log
    └── oracle-todo.log.1
```

Use another data directory:

```bash
export ORACLE_TODO_HOME=/path/to/data
cargo run -- init
# or
cargo run -- --home /path/to/data init
```

## Quick usage

```bash
# Create an ongoing area. Areas are active immediately.
cargo run -- area create "재정" \
  --review-cycle weekly \
  --standard "월 1회 계정/자동화 상태 점검" \
  --note "월말 자동화까지 함께 확인"

# Let Oracle propose a project. Proposed items require user approval in service/API flows.
cargo run -- project propose "MoneyManager 안정화" \
  --area "재정" \
  --outcome "가계부 운영 안정화" \
  --definition-of-done "원본 DB 백업과 브리핑이 매일 실패 없이 동작한다" \
  --due 2026-06-30 \
  --note "SQLite 백업 경로도 확인"

# Add a task.
cargo run -- task propose "MoneyManager 앱 열고 DB 생성 여부 확인" \
  --area "재정" \
  --scheduled today \
  --priority 1 \
  --description "명령어와 컬럼 설명 확인" \
  --note "실행 로그도 확인"

# Add a routine.
cargo run -- routine propose "운동 기록 확인" \
  --area "건강" \
  --recurrence-rule "월-금" \
  --materialization-policy single_open \
  --note "아침 루틴"

# Add an external event.
cargo run -- event propose "치과 예약" "2026-06-12T10:30" \
  --area "건강" \
  --location "서울" \
  --with "치과" \
  --commitment-type appointment \
  --note "보험 서류 챙기기"

# Read current views.
cargo run -- pending
cargo run -- today
cargo run -- export
```

## Item types

### Area

Long-lived responsibility domain. Examples: `재정`, `건강`, `Second_Brain`, `개발`, `가족`.

- Created as `active`.
- Not completed as ordinary work.
- Owns standards and review rhythm.

Important columns:

- `id`: stable area ID, `area_<n>` or UUID-like value depending on generator path.
- `type`: `area`.
- `title`: area name.
- `status`: created as `active`.
- `review_cycle`: review rhythm, e.g. `weekly`, `monthly`.
- `standard`: operating standard / health criterion for the area.
- `note`: short free-form memo.
- `proposed_by`: usually `user`.
- `approved_by`, `approved_at`: set at creation for user-created areas.

### Project

Finite outcome-oriented work inside an area.

- Activation requires `definition_of_done`.
- Projects should represent outcomes, not single actions.
- Tasks can link to a project through `project_id`.

Important columns:

- `id`: stable project ID.
- `type`: `project`.
- `title`: project name.
- `status`: usually `proposed`, `approved`, or `active`.
- `area_id`: owning area ID, resolved by `--area <name-or-id>`.
- `outcome`: desired result.
- `definition_of_done`: completion criteria; required before activation.
- `due`: date or date-like string.
- `note`: short free-form memo.
- `proposed_by`: `oracle`, `user`, or `system`.
- `approved_by`, `approved_at`: user approval marker.

### Task

Concrete action item.

- Oracle-created tasks start as `proposed`.
- User-created tasks can start as `approved` when actor is `user`.
- Tasks may belong to an area, project, or routine.
- `today` includes task items in `proposed`, `approved`, or `active` status when `scheduled` is empty, `today`, or a date not later than today.

Important columns:

- `id`: stable task ID.
- `type`: `task`.
- `title`: action title.
- `status`: usually `proposed`, `approved`, `active`, `waiting`, or terminal.
- `area_id`: owning area ID.
- `project_id`: parent project ID; must point to a non-terminal project.
- `routine_id`: source routine ID; must point to a non-terminal routine.
- `description`: detailed instructions or acceptance notes.
- `note`: short free-form memo.
- `due`: deadline string.
- `scheduled`: schedule/visibility string, e.g. `today`, `2026-06-05`.
- `priority`: integer priority.
- `occurrence_key`: system-managed routine occurrence key, usually ISO date.
- `metadata.generated_by`: `routine` for generated tasks.

### Routine

Recurring work template. Active routines materialize task instances through the service layer.

- Activation requires `recurrence_rule`.
- Generated tasks link back through `routine_id`.
- `single_open` keeps at most one open generated task per routine.
- `per_occurrence` creates one task per occurrence in the materialization window.

Important columns:

- `id`: stable routine ID.
- `type`: `routine`.
- `title`: routine task title used for generated tasks.
- `status`: usually `proposed`, `approved`, `active`, or `paused`.
- `area_id`: owning area ID.
- `recurrence_rule`: supported recurrence rule string.
- `materialization_policy`: `single_open` or `per_occurrence`; default `single_open`.
- `note`: short free-form memo.
- `last_materialized_at`: system-managed materialization timestamp.
- `metadata.occurrences`: system-managed terminal-state history for generated routine tasks.

Supported recurrence examples:

- `daily`, `매일`, `every day`: every day.
- `weekly`, `매주`, `every week`: every 7 days from materialization window start.
- `monthly`, `매월`, `every month`: monthly on day 1.
- `yearly`, `매년`, `every year`: yearly on Jan 1.
- `월`, `mon`, `monday`: every Monday.
- `월-금`, `평일`, `weekdays`: Monday through Friday.
- `토-일`, `주말`, `weekend`: Saturday and Sunday.
- `월-일`: every day.
- `월수금`, `mon,wed,fri`, `mon wed fri`: specific weekday set.
- `every 2 weeks on mon`: every 2 weeks on Monday.
- `every month on the 15th`: monthly on the 15th.
- `every month on the last`: monthly on the last day.
- `every 2 years`: every 2 years.

### Event

External commitment or scheduled appointment.

- Requires `scheduled`.
- Uses `metadata` for location, participants, and commitment type.
- Exported separately from tasks.

Important columns:

- `id`: stable event ID.
- `type`: `event`.
- `title`: event title.
- `status`: usually `proposed`, `approved`, `active`, or terminal.
- `scheduled`: scheduled date/time string.
- `area_id`: related area ID.
- `project_id`: related project ID.
- `due`: separate deadline if needed.
- `priority`: integer priority.
- `description`: details.
- `note`: short free-form memo.
- `metadata.location`: location.
- `metadata.participants`: people/groups/institutions.
- `metadata.commitment_type`: defaults to `appointment`.
- `metadata.schedule_kind`: `external_commitment`.

## Shared item columns

SQLite table: `items`.

- `id`: string primary key.
- `type`: `area`, `project`, `routine`, `task`, `event`, `review`, `archive_item`.
- `title`: human-readable title.
- `status`: lifecycle enum.
- `area_id`: nullable item ID for owning area.
- `project_id`: nullable item ID for parent project.
- `routine_id`: nullable item ID for source routine.
- `parent_id`: nullable generic parent link.
- `description`: nullable detailed text.
- `note`: nullable short free-form memo for area/project/task/routine/event.
- `outcome`: nullable desired result, mainly for projects.
- `definition_of_done`: nullable completion criteria, required before project activation.
- `standard`: nullable area operating standard.
- `review_cycle`: nullable area review rhythm.
- `recurrence_rule`: nullable routine recurrence rule.
- `materialization_policy`: `single_open` or `per_occurrence`.
- `occurrence_key`: nullable routine occurrence key for generated tasks.
- `priority`: nullable integer.
- `due`: nullable deadline string.
- `scheduled`: nullable schedule/visibility date/time.
- `horizon`: nullable planning horizon.
- `proposed_by`: `user`, `oracle`, or `system`.
- `approved_by`: nullable actor.
- `approved_at`: nullable approval timestamp.
- `completed_at`: nullable completion timestamp.
- `archived_at`: nullable archive/terminal timestamp.
- `last_materialized_at`: nullable routine materialization timestamp.
- `second_brain_refs`: JSON list of read-only Second_Brain references.
- `metadata`: JSON object for type-specific or integration metadata.
- `created_at`: creation timestamp.
- `updated_at`: last update timestamp.

## Status lifecycle

Allowed status values:

- `proposed`: suggested item awaiting user decision.
- `approved`: accepted but not necessarily active.
- `active`: current work or maintained routine/project.
- `waiting`: blocked or waiting; used for generated routine tasks when a routine is paused.
- `paused`: temporarily stopped.
- `completed`: done. Terminal.
- `cancelled`: cancelled. Terminal.
- `dropped`: intentionally abandoned. Terminal.
- `archived`: archived. Terminal.
- `someday`: deferred out of active flow. Terminal for normal updates.
- `rejected`: proposal rejected. Terminal.

The Rust domain parses status strings through the `ItemStatus` enum. App paths reject unknown status values.

## Logging and errors

CLI output has two layers:

- **stdout**: user-facing command result, usually JSON or rendered Markdown.
- **stderr**: user-facing errors.
- **file log**: operational command log at `ORACLE_TODO_HOME/logs/oracle-todo.log`.

File logging behavior:

- Logs `command_start`, `command_success`, and `command_error`.
- Errors are logged with the same message shown to the CLI user.
- Default max file size: `1_048_576` bytes.
- Override with `ORACLE_TODO_LOG_MAX_BYTES=<bytes>`.
- Rotation keeps one previous file: `oracle-todo.log.1`.

Error handling:

- Domain/service errors use `TodoError` in `src/application/error.rs`.
- Policy/validation errors map to CLI exit code `2` and HTTP `400`.
- Not-found errors map to CLI exit code `4` and HTTP `404`.
- Storage/migration/internal errors map to CLI exit code `1` and HTTP `500`.

## Markdown exports

`cargo run -- export` writes Markdown views to `ORACLE_TODO_HOME/exports/`.

- `today.md`: visible task list for today.
- `events.md`: non-archived events.
- `projects.md`: non-archived projects.
- `areas.md`: non-archived areas.
- `routines.md`: non-archived routines.
- `proposed.md`: items awaiting approval.
- `archive.md`: completed, archived, cancelled, dropped, or someday items.

Exported list item metadata includes type, status, due date, scheduled date, area ID, location, and participants when available.

## Event log

SQLite table: `events`.

Every service-layer change creates a `TodoEvent` row.

- `id`: event ID.
- `at`: event timestamp.
- `actor`: `user`, `oracle`, or `system`.
- `action`: action name, e.g. `propose_task`, `approve`, `materialize_routine_task`.
- `object_type`: affected item type.
- `object_id`: affected item ID.
- `before`: JSON snapshot before the change.
- `after`: JSON snapshot after the change.
- `reason`: optional reason string.

## API

`src/interfaces/api.rs` provides an `axum` router over the same service layer.

Endpoints:

- `GET /health`: health check.
- `GET /items`: list items. Supports `status`, `type`, `include_archived`.
- `POST /areas`: create area.
- `POST /tasks/propose`: propose task.
- `POST /items/{id}/approve`: approve item.
- `POST /items/{id}/complete`: complete item.
- `GET /exports/today.md`: render today's task Markdown.

## Development

```bash
cargo fmt
cargo test
```

SQLite schema initialization is additive for existing databases. `init_schema()` creates tables and ensures missing columns exist on older `items` tables, including:

- `note`
- `materialization_policy`
- `occurrence_key`
- `last_materialized_at`
